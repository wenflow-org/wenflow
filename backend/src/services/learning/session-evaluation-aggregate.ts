/**
 * 会话评估的**确定性聚合层**（影子实现）。
 *
 * 目的：只用每轮可观测信号，用同一套纯函数算出 lss / ktl / lf / confidence，与 LLM 的档位
 * 判定**并存记录、互不改写**（落点见 `teaching-session-lifecycle` 的 `shadowDeterministic`）。
 * 现有消费方仍读 LLM 值，本层只负责给"确定性聚合 vs LLM"提供可比对的第二个样本。
 *
 * 每轮细粒度信号实际落在哪里：
 * - `teaching_sessions.messages[].analysis`（teaching-turn 每轮写入），字段：
 *   understanding 0-1 / engagement 0-1 / loadIndex 0-1 / emotionalState /
 *   confusionPoints / ktEstimate.conceptMastery / ktEstimate.currentTaskDifficulty。
 * - 这里直接从 messages 抽取，而不是用 `sessionEvidence`：后者只给会话均值，聚合需要**逐轮序列**
 *   （中位数/最差连续窗口都依赖顺序与分布）。
 *
 * 为什么不用裸均值（对离群稳健的口径）：
 * - **LF 取最差连续窗口均值（window=3）**：疲劳/负担是"持续在最差那一段"的现象，偶尔一轮轻松
 *   不能把整节课判定为不累；均值会把一段明显的过载抹平。
 * - **LSS 取中位数**：单轮极端值（一次误判或一次情绪爆发）不应改变整节的压力中心。
 * - **KTL 取"中位数与末段均值各半"**：既看整节典型质量，也看结束时是否稳定（yaml 锚点关注
 *   "稳定应用"）；两半都是稳健统计量。
 *
 * 缺失处理：任一信号缺失 ⇒ 该分量**权重 0**（从加权平均里剔除并重新归一），
 * 绝不用默认值补。整节课无任何观测 ⇒ 确定的零证据兜底（与 session-evaluation-scale 同源）。
 *
 * 纯函数、无 IO：同输入必得同输出，可回放、可单测。
 */

import {
  SESSION_EVALUATION_ZERO_EVIDENCE,
  resolveSessionEvaluationTier,
  type SessionEvaluationTier,
} from './session-evaluation-scale';

/** 公式版本：任何影响输出的口径调整都必须提升它，否则影子历史不可比 */
export const FORMULA_VERSION = 'session-eval-det-v1';

/** 置信度饱和所需的最少回合数：回合越少，证据越薄，confidence 越低 */
export const FULL_CONFIDENCE_TURNS = 5;

/** 最差连续窗口的窗口大小（LF 用）：3 轮 ≈ 一次"连续卡住"的过程 */
export const WORST_WINDOW_SIZE = 3;

/** KTL 末段均值窗口大小 */
export const KTL_TAIL_SIZE = 2;

export type SessionEmotionalState = 'positive' | 'neutral' | 'frustrated' | 'confused';

/**
 * 从落库消息抽取用的最小结构类型（只声明本聚合实际读取的字段，避免把分析对象当成 any）。
 * 真实的 `teaching_sessions.messages[]` 结构比它更宽，结构兼容即可传入。
 */
export interface SessionEvaluationTurnMessage {
  role?: string;
  content?: string;
  checkpoint?: boolean;
  peer?: boolean;
  analysis?: {
    understanding?: unknown;
    engagement?: unknown;
    loadIndex?: unknown;
    emotionalState?: unknown;
    confusionPoints?: unknown;
    ktEstimate?: {
      conceptMastery?: unknown;
      currentTaskDifficulty?: unknown;
    } | null;
  } | null;
}

/** 单轮观测（0-1 归一后的原始信号；null = 该轮没有这个信号） */
export interface SessionTurnObservation {
  understanding: number | null;
  engagement: number | null;
  loadIndex: number | null;
  emotionalState: SessionEmotionalState | null;
  /** null = 该轮没有 confusionPoints 信号；0 = 明确"无困惑" */
  confusionCount: number | null;
  /** ktEstimate.conceptMastery 的平均掌握度 0-1；null = 无信号 */
  mastery: number | null;
  /** ktEstimate.currentTaskDifficulty 0-1 */
  taskDifficulty: number | null;
}

export interface SessionEvaluationCoverage {
  lss: number;
  ktl: number;
  lf: number;
  overall: number;
}

export interface SessionEvaluationMetricDiagnostic {
  method: string;
  samples: number;
  value: number | null;
}

export interface DeterministicSessionEvaluation {
  lss: number;
  ktl: number;
  lf: number;
  confidence: number;
  formulaVersion: string;
  basis: 'per-turn-observations' | 'zero-evidence';
  turnCount: number;
  coverage: SessionEvaluationCoverage;
  diagnostics: {
    lss: SessionEvaluationMetricDiagnostic;
    ktl: SessionEvaluationMetricDiagnostic;
    lf: SessionEvaluationMetricDiagnostic;
  };
}

interface WeightedComponent {
  value: number;
  weight: number;
}

/** 情绪 → 压力/负担分量（0-10，越高越负性）。positive 取 1 而非 0，避免出现"零信息也像极值"。 */
const EMOTION_STRESS: Record<SessionEmotionalState, number> = {
  frustrated: 10,
  confused: 7,
  neutral: 3,
  positive: 1,
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;
const isNumber = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** 任意输入 → 0-1（非有限数一律视为"没有信号"返回 null，绝不猜 0.5） */
function toUnit(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : null;
}

/** 从落库消息抽取逐轮观测：排除检查点合成消息与伴学消息（不属于正式学生回合） */
export function extractSessionTurnObservations(
  messages: ReadonlyArray<SessionEvaluationTurnMessage>,
): SessionTurnObservation[] {
  const observations: SessionTurnObservation[] = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.checkpoint === true || message.peer === true) continue;
    const analysis = message.analysis;
    if (!analysis || typeof analysis !== 'object') continue;

    const rawConfusion = analysis.confusionPoints;
    const confusionCount = Array.isArray(rawConfusion)
      ? rawConfusion.filter((point) => typeof point === 'string' && point.trim()).length
      : null;

    const ktEstimate = analysis.ktEstimate && typeof analysis.ktEstimate === 'object'
      ? analysis.ktEstimate
      : null;
    const masteryValues = ktEstimate && Array.isArray(ktEstimate.conceptMastery)
      ? ktEstimate.conceptMastery
          .map((item) => (item && typeof item === 'object' ? toUnit((item as { mastery?: unknown }).mastery) : null))
          .filter((value): value is number => value !== null)
      : [];
    const mastery = masteryValues.length > 0
      ? masteryValues.reduce((sum, value) => sum + value, 0) / masteryValues.length
      : null;

    const rawEmotion = typeof analysis.emotionalState === 'string' ? analysis.emotionalState : null;
    const emotionalState: SessionEmotionalState | null =
      rawEmotion === 'positive' || rawEmotion === 'neutral' || rawEmotion === 'frustrated' || rawEmotion === 'confused'
        ? rawEmotion
        : null;

    observations.push({
      understanding: toUnit(analysis.understanding),
      engagement: toUnit(analysis.engagement),
      loadIndex: toUnit(analysis.loadIndex),
      emotionalState,
      confusionCount,
      mastery,
      taskDifficulty: ktEstimate ? toUnit(ktEstimate.currentTaskDifficulty) : null,
    });
  }

  return observations;
}

/**
 * 加权平均：缺失分量由调用方以 null 传入并在此剔重（权重 0 → 重新归一）。
 * 全部缺失返回 null（表示"这一项这一轮没有依据"）。
 */
function weightedMean(components: Array<WeightedComponent | null>): number | null {
  const usable = components.filter((component): component is WeightedComponent =>
    component !== null && component.weight > 0 && Number.isFinite(component.value));
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, component) => sum + component.weight, 0);
  const weightedSum = usable.reduce((sum, component) => sum + component.value * component.weight, 0);
  return weightedSum / totalWeight;
}

/** 单轮压力 0-10（负荷 / 困惑 / 负性情绪 / 任务难度；缺项权重 0） */
function turnLss(observation: SessionTurnObservation): number | null {
  return weightedMean([
    observation.loadIndex !== null ? { value: observation.loadIndex * 10, weight: 0.45 } : null,
    observation.confusionCount !== null
      ? { value: Math.min(1, observation.confusionCount / 2) * 10, weight: 0.2 }
      : null,
    observation.emotionalState !== null ? { value: EMOTION_STRESS[observation.emotionalState], weight: 0.25 } : null,
    observation.taskDifficulty !== null ? { value: observation.taskDifficulty * 10, weight: 0.1 } : null,
  ]);
}

/** 单轮疲劳 0-10（负荷 / 负性情绪 / 参与度不足；缺项权重 0） */
function turnLf(observation: SessionTurnObservation): number | null {
  return weightedMean([
    observation.loadIndex !== null ? { value: observation.loadIndex * 10, weight: 0.4 } : null,
    observation.emotionalState !== null ? { value: EMOTION_STRESS[observation.emotionalState], weight: 0.3 } : null,
    observation.engagement !== null ? { value: (1 - observation.engagement) * 10, weight: 0.3 } : null,
  ]);
}

/** 单轮知识获得质量 0-10（理解 / 掌握度 / 参与度；缺项权重 0） */
function turnKtl(observation: SessionTurnObservation): number | null {
  return weightedMean([
    observation.understanding !== null ? { value: observation.understanding * 10, weight: 0.55 } : null,
    observation.mastery !== null ? { value: observation.mastery * 10, weight: 0.3 } : null,
    observation.engagement !== null ? { value: observation.engagement * 10, weight: 0.15 } : null,
  ]);
}

/** 中位数（偶数个取中间两值平均），空数组返回 null */
export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 末段窗口均值（窗口取 min(size, n)） */
export function meanOfLast(values: ReadonlyArray<number>, size: number): number | null {
  if (values.length === 0) return null;
  const window = Math.max(1, Math.min(size, values.length));
  const tail = values.slice(values.length - window);
  return tail.reduce((sum, value) => sum + value, 0) / tail.length;
}

/** 最差连续窗口均值（窗口取 min(size, n)）：对离群稳健的"持续最差"口径 */
export function worstWindowMean(values: ReadonlyArray<number>, size: number): number | null {
  if (values.length === 0) return null;
  const window = Math.max(1, Math.min(size, values.length));
  let worst: number | null = null;
  for (let start = 0; start + window <= values.length; start += 1) {
    let sum = 0;
    for (let index = start; index < start + window; index += 1) sum += values[index];
    const average = sum / window;
    if (worst === null || average > worst) worst = average;
  }
  return worst;
}

function buildCoverage(observations: number, lss: number, ktl: number, lf: number): SessionEvaluationCoverage {
  const ratio = (count: number) => (observations > 0 ? count / observations : 0);
  const lssCoverage = ratio(lss);
  const ktlCoverage = ratio(ktl);
  const lfCoverage = ratio(lf);
  return {
    lss: round2(lssCoverage),
    ktl: round2(ktlCoverage),
    lf: round2(lfCoverage),
    overall: round2((lssCoverage + ktlCoverage + lfCoverage) / 3),
  };
}

function buildZeroEvidence(turnCount: number): DeterministicSessionEvaluation {
  return {
    lss: SESSION_EVALUATION_ZERO_EVIDENCE.lss,
    ktl: SESSION_EVALUATION_ZERO_EVIDENCE.ktl,
    lf: SESSION_EVALUATION_ZERO_EVIDENCE.lf,
    confidence: SESSION_EVALUATION_ZERO_EVIDENCE.confidence,
    formulaVersion: FORMULA_VERSION,
    basis: 'zero-evidence',
    turnCount,
    coverage: { lss: 0, ktl: 0, lf: 0, overall: 0 },
    diagnostics: {
      lss: { method: 'none', samples: 0, value: null },
      ktl: { method: 'none', samples: 0, value: null },
      lf: { method: 'none', samples: 0, value: null },
    },
  };
}

/**
 * 确定性聚合主入口（纯函数）。
 * 输出仍是 0-10，与下游 `SessionScoreInput` 契约一致。
 */
export function aggregateSessionEvaluation(
  observations: ReadonlyArray<SessionTurnObservation>,
): DeterministicSessionEvaluation {
  const lssSeries = observations.map(turnLss).filter(isNumber);
  const ktlSeries = observations.map(turnKtl).filter(isNumber);
  const lfSeries = observations.map(turnLf).filter(isNumber);

  if (observations.length === 0 || (lssSeries.length === 0 && ktlSeries.length === 0 && lfSeries.length === 0)) {
    return buildZeroEvidence(observations.length);
  }

  // LSS：中位数（单轮极值不改变压力中心）
  const lssRaw = median(lssSeries);
  // KTL：中位数与末段均值各半（典型质量 + 结束稳定性）
  const ktlMedian = median(ktlSeries);
  const ktlTail = meanOfLast(ktlSeries, KTL_TAIL_SIZE);
  const ktlRaw = ktlMedian !== null && ktlTail !== null
    ? 0.5 * ktlMedian + 0.5 * ktlTail
    : (ktlMedian ?? ktlTail);
  // LF：最差连续窗口均值（持续最差的一段代表负担）
  const lfRaw = worstWindowMean(lfSeries, WORST_WINDOW_SIZE);

  // 某一项整节课都没有信号：用与零证据同源的保守常量，而不是编造 0/5。
  // 该缺口会被 coverage/confidence 显式暴露，供比对时识别。
  const resolveMetric = (
    value: number | null,
    samples: number,
    method: string,
  ): { value: number; diagnostic: SessionEvaluationMetricDiagnostic } => {
    const normalized = value === null ? null : round1(clamp(value, 0, 10));
    return {
      value: normalized === null ? SESSION_EVALUATION_ZERO_EVIDENCE.lss : normalized,
      diagnostic: { method, samples, value: normalized },
    };
  };

  const lss = resolveMetric(lssRaw, lssSeries.length, 'median');
  const ktl = resolveMetric(ktlRaw, ktlSeries.length, 'median+tail-mean');
  const lf = resolveMetric(
    lfRaw,
    lfSeries.length,
    `worst-window-mean(${Math.min(WORST_WINDOW_SIZE, Math.max(1, lfSeries.length))})`,
  );

  const coverage = buildCoverage(observations.length, lssSeries.length, ktlSeries.length, lfSeries.length);
  const volume = clamp(observations.length / FULL_CONFIDENCE_TURNS, 0, 1);
  const confidence = round2(clamp(coverage.overall * volume, 0.05, 0.9));

  return {
    lss: lss.value,
    ktl: ktl.value,
    lf: lf.value,
    confidence,
    formulaVersion: FORMULA_VERSION,
    basis: 'per-turn-observations',
    turnCount: observations.length,
    coverage,
    diagnostics: {
      lss: lss.diagnostic,
      ktl: ktl.diagnostic,
      lf: lf.diagnostic,
    },
  };
}

/** 便捷入口：直接吃 `teaching_sessions.messages[]` */
export function aggregateSessionEvaluationFromMessages(
  messages: ReadonlyArray<SessionEvaluationTurnMessage>,
): DeterministicSessionEvaluation {
  return aggregateSessionEvaluation(extractSessionTurnObservations(messages));
}

/**
 * 影子双写载荷：把确定性结果与 LLM 结果并存，供后续比对分布。
 * **不参与任何现有消费方**（现有代码仍读 LLM 值）。
 */
export interface SessionEvaluationShadowLlmInput {
  sessionLss: number;
  sessionKtl: number;
  sessionLf: number;
  confidence: number;
  metricTiers?: {
    sessionLss?: SessionEvaluationTier;
    sessionKtl?: SessionEvaluationTier;
    sessionLf?: SessionEvaluationTier;
  };
}

export interface SessionEvaluationShadow {
  formulaVersion: string;
  recordedAt: string;
  deterministic: {
    lss: number;
    ktl: number;
    lf: number;
    confidence: number;
    basis: DeterministicSessionEvaluation['basis'];
    turnCount: number;
    coverage: SessionEvaluationCoverage;
  };
  llm: {
    lss: number;
    ktl: number;
    lf: number;
    confidence: number;
    tiers: { sessionLss: string | null; sessionKtl: string | null; sessionLf: string | null };
    /** 档位映射出的区间/不确定度（表达"high 不是精确的 9"）；legacy 数值输出时为 null */
    tierRanges: {
      sessionLss: { value: number; min: number; max: number; uncertainty: number } | null;
      sessionKtl: { value: number; min: number; max: number; uncertainty: number } | null;
      sessionLf: { value: number; min: number; max: number; uncertainty: number } | null;
    };
  } | null;
  delta: { lss: number; ktl: number; lf: number } | null;
}

function resolveTierRange(tier: SessionEvaluationTier | undefined) {
  if (!tier) return null;
  const resolved = resolveSessionEvaluationTier(tier);
  return {
    value: resolved.value,
    min: resolved.range.min,
    max: resolved.range.max,
    uncertainty: resolved.uncertainty,
  };
}

/** 纯函数：组装影子载荷（recordedAt 由调用方注入，保证可重放/可单测） */
export function buildSessionEvaluationShadow(input: {
  llm: SessionEvaluationShadowLlmInput | null;
  deterministic: DeterministicSessionEvaluation;
  recordedAt: string;
}): SessionEvaluationShadow {
  const { llm, deterministic, recordedAt } = input;
  const round2Delta = (a: number, b: number) => Math.round((a - b) * 100) / 100;
  return {
    formulaVersion: deterministic.formulaVersion,
    recordedAt,
    deterministic: {
      lss: deterministic.lss,
      ktl: deterministic.ktl,
      lf: deterministic.lf,
      confidence: deterministic.confidence,
      basis: deterministic.basis,
      turnCount: deterministic.turnCount,
      coverage: deterministic.coverage,
    },
    llm: llm
      ? {
          lss: llm.sessionLss,
          ktl: llm.sessionKtl,
          lf: llm.sessionLf,
          confidence: llm.confidence,
          tiers: {
            sessionLss: llm.metricTiers?.sessionLss ?? null,
            sessionKtl: llm.metricTiers?.sessionKtl ?? null,
            sessionLf: llm.metricTiers?.sessionLf ?? null,
          },
          tierRanges: {
            sessionLss: resolveTierRange(llm.metricTiers?.sessionLss),
            sessionKtl: resolveTierRange(llm.metricTiers?.sessionKtl),
            sessionLf: resolveTierRange(llm.metricTiers?.sessionLf),
          },
        }
      : null,
    delta: llm
      ? {
          lss: round2Delta(deterministic.lss, llm.sessionLss),
          ktl: round2Delta(deterministic.ktl, llm.sessionKtl),
          lf: round2Delta(deterministic.lf, llm.sessionLf),
        }
      : null,
  };
}
