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

function derivePacing(lss: number, lf: number, ktl: number): 'slow' | 'moderate' | 'fast' {
  if (lf >= 6 || lss >= 6) return 'slow';
  if (ktl >= 5 && lf <= 3 && lss <= 4) return 'fast';
  return 'moderate';
}

function deriveSessionQuality(ktl: number, lf: number): 'strong' | 'mixed' | 'weak' {
  if (ktl >= 5 && lf <= 3) return 'strong';
  if (ktl <= 2 && lf >= 5) return 'weak';
  return 'mixed';
}

function deriveLearningControlState(input: {
  dynamicState: LearnerDynamicState;
  knowledgeMemory: LearnerKnowledgeMemory;
}): LearnerLearningControlState {
  const { dynamicState, knowledgeMemory } = input;
  const { lss, ktl, lf, lsb } = dynamicState.metrics;
  const fragileCount = knowledgeMemory.globalSignals.fragileConcepts.length;
  const strugglingCount = knowledgeMemory.globalSignals.strugglingConcepts.length;
  const prerequisiteGapCount = knowledgeMemory.currentPath?.prerequisiteGaps.length || 0;

  const paceMode: LearnerLearningControlState['paceMode'] = lf >= 6 || lsb < 0
    ? 'recover'
    : dynamicState.recentTrend === 'improving' && ktl >= 5 && lf <= 3 && lss <= 4
      ? 'push'
      : 'steady';

  const conceptLoad: LearnerLearningControlState['conceptLoad'] = lf >= 6 || lsb < 0
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

function deriveReplanSignal(input: {
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

  if (dynamicState.metrics.lf >= 6) reasonCodes.push('fatigue_high');
  if (dynamicState.metrics.lsb < 0) reasonCodes.push('lsb_negative');
  if (dynamicState.recentTrend === 'declining') reasonCodes.push('recent_trend_declining');
  if (fragileCount > 0) reasonCodes.push('fragile_concepts');
  if (strugglingCount > 0) reasonCodes.push('struggling_concepts');
  if (blockedCount > 0) reasonCodes.push('blocked_foundations');
  if (prerequisiteGapCount > 0) reasonCodes.push('prerequisite_gaps');

  const highRisk = dynamicState.metrics.lf >= 6 || dynamicState.metrics.lsb < 0 || prerequisiteGapCount > 0 || blockedCount > 0;
  const mediumRisk = learningControlState.reviewPriority === 'high' || fragileCount > 0 || strugglingCount > 0 || dynamicState.recentTrend === 'declining';
  const accelerateReady = dynamicState.metrics.ktl >= 6 && dynamicState.metrics.lf <= 3 && dynamicState.metrics.lss <= 4 && fragileCount === 0 && strugglingCount === 0;

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
        select: { updatedAt: true },
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
      recommendedPacing: derivePacing(metrics.lss, metrics.lf, metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
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
        select: { updatedAt: true },
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
      recommendedPacing: derivePacing(input.metrics.lss, input.metrics.lf, input.metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
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
