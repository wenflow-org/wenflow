/**
 * 轻量真值发现（Q7）：同一学习事实的多源主张，按来源可靠性显式融合。
 *
 * 项目纪律是「LLM 只出观测/建议，代码裁决」（doc/UPGRADE_DIRECTION_20Q.md Q7、§5）。
 * 同一个事实（如「已掌握概念 X」）会来自多个来源，可靠性差异极大；如果谁最后写入谁生效，
 * 就会被最不可靠的来源（自评 / LLM 推断）覆盖代码裁决。本模块把融合规则显式化：
 *
 * - 来源权重（可覆盖，默认见 `DEFAULT_SOURCE_WEIGHTS`）：
 *     code_judged 0.95 > structured_choice 0.75 > llm_inference 0.50 > self_report 0.20
 * - 单条主张的有效权重 = `baseWeight(source) × (confidence ?? 1)`
 * - 融合值 = `Σ(weight_i × value_i) / Σ(weight_i)`，落在 [0,1]
 * - `disagreement` = 以融合值为中心的**加权标准差**（越大 = 各来源越不一致）
 * - `metacognitiveCalibration(selfValue, truthValue)` = 自评与融合真值之差 = 元认知校准偏置
 *
 * **纯函数、无 IO、确定性**：不读库、不写库、不调用 LLM；`claims` 顺序即 `contributions` 顺序，
 * 时间戳 `at` 只作元数据、不参与任何计算（因此同一批 claim 无论顺序/时间如何都得到同一结果）。
 *
 * 角色边界：本模块**不**决定怎么消费融合值（不写 `learner_projections`、不改调度/难度）。
 * 后续接入知识状态融合的方式见文件末尾注释。
 */

/** 来源类别：按「客观性」从高到低排列。 */
export const SOURCE_CLASSES = ['code_judged', 'structured_choice', 'llm_inference', 'self_report'] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** 各来源的默认可靠性权重（单条主张再乘 confidence）。 */
export type SourceWeights = Record<SourceClass, number>;

/**
 * 默认来源权重（可被 `options.weights` 逐项覆盖）。
 *
 * 取值理由（为什么这个序、为什么这些量级）：
 * - `code_judged` 0.95：代码裁决的检查点结果（无答案键/按集合精确判定，LLM 不在回路里），
 *   最接近真值。留 0.05 的余量是因为题目本身可能出错/解析失败，且避免单条观测被当成绝对确定。
 *   整体效果是「代码裁决一票否决主观声称」：一条代码裁决权重（0.95）远大于自评（0.20），
 *   自评无法凭数量或时效压过它（本模块是软加权，不做硬覆盖）。
 * - `structured_choice` 0.75：客观/结构化测验（选择题等可按集合精确判定），比代码裁决弱一档，
 *   因为存在「蒙对」与题目质量噪声，但仍显著高于任何语义/主观判断。
 * - `llm_inference` 0.50：LLM 的定性推断（如 learner-state-review 的 conceptAssessments），
 *   是语义判断、不满足「单技能二值作答」假设，只作**弱证据**（与 concept-belief 的诚实边界一致）。
 * - `self_report` 0.20：学习者自评。**自评不作真实掌握依据**——它的正当用途是与融合真值做差，
 *   派生元认知校准偏置（见 `metacognitiveCalibration`），而不是断言「已掌握」。
 */
export const DEFAULT_SOURCE_WEIGHTS: Readonly<SourceWeights> = {
  code_judged: 0.95,
  structured_choice: 0.75,
  llm_inference: 0.5,
  self_report: 0.2,
};

/** 元认知校准被判定为「准确」的容差（|gap| 小于它即视为 calibrate 正常）。 */
export const CALIBRATION_ACCURATE_BAND = 0.05;

/** 一条关于某学习事实的主张。`value` 语义为「该事实成立的概率/程度」，约定在 [0,1]。 */
export interface TruthClaim {
  source: SourceClass;
  /** 主张值 0–1（越接近 1 越倾向于「已掌握/成立」）；非法/越界值会被跳过或夹到边界。 */
  value: number;
  /** 该来源对此条主张的置信度 0–1；缺省 1。 */
  confidence?: number;
  /** ISO 时间戳，仅元数据，不参与计算。 */
  at?: string;
}

/** 单条主张对融合的贡献（按来源标注；多条同源主张即为「按来源的逐条拆解」）。 */
export interface TruthContribution {
  source: SourceClass;
  /** 有效权重 = baseWeight(source) × confidence */
  weight: number;
  /** 夹到 [0,1] 后的主张值 */
  value: number;
  /** 加权贡献 = weight × value（分子项） */
  contribution: number;
}

export interface TruthResult {
  /** 融合后的真值，0–1；无有效权重时为 0。 */
  value: number;
  /** Σ 有效权重；为 0 表示没有可用证据。 */
  totalWeight: number;
  contributions: TruthContribution[];
  /** 以融合值为中心的加权标准差；无有效权重或所有值一致时为 0。 */
  disagreement: number;
}

export interface DiscoverTruthOptions {
  /** 逐项覆盖默认来源权重（只接受 0–1 的有限数，非法值忽略）。 */
  weights?: Partial<SourceWeights>;
}

/** 元认知校准结果：自评与真值的偏差（带符号 gap + 幅度）。 */
export interface MetacognitiveCalibration {
  selfValue: number;
  truthValue: number;
  /** 带符号偏差 = selfValue − truthValue。正 = 高估（overconfident），负 = 低估（underconfident）。 */
  gap: number;
  /** 偏差幅度 = |gap|（便于展示/聚合，不丢符号）。 */
  magnitude: number;
  /** 方向判定，术语对齐 calibration.service.ts 的 `CalibrationBias`。 */
  bias: 'overconfident' | 'accurate' | 'underconfident';
}

/** 夹到 [0,1]；非有限值返回 0（调用方对主张值应先做有限性判断）。 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isSourceClass(value: unknown): value is SourceClass {
  return typeof value === 'string' && (SOURCE_CLASSES as readonly string[]).includes(value);
}

/** 合并默认权重与覆盖项；只接受 0–1 的有限数。 */
function resolveWeights(overrides?: Partial<SourceWeights>): SourceWeights {
  const resolved: SourceWeights = { ...DEFAULT_SOURCE_WEIGHTS };
  if (!overrides) return resolved;
  for (const source of SOURCE_CLASSES) {
    const value = overrides[source];
    if (typeof value === 'number' && Number.isFinite(value)) resolved[source] = clamp01(value);
  }
  return resolved;
}

/** 置信度归一化：缺省 → 1；非有限 → 1（不因缺失/坏值清零证据）；否则夹到 [0,1]。 */
function normalizeConfidence(confidence: number | undefined | null): number {
  if (confidence === undefined || confidence === null) return 1;
  if (!Number.isFinite(confidence)) return 1;
  return clamp01(confidence);
}

/**
 * 融合多源主张，得到一个加权真值 + 逐条来源拆解 + 分歧度。
 *
 * 确定性：输出仅依赖 `claims` 内容与其顺序（`at` 不影响），不依赖当前时间或随机源。
 * 安全性：空/缺省输入、非法来源、非有限 value 都不会抛错，安全退化。
 */
export function discoverTruth(
  claims: readonly TruthClaim[] | null | undefined,
  options: DiscoverTruthOptions = {},
): TruthResult {
  const weights = resolveWeights(options.weights);
  const contributions: TruthContribution[] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const claim of claims ?? []) {
    if (!claim || !isSourceClass(claim.source)) continue;
    if (!Number.isFinite(claim.value)) continue; // 坏值跳过，避免污染融合
    const value = clamp01(claim.value);
    const weight = weights[claim.source] * normalizeConfidence(claim.confidence);
    const contribution = weight * value;
    contributions.push({ source: claim.source, weight, value, contribution });
    totalWeight += weight;
    weightedSum += contribution;
  }

  const value = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let disagreement = 0;
  if (totalWeight > 0) {
    let variance = 0;
    for (const item of contributions) {
      const delta = item.value - value;
      variance += item.weight * delta * delta;
    }
    disagreement = Math.sqrt(variance / totalWeight);
  }

  return { value, totalWeight, contributions, disagreement };
}

/**
 * 元认知校准：自评值与融合真值之差。
 *
 * 语义（对齐 calibration.service.ts 的「元认知校准」）：
 * - `gap > +band` → overconfident（自评高于真值 = 高估）
 * - `gap < −band` → underconfident（自评低于真值 = 低估）
 * - 其余 → accurate
 *
 * 输入会被夹到 [0,1]；非有限值按 0 处理（调用方应保证有值，否则会得到误导性的「低估」）。
 */
export function metacognitiveCalibration(
  selfValue: number,
  truthValue: number,
): MetacognitiveCalibration {
  const self = clamp01(selfValue);
  const truth = clamp01(truthValue);
  const gap = self - truth;
  const magnitude = Math.abs(gap);
  let bias: MetacognitiveCalibration['bias'] = 'accurate';
  if (gap > CALIBRATION_ACCURATE_BAND) bias = 'overconfident';
  else if (gap < -CALIBRATION_ACCURATE_BAND) bias = 'underconfident';
  return { selfValue: self, truthValue: truth, gap, magnitude, bias };
}

/**
 * 找出对本次融合贡献有效权重最大的来源（按 `baseWeight × confidence` 聚合）。
 * 无有效主张时返回 null；并列时取先出现的来源（Map 插入顺序，保持确定性）。
 */
export function dominantSource(
  claims: readonly TruthClaim[] | null | undefined,
  options: DiscoverTruthOptions = {},
): SourceClass | null {
  const weights = resolveWeights(options.weights);
  const totals = new Map<SourceClass, number>();
  for (const claim of claims ?? []) {
    if (!claim || !isSourceClass(claim.source)) continue;
    if (!Number.isFinite(claim.value)) continue;
    const weight = weights[claim.source] * normalizeConfidence(claim.confidence);
    totals.set(claim.source, (totals.get(claim.source) ?? 0) + weight);
  }
  let best: SourceClass | null = null;
  let bestWeight = 0;
  for (const [source, weight] of totals) {
    if (weight > bestWeight) {
      best = source;
      bestWeight = weight;
    }
  }
  return best;
}

/*
 * ── 后续接入知识状态融合（不在本模块实现）──────────────────────────────
 * 1. 每个写入源先各自转成一条 `TruthClaim`：
 *    - 检查点落 `learner_evidence` 时，按 `judgedBy`（code → code_judged；结构化作答 → structured_choice）
 *    - learner-state-review 的 conceptAssessments → llm_inference
 *    - goal 对话 / 课后 JOL 自评 → self_report
 * 2. 对每个 (userId, conceptKey) 收集窗口内主张，调 `discoverTruth` 得真值。
 * 3. 消费方式（二选一，均不改变本模块）：
 *    - 作为 `concept-belief.service` 的观测输入（融合值 = 软化的二值观测）；
 *    - 或作为 profile 的独立 `truthValue`，与自评做 `metacognitiveCalibration`，
 *      用偏置覆盖/校正 `selfAssessmentAccuracy`（calibration.service.ts 现有字段）。
 * 4. 分歧度 `disagreement` 高时降权使用（真值本身也不可信），必要时触发重测/锚题。
 * 本文件保持纯函数，落库与调度由调用方负责。
 */
