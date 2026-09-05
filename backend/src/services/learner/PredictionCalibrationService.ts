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
   * - knowledgeState 含 review / wrapup.evaluation.sessionLss >= 6 → struggled
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
        const lssHigh = Number.isFinite(sessionLss) && sessionLss >= 6;
        if (reviewHit || lssHigh) outcome = 'struggled';
      }
      return await this.resolveOutcome(userId, taskId, outcome);
    } catch {
      // 回写失败不影响主流程（校准是旁路能力）
      return false;
    }
  }

  /** 实证命中率统计（替代 LLM 自报置信度的关键） */
  async empiricalStats(userId: string) {
    const rows = await prisma.prediction_records.findMany({
      where: { userId, outcome: { not: null } },
      select: { stallRisk: true, predictedTone: true, outcome: true },
    });
    const total = rows.length;
    if (total === 0) return { total, stallHitRate: null, toneHitRate: null, calibration: [] };

    // 卡壳命中率：stallRisk >= 0.5 且实际 struggled/failed，或 stallRisk < 0.5 且 smooth
    const stallHits = rows.filter(
      (r) => (r.stallRisk >= 0.5 ? r.outcome !== 'smooth' : r.outcome === 'smooth')
    ).length;

    // 基调命中率：predictedTone 与 outcome 直接映射（smooth→smooth / struggle→struggled / fatigue→failed）
    const toneMap: Record<string, PredictionOutcome> = {
      smooth: 'smooth',
      struggle: 'struggled',
      fatigue: 'failed',
    };
    const toneHits = rows.filter((r) => toneMap[r.predictedTone] === r.outcome).length;

    // 校准桶：按 stallRisk 分桶（0-0.3/0.3-0.6/0.6-1），看实际 struggled+failed 占比
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

    return {
      total,
      stallHitRate: +(stallHits / total).toFixed(3),
      toneHitRate: +(toneHits / total).toFixed(3),
      calibration: buckets.map((b) => ({ ...b, hardRate: b.n ? +(b.hard / b.n).toFixed(3) : null })),
    };
  }
}

export const predictionCalibrationService = new PredictionCalibrationService();

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
