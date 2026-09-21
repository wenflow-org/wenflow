/**
 * 教学回合引擎（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：开场生成（generateOpening：模式决策 + LLM + 确定性兜底 + 超时护栏）与
 * 学生消息处理主回路（processStudentMessage：输入围栏 → 教学回合 LLM → 阶段推进 →
 * 检查点出题/判分挂载 → 知识增量与暖场合并 → 状态与事件落库）。
 * 两函数不触及 orchestrator 实例状态（纯数据进出 + 仓储/服务协作），按普通函数迁出；
 * facade 保留同名委托，行为与拆分前逐一等价。
 */
import { logger } from '../../utils/logger';
import { executeSkill, executeSkillWithResult, auxSkillDefinitionMap, peerAgentDefinition } from '../../skills';
import { teachingTurnAgentDefinition } from '../../skills/teaching-turn';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { teachingSessionRepository, type TeachingSessionRecord } from './TeachingSessionRepository';
import { knowledgeStateService, COMPLETION_TARGET_PROGRESS_FLOOR } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { buildTeachingScenarioContext, type TeachingScenarioContext } from './TeachingContextBuilder';
import { fenceLearnerMessagesForModel } from './input-fence';
import { memoryTraceService } from '../memory/memory-trace.service';
import { recordMisconceptions } from '../learner/misconception-ledger.service';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { parseSessionArtifacts } from './checkpoint-shared';
import {
  TeachingCheckpoint,
  checkpointForMessageResult,
  getPendingCheckpoint,
  inheritTeachingState,
  recordAnchorProbeResult,
  recordCheckpointResultEvidence,
  resolveAnchorProbeTarget,
  shouldEmitCheckpoint,
  } from './teaching-checkpoint';
import {
  extractWarmupOutcomes,
  markWarmupAsked,
  mergeWarmupOutcomes,
  pendingWarmupForModel,
  resolveTurnMemoryWarmup,
  stripWarmupPoints,
} from './teaching-warmup';
import {
  LearnStage,
  buildClassroomContext,
  buildClassroomEvent,
  buildLearnerStateContext,
  buildPathBackgroundContext,
  buildTeachingControlContext,
  deriveTeachingRuntimeSignals,
  detectEndIntent,
  determineNextStage,
  extractTeachingStateMetrics,
  withTimeout,
  withTimeoutSignal,
} from './teaching-classroom-flow';
import {
  KnowledgePointStatus,
  cloneKnowledgePoints,
  hasPrematureNextStepLanguage,
  normalizeFrozenKnowledgeState,
  normalizeKnowledgePoints,
  reconcileTeachingKnowledgeState,
} from './teaching-knowledge-state';
import { buildDeterministicOpening, pickPeerStrategy, OPENING_GENERATION_TIMEOUT_MS, COMPLETION_TURNS_BACKSTOP } from './teaching-session-views';
import type { TeachingOpening, ProcessStudentMessageOptions } from './AITeachingCoordinator';
import { normalizeTaskTypeForMetrics } from './AITeachingCoordinator';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import type { TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import type { ReplanAdvisory } from './ReplanAdvisoryService';
import {
  AI_TEACHING_AGENT_ID,
  appendTimestamp,
  buildTeachingTurnInput,
  extractPeerDebug,
  extractTeachingOutput,
  extractTeachingPromptDebug,
  requireTeachingRevision,
} from './teaching-turn-shared';

export async function generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
  const runtimeSignals = deriveTeachingRuntimeSignals(context);
  const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
    || context.taskType === 'practice'
    || runtimeSignals.confidenceLevel === 'anxious'
    ? 'example-first'
    : runtimeSignals.recentTrend === 'improving'
      && runtimeSignals.recommendedPacing !== 'slow'
      ? 'predict'
      : 'self-assess';
  let parsed: any = null;
  try {
    const result = await withTimeoutSignal(
      (signal) => executeSkillWithResult(auxSkillDefinitionMap['teaching-opening-generator'], {
        subject: context.subject,
        topic: context.topic,
        taskTitle: context.taskTitle,
        taskDescription: context.taskDescription,
        taskType: context.taskType,
        pathSummary: context.pathProgress.pathSummary,
        currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
        learner: {
          confidenceLevel: runtimeSignals.confidenceLevel,
          recentTrend: runtimeSignals.recentTrend,
          recommendedPacing: runtimeSignals.recommendedPacing,
        },
        openingMode,
        ...(context.learningSignal ? { learningSignal: context.learningSignal } : {}),
        ...(context.lastLessonRecap ? { lastLessonRecap: context.lastLessonRecap } : {}),
        ...(context.priorLearningContext ? { priorLearningContext: context.priorLearningContext } : {}),
        __prompt: {
          userId: context.userId,
          taskId: context.taskId,
          requestPath: '/services/ai-teaching/generate-opening',
          callerAgentId: AI_TEACHING_AGENT_ID,
        },
      }, { abortSignal: signal }),
      OPENING_GENERATION_TIMEOUT_MS,
      'OPENING_GENERATION_TIMEOUT'
    );
    parsed = result.success && result.output ? result.output : null;
  } catch (error) {
    // 开场生成失败：降级为确定性开场兜底，保证开课链路在模型不可用时仍可用。
    logger.warn('[AITeaching] 开场交互块生成失败，降级为确定性开场', {
      error: error instanceof Error ? error.message : String(error),
      userId: context.userId,
      taskId: context.taskId,
      topic: context.topic,
    });
    return buildDeterministicOpening(context);
  }

  if (parsed) {
    return parsed as TeachingOpening;
  }

  logger.warn('[AITeaching] 开场交互块缺少有效结构，降级为确定性开场', {
    userId: context.userId,
    taskId: context.taskId,
    topic: context.topic,
  });
  return buildDeterministicOpening(context);
}

export async function processStudentMessage(
  sessionId: string,
  message: string,
  options: ProcessStudentMessageOptions = {},
): Promise<{
  analysis: TeachingTurnOutput['analysis'];
  aiResponse: string;
  strategies: string[];
  knowledgePoint: string | null;
  knowledgePoints: KnowledgePointStatus[];
  isCompletion: boolean;
  currentState: LearningStateMetrics;
  peerTriggered: boolean;
  peerMessage?: string;
  promptDebug?: any;
  peerDebug?: any;
  shouldConfirmEnd?: boolean;
  endReason?: 'completion-candidate' | 'learner-requested-end' | null;
  autoEnded?: boolean;
  recovered?: boolean;
  checkpoint?: TeachingCheckpoint | null;
  wrapup?: SessionWrapupArtifact & {
    stateUpdate: LearningStateMetrics | null;
    duration: number;
    summarySource: 'model' | 'fallback';
    evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  };
  advisory?: ReplanAdvisory;
  revision: number;
  checkpointResolution?: {
    passed: boolean;
    understanding: number;
  };
}> {
  const operationClaim = options.operationClaim || await teachingSessionRepository.claimOperation(
    sessionId,
    options.checkpointId ? `checkpoint:${options.checkpointId}` : 'message',
    ['active', 'timeout'],
    requireTeachingRevision(options.expectedRevision)
  );
  // P2：回合期间心跳续租。操作租约已缩短到 2 分钟，教学回合可能含多次 LLM 调用跑几分钟，
  // 不续租会被并发请求误判为陈旧而抢占（进程崩溃则无人续租，最多 2 分钟自动释放）。
  const operationLeaseGuard = new TeachingOperationLeaseGuard(sessionId, operationClaim.operationId);
  operationLeaseGuard.start();
  let committed = false;

  try {
    const session = operationClaim.session;
    const recovered = session.status === 'timeout';
    if (recovered) {
      logger.info('[AITeaching] 会话超时，本轮提交时自动恢复为活跃状态', { sessionId });
    }

    const submittedCheckpoint = options.checkpointId
      ? getPendingCheckpoint(session.teachingState)
      : null;
    if (options.checkpointId && (!submittedCheckpoint || submittedCheckpoint.id !== options.checkpointId)) {
      throw new Error('理解检查不存在或已处理');
    }

    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session, options.interactionMeta);
    const endIntent = detectEndIntent(message);

  // 恢复续讲回合（resume-continue）：无学生新输入——不落库伪 user 消息，
  // 对话历史/LLM 可见输入保持纯历史，仅靠下方注入的 session-resumed 课堂事件驱动自然接续
  const isResumeContinue = options.kind === 'resume-continue';
  const updatedMessages = isResumeContinue
    ? appendTimestamp([...session.messages])
    : appendTimestamp([
        ...session.messages,
        {
          role: 'user',
          // 落库保持**学生原文**（原始证据，供人工复核/前端展示）。
          // B2/Q14 的输入围栏只作用于"喂给模型的那一份"（见下方 buildTeachingTurnInput 前的映射）。
          content: message,
          timestamp: new Date().toISOString(),
          // 检查点合成消息打标记：进入教学上下文供模型分析答案，但不参与学生行为证据统计
          ...(options.checkpointId ? { checkpoint: true } : {}),
          // 前端交互特征（认知负荷量测 · 前端情报层）：随消息落库，供后续轮次对比
          ...(options.interactionMeta && Object.keys(options.interactionMeta).length > 0
            ? { meta: options.interactionMeta as Record<string, number> }
            : {}),
        }
      ]);

  const previousTeachingState = session.teachingState || {};
  const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
  // 课内温故：计划持久化在 sessionArtifacts（开课时建立、随回合合并结果），
  // 而 context 每回合重建 → 必须回填，否则模型永远拿不到温故计划、结果也摘不到。
  const turnMemoryWarmup = resolveTurnMemoryWarmup(sessionArtifacts);
  if (turnMemoryWarmup) {
    context.memoryWarmup = turnMemoryWarmup;
  }
  const effectiveInitialKnowledgeState = cloneKnowledgePoints(
    Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
      ? sessionArtifacts.initialKnowledgeState
      : context.taskKnowledgeSeeds
  );
  const frozenKnowledgeState = normalizeFrozenKnowledgeState(
    effectiveInitialKnowledgeState,
    session.knowledgeState,
  );

  // 独立锚题探针（Q13/B4）：只在"本轮会出检查点"时才可能投放（复用检查点槽位，纪律 3）。
  // 目标由代码选定后注入本轮提示词（buildTeachingTurnInput → controls.anchorProbe），
  // 并在落库 pendingCheckpoint 时打上 purpose='anchor'（见下方检查点产生分支）。
  const anchorTarget = await resolveAnchorProbeTarget({
    userId: session.userId,
    teachingState: previousTeachingState,
    emitCheckpoint: shouldEmitCheckpoint(session, previousTeachingState),
    learnerProjection: context.learnerProjection,
    // Q8 数据供给：全量已掌握 lastSeenAt（不被 recentConceptLedger 12 条截断）
    masteredLastSeenAt: context.anchorMasteredLastSeenAt,
    messageCount: updatedMessages.length,
    now: simulatedNowOr(),
  });

  const turnInput = await buildTeachingTurnInput({
    ...session,
    // B2/Q14：喂给模型前对学习者消息做输入围栏（正常文本原样；疑似注入被打标为不可信数据）。
    // 落库消息保持原文（见上方 updatedMessages），因此这里传的是围栏后的浅拷贝。
    messages: fenceLearnerMessagesForModel(updatedMessages),
    knowledgeState: frozenKnowledgeState,
  }, context, { anchorTarget });
  // 教学回合 wall-clock 超时兜底：LLM 挂起时避免操作租约（30min）被占导致会话内所有操作 409 BUSY；
  // 超时走 releaseOperation + 客户端重试路径（revision 未递增，重试安全）。
  // 阈值对齐 platform_settings.aiReliability.defaultRequestTimeoutMs（300s）：
  // 旧值 90s 会误杀正常回合——教学回合含 2 次 LLM 调用（模拟器 + teaching-turn），上游慢时单次即可超 90s。
  const turnResult = await withTimeout(
    executeSkill(teachingTurnAgentDefinition, turnInput, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    }),
    300_000,
    'TEACHING_TURN_TIMEOUT: 教学回合执行超过 300 秒'
  );
  if (!turnResult.success) {
    throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
  }

  const turnRuntimeEnvelope = turnResult?.runtimeEnvelope || null;
  const rawTeachingOutput = extractTeachingOutput(turnResult);
  const promptDebug = extractTeachingPromptDebug(turnResult);
  // 课内温故结果回收：**首选**模型的结构化结果 control.warmupOutcomes（2026-09-17 起），
  // 兼容它仍按「计划里的原名字」写进 knowledge.points 的老行为。
  // 必须在 reconcileTeachingKnowledgeState 的 slice(0,5) 截断**之前**从原始输出里摘——
  // 模型通常把温故点排在本节点之后，先截断会直接丢掉温故结果。
  const rawPoints = Array.isArray(rawTeachingOutput?.knowledge?.points) ? rawTeachingOutput.knowledge.points : [];
  const warmupOutcomes = extractWarmupOutcomes(
    context.memoryWarmup,
    rawPoints,
    rawTeachingOutput?.control?.warmupOutcomes,
  );
  // 待回捞点数（模型看到的那份视图）：用于"该报却没报"的告警口径
  const pendingItems = pendingWarmupForModel(context.memoryWarmup)?.items.length ?? 0;
  const rawBoardOutput = rawPoints.length > 0
    ? {
        ...rawTeachingOutput,
        knowledge: { ...rawTeachingOutput.knowledge, points: stripWarmupPoints(context.memoryWarmup, rawPoints) },
      }
    : rawTeachingOutput;
  const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawBoardOutput, frozenKnowledgeState);
  // 到期旧知与本节看板物理分离（历史事故 2e3ca16：跨 path 到期点串进「本节知识点」被
  // 误显示为「进行中 · x%」，导致课内复习整体下线）：温故点只进 sessionArtifacts.memoryWarmup，
  // 收束时回写记忆引擎（FSRS 重排 dueAt + 落 learner_evidence 供动态预算回校准）。
  const mergedKnowledge = normalizeFrozenKnowledgeState(
    effectiveInitialKnowledgeState,
    knowledgeStateService.merge(
      existingPoints,
      teachingOutput.knowledge.points,
      session.mode === 'review' // 复习课允许 mastered 降级：复习失败在掌握度数据上真实可见
    )
  );
  // 收束判定锚定「冻结目标集」而非每轮合并后的膨胀集合：
  // 目标集在开课（有种子）或首个教学回合冻结，之后模型新增/改名的点不再抬高门槛；
  // 目标点达到 mastered 或进度≥阈值即视为可收束。envelope phase 仍仅作观测 soft 信号。
  const frozenTargetsBefore = parseSessionArtifacts(previousTeachingState).completionTargets;
  const targetsFrozenBefore = Array.isArray(frozenTargetsBefore) && frozenTargetsBefore.length > 0;
  const completionTargets = knowledgeStateService.resolveCompletionTargets(
    frozenTargetsBefore,
    effectiveInitialKnowledgeState,
    mergedKnowledge,
  );
  // 首回合只冻结目标集、不判完成：避免开课注入的到期复习点（retention≥阈值）
  // 在学员尚未参与任何交互时就把课判成「可收束」。
  const targetsConsolidated = targetsFrozenBefore
    && knowledgeStateService.areTargetsConsolidated(completionTargets, mergedKnowledge);
  // 兜底：回合足够多、无 pending、目标集均分达标 → 放行，保证课堂不会「永不收敛」
  const teachingTurns = session.messages.filter((message) => message.role === 'assistant').length;
  const backstopReady = targetsFrozenBefore
    && teachingTurns >= COMPLETION_TURNS_BACKSTOP
    && mergedKnowledge.every((point) => point.status !== 'pending')
    && knowledgeStateService.averageTargetProgress(completionTargets, mergedKnowledge) >= COMPLETION_TARGET_PROGRESS_FLOOR;
  const completionReady = targetsConsolidated || backstopReady;
  const envelopeCompletionSignal =
    turnRuntimeEnvelope?.businessState?.phase === 'completion-candidate'
    || turnRuntimeEnvelope?.businessState?.isTerminal === true;
  // soft-AND：双方都同意完成时记 alignment=agree；仅 envelope 喊完成时 disagree（不改变硬门禁）
  const completionAlignment: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither' =
    completionReady && envelopeCompletionSignal
      ? 'agree'
      : !completionReady && envelopeCompletionSignal
        ? 'envelope-only'
        : completionReady && !envelopeCompletionSignal
          ? 'knowledge-only'
          : 'neither';
  if (completionAlignment === 'envelope-only' || completionAlignment === 'knowledge-only') {
    logger.debug('[AITeaching] completion soft-AND 分歧', {
      sessionId: session.id,
      completionAlignment,
      knowledgeComplete: completionReady,
      envelopePhase: turnRuntimeEnvelope?.businessState?.phase || null,
      envelopeTerminal: turnRuntimeEnvelope?.businessState?.isTerminal === true,
    });
  }
  const effectiveTeachingOutput: TeachingTurnOutput = {
    ...teachingOutput,
    control: {
      ...teachingOutput.control,
      isCompletionCandidate: completionReady,
    },
  };
  const previousClassroomStage = (previousTeachingState.classroomContext?.stage?.current as LearnStage) || 'opening';
  // 恢复续讲首回合不触发伴学（无学生新输入，伴学模拟"同学插话"无意义）
  const peerTriggered = !isResumeContinue && peerTriggerService.shouldTrigger(session, teachingOutput, message);
  // 恢复续讲无学生输入：后续所有 learnerMessage 语义统一为空，避免 teaching-turn 把伪输入当本轮反馈
  const effectiveLearnerMessage = isResumeContinue ? '' : message;
  let peerMessage: string | undefined;
  let peerStrategy: string | null = null;
  let peerFollowUpQuestions: string[] = [];
  let peerDebug: any = null;
  let peerRuntimeEnvelope: any = null;

  if (peerTriggered) {
    const peerInput = {
      topic: session.topic,
      // 策略由代码按认知层级选定（prompt 规则 38 只负责"怎么说"）：
      // 此前硬编码 'feynman'，使「understand→类比 / apply→反例 / analyze+→辩论」永不触发（§3.19 P0②）。
      strategy: pickPeerStrategy(teachingOutput.analysis.cognitiveLevel),
      studentMessage: message,
      tutorContext: updatedMessages.slice(-6).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      cognitiveLevel: teachingOutput.analysis.cognitiveLevel,
      understanding: teachingOutput.analysis.understanding,
      // 规则 41 的"高负荷/受挫"分支需要这两个字段才可达（此前未提供）
      loadIndex: teachingOutput.analysis.loadIndex ?? null,
      emotionalState: teachingOutput.analysis.emotionalState ?? null,
    };
    try {
      const peerResult = await executeSkill(peerAgentDefinition, {
        input: peerInput,
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
      peerMessage = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
      // 伴学策略与后续追问一并透传（供前端展示「正在用什么学法」与快选追问）
      const peerExt = peerResult.internal?.ext?.peer || null;
      peerStrategy = peerExt?.strategy || null;
      peerFollowUpQuestions = Array.isArray(peerExt?.followUpQuestions)
        ? peerExt.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim())
        : [];
      peerDebug = extractPeerDebug(peerResult);
      peerRuntimeEnvelope = peerResult?.runtimeEnvelope
        || peerResult?.internal?.ext?.peer?.runtimeEnvelope
        || null;
    } catch (e: any) {
      logger.warn('[AITeachingCoordinator] peer-reinforcement 失败', { error: e?.message || String(e) });
    }
  }

  const nextStageDecision = determineNextStage({
    currentStage: previousClassroomStage,
    teachingOutput: effectiveTeachingOutput,
    peerTriggered,
    learnerMessage: effectiveLearnerMessage,
    taskMode: context.taskMode,
    frustratedStreak: previousTeachingState?.learnerStateContext?.frustratedStreak ?? 0,
  });
  const learnerStateContext = buildLearnerStateContext(context, previousTeachingState, {
    ...teachingOutput.analysis,
    struggleDetected: nextStageDecision.stage === 'intervention',
  });
  learnerStateContext.struggleDetected = nextStageDecision.stage === 'intervention';

  const classroomContext = buildClassroomContext({
    previousState: previousTeachingState,
    stage: nextStageDecision.stage,
    stageReason: nextStageDecision.reason,
    teachingOutput: effectiveTeachingOutput,
    learnerMessage: effectiveLearnerMessage,
    context,
    knowledgeState: mergedKnowledge,
    learnerStateContext,
    peerTriggered,
    peerMessage,
  });

  const classroomEvents = Array.isArray(previousTeachingState.classroomEventHistory)
    ? [...previousTeachingState.classroomEventHistory]
    : [];

  classroomEvents.push(buildClassroomEvent('teaching-turn', nextStageDecision.reason, {
    stage: nextStageDecision.stage,
    focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
    learnerMessage: effectiveLearnerMessage,
    confusionPoints: learnerStateContext.currentConfusionPoints || [],
    peerTriggered,
    endIntent: endIntent.isEndIntent,
  }));

  if (endIntent.isEndIntent) {
    classroomEvents.push(buildClassroomEvent('end-intent', endIntent.reason, {
      learnerMessage: effectiveLearnerMessage,
    }));
  }

  if (peerTriggered) {
    classroomEvents.push(buildClassroomEvent('peer-support', '本轮触发伴学支持', {
      peerMessage: peerMessage || null,
    }));
  }

  if (completionReady) {
    classroomEvents.push(buildClassroomEvent('completion-candidate', '本轮出现课堂完成候选信号', {
      focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
    }));
  }

  // 恢复续讲信号：teaching-turn 看到该事件即知本轮无学生新输入，需自然接续上一轮推进
  if (isResumeContinue) {
    classroomEvents.push(buildClassroomEvent('session-resumed', '学生刚刚恢复本课堂会话，无新输入', {
      instruction: '自然地接续上一轮的教学推进：先一句话承接上次进度，再继续当前焦点知识点。不要询问"你想做什么/从哪继续"，不要重新自我介绍或重复开场。',
    }));
  }

  const stageHistory = Array.isArray(previousTeachingState.stageHistory)
    ? [...previousTeachingState.stageHistory]
    : [];
  const lastStage = stageHistory[stageHistory.length - 1];
  if (!lastStage || lastStage.stage !== nextStageDecision.stage) {
    stageHistory.push({
      stage: nextStageDecision.stage,
      reason: nextStageDecision.reason,
      enteredAt: new Date().toISOString(),
    });
  }

  const teachingControlContext = buildTeachingControlContext(
    nextStageDecision.stage,
    context,
    learnerStateContext,
    {
      ...sessionArtifacts,
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end'
        : completionReady
          ? 'completion-candidate'
          : sessionArtifacts.endReason,
    },
  );

  const learnDebug = {
    input: {
      pathBackgroundContext: buildPathBackgroundContext(context),
      classroomContext,
      learnerStateContext,
      classroomEventContext: {
        recentEvents: classroomEvents.slice(-5),
      },
      visibleDialogueContext: session.messages.map((item) => ({
        role: item.role,
        content: item.content,
      })).concat(isResumeContinue ? [] : [{ role: 'user', content: message }]),
      teachingControlContext,
    },
    output: {
      stageDecision: nextStageDecision,
      classroomContext,
      learnerStateContext,
      knowledgeState: normalizeKnowledgePoints(mergedKnowledge),
      auxiliaryActions: {
        peerTriggered,
        completionCandidate: completionReady,
        autoEndRequested: endIntent.isEndIntent,
      },
      completionCandidateEvidence: teachingOutput.control.completionCandidateEvidence || null,
    },
  };

  if (promptDebug && typeof promptDebug === 'object') {
    promptDebug.learnDebug = learnDebug;
  }

  const assistantMessage: TeachingSessionMessage = {
    role: 'assistant',
    content: teachingOutput.reply,
    timestamp: new Date().toISOString(),
    analysis: teachingOutput.analysis,
    strategies: teachingOutput.pedagogy.strategies,
    knowledgePoint: teachingOutput.knowledge.currentPoint,
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    promptDebug,
    peerTriggered,
    peerMessage: peerMessage || null,
    peerStrategy,
    peerFollowUpQuestions,
    peerDebug,
  };

  if (!completionReady && hasPrematureNextStepLanguage(assistantMessage.content)) {
    logger.warn('[AITeaching] 教学回复越界，尚未满足结束条件却提到下一环节', {
      sessionId,
      taskId: session.taskId,
      reply: assistantMessage.content,
    });
  }

  const persistedMessages = [...updatedMessages, assistantMessage];
  const previousMetrics = extractTeachingStateMetrics(previousTeachingState)
    || learningStateService.coerceMetrics(context.learningState)
    || null;
  
  // 将扩展的 taskType 映射到基础的 4 种类型
  const normalizedTaskType = normalizeTaskTypeForMetrics(context.taskType);
  
  const currentState = learningStateService.calculateRuntimeState(previousMetrics, {
    difficulty: Math.max(1, Math.min(10, teachingOutput.analysis.levelScore + 2)),
    cognitiveLoad: Math.max(1, Math.min(10, (1 - teachingOutput.analysis.understanding + 0.3) * 8)),
    efficiency: teachingOutput.analysis.engagement,
    timeSpent: 1,
    expectedTime: 15,
    completionRate: 1,
    taskType: normalizedTaskType,
  });

    const turnState: Record<string, any> = {
    ...currentState,
    analysis: effectiveTeachingOutput.analysis,
    strategies: effectiveTeachingOutput.pedagogy.strategies,
    completionCandidate: completionReady,
    peerTriggered,
    learnerStateContext,
    classroomContext,
    classroomEventHistory: classroomEvents.slice(-40),
    stageHistory,
    teachingControlContext,
    lastRuntimeEnvelope: turnRuntimeEnvelope,
    lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
    envelopeCompletionSignal: !!envelopeCompletionSignal,
    completionAlignment,
    lastPeerRuntimeEnvelope: peerRuntimeEnvelope,
    sessionArtifacts: {
      ...parseSessionArtifacts(session.teachingState),
      initialKnowledgeState: effectiveInitialKnowledgeState,
      // 课内温故：① 标记"模型真的问出来了"（含 review/pending——问过 ≠ 有结果）
      // ② 合并实测结果；计划其余部分原样保留（含负担预算与积压计数）
      ...(() => {
        const persistedPlan =
          parseSessionArtifacts(session.teachingState).memoryWarmup || context.memoryWarmup;
        if (!persistedPlan) return {};
        const asked = markWarmupAsked(persistedPlan, rawPoints, new Date().toISOString());
        const merged = warmupOutcomes.length > 0
          ? mergeWarmupOutcomes(asked, warmupOutcomes, new Date().toISOString())
          : asked;
        // 采样率可观测（2026-09-17）：结构化通道是温故结果的唯一可靠来源，
        // 因此"模型报了几条 / 代码落地几条 / 丢弃几条"必须留痕——否则丢样本只能靠事后猜。
        if (Array.isArray(rawTeachingOutput?.control?.warmupOutcomes) && rawTeachingOutput.control.warmupOutcomes.length > 0) {
          const reported = rawTeachingOutput.control.warmupOutcomes.length;
          const settled = (merged?.items || []).filter((item) => item?.outcome?.status).length;
          logger.info('[AITeaching] 温故结构化结果', {
            sessionId,
            reported,
            extracted: warmupOutcomes.length,
            settled,
            dropped: reported - warmupOutcomes.length,
            recalls: rawTeachingOutput.control.warmupOutcomes.map((entry: any) => entry?.recall ?? null),
          });
        } else if (pendingItems > 0) {
          // 有待回捞点却没报结构化结果 → 可能是"这轮刚问、学生还没答"（正常），也可能是真丢样本。
          // 只在**学生确有机会作答**时告警：该点此前已被问过（askedAt）且其后有学生发言。
          const askedEarlier = (persistedPlan.items || []).filter((item) => item?.askedAt && !item?.outcome?.status);
          const hadAnswerChance = askedEarlier.some((item) => (session.messages || []).some((message) => {
            if (message?.role !== 'user') return false;
            const at = Date.parse(String(message.timestamp || ''));
            return Number.isFinite(at) && at > Date.parse(String(item.askedAt));
          }));
          if (hadAnswerChance) {
            logger.warn('[AITeaching] 学生已作答但模型未报 control.warmupOutcomes（温故结果丢失）', {
              sessionId,
              pendingItems,
            });
          }
        }
        return merged ? { memoryWarmup: merged } : {};
      })(),
      // 冻结的收束目标集：只增一次，后续回合沿用（防止目标集随模型新增/改名膨胀）
      completionTargets,
      pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(context),
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end'
        : completionReady
          ? 'completion-candidate'
          : parseSessionArtifacts(session.teachingState).endReason,
    },
    };
    // 继承上一回合顶层状态后再覆盖本回合字段：否则 pendingCheckpoint / lastCheckpointTurn /
    // checkpointHistory 会在每次重建时丢失（18 号报告 N2）。
    const teachingState: Record<string, any> = inheritTeachingState(previousTeachingState, turnState);

    // 检查点产生：teaching-turn 可选输出 control.checkpoint，按规则落库为 pendingCheckpoint
    const checkpointCandidate = teachingOutput.control.checkpoint;
    if (
      !submittedCheckpoint
      && !completionReady
      && !endIntent.isEndIntent
      && checkpointCandidate
      && !previousTeachingState.pendingCheckpoint
      && (previousTeachingState.lastCheckpointTurn === undefined
        || updatedMessages.length - previousTeachingState.lastCheckpointTurn >= 4)
    ) {
      const checkpointTitle = checkpointCandidate.question.length > 20
        ? `${checkpointCandidate.question.slice(0, 20)}…`
        : checkpointCandidate.question;
      teachingState.pendingCheckpoint = {
        id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: checkpointCandidate.type,
        title: checkpointTitle,
        question: checkpointCandidate.question,
        ...(checkpointCandidate.options ? { options: checkpointCandidate.options } : {}),
        allowSkip: true,
        ...(checkpointCandidate.hint ? { contextHint: checkpointCandidate.hint } : {}),
        // 答案键（服务端保存，客户端投影会剥离）：用于代码裁决，保证"对错"不来自模型自评
        ...(checkpointCandidate.correctOptionIds?.length ? { correctOptionIds: checkpointCandidate.correctOptionIds } : {}),
        ...(checkpointCandidate.expectedKeywords?.length ? { expectedKeywords: checkpointCandidate.expectedKeywords } : {}),
        // 锚题标记（Q13/B4 独立证伪；Q8 延迟保持率复测）：本轮由代码选定锚题目标时打标，
        // 随 inheritTeachingState 跨回合继承；不含答案键，因此 stripCheckpointAnswerKeys 会原样保留
        ...(anchorTarget
          ? {
              purpose: 'anchor' as const,
              anchorConceptKey: anchorTarget.conceptKey,
              anchorExpectedBelief: anchorTarget.expected,
              anchorKind: anchorTarget.kind ?? 'independent',
              ...(anchorTarget.kind === 'delayed' && Number.isFinite(anchorTarget.intervalDays)
                ? { anchorIntervalDays: anchorTarget.intervalDays as number }
                : {}),
            }
          : {}),
      };
      teachingState.lastCheckpointTurn = updatedMessages.length;
    }

    let checkpointResolution: { passed: boolean; understanding: number; judgedBy: 'code' | 'model-reference' } | undefined;
    if (submittedCheckpoint) {
      const understanding = Number(teachingOutput.analysis?.understanding ?? 0);
      const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
      const modelDerivedPassed = completionReady || !!currentPoint && mergedKnowledge.some(
        (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
      );
      // 独立传感器优先（2026-09-17）：有答案键就按**代码裁决**，否则退回模型派生并如实标注来源
      const codeJudgement = options.checkpointJudgement ?? null;
      const judgedBy: 'code' | 'model-reference' = codeJudgement?.judgedBy === 'code' ? 'code' : 'model-reference';
      const passed = judgedBy === 'code' ? codeJudgement!.passed : modelDerivedPassed;
      const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
        ? [...teachingState.checkpointHistory]
        : [];
      checkpointHistory.push({
        checkpointId: submittedCheckpoint.id,
        // title/type 一并留档（2026-09-17）：此前只记 id/passed，读侧无法知道"没通过的是什么题"
        title: submittedCheckpoint.title,
        type: submittedCheckpoint.type,
        submittedAt: new Date().toISOString(),
        passed,
        judgedBy,
        understanding,
      });

      // 检查点结果留痕（learner_evidence）：独立传感器的原始观测，供 §7 P1-1 的成功率带与控制律消费
      void recordCheckpointResultEvidence(session, submittedCheckpoint, {
        passed,
        judgedBy,
        detail: codeJudgement?.detail ?? null,
        submission: { selectedOptionIds: options.checkpointSubmission?.selectedOptionIds },
      });

      // 独立锚题探针（Q13/B4）：仅对带 purpose='anchor' 的检查点、且**代码裁决**（纪律 1）时
      // 另写一行 anchor:result 作为"待复核"信号；只标记、不改写掌握/难度/BKT（纪律 2）。
      if (submittedCheckpoint.purpose === 'anchor' && judgedBy === 'code') {
        void recordAnchorProbeResult(session, submittedCheckpoint, passed);
      }

      // 仅答对时消费检查点；答错保留 pendingCheckpoint（同一 cpId 可重答，
      // 前端答错反馈后再次提交不会落入「理解检查不存在或已处理」）
      if (passed) {
        delete teachingState.pendingCheckpoint;
        const nextSessionArtifacts = { ...parseSessionArtifacts(teachingState) };
        delete nextSessionArtifacts.pendingCheckpoint;
        teachingState.sessionArtifacts = nextSessionArtifacts;
      }
      teachingState.checkpointHistory = checkpointHistory.slice(-20);
      checkpointResolution = { passed, understanding, judgedBy };
    }

    await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
      messages: persistedMessages,
      messagesBaseCount: operationClaim.messagesBaseCount,
      knowledgeState: mergedKnowledge,
      teachingState,
      taskId: session.taskId,
      userId: session.userId,
      markTaskInProgress: true,
    });
    committed = true;

    // 误解台账（G-R-R Phase 2）：异步记录本轮结构化误解，best-effort 不阻断回合
    const misconceptions = teachingOutput.analysis?.misconceptions;
    if (Array.isArray(misconceptions) && misconceptions.length > 0) {
      void recordMisconceptions(session.userId, sessionId, misconceptions.map((m) => ({
        conceptKey: m.conceptKey || '',
        hypothesis: m.hypothesis,
        canonicalLabel: m.canonicalLabel ?? null,
        confidence: m.confidence,
        evidence: m.evidence,
        status: m.status,
      })).filter((m) => m.conceptKey && m.hypothesis));
    }

    // θ−d EMA：ktEstimate 跨会话滑动平均（α=0.2），best-effort 不阻断回合
    const ktConceptMastery = teachingOutput.analysis?.ktEstimate?.conceptMastery;
    if (Array.isArray(ktConceptMastery) && ktConceptMastery.length > 0) {
      void memoryTraceService.applyKtEstimate(session.userId, ktConceptMastery.map((c) => ({
        conceptKey: c.conceptKey,
        mastery: c.mastery,
      })), session.learningPathId ?? null).catch((error) => {
        logger.warn('[AITeachingCoordinator] ktEstimate EMA 回写失败', { error: error instanceof Error ? error.message : String(error) });
      });
    }

    const baseResult = {
    analysis: teachingOutput.analysis,
    aiResponse: teachingOutput.reply,
    strategies: effectiveTeachingOutput.pedagogy.strategies,
    knowledgePoint: effectiveTeachingOutput.knowledge.currentPoint,
    ...(effectiveTeachingOutput.knowledge.confirmCheck
      ? { confirmCheck: effectiveTeachingOutput.knowledge.confirmCheck }
      : {}),
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    isCompletion: completionReady,
    currentState,
    peerTriggered,
    peerMessage,
    peerStrategy,
    peerFollowUpQuestions,
    promptDebug,
    peerDebug,
    // 统一运行契约观测（不改变 isCompletion 硬门禁）
    runtimeEnvelope: turnRuntimeEnvelope,
    completionAlignment,
    envelopeCompletionSignal: !!envelopeCompletionSignal,
    lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
    shouldConfirmEnd: completionReady || endIntent.isEndIntent,
    endReason: endIntent.isEndIntent
      ? 'learner-requested-end' as const
      : completionReady
        ? 'completion-candidate' as const
        : null,
    recovered,
      checkpoint: checkpointForMessageResult(teachingState),
      checkpointResolution,
      revision: session.revision + 1,
    };

    return baseResult;
  } finally {
    operationLeaseGuard.stop();
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}
