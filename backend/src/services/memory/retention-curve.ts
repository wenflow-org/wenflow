/**
 * 「保持率 × 间隔」曲线（P0-3：最小结果测量层）
 *
 * 问题：系统此前**没有任何结果测量**——只有过程代理（"状态理由是否复发"），
 * 于是"隔多久还记不记得"无法回答，调度参数（FSRS）也无法本地校准。
 *
 * 做法（不新增表、不新增测验）：复习/温故结果本来就带 `elapsedDays`（距上次接触的间隔），
 * 把它按间隔分桶后统计检索成功率，就得到一条**观测性**的保持曲线。
 *
 * ⚠️ 口径边界（必须随结论一起给出）：
 * - 这是**观测数据**，不是随机实验：什么点在什么间隔被回顾，是由调度器（按稳定性/到期）
 *   和当天配额共同决定的，与概念难度、掌握度相关 → **不能**把"间隔越长成功率越低"直接读成因果。
 * - 因此本曲线只用于：① 描述现状 ② 给 FSRS 参数本地化提供拟合数据 ③ 作为随机实验（E1–E3）的基线。
 * - 真正的因果结论需要随机分配间隔（见审计文档 §8）。
 */

/** 间隔分桶（天）：按调度上的实际量级切，末桶为长尾 */
export const RETENTION_BUCKETS = ['0-0.5d', '0.5-1d', '1-3d', '3-7d', '7-14d', '14-30d', '>30d', 'unknown'] as const;
export type RetentionBucket = (typeof RETENTION_BUCKETS)[number];

export const RETENTION_BUCKET_EXPLANATION: Record<RetentionBucket, string> = {
  '0-0.5d': '当天重复（多为同课多轮）',
  '0.5-1d': '次日',
  '1-3d': '短期巩固',
  '3-7d': '一周内',
  '7-14d': '两周内',
  '14-30d': '一月内',
  '>30d': '长尾（积压/久未复习）',
  unknown: '首次接触或旧数据（无间隔字段）',
};

export interface RetentionObservation {
  elapsedDays: number | null | undefined;
  /** FSRS 语义评分 */
  rating: 'again' | 'hard' | 'good' | 'easy' | string;
  masteryScore?: number | null;
}

export interface RetentionBucketStat {
  bucket: RetentionBucket;
  total: number;
  success: number;
  successRate: number | null;
  avgMastery: number | null;
}

export function retentionBucketOf(elapsedDays: number | null | undefined): RetentionBucket {
  if (elapsedDays === null || elapsedDays === undefined) return 'unknown';
  const days = Number(elapsedDays);
  if (!Number.isFinite(days) || days < 0) return 'unknown';
  if (days <= 0.5) return '0-0.5d';
  if (days <= 1) return '0.5-1d';
  if (days <= 3) return '1-3d';
  if (days <= 7) return '3-7d';
  if (days <= 14) return '7-14d';
  if (days <= 30) return '14-30d';
  return '>30d';
}

/** 检索成功口径与动态预算保持一致：good / easy 视为成功（hard 与 again 计入失败） */
export function isRetrievalSuccess(rating: string): boolean {
  return rating === 'good' || rating === 'easy';
}

export function buildRetentionCurve(observations: RetentionObservation[]): RetentionBucketStat[] {
  const acc = new Map<RetentionBucket, { total: number; success: number; masterySum: number; masteryN: number }>();
  for (const bucket of RETENTION_BUCKETS) {
    acc.set(bucket, { total: 0, success: 0, masterySum: 0, masteryN: 0 });
  }
  for (const observation of observations) {
    const bucket = retentionBucketOf(observation.elapsedDays);
    const entry = acc.get(bucket)!;
    entry.total += 1;
    if (isRetrievalSuccess(String(observation.rating))) entry.success += 1;
    const mastery = Number(observation.masteryScore);
    if (Number.isFinite(mastery)) {
      entry.masterySum += mastery;
      entry.masteryN += 1;
    }
  }
  return RETENTION_BUCKETS.map((bucket) => {
    const entry = acc.get(bucket)!;
    return {
      bucket,
      total: entry.total,
      success: entry.success,
      successRate: entry.total > 0 ? Math.round((entry.success / entry.total) * 100) / 100 : null,
      avgMastery: entry.masteryN > 0 ? Math.round((entry.masterySum / entry.masteryN) * 1000) / 1000 : null,
    };
  });
}
