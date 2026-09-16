/**
 * LearnerStateReviewService（状态评审诊断层 · Slice 2a）
 *
 * 定位：把「学习者状态」聚合成一份可回写、可复用的**评审产物**（learner-state-review-v1），
 * 供 dashboard / learning-state / 教学侧消费；落 `learner_projections`（scope=review），按需读取。
 *
 * 当前实现（2a）：洞察来自既有**规则**组件（LearnerStateSummary + LearningDecisionFeed），
 *   不新增 LLM 调用；输入侧统一走 `toReviewProjection`（诊断层投影）。
 * 下一阶段（2b）：接入 `learner-state-review` LLM skill，把 `insights` 升级为可证伪诊断，
 *   并把 `source` 从 'rules' 升为 'model'（见 doc/LEARNER_STATE_REVIEW_DESIGN.md §4）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';
import { assembleLearningState } from './assemble-learning-state';
import { learnerProjectionService, type ReviewProjection } from './LearnerProjectionService';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import { learningDecisionFeedService, type LearningDecisionCard } from './LearningDecisionFeedService';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import { conceptBeliefService } from './concept-belief.service';
import { insightCalibrationService, type InsightReliability } from './insight-calibration.service';

export const REVIEW_PROJECTION_SCOPE = 'review';

export interface LearnerStateReviewDiagnosisInsight {
  type: string;
  claim: string;
  evidenceRefs: string[];
  confidence: number | null;
  action: string;
}

export interface LearnerStateReviewDiagnosis {
  insights: LearnerStateReviewDiagnosisInsight[];
  conceptAssessments: Array<{
    conceptKey: string;
    observed: 'mastered' | 'not';
    masteryBand: 'low' | 'medium' | 'high';
    rationale: string;
    evidenceRefs: string[];
  }>;
  falsifiableClaims: Array<{ claim: string; checkOn: string; expect: string }>;
  narrative: string;
}

export interface LearnerStateReviewPayload {
  schemaVersion: 'learner-state-review-v1';
  reviewVersion: 1;
  generatedAt: string;
  pathId: string | null;
  /** 'rules' = 规则派生（2a）；'model' = LLM 诊断（2b） */
  source: 'rules' | 'model';
  projection: ReviewProjection;
  summary: LearnerStateSummaryOutput;
  insights: LearningDecisionCard[];
  /** LLM 诊断产物（2b）；失败或未产出时为 null */
  diagnosis: LearnerStateReviewDiagnosis | null;
  /** BKT 概念信念（3a）：conceptKey → pKnowL（0-1）；无观测时为 null */
  beliefs?: Record<string, number> | null;
  /** 诊断可信度（3b）：历史断言命中率；样本 <5 时 hitRate 为 null */
  calibration?: InsightReliability | null;
}

export function reviewProjectionKey(userId: string, pathId?: string | null): string {
  return `learner-state-review-v1:${userId}:${pathId || 'global'}`;
}

class LearnerStateReviewService {
  private inflight = new Map<string, Promise<LearnerStateReviewPayload | null>>();

  async getLatest(userId: string, pathId?: string | null): Promise<LearnerStateReviewPayload | null> {
    const row = await prisma.learner_projections.findUnique({
      where: { projectionKey: reviewProjectionKey(userId, pathId) },
      select: { payload: true },
    });
    return parseJsonSafe<LearnerStateReviewPayload>(row?.payload);
  }

  /**
   * 教学侧可用的「活跃诊断洞察」（设计 §4：注入 top-N active insights）。
   *
   * 「活跃」的判定用了现有数据，不新增状态位：
   * - 取最近一次状态评审的 LLM 诊断洞察；
   * - **已被证伪的不再回注**（该 claim 在 insight-calibration 里 outcome=miss）——闭环就该这样：
   *   预测被现实打脸的部分不许继续影响教学；
   * - 按 confidence 降序取前 N 条；只出 type/claim/action（剥离 evidenceRefs / confidence 等内部字段，
   *   教学侧不需要也不该看到证据 id）。
   *
   * 永远不抛错、不调 LLM（读投影），失败返回空数组 —— 教学照常进行，不得因洞察缺失改变默认行为。
   */
  async getActiveInsights(
    userId: string,
    pathId?: string | null,
    options: { limit?: number } = {},
  ): Promise<Array<{ type: string; claim: string; action: string }>> {
    const limit = Math.max(0, options.limit ?? 3);
    if (limit === 0) return [];
    try {
      const [payload, records] = await Promise.all([
        this.getLatest(userId, pathId),
        insightCalibrationService.getRecords(userId, pathId).catch(() => []),
      ]);
      const rawInsights = payload?.diagnosis?.insights ?? [];
      if (rawInsights.length === 0) return [];

      const refuted = new Set(
        records.filter((record) => record.outcome === 'miss').map((record) => String(record.claim || '').trim().toLowerCase()),
      );
      return rawInsights
        .map((insight) => ({
          type: String(insight.type || 'strategy_fit'),
          claim: String(insight.claim || '').trim(),
          action: String(insight.action || '').trim(),
          confidence: typeof insight.confidence === 'number' ? insight.confidence : null,
        }))
        .filter((insight) => insight.claim && !refuted.has(insight.claim.toLowerCase()))
        .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
        .slice(0, limit)
        .map(({ type, claim, action }) => ({ type, claim, action }));
    } catch (error) {
      logger.warn('[learner-state-review] 读取活跃洞察失败，教学侧按无洞察处理', {
        userId,
        pathId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async refresh(userId: string, pathId?: string | null): Promise<LearnerStateReviewPayload | null> {
    const key = reviewProjectionKey(userId, pathId);
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = this.perform(userId, pathId)
      .catch((error: any) => {
        logger.warn('[learner-state-review] refresh failed', { userId, pathId, error: error?.message || String(error) });
        return null;
      })
      .finally(() => {
        if (this.inflight.get(key) === task) this.inflight.delete(key);
      });

    this.inflight.set(key, task);
    return task;
  }

  refreshInBackground(userId: string, pathId?: string | null): void {
    runBackgroundTask('learner-state-review.refresh', () => this.refresh(userId, pathId), { userId, pathId });
  }

  private async perform(userId: string, pathId?: string | null): Promise<LearnerStateReviewPayload | null> {
    const assembled = await assembleLearningState(userId, { snapshotScope: 'path', pathId });
    if (!assembled || !assembled.primaryPath) return null;

    const { paths, sessions, primaryPath, learnerSnapshot, learningState, warnings } = assembled;

    const summary = learnerStateSummaryService.build({
      learnerSnapshot,
      learningState,
      path: primaryPath,
      warningCount: warnings.length,
    });
    const insights = learningDecisionFeedService.build({ paths, sessions, learnerSnapshot, summary });
    const projection = learnerProjectionService.toReviewProjection(learnerSnapshot);

    const { source, diagnosis } = await runModelDiagnosis(learnerSnapshot, projection, userId, primaryPath.id);

    // 3a：用诊断观测做 BKT 时序更新（零训练），并把信念摘要附入评审载荷
    let beliefs: Record<string, number> | null = null;
    if (diagnosis?.conceptAssessments?.length) {
      const updated = await conceptBeliefService.applyObservations(
        userId,
        primaryPath.id,
        diagnosis.conceptAssessments.map((item) => ({ conceptKey: item.conceptKey, observed: item.observed === 'mastered' })),
      );
      if (updated) {
        beliefs = Object.fromEntries(Object.entries(updated.beliefs).map(([key, value]) => [key, value.pKnowL]));
      }
    }

    const generatedAt = new Date().toISOString();

    // 3b：先结算历史待核对断言，再把本次诊断断言入账，最后取可信度
    const recentEvidenceDigest = buildRecentEvidence(learnerSnapshot);
    const opportunityAt = learnerSnapshot?.freshness?.basedOn?.latestTaskCompletionAt
      || learnerSnapshot?.freshness?.basedOn?.latestTeachingSessionAt
      || null;
    await insightCalibrationService.resolvePending(userId, primaryPath.id, {
      opportunityAt,
      struggling: learnerSnapshot?.knowledgeMemory?.globalSignals?.strugglingConcepts ?? [],
      fragile: learnerSnapshot?.knowledgeMemory?.globalSignals?.fragileConcepts ?? [],
    });
    if (diagnosis?.insights?.length) {
      await insightCalibrationService.recordInsights(
        userId,
        primaryPath.id,
        diagnosis.insights.map((item) => ({
          claim: item.claim,
          insightType: item.type,
          conceptKeys: conceptsForEvidenceRefs(item.evidenceRefs, recentEvidenceDigest),
          predictedAt: generatedAt,
        })),
      );
    }
    const calibration = await insightCalibrationService.getReliability(userId, primaryPath.id, {
      // 重排归因的断言单独成列（replan_attribution）：不混进状态评审的命中率
      excludeInsightTypes: ['replan_attribution'],
    });

    const payload: LearnerStateReviewPayload = {
      schemaVersion: 'learner-state-review-v1',
      reviewVersion: 1,
      generatedAt,
      pathId: primaryPath.id,
      source,
      projection,
      summary,
      insights,
      diagnosis,
      beliefs,
      calibration,
    };

    await prisma.learner_projections.upsert({
      where: { projectionKey: reviewProjectionKey(userId, primaryPath.id) },
      create: {
        id: `lsr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: reviewProjectionKey(userId, primaryPath.id),
        userId,
        scope: REVIEW_PROJECTION_SCOPE,
        pathId: primaryPath.id,
        version: 1,
        payload: JSON.stringify(payload),
        generatedAt: new Date(generatedAt),
      },
      update: {
        version: { increment: 1 },
        payload: JSON.stringify(payload),
        generatedAt: new Date(generatedAt),
      },
    });

    return payload;
  }
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 调 LLM 诊断 skill；失败/空产出时回退规则洞察（source='rules'）。 */
async function runModelDiagnosis(
  learnerSnapshot: any,
  projection: ReviewProjection,
  userId: string,
  pathId: string,
): Promise<{ source: 'rules' | 'model'; diagnosis: LearnerStateReviewDiagnosis | null }> {
  try {
    const result = await executeSkillWithResult(auxSkillDefinitionMap['learner-state-review'], {
      learnerDigest: projection.learnerDigest,
      knowledgeDigest: projection.knowledgeDigest,
      recentEvidence: buildRecentEvidence(learnerSnapshot),
      priorInsights: [],
    });
    const output: any = (result as any)?.output;
    if (output && (output.insights?.length || output.conceptAssessments?.length || output.narrative)) {
      return {
        source: 'model',
        diagnosis: {
          insights: output.insights ?? [],
          conceptAssessments: output.conceptAssessments ?? [],
          falsifiableClaims: output.falsifiableClaims ?? [],
          narrative: output.narrative ?? '',
        },
      };
    }
  } catch (error: any) {
    logger.warn('[learner-state-review] LLM 诊断失败，回退规则洞察', {
      userId,
      pathId,
      error: error?.message || String(error),
    });
  }
  return { source: 'rules', diagnosis: null };
}

/** 从证据引用反查概念（供 3b 校准把断言关联到概念）。 */
function conceptsForEvidenceRefs(
  refs: string[],
  recentEvidence: Array<{ id: string; concepts: string[] }>,
): string[] {
  const byId = new Map(recentEvidence.map((entry) => [entry.id, entry.concepts]));
  const out = new Set<string>();
  for (const ref of refs || []) {
    for (const concept of byId.get(ref) || []) {
      if (concept) out.add(concept);
    }
  }
  return Array.from(out);
}

/** 从快照取最近证据，赋予稳定引用 id（诊断输出的 evidenceRefs 引用它）。 */
function buildRecentEvidence(snapshot: any): Array<{ id: string; signal: string; concepts: string[]; at: string }> {
  const currentPath = snapshot?.knowledgeMemory?.currentPath;
  const rows = Array.isArray(currentPath?.recentEvidence) ? currentPath.recentEvidence : [];
  return rows.slice(0, 10).map((entry: any, index: number) => ({
    id: entry?.taskId || (entry?.sessionId ? `${entry.sessionId}#${index}` : `ev_${index}`),
    signal: entry?.signal || 'incomplete',
    concepts: Array.isArray(entry?.conceptKeys) ? entry.conceptKeys : [],
    at: entry?.happenedAt || '',
  }));
}

export const learnerStateReviewService = new LearnerStateReviewService();
export default learnerStateReviewService;
