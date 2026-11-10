/**
 * LearningStateGuidanceService
 *
 * 为 learning-state 页面组装引导负载（adaptive-guidance/copy?view=learning-state）。
 *
 * 2026-11-06（#187）：本服务此前复用 dashboard 事件驱动快照的 copy（2026-09-27「行动建议统一」），
 * 实测后果是学习状态页拿到 dashboard 口径的文案——headline 是「欢迎回来…」式问候、
 * todayActions 里还带一条指回本页的「查看学习状态」自指深链，而本页真正需要的是
 * 「当前状态意味着什么 + 怎么调」。
 *
 * 现在本服务以 view='learning-state' 调用同一个 skill（skills/adaptive-guidance-copy），
 * 由提示词里的视图专属规则产出本页口径；dashboard 侧仍走自己的快照（view='dashboard'）。
 * 两个视图各有自己的生成路径与缓存，不再跨视图借文案。
 * 聚合结果保留 15 分钟内存缓存（stale-while-revalidate）。
 */

import {
  buildFallback,
  adaptiveGuidanceCopyDefinition,
  type AdaptiveGuidanceCopyOutput,
} from '../../skills/adaptive-guidance-copy';
import { executeSkillWithResult } from '../../skills';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import { learningDecisionFeedService, type LearningDecisionCard } from './LearningDecisionFeedService';
import { assembleLearningState } from './assemble-learning-state';
import { learnerProjectionService } from './LearnerProjectionService';
import { learnerStateReviewService, type LearnerStateReviewPayload } from './LearnerStateReviewService';
import { logger } from '../../utils/logger';

const CACHE_TTL_MS = 15 * 60 * 1000;
/** 本视图的取值（与 skills/adaptive-guidance-copy/views.ts 的 GUIDANCE_VIEWS 同源） */
const LEARNING_STATE_VIEW = 'learning-state' as const;

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
      /* 新学习者还没有快照：下游摘要/投影都按「有 snapshot」构造，直接访问 dynamicState
         会抛错并在日志里留下 refresh failed。没有快照就没有可给的建议，静默返回 null，
         由前端展示「完成第一次学习后…」的静态空态。 */
      if (!assembled.learnerSnapshot) return null;

      const { paths, sessions, primaryPath, learnerSnapshot, learningState, warnings, sessionWrapup } = assembled;

      const summary = learnerStateSummaryService.build({
        learnerSnapshot,
        learningState,
        path: primaryPath,
        warningCount: warnings.length,
      });

      // 呈现层投影：裁剪与文案无关的大字段（path 整行 / knowledgeMemory 明细），避免上下文膨胀
      const guidanceProjection = learnerProjectionService.toGuidanceProjection(learnerSnapshot, primaryPath);

      // #187：按本页视图（learning-state）生成，不再借用 dashboard 快照的 copy——
      // 两页语义不同（这里要的是状态解读与调节动作，不是首页问候与「继续上次学习」）。
      // 失败策略与 gateway 一致：executeSkillWithResult 抛错时用本视图静态兜底（buildFallback 同 view），
      // 不把整段引导吞掉。
      let copy: AdaptiveGuidanceCopyOutput;
      let source: 'model' | 'fallback';
      let debug: LearningStateGuidancePayload['debug'] = null;
      const startedAt = Date.now();
      try {
        const result = await executeSkillWithResult(adaptiveGuidanceCopyDefinition, {
          view: LEARNING_STATE_VIEW,
          learnerSnapshot: guidanceProjection.learnerSnapshot,
          learningState,
          path: guidanceProjection.path ?? undefined,
          // 收束摘要走投影：剔除 runtimeEnvelope 等运行时元数据（实测占 wrapup 的 5.6KB/12.8KB）
          sessionWrapup: learnerProjectionService.toGuidanceWrapup(sessionWrapup) ?? undefined,
          userId,
        });
        copy = result.output as AdaptiveGuidanceCopyOutput;
        // 与 dashboard 侧同口径：quality 存在时以它为准（'cache' 视同 model），缺失才看 cached
        source = result.quality
          ? (result.quality === 'model' || result.quality === 'cache' ? 'model' : 'fallback')
          : result.cached ? 'fallback' : 'model';
        debug = {
          skillId: result.debug?.skillId || 'adaptive-guidance-copy',
          model: result.debug?.model || null,
          systemPromptVersion: result.debug?.systemPromptVersion || null,
          durationMs: result.debug?.durationMs || result.duration || Date.now() - startedAt,
          cached: result.cached === true,
          generatedAt: new Date().toISOString(),
        };
      } catch (error: any) {
        copy = buildFallback({
          view: LEARNING_STATE_VIEW,
          learnerSnapshot: guidanceProjection.learnerSnapshot,
          learningState,
          path: guidanceProjection.path ?? undefined,
          // 收束摘要走投影：剔除 runtimeEnvelope 等运行时元数据（实测占 wrapup 的 5.6KB/12.8KB）
          sessionWrapup: learnerProjectionService.toGuidanceWrapup(sessionWrapup) ?? undefined,
        });
        source = 'fallback';
        logger.warn('[learning-state-guidance] skill failed, using static copy', {
          userId,
          error: error?.message || String(error),
        });
      }

      const decisions = learningDecisionFeedService.build({
        paths,
        sessions,
        learnerSnapshot,
        summary,
      });

      const generatedAt = new Date().toISOString();
      return {
        schemaVersion: 'learning-state-guidance-v1',
        view: LEARNING_STATE_VIEW,
        generatedAt,
        source,
        copy,
        summary,
        decisions,
        review: await loadLatestReview(userId, primaryPath?.id ?? null),
        debug,
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
