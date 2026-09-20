/**
 * 教学会话操作域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：会话查询（history/detail）、检查点提交与代码裁决（submitCheckpoint /
 * judgeCheckpointSubmission）、暂停/恢复/重置（pause/resume/reset）、虚拟会话超时同步、
 * 最新任务评估读取、超时收尾兜底（applyTimeoutWrapupFallback）与同伴消息处理
 * （processPeerMessage）。自 AITeachingCoordinator 迁出，行为不变；facade 保留委托。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { executeSkill, peerAgentDefinition } from '../../skills';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { teachingSessionRepository, TeachingSessionConflictError, type TeachingSessionRecord, type TeachingSessionMessage } from './TeachingSessionRepository';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { applyWarmupExtractionForSession } from './warmup-writeback';
import { parseSessionArtifacts } from './checkpoint-shared';
import {
  TeachingCheckpoint,
  CheckpointSubmitPayload,
  CheckpointSubmitResult,
  getPendingCheckpoint,
  judgeCheckpointAnswer,
  stripCheckpointAnswerKeys,
} from './teaching-checkpoint';
import { buildTeachingStateWithArtifacts } from './teaching-classroom-flow';
import { cloneKnowledgePoints } from './teaching-knowledge-state';
import { computeEffectiveDurationMinutes, pickPeerStrategy } from './teaching-session-views';
import { requireTeachingRevision } from './teaching-turn-shared';
import { processStudentMessage } from './teaching-turn-engine';
import type { ReplanAdvisory } from './ReplanAdvisoryService';
import type { ProcessStudentMessageOptions } from './AITeachingCoordinator';

export async function getSessionHistory(userId: string): Promise<Array<{
  id: string;
  subject: string;
  topic: string;
  taskId: string | null;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  status: string;
  messageCount: number;
}>> {
  const sessions = await teachingSessionRepository.listByUser(userId);
  return sessions.map((session) => ({
    id: session.id,
    subject: session.subject,
    topic: session.topic,
    taskId: session.taskId,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    status: session.status,
    messageCount: session.messages.length,
  }));
}

export async function getSessionDetail(sessionId: string, userId: string): Promise<{
  id: string;
  subject: string;
  topic: string;
  taskId: string | null;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  status: string;
  messages: Array<{ role: string; content: string; timestamp: string; analysis?: any }>;
  state: any;
  knowledgePoints?: any[];
  wrapup?: any | null;
  advisory?: ReplanAdvisory | null;
  pendingCheckpoint?: TeachingCheckpoint | null;
  revision: number;
} | null> {
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session || session.userId !== userId) {
    return null;
  }

  return {
    id: session.id,
    subject: session.subject,
    topic: session.topic,
    taskId: session.taskId,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    status: session.status,
    messages: session.messages,
    state: stripCheckpointAnswerKeys(session.teachingState || {}),
    knowledgePoints: session.knowledgeState,
    wrapup: session.wrapup,
    advisory: (session.advisory as ReplanAdvisory | null) || null,
    // 答案键剔除后再给客户端：它只用于服务端代码裁决（审计 §7 P1-1）
    pendingCheckpoint: stripCheckpointAnswerKeys({ pendingCheckpoint: getPendingCheckpoint(session.teachingState) }).pendingCheckpoint ?? null,
    revision: session.revision,
  };
}

export async function submitCheckpoint(
  sessionId: string,
  checkpointId: string,
  payload: CheckpointSubmitPayload,
  expectedRevision?: number,
): Promise<CheckpointSubmitResult> {
  const operationClaim = await teachingSessionRepository.claimOperation(
    sessionId,
    `checkpoint:${checkpointId}`,
    ['active', 'timeout'],
    requireTeachingRevision(expectedRevision)
  );
  const session = operationClaim.session;

  const checkpoint = getPendingCheckpoint(session.teachingState);
  if (!checkpoint || checkpoint.id !== checkpointId) {
    await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    throw new Error('理解检查不存在或已处理');
  }

  try {
    // 跳过检查点：清除待处理检查点（记录历史，允许后续生成新检查点），不触发教学回合
    if (payload?.skip === true) {
      // 只有出题时声明了 allowSkip 才允许跳过（声明与行为一致；此前 allowSkip 只是下发给客户端的装饰）
      if (checkpoint.allowSkip !== true) {
        throw new Error('该检查点不允许跳过');
      }
      const teachingState: Record<string, any> = { ...(session.teachingState || {}) };
      delete teachingState.pendingCheckpoint;
      const nextArtifacts = { ...parseSessionArtifacts(teachingState) };
      delete nextArtifacts.pendingCheckpoint;
      teachingState.sessionArtifacts = nextArtifacts;
      const history = Array.isArray(teachingState.checkpointHistory)
        ? [...teachingState.checkpointHistory]
        : [];
      history.push({
        checkpointId,
        title: checkpoint.title,
        type: checkpoint.type,
        submittedAt: new Date().toISOString(),
        passed: false,
        skipped: true,
      });
      teachingState.checkpointHistory = history.slice(-20);
      await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
        messages: session.messages,
        knowledgeState: session.knowledgeState,
        teachingState,
        taskId: session.taskId,
        userId: session.userId,
      });
      return {
        passed: false,
        feedback: '已跳过这个检查点，我们继续。',
        nextAction: 'continue',
        revision: (operationClaim.session.revision ?? 0) + 1,
      };
    }

    let answer: string;
    if (checkpoint.type === 'short_answer') {
      answer = payload.answerText?.trim() || '';
      if (!answer) {
        throw new Error('缺少作答内容');
      }
    } else {
      const selectedOptionIds = Array.from(new Set(payload.selectedOptionIds || []));
      const options = Array.isArray(checkpoint.options) ? checkpoint.options : [];
      const selectedOptions = selectedOptionIds.map((optionId) => options.find((option) => option.id === optionId));
      if (selectedOptions.length === 0 || selectedOptions.some((option) => !option)) {
        throw new Error('提交的选项无效');
      }
      if (checkpoint.type === 'single_choice' && selectedOptions.length !== 1) {
        throw new Error('单选题只能提交一个选项');
      }
      answer = selectedOptions.map((option) => `${option!.id}. ${option!.text}`).join('；');
    }

    const turn = await processStudentMessage(
      sessionId,
      `理解检查：${checkpoint.question}\n我的答案：${answer}`,
      {
        operationClaim,
        checkpointId,
        // 代码裁决（答案键存在时）：把"对错"从模型自评里剥离出来（审计 §7 P1-1）
        checkpointJudgement: judgeCheckpointAnswer(checkpoint, payload),
        checkpointSubmission: {
          selectedOptionIds: payload.selectedOptionIds,
          // 简答不落原文（可能含学生隐私细节），只留长度特征
          ...(payload.answerText ? { answerText: undefined } : {}),
        },
      }
    );
    const passed = turn.checkpointResolution?.passed === true;
    const hint = !passed && turn.analysis?.confusionPoints?.length
      ? `建议先回顾：${turn.analysis.confusionPoints.join('、')}`
      : undefined;
    return {
      passed,
      feedback: turn.aiResponse,
      ...(hint ? { hint } : {}),
      nextAction: passed ? 'continue' : 'review',
      revision: turn.revision,
    };
  } catch (error) {
    await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    throw error;
  }
}

/**
 * 只做**代码裁决**（不跑教学回合）：供流式提交先把"对错"回给用户。
 *
 * 走查 B-1：检查点的对错由答案键算出（`judgedBy='code'`），本可立即告知，
 * 但此前要等一整个教学回合（实测 60–80s 的「判定中…」）才知道结果。
 * 返回 null 表示不可提前裁决（无待处理检查点 / 无答案键）⇒ 客户端照旧等 final。
 */
export async function judgeCheckpointSubmission(
  sessionId: string,
  checkpointId: string,
  payload: { selectedOptionIds?: string[]; answerText?: string }
): Promise<{ passed: boolean; judgedBy: string; detail: string | null } | null> {
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session) return null;
  const checkpoint = getPendingCheckpoint(session.teachingState);
  if (!checkpoint || checkpoint.id !== checkpointId) return null;
  const judgement = judgeCheckpointAnswer(checkpoint, payload);
  if (!judgement) return null;
  return {
    passed: judgement.passed === true,
    judgedBy: judgement.judgedBy,
    detail: judgement.detail ?? null,
  };
}

export async function pauseSession(
  sessionId: string,
  userId: string,
  reason: 'manual' | 'pagehide' | 'hidden' = 'manual',
  expectedRevision?: number
): Promise<number> {
  requireTeachingRevision(expectedRevision);
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error('会话不存在');
  }
  if (['completed', 'discarded', 'superseded'].includes(session.status)) {
    throw new Error('已结束的会话无法暂停');
  }

  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  if (session.status === 'paused' && sessionArtifacts.pausedAt) {
    return session.revision;
  }

  const operationClaim = await teachingSessionRepository.claimOperation(
    sessionId,
    `pause:${reason}`,
    ['active', 'timeout'],
    expectedRevision
  );
  let committed = false;
  try {
    const currentArtifacts = parseSessionArtifacts(operationClaim.session.teachingState);
    await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
      status: 'paused',
      endTime: null,
      duration: null,
      teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
        ...currentArtifacts,
        pausedAt: new Date().toISOString(),
        pauseReason: reason,
      }),
    });
    committed = true;
    return operationClaim.session.revision + 1;
  } finally {
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}

/**
 * 恢复暂停的授课会话：把暂停时长累加进 pausedDurationMs，状态回到 active。
 * 用于页面切回标签页/窗口恢复可见时，避免把切走的时间计入学习时长。
 */
export async function resumeSession(
  sessionId: string,
  userId: string,
  expectedRevision?: number
): Promise<number> {
  requireTeachingRevision(expectedRevision);
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error('会话不存在');
  }
  if (session.status !== 'paused') {
    return session.revision;
  }

  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
    ? new Date(sessionArtifacts.pausedAt).getTime()
    : null;
  if (!wasPausedAt || Number.isNaN(wasPausedAt)) {
    return session.revision;
  }
  const pausedDurationMs = Math.max(0, Date.now() - wasPausedAt)
    + Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0));

  const operationClaim = await teachingSessionRepository.claimOperation(
    sessionId,
    'resume',
    ['paused'],
    expectedRevision
  );
  let committed = false;
  try {
    await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
      status: 'active',
      endTime: null,
      duration: null,
      teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
        ...sessionArtifacts,
        pausedAt: null,
        pauseReason: null,
        pausedDurationMs,
        resumedAt: new Date().toISOString(),
      }),
    });
    committed = true;
    return operationClaim.session.revision + 1;
  } finally {
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}

export async function resetSession(sessionId: string, userId: string, expectedRevision?: number): Promise<number> {
  requireTeachingRevision(expectedRevision);
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error('会话不存在');
  }
  if (session.status === 'discarded') {
    return session.revision;
  }
  if (['completed', 'superseded'].includes(session.status)) {
    throw new Error('已结束的会话无法重置');
  }

  const operationClaim = await teachingSessionRepository.claimOperation(
    sessionId,
    'reset',
    ['active', 'paused', 'timeout'],
    expectedRevision
  );
  let committed = false;
  try {
    await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
      status: 'discarded',
      endTime: simulatedNowOr(),
      duration: computeEffectiveDurationMinutes(operationClaim.session),
      clearOpenKey: true,
      teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
        ...parseSessionArtifacts(operationClaim.session.teachingState),
        resetAt: new Date().toISOString(),
      }),
    });
    committed = true;
    return operationClaim.session.revision + 1;
  } finally {
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}

/**
 * 记忆保持率提示（retrievability 学生端可视化）：查该用户低保持率的记忆点，注入 wrapup 供叙事引用。
 * 数值由 FSRS 公式确定性计算（零 LLM），wrapup 只做自然语言引用，禁止编造。
 */
export async function syncVirtualSessionTimeout(sessionId: string): Promise<void> {
  const sessions = await prisma.virtual_sessions.findMany({
    where: { currentStage: 'teaching' },
    select: {
      id: true,
      status: true,
      stageResults: true,
      logs: true,
    }
  });

  for (const session of sessions) {
    let stageResults: Record<string, any> = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}') || {};
    } catch {
      stageResults = {};
    }

    const learningState = stageResults.teaching || {};
    if (learningState?.teachingSessionId !== sessionId) continue;

    const nextLearningState = {
      ...learningState,
      // 注意：不写 manualStop —— 这是系统自动超时而非人工停止，
      // 写 manualStop 会让前端显示「已手动停止」并污染停止口径（数据取证证实
      // failed 会话中大量 manualStop=true 实为超时连锁）。原因由 stoppedReason 表达。
      stoppedAt: new Date().toISOString(),
      stoppedReason: 'teaching-session-timeout',
      taskRuntime: {
        ...(learningState.taskRuntime || {}),
        status: 'timeout',
        error: '授课会话已超时，请重新开始 Learn',
        updatedAt: new Date().toISOString()
      }
    };

    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      logs = [];
    }

    const hasTimeoutLog = logs.some((entry: any) => entry?.phase === 'error' && entry?.details?.error === 'TEACHING_SESSION_TIMEOUT');
    const nextLogs = hasTimeoutLog
      ? logs
      : [
          ...logs,
          {
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: 'TEACHING_SESSION_TIMEOUT',
              output: {
                action: 'teaching-step-stopped',
                teachingSessionId: sessionId
              }
            }
          }
        ];

    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: {
        status: 'failed',
        stageResults: JSON.stringify({
          ...stageResults,
          learning: nextLearningState
        }),
        logs: JSON.stringify(nextLogs),
        updatedAt: new Date()
      }
    });
  }
}

export async function getLatestTaskEvaluation(taskId: string, userId: string): Promise<{
  sessionId: string;
  subject: string;
  topic: string;
  startTime: Date;
  endTime: Date | null;
  duration: number;
  messageCount: number;
  knowledgePoints: any[];
  wrapup: any;
  advisory?: ReplanAdvisory | null;
} | null> {
  const sessions = await teachingSessionRepository.listByUser(userId);
  const target = sessions
    .filter((session) => session.taskId === taskId && session.status === 'completed' && session.wrapup)
    .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))[0];

  if (!target || !target.wrapup) {
    return null;
  }

  return {
    sessionId: target.id,
    subject: target.subject,
    topic: target.topic,
    startTime: target.startTime,
    endTime: target.endTime,
    duration: target.duration || 0,
    messageCount: target.messages.filter((message) => message.role === 'user').length,
    knowledgePoints: target.knowledgeState,
    wrapup: target.wrapup,
    advisory: (target.advisory as ReplanAdvisory | null) || null,
  };
}
/**
 * 超时会话兜底：写入轻量学习记录（不调 LLM），避免评估页出现
 * 「总结全空 + 用时 0 分钟」；用户之后恢复继续学习并正常结束时会被正式 wrapup 覆盖。
 */
export async function applyTimeoutWrapupFallback(sessionId: string): Promise<void> {
  try {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.status !== 'timeout' || session.wrapup) return;

    // 活跃时长：按消息时间戳估算（间隔 > 30 分钟视为暂停），避免把 idle 时间算入
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const times = messages
      .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    let activeMinutes = 0;
    for (let i = 1; i < times.length; i++) {
      activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
    }
    const durationMinutes = Math.max(1, Math.round(activeMinutes));

    const knowledgePoints = cloneKnowledgePoints(session.knowledgeState);
    const mastered = knowledgePoints.filter((p) => p.status === 'mastered').map((p) => p.name);
    const learning = knowledgePoints.filter((p) => p.status === 'learning').map((p) => p.name);

    const wrapup = {
      status: 'summary-only' as const,
      sources: { summary: 'timeout-fallback' as const, evaluation: 'failed' as const },
      duration: durationMinutes,
      summary: {
        topicSummary: '本次会话未正常结束，为你保留了基础学习记录。',
        knowledgeSummary: mastered.length > 0 ? `已掌握：${mastered.join('、')}。` : '暂未确认掌握的知识点。',
        practiceAdvice: '重新开始本节，完成一次完整的学习后这里会给出完整建议。',
        learningEvaluation: '未生成学习评价。',
        knowledgeItems: knowledgePoints.map((p) => ({
          name: p.name,
          status: p.status,
          evidence: p.status === 'mastered' ? '会话中确认掌握' : '会话中未完成确认',
        })),
        keyTakeaways: [] as string[],
        actionPlan: [] as string[],
        evaluationHighlights: null,
        metricInterpretation: {
          session: '未生成本节课堂表现。',
          longTerm: '未生成长期状态评估。',
        },
        summaryVersion: 'v2',
      },
      evaluation: null,
      progress: {
        newlyMastered: mastered,
        movedToReview: [] as string[],
        stillLearning: learning,
        unchangedMastered: [] as string[],
      },
      evidence: {
        turnCount: messages.length,
        avgUnderstanding: null,
        avgEngagement: null,
        dominantCognitiveLevel: null,
        lastCognitiveLevel: null,
        topConfusionPoints: [] as string[],
        emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
        completionCandidateSeen: false,
      },
    };

    const guarded = await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, status: 'timeout', wrapup: null },
      data: {
        wrapup: JSON.stringify(wrapup),
        ...(() => {
          // 终态清理：移除待处理检查点，避免详情接口残留
          const state = session.teachingState && typeof session.teachingState === 'object'
            ? { ...session.teachingState }
            : {};
          delete (state as Record<string, any>).pendingCheckpoint;
          const artifacts = state.sessionArtifacts && typeof state.sessionArtifacts === 'object'
            ? { ...state.sessionArtifacts }
            : {};
          delete (artifacts as Record<string, any>).pendingCheckpoint;
          state.sessionArtifacts = artifacts;
          return { teachingState: JSON.stringify(state) };
        })()
      }
    });
    if (guarded.count !== 1) {
      logger.info('[AITeaching] 兜底 wrapup 被跳过（会话已离开 timeout 或已有正式总结）', { sessionId });
      return;
    }
    logger.info('[AITeaching] 超时会话已写入兜底学习记录', { sessionId, durationMinutes });
    // 兜底收尾也要回写课内温故（18 号报告 N10）：课上作答后直接超时/放弃，
    // 温故结果此前永不落地（正常 end_only / complete_task 路径早已回写）。失败不影响兜底。
    await applyWarmupExtractionForSession(session);
  } catch (error) {
    logger.warn('[AITeaching] 超时会话兜底记录写入失败', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function processPeerMessage(
  sessionId: string,
  message: string
): Promise<{
  peerResponse: string;
  strategy: string | null;
  followUpQuestions: string[];
}> {
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session) {
    throw new Error('会话不存在或已结束');
  }
  if (session.status !== 'active' && session.status !== 'timeout') {
    throw new TeachingSessionConflictError('课堂已结束，无法继续伴学对话', 'TEACHING_SESSION_STATE_CHANGED');
  }

  // 伴学历史从已落库消息中恢复（peer 标记），不再依赖进程内 Map
  const peerHistory = session.messages
    .filter((item: any) => item.peer === true)
    .map((item: any) => ({ role: item.role, content: item.content }));

  const peerState = (session.teachingState as any)?.analysis ?? {};
  const peerResult = await executeSkill(peerAgentDefinition, {
    input: {
      topic: session.topic,
      strategy: pickPeerStrategy(peerState.cognitiveLevel),
      studentMessage: message,
      tutorContext: session.messages.slice(-6).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      cognitiveLevel: peerState.cognitiveLevel,
      understanding: peerState.understanding,
      loadIndex: peerState.loadIndex ?? null,
      emotionalState: peerState.emotionalState ?? null,
      peerHistory,
    },
    context: {
      userId: session.userId,
      sessionId: session.id,
    },
  }, {
    contextEnvelope: {
      schemaVersion: 'context-envelope/v1',
      principal: { userId: session.userId },
      session: { sessionId: session.id, taskId: session.taskId },
    },
  });

  const peerResponse = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
  const peerExt = peerResult.internal?.ext?.peer || null;
  const strategy = peerExt?.strategy || null;
  const followUpQuestions = Array.isArray(peerExt?.followUpQuestions)
    ? peerExt.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim())
    : [];
  // 伴学对话落库（带 peer 标记），页面刷新后不丢失
  const now = new Date().toISOString();
  await teachingSessionRepository.appendPeerMessages(sessionId, [
    { role: 'user', content: message, timestamp: now, peer: true },
    { role: 'assistant', content: peerResponse, timestamp: now, peer: true },
  ]);
  return { peerResponse, strategy, followUpQuestions };
}
