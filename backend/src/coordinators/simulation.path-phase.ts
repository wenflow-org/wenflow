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
  mergeLearnerState,
  parseProfileData,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
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
  const personaData = safeJsonParse<Record<string, unknown>>(session.virtual_learner_profiles.profile, {});
  const learnerLoadProfile = {
    availableTime: typeof personaData.availableTime === 'string' ? personaData.availableTime : null,
    loadTolerance: typeof personaData.cognitiveLoadTolerance === 'string' ? personaData.cognitiveLoadTolerance : null,
  };
  const request: GoalPathRequest = {
    userId: session.userId,
    sourceConversationId: session.goalConversationId as string,
    source: 'goal',
    rawGoal: pathRawGoal.rawGoal,
    learnerLoadProfile: learnerLoadProfile.availableTime || learnerLoadProfile.loadTolerance ? learnerLoadProfile : null,
    visibleSummary: buildGoalPathVisibleSummary({
      understanding: collectedData.understanding || {},
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
export async function resolvePathReview(ctx: SimulationOrchestrator, sessionId: string, options: { startLearning?: boolean } = {}): Promise<{
  success: boolean;
  decision?: 'accept' | 'modify' | 'reject';
  currentStage?: string;
  learningPathId?: string;
  error?: string;
}> {
  // 护栏谱系必须在 reviewPathProposal 之前快照：该调用会整块重写 path_review（status→pending），
  // 把 replan.resultPathId 冲掉，导致「已对当前 Path 重规划过」永远判不出来（本次修复的根因）。
  const preSession = await ctx.getVirtualSession(sessionId);
  const preReviewState: any = parseStageResultsPayload(preSession.stageResults).path_review || {};
  const replanCount = await ctx.countSessionLogsByPhase(sessionId, 'path-replan');

  // 幂等短路（虚拟学习者跑数观察 #1）：当前 Path 已（含 force）接受过评审 → **不重跑评审 LLM**，
  // 只重试"进入 Learn"。否则每次 advance-day 都要白跑一次评审并反复触顶 replan 上限。
  const alreadyAcceptedForCurrentPath = isPathReviewAlreadyAcceptedForCurrentPath(
    parseStageResultsPayload(preSession.stageResults),
    preSession.learningPathId
  );
  if (alreadyAcceptedForCurrentPath) {
    if (!options.startLearning) {
      return { success: true, decision: 'accept', currentStage: 'path', learningPathId: preSession.learningPathId };
    }
    const learning = await ctx.startLearningPhase(sessionId);
    return {
      success: learning.success,
      decision: 'accept',
      currentStage: learning.success ? 'teaching' : 'path',
      learningPathId: preSession.learningPathId,
      error: learning.error
    };
  }

  const review = await ctx.reviewPathProposal(sessionId);
  // 评审是**独立旁路**，不做关节守卫：评审失败不阻断 Learn——视为"接受当前 Path"并继续。
  const reviewFailed = !review.success || !review.decision;
  const decision: 'accept' | 'modify' | 'reject' = reviewFailed
    ? 'accept'
    : (review.decision as 'accept' | 'modify' | 'reject');

  const session = await ctx.getVirtualSession(sessionId);

  // 收敛护栏：见 MAX_PATH_REPLANS 注释
  const pathReviewState: any = parseStageResultsPayload(session.stageResults).path_review || {};
  const forceAccept = reviewFailed || shouldForceAcceptPathReview({
    decision,
    learningPathId: session.learningPathId,
    replanResultPathId: preReviewState?.replan?.resultPathId ?? null,
    replanCount
  });

  if (forceAccept) {
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'path-replan-guard',
      details: {
        output: {
          reason: reviewFailed
            ? 'review-failed-non-blocking'
            : (Boolean(preReviewState?.replan?.resultPathId) && preReviewState.replan.resultPathId === session.learningPathId)
              ? 'path-unchanged-after-replan'
              : 'replan-limit-reached',
          decision,
          replanCount,
          limit: MAX_PATH_REPLANS,
          learningPathId: session.learningPathId,
          // 保留学生原始质疑，便于人工复核（护栏不删证据）
          learnerReaction: pathReviewState?.reaction || null,
          visibleRequestedChanges: Array.isArray(pathReviewState?.visibleRequestedChanges)
            ? pathReviewState.visibleRequestedChanges
            : []
        }
      }
    });
    logger.warn('[simulation-coordinator] 评审按旁路处理（不阻断 Learn）', {
      sessionId,
      reviewFailed,
      replanCount,
      limit: MAX_PATH_REPLANS,
      alreadyReplannedThisPath: Boolean(preReviewState?.replan?.resultPathId) && preReviewState.replan.resultPathId === session.learningPathId,
      decision
    });
  }

  if (decision === 'accept' || forceAccept) {
    const accepted = await ctx.acceptPathReview(sessionId, { force: forceAccept });
    if (!accepted.success) return { success: false, decision, error: accepted.error };
    if (!options.startLearning) {
      return { success: true, decision: forceAccept ? 'accept' : decision, currentStage: 'path', learningPathId: session.learningPathId };
    }
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: { output: { from: 'path', to: 'teaching', reason: forceAccept ? 'path-review-force-accepted' : 'path-review-accepted', learningPathId: session.learningPathId } }
    });
    const learning = await ctx.startLearningPhase(sessionId);
    return {
      success: learning.success,
      decision: forceAccept ? 'accept' : decision,
      currentStage: learning.success ? 'teaching' : 'path',
      learningPathId: session.learningPathId,
      error: learning.error
    };
  }

  const replanned = await ctx.replanPathFromReview(sessionId);
  if (replanned.success) {
    return {
      success: true,
      decision,
      currentStage: 'path',
      learningPathId: replanned.learningPathId
    };
  }

  // 重规划失败不能把学习堵死：评审是独立质量旁路（见 startLearningPhase 注释），
  // Path 存在即可进入 Learn。强制接受当前 Path，并在请求了 startLearning 时继续启动。
  await ctx.addSessionLog(sessionId, {
    timestamp: new Date().toISOString(),
    phase: 'path-replan-guard',
    details: {
      output: {
        reason: 'replan-failed-force-accept',
        decision,
        error: replanned.error || null,
        learningPathId: session.learningPathId
      }
    }
  });
  logger.warn('[simulation-coordinator] 重规划失败，强制接受当前 Path 以解除学习阻塞', {
    sessionId,
    decision,
    error: replanned.error || null
  });
  const fallbackAccepted = await ctx.acceptPathReview(sessionId, { force: true });
  if (!fallbackAccepted.success) return { success: false, decision, error: fallbackAccepted.error };
  if (!options.startLearning) {
    return { success: true, decision: 'accept', currentStage: 'path', learningPathId: session.learningPathId };
  }
  await ctx.addSessionLog(sessionId, {
    timestamp: new Date().toISOString(),
    phase: 'stage-transition',
    details: { output: { from: 'path', to: 'teaching', reason: 'path-replan-failed-force-accepted', learningPathId: session.learningPathId } }
  });
  const learning = await ctx.startLearningPhase(sessionId);
  return {
    success: learning.success,
    decision: 'accept',
    currentStage: learning.success ? 'teaching' : 'path',
    learningPathId: session.learningPathId,
    error: learning.error
  };
}

