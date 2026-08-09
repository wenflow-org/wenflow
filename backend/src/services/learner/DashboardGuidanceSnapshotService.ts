import prisma from '../../config/database';
import { executeSkill } from '../../skills';
import { adaptiveGuidanceCopyDefinition, type AdaptiveGuidanceCopyOutput } from '../../skills/adaptive-guidance-copy';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import { assembleLearningState } from './assemble-learning-state';
import stateTrackingService from '../learning/learning-state.service';
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';

export type DashboardGuidanceTrigger =
  | 'path-created'
  | 'task-completed'
  | 'lesson-wrapup'
  | 'path-replanned'
  | 'path-deleted'
  | 'manual';

export interface DashboardGuidanceSnapshotPayload {
  schemaVersion: 'dashboard-guidance-v1';
  view: 'dashboard';
  generatedAt: string;
  trigger: DashboardGuidanceTrigger;
  pathId: string | null;
  source: 'model' | 'fallback';
  copy: AdaptiveGuidanceCopyOutput;
  summary: LearnerStateSummaryOutput;
  debug?: {
    skillId: string;
    model: string | null;
    systemPromptVersion: number | null;
    durationMs: number;
    cached: boolean;
    generatedAt: string;
  } | null;
  freshness?: {
    latestGoalConversationAt?: string;
    latestMetricAt?: string;
    latestTeachingSessionAt?: string;
    latestTaskCompletionAt?: string;
    latestPathUpdateAt?: string;
  };
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

class DashboardGuidanceSnapshotService {
  private refreshQueues = new Map<string, Promise<DashboardGuidanceSnapshotPayload | null>>();

  async get(userId: string): Promise<DashboardGuidanceSnapshotPayload | null> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { dashboardGuidanceSnapshot: true },
    });
    return parseJsonSafe<DashboardGuidanceSnapshotPayload>(user?.dashboardGuidanceSnapshot);
  }

  async clear(userId: string): Promise<void> {
    await prisma.users.update({
      where: { id: userId },
      data: { dashboardGuidanceSnapshot: null },
    });
  }

  async backfillMissingForActiveUsers(limit = 100): Promise<{ total: number; refreshed: number }> {
    const users = await prisma.users.findMany({
      where: {
        dashboardGuidanceSnapshot: null,
        learning_paths: {
          some: { status: 'active' },
        },
      },
      select: { id: true },
      take: Math.max(1, Math.min(500, limit)),
      orderBy: { updatedAt: 'desc' },
    });

    let refreshed = 0;
    for (const user of users) {
      const result = await this.refresh(user.id, 'manual');
      if (result) refreshed += 1;
    }

    return {
      total: users.length,
      refreshed,
    };
  }

  async refresh(userId: string, trigger: DashboardGuidanceTrigger): Promise<DashboardGuidanceSnapshotPayload | null> {
    const queued = this.refreshQueues.get(userId) || Promise.resolve(null);
    const next = queued
      .catch(() => null)
      .then(() => this.performRefresh(userId, trigger));

    this.refreshQueues.set(userId, next);

    void next.then(() => {
      if (this.refreshQueues.get(userId) === next) {
        this.refreshQueues.delete(userId);
      }
    }, () => {
      if (this.refreshQueues.get(userId) === next) {
        this.refreshQueues.delete(userId);
      }
    });

    return next;
  }

  refreshInBackground(userId: string, trigger: DashboardGuidanceTrigger): void {
    runBackgroundTask(
      'dashboard-guidance.refresh',
      () => this.refresh(userId, trigger),
      { userId, trigger }
    );
  }

  private async performRefresh(
    userId: string,
    trigger: DashboardGuidanceTrigger
  ): Promise<DashboardGuidanceSnapshotPayload | null> {
    try {
      // 共享聚合（去冗余）：四表查询/统计/learningState 构造统一走 assembleLearningState
      const assembled = await assembleLearningState(userId, { snapshotScope: 'path' });
      if (!assembled) return null;

      const { primaryPath, learnerSnapshot, learningState, sessionWrapup, advisory, warnings } = assembled;
      if (!primaryPath) {
        await this.clear(userId);
        return null;
      }

      const summary = learnerStateSummaryService.build({
        learnerSnapshot,
        learningState,
        path: primaryPath,
        warningCount: warnings.length,
      });

      // v4 §5.2：统一经 executeSkill 入口（遥测/用户级开关/归一化），禁止直连 handler
      const result = await executeSkill(adaptiveGuidanceCopyDefinition, {
        view: 'dashboard',
        learnerSnapshot,
        learningState,
        path: primaryPath,
        sessionWrapup,
        advisory,
        userId,
      });

      const generatedAt = new Date().toISOString();
      const payload: DashboardGuidanceSnapshotPayload = {
        schemaVersion: 'dashboard-guidance-v1',
        view: 'dashboard',
        generatedAt,
        trigger,
        pathId: primaryPath.id,
        source: result.quality
          ? (result.quality === 'model' || result.quality === 'cache' ? 'model' : 'fallback')
          : result.cached ? 'fallback' : 'model',
        copy: result.output,
        summary,
        debug: {
          skillId: result.debug?.skillId || 'adaptive-guidance-copy',
          model: result.debug?.model || null,
          systemPromptVersion: result.debug?.systemPromptVersion || null,
          durationMs: result.debug?.durationMs || result.duration || 0,
          cached: result.cached === true,
          generatedAt,
        },
        freshness: learnerSnapshot.freshness?.basedOn,
      };

      await prisma.users.update({
        where: { id: userId },
        data: {
          dashboardGuidanceSnapshot: JSON.stringify(payload),
        },
      });

      return payload;
    } catch (error: any) {
      logger.warn('[dashboard-guidance-snapshot] refresh failed', {
        userId,
        trigger,
        error: error?.message || String(error),
      });
      return null;
    }
  }
}

export const dashboardGuidanceSnapshotService = new DashboardGuidanceSnapshotService();
export default dashboardGuidanceSnapshotService;
