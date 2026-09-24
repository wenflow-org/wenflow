/**
 * LearningStateGuidanceService
 *
 * 为 learning-state 页面按需生成 skill 引导文案（adaptive-guidance-copy，view='learning-state'）。
 * 与 DashboardGuidanceSnapshotService 的事件驱动快照不同，这里采用"按需生成 + 15 分钟内存缓存"：
 * learning-state 是低频页面，每次进入都打 LLM 不值当；缓存命中则零延迟返回。
 * LLM/网关失败时 skill 内部会自动产出 learning-state 版 fallback 文案（source='fallback'）。
 */

import { executeSkillWithResult } from '../../skills';
import { adaptiveGuidanceCopyDefinition, type AdaptiveGuidanceCopyOutput } from '../../skills/adaptive-guidance-copy';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import { learningDecisionFeedService, type LearningDecisionCard } from './LearningDecisionFeedService';
import { assembleLearningState } from './assemble-learning-state';
import { learnerProjectionService } from './LearnerProjectionService';
import { learnerStateReviewService, type LearnerStateReviewPayload } from './LearnerStateReviewService';
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
  /** 状态评审诊断（诊断层闭环）；无则 null */
  review?: LearnerStateReviewPayload | null;
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

  /**
   * 读缓存；过期/缺失则刷新。
   * - 命中且未过期：直接返回
   * - 命中但已过期：**先返回旧值**，后台刷新（stale-while-revalidate）。
   *   动机（2026-09-24 走查）：网关侧慢调用实测到过 114s，而前端 60s 就超时——同步刷新会把
   *   已经存在的建议整段吞掉，页面回落成"完成第一次学习后…"（对已有学习记录的学员是错误信息）。
   * - 冷缓存/强制刷新：同步刷新（首次没有旧值可给）
   */
  async get(userId: string, options: { forceRefresh?: boolean } = {}): Promise<LearningStateGuidancePayload | null> {
    const hit = this.cache.get(userId);
    if (!options.forceRefresh && hit) {
      if (Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;
      void this.refresh(userId).catch(() => undefined);
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
      // 共享聚合（去冗余）：四表查询/统计/learningState 构造统一走 assembleLearningState
      const assembled = await assembleLearningState(userId, { snapshotScope: 'global', pathsTake: 3 });
      if (!assembled) return null;

      const { paths, sessions, primaryPath, learnerSnapshot, learningState, warnings, sessionWrapup } = assembled;

      const summary = learnerStateSummaryService.build({
        learnerSnapshot,
        learningState,
        path: primaryPath,
        warningCount: warnings.length,
      });

      // 呈现层投影：裁剪与文案无关的大字段（path 整行 / knowledgeMemory 明细），避免上下文膨胀
      const guidanceProjection = learnerProjectionService.toGuidanceProjection(learnerSnapshot, primaryPath);

      // v4 §5.2：统一经 executeSkillWithResult 入口（遥测/用户级开关/归一化），
      // 需读取 quality/debug/output，故用返回完整结果的版本（executeSkill 会拆包只留 output）。
      const result = await executeSkillWithResult(adaptiveGuidanceCopyDefinition, {
        view: 'learning-state',
        learnerSnapshot: guidanceProjection.learnerSnapshot,
        learningState,
        path: guidanceProjection.path ?? undefined,
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
        review: await loadLatestReview(userId, primaryPath?.id ?? null),
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

async function loadLatestReview(userId: string, pathId: string | null): Promise<LearnerStateReviewPayload | null> {
  try {
    return await learnerStateReviewService.getLatest(userId, pathId);
  } catch {
    return null;
  }
}

export const learningStateGuidanceService = new LearningStateGuidanceService();
export default learningStateGuidanceService;
