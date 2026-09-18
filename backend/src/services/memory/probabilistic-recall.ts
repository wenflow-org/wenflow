/**
 * 概率化回忆（Q4 基础设施）
 * ============================================================
 * 把虚拟学习者的记忆从「三桶静态标签（记得/不记得）」升级为：
 *   记忆强度 = 确定性 FSRS 保留率（本模块不重算，由调用方传入 retrievability）
 *   本次能否提取 = 概率事件（本模块负责）
 *
 * 参考设计：外部「ACT-R 激活 + logistic 噪声 + 混淆池」提案，
 * 但做了两处**关键纠正**（见下），避免参考实现把 VAGUE / FAILED 吃掉。
 *
 * 算法（纯函数、零 IO、确定性；绝不调用 Math.random()）：
 *   1. SplitMix64 PRNG，种子 = sha256(seedPhrase) 前 16 个 hex 字符（64-bit state）。
 *   2. seedPhrase = `${experimentRunSeed}:${virtualLearnerId}:${sessionId}:${stepIndex}:${targetConceptKey}`
 *   3. baseActivation = logit(clamp(R, 1e-5, 1-1e-5))
 *   4. targetActivation = baseActivation + alpha * cueMatchLevel + noise,
 *      noise = prng.nextLogistic(noiseScale)
 *   5. 分档：
 *        targetActivation >= threshold + deltaClear        → CLEAR
 *        targetActivation >= threshold - deltaVague        → VAGUE 档（进入第 6 步）
 *        否则                                              → FAILED
 *   6. 混淆竞争（仅 VAGUE 档；相对参考实现的两处纠正）：
 *        - 纠正 A：只有 similarity >= SIMILARITY_GATE(0.75) 的易混项参与，其余直接忽略。
 *        - 纠正 B：易混项得分 = cBase + CONFUSION_GAIN * similarity - CONFUSION_PENALTY + 噪声，
 *          其中项目参数为 0.8 / 0.7（参考实现用 1.5 / 0.7，会把 VAGUE/FAILED 吃掉）。
 *          cBase 缺省 = 目标 baseActivation（易混池由离线 LLM 判定表提供，未带各自 FSRS 强度）。
 *        目标本身以 targetActivation 作为竞争得分参与 softmax（温度 0.8），用 nextFloat() 采样。
 *        仅当胜者不是目标且其得分 >= threshold 时判为 CONFUSED（outputConceptKey = 胜者）。
 *
 * 该模块目前**未被接线**（不接入模拟器 / prompts）；只提供可复现的纯函数接口。
 */

import { createHash } from 'crypto';

/** SplitMix64 常量（标准实现，勿改动） */
const MASK_64 = 0xffffffffffffffffn;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MIX_MULTIPLIER_1 = 0xbf58476d1ce4e5b9n;
const MIX_MULTIPLIER_2 = 0x94d049bb133111ebn;
/** 2^53：nextFloat 取高 53 位得到 [0,1) */
const TWO_POW_53 = 9007199254740992;

/** logistic 逆 CDF 的 u 上下限，防止 log(0) / log(inf) */
const LOGISTIC_U_FLOOR = 1e-7;
const LOGISTIC_U_CEIL = 1 - 1e-7;

/** FSRS 保留率映射到 logit 时的数值夹紧，避免 ±Infinity */
export const RETRIEVABILITY_FLOOR = 1e-5;

/** 易混项参与竞争的最低相似度（纠正 A：低于此值直接忽略） */
export const SIMILARITY_GATE = 0.75;
/** 易混项相似度增益（纠正 B：0.8，参考实现为 1.5） */
export const CONFUSION_GAIN = 0.8;
/** 易混项基础惩罚（取 0.7，与参考实现一致） */
export const CONFUSION_PENALTY = 0.7;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 回忆状态：清晰 / 含糊 / 记错（混淆）/ 完全提取失败 */
export type RecallStatus = 'CLEAR' | 'VAGUE' | 'CONFUSED' | 'FAILED';

/** 目标激活落在哪一档（竞争前的中间量） */
export type RecallBand = 'clear' | 'vague' | 'failed';

/** 可调参数（全部可覆盖，缺省见 DEFAULT_RECALL_OPTIONS） */
export interface ProbabilisticRecallOptions {
  /** CLEAR 边界偏移：targetActivation >= threshold + deltaClear */
  deltaClear: number;
  /** VAGUE 边界偏移：targetActivation >= threshold - deltaVague */
  deltaVague: number;
  /** 激活判定阈值 */
  threshold: number;
  /** 线索匹配对激活的权重 */
  alpha: number;
  /** logistic 噪声尺度 */
  noiseScale: number;
  /** 线索匹配水平（缺省 0.5） */
  cueMatchLevel: number;
  /** 混淆相似度增益 */
  confusionGain: number;
  /** 混淆基础惩罚 */
  confusionPenalty: number;
  /** 易混项参与门槛 */
  similarityGate: number;
  /** softmax 温度 */
  softmaxTemperature: number;
}

/** 缺省参数（Q4 提案值） */
export const DEFAULT_RECALL_OPTIONS: ProbabilisticRecallOptions = {
  deltaClear: 0.6,
  deltaVague: 0.8,
  threshold: 0.0,
  alpha: 0.8,
  noiseScale: 0.4,
  cueMatchLevel: 0.5,
  confusionGain: CONFUSION_GAIN,
  confusionPenalty: CONFUSION_PENALTY,
  similarityGate: SIMILARITY_GATE,
  softmaxTemperature: 0.8,
};

/** 易混池条目（由离线 LLM 判定表提供） */
export interface ConfusableInput {
  /** 易混概念键 */
  conceptKey: string;
  /** 与目标概念的语义相似度 [0,1] */
  similarity: number;
}

/** 一次概率回忆的输入（全部确定性） */
export interface ProbabilisticRecallParams {
  /** 实验运行种子（同一次回放应保持一致） */
  experimentRunSeed: string | number;
  /** 虚拟学习者 id */
  virtualLearnerId: string | number;
  /** 会话 id */
  sessionId: string | number;
  /** 会话内步序号（同一步内多次采样不应重复） */
  stepIndex: number;
  /** 目标概念键 */
  targetConceptKey: string;
  /** FSRS 保留率 [0,1]：由调用方从 FSRS 提供，本模块不重算 */
  retrievability: number;
  /** 易混池（可空；相似度 < similarityGate 的条目会被忽略） */
  confusables?: ReadonlyArray<ConfusableInput> | null;
  /** 参数覆盖 */
  options?: Partial<ProbabilisticRecallOptions>;
}

/** 单个竞争候选（目标或易混项） */
export interface RecallCandidateTrace {
  conceptKey: string;
  /** 竞争得分 */
  score: number;
  /** softmax 概率 */
  probability: number;
  isTarget: boolean;
}

/** VAGUE 档内混淆竞争的完整轨迹 */
export interface RecallCompetitionTrace {
  /** cBase：易混项共享的基础激活（缺省 = 目标 baseActivation） */
  cBase: number;
  candidates: RecallCandidateTrace[];
  winnerKey: string;
  winnerIsTarget: boolean;
  winnerScore: number;
}

/** 可复现推导轨迹（用于回放与调试，JSON 安全） */
export interface RecallDerivationTrace {
  seedPhrase: string;
  baseActivation: number;
  noiseValue: number;
  sampledActivation: number;
  alpha: number;
  cueMatchLevel: number;
  deltaClear: number;
  deltaVague: number;
  threshold: number;
  band: RecallBand;
  /** 通过相似度门槛的易混项 */
  eligibleConfusables: Array<{ conceptKey: string; similarity: number }>;
  /** 仅在 VAGUE 档存在 */
  competition?: RecallCompetitionTrace;
}

/** 概率回忆结果 */
export interface ProbabilisticRecallResult {
  status: RecallStatus;
  /** 实际输出的概念：CLEAR/VAGUE/FAILED 恒为目标；CONFUSED 为胜出易混项 */
  outputConceptKey: string;
  /** 步骤 4 的目标采样激活 */
  sampledActivation: number;
  /** 步骤 4 的 logistic 噪声 */
  noiseValue: number;
  /** 完整推导轨迹 */
  derivationTrace: RecallDerivationTrace;
}

/**
 * SplitMix64 PRNG。
 *
 * 种子 = sha256(seedPhrase) 十六进制摘要的前 16 个字符（64-bit）。
 * 相同 seedPhrase 必然产生相同序列（跨进程 / 跨机器一致）。
 */
export class SplitMix64PRNG {
  private state: bigint;

  constructor(seedPhrase: string) {
    const digest = createHash('sha256').update(seedPhrase, 'utf8').digest('hex');
    this.state = BigInt(`0x${digest.slice(0, 16)}`);
  }

  /** 生成下一个 64-bit 无符号整数 */
  nextUint64(): bigint {
    this.state = (this.state + GOLDEN_GAMMA) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * MIX_MULTIPLIER_1) & MASK_64;
    z = ((z ^ (z >> 27n)) * MIX_MULTIPLIER_2) & MASK_64;
    z = (z ^ (z >> 31n)) & MASK_64;
    return z;
  }

  /** 生成 [0,1) 的浮点数（取高 53 位，double 精度安全） */
  nextFloat(): number {
    return Number(this.nextUint64() >> 11n) / TWO_POW_53;
  }

  /**
   * 生成服从 logistic 分布的噪声：scale * ln(u / (1-u))，u ~ U(0,1)。
   * u 夹紧到 [1e-7, 1-1e-7]，保证有限；scale 非正 / 非法时返回 0。
   */
  nextLogistic(scale: number): number {
    if (!Number.isFinite(scale) || scale <= 0) return 0;
    const u = clampNumber(this.nextFloat(), LOGISTIC_U_FLOOR, LOGISTIC_U_CEIL);
    return scale * Math.log(u / (1 - u));
  }
}

/** 构造确定性种子串（步骤 2） */
export function buildRecallSeed(
  params: Pick<
    ProbabilisticRecallParams,
    'experimentRunSeed' | 'virtualLearnerId' | 'sessionId' | 'stepIndex' | 'targetConceptKey'
  >,
): string {
  return `${params.experimentRunSeed}:${params.virtualLearnerId}:${params.sessionId}:${params.stepIndex}:${params.targetConceptKey}`;
}

/**
 * 把 FSRS 保留率映射为基础激活（logit）。R 夹紧到 [1e-5, 1-1e-5]。
 * 非有限 R 视为中性 0.5（激活 0），保证边界安全。
 */
export function computeBaseActivation(retrievability: number): number {
  const r = Number.isFinite(retrievability)
    ? clampNumber(retrievability, RETRIEVABILITY_FLOOR, 1 - RETRIEVABILITY_FLOOR)
    : 0.5;
  return Math.log(r / (1 - r));
}

/** softmax（数值稳定版）；空输入返回空数组 */
function softmaxProbabilities(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const t = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of scores) {
    if (s > max) max = s;
  }
  const exps = scores.map((s) => Math.exp((s - max) / t));
  let sum = 0;
  for (const e of exps) sum += e;
  if (!Number.isFinite(sum) || sum <= 0) {
    return scores.map(() => 1 / scores.length);
  }
  return exps.map((e) => e / sum);
}

/** 用 [0,1) 随机数按累计概率采样下标 */
function sampleIndex(probabilities: number[], r: number): number {
  let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i];
    if (r < cumulative) return i;
  }
  return probabilities.length - 1;
}

/**
 * 概率化回忆主入口（纯函数、确定性、零 IO）。
 *
 * @example
 * const r = probabilisticRecall({
 *   experimentRunSeed: 'exp-2026-09-18',
 *   virtualLearnerId: 'vl-42',
 *   sessionId: 'sess-7',
 *   stepIndex: 3,
 *   targetConceptKey: 'concept.fractions',
 *   retrievability: 0.62,
 *   confusables: [{ conceptKey: 'concept.decimals', similarity: 0.9 }],
 * });
 */
export function probabilisticRecall(params: ProbabilisticRecallParams): ProbabilisticRecallResult {
  const options: ProbabilisticRecallOptions = { ...DEFAULT_RECALL_OPTIONS, ...(params.options ?? {}) };
  const seedPhrase = buildRecallSeed(params);
  const prng = new SplitMix64PRNG(seedPhrase);

  const baseActivation = computeBaseActivation(params.retrievability);
  const noiseValue = prng.nextLogistic(options.noiseScale);
  const sampledActivation = baseActivation + options.alpha * options.cueMatchLevel + noiseValue;

  const clearBoundary = options.threshold + options.deltaClear;
  const vagueBoundary = options.threshold - options.deltaVague;
  const band: RecallBand =
    sampledActivation >= clearBoundary ? 'clear' : sampledActivation >= vagueBoundary ? 'vague' : 'failed';

  // 纠正 A：先做相似度门槛过滤，不合格的易混项完全不参与、也不消耗随机数，
  // 因此「低相似度易混项」与「无易混项」对同一 seed 的结果逐字节一致。
  const eligibleConfusables = (params.confusables ?? [])
    .filter((c) => Number.isFinite(c.similarity) && c.similarity >= options.similarityGate)
    .map((c) => ({ conceptKey: c.conceptKey, similarity: c.similarity }));

  let status: RecallStatus;
  let outputConceptKey = params.targetConceptKey;
  let competition: RecallCompetitionTrace | undefined;

  if (band === 'clear') {
    status = 'CLEAR';
  } else if (band === 'failed') {
    status = 'FAILED';
  } else {
    // VAGUE 档：目标以 sampledActivation 参与，易混项按修正后的公式计分。
    const candidates: Array<{ conceptKey: string; score: number; isTarget: boolean }> = [
      { conceptKey: params.targetConceptKey, score: sampledActivation, isTarget: true },
    ];
    for (const c of eligibleConfusables) {
      const score =
        baseActivation +
        options.confusionGain * c.similarity -
        options.confusionPenalty +
        prng.nextLogistic(options.noiseScale);
      candidates.push({ conceptKey: c.conceptKey, score, isTarget: false });
    }

    const probabilities = softmaxProbabilities(
      candidates.map((c) => c.score),
      options.softmaxTemperature,
    );
    const winnerIndex = sampleIndex(probabilities, prng.nextFloat());
    const winner = candidates[winnerIndex];

    competition = {
      cBase: baseActivation,
      candidates: candidates.map((c, i) => ({
        conceptKey: c.conceptKey,
        score: c.score,
        probability: probabilities[i],
        isTarget: c.isTarget,
      })),
      winnerKey: winner.conceptKey,
      winnerIsTarget: winner.isTarget,
      winnerScore: winner.score,
    };

    if (!winner.isTarget && winner.score >= options.threshold) {
      status = 'CONFUSED';
      outputConceptKey = winner.conceptKey;
    } else {
      status = 'VAGUE';
    }
  }

  return {
    status,
    outputConceptKey,
    sampledActivation,
    noiseValue,
    derivationTrace: {
      seedPhrase,
      baseActivation,
      noiseValue,
      sampledActivation,
      alpha: options.alpha,
      cueMatchLevel: options.cueMatchLevel,
      deltaClear: options.deltaClear,
      deltaVague: options.deltaVague,
      threshold: options.threshold,
      band,
      eligibleConfusables,
      ...(competition ? { competition } : {}),
    },
  };
}
