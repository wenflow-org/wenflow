/**
 * LearningStateGuidanceService
 *
 * 为 learning-state 页面按需生成 skill 引导文案（adaptive-guidance-copy，view='learning-state'）。
 * 与 DashboardGuidanceSnapshotService 的事件驱动快照不同，这里采用"按需生成 + 15 分钟内存缓存"：
 * learning-state 是低频页面，每次进入都打 LLM 不值当；缓存命中则零延迟返回。
 * LLM/网关失败时 skill 内部会自动产出 learning-state 版 fallback 文案（source='fallback'）。
 */

import prisma from '../../config/database';
import { executeSkill } from '../../skills';
import { adaptiveGuidanceCopyDefinition, type AdaptiveGuidanceCopyOutput } from '../../skills/adaptive-guidance-copy';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import { learningDecisionFeedService, type LearningDecisionCard } from './LearningDecisionFeedService';
import stateTrackingService from '../learning/learning-state.service';
import { logger } from '../../utils/logger';

const CACHE_TTL_MS = 15 * 60 * 1000;

export interface LearningStateGuidancePayload {
  schemaVersion: 'learning-state-guidance-v1';
  view: 'learning-state';
  generatedAt: string;
  source: 'model' | 'fallback';
  copy: AdaptiveGuidanceCopyOutput;
  summary: LearnerStateSummaryOutput;
  /** AI 决策记录：捕获 → 判断 → 动作（LearningDecisionFeedService 组装） */
  decisions: LearningDecisionCard[];
  debug?: {
    skillId: string;
    model: string | null;
    systemPromptVersion: number | null;
    durationMs: number;
    cached: boolean;
    generatedAt: string;
  } | null;
}

interface CacheEntry {
  at: number;
  payload: LearningStateGuidancePayload;
}

class LearningStateGuidanceService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<LearningStateGuidancePayload | null>>();

  /** 读缓存；过期/缺失则同步刷新。 */
  async get(userId: string, options: { forceRefresh?: boolean } = {}): Promise<LearningStateGuidancePayload | null> {
    const hit = this.cache.get(userId);
    if (!options.forceRefresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.payload;
    }
    return this.refresh(userId);
  }

  async refresh(userId: string): Promise<LearningStateGuidancePayload | null> {
    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const task = this.perform(userId)
      .then((payload) => {
        if (payload) this.cache.set(userId, { at: Date.now(), payload });
        return payload;
      })
      .finally(() => {
        if (this.inflight.get(userId) === task) this.inflight.delete(userId);
      });

    this.inflight.set(userId, task);
    return task;
  }

  private async perform(userId: string): Promise<LearningStateGuidancePayload | null> {
    try {
      const [user, paths, subtasks, sessions] = await Promise.all([
        prisma.users.findUnique({
          where: { id: userId },
          select: { id: true, name: true, xp: true },
        }),
        prisma.learning_paths.findMany({
          where: { userId, status: 'active' },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                  select: { id: true, title: true, status: true, estimatedMinutes: true },
                },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
        }),
        prisma.subtasks.findMany({
          where: { userId },
          select: { status: true, estimatedMinutes: true },
        }),
        prisma.teaching_sessions.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { duration: true, startTime: true, endTime: true, wrapup: true, advisory: true, updatedAt: true, status: true },
          take: 10,
        }),
      ]);

      if (!user) return null;

      const primaryPath = paths.find((path) =>
        path.milestones.some((stage) => (stage.subtasks || []).some((task) => task.status !== 'completed'))
      ) || paths[0] || null;

      const learnerSnapshot = await learnerSnapshotRefreshService.refresh({ userId, scope: 'global' });

      const warnings = await stateTrackingService.checkWarnings(userId).catch(() => []);
      const currentState = await stateTrackingService.getCurrentStateDisplay(userId).catch(() => null);
      const suggestion = currentState ? stateTrackingService.generateDisplaySuggestion(currentState) : null;

      const completedCount = subtasks.filter((t) => t.status === 'completed').length;
      const inProgressCount = subtasks.filter((t) => t.status === 'in_progress').length;
      const todoCount = subtasks.filter((t) => t.status === 'todo').length;
      const totalEstimated = subtasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
      const totalMinutes = sessions.reduce((sum, session) => {
        if (session.endTime) {
          return sum + Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000));
        }
        if ((session.duration || 0) > 24 * 60) return sum + Math.round((session.duration || 0) / 60);
        return sum + Math.max(0, session.duration || 0);
      }, 0);
      const activeDays = new Set(sessions.map((s) => s.startTime.toISOString().split('T')[0])).size;

      let sessionWrapup: unknown = null;
      if (sessions[0]?.wrapup) {
        try {
          sessionWrapup = JSON.parse(sessions[0].wrapup);
        } catch {
          sessionWrapup = null;
        }
      }

      const learningState = {
        user: { id: user.id, name: user.name, xp: user.xp, level: Math.floor(Math.sqrt(user.xp / 100)) + 1 },
        tasks: {
          total: subtasks.length,
          completed: completedCount,
          inProgress: inProgressCount,
          todo: todoCount,
          completionRate: subtasks.length ? Number(((completedCount / subtasks.length) * 100).toFixed(1)) : 0,
        },
        paths: { total: paths.length },
        time: {
          totalMinutes,
          totalEstimated,
          totalCompleted: totalMinutes,
          activeLearningDays: activeDays,
          avgDailyMinutes: activeDays ? Number((totalMinutes / activeDays).toFixed(1)) : 0,
          progress: subtasks.length ? Number(((completedCount / subtasks.length) * 100).toFixed(1)) : 0,
          completionRate: subtasks.length ? ((completedCount / subtasks.length) * 100).toFixed(1) : '0',
        },
        state: currentState,
        suggestion,
      };

      const summary = learnerStateSummaryService.build({
        learnerSnapshot,
        learningState,
        path: primaryPath,
        warningCount: warnings.length,
      });

      // v4 §5.2：统一经 executeSkill 入口（遥测/用户级开关/归一化），禁止直连 handler
      const result = await executeSkill(adaptiveGuidanceCopyDefinition, {
        view: 'learning-state',
        learnerSnapshot,
        learningState,
        path: primaryPath ?? undefined,
        sessionWrapup: sessionWrapup ?? undefined,
        userId,
      });

      const decisions = learningDecisionFeedService.build({
        paths,
        sessions,
        learnerSnapshot,
        summary,
      });

      const generatedAt = new Date().toISOString();
      return {
        schemaVersion: 'learning-state-guidance-v1',
        view: 'learning-state',
        generatedAt,
        source: result.quality
          ? (result.quality === 'model' || result.quality === 'cache' ? 'model' : 'fallback')
          : result.cached ? 'fallback' : 'model',
        copy: result.output,
        summary,
        decisions,
        debug: {
          skillId: result.debug?.skillId || 'adaptive-guidance-copy',
          model: result.debug?.model || null,
          systemPromptVersion: result.debug?.systemPromptVersion || null,
          durationMs: result.debug?.durationMs || result.duration || 0,
          cached: result.cached === true,
          generatedAt,
        },
      };
    } catch (error: any) {
      logger.warn('[learning-state-guidance] refresh failed', { userId, error: error?.message || String(error) });
      return null;
    }
  }
}

export const learningStateGuidanceService = new LearningStateGuidanceService();
export default learningStateGuidanceService;
