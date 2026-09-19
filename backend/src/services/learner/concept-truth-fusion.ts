/**
 * Q7 接线：概念状态的多源真值裁决（消费 `truth-discovery`）。
 *
 * 背景与边界：`truth-discovery.ts` 是纯融合数学（加权真值 + 分歧度 + 元认知校准），
 * 明确声明"不决定怎么消费"。本模块是它**唯一的生产消费适配层**：把同一概念的
 * 多源主张（代码裁决锚题 / 结构化作答 / LLM 定性推断 / 学习者自评）整理成 `TruthClaim`，
 * 交给 `discoverTruth` 裁决，并给出可落库审计的来源拆解（谁赢了 / 分歧 / 校准偏置 / 缺源标注）。
 *
 * 纪律：
 * - **代码裁决优先**：LLM/自评只作为带权主张进入融合，绝不直接覆盖代码裁决值
 *   （`code_judged` 0.95 一条即压过 `self_report` 0.20，见 `DEFAULT_SOURCE_WEIGHTS`）。
 * - **单源行为不变**：只有一个来源时融合值 = 该来源原值，`observed` 阈值化后与原二值判定一致。
 * - **不静默降级**：读取失败经 `sourceStatus` 显式标注（`read_failed`），无证据标 `missing`，
 *   不把"读不到"混同为"没有证据"。
 * - 本模块纯函数、无 IO：读库与落库由调用方（`LearnerStateReviewService`）负责。
 */
import {
  SOURCE_CLASSES,
  discoverTruth,
  dominantSource,
  metacognitiveCalibration,
  type MetacognitiveCalibration,
  type SourceClass,
  type TruthClaim,
  type TruthContribution,
} from './truth-discovery';

/** 融合真值 ≥ 该阈值视为「已掌握」观测（单源时等价于其原二值 0/1）。 */
export const CONCEPT_TRUTH_MASTERY_THRESHOLD = 0.5;

/** 某来源的读取状态：ok=读到证据；missing=读取成功但无该概念证据；read_failed=读取失败。 */
export type TruthSourceReadStatus = 'ok' | 'missing' | 'read_failed';

/** 单条来源主张（value 语义：该事实成立程度 0–1）。 */
export interface ConceptTruthClaimInput {
  value: number;
  confidence?: number;
  at?: string;
}

export interface ConceptTruthInput {
  conceptKey: string;
  /** LLM 定性推断（如 learner-state-review 的 conceptAssessments）。 */
  llm?: readonly ConceptTruthClaimInput[] | null;
  /** 代码裁决观测（如 `learner_evidence:anchor:result`，judgedBy='code'）。 */
  code?: readonly ConceptTruthClaimInput[] | null;
  /** 结构化/客观作答（可按答案键精确判定）。 */
  structured?: readonly ConceptTruthClaimInput[] | null;
  /** 学习者自评：**不作掌握依据**，仅用于派生元认知校准偏置。 */
  selfReport?: readonly ConceptTruthClaimInput[] | null;
  /**
   * 读取状态覆盖（逐来源）。未提供的来源按"有主张=ok、无主张=missing"推断；
   * 读取失败时由调用方显式传 `read_failed`，避免静默当成"无证据"。
   */
  sourceStatus?: Partial<Record<SourceClass, TruthSourceReadStatus>>;
}

/** 一次概念真值裁决的可审计结果（融合值 + 来源拆解 + 校准 + 缺源标注）。 */
export interface ConceptTruthAdjudication {
  conceptKey: string;
  /** 是否至少有一条有效主张（无有效权重时为 false，调用方应跳过而非伪造观测）。 */
  hasEvidence: boolean;
  /** 供 BKT 消费的二值观测：融合真值 ≥ 0.5。 */
  observed: boolean;
  /** 融合真值 0–1。 */
  value: number;
  totalWeight: number;
  disagreement: number;
  /** 有效权重最大的来源（谁赢了）；无证据为 null。 */
  dominantSource: SourceClass | null;
  contributions: TruthContribution[];
  /** 元认知校准偏置（仅有自评来源时非空；自评与融合真值之差）。 */
  calibration: MetacognitiveCalibration | null;
  /** 逐来源读取状态（结构化标注，不静默丢弃）。 */
  sourceStatus: Record<SourceClass, TruthSourceReadStatus>;
}

function toClaims(source: SourceClass, claims: readonly ConceptTruthClaimInput[] | null | undefined): TruthClaim[] {
  const out: TruthClaim[] = [];
  for (const claim of claims ?? []) {
    if (!claim || !Number.isFinite(claim.value)) continue;
    out.push({ source, value: claim.value, confidence: claim.confidence, at: claim.at });
  }
  return out;
}

/**
 * 融合同一概念的多源主张，产出代码裁决优先的观测与可审计拆解。
 *
 * 确定性：仅依赖输入主张；`at` 只作元数据。空输入安全退化为 `hasEvidence=false`。
 */
export function adjudicateConceptTruth(input: ConceptTruthInput): ConceptTruthAdjudication {
  const grouped: Record<SourceClass, TruthClaim[]> = {
    code_judged: toClaims('code_judged', input.code),
    structured_choice: toClaims('structured_choice', input.structured),
    llm_inference: toClaims('llm_inference', input.llm),
    self_report: toClaims('self_report', input.selfReport),
  };
  const claims: TruthClaim[] = SOURCE_CLASSES.flatMap((source) => grouped[source]);

  const truth = discoverTruth(claims);
  const winner = dominantSource(claims);
  const selfClaims = grouped.self_report;
  const calibration = selfClaims.length > 0
    ? metacognitiveCalibration(discoverTruth(selfClaims).value, truth.value)
    : null;

  const sourceStatus = {} as Record<SourceClass, TruthSourceReadStatus>;
  for (const source of SOURCE_CLASSES) {
    const declared = input.sourceStatus?.[source];
    sourceStatus[source] = declared ?? (grouped[source].length > 0 ? 'ok' : 'missing');
  }

  return {
    conceptKey: input.conceptKey,
    hasEvidence: truth.totalWeight > 0,
    observed: truth.totalWeight > 0 && truth.value >= CONCEPT_TRUTH_MASTERY_THRESHOLD,
    value: truth.value,
    totalWeight: truth.totalWeight,
    disagreement: truth.disagreement,
    dominantSource: winner,
    contributions: truth.contributions,
    calibration,
    sourceStatus,
  };
}

/** `learner_evidence` 行中解析锚题结果所需的最小形状。 */
export interface AnchorEvidenceRow {
  payload?: string | null;
  confidence?: number | null;
}

/**
 * 解析代码裁决锚题证据（`anchor:result`）为按概念分组的主张（纯函数）。
 * - 只认 `payload.passed` 为布尔的行（`passed=null` 的探针不构成掌握证据）；
 * - 单条坏 payload 跳过（不污染整批融合）；
 * - 输出键经 `keyOf` 归一，调用方须用**同一**归一函数查 LLM conceptKey。
 */
export function parseAnchorCodeClaims(
  rows: readonly AnchorEvidenceRow[] | null | undefined,
  keyOf: (key: string) => string = (key) => key,
): Map<string, ConceptTruthClaimInput[]> {
  const byConcept = new Map<string, ConceptTruthClaimInput[]>();
  for (const row of rows ?? []) {
    let payload: unknown;
    try {
      payload = JSON.parse(String(row?.payload ?? ''));
    } catch {
      continue;
    }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    const rawKey = typeof record?.conceptKey === 'string' ? record.conceptKey.trim() : '';
    if (!rawKey) continue;
    if (typeof record?.passed !== 'boolean') continue;
    const key = keyOf(rawKey);
    if (!key) continue;
    const claim: ConceptTruthClaimInput = { value: record.passed ? 1 : 0 };
    if (typeof row?.confidence === 'number' && Number.isFinite(row.confidence)) claim.confidence = row.confidence;
    const bucket = byConcept.get(key) ?? [];
    bucket.push(claim);
    byConcept.set(key, bucket);
  }
  return byConcept;
}
