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
 * - `backgroundKnowledge.recentConceptLedger[].lastSeenAt` → 可选的 lastSeenAt 富化（仅透传）
 * - **`relevantKnowledge.fragile` 不参与**：脆弱是保持风险，不构成"假掌握 / 假挣扎"这种可证伪的预期，
 *   强行当 struggling 会制造语义错误的证伪信号；宁可不测。
 *
 * 掌握分：投影只给标签、不给逐概念分数，因此这里给**确定性常量**。它只影响同信念组内的排序
 * （`selectAnchorCandidates` 的降/升序），不写入任何状态；同一批候选的输出完全确定。
 */
import type {
  AnchorConceptCandidate,
  AnchorExpectation,
  AnchorProbePlan,
  AnchorProbeSignal,
} from '../learner/anchor-probe';

/** 已稳信念的确定性分值（只影响候选组内排序，不落库、不进 BKT/难度） */
export const ANCHOR_MASTERED_SCORE = 0.9;
/** 挣扎信念的确定性分值（同上） */
export const ANCHOR_STRUGGLING_SCORE = 0.2;

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
 * 把投影信号翻译成 `AnchorConceptCandidate[]`（纯函数）。
 * 空/非字符串标签被丢弃；重复标签由 `selectAnchorCandidates` 去重。
 */
export function buildAnchorCandidatesFromLearnerSignals(
  source: AnchorLearnerSignalSource | null | undefined,
): AnchorConceptCandidate[] {
  const lastSeen = source?.lastSeenAtByConcept || {};
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
      lastSeenAt: lastSeen[trimmed] ?? null,
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
  return {
    mastered: projection?.relevantKnowledge?.mastered ?? [],
    struggling: projection?.relevantKnowledge?.struggling ?? [],
    lastSeenAtByConcept,
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
    }),
    confidence: 0.95,
    occurredAt: input.occurredAt,
  };
}
