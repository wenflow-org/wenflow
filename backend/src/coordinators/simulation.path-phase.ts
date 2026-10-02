/**
 * 虚拟仿真 Path 阶段流程（架构审计 §5 行动 #2：simulation.coordinator 按生命周期阶段拆分）
 *
 * 职责：Goal 收敛后推进 Path 生成（buildGoalPathRequest/advanceToPathGeneration/waitForPathReady）、
 * 生成重试（retryPathGeneration）、评审收敛环（reviewPathProposal ↔ replanPathFromReview →
 * acceptPathReview，含 MAX_PATH_REPLANS 护栏）与 resolvePathReview 汇聚入口。
 *
 * 跨方法调用一律经 ctx（orchestrator 实例）转发，保证测试对实例方法的
 * 覆写/打桩缝隙不变（full-session-honesty 覆写 waitForPathReady 即依赖此约定）。
 * 行为与拆分前 simulation.coordinator 同名方法逐一等价。
 */
import { logger } from '../utils/logger';
import prisma from '../config/database';
import learningService from '../services/learning/learning.service';
import pathCoordinator, { type GoalPathRequest } from './path.coordinator';
import goalConversationService from '../services/learning/goal-conversation.service';
import { executeSkill, virtualLearnerPathEvaluatorDefinition } from '../skills';
import { buildGoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import { resolvePathRawGoalFromSession } from '../virtual-lab/story-demand';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import type { StageResults, VirtualSessionWithProfile } from '../virtual-lab/vlab-types';
import type { ConversationHistoryItem, LearnerLatentState } from './simulation.types';
import {
  getSessionFrictionBudget,
  getSessionPromptOverrides,
  isPathReviewAlreadyAcceptedForCurrentPath,
  buildTimeDimensionsFromBudget,
  mergeLearnerState,
  parseProfileData,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
  resolveLearnerLoadProfile,
  resolveScenarioBudget,
} from './simulation.helpers';
import { buildAssistedLearnerMemory } from './simulation.memory';
import type { SimulationOrchestrator } from './simulation.coordinator';

/** Path 评审 ↔ 重规划 收敛护栏：累计重规划次数上限（见 simulation.coordinator 同名常量说明） */
const MAX_PATH_REPLANS = (() => {
  const raw = Number(process.env.VIRTUAL_PATH_MAX_REPLANS);
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(10, Math.round(raw));
})();

/**
 * 等待学习路径生成就绪：轮询 path 的里程碑落地（最多 timeoutMs）。
 * Goal 收敛后 path 生成是异步任务，实测需要 2-3 分钟；
 * 黑盒/辅助模式均应等待而非让用户反复点击空转。
 */
export async function waitForPathReady(ctx: SimulationOrchestrator, 
  sessionId: string,
  learningPathId: string | null,
  timeoutMs = 600_000
): Promise<{ ready: boolean; reason?: string }> {
  const deadline = Date.now() + timeoutMs;
  let pathId = learningPathId;
  while (Date.now() < deadline) {
    if (!pathId) {
      const s = await ctx.getVirtualSession(sessionId);
      pathId = s.learningPathId || null;
      if (!pathId) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
    }
    const milestoneCount = await prisma.milestones.count({ where: { learningPathId: pathId } });
    if (milestoneCount > 0) {
      // 关键：里程碑存在 ≠ 可启动。任务（subtasks）可能在里程碑写入后才插入，
      // 过早 ready 会让 startLearningPhase 报「第一个里程碑没有可用任务」。
      // 必须等到至少一个里程碑下有非 completed 的可启动任务。
      const firstRunnable = await prisma.subtasks.findFirst({
        where: {
          milestones: { learningPathId: pathId },
          status: { not: 'completed' }
        },
        select: { id: true }
      });
      if (firstRunnable) return { ready: true };
    }

    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { status: true }
    });
    if (path && !['active', 'generating'].includes(path.status)) {
      return { ready: false, reason: `路径生成未产出里程碑（path status=${path.status}）` };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { ready: false, reason: '等待路径生成超时，请检查路径生成任务' };
}


/**
 * 会话的 Goal 对话 → GoalPathRequest（Path 生成/重试共用）。
 * 与 `advanceToPathGeneration` 原先的内联构造逐字段一致，抽成纯装配以便重试复用。
 */
/**
 * 纯函数：判定是否需要「强制接受当前 Path」（护栏命中）。
 * 抽成纯函数以便单测覆盖（见 __tests__/path-review-guard.test.ts）。
 */
export function shouldForceAcceptPathReview(params: {
  decision: 'accept' | 'modify' | 'reject' | null | undefined;
  learningPathId?: string | null;
  replanResultPathId?: string | null;
  replanCount: number;
  limit?: number;
}): boolean {
  const { decision, learningPathId, replanResultPathId } = params;
  if (!decision || decision === 'accept') return false;
  const limit = typeof params.limit === 'number' ? params.limit : MAX_PATH_REPLANS;
  const alreadyReplannedThisPath = Boolean(replanResultPathId) && replanResultPathId === learningPathId;
  const reachedReplanLimit = params.replanCount >= limit;
  return alreadyReplannedThisPath || reachedReplanLimit;
}

export function buildGoalPathRequest(
  session: VirtualSessionWithProfile,
  conversation: { collectedData: string | null; description: string | null }
): { request: GoalPathRequest; rawGoalSource: string | undefined } {
  const collectedData: Record<string, unknown> = safeJsonParse<Record<string, unknown>>(conversation.collectedData, {});
  const pathRawGoal = resolvePathRawGoalFromSession({
    goalConversationDescription: conversation.description,
  });
  if (!pathRawGoal.rawGoal) {
    throw new Error('无法推进 Path：Goal 对话缺少正式诉求，请先恢复 Goal 对话');
  }
  const pathAgentOverrides = getSessionPromptOverrides(session)?.pathAgent;
  // 负荷画像：虚拟学习者的人设里有 availableTime / cognitiveLoadTolerance（自由文本），
  // 透传给 derivePlanningHints 收紧"紧预算/低耐受"者的体量（里程碑数/单任务分钟/周期）。
  // 真实用户链路不构造该字段 ⇒ 体量推导行为不变。
  //
  // 字段层级：内置 preset 把这些字段放在 profile **顶层**；但创建 VL 的调用方也常把整套
  // 人设塞进 `personaSeed`（presets.yaml 的书写形状）。历史上只读顶层 ⇒ 后者静默失效
  // （learnerLoadProfile=null ⇒ 收紧分支从不执行）。此处两处都读，顶层优先。
  const personaData = safeJsonParse<Record<string, unknown>>(session.virtual_learner_profiles.profile, {});
  const learnerLoadProfile = resolveLearnerLoadProfile(personaData);
  // 预算锚（2026-10-02 小陈案例 P0-2）：场景卡 budget（如 每天60分钟×60天=60h）此前从不进
  // path 生成链 ⇒ 学时锚塌光、101h 超载无声明。此处把预算映射成 time_dimensions 前置注入
  // understanding——与 goal 层 LLM 自己推断的字段同形、同入口，下游（锚推导/守恒/容量对表）
  // 零改动生效。对话里 LLM 已推断出估时（用户原话说了时间安排）时以对话为准，不覆盖。
  const understandingForSummary = (collectedData.understanding && typeof collectedData.understanding === 'object'
    ? collectedData.understanding
    : {}) as Record<string, unknown>;
  {
    const scenarioBudget = resolveScenarioBudget(personaData);
    const timeDimensionsFromBudget = scenarioBudget ? buildTimeDimensionsFromBudget(scenarioBudget) : null;
    const existingTimeDimensions = (understandingForSummary.time_dimensions && typeof understandingForSummary.time_dimensions === 'object'
      ? understandingForSummary.time_dimensions
      : null) as Record<string, unknown> | null;
    const llmAlreadyEstimated = existingTimeDimensions && Number(existingTimeDimensions.estimatedHours) > 0;
    if (timeDimensionsFromBudget && !llmAlreadyEstimated) {
      understandingForSummary.time_dimensions = {
        ...(existingTimeDimensions || {}),
        ...timeDimensionsFromBudget,
      };
    }
  }
  const request: GoalPathRequest = {
    userId: session.userId,
    sourceConversationId: session.goalConversationId as string,
    source: 'goal',
    rawGoal: pathRawGoal.rawGoal,
    learnerLoadProfile: learnerLoadProfile.availableTime || learnerLoadProfile.loadTolerance ? learnerLoadProfile : null,
    visibleSummary: buildGoalPathVisibleSummary({
      understanding: understandingForSummary,
      confirmedProposal: collectedData.confirmedProposal || null,
      collected: collectedData.collected || {},
    }),
    conversationHistory: (Array.isArray(collectedData.messages) ? collectedData.messages : []) as ConversationHistoryItem[],
    systemPromptOverrides: pathAgentOverrides ? { pathAgent: pathAgentOverrides } : undefined
  };
  return { request, rawGoalSource: pathRawGoal.source };
}
export async function advanceToPathGeneration(ctx: SimulationOrchestrator, sessionId: string): Promise<{
  success: boolean;
  learningPathId?: string;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    
    if (!session.goalConversationId) {
      throw new Error('Goal对话不存在');
    }
    
    const conversation = await ctx.getGoalConversation(
      session.goalConversationId,
      session.userId
    );
    
    if (!conversation) {
      throw new Error('Goal对话记录不存在');
    }
    
    if (session.learningPathId) {
      // 会话上的 Path 指针可能因外部删除/重建而过期，校验后再复用。
      const existingPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId },
        select: { id: true }
      });
      if (existingPath) {
        return { success: true, learningPathId: session.learningPathId };
      }
      logger.warn('[simulation-coordinator] 会话绑定的 Path 已不存在，重新生成', {
        sessionId,
        stalePathId: session.learningPathId
      });
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: { learningPathId: null, updatedAt: new Date() }
      });
    }

    // Path 不读 story、不特判虚拟人：只消费 Goal 对话产物。
    // rawGoal 优先 conversation.description（= 故事需求经开场传入的正式链路）。
    const { request: pathRequest, rawGoalSource } = buildGoalPathRequest(session, conversation);
    
    logger.info('[simulation-coordinator] 开始路径生成', {
      sessionId,
      userId: session.userId,
      rawGoalSource,
    });
    
    const pathResult = await pathCoordinator.generateFromGoal(pathRequest);
    
    const learningPathId = pathResult?.path?.id || pathResult?.id;
    
    if (learningPathId) {
      await ctx.updateSessionStatus(
        sessionId,
        'running',
        'path',
        undefined,
        learningPathId
      );

      // 同步 Goal ↔ Path 指针：重建 Path 后 goal_conversations 可能仍指向已删除的旧 Path，
      // 不回写会导致后续评审重规划拿着失效 id 报错。
      if (conversation.learningPathId !== learningPathId) {
        await prisma.goal_conversations.update({
          where: { id: session.goalConversationId },
          data: { learningPathId }
        }).catch((err: unknown) => {
          logger.warn('[simulation-coordinator] 回写 goal_conversations.learningPathId 失败', {
            sessionId,
            learningPathId,
            error: asErrorLike(err).message || String(err)
          });
        });
      }

      await ctx.updateStageResults(sessionId, 'path', {
        success: true,
        learningPathId,
        totalMilestones: pathResult?.path?.totalMilestones
      });
    }
    
    logger.info('[simulation-coordinator] 路径生成完成', {
      sessionId,
      learningPathId
    });
    
    return {
      success: true,
      learningPathId
    };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 路径生成失败', {
      sessionId,
      error: asErrorLike(error).message
    });
    
    return {
      success: false,
      error: asErrorLike(error).message
    };
  }
}

/**
 * 重试失败的路径生成（虚拟实验室自愈，新发现问题 #2）。
 *
 * 复用平台既有重试语义（与用户侧 PATCH /paths/:pathId/retry 同源）：
 * - `stageDesign` → `learningService.retryPathEnrichment`（补齐阶段任务，不删路径）；
 * - `core` → 先 `claimPathCoreGeneration` 原子认领，再以**同一 Goal 诉求**异步重跑主结构，
 *   失败时经 onError 落回官方 `markActiveGenerationFailed`（保持 run/path 状态一致）。
 *
 * 是否可重试由 `getPathGenerationRetry` 守卫；调用方的**次数上限**由 harness 控制。
 */
export async function retryPathGeneration(ctx: SimulationOrchestrator, sessionId: string): Promise<{
  success: boolean;
  retryType?: 'core' | 'stageDesign';
  mode?: string;
  runId?: string;
  error?: string;
}> {
  let learningPathId: string | null = null;
  try {
    const session = await ctx.getVirtualSession(sessionId);
    if (!session.learningPathId) {
      throw new Error('学习路径不存在，无法重试路径生成');
    }
    const pathId = session.learningPathId;
    learningPathId = pathId;

    const retry = await learningService.getPathGenerationRetry(pathId, session.userId);
    if (!retry.allowed || !retry.retryType) {
      return {
        success: false,
        error: retry.reason === 'completed' ? '路径已经生成完成，无需重试' : '当前生成任务未失败或未过期，不能重试'
      };
    }

    if (retry.retryType === 'stageDesign') {
      const result = await learningService.retryPathEnrichment(pathId, session.userId);
      await ctx.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'path-regenerate',
        details: {
          output: {
            retryType: 'stageDesign',
            mode: result?.mode ?? null,
            retryCount: result?.retryCount ?? null,
            runId: result?.runId ?? null,
            learningPathId: pathId
          }
        }
      });
      return { success: true, retryType: 'stageDesign', mode: result?.mode, runId: result?.runId };
    }

    if (!session.goalConversationId) {
      throw new Error('Goal对话不存在，无法重试路径主结构生成');
    }
    const conversation = await ctx.getGoalConversation(session.goalConversationId, session.userId);
    if (!conversation) {
      throw new Error('Goal对话记录不存在');
    }

    const runId = await learningService.claimPathCoreGeneration(pathId, retry.expectedActiveGenerationRunId);
    const { request } = buildGoalPathRequest(session, conversation);
    pathCoordinator.runGoalAsync({ ...request, existingPathId: pathId, generationRunId: runId }, {
      onError: async (error) => {
        logger.error(`[simulation-coordinator] 重试生成路径失败：${pathId}`, error);
        await learningService.markActiveGenerationFailed(pathId, error, runId);
      }
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'path-regenerate',
      details: { output: { retryType: 'core', runId, learningPathId: pathId } }
    });
    return { success: true, retryType: 'core', runId };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 路径生成重试失败', {
      sessionId,
      learningPathId,
      error: asErrorLike(error).message
    });
    return { success: false, error: asErrorLike(error).message };
  }
}
export async function reviewPathProposal(ctx: SimulationOrchestrator, sessionId: string): Promise<{
  success: boolean;
  decision?: 'accept' | 'modify' | 'reject';
  reaction?: string;
  visibleRequestedChanges?: string[];
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    
    if (!session.learningPathId) {
      throw new Error('学习路径不存在，请先生成路径');
    }
    
    const profile = parseProfileData(session.virtual_learner_profiles);

    const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
    
    const learningPath = await prisma.learning_paths.findUnique({
      where: { id: session.learningPathId }
    });
    
    if (!learningPath) {
      throw new Error('学习路径记录不存在');
    }
    
    const milestones = await prisma.milestones.findMany({
      where: { learningPathId: session.learningPathId },
      orderBy: { stageNumber: 'asc' }
    });
    
    const reactionStart = Date.now();
    const pathLearnerMemory = await buildAssistedLearnerMemory(session.userId);
    const reactionOutput = await executeSkill(virtualLearnerPathEvaluatorDefinition, {
      learner: profile,
      story: parseStoryContextFromStageResults(stageResults),
      pathProposal: {
        title: learningPath.title,
        description: learningPath.description,
        totalMilestones: learningPath.totalMilestones,
        estimatedHours: learningPath.estimatedHours,
        difficulty: learningPath.difficulty,
        milestones: milestones.map(m => ({
          stageNumber: m.stageNumber,
          title: m.title,
          description: m.description,
          estimatedHours: m.estimatedHours
        }))
      },
      goalState: null,
      previousReaction: stageResults.path_review || null,
      learnerMemory: pathLearnerMemory,
      learnerState: mergeLearnerState(profile, (stageResults.path_review?.learnerState || stageResults.goal?.learnerState) as Partial<LearnerLatentState> | undefined, 'path', parseStoryContextFromStageResults(stageResults)),
      frictionBudget: getSessionFrictionBudget(session)
    });

    if (!reactionOutput?.reaction) {
      throw new Error('虚拟用户 Path 评审结果无效');
    }

    // path-evaluator envelope 仅作观测；决策仍读 debug.internalDecision
    const pathReviewEnvelope = reactionOutput?.runtimeEnvelope || null;
    
    const decision = ['accept', 'modify', 'reject'].includes(reactionOutput.debug?.internalDecision)
      ? reactionOutput.debug.internalDecision as 'accept' | 'modify' | 'reject'
      : 'accept';
    const visibleRequestedChanges = reactionOutput.visibleRequestedChanges || [];
    const biggestConcern = reactionOutput.debug?.visibleSignal || visibleRequestedChanges[0] || null;

    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'path-review',
      durationMs: Date.now() - reactionStart,
      details: {
        output: {
          reaction: reactionOutput.reaction,
          decision,
          confidence: reactionOutput.debug?.internalConfidence ?? null,
          visibleRequestedChanges,
          biggestConcern,
          learningPathId: session.learningPathId,
          runtimeEnvelope: pathReviewEnvelope,
        }
      }
    });
    
    await ctx.updateStageResults(sessionId, 'path_review', {
      success: true,
      lastRuntimeEnvelope: pathReviewEnvelope,
      status: 'pending',
      decision,
      reaction: reactionOutput.reaction,
      visibleRequestedChanges,
      biggestConcern,
      confidence: reactionOutput.debug?.internalConfidence ?? null,
      reviewedPathId: session.learningPathId,
      reviewedAt: new Date().toISOString(),
      learnerState: mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', parseStoryContextFromStageResults(stageResults))
    });
    
    logger.info('[simulation-coordinator] 路径评审完成', {
      sessionId,
      hasReaction: !!reactionOutput.reaction,
      requestedChangeCount: Array.isArray(reactionOutput.visibleRequestedChanges) ? reactionOutput.visibleRequestedChanges.length : 0
    });
    
    return {
      success: true,
      decision,
      reaction: reactionOutput.reaction,
      visibleRequestedChanges
    };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 路径评审失败', {
      sessionId,
      error: asErrorLike(error).message
    });
    
    return {
      success: false,
      error: asErrorLike(error).message
    };
  }
}

/** 人工确认接受评审结论。只改评审状态，不自动启动 Learn。
 */
export async function acceptPathReview(ctx: SimulationOrchestrator, sessionId: string, options: { force?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    const stageResults = parseStageResultsPayload(session.stageResults);
    const pathReview = (stageResults.path_review || {}) as Record<string, unknown>;

    if (!session.learningPathId) {
      throw new Error('学习路径不存在，请先生成 Path');
    }
    if (pathReview.decision !== 'accept' && !options.force) {
      throw new Error('虚拟学习者尚未接受当前 Path，不能标记接受');
    }
    if (pathReview.reviewedPathId && pathReview.reviewedPathId !== session.learningPathId) {
      throw new Error('评审针对的是旧版 Path，请重新评审当前 Path');
    }

    await ctx.updateStageResults(sessionId, 'path_review', {
      ...pathReview,
      status: 'accepted',
      acceptedBy: options.force ? 'force' : 'operator',
      acceptedAt: new Date().toISOString()
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: {
        output: {
          from: 'path-review',
          to: 'path-accepted',
          reason: options.force ? 'force-accept-non-accept-decision' : 'operator-confirmed-accept',
          decision: pathReview.decision ?? null,
          learningPathId: session.learningPathId
        }
      }
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: asErrorLike(error).message };
  }
}

export async function replanPathFromReview(ctx: SimulationOrchestrator, sessionId: string): Promise<{
  success: boolean;
  learningPathId?: string;
  error?: string;
}> {
  const session = await ctx.getVirtualSession(sessionId);
  const stageResults = parseStageResultsPayload(session.stageResults);
  const pathReview = stageResults.path_review || {};

  try {
    if (!session.learningPathId) {
      throw new Error('学习路径不存在，无法重规划');
    }
    if (!session.goalConversationId) {
      throw new Error('Goal 对话不存在，无法重规划');
    }
    if (pathReview.reviewedPathId && pathReview.reviewedPathId !== session.learningPathId) {
      throw new Error('评审针对的是旧版 Path，请先重新评审当前 Path');
    }
    if (pathReview.status === 'replanned') {
      throw new Error('已按上次意见重规划过，请先重新评审新版 Path');
    }

    const feedback = [pathReview.reaction, ...(Array.isArray(pathReview.visibleRequestedChanges) ? pathReview.visibleRequestedChanges : [])]
      .filter(Boolean)
      .join('\n');
    if (!feedback) {
      throw new Error('评审没有可执行的修改意见，请先评审 Path');
    }

    await ctx.updateStageResults(sessionId, 'path_review', {
      ...pathReview,
      status: 'replanning',
      replan: { requestedAt: new Date().toISOString(), sourcePathId: session.learningPathId, reason: feedback }
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'path-replan',
      details: { output: { decision: pathReview.decision, learningPathId: session.learningPathId, feedback } }
    });

    await ctx.assertCurrentSessionLeaseOwned(sessionId);
    const result = await goalConversationService.regeneratePath(
      session.goalConversationId,
      session.userId,
      feedback,
      getSessionPromptOverrides(session)
    );
    const learningPathId = result.internal?.core?.learningPath?.id || session.learningPathId;
    await ctx.updateSessionStatus(sessionId, 'running', 'path', session.goalConversationId, learningPathId);
    await ctx.updateStageResults(sessionId, 'path_review', {
      ...pathReview,
      status: 'replanned',
      replan: { requestedAt: new Date().toISOString(), sourcePathId: session.learningPathId, resultPathId: learningPathId, completedAt: new Date().toISOString(), reason: feedback }
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      // 收尾日志与"请求"日志分属不同 phase：否则一次重规划写 2 条 'path-replan'，
      // countSessionLogsByPhase 会双计 → 重规划上限（2）在第 1 次就命中、提前 force-accept（18 号报告观察项）。
      phase: 'path-replan-completed',
      details: { output: { from: 'path-review', to: 'path', reason: 'path-replanned-awaiting-review', decision: pathReview.decision, sourcePathId: session.learningPathId, resultPathId: learningPathId } }
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: { output: { from: 'path-review', to: 'path', reason: 'path-replanned-awaiting-review', decision: pathReview.decision, learningPathId } }
    });
    return { success: true, learningPathId };
  } catch (error: unknown) {
    const latest = parseStageResultsPayload((await ctx.getVirtualSession(sessionId)).stageResults);
    await ctx.updateStageResults(sessionId, 'path_review', {
      ...(latest.path_review || pathReview),
      status: 'failed',
      error: asErrorLike(error).message || '重规划失败'
    });
    return { success: false, error: asErrorLike(error).message || '重规划失败' };
  }
}

/**
 * 一键全流程专用：评审后自动推进（accept→可选启动 Learn；否则自动重规划）。
 * 手动操作请用 reviewPathProposal / acceptPathReview / replanPathFromReview。
 */
/**
 * 一键全流程入口（原「评审后自动推进」）。
 * 【2026-10-01 用户拍板：移除 Path 评审门禁】评审（虚拟学习者对路径的 accept/modify/reject 审计）
 * 不应成为阻塞阶段——Path 生成即视为接受。本函数退化为：补一条幂等的接受记录 + 可选直接进入 Learn。
 * 历史的评审收敛环（reviewPathProposal ↔ replanPathFromReview → acceptPathReview）保留为**手动工具**，
 * 管理台按钮仍可用，但不再被任何自动流程调用。存量卡在 awaiting-review 的会话会在下次推进时被本函数解锁。
 */
/** 偶发「学习者对路径不满」的摩擦档位概率（真实用户偶尔主观要求重新设计；none 档关闭）。
 *  【2026-10-02 用户拍板】暂时关闭：总开关置 false 即全档位不触发；重新启用改 true 即可。 */
const PATH_DISLIKE_ENABLED = false;
const PATH_DISLIKE_PROBABILITY: Record<string, number> = { none: 0, low: 0.03, normal: 0.08, high: 0.15, stress_test: 0.25 };

/**
 * 偶发情绪行为（2026-10-01 用户拍板）：评审不再是门禁，但「真实用户偶尔对路径不满意、
 * 主观要求重新设计」是真实学习行为——按摩擦档位概率触发，每条路径至多一次，且不阻塞：
 * 触发后复用手动评审工具让学习者真实表达一次意见（可能仍 accept——情绪不保证不满意），
 * modify/reject 则重规划一次；成败都继续走下方的自动接受 + 进 Learn。
 */
async function maybeSimulatePathDislike(ctx: SimulationOrchestrator, sessionId: string): Promise<void> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    const pathId = session.learningPathId;
    if (!pathId) return;
    const stageResults = parseStageResultsPayload(session.stageResults);
    const pre = (stageResults.path_review || {}) as Record<string, any>;
    // 每条路径至多闹一次：该路径已因不满重规划过 → 情绪已释放
    if (pre?.replan?.resultPathId === pathId) return;
    const replanCount = await ctx.countSessionLogsByPhase(sessionId, 'path-replan');
    if (replanCount >= MAX_PATH_REPLANS) return;
    if (!PATH_DISLIKE_ENABLED) return;
    const probability = PATH_DISLIKE_PROBABILITY[getSessionFrictionBudget(session)] ?? 0;
    if (probability <= 0 || Math.random() >= probability) return;
    const review = await ctx.reviewPathProposal(sessionId);
    if (!review.success || !review.decision || review.decision === 'accept') return;
    const replanned = await ctx.replanPathFromReview(sessionId);
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: replanned.success ? 'path-replan' : 'path-replan-guard',
      details: { output: { reason: 'episodic-learner-dislike', decision: review.decision, replanned: replanned.success, error: replanned.error || null, learningPathId: pathId } }
    });
    logger.info('[simulation-coordinator] 偶发路径不满已模拟', { sessionId, decision: review.decision, replanned: replanned.success });
  } catch (error) {
    // 装饰性行为：任何失败都不阻塞主流程
    logger.warn('[simulation-coordinator] 偶发路径不满模拟失败（不阻塞）', { sessionId, error: asErrorLike(error).message });
  }
}

/**
 * 一键全流程入口。
 * 【2026-10-01 用户拍板】Path 评审门禁已移除：Path 生成即视为接受，本函数 =
 * 「偶发情绪模拟（可能重规划一次）→ 幂等标记接受 → 可选直接进入 Learn」。
 * 评审收敛环保留为管理台手动工具，自动流程不再把它当阶段。
 */
export async function resolvePathReview(ctx: SimulationOrchestrator, sessionId: string, options: { startLearning?: boolean } = {}): Promise<{
  success: boolean;
  decision?: 'accept' | 'modify' | 'reject';
  currentStage?: string;
  learningPathId?: string;
  error?: string;
}> {
  const session = await ctx.getVirtualSession(sessionId);
  if (!session.learningPathId) {
    return { success: false, currentStage: 'path', error: '学习路径不存在，请先生成 Path' };
  }

  // 偶发情绪：可能触发一次「不满 → 重规划」（不阻塞；新路径 id 在下方重读）
  await maybeSimulatePathDislike(ctx, sessionId);

  const latest = await ctx.getVirtualSession(sessionId);
  const learningPathId = latest.learningPathId || session.learningPathId;
  const stageResults = parseStageResultsPayload(latest.stageResults);
  const alreadyAccepted = isPathReviewAlreadyAcceptedForCurrentPath(stageResults, learningPathId);
  if (!alreadyAccepted) {
    const pathReview = (stageResults.path_review || {}) as Record<string, unknown>;
    await ctx.updateStageResults(sessionId, 'path_review', {
      ...pathReview,
      status: 'accepted',
      decision: pathReview.decision ?? 'accept',
      reviewedPathId: learningPathId,
      acceptedBy: 'auto-review-gate-removed',
      acceptedAt: new Date().toISOString()
    });
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: { output: { from: 'path', to: 'path-accepted', reason: 'review-gate-removed-auto-accept', learningPathId } }
    });
  }
  if (!options.startLearning) {
    return { success: true, decision: 'accept', currentStage: 'path', learningPathId };
  }
  const learning = await ctx.startLearningPhase(sessionId);
  return {
    success: learning.success,
    decision: 'accept',
    currentStage: learning.success ? 'teaching' : 'path',
    learningPathId,
    error: learning.error
  };
}

