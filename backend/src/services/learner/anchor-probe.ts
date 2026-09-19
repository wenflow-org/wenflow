/**
 * 独立锚题探针（Q13 / B4 · 纯决策层，无 I/O、无 LLM、无 DB）
 *
 * **要解决的问题（审计 §4.2(2) / §5.3）**：难度控制器与掌握判定当前依赖**同一节课**产出的检查点
 * ——教它的课也测它，于是"系统相信什么"与"用什么去验证这个相信"来自同一个来源，形成自证回路。
 * 掌握可能是**假阳性**（蒙对/提示过强/检查点与讲解同构），挣扎可能是**假阴性**（题面生疏/一次失误/
 * 判定口径对措辞敏感）。锚题探针就是**独立于日常传感器**的复测：换一个来源、同一套 code 判据，
 * 专门去**证伪**系统已有的信念。
 *
 * **本文件只做确定性的决策层**（选择目标 / 排期闸门 / 结果归因），
 * 不写库、不出题、不进教学轮。真正的运行时接线（拿 `AnchorProbePlan` 去出题、把结果写
 * `learner_evidence: checkpoint:result`）是后续独立改动，见文件末尾的接线步骤说明。
 *
 * **三条纪律（必须守住）**：
 * 1. **代码裁决**：探针结果只认 `judgedBy='code'`（选择题等可按集合精确判定的题型），
 *    模型自评/关键词判定不进证伪逻辑，否则又回到自证回路。
 * 2. **只标记、不改写**：`evaluateAnchorProbeOutcome` 只产出 `falsified` + `signal`（标记候选），
 *    **绝不静默重写** `masteryScore`/`belief`/难度档位。改写信念必须经过人工复核或显式的
 *    重新学习流程。证伪是"请复核"的一个信号，不是自动降级的直接原因。
 * 3. **不与检查点抢采样**：存在未完成检查点时**一律不投放**（同一时刻只允许一个测量来源，
 *    避免双重施测/混淆归因）。
 *
 * 所有函数都是纯函数：同样的输入必得同样的输出，无随机、无当前时间隐式读取（`now` 由调用方注入）。
 */

/** 一次最多投放几个锚题（默认 3；硬上限 3，避免一次课堂塞太多复测） */
export const ANCHOR_PROBE_DEFAULT_LIMIT = 3;
export const ANCHOR_PROBE_MAX_LIMIT = 3;
export const ANCHOR_PROBE_MIN_LIMIT = 1;

/** 两次探针之间的最小间隔（ms，默认 72 小时）——给记忆/学习留出发生变化的窗口 */
export const ANCHOR_PROBE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
/** 两次探针之间的最小教学轮数（默认 6）——比墙钟更贴近"实际接触量" */
export const ANCHOR_PROBE_MIN_TURNS_BETWEEN = 6;
/**
 * 自上次证伪以来最多连续投放多少个探针（默认 3）。
 * 连续多次都无法证伪 = 该信念较稳健，继续投放是浪费探针预算 → 退避。
 * 一旦产生证伪标记（`falsified`）计数清零，恢复投放。
 */
export const ANCHOR_PROBE_MAX_PROBES_SINCE_FLAG = 3;

/**
 * 延迟锚题（Q8 测量深化）的默认最小自然日间隔（UTC 日界）：已掌握/完成点距上次接触达到该天数
 * 即做一次保持率复测，产出"间隔 vs 保持率"样本。env `TEACHING_DELAYED_ANCHOR_DAYS` 可覆盖。
 */
export const ANCHOR_PROBE_DEFAULT_DELAYED_DAYS = 7;
/** 延迟锚题间隔下限（天）：至少间隔 1 个自然日才构成"延迟" */
export const ANCHOR_PROBE_MIN_DELAYED_DAYS = 1;

/** 学习者对某概念的当前信念（`learning` 无法形成可证伪的预期，不作探针目标） */
export type AnchorBelief = 'mastered' | 'struggling' | 'learning';

/** 探针期望的两种可证伪预期 */
export type AnchorExpectation = 'mastered' | 'struggling';

/**
 * 探针种类：
 * - `independent`：独立证伪探针（Q13/B4）——对"已掌握/挣扎"信念换来源复测；
 * - `delayed`：延迟锚题（Q8 测量深化）——对**已完成的已掌握点**在 N 个自然日后复测保持率。
 */
export type AnchorKind = 'independent' | 'delayed';

/** 证伪信号：假掌握 / 假挣扎 / 一致 / 无法判定 */
export type AnchorProbeSignal = 'false_mastery' | 'false_struggle' | 'consistent' | 'inconclusive';

/** 一个候选概念（来自快照/信念投影，由调用方注入；本模块不读） */
export interface AnchorConceptCandidate {
  conceptKey: string;
  belief: AnchorBelief;
  /** 0-1 的掌握分；越高越"确信已掌握" */
  masteryScore: number;
  /** 记忆保持度（0-1，可选）；当前仅随类型透传，保留给后续排序增强 */
  retention?: number | null;
  /** 最近一次见到该概念的时间（ISO，可选）；当前仅透传 */
  lastSeenAt?: string | null;
}

/** 选中的一个探针目标：要测什么、期望是什么、为什么 */
export interface AnchorProbePlan {
  conceptKey: string;
  expected: AnchorExpectation;
  reason: string;
  /** 探针种类；缺省视为 `independent`（保持历史产出形状兼容） */
  kind?: AnchorKind;
  /** 延迟锚题（`kind='delayed'`）距上次接触的自然日间隔（UTC 日界），用于"间隔 vs 保持率" */
  intervalDays?: number;
}

/**
 * 一个"已完成/已掌握"候选（Q8 延迟锚题；来自学习者记忆账本，由调用方注入；本模块不读）。
 * `completedAt` 取该概念**最近一次接触/完成**时间，作为"间隔"的计时起点。
 */
export interface AnchorCompletedCandidate {
  conceptKey: string;
  /** 完成/最近一次见到该概念的时间（ISO / epoch ms / Date） */
  completedAt: string | number | Date;
  /** 0-1 掌握分（可选，仅透传留档） */
  masteryScore?: number | null;
  /** 记忆保持度（0-1，可选，仅透传留档） */
  retention?: number | null;
}

export interface SelectDelayedAnchorCandidatesOptions {
  /** 当前时间（调用方注入，本模块不读系统时钟） */
  now: string | number | Date;
  /** 最小自然日间隔；默认 {@link ANCHOR_PROBE_DEFAULT_DELAYED_DAYS}，下限 1 */
  minIntervalDays?: number | null;
  /** 最近一次锚题结果时间；距今不足 `minIntervalDays` 个自然日 → 冷却，不重复投放 */
  lastProbeAt?: string | number | Date | null;
  /** 最多返回几个目标；默认 1，钳制到 [1, 3] */
  limit?: number | null;
}

/** 探针结果归因（纯映射；`falsified=true` 只代表"标记待复核"） */
export interface AnchorProbeOutcome {
  falsified: boolean;
  signal: AnchorProbeSignal;
}

export interface SelectAnchorCandidatesOptions {
  /** 最多返回几个目标；默认 3，硬上限 3，下限 1 */
  limit?: number | null;
}

/**
 * 排期闸门输入。`now` 由调用方注入（本模块不读系统时钟）。
 * 除 `now` 外全部可选：缺省 = 无该信息，不因信息缺失而误判"到点"。
 */
export interface AnchorProbeScheduleState {
  now: string | number | Date;
  /** 上次投放探针的时间；null/缺省 = 从未投放 */
  lastProbeAt?: string | number | Date | null;
  /** 覆盖默认最小间隔（ms） */
  intervalMs?: number | null;
  /** 自上次证伪以来已连续投放的探针数；达到上限则退避 */
  probesSinceLastFlag?: number | null;
  /** 是否存在未完成检查点；true → 一律不投放 */
  hasPendingCheckpoint?: boolean | null;
  /** 距上次探针的教学轮数；低于下限则不到点 */
  turnsSinceLastProbe?: number | null;
  /** 覆盖默认最小轮数 */
  minTurnsBetweenProbes?: number | null;
}

export interface AnchorProbeScheduleOptions {
  intervalMs?: number | null;
  minTurnsBetweenProbes?: number | null;
  maxProbesSinceLastFlag?: number | null;
}

export interface AnchorProbeScheduleDecision {
  shouldRun: boolean;
  reason: string;
}

export interface AnchorProbeEvaluationInput {
  expected: AnchorExpectation;
  /** null/undefined = 无法判定（缺答案、判分失败、题未作答等） */
  passed: boolean | null | undefined;
}

/**
 * 信念优先级：假掌握（mastered）比假挣扎（struggling）更危险，先证伪它。
 * `learning` 排在最后且会被过滤（无法形成预期），保留枚举只为排序稳定、便于扩展。
 */
const BELIEF_PRIORITY: Record<AnchorBelief, number> = { mastered: 0, struggling: 1, learning: 2 };

function toEpochMs(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function normalizeScore(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * UTC 自然日差（纯函数，日界对齐）：`to` 的 UTC 日历日 − `from` 的 UTC 日历日，恒为非负整数。
 * 与 `learning-state.service` 的自然衰减 / `simulated-day.service` 的日窗口同口径（UTC 日界）。
 * 任一输入非法 → null（调用方据此判定"无信息"，不误判为到点）。
 */
export function utcNaturalDayDiff(
  from: string | number | Date | null | undefined,
  to: string | number | Date | null | undefined,
): number | null {
  const fromMs = toEpochMs(from);
  const toMs = toEpochMs(to);
  if (fromMs === null || toMs === null) return null;
  const a = new Date(fromMs);
  const b = new Date(toMs);
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/**
 * 稳定比较器：先按信念优先级（mastered → struggling），
 * 组内按"可疑程度"排（mastered 高分优先 / struggling 低分优先），
 * 最后用 conceptKey 字典序兜底。**不含时间/随机**，故完全确定。
 */
function compareCandidates(a: AnchorConceptCandidate, b: AnchorConceptCandidate): number {
  const priority = BELIEF_PRIORITY[a.belief] - BELIEF_PRIORITY[b.belief];
  if (priority !== 0) return priority;

  const scoreA = normalizeScore(a.masteryScore);
  const scoreB = normalizeScore(b.masteryScore);
  if (scoreA !== scoreB) {
    // mastered：分越高越可能是假阳性 → 降序；struggling：分越低越可能是假阴性 → 升序
    return a.belief === 'mastered' ? scoreB - scoreA : scoreA - scoreB;
  }

  if (a.conceptKey < b.conceptKey) return -1;
  if (a.conceptKey > b.conceptKey) return 1;
  return 0;
}

/**
 * 选择要投放的锚题目标（纯函数）。
 *
 * - 只选 `mastered` / `struggling`：`learning` 形不成可证伪的预期；
 * - 排序：`(belief 优先级, masteryScore 方向, conceptKey)`，见 `compareCandidates`；
 * - 去重：同一 `conceptKey` 只保留排序后最可疑的那条（避免重复复测同一概念）；
 * - `limit`：默认 3，钳制到 [1, 3]（`0`/负数会被抬到 1，超过 3 会被压到 3）；
 * - `retention`/`lastSeenAt` 随类型透传，当前不参与排序（保持排序口径简单、可解释）。
 */
export function selectAnchorCandidates(
  candidates: AnchorConceptCandidate[],
  options: SelectAnchorCandidatesOptions = {},
): AnchorProbePlan[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const rawLimit = options.limit ?? ANCHOR_PROBE_DEFAULT_LIMIT;
  const safeLimit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : ANCHOR_PROBE_DEFAULT_LIMIT;
  const limit = Math.max(ANCHOR_PROBE_MIN_LIMIT, Math.min(ANCHOR_PROBE_MAX_LIMIT, safeLimit));

  const eligible = candidates
    .filter((candidate): candidate is AnchorConceptCandidate => {
      if (!candidate || typeof candidate.conceptKey !== 'string') return false;
      if (!candidate.conceptKey.trim()) return false;
      return candidate.belief === 'mastered' || candidate.belief === 'struggling';
    })
    .slice()
    .sort(compareCandidates);

  const plans: AnchorProbePlan[] = [];
  const seen = new Set<string>();
  for (const candidate of eligible) {
    if (seen.has(candidate.conceptKey)) continue; // 去重：保留排序后最可疑的一条
    seen.add(candidate.conceptKey);

    const expected: AnchorExpectation = candidate.belief === 'mastered' ? 'mastered' : 'struggling';
    const score = normalizeScore(candidate.masteryScore);
    const reason =
      expected === 'mastered'
        ? `掌握信念（masteryScore=${score}）疑似假阳性 → 独立复测证伪`
        : `挣扎信念（masteryScore=${score}）疑似假阴性 → 独立复测证伪`;
    plans.push({ conceptKey: candidate.conceptKey, expected, reason });
    if (plans.length >= limit) break;
  }

  return plans;
}

/**
 * 选择要投放的**延迟锚题**目标（纯函数，Q8 测量深化）。
 *
 * 与 `selectAnchorCandidates`（独立证伪）的区别：延迟锚题面向**已经完成的已掌握点**，
 * 唯一闸门是"距上次接触 ≥ N 个**自然日**（UTC 日界）"——目标是采样"间隔 vs 保持率"，
 * 而非证伪某个信念。因此：
 * - 期望恒为 `mastered`（完成点若答错 = 保持失败，仍走 `false_mastery` 归因）；
 * - 排序：`(intervalDays 降序, conceptKey 升序)`，与输入顺序无关（确定性）；最久未接触者优先，
 *   信息量（遗忘幅度）最大；
 * - `lastProbeAt` 全局冷却：最近一次锚题距今不足 `minIntervalDays` → 返回空，避免同一窗口内
 *   每回合重复投放同一批陈旧点；
 * - `now` 非法 / 候选为空 / 全部未到间隔 → 空数组（调用方跳过本类探针，链路照常）。
 */
export function selectDelayedAnchorCandidates(
  candidates: AnchorCompletedCandidate[],
  options: SelectDelayedAnchorCandidatesOptions,
): AnchorProbePlan[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const now = toEpochMs(options?.now);
  if (now === null) return [];

  const rawDays = options?.minIntervalDays;
  const safeDays = Number.isFinite(rawDays as number) ? Math.floor(rawDays as number) : ANCHOR_PROBE_DEFAULT_DELAYED_DAYS;
  const minDays = Math.max(ANCHOR_PROBE_MIN_DELAYED_DAYS, safeDays);

  // 全局冷却：最近一次锚题（任意种类）距今不足最小间隔自然日 → 本窗口不再投放
  if (options?.lastProbeAt !== null && options?.lastProbeAt !== undefined) {
    const sinceLast = utcNaturalDayDiff(options.lastProbeAt, now);
    if (sinceLast !== null && sinceLast < minDays) return [];
  }

  const rawLimit = options?.limit ?? 1;
  const safeLimit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 1;
  const limit = Math.max(ANCHOR_PROBE_MIN_LIMIT, Math.min(ANCHOR_PROBE_MAX_LIMIT, safeLimit));

  const eligible = candidates
    .map((candidate) => {
      if (!candidate || typeof candidate.conceptKey !== 'string') return null;
      const conceptKey = candidate.conceptKey.trim();
      if (!conceptKey) return null;
      const intervalDays = utcNaturalDayDiff(candidate.completedAt, now);
      if (intervalDays === null || intervalDays < minDays) return null;
      return { conceptKey, intervalDays };
    })
    .filter((item): item is { conceptKey: string; intervalDays: number } => item !== null)
    .sort((a, b) => {
      if (a.intervalDays !== b.intervalDays) return b.intervalDays - a.intervalDays;
      if (a.conceptKey < b.conceptKey) return -1;
      if (a.conceptKey > b.conceptKey) return 1;
      return 0;
    });

  const plans: AnchorProbePlan[] = [];
  for (const item of eligible) {
    plans.push({
      conceptKey: item.conceptKey,
      expected: 'mastered',
      kind: 'delayed',
      intervalDays: item.intervalDays,
      reason: `已完成点距上次接触 ${item.intervalDays} 个自然日（≥${minDays}）→ 延迟锚题复测保持率`,
    });
    if (plans.length >= limit) break;
  }
  return plans;
}

/**
 * 排期闸门（纯函数）：是否应该投放独立锚题。
 *
 * 判定顺序（先到先返回，reason 留痕便于审计）：
 * 1. `now` 非法 → 不投放；
 * 2. 有未完成检查点 → 不投放（不与检查点抢同一时刻的测量）；
 * 3. 自上次证伪连续投放达到上限 → 退避（信念稳健，省探针预算）；
 * 4. 距上次探针不足 `intervalMs` → 未到周期；
 * 5. 距上次探针不足 `minTurnsBetweenProbes` 轮 → 未到周期；
 * 否则可投放。
 *
 * 缺省语义：`lastProbeAt` 缺失 = 从未投放 → 通过周期检查；`turnsSinceLastProbe` 缺失 = 无信息 → 不拦。
 * 覆盖优先级：`options` > `state` 内联值 > 默认常量。
 */
export function shouldRunAnchorProbe(
  state: AnchorProbeScheduleState,
  options: AnchorProbeScheduleOptions = {},
): AnchorProbeScheduleDecision {
  const now = toEpochMs(state?.now);
  if (now === null) {
    return { shouldRun: false, reason: 'now 缺失或非法 → 不投放' };
  }

  if (state?.hasPendingCheckpoint === true) {
    return { shouldRun: false, reason: '存在未完成检查点 → 不投放（避免与检查点双重施测）' };
  }

  const maxSinceFlag =
    options.maxProbesSinceLastFlag ?? ANCHOR_PROBE_MAX_PROBES_SINCE_FLAG;
  const sinceFlagRaw = state?.probesSinceLastFlag ?? 0;
  const sinceFlag = Number.isFinite(sinceFlagRaw) ? sinceFlagRaw : 0;
  if (maxSinceFlag > 0 && sinceFlag >= maxSinceFlag) {
    return {
      shouldRun: false,
      reason: `自上次证伪已连续投放 ${sinceFlag} 个探针（≥${maxSinceFlag}）→ 退避（信念稳健）`,
    };
  }

  const intervalMs = options.intervalMs ?? state?.intervalMs ?? ANCHOR_PROBE_INTERVAL_MS;
  const lastProbe = toEpochMs(state?.lastProbeAt);
  if (lastProbe !== null && Number.isFinite(intervalMs) && intervalMs > 0 && now - lastProbe < intervalMs) {
    return { shouldRun: false, reason: `距上次探针不足最小间隔（${intervalMs}ms）→ 未到周期` };
  }

  const minTurns = options.minTurnsBetweenProbes ?? state?.minTurnsBetweenProbes ?? ANCHOR_PROBE_MIN_TURNS_BETWEEN;
  const turnsRaw = state?.turnsSinceLastProbe;
  if (
    turnsRaw !== null &&
    turnsRaw !== undefined &&
    Number.isFinite(turnsRaw) &&
    minTurns > 0 &&
    turnsRaw < minTurns
  ) {
    return { shouldRun: false, reason: `距上次探针仅 ${turnsRaw} 轮（<${minTurns}）→ 未到周期` };
  }

  return { shouldRun: true, reason: '满足间隔与轮次门槛 → 可投放独立锚题' };
}

/**
 * 探针结果归因（纯映射）：
 * - `passed` 缺失/为 null → `inconclusive`（无法判定，不计证伪，也不计一致）；
 * - `expected='mastered' && passed=false` → `false_mastery`（假掌握，证伪）；
 * - `expected='struggling' && passed=true` → `false_struggle`（假挣扎，证伪）；
 * - 其余（期望与结果相符）→ `consistent`。
 *
 * **纪律**：返回的 `falsified=true` 只是**标记待复核**，调用方不得据此静默改写信念或难度。
 */
export function evaluateAnchorProbeOutcome(input: AnchorProbeEvaluationInput): AnchorProbeOutcome {
  const passed = input?.passed;
  if (passed === null || passed === undefined) {
    return { falsified: false, signal: 'inconclusive' };
  }

  const expected = input?.expected;
  if (expected === 'mastered') {
    return passed === false
      ? { falsified: true, signal: 'false_mastery' }
      : { falsified: false, signal: 'consistent' };
  }
  if (expected === 'struggling') {
    return passed === true
      ? { falsified: true, signal: 'false_struggle' }
      : { falsified: false, signal: 'consistent' };
  }

  return { falsified: false, signal: 'inconclusive' };
}
