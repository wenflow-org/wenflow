/**
 * LearnerExitService —— profile-agent（learn agent）统一出口
 *
 * 中心化职责：作为 user 认知信息（画像/状态/记忆/负荷/账户）的唯一权威出口，
 * teaching/path 等其他 agent 需要学习者信息时统一经本服务获取，禁止直查
 * learner_evidence / memory_traces / student_baselines 源表（边界契约 B2）。
 *
 * 出口 = LearnerSnapshot（getSnapshot 纯净视图）+ exit 增量字段：
 * - dueReview：到期复习点（记忆引擎 M2，供开课注入/复习调度）
 * - accountView：账户信息（name/xp/level，level 单点公式）
 * - 预留：loadIndexAgg（阶段 7）、budget（阶段 8）
 */
import prisma from '../../config/database';
import { learnerSnapshotService, LearnerSnapshotService } from './LearnerSnapshotService';
import { memoryTraceService } from '../memory/memory-trace.service';
import { getLevelFromXp } from './level.util';
import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';

export interface LearnerExitDueReviewItem {
  conceptKey: string;
  label: string | null;
  masteryScore: number;
  retention: number;
  reason: string;
  extractionCount: number;
}

export interface LearnerExitAccountView {
  name: string | null;
  xp: number;
  level: number;
}

export interface LearnerExitView {
  snapshot: LearnerSnapshot;
  dueReview: LearnerExitDueReviewItem[];
  accountView: LearnerExitAccountView;
}

/**
 * 交错排序：相邻复习项不共享 conceptKey（交错学习——训练学生从题目特征自主判断策略）。
 * 贪心轮转：按 conceptKey 分组后轮流取，保证同概念不连续出现。
 */
function interleaveByConcept<T extends { conceptKey: string }>(items: T[], limit: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.conceptKey || '';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const result: T[] = [];
  const keys = Array.from(buckets.keys());
  let added = true;
  while (result.length < limit && added) {
    added = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket && bucket.length > 0) {
        result.push(bucket.shift()!);
        added = true;
        if (result.length >= limit) break;
      }
    }
  }
  return result;
}

export interface LearnerExitScope {
  userId: string;
  learningPathId?: string | null;
  milestoneId?: string | null;
  taskId?: string | null;
  mode?: 'global' | 'path' | 'teaching';
}

export class LearnerExitService {
  constructor(
    private readonly snapshotService: LearnerSnapshotService = learnerSnapshotService,
  ) {}

  /** 统一出口：snapshot + dueReview + accountView（并行拉取） */
  async getLearnerContext(scope: LearnerExitScope): Promise<LearnerExitView> {
    const [snapshot, dueReview, accountView] = await Promise.all([
      this.snapshotService.getSnapshot({
        userId: scope.userId,
        learningPathId: scope.learningPathId ?? undefined,
        milestoneId: scope.milestoneId ?? undefined,
        taskId: scope.taskId ?? undefined,
        mode: scope.mode,
      }),
      this.getDueReview(scope.userId),
      this.getAccountView(scope.userId),
    ]);

    return { snapshot, dueReview, accountView };
  }

  /** 到期复习点（记忆引擎 M2 的只读出口；交错排序：相邻项不共享 conceptKey，训练策略选择） */
  async getDueReview(userId: string, limit = 5): Promise<LearnerExitDueReviewItem[]> {
    // 获取更多候选（2×），以便交错后仍有足够条目
    const traces = await memoryTraceService.getDueTraces(userId, { limit: Math.max(limit, limit * 2) });
    const items = traces.map((t) => ({
      conceptKey: t.conceptKey,
      label: t.label,
      masteryScore: t.masteryScore,
      retention: t.retention,
      reason: t.reason,
      extractionCount: t.extractionCount,
    }));

    // 交错排序：相邻复习项不共享 conceptKey（交错学习——训练学生从题目特征自主判断策略）
    const interleaved = interleaveByConcept(items, limit);
    return interleaved;
  }

  /** 账户视图：name/xp/level（level 单点公式，替代散落的 Math.floor(Math.sqrt(xp/100))+1） */
  async getAccountView(userId: string): Promise<LearnerExitAccountView> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { name: true, xp: true },
    });
    const xp = user?.xp ?? 0;
    return {
      name: user?.name ?? null,
      xp,
      level: getLevelFromXp(xp),
    };
  }
}

export const learnerExitService = new LearnerExitService();
