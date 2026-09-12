/**
 * 概念信念服务（Slice 3a）：零训练、可配置参数的 BKT 时序更新。
 *
 * 设计约束（doc/LEARNER_STATE_REVIEW_DESIGN.md §6）：不训练模型。
 * - 观测来自 LLM 诊断（learner-state-review 的 conceptAssessments.observed：mastered|not）
 * - 代码用 BKT 公式做时序信念更新（4 个可配置标量，按需分档）
 * - 落 `learner_projections`（scope='beliefs'），按 (userId, pathId) 幂等
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export interface BktParams {
  /** 初始已掌握先验 */
  pL0: number;
  /** 学习率：一次机会后从未掌握→掌握 */
  pT: number;
  /** 猜对：未掌握却答对 */
  pG: number;
  /** 失误：掌握却答错 */
  pS: number;
}

/** 默认参数表（零训练；如需按概念难度分档，可在此扩展） */
export const DEFAULT_BKT_PARAMS: BktParams = { pL0: 0.3, pT: 0.15, pG: 0.25, pS: 0.1 };

export interface ConceptObservation {
  conceptKey: string;
  observed: boolean;
}

export interface ConceptBelief {
  pKnowL: number;
  observations: number;
  lastObservedAt: string;
}

export interface ConceptBeliefsPayload {
  schemaVersion: 'learner-concept-beliefs-v1';
  generatedAt: string;
  pathId: string | null;
  params: BktParams;
  beliefs: Record<string, ConceptBelief>;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 单次 BKT 更新：先按观测更新后验，再按学习率传播。
 * P(L|对) = P(L)(1−pS) / [P(L)(1−pS) + (1−P(L))pG]
 * P(L|错) = P(L)pS    / [P(L)pS    + (1−P(L))(1−pG)]
 * P(L')   = P(L|obs) + (1−P(L|obs))·pT
 */
export function updateBelief(pKnowL: number, observed: boolean, params: BktParams = DEFAULT_BKT_PARAMS): number {
  const prior = clamp01(pKnowL);
  const { pT, pG, pS } = params;
  const numerator = observed ? prior * (1 - pS) : prior * pS;
  const denominator = observed
    ? prior * (1 - pS) + (1 - prior) * pG
    : prior * pS + (1 - prior) * (1 - pG);
  const posterior = denominator > 0 ? numerator / denominator : prior;
  return clamp01(posterior + (1 - posterior) * pT);
}

export function beliefProjectionKey(userId: string, pathId?: string | null): string {
  return `learner-concept-beliefs-v1:${userId}:${pathId || 'global'}`;
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

class ConceptBeliefService {
  async getBeliefs(userId: string, pathId?: string | null): Promise<ConceptBeliefsPayload | null> {
    const row = await prisma.learner_projections.findUnique({
      where: { projectionKey: beliefProjectionKey(userId, pathId) },
      select: { payload: true },
    });
    return parseJsonSafe<ConceptBeliefsPayload>(row?.payload);
  }

  /**
   * 用一批观测更新信念并落库；无观测时原样返回现有信念。
   * 新概念用 pL0 初始化。
   */
  async applyObservations(
    userId: string,
    pathId: string | null,
    observations: ConceptObservation[],
    options: { params?: BktParams } = {},
  ): Promise<ConceptBeliefsPayload | null> {
    const params = options.params ?? DEFAULT_BKT_PARAMS;
    const current = await this.getBeliefs(userId, pathId);
    const beliefs: Record<string, ConceptBelief> = { ...(current?.beliefs ?? {}) };
    const now = new Date().toISOString();

    for (const observation of observations) {
      const conceptKey = String(observation?.conceptKey || '').trim();
      if (!conceptKey) continue;
      const prev = beliefs[conceptKey]?.pKnowL ?? params.pL0;
      beliefs[conceptKey] = {
        pKnowL: updateBelief(prev, observation.observed === true, params),
        observations: (beliefs[conceptKey]?.observations ?? 0) + 1,
        lastObservedAt: now,
      };
    }

    const payload: ConceptBeliefsPayload = {
      schemaVersion: 'learner-concept-beliefs-v1',
      generatedAt: now,
      pathId: pathId ?? null,
      params,
      beliefs,
    };

    try {
      await prisma.learner_projections.upsert({
        where: { projectionKey: beliefProjectionKey(userId, pathId) },
        create: {
          id: `lcb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          projectionKey: beliefProjectionKey(userId, pathId),
          userId,
          scope: 'beliefs',
          pathId: pathId ?? null,
          version: 1,
          payload: JSON.stringify(payload),
          generatedAt: new Date(now),
        },
        update: {
          version: { increment: 1 },
          payload: JSON.stringify(payload),
          generatedAt: new Date(now),
        },
      });
    } catch (error: any) {
      logger.warn('[concept-belief] 落库失败（不影响主流程）', { userId, pathId, error: error?.message || String(error) });
    }

    return payload;
  }
}

export const conceptBeliefService = new ConceptBeliefService();
export default conceptBeliefService;
