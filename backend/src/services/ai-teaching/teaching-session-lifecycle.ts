/**
 * 教学会话生命周期域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：开课（startSession：场景构建 + 短租约 + 开场生成 + 首条消息/知识态落库）、
 * 结课（endSession：终局化租约 + wrapup LLM + 证据/复盘/收尾服务编排 + 会话证据落库）、
 * 任务难度锚点记录（recordTaskDifficultyAnchor）与 FSRS 可提取性提示读取
 * （loadRetrievabilityHints）；随迁会话域小工具（sessionId/请求幂等键/开场场景构建/
 * replan 归因证据）与 RECOVERY_WINDOW_MS 常量。自 AITeachingCoordinator 迁出，
 * 行为不变；coordinator re-export 维持既有 import 路径。
 */
import { createHash, randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { executeSkill, sessionWrapupAgentDefinition } from '../../skills';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';
import type { ReviewPlan } from '../memory/review-plan.service';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { FinalizationLeaseGuard } from './FinalizationLeaseGuard';
import { classifyFinalizationError } from './FinalizationErrors';
import { hasReliableSessionEvaluation, mergeFinalTeachingState } from './SessionFinalizationPolicy';
import {
  aggregateSessionEvaluationFromMessages,
  buildSessionEvaluationShadow,
} from '../learning/session-evaluation-aggregate';
import { isCalibratableDirection, replanAttributionService, type ReplanAttributionEvidence } from './ReplanAttributionService';
import { replanAdvisoryService, toAttributionRecall, type ReplanAdvisory } from './ReplanAdvisoryService';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { teachingSessionRepository, TeachingSessionConflictError, type TeachingSessionRecord, type TeachingSessionMessage } from './TeachingSessionRepository';
import { runWithTeachingSession } from './teaching-session-context';
import { buildTeachingScenarioContext, type TeachingScenarioContext } from './TeachingContextBuilder';
import { parseSessionArtifacts } from './checkpoint-shared';
import {
  buildClassroomEvent,
  buildLearnerStateContext,
  buildPathBackgroundContext,
  buildTeachingControlContext,
  buildTeachingStateWithArtifacts,
  deriveTeachingRuntimeSignals,
  initialClassroomStage,
} from './teaching-classroom-flow';
import {
  KnowledgePointStatus,
  cloneKnowledgePoints,
  computeKnowledgeDelta,
  normalizeFrozenKnowledgeState,
  normalizeKnowledgePoints,
} from './teaching-knowledge-state';
import {
  buildEndWrapupFallback,
  buildRecoveredOpening,
  commitSessionLoadMetric,
  computeEffectiveDurationMinutes,
  computeSessionEvidence,
} from './teaching-session-views';
import { generateOpening } from './teaching-turn-engine';
import { AI_TEACHING_AGENT_ID, requireTeachingRevision } from './teaching-turn-shared';
import { conceptConsolidatorService } from '../learner/ConceptConsolidatorService';
import { conceptLoadService } from '../memory/concept-load.service';
import { fsrsRetrievability, type FsrsMemoryState } from '../memory/fsrs';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import { insightCalibrationService } from '../learner/insight-calibration.service';
import { learnerExitService } from '../learner/LearnerExitService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { learnerSnapshotService } from '../learner/LearnerSnapshotService';
import { learnerStateReviewService } from '../learner/LearnerStateReviewService';
import { recordTaskDifficultyAdjustment } from '../learner/TaskDifficultyAdjustmentLedger';
import { memoryTraceService } from '../memory/memory-trace.service';
import { reviewQuotaService } from '../memory/review-quota.service';
import { reviewPlanService } from '../memory/review-plan.service';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import type {
  SessionOpeningScene,
  SessionResumeMode,
  TeachingOpening,
  TeachingSessionStartInput,
} from './AITeachingCoordinator';

export function buildSessionOpeningScene(opts: {
  mode: SessionResumeMode;
  review?: boolean;
  context: TeachingScenarioContext;
  sameTaskAttempt?: number;
}): SessionOpeningScene {
  const { mode, review, context, sameTaskAttempt } = opts;
  const prior = context.priorLearningContext;
  const recap = context.lastLessonRecap;
  if (review) {
    return {
      kind: 'review',
      title: '今日复习 · 回捞快忘的知识点',
      recap: recap ? {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      } : null,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  if (mode === 'resumed') {
    return {
      kind: 'resume',
      title: '继续这节课 · 从上次离开的地方接着学',
      recap: recap ? {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      } : null,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  // mode === 'new'：区分首课 / 同任务重学 / 第二课接续
  if (sameTaskAttempt && sameTaskAttempt >= 2) {
    return {
      kind: 'relearn',
      title: '重新学这一课 · 上次没完全掌握的这次补上',
      recap: recap && recap.relation === 'same-task' ? {
        topic: recap.sourceTopic,
        summary: recap.sameTaskHistory?.lastSummary || recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: context.taskTitle,
      } : null,
      attempt: sameTaskAttempt,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  const hasAdjacent = recap && (recap.relation === 'same-milestone-prev-task' || recap.relation === 'prev-milestone');
  if (hasAdjacent) {
    return {
      kind: 'continuation',
      title: '接着上一课往下学',
      recap: {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      },
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  return { kind: 'first', title: '开始这节课', mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [] };
}

export const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

export function buildSessionId(userId: string) {
  return `teaching_${userId}_${randomUUID()}`;
}

export function buildEndSessionRequestIdentity(endReason: string) {
  const requestJson = JSON.stringify({ action: 'end_only', endReason });
  return {
    requestJson,
    requestHash: createHash('sha256').update(requestJson).digest('hex')
  };
}

/**
 * 归因证据（有界、带稳定 id 供模型引用）：本课复盘要点 + 状态信号 + 不稳定概念名单。
 * 只给"事实"，不给结论——结论是归因层要产出的东西。
 */
export function buildReplanAttributionEvidence(input: {
  wrapup: SessionWrapupArtifact;
  learnerReplanProjection: any;
  nextMilestoneTitle?: string | null;
}): ReplanAttributionEvidence[] {
  const { wrapup, learnerReplanProjection, nextMilestoneTitle } = input;
  const evidence: ReplanAttributionEvidence[] = [];
  const push = (id: string, kind: string, text: string) => {
    const trimmed = String(text || '').trim();
    if (trimmed) evidence.push({ id, kind, text: trimmed.slice(0, 120) });
  };

  const topicSummary = (wrapup as any)?.summary?.topicSummary ?? (wrapup as any)?.topicSummary;
  push('wrapup:summary', 'session_summary', String(topicSummary || ''));
  const unresolved = Array.isArray((wrapup as any)?.progress?.stillLearning)
    ? (wrapup as any).progress.stillLearning
    : [];
  push('wrapup:still-learning', 'still_learning', unresolved.slice(0, 4).join('、'));
  const confusions = Array.isArray((wrapup as any)?.evidence?.topConfusionPoints)
    ? (wrapup as any).evidence.topConfusionPoints
    : [];
  push('wrapup:confusions', 'confusions', confusions.slice(0, 4).join('、'));
  const movedToReview = Array.isArray((wrapup as any)?.progress?.movedToReview)
    ? (wrapup as any).progress.movedToReview
    : [];
  push('wrapup:moved-to-review', 'moved_to_review', movedToReview.slice(0, 4).join('、'));

  const evaluation = (wrapup as any)?.evaluation;
  if (evaluation) {
    push('signal:metrics', 'session_metrics',
      `sessionKtl=${evaluation.sessionKtl ?? '—'} sessionLss=${evaluation.sessionLss ?? '—'} sessionLf=${evaluation.sessionLf ?? '—'}`);
  }
  push('signal:trend', 'recent_trend', String(learnerReplanProjection?.dynamicState?.recentTrend || ''));
  push('signal:fragile', 'fragile_concepts',
    (learnerReplanProjection?.mastery?.fragileConcepts ?? []).slice(0, 6).join('、'));
  push('signal:struggling', 'struggling_concepts',
    (learnerReplanProjection?.mastery?.strugglingConcepts ?? []).slice(0, 6).join('、'));
  push('signal:gaps', 'prerequisite_gaps',
    (learnerReplanProjection?.risk?.prerequisiteGaps ?? []).slice(0, 4).map((gap: any) => `${gap.label}( ${gap.severity} )`).join('、'));
  push('path:next-milestone', 'next_milestone', String(nextMilestoneTitle || ''));
  return evidence;
}

export async function recordTaskDifficultyAnchor(
  context: TeachingScenarioContext,
  sessionId: string,
): Promise<void> {
  const decision = context.learnerProjection?.taskDifficulty;
  if (!decision || !Array.isArray(decision.reasons) || decision.reasons.length === 0) return;
  try {
    await recordTaskDifficultyAdjustment({
      userId: context.userId,
      taskId: context.taskId,
      pathId: context.learningPathId ?? null,
      milestoneId: context.milestoneId ?? null,
      sessionId,
      occurredAt: simulatedNowOr(),
      baseline: decision.baseline,
      adjusted: decision.adjusted,
      direction: decision.direction,
      reasons: decision.reasons,
      applied: decision.adjusted !== decision.baseline,
      evidence: {
        ...decision.evidence,
        delta: decision.delta,
        cap: decision.cap,
        capSource: decision.capSource,
        // 投影层不带 capApplied，这里按同一口径复算（是否被上限封住）
        capBound: decision.adjusted === decision.cap,
        deliveryMode: 'prompt-injection',
        hasRandomizedControl: false,
      } as unknown as Record<string, unknown>,
    });
  } catch (error) {
    logger.warn('[AITeaching] 难度锚点留痕失败（不阻断开课）', {
      userId: context.userId,
      taskId: context.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startSession(input: TeachingSessionStartInput): Promise<{
  sessionId: string;
  subject: string;
  topic: string;
  startTime: Date;
  welcomeMessage: string;
  opening: TeachingOpening;
  knowledgePoints: KnowledgePointStatus[];
  mode: SessionResumeMode;
  revision: number;
  /** 课内温故计划（记忆层）：日常课开场回捞的到期旧知；无到期点或复习课为 null */
  memoryWarmup?: ReviewPlan | null;
  scene?: SessionOpeningScene;
}> {
  const context = await buildTeachingScenarioContext(input.userId, input.taskId, null);
  // 当前任务的历史完结次数（判断「同任务重学」，供开场卡 scene.kind = relearn）
  let sameTaskAttempt = 0;
  try {
    sameTaskAttempt = await prisma.teaching_sessions.count({
      where: {
        userId: input.userId,
        taskId: input.taskId,
        status: { in: ['completed', 'discarded'] },
      },
    });
  } catch { /* 统计失败不阻断 */ }
  const seededKnowledgeState = cloneKnowledgePoints(context.taskKnowledgeSeeds);
  // 复习课模式：knowledgeState 种子 = 任务种子 + 到期复习点（全部注入，非 limit 2）
  if (input.mode === 'review') {
    try {
      const dueTraces = await learnerExitService.getDueReview(input.userId, 20);
      const existingKeys = new Set(seededKnowledgeState.map((point) => point.name));
      for (const trace of dueTraces) {
        if (existingKeys.has(trace.conceptKey)) continue;
        seededKnowledgeState.push({
          name: trace.conceptKey,
          status: 'review',
          progress: Math.round(trace.retention * 100),
        });
        existingKeys.add(trace.conceptKey);
      }
    } catch (error) {
      logger.warn('[AITeaching] 复习课到期点注入失败，使用任务种子', {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // 分层边界：到期旧知属「记忆层」（用户级、天然跨 path），只在该课复习模式（上方 mode==='review'）
  // 或 GET /ai-teaching/review/due「今日复习」出口呈现；不再注入日常课的「本节知识点」看板，
  // 否则别的 path 的到期点会串进本节清单，并被前端误显示为「进行中 · x%」。
  const sessionId = buildSessionId(input.userId);
  // 课内温故（记忆层 · 认知负担动态调整）：日常课在**本节开头**花 1–2 分钟回捞到期旧知，
  // 而不是让用户额外开一节复习课（依从性：复习不该需要用户做决定）。
  // 配额按负担预算动态裁剪（由课内检索成功率回校准）；复习课模式已在上面走到期点注入，不叠加。
  let memoryWarmup: ReviewPlan | null = null;
  if (input.mode !== 'review') {
    try {
      // 范围口径（只当前路径）：温故只回捞本节所属路径的旧知（历史行无来源路径时仍可复习）
      const plan = await reviewPlanService.buildReviewPlan(input.userId, {
        pathId: context.learningPathId ?? null,
      });
      if (plan.items.length > 0) {
        memoryWarmup = plan;
        context.memoryWarmup = plan;
      }
    } catch (error) {
      logger.warn('[AITeaching] 课内温故计划生成失败，本节不温故（不阻断开课）', {
        userId: input.userId,
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      memoryWarmup = null;
    }
  }
  const reservation = await teachingSessionRepository.reserve({
    id: sessionId,
    userId: input.userId,
    taskId: context.taskId,
    learningPathId: context.learningPathId,
    milestoneId: context.milestoneId,
    subject: context.subject,
    topic: context.topic,
    taskType: context.taskType,
    mode: input.mode || 'tutor',
    messages: [],
    knowledgeState: seededKnowledgeState,
    teachingState: memoryWarmup ? { sessionArtifacts: { memoryWarmup } } : null,
  }, RECOVERY_WINDOW_MS);

  // 当日温故额度记账（跨会话共享：一天多节课不会把温故量放大；超额部分顺延到明天）。
  // fire-and-forget：记账失败只 warn，不阻断开课。
  if (reservation.created && memoryWarmup && memoryWarmup.items.length > 0) {
    void reviewQuotaService
      .reserveDailyQuota(input.userId, {
        sessionId: reservation.session.id,
        load: memoryWarmup.usedLoad,
        keys: memoryWarmup.items.map((item) => item.conceptKey),
      })
      .catch(() => null);
  }

  if (!reservation.created) {
    if (reservation.session.status === 'initializing' || reservation.session.status === 'finalizing') {
      throw new TeachingSessionConflictError('课堂正在启动或结束，请稍后重试', 'TEACHING_SESSION_BUSY');
    }

    const claim = await teachingSessionRepository.claimOperation(
      reservation.session.id,
      'resume',
      ['active', 'paused', 'timeout']
    );
    // P2：恢复分支同样要跑 LLM 上下文构建，短租期内必须续租
    const resumeLeaseGuard = new TeachingOperationLeaseGuard(reservation.session.id, claim.operationId);
    resumeLeaseGuard.start();
    let committed = false;
    try {
      const previousSession = claim.session;
      const sessionArtifacts = parseSessionArtifacts(previousSession.teachingState);
      const resumedContext = await buildTeachingScenarioContext(input.userId, input.taskId, previousSession);
      const effectiveInitialKnowledgeState = cloneKnowledgePoints(
        Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
          ? sessionArtifacts.initialKnowledgeState
          : resumedContext.taskKnowledgeSeeds
      );
      const resumedKnowledgeState = normalizeFrozenKnowledgeState(
        effectiveInitialKnowledgeState,
        previousSession.knowledgeState,
      );
      const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
        ? new Date(sessionArtifacts.pausedAt).getTime()
        : null;
      const additionalPausedMs = wasPausedAt ? Math.max(0, Date.now() - wasPausedAt) : 0;
      const resumedTeachingState = buildTeachingStateWithArtifacts(previousSession.teachingState, {
        ...sessionArtifacts,
        initialKnowledgeState: effectiveInitialKnowledgeState,
        pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(resumedContext),
        pausedAt: null,
        pauseReason: null,
        pausedDurationMs: Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0)) + additionalPausedMs,
        resumedAt: new Date().toISOString(),
      });

      await teachingSessionRepository.commitTurnState(previousSession.id, claim.operationId, {
        messages: previousSession.messages,
        messagesBaseCount: claim.messagesBaseCount,
        knowledgeState: resumedKnowledgeState,
        teachingState: resumedTeachingState,
        allowedStatuses: ['active', 'paused', 'timeout']
      });
      committed = true;

      const opening = buildRecoveredOpening(previousSession);
      return {
        sessionId: previousSession.id,
        subject: previousSession.subject,
        topic: previousSession.topic,
        startTime: previousSession.startTime,
        welcomeMessage: previousSession.messages[0]?.content || `${opening.message}\n\n${opening.question}`,
        opening,
        knowledgePoints: normalizeKnowledgePoints(resumedKnowledgeState),
        mode: 'resumed',
        revision: previousSession.revision + 1,
        memoryWarmup: (sessionArtifacts.memoryWarmup as ReviewPlan | undefined) ?? null,
        scene: buildSessionOpeningScene({ mode: 'resumed', context: resumedContext, sameTaskAttempt }),
      };
    } finally {
      resumeLeaseGuard.stop();
      if (!committed) {
        await teachingSessionRepository.releaseOperation(claim.session.id, claim.operationId);
      }
    }
  }

  const operationId = reservation.operationId as string;
  // P2：开课初始化含 opening LLM 调用，短租期内必须续租
  const initLeaseGuard = new TeachingOperationLeaseGuard(sessionId, operationId);
  initLeaseGuard.start();
  try {
    const opening = await generateOpening(context);
    const welcomeMessage = `${opening.message}\n\n${opening.question}`;
    const messages: TeachingSessionMessage[] = [
      {
        role: 'assistant',
        content: welcomeMessage,
        timestamp: new Date().toISOString(),
        analysis: {
          openingMode: opening.mode,
          quickReplies: opening.quickReplies,
        }
      }
    ];
    const teachingState = {
      ...(context.learningState || {}),
      learnerStateContext: buildLearnerStateContext(context, null, {
        cognitiveLevel: null,
        understanding: null,
        confusionPoints: [],
        emotionalState: null,
        engagement: null,
      }),
      classroomContext: {
        stage: {
          current: initialClassroomStage(),
          goal: '完成本节课切入点定位',
          reason: '新课堂启动，进入开场定位',
        },
        focus: {
          currentKnowledgePoint: null,
          linkedTaskGoal: context.cognitiveFrame.targetRelation,
          latestLearnerMessage: '',
        },
        progress: {
          progressedKnowledgePoints: [],
          pendingKnowledgePoints: [],
          recoveringKnowledgePoints: [],
          initiallyMasteredKnowledgePoints: [],
        },
        risk: {
          confusionPoints: [],
          emotionalState: null,
          engagement: null,
          struggleDetected: false,
          peerSupportActive: false,
        },
        nextStep: {
          suggestedAction: '通过开场交互确认学生切入点',
        },
      },
      classroomEventHistory: [
        buildClassroomEvent('session-started', '课堂已开始，进入开场定位', {
          openingMode: opening.mode,
          taskTitle: context.taskTitle,
        }),
      ],
      stageHistory: [
        {
          stage: initialClassroomStage(),
          reason: '新课堂启动，进入开场定位',
          enteredAt: new Date().toISOString(),
        },
      ],
      teachingControlContext: buildTeachingControlContext(
        initialClassroomStage(),
        context,
        buildLearnerStateContext(context, null),
        {},
      ),
      sessionArtifacts: {
        // 计划在 reserve 时建立；这里必须保留（此前整段重写把计划抹掉，导致首个回合就没有温故）
        ...(memoryWarmup ? { memoryWarmup } : {}),
        initialKnowledgeState: seededKnowledgeState,
        pathBackgroundContext: buildPathBackgroundContext(context),
        endReason: null,
      },
    };
    const session = await teachingSessionRepository.completeInitialization(sessionId, operationId, {
      messages,
      knowledgeState: seededKnowledgeState,
      teachingState
    });

    logger.info('[AITeaching] 新教学会话已创建', {
      sessionId: session.id,
      userId: input.userId,
      taskId: input.taskId,
    });

    // 难度调整锚点：开课时留痕一次（幂等键 = taskId），使效果度量能在真实课上运行
    await recordTaskDifficultyAnchor(context, session.id);

    return {
      sessionId: session.id,
      subject: session.subject,
      topic: session.topic,
      startTime: session.startTime,
      welcomeMessage,
      opening,
      knowledgePoints: normalizeKnowledgePoints(seededKnowledgeState),
      mode: 'new',
      revision: session.revision,
      memoryWarmup,
      scene: buildSessionOpeningScene({
        mode: 'new',
        context,
        sameTaskAttempt,
        ...(input.mode === 'review' ? { review: true } : {}),
      }),
    };
  } catch (error) {
    await teachingSessionRepository.failInitialization(sessionId, operationId);
    throw error;
  } finally {
    initLeaseGuard.stop();
  }
}

export async function endSession(
  sessionId: string,
  endReason = 'manual-end',
  expectedRevision?: number,
  requestedOperationId: string = randomUUID(),
  requestedRequestHash?: string,
  requestedRequestJson?: string
): Promise<{
  status: 'completed' | 'processing';
  operationId: string;
  wrapup?: SessionWrapupArtifact & {
    stateUpdate: LearningStateMetrics | null;
    duration: number;
    summarySource: 'model' | 'fallback';
    evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  };
  advisory?: ReplanAdvisory;
  revision: number;
}> {
  const fallbackIdentity = buildEndSessionRequestIdentity(endReason);
  const requestHash = requestedRequestHash || fallbackIdentity.requestHash;
  const requestJson = requestedRequestJson || fallbackIdentity.requestJson;
  const finalization = await teachingSessionRepository.claimFinalization(
    sessionId,
    'end_only',
    requestedOperationId,
    requestHash,
    requestJson,
    requireTeachingRevision(expectedRevision)
  );
  if (finalization.status === 'completed') {
    return {
      status: 'completed',
      operationId: finalization.operationId,
      wrapup: finalization.session.wrapup as any,
      advisory: finalization.session.advisory as ReplanAdvisory,
      revision: finalization.session.revision,
    };
  }
  if (finalization.status === 'processing') {
    return {
      status: 'processing',
      operationId: finalization.operationId,
      revision: finalization.session.revision
    };
  }
  const { session, operationId, leaseOwner } = finalization;
  const leaseGuard = new FinalizationLeaseGuard(sessionId, operationId, leaseOwner);
  leaseGuard.start();
  try {
  const durationMinutes = computeEffectiveDurationMinutes(session);
  const sessionArtifacts = {
    ...parseSessionArtifacts(session.teachingState),
    endReason,
  };
  const classroomEventHistory = Array.isArray(session.teachingState?.classroomEventHistory)
    ? session.teachingState?.classroomEventHistory
    : [];
  const finalClassroomContext = session.teachingState?.classroomContext || null;
  const stageHistory = Array.isArray(session.teachingState?.stageHistory)
    ? session.teachingState?.stageHistory
    : [];
  const initialKnowledgeState = Array.isArray(sessionArtifacts.initialKnowledgeState)
    ? sessionArtifacts.initialKnowledgeState
    : [];
  const knowledgeDelta = computeKnowledgeDelta(initialKnowledgeState, session.knowledgeState);
  const sessionEvidence = computeSessionEvidence(session);
  const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);
  const reviewHints = await loadRetrievabilityHints(session.userId);

  let wrapupOutput: any = null;
  try {
    wrapupOutput = await executeSkill(sessionWrapupAgentDefinition, {
    input: {
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: new Date(message.timestamp),
        analysis: message.analysis,
      })),
      knowledgePoints: session.knowledgeState,
      sessionInfo: {
        subject: session.subject,
        topic: session.topic,
        durationMinutes,
        userMessageCount: session.messages.filter((message) => message.role === 'user').length,
        assistantMessageCount: session.messages.filter((message) => message.role === 'assistant').length,
        taskType: session.taskType,
        taskTitle: context.taskTitle,
        taskDescription: context.taskDescription,
        pathTitle: context.pathContext.pathTitle || null,
        pathSummary: context.pathContext.pathSummary || null,
      },
      learningState: context.learningState ? {
        ...context.learningState,
        ...deriveTeachingRuntimeSignals(context),
      } : undefined,
      knowledgeContext: {
        initialPoints: initialKnowledgeState,
        delta: knowledgeDelta,
        reviewHints,
      },
      sessionEvidence,
      sessionStructure: {
        pathBackground: sessionArtifacts.pathBackgroundContext || null,
        finalClassroomContext,
        classroomEventHistory,
        stageHistory,
        endReason: sessionArtifacts.endReason || endReason,
      },
    },
    context: {
      userId: session.userId,
      sessionId,
    },
  }, {
    contextEnvelope: {
      schemaVersion: 'context-envelope/v1',
      principal: { userId: session.userId },
      session: { sessionId: session.id, taskId: session.taskId },
    },
  });
  } catch (error) {
    logger.warn('[AITeaching] 课后产出生成异常，改用 summary-only 兜底继续收束', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // M1 兜底：executeSkill 抛错或返回 success:false（internal.ext.sessionWrapup 缺失）时，
  // 用 summary-only 对象顶替，保证收束流程继续，避免整次收束失败为 finalization_failed。
  const endWrapupFallback = buildEndWrapupFallback(session, durationMinutes);
  const sessionWrapupExt = wrapupOutput?.internal?.ext?.sessionWrapup;
  const wrapupResult = sessionWrapupExt?.result || endWrapupFallback.result;
  const wrapupArtifact = sessionWrapupExt?.artifact || endWrapupFallback.artifact;
  const wrapupRuntimeEnvelope = wrapupOutput?.runtimeEnvelope
    || wrapupResult?.runtimeEnvelope
    || null;

  const evaluationResult = hasReliableSessionEvaluation(
    wrapupResult.evaluation,
    wrapupResult.evaluationSource
  )
    ? {
        source: wrapupResult.evaluationSource,
        evaluation: wrapupResult.evaluation!,
      }
    : null;

  // 影子双写（2026-09-22）：确定性聚合与 LLM 档位判定并存记录，供后续比对分布。
  // **不改变任何现有消费方**：learning-state.service / ReplanAdvisoryService /
  // LearnerKnowledgeMemoryService 仍读 LLM 值（evaluationResult）。这里只额外留痕。
  // 落点 = teaching_sessions.wrapup.shadowDeterministic（JSON 列，无需迁移）+ 一条 info 日志。
  const deterministicEvaluation = aggregateSessionEvaluationFromMessages(session.messages);
  const shadowDeterministic = buildSessionEvaluationShadow({
    llm: evaluationResult?.evaluation ?? null,
    deterministic: deterministicEvaluation,
    recordedAt: new Date().toISOString(),
  });
  logger.info('[AITeaching] 会话评估影子双写（确定性聚合 vs LLM）', {
    sessionId,
    formulaVersion: shadowDeterministic.formulaVersion,
    basis: shadowDeterministic.deterministic.basis,
    turnCount: shadowDeterministic.deterministic.turnCount,
    deterministic: {
      lss: shadowDeterministic.deterministic.lss,
      ktl: shadowDeterministic.deterministic.ktl,
      lf: shadowDeterministic.deterministic.lf,
      confidence: shadowDeterministic.deterministic.confidence,
    },
    llm: shadowDeterministic.llm,
    delta: shadowDeterministic.delta,
  });

  const lastAnalyzedMessage = [...session.messages].reverse().find((message) => !!message.analysis);
  const scoreInput = evaluationResult ? {
    sessionLss: evaluationResult.evaluation.sessionLss,
    sessionKtl: evaluationResult.evaluation.sessionKtl,
    sessionLf: evaluationResult.evaluation.sessionLf,
    durationMinutes,
    confidence: evaluationResult.evaluation.confidence,
    pathId: session.learningPathId || null,
    taskId: session.taskId,
    sessionId,
  } : null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const metricCommit = scoreInput
      ? await learningStateService.prepareSessionScoreCommit(session.userId, scoreInput)
      : null;
    const finalState = metricCommit?.metrics || null;
    const persistedEvaluation = {
      ...(evaluationResult ? evaluationResult.evaluation : {}),
      lss: finalState?.lss ?? 0,
      ktl: finalState?.ktl ?? 0,
      lf: finalState?.lf ?? 0,
      lsb: finalState?.lsb ?? 0,
      evaluationSource: (evaluationResult?.source || 'unavailable') as 'model' | 'ai-fallback' | 'failed' | 'unavailable',
      messageCount: session.messages.filter((message) => message.role === 'user').length,
      avgUnderstanding: sessionEvidence.avgUnderstanding ?? 0,
      avgCognitiveLevel: lastAnalyzedMessage?.analysis?.cognitiveLevel || 'understand',
      duration: durationMinutes,
    };
    const persistedWrapup = {
      ...wrapupArtifact,
      duration: durationMinutes,
      stateUpdate: finalState,
      summarySource: wrapupResult.summarySource,
      evaluationSource: wrapupResult.evaluationSource,
      runtimeEnvelope: wrapupRuntimeEnvelope,
      // 影子双写：确定性聚合 vs LLM，仅供比对，不被任何消费方读取
      shadowDeterministic,
    };
    const snapshotInput = {
      userId: session.userId,
      learningPathId: session.learningPathId || undefined,
      milestoneId: session.milestoneId || undefined,
      taskId: session.taskId,
      mode: 'teaching' as const,
    };
    const learnerSnapshot = finalState
      ? await learnerSnapshotService.previewSnapshotFromMetrics({
          ...snapshotInput,
          metrics: finalState,
          generatedAt: finalState.timestamp,
        })
      : await learnerSnapshotService.getSnapshot(snapshotInput);
    const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);
    const currentPath = learnerSnapshot.knowledgeMemory.currentPath;
    const currentStageNumber = currentPath?.currentPosition.stageNumber || 1;
    const nextMilestone = currentPath?.milestoneProgress.find((item) => item.stageNumber === currentStageNumber + 1) || null;
    const thresholdAdvisory = replanAdvisoryService.build({
      wrapup: persistedWrapup,
      learnerReplanProjection,
      nextMilestone: nextMilestone ? {
        milestoneId: nextMilestone.milestoneId,
        title: nextMilestone.title,
        goal: nextMilestone.goal,
        totalTasks: nextMilestone.totalTasks,
      } : null,
    });
    // 归因层（阈值召回 + LLM 归因）：只在建议已成立时补"为什么"，失败/超时保留阈值版
    let advisory = thresholdAdvisory;
    if (thresholdAdvisory.shouldSuggest) {
      // 会话作用域：让 aux skill 的 LLM 调用带上 sessionId（成本可归到这节课，审计 §5.2 P2）
      const attribution = await runWithTeachingSession(session.id, () => replanAttributionService.attribute({
        // 召回与动作**同源**（都来自最终 advisory）：此前取信号层 signal，与 allowedRecommendations
        // 属两套阈值，会导致"允许的动作没有对应原因码"（§3.19 P1⑦）
        recall: toAttributionRecall(thresholdAdvisory),
        allowedRecommendations: thresholdAdvisory.ui.options
          .map((option) => option.key)
          .filter((key) => ['keep', 'reinforce', 'slow_down', 'resequence', 'accelerate'].includes(key)),
        evidence: buildReplanAttributionEvidence({
          wrapup: persistedWrapup,
          learnerReplanProjection,
          nextMilestoneTitle: nextMilestone?.title ?? null,
        }),
        pathContext: {
          milestoneTitle: learnerReplanProjection?.path?.currentPosition?.milestoneTitle ?? null,
          stageNumber: currentStageNumber,
        },
      }));
      advisory = replanAdvisoryService.applyAttribution(thresholdAdvisory, attribution);
      if (advisory.attribution?.claim && isCalibratableDirection(advisory.recommendation)) {
        // 可证伪断言单独成列（insightType=replan_attribution），不与状态评审的可靠性混算
        await insightCalibrationService.recordInsights(session.userId, session.learningPathId || null, [{
          claim: advisory.attribution.claim,
          insightType: 'replan_attribution',
          conceptKeys: [
            ...(learnerReplanProjection?.mastery?.fragileConcepts ?? []).slice(0, 2),
            ...(learnerReplanProjection?.mastery?.strugglingConcepts ?? []).slice(0, 2),
          ],
          predictedAt: new Date().toISOString(),
        }]).catch(() => []);
      }
    }
    const finalWrapup = {
      ...persistedWrapup,
      learner: {
        recentTrend: learnerSnapshot.dynamicState.recentTrend,
        fatigueRisk: learnerSnapshot.dynamicState.fatigueRisk,
        recommendedPacing: learnerSnapshot.dynamicState.recommendedPacing,
      },
    };
    const lessonEvent = createDomainEvent({
      id: `evt_lesson_completed_${session.id}`,
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: session.id,
      userId: session.userId,
      source: AI_TEACHING_AGENT_ID,
      data: {
        lessonId: session.id,
        sessionId: session.id,
        taskId: session.taskId,
        pathId: session.learningPathId,
        milestoneId: session.milestoneId,
        duration: durationMinutes,
        // 断链修复 P0-5：任务的可迁移目标（task.transferable 派生），供课后知识增强
        // （lesson-knowledge-enricher）判断"迁移意图是否达成"，闭环 transferGoal 信号
        transferGoal: context?.cognitiveFrame?.transferGoal || null,
        performance: evaluationResult ? persistedEvaluation : null,
        knowledgeState: session.knowledgeState,
        visibleDialogueContext: session.messages.slice(-16).map((message) => ({
          role: message.role,
          content: message.content,
          analysis: message.analysis || null,
        })),
        classroomEventHistory,
        wrapup: finalWrapup,
        advisory
      }
    });

    await commitSessionLoadMetric(session).catch((error) => {
      logger.warn('[AITeaching] session_load 指标写入失败（不影响收束）', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    try {
      await leaseGuard.assertOwned();
      await teachingSessionRepository.completeWithEvent(sessionId, operationId, leaseOwner, {
        messages: session.messages,
        knowledgeState: session.knowledgeState,
        teachingState: mergeFinalTeachingState(session.teachingState, finalState, sessionArtifacts),
        wrapup: finalWrapup,
        advisory,
        duration: durationMinutes
      }, lessonEvent, metricCommit ? {
        userId: metricCommit.userId,
        expectedRevision: metricCommit.expectedRevision,
        sourceKey: metricCommit.sourceKey,
        data: metricCommit.data,
      } : null);
    } catch (error) {
      if (
        error instanceof TeachingSessionConflictError
        && error.code === 'TEACHING_LEARNING_STATE_STALE'
        && attempt < 4
      ) {
        continue;
      }
      throw error;
    }

    // 课后刷新统一包进「当前教学会话」作用域：这些 aux skill 的 LLM 调用据此可归到本节
    // （此前不传 sessionId，成本落在 agent_call_logs 的"(无会话)"栏——审计 §5.2 P2 尾巴）
    runWithTeachingSession(session.id, () => dashboardGuidanceSnapshotService.refreshInBackground(session.userId, 'lesson-wrapup'));
    runWithTeachingSession(session.id, () => learnerStateReviewService.refreshInBackground(session.userId));
    // 概念身份归并（记忆层维护 · 默认观察模式）：课后顺带看一眼是否有同义重复知识点
    runWithTeachingSession(session.id, () => conceptConsolidatorService.refreshInBackground(session.userId));
    // 概念负担档位预热：把 LLM 判定挪出开课关键路径（下节课直接命中缓存）
    runWithTeachingSession(session.id, () => conceptLoadService.warmInBackground(session.userId));
    // 记忆引擎 M2：课后按知识看板状态确定性回写内化强度（best-effort，失败不阻断课堂完成）
    const calibrationBias = learnerSnapshot?.profile?.cognitive?.selfAssessmentAccuracy ?? 'accurate';
    memoryTraceService.recordSessionOutcome(
      session.userId,
      session.knowledgeState,
      'derived',
      calibrationBias,
      // 记忆条目的来源路径：用于温故解释"这是你在《X》里学过的"，以及按路径看待办
      session.learningPathId ?? null,
    ).catch((error) => {
      logger.warn('[AITeaching] 记忆痕迹回写失败', {
        sessionId,
        userId: session.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return {
      status: 'completed',
      operationId,
      wrapup: finalWrapup,
      advisory,
      revision: session.revision + 1,
    };
  }

  throw new TeachingSessionConflictError('学习状态持续变化，请稍后重试', 'TEACHING_LEARNING_STATE_STALE');
  } catch (error) {
    const info = classifyFinalizationError(error);
    try {
      await teachingSessionRepository.failFinalization(
        sessionId,
        operationId,
        leaseOwner,
        'end_only',
        info.code === 'FINALIZATION_PERSISTENCE_FAILED' ? 'SESSION_FINALIZATION_FAILED' : info.code,
        info.retryable
      );
    } catch (markError) {
      logger.error('[AITeaching] 课堂结束失败状态持久化失败', {
        sessionId,
        operationId,
        error: markError instanceof Error ? markError.message : String(markError)
      });
    }
    throw error;
  } finally {
    await leaseGuard.stop();
  }
}

export async function loadRetrievabilityHints(userId: string): Promise<Array<{ concept: string; retrievability: number }>> {
  try {
    const traces = await prisma.memory_traces.findMany({
      where: { userId, fsrsStability: { not: null }, lastSeenAt: { not: null } },
      orderBy: { dueAt: 'asc' },
      take: 20,
      select: {
        label: true,
        conceptKey: true,
        fsrsStability: true,
        fsrsDifficulty: true,
        fsrsLapses: true,
        fsrsReps: true,
        extractionCount: true,
        lastSeenAt: true,
      },
    });
    const now = new Date();
    return traces
      .map((t) => {
        const state: FsrsMemoryState = {
          stability: t.fsrsStability as number,
          difficulty: t.fsrsDifficulty ?? 5,
          reps: t.fsrsReps ?? t.extractionCount,
          lapses: t.fsrsLapses ?? 0,
          lastReviewAt: t.lastSeenAt as Date,
        };
        return {
          concept: t.label || t.conceptKey,
          retrievability: Math.round(fsrsRetrievability(state, now) * 100) / 100,
        };
      })
      .filter((h) => h.retrievability < 0.8)
      .slice(0, 5);
  } catch {
    return [];
  }
}

