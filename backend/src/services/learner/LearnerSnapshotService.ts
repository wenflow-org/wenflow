import prisma from '../../config/database';
import { learnerProfileService } from './LearnerProfileService';
import { personalizationEngine } from '../../agents/learner-model-agent/personalization';
import learningStateService from '../learning/learning-state.service';
import type {
  LearnerDynamicState,
  LearnerLearningControlState,
  LearnerKnowledgeMemory,
  LearnerReplanSignal,
  LearnerSnapshot,
  LearnerTeachingHints,
} from '../../agents/learner-model-agent/types';
import { learnerKnowledgeMemoryService } from './LearnerKnowledgeMemoryService';

export interface LearnerSnapshotScopeInput {
  userId: string;
  learningPathId?: string;
  milestoneId?: string;
  taskId?: string;
  mode?: 'global' | 'path' | 'teaching';
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deriveFatigueRisk(lf: number): 'low' | 'medium' | 'high' {
  if (lf >= 6) return 'high';
  if (lf >= 3) return 'medium';
  return 'low';
}

/** SRL 三阶段（Zimmerman 2000）：活跃会话=performance，完结会话=reflection，否则=forethought */
function deriveSrlPhase(latestSession: { updatedAt?: Date; status?: string } | null): 'forethought' | 'performance' | 'self-reflection' {
  if (!latestSession) return 'forethought';
  if (latestSession.status === 'active' || latestSession.status === 'paused') return 'performance';
  return 'self-reflection';
}

/**
 * 全局节奏：只看"累积负荷/疲劳"（lf、ktl）。
 * - LSS 是**单课**压力，不在这里决定全局节奏（否则"今天这门课很难"会被当成"这周很累"）；
 *   单课压力的去处是课内控制状态（deriveLearningControlState）。
 * - "总负荷失衡"（`lsb < 0`，例如当天课多）**不在这里重复消费**：它已由两处各司其职地消费——
 *   难度判定里的 `global_imbalance`（降档）与重排信号里的 `lsb_negative`（建议减速/补强）。
 *   节奏只回答"该快还是该慢"，失衡走"要不要重排"。
 */
export function derivePacing(lf: number, ktl: number): 'slow' | 'moderate' | 'fast' {
  if (lf >= 6) return 'slow';
  if (ktl >= 5 && lf <= 3) return 'fast';
  return 'moderate';
}

function deriveSessionQuality(ktl: number, lf: number): 'strong' | 'mixed' | 'weak' {
  if (ktl >= 5 && lf <= 3) return 'strong';
  if (ktl <= 2 && lf >= 5) return 'weak';
  return 'mixed';
}

export function deriveLearningControlState(input: {
  dynamicState: LearnerDynamicState;
  knowledgeMemory: LearnerKnowledgeMemory;
  /**
   * 课内判断用的状态：优先取"本节课所在路径"的状态（该路径无历史时回退全局聚合）。
   * 全局聚合管节奏/疲劳，路径级管单课难易 —— 分母（同一路径的基线）对了，难易判断才有意义。
   */
  lessonMetrics?: { lss: number; ktl: number; lf: number; lsb: number };
}): LearnerLearningControlState {
  const { dynamicState, knowledgeMemory } = input;
  const lesson = input.lessonMetrics ?? dynamicState.metrics;
  const { lss, ktl, lf, lsb } = lesson;
  const fragileCount = knowledgeMemory.globalSignals.fragileConcepts.length;
  const strugglingCount = knowledgeMemory.globalSignals.strugglingConcepts.length;
  const prerequisiteGapCount = knowledgeMemory.currentPath?.prerequisiteGaps.length || 0;

  // 单课压力大 → 课内降档/加支架。
  // LSS 是**会话级**量：只有拿到了"本节课所在路径"的状态时才成立；
  // 该路径还没有历史时不借用别的路径的单课压力（跨路径污染），只保留全局疲劳这一路信号。
  const lessonStress = Boolean(input.lessonMetrics) && lss >= 6;

  const paceMode: LearnerLearningControlState['paceMode'] = lf >= 6 || lsb < 0 || lessonStress
    ? 'recover'
    : dynamicState.recentTrend === 'improving' && ktl >= 5 && lf <= 3 && lss <= 4
      ? 'push'
      : 'steady';

  const conceptLoad: LearnerLearningControlState['conceptLoad'] = lf >= 6 || lsb < 0 || lessonStress
    ? 'low'
    : dynamicState.recentTrend === 'improving' && ktl >= 6 && prerequisiteGapCount === 0
      ? 'high'
      : 'medium';

  const reviewPriority: LearnerLearningControlState['reviewPriority'] = prerequisiteGapCount > 0 || fragileCount > 0 || lsb < 0
    ? 'high'
    : strugglingCount > 0
      ? 'medium'
      : 'low';

  const checkpointNeed: LearnerLearningControlState['checkpointNeed'] = dynamicState.recentTrend === 'declining' || fragileCount > 0 || strugglingCount > 1
    ? 'high'
    : paceMode === 'push'
      ? 'low'
      : 'medium';

  return {
    paceMode,
    conceptLoad,
    reviewPriority,
    challengeLevelCap: paceMode === 'recover' ? 'low' : paceMode === 'push' ? 'high' : 'medium',
    checkpointNeed,
    shouldAvoidNewConcepts: conceptLoad === 'low',
    shouldPreferConsolidation: reviewPriority === 'high',
    shouldOfferBreak: lf >= 6 || dynamicState.fatigueRisk === 'high',
  };
}

export function deriveReplanSignal(input: {
  dynamicState: LearnerDynamicState;
  learningControlState: LearnerLearningControlState;
  knowledgeMemory: LearnerKnowledgeMemory;
}): LearnerReplanSignal {
  const { dynamicState, learningControlState, knowledgeMemory } = input;
  const fragileCount = knowledgeMemory.globalSignals.fragileConcepts.length;
  const strugglingCount = knowledgeMemory.globalSignals.strugglingConcepts.length;
  const blockedCount = knowledgeMemory.globalBackground.blockedFoundations.length;
  const prerequisiteGapCount = knowledgeMemory.currentPath?.prerequisiteGaps.length || 0;
  const reasonCodes: string[] = [];

  // 路径完成度：重规划建议的意义是「后续安排怎么走」；若当前路径已走完（下游无可调整阶段），
  // 再报「建议重排后续路径」既无动作对象、也与学习者已完成的事实矛盾。
  // 历史实测：全库 159 条 teaching 投影里 158 条恒 shouldSuggest=true，其中含 18/18 全完成、
  // 每课 5/5 的路径仍报 priority=high + resequence —— 判据只看「计数>0」，无完成度/量级归一。
  const progress = knowledgeMemory.currentPath?.progress;
  const totalTasks = progress?.totalTasks ?? 0;
  const completedTasks = progress?.completedTasks ?? 0;
  const pathFullyComplete = totalTasks > 0 && completedTasks >= totalTasks;
  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  // 结构性风险（阻塞基础/前置缺口）才是「重排后续」的正当理由；单纯脆弱的点属于课内补强，不构成重排。
  const structuralRisk = prerequisiteGapCount > 0 || blockedCount > 0;
  // 接近完成（≥90%）且无结构性风险时，也不值得为「重排后续」打断收尾。
  const nearCompleteNoStructural = !pathFullyComplete && completionRatio >= 0.9 && !structuralRisk;

  if (dynamicState.metrics.lf >= 6) reasonCodes.push('fatigue_high');
  if (dynamicState.metrics.lsb < 0) reasonCodes.push('lsb_negative');
  if (dynamicState.recentTrend === 'declining') reasonCodes.push('recent_trend_declining');
  if (fragileCount > 0) reasonCodes.push('fragile_concepts');
  if (strugglingCount > 0) reasonCodes.push('struggling_concepts');
  if (blockedCount > 0) reasonCodes.push('blocked_foundations');
  if (prerequisiteGapCount > 0) reasonCodes.push('prerequisite_gaps');
  if (pathFullyComplete) reasonCodes.push('path_completed');

  // highRisk：疲劳/失衡/结构性风险。**路径已完成或接近完成且无结构性风险时，不进入 high**——
  // 此时没有「后续路径」可重排，报 high 只会误导用户去做一次空转的重规划。
  const highRisk = (dynamicState.metrics.lf >= 6 || dynamicState.metrics.lsb < 0 || structuralRisk)
    && !pathFullyComplete
    && !nearCompleteNoStructural;
  // mediumRisk：非结构性但存在需补强的信号（脆弱/挣扎点、复习优先级高、趋势下滑）。
  // 接近完成且无结构性风险时也不进 medium——收尾阶段不再追加「补强建议」。
  const mediumRisk = !nearCompleteNoStructural
    && (learningControlState.reviewPriority === 'high' || fragileCount > 0 || strugglingCount > 0 || dynamicState.recentTrend === 'declining');
  // 加速资格：学习者级（总负荷 ktl/lf）+ 路径级（paceMode 不是 recover）+ 知识证据。
  // 不再看全局 `lss`：它 = 各路径里"最近一课最难"的那节课，用它给整个学习者判"能否加速"
  // 正是"单课量决定全局判断"的老毛病；路径是否吃力由 learningControlState.paceMode 表达。
  const accelerateReady = dynamicState.metrics.ktl >= 6
    && dynamicState.metrics.lf <= 3
    && learningControlState.paceMode !== 'recover'
    && fragileCount === 0
    && strugglingCount === 0;

  // 路径已完成：下游没有可「重排/减速」的阶段，任何重规划建议都是空转。
  // 明确回 keep（保留 reasonCodes 供观测），不再进 accelerate/high/medium 分支。
  if (pathFullyComplete) {
    return {
      shouldSuggest: false,
      priority: 'none',
      recommendation: 'keep',
      scope: 'none',
      rationale: '当前路径已完成，无可调整的后续阶段。',
      reasonCodes,
    };
  }

  if (accelerateReady) {
    return {
      shouldSuggest: true,
      priority: 'low',
      recommendation: 'accelerate',
      scope: 'next_milestone',
      rationale: '当前掌握较稳定，且近期压力与疲劳都较低，可以考虑把下一阶段调整为更聚焦的推进版本。',
      reasonCodes: ['stable_mastery', 'ready_to_accelerate'],
    };
  }

  if (highRisk) {
    return {
      shouldSuggest: true,
      priority: 'high',
      recommendation: prerequisiteGapCount > 0 || blockedCount > 0 ? 'resequence' : 'slow_down',
      scope: prerequisiteGapCount > 0 || blockedCount > 0 ? 'downstream_path' : 'next_milestone',
      rationale: '当前学习状态和知识风险都提示继续按原路径推进的成本偏高，建议先经过人工确认后再调整后续安排。',
      reasonCodes,
    };
  }

  if (mediumRisk) {
    return {
      shouldSuggest: true,
      priority: 'medium',
      recommendation: 'reinforce',
      scope: 'next_milestone',
      rationale: '当前存在不稳定知识点或学习趋势下滑，建议在进入下一阶段前先补强关键基础。',
      reasonCodes,
    };
  }

  return {
    shouldSuggest: false,
    priority: 'none',
    recommendation: 'keep',
    scope: 'none',
    rationale: '',
    reasonCodes: [],
  };
}

export class LearnerSnapshotService {
  async getSnapshot(input: LearnerSnapshotScopeInput): Promise<LearnerSnapshot> {
    const [{ profile, confidence }, knowledgeMemory, latestGoalEvidence, latestMetricAt, latestSession, latestCompletedTask] = await Promise.all([
      learnerProfileService.getProfile(input.userId),
      learnerKnowledgeMemoryService.build({
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
      }),
      prisma.learner_evidence.findFirst({
        where: { userId: input.userId, evidenceType: 'goal:understanding:updated' },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      learningStateService.getLatestCommittedStateAt(input.userId),
      prisma.teaching_sessions.findFirst({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, status: true },
      }),
      prisma.subtasks.findFirst({
        where: { userId: input.userId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const personalization = {
      config: personalizationEngine.generateConfig(profile),
      promptEnhancement: personalizationEngine.generatePromptEnhancement(profile),
      contentHints: personalizationEngine.generateContentHints(profile),
    };

    const metrics = profile.learning;
    // 课内（路径级）状态：全局 metrics 管节奏/疲劳，课内难度与支架按本路径状态判断
    const lessonScopePathId = input.learningPathId || knowledgeMemory.currentPath?.learningPathId || null;
    const lessonMetrics = await this.resolveLessonState(input.userId, lessonScopePathId);
    const dynamicState: LearnerDynamicState = {
      metrics: {
        lss: metrics.lss,
        ktl: metrics.ktl,
        lf: metrics.lf,
        lsb: metrics.lsb,
      },
      recentTrend: metrics.recentProgress,
      fatigueRisk: deriveFatigueRisk(metrics.lf),
      confidenceTrend: profile.emotional.confidenceLevel === 'anxious' ? 'falling' : profile.emotional.confidenceLevel === 'confident' ? 'rising' : 'stable',
      recentSessionQuality: deriveSessionQuality(metrics.ktl, metrics.lf),
      recommendedPacing: derivePacing(metrics.lf, metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
      // SRL 三阶段（Zimmerman 2000）：活跃会话=performance，刚完结=reflection，否则=forethought
      srlPhase: deriveSrlPhase(latestSession),
      lessonScopePathId,
      ...(lessonMetrics ? { lessonMetrics } : {}),
    };

    const currentPath = knowledgeMemory.currentPath
      ? {
          ...knowledgeMemory.currentPath,
          pathSummary: await this.resolvePathSummary(knowledgeMemory.currentPath.learningPathId),
        }
      : undefined;

    const teachingHints: LearnerTeachingHints = {
      promptEnhancement: personalization.promptEnhancement,
      recommendedApproach: profile.derivedInsights.suggestedApproach,
      emphasize: personalization.contentHints.emphasisAreas,
      avoid: personalization.contentHints.avoidFormats,
      riskFactors: profile.derivedInsights.riskFactors,
    };

    const finalKnowledgeMemory: LearnerKnowledgeMemory = {
      ...knowledgeMemory,
      ...(currentPath ? { currentPath } : {}),
    };
    const learningControlState = deriveLearningControlState({
      dynamicState,
      knowledgeMemory: finalKnowledgeMemory,
      lessonMetrics,
    });
    const replanSignal = deriveReplanSignal({
      dynamicState,
      learningControlState,
      knowledgeMemory: finalKnowledgeMemory,
    });

    return {
      snapshotVersion: 'learner-snapshot-v1',
      scope: {
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
        mode: input.mode || (input.taskId ? 'teaching' : input.learningPathId ? 'path' : 'global'),
      },
      freshness: {
        generatedAt: new Date().toISOString(),
        confidence,
        basedOn: {
          latestGoalConversationAt: latestGoalEvidence?.occurredAt?.toISOString(),
          latestMetricAt: latestMetricAt?.toISOString?.(),
          latestTeachingSessionAt: latestSession?.updatedAt?.toISOString(),
          latestTaskCompletionAt: latestCompletedTask?.completedAt?.toISOString(),
          latestPathUpdateAt: currentPath ? await this.resolvePathUpdatedAt(currentPath.learningPathId) : undefined,
        },
      },
      profile,
      dynamicState,
      learningControlState,
      replanSignal,
      knowledgeMemory: finalKnowledgeMemory,
      teachingHints,
    };
  }

  async previewSnapshotFromMetrics(input: LearnerSnapshotScopeInput & {
    metrics: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
    };
    generatedAt?: Date;
  }): Promise<LearnerSnapshot> {
    const [{ profile, confidence }, knowledgeMemory, latestConversation, latestSession, latestCompletedTask] = await Promise.all([
      learnerProfileService.getProfile(input.userId),
      learnerKnowledgeMemoryService.build({
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
      }),
      prisma.learner_evidence.findFirst({
        where: { userId: input.userId, evidenceType: 'goal:understanding:updated' },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      prisma.teaching_sessions.findFirst({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, status: true },
      }),
      prisma.subtasks.findFirst({
        where: { userId: input.userId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const personalization = {
      config: personalizationEngine.generateConfig(profile),
      promptEnhancement: personalizationEngine.generatePromptEnhancement(profile),
      contentHints: personalizationEngine.generateContentHints(profile),
    };

    // 课内（路径级）状态：全局 metrics 管节奏/疲劳，课内难度与支架按本路径状态判断
    const lessonScopePathId = input.learningPathId || knowledgeMemory.currentPath?.learningPathId || null;
    const lessonMetrics = await this.resolveLessonState(input.userId, lessonScopePathId);
    const dynamicState: LearnerDynamicState = {
      metrics: {
        lss: input.metrics.lss,
        ktl: input.metrics.ktl,
        lf: input.metrics.lf,
        lsb: input.metrics.lsb,
      },
      recentTrend: profile.learning.recentProgress,
      fatigueRisk: deriveFatigueRisk(input.metrics.lf),
      confidenceTrend: profile.emotional.confidenceLevel === 'anxious' ? 'falling' : profile.emotional.confidenceLevel === 'confident' ? 'rising' : 'stable',
      recentSessionQuality: deriveSessionQuality(input.metrics.ktl, input.metrics.lf),
      recommendedPacing: derivePacing(input.metrics.lf, input.metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
      srlPhase: deriveSrlPhase(latestSession),
      lessonScopePathId,
      ...(lessonMetrics ? { lessonMetrics } : {}),
    };

    const currentPath = knowledgeMemory.currentPath
      ? {
          ...knowledgeMemory.currentPath,
          pathSummary: await this.resolvePathSummary(knowledgeMemory.currentPath.learningPathId),
        }
      : undefined;

    const teachingHints: LearnerTeachingHints = {
      promptEnhancement: personalization.promptEnhancement,
      recommendedApproach: profile.derivedInsights.suggestedApproach,
      emphasize: personalization.contentHints.emphasisAreas,
      avoid: personalization.contentHints.avoidFormats,
      riskFactors: profile.derivedInsights.riskFactors,
    };

    const finalKnowledgeMemory: LearnerKnowledgeMemory = {
      ...knowledgeMemory,
      ...(currentPath ? { currentPath } : {}),
    };
    const learningControlState = deriveLearningControlState({
      dynamicState,
      knowledgeMemory: finalKnowledgeMemory,
      lessonMetrics,
    });
    const replanSignal = deriveReplanSignal({
      dynamicState,
      learningControlState,
      knowledgeMemory: finalKnowledgeMemory,
    });
    const generatedAt = input.generatedAt || new Date();

    return {
      snapshotVersion: 'learner-snapshot-v1',
      scope: {
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
        mode: input.mode || (input.taskId ? 'teaching' : input.learningPathId ? 'path' : 'global'),
      },
      freshness: {
        generatedAt: generatedAt.toISOString(),
        confidence,
        basedOn: {
          latestGoalConversationAt: latestConversation?.occurredAt?.toISOString(),
          latestMetricAt: generatedAt.toISOString(),
          latestTeachingSessionAt: latestSession?.updatedAt?.toISOString(),
          latestTaskCompletionAt: latestCompletedTask?.completedAt?.toISOString(),
          latestPathUpdateAt: currentPath ? await this.resolvePathUpdatedAt(currentPath.learningPathId) : undefined,
        },
      },
      profile,
      dynamicState,
      learningControlState,
      replanSignal,
      knowledgeMemory: finalKnowledgeMemory,
      teachingHints,
    };
  }

  /**
   * 课内（路径级）状态：本节课所在路径的最新状态。
   * 该路径还没有任何历史时返回 undefined（调用方回退到全局聚合 —— 与写入侧的"冷启动继承"同口径）。
   */
  private async resolveLessonState(
    userId: string,
    pathId?: string | null
  ): Promise<{ lss: number; ktl: number; lf: number; lsb: number } | undefined> {
    if (!pathId) return undefined;
    const state = await learningStateService.getCurrentState(userId, { pathId }).catch(() => null);
    if (!state) return undefined;
    return { lss: state.lss, ktl: state.ktl, lf: state.lf, lsb: state.lsb };
  }

  private async resolvePathSummary(learningPathId: string): Promise<string | null> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: learningPathId },
      select: { aiPromptTemplate: true },
    });

    const parsed = parseJsonSafe(path?.aiPromptTemplate);
    return typeof parsed?.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
  }

  private async resolvePathUpdatedAt(learningPathId: string): Promise<string | undefined> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: learningPathId },
      select: { updatedAt: true },
    });

    return path?.updatedAt?.toISOString();
  }
}

export const learnerSnapshotService = new LearnerSnapshotService();
