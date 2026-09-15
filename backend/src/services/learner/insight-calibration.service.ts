/**
 * 洞察校准服务（Slice 3b）：给 LLM 诊断装「可证伪 + 事后核对 + 命中率」闭环（零训练）。
 *
 * 口径 v1（可解释、规则化，避免解析 LLM 自由文本）：
 * - 诊断的问题型洞察（prerequisite_gap/misconception/fatigue/motivation/granularity/strategy_fit）
 *   关联到概念（由 evidenceRefs → 证据 concepts 得到）。
 * - 「机会事件」：新的 task/lesson 完成（opportunityAt > predictedAt）。
 * - 机会到达后判定：相关概念中**仍**有任一处于 struggling/fragile → hit；否则 miss。
 *   无关联概念的记录在机会到达后标记 unknown（不计入命中率）。
 * - 命中率 = hits/(hits+misses)；样本 n<5 不引用（返回 null）。
 *
 * 存储：复用 `learner_projections`（scope='insight-records'），按 (userId,pathId) 幂等，无迁移。
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export type InsightCalibrationOutcome = 'pending' | 'hit' | 'miss' | 'unknown';

export interface InsightRecord {
  id: string;
  claim: string;
  insightType: string;
  conceptKeys: string[];
  predictedAt: string;
  outcome: InsightCalibrationOutcome;
  checkedAt: string | null;
}

export interface InsightCalibrationPayload {
  schemaVersion: 'learner-insight-records-v1';
  generatedAt: string;
  pathId: string | null;
  records: InsightRecord[];
}

export interface InsightReliability {
  n: number;
  hits: number;
  misses: number;
  /** n<5 时为 null（样本不足，不引用） */
  hitRate: number | null;
}

export interface NewInsightRecord {
  claim: string;
  insightType: string;
  conceptKeys: string[];
  predictedAt: string;
}

const MIN_SAMPLE = 5;

export function insightRecordsKey(userId: string, pathId?: string | null): string {
  return `learner-insight-records-v1:${userId}:${pathId || 'global'}`;
}

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function computeReliability(records: InsightRecord[]): InsightReliability {
  const hits = records.filter((r) => r.outcome === 'hit').length;
  const misses = records.filter((r) => r.outcome === 'miss').length;
  const n = hits + misses;
  return { n, hits, misses, hitRate: n >= MIN_SAMPLE ? hits / n : null };
}

class InsightCalibrationService {
  async getRecords(userId: string, pathId?: string | null): Promise<InsightRecord[]> {
    const row = await prisma.learner_projections.findUnique({
      where: { projectionKey: insightRecordsKey(userId, pathId) },
      select: { payload: true },
    });
    return parseJsonSafe<InsightCalibrationPayload>(row?.payload)?.records ?? [];
  }

  async getReliability(
    userId: string,
    pathId?: string | null,
    options: { excludeInsightTypes?: string[] } = {},
  ): Promise<InsightReliability> {
    const records = await this.getRecords(userId, pathId);
    const excluded = new Set(options.excludeInsightTypes ?? []);
    return computeReliability(excluded.size > 0 ? records.filter((r) => !excluded.has(r.insightType)) : records);
  }

  /** 追加待核对洞察（按 claim 去重；已存在的 claim 不重复记录）。 */
  async recordInsights(userId: string, pathId: string | null, items: NewInsightRecord[]): Promise<InsightRecord[]> {
    if (!items.length) return this.getRecords(userId, pathId);
    const records = await this.getRecords(userId, pathId);
    const seen = new Set(records.map((r) => normalizeKey(r.claim)));
    for (const item of items) {
      const claim = String(item.claim || '').trim();
      if (!claim || seen.has(normalizeKey(claim))) continue;
      seen.add(normalizeKey(claim));
      records.push({
        id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        claim,
        insightType: String(item.insightType || 'strategy_fit'),
        conceptKeys: Array.isArray(item.conceptKeys) ? item.conceptKeys.filter(Boolean) : [],
        predictedAt: item.predictedAt,
        outcome: 'pending',
        checkedAt: null,
      });
    }
    await this.save(userId, pathId, records);
    return records;
  }

  /**
   * 核对 pending 记录：机会事件到达后按「相关概念是否仍不稳」判定 hit/miss/unknown。
   * 未到机会事件的保持 pending。
   */
  async resolvePending(
    userId: string,
    pathId: string | null,
    context: { opportunityAt: string | null; struggling: string[]; fragile: string[] },
  ): Promise<InsightRecord[]> {
    const records = await this.getRecords(userId, pathId);
    if (!records.some((r) => r.outcome === 'pending')) return records;

    const unstable = new Set(
      [...(context.struggling || []), ...(context.fragile || [])].map(normalizeKey).filter(Boolean),
    );
    const opportunityMs = context.opportunityAt ? new Date(context.opportunityAt).getTime() : NaN;
    const now = new Date().toISOString();
    let changed = false;

    for (const record of records) {
      if (record.outcome !== 'pending') continue;
      const predictedMs = new Date(record.predictedAt).getTime();
      const hasOpportunity = Number.isFinite(opportunityMs) && Number.isFinite(predictedMs) && opportunityMs > predictedMs;
      if (!hasOpportunity) continue;

      if (!record.conceptKeys.length) {
        record.outcome = 'unknown';
        record.checkedAt = now;
        changed = true;
        continue;
      }
      const stillUnstable = record.conceptKeys.some((key) => unstable.has(normalizeKey(key)));
      record.outcome = stillUnstable ? 'hit' : 'miss';
      record.checkedAt = now;
      changed = true;
    }

    if (changed) await this.save(userId, pathId, records);
    return records;
  }

  private async save(userId: string, pathId: string | null, records: InsightRecord[]): Promise<void> {
    const payload: InsightCalibrationPayload = {
      schemaVersion: 'learner-insight-records-v1',
      generatedAt: new Date().toISOString(),
      pathId: pathId ?? null,
      records: records.slice(-200),
    };
    try {
      await prisma.learner_projections.upsert({
        where: { projectionKey: insightRecordsKey(userId, pathId) },
        create: {
          id: `lic_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          projectionKey: insightRecordsKey(userId, pathId),
          userId,
          scope: 'insight-records',
          pathId: pathId ?? null,
          version: 1,
          payload: JSON.stringify(payload),
          generatedAt: new Date(),
        },
        update: {
          version: { increment: 1 },
          payload: JSON.stringify(payload),
          generatedAt: new Date(),
        },
      });
    } catch (error: any) {
      logger.warn('[insight-calibration] 落库失败（不影响主流程）', { userId, pathId, error: error?.message || String(error) });
    }
  }
}

export const insightCalibrationService = new InsightCalibrationService();
export default insightCalibrationService;
