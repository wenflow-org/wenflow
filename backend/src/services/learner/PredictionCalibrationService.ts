/**
 * PredictionCalibrationService —— learning-predictor 校准闭环
 *
 * 核心思想（对应「置信度不值钱」问题的根治）：
 * 不用公式拍置信度，而是让系统积累「预测 vs 实际」的对照记录，
 * 用实测命中率作为该预测器的实证置信度。
 *
 * - recordPrediction：任务开始前，记录预测器输出
 * - resolveOutcome：任务结束后，回写实际结果
 * - empiricalStats：按维度统计命中率/校准分布
 *
 * 条件校准（2026-11，反事实混淆修复）：
 * 全局命中率把「教学层采纳 deep 建议 → 干预生效 → 任务顺畅」记成预测失败——
 * 教学越有效，预测器置信度越低（反事实混淆）。因此除全局 empiricalStats 外，
 * 追加按「教学深度」分组的条件校准 `byDepth`：回答「在 deep 这一条件下，预测器准不准」。
 *
 * 分组 key 解析顺序（fallback 规则，见 resolveCalibrationDepth）：
 *   1. actualDepth（任务结束后实际执行深度）优先——目前**没有任何持久化来源**：
 *      prediction_records 无该列；teaching-turn 输出无「已执行深度」枚举；learner_evidence
 *      也没有 depth 类证据。读侧仍优先读它：将来若加列、或挂到既有 JSON 字段，只需改 select。
 *   2. 缺失时回落记录自带的 suggestedDepth（recordPrediction 写入的预测枚举）。
 *   3. 两者都缺失/非法 → 计入 unclassifiedDepthCount，不进任何分组（不虚报）。
 * 每组样本 < CALIBRATION_DEPTH_MIN_SAMPLE 时，该组命中率/校准占比一律返回 null，
 * 与全局 reliability 的「小样本不给数」口径一致。
 */
import prisma from '../../config/database';
import type { LearningPredictorOutput } from '../../skills/learning-predictor';

export interface PredictionRecordInput {
  userId: string;
  pathId?: string;
  taskId?: string;
  milestoneId?: string;
  sessionId?: string;
  prediction: LearningPredictorOutput;
  summaryEcho?: string;
}

export type PredictionOutcome = 'smooth' | 'struggled' | 'failed';

/** 教学深度（与 learning-predictor 的 suggestedDepth 枚举同域） */
export type CalibrationDepth = 'shallow' | 'standard' | 'deep';

export const CALIBRATION_DEPTHS: readonly CalibrationDepth[] = ['shallow', 'standard', 'deep'];

/** 单组最小样本：不足则该组不给命中率（与 PREDICTION_RELIABILITY_MIN_SAMPLE 同口径） */
export const CALIBRATION_DEPTH_MIN_SAMPLE = 5;

export interface CalibrationBucket {
  range: string;
  min: number;
  max: number;
  n: number;
  hard: number;
  hardRate: number | null;
}

export interface DepthCalibration {
  depth: CalibrationDepth;
  /** 该组 key 的来源：actual=实际执行深度 / suggested=回落预测深度 / none=无样本 */
  depthSource: 'actual' | 'suggested' | 'none';
  total: number;
  /** 样本不足（total < CALIBRATION_DEPTH_MIN_SAMPLE）→ 全部比率字段为 null */
  insufficient: boolean;
  stallHitRate: number | null;
  toneHitRate: number | null;
  /** 该组实际 struggled+failed 占比（看清「深教之后到底难不难」） */
  hardRate: number | null;
  calibration: CalibrationBucket[];
}

/** 统计用的最小行形状（actualDepth 目前无持久化列，可能缺失） */
interface StatsRow {
  stallRisk: number;
  predictedTone: string | null;
  outcome: string | null;
  suggestedDepth?: string | null;
  actualDepth?: string | null;
}

export class PredictionCalibrationService {
  /** 记录一次任务前预测 */
  async recordPrediction(input: PredictionRecordInput): Promise<string> {
    const { userId, pathId, taskId, milestoneId, sessionId, prediction, summaryEcho } = input;
    const id = `prd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await prisma.prediction_records.create({
      data: {
        id,
        userId,
        pathId: pathId || null,
        taskId: taskId || null,
        milestoneId: milestoneId || null,
        sessionId: sessionId || null,
        stallRisk: prediction.stallRisk,
        predictedTone: prediction.predictedTone,
        suggestedDepth: prediction.suggestedDepth,
        focusConcepts: JSON.stringify(prediction.focusConcepts || []),
        rationale: prediction.rationale || '',
        // P1-13 / #181：自由描述原文一并落库，供第 2 回合起/重试/续课从本表重建时保真
        toneDetail: prediction.toneDetail ?? null,
        depthDetail: prediction.depthDetail ?? null,
        summaryEcho: summaryEcho ? summaryEcho.slice(0, 500) : null,
      },
    });
    return id;
  }

  /** 任务结束后回写实际结果（幂等：同一 taskId 只写一次，保留第一次） */
  async resolveOutcome(userId: string, taskId: string, outcome: PredictionOutcome): Promise<boolean> {
    const record = await prisma.prediction_records.findFirst({
      where: { userId, taskId, outcome: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;
    await prisma.prediction_records.update({
      where: { id: record.id },
      data: { outcome, outcomeAt: new Date() },
    });
    return true;
  }

  /**
   * task:completed 时自动回写实际结果（从最近会话推导挣扎信号）：
   * - knowledgeState 含 review / wrapup.evaluation 判为 high 档（legacy：sessionLss >= 6）→ struggled
   * - 本任务存在 checkpoint 负证据（checkpoint:result passed=false 或 checkpoint:attempt
   *   attempts_exhausted）→ struggled（2026-10-06 F4：code 裁决是独立于 LLM 自评的第一手观测，
   *   此前两次判错仍记 smooth——R1 实测失明）
   * - 否则 → smooth
   * 找不到未回写的预测记录时静默放弃（预测可能未及写入——fire-and-forget 竞态窗口可忽略）。
   */
  async resolveFromTaskCompletion(userId: string, taskId: string): Promise<boolean> {
    try {
      const session = await prisma.teaching_sessions.findFirst({
        where: { userId, taskId },
        orderBy: { startTime: 'desc' },
        select: { knowledgeState: true, wrapup: true },
      });
      let outcome: PredictionOutcome = 'smooth';
      if (session) {
        const knowledgeState = safeParseArray(session.knowledgeState);
        const reviewHit = knowledgeState.some((p) => p?.status === 'review');
        const wrapup = safeParseObj(session.wrapup);
        const evaluation = wrapup?.evaluation as Record<string, unknown> | undefined;
        const sessionLss = Number(evaluation?.sessionLss);
        // 2026-09-22：档位化后按档位判定（mid 的中点 6 不再被当成"挣扎"）；legacy 数值仍走 >= 6
        const sessionLssTier = (evaluation as { metricTiers?: { sessionLss?: string } } | undefined)?.metricTiers?.sessionLss;
        const lssHigh = sessionLssTier
          ? sessionLssTier === 'high'
          : (Number.isFinite(sessionLss) && sessionLss >= 6);
        if (reviewHit || lssHigh) outcome = 'struggled';
      }
      // F4：checkpoint 负证据与知识面/LSS 判据独立——留痕按 taskId 落（learner_evidence.taskId），
      // 会话内失败必然在此命中。skipped/unresolved/通过不判负（未作答≠答错）。
      if (outcome !== 'struggled') {
        const negative = await prisma.learner_evidence.findMany({
          where: {
            userId,
            taskId,
            evidenceType: { in: ['checkpoint:result', 'checkpoint:attempt'] },
          },
          select: { evidenceType: true, payload: true },
        });
        const failedByCode = negative.some((row) => {
          const payload = safeParseObj(row.payload);
          if (!payload) return false;
          if (row.evidenceType === 'checkpoint:result') return payload.passed === false;
          return payload.outcome === 'attempts_exhausted';
        });
        if (failedByCode) outcome = 'struggled';
      }
      return await this.resolveOutcome(userId, taskId, outcome);
    } catch {
      // 回写失败不影响主流程（校准是旁路能力）
      return false;
    }
  }

  /**
   * 实证命中率统计（替代 LLM 自报置信度的关键）。
   *
   * 返回形状对既有调用方向后兼容：total / stallHitRate / toneHitRate / calibration
   * 的名称与语义完全不变，**只新增** byDepth（按教学深度分组）等字段。
   */
  async empiricalStats(userId: string) {
    const rawRows = await prisma.prediction_records.findMany({
      where: { userId, outcome: { not: null } },
      select: { stallRisk: true, predictedTone: true, outcome: true, suggestedDepth: true },
    });
    // actualDepth 若将来落库（新列 / 既有 JSON 字段），只需在此 select 补上——读侧已优先取它。
    const rows: StatsRow[] = rawRows.map((r) => ({
      ...r,
      actualDepth: readActualDepth(r),
    }));
    const total = rows.length;
    if (total === 0) {
      return {
        total,
        stallHitRate: null,
        toneHitRate: null,
        calibration: [] as CalibrationBucket[],
        byDepth: emptyDepthCalibrations(),
        byDepthMinSample: CALIBRATION_DEPTH_MIN_SAMPLE,
        depthKeySource: 'none' as const,
        unclassifiedDepthCount: 0,
      };
    }

    // 卡壳命中率：stallRisk >= 0.5 且实际 struggled/failed，或 stallRisk < 0.5 且 smooth
    const stallHits = countStallHits(rows);
    const toneHits = countToneHits(rows);

    // 条件校准：按教学深度分组（同组内再按 stallRisk 分桶）
    const grouped = new Map<CalibrationDepth, StatsRow[]>();
    for (const depth of CALIBRATION_DEPTHS) grouped.set(depth, []);
    const sources = new Map<CalibrationDepth, 'actual' | 'suggested'>();
    let unclassifiedDepthCount = 0;
    for (const row of rows) {
      const resolved = resolveCalibrationDepth(row);
      if (!resolved.depth) {
        unclassifiedDepthCount += 1;
        continue;
      }
      grouped.get(resolved.depth)!.push(row);
      // 同组内混有 actual/suggested 时以 actual 记账：该组至少有一行按实测深度归组
      if (!sources.has(resolved.depth)) sources.set(resolved.depth, resolved.source);
      else if (resolved.source === 'actual') sources.set(resolved.depth, 'actual');
    }

    const byDepth: DepthCalibration[] = CALIBRATION_DEPTHS.map((depth) => {
      const groupRows = grouped.get(depth)!;
      const n = groupRows.length;
      if (n === 0) {
        return {
          depth,
          depthSource: 'none' as const,
          total: 0,
          insufficient: true,
          stallHitRate: null,
          toneHitRate: null,
          hardRate: null,
          calibration: buildCalibrationBuckets([]),
        };
      }
      const insufficient = n < CALIBRATION_DEPTH_MIN_SAMPLE;
      return {
        depth,
        depthSource: sources.get(depth) ?? 'suggested',
        total: n,
        insufficient,
        // 样本不足一律不给数（同时桶内 hardRate 也置 null）——防小样本虚报
        stallHitRate: insufficient ? null : +(countStallHits(groupRows) / n).toFixed(3),
        toneHitRate: insufficient ? null : +(countToneHits(groupRows) / n).toFixed(3),
        hardRate: insufficient ? null : +(countHard(groupRows) / n).toFixed(3),
        calibration: buildCalibrationBuckets(groupRows, insufficient),
      };
    });

    return {
      total,
      stallHitRate: +(stallHits / total).toFixed(3),
      toneHitRate: +(toneHits / total).toFixed(3),
      calibration: buildCalibrationBuckets(rows),
      byDepth,
      byDepthMinSample: CALIBRATION_DEPTH_MIN_SAMPLE,
      /** 本次分组用的是哪一档 key；mixed=部分行实际深度、部分回落预测深度 */
      depthKeySource: summarizeDepthKeySource(sources, rows.length, unclassifiedDepthCount),
      /** 深度缺失/非法而未进任何分组的行数 */
      unclassifiedDepthCount,
    };
  }
  /** 最近预测记录（含回写结果），供 learner-models 前端展示「预测 vs 实际」 */
  async listRecentRecords(userId: string, take: number) {
    return prisma.prediction_records.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        taskId: true,
        stallRisk: true,
        predictedTone: true,
        suggestedDepth: true,
        focusConcepts: true,
        rationale: true,
        outcome: true,
        createdAt: true,
        outcomeAt: true,
      },
    });
  }
}

export const predictionCalibrationService = new PredictionCalibrationService();

/** 卡壳命中：stallRisk >= 0.5 且实际 struggled/failed，或 stallRisk < 0.5 且 smooth */
function countStallHits(rows: StatsRow[]): number {
  return rows.filter((r) => (r.stallRisk >= 0.5 ? r.outcome !== 'smooth' : r.outcome === 'smooth')).length;
}

/** 基调命中：predictedTone 与 outcome 直接映射（smooth→smooth / struggle→struggled / fatigue→failed） */
const TONE_MAP: Record<string, PredictionOutcome> = {
  smooth: 'smooth',
  struggle: 'struggled',
  fatigue: 'failed',
};

function countToneHits(rows: StatsRow[]): number {
  return rows.filter((r) => TONE_MAP[String(r.predictedTone)] === r.outcome).length;
}

/** 困难占比：实际 struggled/failed */
function countHard(rows: StatsRow[]): number {
  return rows.filter((r) => r.outcome !== 'smooth').length;
}

/** 校准桶：按 stallRisk 分桶（0-0.3/0.3-0.6/0.6-1），看实际 struggled+failed 占比 */
function buildCalibrationBuckets(rows: StatsRow[], suppressRates = false): CalibrationBucket[] {
  const buckets = [
    { range: '0-0.3', min: 0, max: 0.3, n: 0, hard: 0 },
    { range: '0.3-0.6', min: 0.3, max: 0.6, n: 0, hard: 0 },
    { range: '0.6-1.0', min: 0.6, max: 1, n: 0, hard: 0 },
  ];
  for (const r of rows) {
    const b = buckets.find((x) => r.stallRisk >= x.min && r.stallRisk < x.max);
    if (!b) continue;
    b.n += 1;
    if (r.outcome !== 'smooth') b.hard += 1;
  }
  return buckets.map((b) => ({
    ...b,
    hardRate: !suppressRates && b.n ? +(b.hard / b.n).toFixed(3) : null,
  }));
}

function emptyDepthCalibrations(): DepthCalibration[] {
  return CALIBRATION_DEPTHS.map((depth) => ({
    depth,
    depthSource: 'none' as const,
    total: 0,
    insufficient: true,
    stallHitRate: null,
    toneHitRate: null,
    hardRate: null,
    calibration: buildCalibrationBuckets([]),
  }));
}

function normalizeDepth(raw: unknown): CalibrationDepth | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (CALIBRATION_DEPTHS as readonly string[]).includes(v) ? (v as CalibrationDepth) : null;
}

/** 实际执行深度：目前无持久化来源（无列/无证据字段），读到即用——将来落库无需改分组逻辑 */
function readActualDepth(row: unknown): string | null {
  const v = (row as Record<string, unknown> | null | undefined)?.actualDepth;
  return typeof v === 'string' ? v : null;
}

/**
 * 分组 key 解析（fallback 规则）：
 * actualDepth（实际执行深度）优先 → 回落 suggestedDepth（预测深度） → 都没有则 null（不进分组）
 */
function resolveCalibrationDepth(row: StatsRow): { depth: CalibrationDepth | null; source: 'actual' | 'suggested' } {
  const actual = normalizeDepth(row.actualDepth);
  if (actual) return { depth: actual, source: 'actual' };
  const suggested = normalizeDepth(row.suggestedDepth);
  if (suggested) return { depth: suggested, source: 'suggested' };
  return { depth: null, source: 'suggested' };
}

function summarizeDepthKeySource(
  sources: Map<CalibrationDepth, 'actual' | 'suggested'>,
  totalRows: number,
  unclassifiedDepthCount: number
): 'actual' | 'suggested' | 'mixed' | 'none' {
  if (sources.size === 0 || unclassifiedDepthCount >= totalRows) return 'none';
  const values = new Set(sources.values());
  if (values.size > 1) return 'mixed';
  return values.has('actual') ? 'actual' : 'suggested';
}

function safeParseArray(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObj(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
