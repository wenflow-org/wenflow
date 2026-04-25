import prisma from '../../config/database';
import { learnerModelAgent } from '../../agents/learner-model-agent';
import type {
  LearnerDynamicState,
  LearnerKnowledgeMemory,
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

export class LearnerSnapshotService {
  async getSnapshot(input: LearnerSnapshotScopeInput): Promise<LearnerSnapshot> {
    const [{ profile, confidence }, personalization, knowledgeMemory, latestConversation, latestMetrics, latestSession, latestCompletedTask] = await Promise.all([
      learnerModelAgent.getProfile(input.userId),
      learnerModelAgent.getPersonalization(input.userId),
      learnerKnowledgeMemoryService.build({
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
      }),
      prisma.goal_conversations.findFirst({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.learning_metrics.findFirst({
        where: { userId: input.userId },
        orderBy: { calculatedAt: 'desc' },
        select: { calculatedAt: true },
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

    const metrics = profile.learning;
    const dynamicState: LearnerDynamicState = {
      metrics: {
        lss: metrics.lss,
        ktl: metrics.ktl,
        lf: metrics.lf,
        lsb: metrics.ktl - metrics.lf,
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
          latestGoalConversationAt: latestConversation?.createdAt?.toISOString(),
          latestMetricAt: latestMetrics?.calculatedAt?.toISOString(),
          latestTeachingSessionAt: latestSession?.updatedAt?.toISOString(),
          latestTaskCompletionAt: latestCompletedTask?.completedAt?.toISOString(),
          latestPathUpdateAt: currentPath ? await this.resolvePathUpdatedAt(currentPath.learningPathId) : undefined,
        },
      },
      profile,
      dynamicState,
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
