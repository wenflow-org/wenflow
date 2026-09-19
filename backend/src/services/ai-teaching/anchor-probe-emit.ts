/**
 * 独立锚题探针 · 运行时装配（纯形状 / 决策辅助层，无 I/O、无 DB、无日志）
 *
 * 与 `../learner/anchor-probe.ts`（纯决策层）的分工：
 * - `anchor-probe.ts` 回答「该不该测 / 测哪个 / 结果算什么」（排期闸门、目标选择、归因）；
 * - 本文件回答「把哪些**已经在上下文里**的学习者记忆信号翻译成候选 / 把证据行聚合出门控输入 /
 *   把探针结果装成 `learner_evidence` 行 / 把探针目标装成注入提示词的形状」。
 *
 * **数据来源（"数据已经在那里"）**：`TeachingScenarioContext.learnerProjection`（教学投影，
 * 由 LearnerProjectionService 从 learner snapshot 派生；而 snapshot 的 globalSignals 又由
 * memory_traces + 会话知识看板派生）：
 * - `relevantKnowledge.mastered`   → 跨路径「已稳」概念标签（concept.label）
 * - `relevantKnowledge.struggling` → 跨路径「挣扎」概念标签（status=learning 且 masteryScore<0.55）
 * - `backgroundKnowledge.recentConceptLedger[].lastSeenAt` → 展示用（12 条）lastSeenAt 富化
 * - `masteredLastSeenAt`（调用方从**全量**账本派生）→ 延迟锚题专用 lastSeenAt；**不受 12 条截断**
 * - **`relevantKnowledge.fragile` 不参与**：脆弱是保持风险，不构成"假掌握 / 假挣扎"这种可证伪的预期，
 *   强行当 struggling 会制造语义错误的证伪信号；宁可不测。
 *
 * 掌握分：投影只给标签、不给逐概念分数，因此这里给**确定性常量**。它只影响同信念组内的排序
 * （`selectAnchorCandidates` 的降/升序），不写入任何状态；同一批候选的输出完全确定。
 */
import type {
  AnchorCompletedCandidate,
  AnchorConceptCandidate,
  AnchorExpectation,
  AnchorKind,
  AnchorProbePlan,
  AnchorProbeSignal,
} from '../learner/anchor-probe';

/** 已稳信念的确定性分值（只影响候选组内排序，不落库、不进 BKT/难度） */
export const ANCHOR_MASTERED_SCORE = 0.9;
/** 挣扎信念的确定性分值（同上） */
export const ANCHOR_STRUGGLING_SCORE = 0.2;

/** 延迟锚题（Q8）默认最小自然日间隔；env `TEACHING_DELAYED_ANCHOR_DAYS` 覆盖 */
export const DEFAULT_DELAYED_ANCHOR_DAYS = 7;

/** 延迟锚题间隔解析：env `TEACHING_DELAYED_ANCHOR_DAYS` 优先，非法/缺失回退默认值（下限 1 天） */
export function resolveDelayedAnchorDays(raw?: string | null): number {
  const parsed = Number(String(raw ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DELAYED_ANCHOR_DAYS;
}

/** `anchor:result` 证据回看条数：退避计数只需要最近一段连续记录，50 条足够覆盖最大退避窗口 */
export const ANCHOR_RESULT_LOOKBACK = 50;

/** 探针证据行的最小形状（只读我们关心的字段，避免 any） */
export interface AnchorEvidenceRow {
  occurredAt?: Date | string | null;
  payload?: string | null;
}

export interface AnchorEvidenceSummary {
  /** 最近一次探针时间（ISO；从未投放 → null） */
  lastProbeAt: string | null;
  /** 自最近一次证伪以来已连续投放的探针数（无证据 → 0） */
  probesSinceLastFlag: number;
}

/** 投影里可用的学习者记忆信号（窄接口，便于纯测） */
export interface AnchorLearnerSignalSource {
  mastered?: string[] | null;
  struggling?: string[] | null;
  /** 概念标签 → lastSeenAt（ISO）的可选映射（来自 recentConceptLedger，仅透传） */
  lastSeenAtByConcept?: Record<string, string | null | undefined> | null;
  /**
   * **全量**已掌握概念的 lastSeenAt（键为 conceptKey 或 label），来自权威账本、**不经过
   * `recentConceptLedger.slice(0, 12)` 截断**。延迟锚题据此为"已掌握但排在 12 名开外"的
   * 老概念补上时间戳——否则它们永远进不了延迟复测（Q8 延迟锚题数据供给 bug）。
   */
  masteredLastSeenAt?: Record<string, string | null | undefined> | null;
}

/**
 * 从权威概念账本按 conceptKey/label 两种写法，抽取**全量**已掌握概念的 lastSeenAt（纯函数）。
 *
 * 只保留与 `mastered` 名单匹配的键；账本项无有效 lastSeenAt 时跳过（宁可少测也不造假时间）。
 * 该映射不被任何展示用切片裁剪，专供延迟锚题候选富化。
 */
export function buildMasteredLastSeenAtMap(
  ledger: Array<{ conceptKey?: string | null; label?: string | null; lastSeenAt?: string | null }> | null | undefined,
  mastered: string[] | null | undefined,
): Record<string, string> {
  const wanted = new Set(
    (Array.isArray(mastered) ? mastered : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );
  const map: Record<string, string> = {};
  if (wanted.size === 0) return map;
  for (const item of Array.isArray(ledger) ? ledger : []) {
    const lastSeenAt = typeof item?.lastSeenAt === 'string' ? item.lastSeenAt.trim() : '';
    if (!lastSeenAt) continue;
    const conceptKey = typeof item?.conceptKey === 'string' ? item.conceptKey.trim() : '';
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    // 命中判定：conceptKey 或 label 任一在 mastered 名单内即可（mastered 名单用的是 label）
    const matched = (conceptKey && wanted.has(conceptKey)) || (label && wanted.has(label));
    if (!matched) continue;
    // 命中后 conceptKey 与 label 两种写法都写入，供候选按任一 key 富化
    if (conceptKey && !map[conceptKey]) map[conceptKey] = lastSeenAt;
    if (label && !map[label]) map[label] = lastSeenAt;
  }
  return map;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  return null;
}

/** payload 里是否带 falsified=true（证伪标记）；缺失/脏数据一律按未证伪处理 */
function payloadFalsified(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const parsed = JSON.parse(String(payload));
    return parsed?.falsified === true;
  } catch {
    return false;
  }
}

/**
 * 按概念标签取"最近接触时间"：**全量已掌握映射优先**（不被 12 条账本切片截断），
 * 缺失时回退最近账本切片。空串/非字符串一律当无信息（不造时间）。
 */
function pickLastSeenAt(
  source: AnchorLearnerSignalSource | null | undefined,
  conceptKey: string,
): string | null {
  const full = source?.masteredLastSeenAt?.[conceptKey];
  if (typeof full === 'string' && full) return full;
  const sliced = source?.lastSeenAtByConcept?.[conceptKey];
  return typeof sliced === 'string' && sliced ? sliced : null;
}

/**
 * 把投影信号翻译成 `AnchorConceptCandidate[]`（纯函数）。
 * 空/非字符串标签被丢弃；重复标签由 `selectAnchorCandidates` 去重。
 */
export function buildAnchorCandidatesFromLearnerSignals(
  source: AnchorLearnerSignalSource | null | undefined,
): AnchorConceptCandidate[] {
  const toCandidate = (
    key: string | null | undefined,
    belief: AnchorConceptCandidate['belief'],
    masteryScore: number,
  ): AnchorConceptCandidate | null => {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!trimmed) return null;
    return {
      conceptKey: trimmed,
      belief,
      masteryScore,
      lastSeenAt: pickLastSeenAt(source, trimmed),
    };
  };

  const candidates: AnchorConceptCandidate[] = [];
  for (const key of source?.mastered || []) {
    const candidate = toCandidate(key, 'mastered', ANCHOR_MASTERED_SCORE);
    if (candidate) candidates.push(candidate);
  }
  for (const key of source?.struggling || []) {
    const candidate = toCandidate(key, 'struggling', ANCHOR_STRUGGLING_SCORE);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * 构建「已完成点」候选（Q8 延迟锚题，纯函数）。
 *
 * 数据来源与独立探针同源：`relevantKnowledge.mastered`（已稳/已完成概念标签）+
 * `lastSeenAtByConcept`（概念账本最近接触时间）。只有带**有效 lastSeenAt** 的已掌握点才可作
 * 延迟锚题目标——间隔必须能算出来，宁可少测也不造时间。struggling 与无时间戳者一律排除。
 * `lastSeenAt` 即"完成/最近接触"起点，间隔在 `selectDelayedAnchorCandidates` 内按自然日计算。
 */
export function buildDelayedAnchorCandidatesFromLearnerSignals(
  source: AnchorLearnerSignalSource | null | undefined,
): AnchorCompletedCandidate[] {
  const candidates: AnchorCompletedCandidate[] = [];
  for (const key of source?.mastered || []) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!trimmed) continue;
    // 全量已掌握映射优先 → 老概念即使排在 recentConceptLedger 12 名开外也能拿到时间戳
    const completedAt = pickLastSeenAt(source, trimmed);
    if (!completedAt) continue;
    candidates.push({ conceptKey: trimmed, completedAt, masteryScore: ANCHOR_MASTERED_SCORE });
  }
  return candidates;
}

/**
 * 从教学投影里抽出纯信号源（纯函数）。只取 mastered/struggling 两份标签名单，
 * 并从 conceptLedger 里按 conceptKey 与 label 两种写法富化 lastSeenAt。
 * fragile 明确排除（见文件头注释）。
 */
export function buildAnchorSignalSource(
  projection: {
    relevantKnowledge?: {
      mastered?: string[] | null;
      struggling?: string[] | null;
      /** 明确接收但有意不消费（保持与 TeachingLearnerProjection 结构兼容） */
      fragile?: string[] | null;
    } | null;
    backgroundKnowledge?: {
      recentConceptLedger?: Array<{ conceptKey?: string | null; label?: string | null; lastSeenAt?: string | null }> | null;
    } | null;
  } | null | undefined,
  /**
   * 全量已掌握概念 lastSeenAt（由调用方在构建投影处从权威账本派生，见
   * `buildMasteredLastSeenAtMap`）。**不经过 recentConceptLedger 12 条截断**，
   * 供延迟锚题为 12 名开外的老概念补时间戳。
   */
  masteredLastSeenAt?: Record<string, string | null | undefined> | null,
): AnchorLearnerSignalSource {
  const lastSeenAtByConcept: Record<string, string> = {};
  for (const item of projection?.backgroundKnowledge?.recentConceptLedger || []) {
    if (!item?.lastSeenAt) continue;
    const keys = [item.conceptKey, item.label];
    for (const key of keys) {
      const trimmed = typeof key === 'string' ? key.trim() : '';
      if (trimmed) lastSeenAtByConcept[trimmed] = item.lastSeenAt;
    }
  }
  const fullMasteredLastSeenAt: Record<string, string> = {};
  for (const [key, value] of Object.entries(masteredLastSeenAt || {})) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed && typeof value === 'string' && value) fullMasteredLastSeenAt[trimmed] = value;
  }
  return {
    mastered: projection?.relevantKnowledge?.mastered ?? [],
    struggling: projection?.relevantKnowledge?.struggling ?? [],
    lastSeenAtByConcept,
    masteredLastSeenAt: fullMasteredLastSeenAt,
  };
}

/**
 * 聚合 `anchor:result` 证据行 → 排期闸门输入（纯函数，确定性）。
 *
 * - `lastProbeAt`：最近一条证据的 occurredAt；
 * - `probesSinceLastFlag`：从最近一条往前数，直到遇到 `payload.falsified === true` 为止
 *   （即"自上次证伪以来连续投放了几个探针"；全无证伪则等于证据条数）。
 *
 * 输入顺序无关：内部按 occurredAt 降序排序；occurredAt 不可解析的行直接丢弃（不参与计数）。
 */
export function summarizeAnchorEvidence(rows: AnchorEvidenceRow[] | null | undefined): AnchorEvidenceSummary {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ at: toIsoString(row?.occurredAt), falsified: payloadFalsified(row?.payload) }))
    .filter((row): row is { at: string; falsified: boolean } => row.at !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  if (normalized.length === 0) return { lastProbeAt: null, probesSinceLastFlag: 0 };

  let probesSinceLastFlag = 0;
  for (const row of normalized) {
    if (row.falsified) break;
    probesSinceLastFlag += 1;
  }
  return { lastProbeAt: normalized[0].at, probesSinceLastFlag };
}

/**
 * 距上次探针的教学轮数：用「当前消息数 − 上次检查点轮次」近似
 * （锚题本身以检查点形式投放，`lastCheckpointTurn` 是最近一次测量落点）。
 * 缺任一有效值 → undefined（闸门按"无信息不拦"处理）。
 */
export function deriveTurnsSinceLastProbe(
  messageCount: number | null | undefined,
  lastCheckpointTurn: number | null | undefined,
): number | undefined {
  const count = Number(messageCount);
  const last = Number(lastCheckpointTurn);
  if (!Number.isFinite(count) || !Number.isFinite(last) || last < 0) return undefined;
  return Math.max(0, count - last);
}

/** 注入提示词的锚题目标形状（刻意只给 conceptKey/expected，不带内部 reason，避免模型泄露"复测"语义） */
export interface AnchorPromptTarget {
  conceptKey: string;
  expected: AnchorExpectation;
}

export function buildAnchorPromptTarget(plan: AnchorProbePlan): AnchorPromptTarget {
  return { conceptKey: plan.conceptKey, expected: plan.expected };
}

export interface AnchorResultEvidenceInput {
  checkpointId: string;
  conceptKey?: string | null;
  expected: AnchorExpectation;
  passed: boolean | null;
  signal: AnchorProbeSignal;
  falsified: boolean;
  /** 探针种类（Q8）：缺省不写入 payload，保持历史独立探针证据逐字节兼容 */
  anchorKind?: AnchorKind | null;
  /** 延迟锚题的自然日间隔（`anchorKind='delayed'` 时写入，用于"间隔 vs 保持率"） */
  intervalDays?: number | null;
  userId: string;
  pathId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  occurredAt: Date;
}

export interface AnchorResultEvidenceShape {
  id: string;
  eventId: string;
  evidenceKey: string;
  userId: string;
  pathId: string | null;
  taskId: string | null;
  sessionId: string | null;
  evidenceType: 'anchor:result';
  payload: string;
  confidence: number;
  occurredAt: Date;
}

/**
 * 幂等键：同一 checkpointId 复用同一 (eventId, evidenceKey)。
 * 与 `learner_evidence @@unique([eventId, evidenceKey])` 配合，重复提交不产生重复行。
 */
export function anchorResultEvidenceKey(checkpointId: string): { eventId: string; evidenceKey: string } {
  return { eventId: `anchor:${checkpointId}`, evidenceKey: `anchor:result:${checkpointId}` };
}

/**
 * 装一条 `anchor:result` 证据（纯函数）。**只承载"待复核"信号**：conceptKey/expected/passed/
 * signal/falsified 留档供人工复核，不包含也不触发任何掌握度/难度/BKT 改写。
 * confidence 固定 0.95（仅在 `judgedBy='code'` 路径写入，与检查点代码裁决同源）。
 *
 * Q8 扩展：可带 `anchorKind`（independent/delayed）与延迟锚题的 `intervalDays`，
 * 供"间隔 vs 保持率"分析；缺省时不写这两个键，历史独立探针证据形状不变。
 */
export function buildAnchorResultEvidence(input: AnchorResultEvidenceInput): AnchorResultEvidenceShape {
  const { eventId, evidenceKey } = anchorResultEvidenceKey(input.checkpointId);
  return {
    id: `lev_anchor_${input.checkpointId}`,
    eventId,
    evidenceKey,
    userId: input.userId,
    pathId: input.pathId ?? null,
    taskId: input.taskId ?? null,
    sessionId: input.sessionId ?? null,
    evidenceType: 'anchor:result',
    payload: JSON.stringify({
      checkpointId: input.checkpointId,
      conceptKey: input.conceptKey ?? null,
      expected: input.expected,
      passed: input.passed ?? null,
      falsified: input.falsified,
      signal: input.signal,
      ...(input.anchorKind ? { anchorKind: input.anchorKind } : {}),
      ...(input.anchorKind === 'delayed' && Number.isFinite(input.intervalDays)
        ? { intervalDays: input.intervalDays }
        : {}),
    }),
    confidence: 0.95,
    occurredAt: input.occurredAt,
  };
}
