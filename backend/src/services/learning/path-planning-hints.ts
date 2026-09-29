/**
 * path 阶段确定性输入定帧层（原 skill:path-scene-framing 的纯函数部分）
 *
 * skill:path-scene-framing 已于 2026-08 移除：其 LLM 环节信息零增量
 * （prompt 禁止扩写、输出被 seed 覆盖），全部确定性逻辑平移到此处，
 * 由 coordinator / learning.service 直接调用。
 */

import { paceSignalRangeConfig, timeHorizonPaceMapping, tightBudgetConfig } from '../../config/pedagogy.config';
import { normalizePathDifficulty } from './path-difficulty';

export type PlanningPaceSignal = 'compact' | 'standard' | 'extended';
export type TimeBudgetCadence = 'per_day' | 'per_week' | 'per_session' | 'flexible' | 'unclear';

function normalizeString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => !!item);
}

function normalizeCadence(value: any): TimeBudgetCadence | null {
  return value === 'per_day'
    || value === 'per_week'
    || value === 'per_session'
    || value === 'flexible'
    || value === 'unclear'
    ? value
    : null;
}

/**
 * 学习者负荷画像（可选）：可用时间与认知负荷耐受。仅在显式传入时影响推导。
 */
export interface LearnerLoadProfile {
  /** 可用时间枚举或自由文本，如 'minimal' | 'moderate' | 'abundant' */
  availableTime?: string | null;
  /** 认知负荷耐受描述（自由文本），如 '信息一多就容易乱' */
  loadTolerance?: string | null;
}

/** 可用时间是否紧：枚举 minimal，或自由文本里的碎片化/极少信号。 */
function isMinimalAvailabilitySignal(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text === 'minimal' || text === 'very_low' || text === 'verylow') return true;
  return /(minimal|very\s*low|几乎没有|极少|很少|碎片|零碎|不固定|不稳定|抽不出|时间紧|紧张|有限)/.test(text);
}

/**
 * 认知负荷耐受是否低（决定资源收紧）。
 * **等级枚举优先**（2026-09-21 起生成器产出 low|normal|high）；老数据（散文）退化到关键词表兜底
 * ——该表实测漏判 47%，只作兼容，不再承载新数据。
 */
function isLowLoadToleranceSignal(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const level = /^(low|低|极低)/i.test(text) ? 'low'
    : /^(high|高)/i.test(text) ? 'high'
    : /^(normal|中)/i.test(text) ? 'normal'
    : null;
  if (level) return level === 'low';
  return /(关(掉|闭)?\s*页面|合(上)?\s*电脑|三步以上|超过三步|信息一多|一多就|太长|看不下去|坐不住|坚持不了|容易放弃|轻言放弃|分心|浮躁|耐受(很|较|非常)?低|承载(很|较|非常)?低)/.test(text);
}

/**
 * 中文数字/时间短语 → 周数的确定性兜底解析。
 * 仅用于 timeDimensions.totalWeeks 缺失时钳制 maxWeeks（紧迫场景兜底），
 * 不改变 pace 档位。解析不出返回 null（保持 pace 默认值）。
 */
export function inferMaxWeeksFromTimeHorizon(timeHorizon: string | null): number | null {
  if (!timeHorizon) return null;
  const text = timeHorizon.trim();
  if (!text) return null;
  // 字面 "null"/"undefined"（模型偶尔把空值写成字符串）视为缺失
  if (/^(null|undefined)$/i.test(text)) return null;

  const cnNum: Record<string, number> = { '半': 0.5, '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  const parseNum = (s: string): number | null => {
    const t = s.trim();
    if (/^\d+$/.test(t)) return Number(t);
    if (cnNum[t]) return cnNum[t];
    return null;
  };

  const match = (re: RegExp): RegExpMatchArray | null => re.exec(text);

  // 单位解析：N个月 / 半年 / 一年
  const month = match(/(\d+|半|一|两|二|三|四|五|六|七八|九十|[一二三四五六七八九十]+)\s*(?:个)?月/);
  if (month) {
    const n = parseNum(month[1]);
    if (n !== null && n > 0) return n * 4.3;
  }
  const year = match(/(\d+|一|两|二|三)\s*年/);
  if (year) {
    const n = parseNum(year[1]);
    if (n !== null && n > 0) return n * 52;
  }
  // 半年（"半"不是年份，是半年）
  if (/半年/.test(text)) return 26;
  // N天 / 两三天（只接受单字中文数字，双字组合解析不了）
  const day = match(/(\d+|两|三|四|五|六|七|一|二)\s*天/);
  if (day) {
    const n = parseNum(day[1]);
    if (n !== null && n > 0) return n / 7;
  }
  // N周（排除星期名：周五/周日 等是 weekday 不是 5周）
  const week = match(/(\d+|一|两|二|三|四|五六|三四)\s*(?:个)?周(?![一二三四五六日天])/);
  if (week) {
    const n = parseNum(week[1]);
    if (n !== null && n > 0) return n;
  }
  // N个星期 / N个礼拜
  const fortnight = match(/(\d+|一|两|二|三|四|五六)\s*个?(?:星期|礼拜)/);
  if (fortnight) {
    const n = parseNum(fortnight[1]);
    if (n !== null && n > 0) return n;
  }

  // 截止信号：紧迫 → 短周期
  if (/(下周|下星期|下礼拜|明天|今晚|今晚就要|明晚|后天|这两三天|两三天|这两天|周末前|下周五|月底前|周末)/.test(text)) return 1;
  if (/(月底|月末)/.test(text)) return 3;

  return null;
}

function parseBudgetMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (/(小时|h|hour)/i.test(value)) return Math.round(amount * 60);
  return Math.round(amount);
}

function inferPaceSignal(timeHorizon: string | null): PlanningPaceSignal {
  // 未明确时间不再默认最长档（extended 会让"无 deadline/未明确"的小问题被撑成 24 周大路径）
  if (!timeHorizon) return 'standard';
  const exact = timeHorizonPaceMapping[timeHorizon] as PlanningPaceSignal | undefined;
  if (exact) return exact;
  // 用已有的中文时间短语解析能力兜底分档（覆盖"两周/一个月/三个月/半年"等映射表未收录的表述）
  const weeks = inferMaxWeeksFromTimeHorizon(timeHorizon);
  if (weeks !== null) {
    if (weeks <= 1) return 'compact';
    if (weeks <= 8) return 'standard';
    return 'extended';
  }
  // 最终兜底：解析不出时间信号时取中等档，而非最长档
  return 'standard';
}

/** 问题规模（goal 层 scope_size）→ 路径体量（里程碑数 + 每阶段子任务数） */
export type ScopeSize = 'micro' | 'small' | 'medium' | 'large';

export const SCOPE_SIZE_RANGES: Record<ScopeSize, { milestoneRange: [number, number]; subtasksPerStageRange: [number, number] }> = {
  micro:  { milestoneRange: [1, 2], subtasksPerStageRange: [1, 3] },
  small:  { milestoneRange: [2, 3], subtasksPerStageRange: [2, 3] },
  medium: { milestoneRange: [3, 5], subtasksPerStageRange: [3, 5] },
  large:  { milestoneRange: [4, 8], subtasksPerStageRange: [4, 6] },
};

function normalizeScopeSize(value: unknown): ScopeSize | null {
  return value === 'micro' || value === 'small' || value === 'medium' || value === 'large' ? value : null;
}

export interface PlanningHints {
  paceSignal: PlanningPaceSignal;
  milestoneRange: [number, number];
  conceptRange: [number, number];
  subtasksPerStageRange: [number, number];
  subtaskMinutesRange: [number, number];
  maxWeeks: number;
  /** 问题规模（goal 层 scope_size 透传，未提供为 null） */
  scopeSize: ScopeSize | null;
  /** 强制里程碑目标数量（由 scope_size 与 keyStages 共同决定，path LLM 必须精确输出该值，不增减） */
  targetMilestones: number | null;
  /** 强制每阶段子任务目标数量（由总学时/里程碑数推导，stage-designer 必须精确输出该值） */
  targetSubtasksPerStage: number | null;
  /**
   * 本阶段任务锚（2026-09-28 去等分）：stage-enrichment 逐阶段按该 milestone 实际学时反推，
   * 存在时优先于 targetSubtasksPerStage（全局锚是按总学时均摊的，会合法化 5×10 式等分）。
   * 仅 stage-designer 逐阶段调用时被注入，path-planning 主生成时为 null。
   */
  targetSubtasksForStage: number | null;
  /** 锚定总学时（课次×单次时长/goal 直接推断；存在时 path-planning 须把各阶段学时之和分配到 ±50% 内） */
  targetTotalHours: number | null;
  /** 每阶段学时锚（= targetTotalHours / targetMilestones；存在时各 milestone estimatedHours 应向它收敛，防大预算被模型惯性压回 ~10h/阶段） */
  targetHoursPerMilestone: number | null;
  /** 单任务分钟锚（= 总分钟 / 总任务数；存在时 subtask estimatedMinutes 均值应向它靠拢，防扩容后模型仍按 ~60min/任务填充） */
  targetMinutesPerTask: number | null;
  /**
   * 结构容量缺口（2026-09-29 I2b 观测）：用户声明的总学时预算与结构容量上界（阶段×任务×单课分钟）
   * 之间的差。null = 预算装得下（无需声明）；同结构体的字段会随 hints 一起落库到
   * `aiPromptTemplate.normalizedInput...planningHints`，使「预算被结构容量吃掉多少」从不可观测变为可复核。
   *
   * 背景：容量上界受「每阶段课数上限 30」与「单课分钟按用户单次坐姿校准」两道**有意设计**约束，
   * 长周期/大预算诉求会装不下。此前只做内部夹钳（targetHoursPerMilestone 被钳到容量上界），
   * 用户侧只见 `learning_paths.estimatedHours`（如 26h）而不知自述可用时间是 650h。
   */
  capacityDeficit: CapacityDeficitReport | null;
  /**
   * 预算派生链留痕（2026-09-29 I6-3）：总学时锚从哪来、每阶段锚被容量夹了多少。
   *
   * 为什么需要：实审发现 `targetHoursPerMilestone` 与 `targetTotalHours/targetMilestones`
   * 可差 68%（实测 22.4 vs 69.3），但两个字段都不带来源，评审只能记「hints 内部不自洽」而
   * 判不了是谁造成的。有了本字段，「锚被结构容量夹」与「推导本身错了」可当场分开。
   */
  budgetDerivation: BudgetDerivation | null;
}

/** 预算派生链（可持久化、可审计；口径见 derivePlanningHints 内 budgetDerivation 块） */
export interface BudgetDerivation {
  /** 总学时锚的来源：结构化小时 / 会话频率推算 / 每日分钟兜底 / 无锚 */
  source: 'structured_estimated_hours' | 'structured_sessions' | 'inferred_daily_minutes' | 'none';
  /** 结构化 timeDimensions 原样给出的小时（未经带内钳制） */
  structuredHours: number | null;
  /** 现实上限（每日分钟 × 周期天数 / 60）：超过它按现实钳制 */
  inferredCapHours: number | null;
  /** 带内钳制后的总锚（= targetTotalHours） */
  totalHours: number | null;
  /** 均摊请求值 = totalHours / targetMilestones（未夹） */
  perMilestoneRequested: number | null;
  /** 结构容量上界 = 每阶段课数上界 × 单课分钟上界 / 60（夹的来源） */
  structureStageCapacityHours: number | null;
  /** 落地的每阶段锚（= targetHoursPerMilestone，= min(容量上界, 请求值)） */
  perMilestoneAnchored: number | null;
  /** 是否发生了容量夹（anchored < requested） */
  anchorClamped: boolean;
}

/** 结构容量缺口报告（可持久化、可审计；口径见 derivePlanningHints 内 capacityDeficit 块） */
export interface CapacityDeficitReport {
  /** 用户声明的总学时预算（小时） */
  requestedHours: number;
  /** 结构容量上界（小时）= 每阶段课数上界 × 单课分钟上界 × 阶段数 / 60 */
  capacityHours: number;
  /** 缺口比例 = 1 - capacityHours/requestedHours（>0 即装不下） */
  deficitRatio: number;
  /** 瓶颈来源，便于判断该抬哪道上界 */
  limitingFactor: 'lesson_count' | 'lesson_minutes' | 'milestone_count';
  /** 触发时各上界的取值快照 */
  bounds: {
    subtasksPerStage: number;
    subtaskMinutes: number;
    milestones: number;
  };
}

/**
 * Goal 层分流判定（`normalizedInput.triage`，可选）。
 * 语义：这件事是否有「可跨情境迁移的因果心智」、以及**会不会反复发生**。
 * 依据（2026-09-21，60 例混合数据集自带标注）：`blockType` 与 `recurrence` 几乎正交——
 *   capability × recurring 14/14、oneoff_operation × once 10/10、environment_tooling × recurring 10/11
 *   ⇒ 按"类型"分流会误杀 13 例（10 个 recurring 环境排障 + 3 个 recurring 权限流程）；
 *   **复现性才是钥匙**。缺失时行为与今天完全一致。
 */
export interface TriageHint {
  /** 是否存在可跨情境迁移的因果心智（false = 一次性操作/事务） */
  transferable?: boolean | null;
  /** 会不会反复发生 */
  recurrence?: 'once' | 'recurring' | null;
  /** 判定依据（可观测，落库/审计用） */
  evidence?: string | null;
}

/**
 * 「一节课」量级边界（出口不变量 B 的**唯一口径**）。
 * 依据：60 例混合数据实测，一次性操作类产出 2.3–7.4h，构成为
 * 「阶段数 × 每段任务数(2–3) × 单任务分钟」，而单任务中位 37 分钟恰是 standard 档
 * `defaultMinutesRange=[30,90]` 的下沿 ⇒ 学时是模板产物。
 * 最坏量级 = 2 段 × 2 任务 × 15 分钟 = 60 分钟。
 */
export const ONE_SITTING_BOUNDS = {
  milestoneRange: [1, 2] as [number, number],
  conceptRange: [1, 2] as [number, number],
  subtasksPerStageRange: [1, 2] as [number, number],
  subtaskMinutesRange: [10, 15] as [number, number],
  maxWeeks: 1,
};

/**
 * "这是一节课（不是一门课）"的小时上限：Path 层产出的 `estimatedHours` 落在此值以内，
 * 即视为一次性操作的收敛结果，下游 stage-enrichment 据此把任务数与分钟一并收紧。
 */
export const ONE_SITTING_MAX_HOURS = 1;

/**
 * 「一节课」的默认时长（分钟）：当 Goal 层没能从用户原话里取到"一次多久"时用它兜底。
 * 为什么需要默认值：`sessionsLengthMin` 实测常为 null（用户没说"一次学多久"），
 * 而"课次 × 一次时长"必须两项都有才能算出体量 —— 缺一项就退化成模具（= 通胀）。
 */
export const DEFAULT_SESSION_MINUTES = 40;

/**
 * hints 硬执行（2026-09-21）：把 stage-designer 的**产出**按 hints 兜底裁剪。
 *
 * 为什么需要：`subtasksPerStageRange` 对模型只是"软参考"——实测 hints=[2,2] 时仍产出
 * 5 任务/段（15.8h），导致"体量 = 课次 × 一次时长"的锚在上端**完全不生效**（输出不随锚变化，
 * 连"校准"都测不出来）。
 *
 * 只治**注水方向**（超上界才裁），不抬升下限：给少是可逆的（用户能升），给多是荒谬的
 * （7.4h 的传照片课）。分钟同理只钳上界。
 */
export function clampStageTasksToHints<T extends { estimatedMinutes?: number }>(
  tasks: T[],
  hints?: { subtasksPerStageRange?: [number, number]; subtaskMinutesRange?: [number, number] } | null,
): T[] {
  if (!Array.isArray(tasks) || tasks.length === 0 || !hints) return tasks;
  const capCount = Number(hints.subtasksPerStageRange?.[1]);
  const capMinutes = Number(hints.subtaskMinutesRange?.[1]);
  let out = tasks;
  if (Number.isFinite(capCount) && capCount >= 1 && out.length > capCount) {
    out = out.slice(0, Math.floor(capCount));
  }
  const overMinutes = (task: T): boolean => {
    const minutes = Number(task?.estimatedMinutes);
    return Number.isFinite(minutes) && minutes > capMinutes;
  };
  if (Number.isFinite(capMinutes) && capMinutes >= 1 && out.some(overMinutes)) {
    out = out.map((task) => (overMinutes(task) ? { ...task, estimatedMinutes: capMinutes } : task));
  }
  return out;
}

/**
 * 把任意已算好的 hints 收到「一节课」量级（只收上界，不拍死数字；区间不塌成单点）。
 * 两个调用方：① Goal 层 triage 判定（derivePlanningHints 内）；② Path 层自检后，
 * 给 stage-designer 用的 hints（path 产出 ≤1 小时 ⇒ 任务数/分钟一并收紧，否则学时仍会被
 * stage-designer 的 30–90 分钟默认值撑回 7 小时）。
 */
export function clampHintsToOneSitting(hints: PlanningHints): PlanningHints {
  const cap = ONE_SITTING_BOUNDS;
  const capTarget = (value: number | null, ceiling: number): number | null =>
    value === null || value === undefined ? value : Math.min(value, ceiling);
  return {
    ...hints,
    milestoneRange: [...cap.milestoneRange],
    conceptRange: [...cap.conceptRange],
    subtasksPerStageRange: [...cap.subtasksPerStageRange],
    subtaskMinutesRange: [...cap.subtaskMinutesRange],
    maxWeeks: Math.min(hints.maxWeeks, cap.maxWeeks),
    targetMilestones: capTarget(hints.targetMilestones ?? null, cap.milestoneRange[1]),
    targetSubtasksPerStage: capTarget(hints.targetSubtasksPerStage ?? null, cap.subtasksPerStageRange[1]),
    targetSubtasksForStage: capTarget(hints.targetSubtasksForStage ?? null, cap.subtasksPerStageRange[1]),
  };
}

export function derivePlanningHints(
  timeHorizon: string | null,
  timePerSession: string | null,
  timeBudget: string | null,
  timeBudgetCadence: TimeBudgetCadence | null,
  keyStages: string[],
  timeDimensions?: { totalWeeks?: number | null; estimatedHours?: number | null; sessionsPerWeek?: number | null; sessionsLengthMin?: number | null; totalSessions?: number | null } | null,
  scopeSize?: ScopeSize | null,
  learnerLoadProfile?: LearnerLoadProfile | null,
  triage?: TriageHint | null
): PlanningHints {
  const paceSignal = inferPaceSignal(timeHorizon);
  const keyStageCount = keyStages.length;
  const paceConfig = paceSignalRangeConfig[paceSignal];

  // 体量口径（方案丙，2026-09-20）：**goal 只给自由描述，代码只给边界，数字由 LLM 定**。
  //   演进：甲（枚举+精确匹配+正则清洗）→ 乙（枚举降为下界、区间授权、去正则）→ 丙（连枚举也不要）。
  //   丙的做法：goal 的 scope_size 是"规模判断 + 依据"的一句话；代码只用
  //   ①节奏（时间→pace）给**上界**（防膨胀）②软下界 2 给**下界**，区间交给 path LLM 自定。
  //   若历史数据仍传来合法枚举值，则沿用乙口径（向后兼容，不因数据形态切换而行为突变）。
  const scope = normalizeScopeSize(scopeSize);
  const scopeConfig = scope ? SCOPE_SIZE_RANGES[scope] : null;

  let conceptRange: [number, number] = [...paceConfig.conceptRange];
  const defaultMinutesRange: [number, number] = [...paceConfig.defaultMinutesRange];

  const HARD_MILESTONE_CAP = 8;
  const scopeMilestoneFloor = scopeConfig ? scopeConfig.milestoneRange[0] : 2;
  // 方案丙：goal 的 scope_size 改为**自由描述**（不再选档），代码不再按枚举映射 ⇒ 正常情况下 scope=null。
  // 那时上界只由**节奏（时间）**给：min(硬上限 8, paceCap)。历史数据/重规划若仍传来合法枚举，沿用乙口径（兼容）。
  const milestoneCap = scope
    ? (scope === 'micro'
        ? scopeConfig!.milestoneRange[1]
        : Math.min(HARD_MILESTONE_CAP, Math.max(scopeConfig!.milestoneRange[1], paceConfig.milestoneRange[1])))
    : Math.min(HARD_MILESTONE_CAP, paceConfig.milestoneRange[1]);
  // 方案乙：**区间是权威边界，数字由 LLM 定**。
  //   lo = scope 下界（问题规模参考）；hi = 防膨胀上界（scope/pace 较松者 ∧ 硬上限 8）。
  //   targetMilestones 退化为「建议值」：供提示词参考，validator 只校验 count ∈ [lo, hi]。
  //   为什么不再塌成 [t,t]：体量是"这条路径该分几步"的语义判断，属于 LLM 的活；
  //   代码只该给边界（防压小/防撑大），不该替它拍一个精确数——枚举拍死正是"过于死板"的来源。
  let milestoneRange: [number, number] = [scopeMilestoneFloor, milestoneCap];
  // 学时早估（仅用于 keyStages 缺失时的里程碑兜底；与后文 estimatedHoursTotal 同源不同时机）
  const earlyHoursEstimate: number | null = (() => {
    const td: Record<string, unknown> | null | undefined = timeDimensions;
    const est = Number(td?.estimatedHours);
    if (Number.isFinite(est) && est > 0) return est;
    const sessions = Number(td?.totalSessions);
    const lenMin = Number(td?.sessionsLengthMin);
    if (Number.isFinite(sessions) && sessions > 0 && Number.isFinite(lenMin) && lenMin > 0) {
      return (sessions * lenMin) / 60;
    }
    return null;
  })();
  let targetMilestones: number | null = keyStageCount > 0
    ? Math.min(milestoneCap, Math.max(scopeMilestoneFloor, keyStageCount))
    : earlyHoursEstimate !== null && earlyHoursEstimate > 0
      // 2026-09-27 横向扩测（heavy-fp#4）：提案缺 key_stages ⇒ targetMilestones=null ⇒ 整条锚链塌光
      // （subtasksPerStageRange 落 [4,6]、subtaskMinutesRange 落 [15,30]），490h 预算被写成 12.8h。
      // keyStages 缺失但有学时信号时按学时分档反推兜底（分档与 goal 层 key_stages 折算公式同源）；
      // keyStages 存在时本分支永不生效。
      ? Math.min(milestoneCap, Math.max(2, Math.round(earlyHoursEstimate / (earlyHoursEstimate > 200 ? 45 : 12))))
      : (scope ? scopeMilestoneFloor : null);

  // 每阶段任务数同理（含 micro 的特殊处理）：否则"每阶段 2 个任务"的塌缩不变。
  let subtasksPerStageRange: [number, number] = scope === 'micro'
    ? [...scopeConfig!.subtasksPerStageRange]
    : [
        scopeConfig ? scopeConfig.subtasksPerStageRange[0] : paceConfig.subtasksPerStageRange[0],
        Math.max(
          scopeConfig ? scopeConfig.subtasksPerStageRange[1] : paceConfig.subtasksPerStageRange[1],
          paceConfig.subtasksPerStageRange[1],
        ),
      ];
  // maxWeeks：优先用 goal 层 LLM 推断的 totalWeeks（×1.2 缓冲）；
  // 其次用自由文本 time_horizon 的确定性周数兜底（LLM 未产出 totalWeeks 时仍能钳制紧迫场景）；
  // 最后回退 pace 档位固定值，硬上限 52
  // ---- 课次锚（2026-09-21）：体量 = **课次 × 一次时长** ----
  // 实测（本地 60 条 run）：让 LLM 估"总学时"产出率仅 10%（estimatedHours 只有 6/60 有值）⇒
  // hints 掉进兜底模具（[3,5] 任务 × 30–90 分钟）⇒ 中位 7.2h、与需求无关。
  // 改口径：让 LLM 估"这件事大概要几节课"（人能估），一次时长取用户原话（sessionsLengthMin）。
  const totalSessions = Number.isFinite(timeDimensions?.totalSessions) && (timeDimensions!.totalSessions as number) > 0
    ? (timeDimensions!.totalSessions as number)
    : null;
  // 一次时长：优先用户原话，缺失用默认（40 分钟）——否则"课次 × 一次时长"算不出体量，锚失效
  const oneSessionMinutes = totalSessions !== null
    ? (Number.isFinite(timeDimensions?.sessionsLengthMin) && (timeDimensions!.sessionsLengthMin as number) > 0
        ? (timeDimensions!.sessionsLengthMin as number)
        : DEFAULT_SESSION_MINUTES)
    : null;

  const inferredWeeks = Number.isFinite(timeDimensions?.totalWeeks) && (timeDimensions!.totalWeeks as number) > 0
    ? (timeDimensions!.totalWeeks as number)
    : inferMaxWeeksFromTimeHorizon(timeHorizon);
  let maxWeeks: number = inferredWeeks
    ? Math.min(52, Math.max(1, Math.ceil(inferredWeeks * 1.2)))
    : paceConfig.maxWeeks;

  // 单次时长解析（2026-09-28 修单位 bug）：「每天3小时」此前被解析成 3 **分钟**
  //（正则只抓首个数字），所有「每天N小时」用户的预算被静默压缩 20-60 倍，
  // 且单课分钟档被压到 30min 下限——大预算守恒异常的一大隐藏根因。
  // 顺序：N小时（×60）→ N分钟 → 半小时(=30) → 裸数字（当分钟）。
  // 会话时长解析（含中文数字——2026-09-29 第三波评审实证漏解析：「一天三小时」
  // 正则只认阿拉伯数字 → 回退默认档 [30,120]，本该 [45,120]，整条路径排了 90min 课）。
  // 支持：3小时/3.5小时/三个半小时/半小时/三十分钟/30分钟/裸数字（分钟）/一个钟头。
  const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const parseCnNum = (s: string): number | null => {
    if (!s) return null;
    if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
    let total = 0;
    let num = 0;
    for (const ch of s) {
      if (ch in CN_DIGIT) num = CN_DIGIT[ch];
      else if (ch === '十') { total += (num === 0 ? 1 : num) * 10; num = 0; }
      else if (ch === '百') { total += (num === 0 ? 1 : num) * 100; num = 0; }
      else return null;
    }
    return total + num;
  };
  const NUM = '[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百]+';
  const parsedSessionMinutes = (() => {
    const text = (timePerSession || '').trim();
    if (!text) return null;
    // X个半小时 → (X+0.5) 小时（「一个半小时」=1.5h=90min，「三个半小时」=3.5h=210min）
    const halfHours = text.match(new RegExp(`(${NUM})\\s*(?:个)?半\\s*(?:个)?小时`));
    if (halfHours) {
      const n = parseCnNum(halfHours[1]);
      if (n !== null) return Math.round(n * 60 + 30);
    }
    const hour = text.match(new RegExp(`(${NUM})\\s*(?:个)?\\s*(?:小时|钟头|时辰)`));
    if (hour) {
      const n = parseCnNum(hour[1]);
      if (n !== null) return Math.round(n * 60);
    }
    const minute = text.match(new RegExp(`(${NUM})\\s*(?:分钟|分种|min)`));
    if (minute) {
      const n = parseCnNum(minute[1]);
      if (n !== null) return Math.round(n);
    }
    if (/半\s*小时/.test(text)) return 30;
    const bare = text.match(new RegExp(`(${NUM})`));
    if (bare) {
      const n = parseCnNum(bare[1]);
      if (n !== null) return Math.round(n);
    }
    return null;
  })();

  // 2026-09-28 R2（rw-school-15 案例：20min 早读被排 30min 课）：上界不得突破会话时长——
  // 「每步一次坐完」的硬约束优先于「任务别太小」的下限偏好。
  // 下界=clamp(0.3×会话, 8, 45)；上界=min(会话时长, 120 理智上界)。
  // 2026-09-29 用户口径修正（「没有数据支撑学习者每天不能学八小时，学校里的学生就是这样」）：
  // **去掉 0.8 系数**——它把「课 ≤ 会话」偷偷变成「课 ≤ 0.8×会话」，白吃掉 20% 结构容量，
  // 且无实证依据（原案例只要求「别超会话」，从没要求留 20% 余量）。改为一比一取用户自述会话时长；
  // 120 分钟只作**理智上界**（防「一次 8 小时」这类口语被当单课长度），不是负荷判断。
  // 实证：CPA 案例（自述一次 2h）单课档从 96 → 120，结构容量 240h → 300h（对 416h 目标缺口 42%→28%）。
  let subtaskMinutesRange: [number, number] = Number.isFinite(parsedSessionMinutes)
    ? (() => {
        const s = parsedSessionMinutes as number;
        const lower = Math.max(8, Math.min(45, Math.round(s * 0.3)));
        const upper = Math.max(15, Math.min(120, s));
        return [lower, Math.max(lower, upper)] as [number, number];
      })()
    : defaultMinutesRange;

  const parsedBudgetMinutes = parseBudgetMinutes(timeBudget);
  if (Number.isFinite(parsedBudgetMinutes)) {
    const budgetMinutes = parsedBudgetMinutes as number;
    const threshold = tightBudgetConfig.thresholds[timeBudgetCadence || ''] || 0;
    const isTightBudget = threshold > 0 && budgetMinutes <= threshold;

    if (isTightBudget) {
      const floors = tightBudgetConfig.rangeReductionFloors;
      milestoneRange = [Math.max(floors.milestoneRange[0], milestoneRange[0] - 1), Math.max(floors.milestoneRange[1], milestoneRange[1] - 1)];
      conceptRange = [Math.max(floors.conceptRange[0], conceptRange[0] - 1), Math.max(floors.conceptRange[1], conceptRange[1] - 1)];
      subtasksPerStageRange = [Math.max(floors.subtasksPerStageRange[0], subtasksPerStageRange[0] - 1), Math.max(floors.subtasksPerStageRange[1], subtasksPerStageRange[1] - 1)];
      // 紧预算必须同时收紧「精确目标」：scope 已知时 effectiveMilestoneRange 恒为 [target,target]，
      // 只改 milestoneRange 的话下调永远到不了输出（255 例扫测发现的空转）；
      // 且下游 path-planning 对里程碑数是**阻断级精确匹配**，这里不收 target 就等于紧预算对体量零影响。
      if (targetMilestones !== null) {
        targetMilestones = Math.min(targetMilestones, milestoneRange[1]);
      }
    }
  }

  // 学习者负荷画像收紧（可选、加性）：仅在调用方显式传入 learnerLoadProfile 时生效，
  // 不传时行为与今天完全一致。用于把「虚拟学习者的可用时间/认知负荷耐受」纳入体量推导，
  // 避免生成本人根本跑不动的路径（紧预算/低耐受 → 更少里程碑、更短单任务、更短周期、更少任务）。
  const loadProfile = learnerLoadProfile && typeof learnerLoadProfile === 'object' ? learnerLoadProfile : null;
  if (loadProfile) {
    const availableTimeText = normalizeString(loadProfile.availableTime);
    const loadToleranceText = normalizeString(loadProfile.loadTolerance);
    const isTightAvailability = availableTimeText ? isMinimalAvailabilitySignal(availableTimeText) : false;
    // 碎片化节奏（按天/按次）在传入负荷画像时视为紧预算信号
    const isFragmentedCadence = timeBudgetCadence === 'per_day' || timeBudgetCadence === 'per_session';
    const isLowTolerance = loadToleranceText ? isLowLoadToleranceSignal(loadToleranceText) : false;

    if (isTightAvailability || isFragmentedCadence || isLowTolerance) {
      // 里程碑数：**认知负荷不参与**（2026-09-21 定）。
      //   「这人该分几步」是**结构判断**，归 LLM（问题语义）+ 学习证据；认知负荷管的是
      //   「一次能学多久、多密」——只收紧下面的**资源**。历史教训：这里曾把区间压成 [2,2]，
      //   区间两端相等 ⇒ validator 退化成精确校验 ⇒ 数量被代码拍死（275 例实测 46% 命中，
      //   且被拍的全部恰好 2 段）。边界仍由 scope/pace 给（见上），防膨胀不靠这一层。
      // 单任务分钟上界 ≤45
      subtaskMinutesRange = [Math.min(subtaskMinutesRange[0], 45), Math.min(subtaskMinutesRange[1], 45)];
      // 周期上界 ≤2 周
      maxWeeks = Math.min(maxWeeks, 2);
      // 每阶段任务数上界：一般负荷收紧到 4，极低耐受再收到 3
      const loadSubtasksCap = isLowTolerance ? 3 : 4;
      subtasksPerStageRange = [
        Math.min(subtasksPerStageRange[0], loadSubtasksCap),
        Math.min(subtasksPerStageRange[1], loadSubtasksCap),
      ];
    }
  }

  // ---- 分流钳制（出口不变量 B，2026-09-21）：Goal 层判为「低可迁移 × 低复现」⇒ 压到"一节"量级 ----
  // 依据（60 例混合数据实测）：一次性操作类产出 2.3–7.4h，构成为
  //   「阶段数 × 每段任务数(2–3) × 单任务分钟」；单任务中位 37 分钟恰是 standard 档
  //   defaultMinutesRange=[30,90] 的下沿 ⇒ 学时是模板产物，不是"这件事要多久"的估计。
  // 只收紧上界，不拍死数字（数字仍由 LLM 在区间内定）；且**不用单点区间**，
  // 与不变量 A（区间永不为单点，见下方出口收束）兼容：最坏 2 段 × 2 任务 × 15 分钟 = 60 分钟。
  // 缺失 triage 时，本分支不生效，行为与今天完全一致。
  if (triage && triage.transferable === false && triage.recurrence === 'once') {
    const cap = ONE_SITTING_BOUNDS;
    milestoneRange = [...cap.milestoneRange];
    conceptRange = [...cap.conceptRange];
    subtasksPerStageRange = [...cap.subtasksPerStageRange];
    subtaskMinutesRange = [...cap.subtaskMinutesRange];
    maxWeeks = Math.min(maxWeeks, cap.maxWeeks);
    if (targetMilestones !== null) targetMilestones = Math.min(targetMilestones, cap.milestoneRange[1]);
  }

  // ---- 用户承受力锚（2026-09-21 **数据定位**）：体量上界锚在"用户一次能承受多少" ----
  // 实测（本地重放复现生产）：学时 = 段数 × 每段任务数(4–6) × 单任务分钟(37–45)，
  // 与"这件事需要多久"无关 —— 一个 availableTime=minimal 的学习者被排了 **7.4 小时**。
  // 因此：**时间极少（明确的 minimal 信号）** ⇒ 收到"一节课"（最坏 60 分钟）。
  //
  // 2026-09-22 修正：**删掉"完全没有时长信号 ⇒ 一节课"这一支**。三条理由：
  // ① 真实用户大多不主动说时长 ⇒"未知"占多数，会把"没说时长但确实要学"的人全塌成
  //    一次性操作卡 —— 正是"砍过头"，与消除教育通胀的目标相反；
  // ② 与既有设计正面冲突（"认知负荷退出里程碑数 + 里程碑区间永不为单点"，d216bde0），
  //    实测造成 11 个既有单测变红；
  // ③ 体量的主锚已是"课次"（见下方 lessThanOneLesson）。**未知 ≠ 最小**：缺信号时结构
  //    保持中性，收紧只能由证据（明确 minimal / 课次 < 1）驱动。
  const availabilityText = normalizeString(learnerLoadProfile?.availableTime);
  const isTightAvailabilitySignal = availabilityText ? isMinimalAvailabilitySignal(availabilityText) : false;
  // 课次 < 1 ⇒ 这是一次操作（不是一门课）——最干净、且**代码可判**的判据，不需要类型分类
  const lessThanOneLesson = totalSessions !== null && totalSessions < 1;
  if (lessThanOneLesson || isTightAvailabilitySignal) {
    const cap = ONE_SITTING_BOUNDS;
    milestoneRange = [...cap.milestoneRange];
    conceptRange = [...cap.conceptRange];
    subtasksPerStageRange = [...cap.subtasksPerStageRange];
    subtaskMinutesRange = [...cap.subtaskMinutesRange];
    maxWeeks = Math.min(maxWeeks, cap.maxWeeks);
    if (targetMilestones !== null) targetMilestones = Math.min(targetMilestones, cap.milestoneRange[1]);
  }

  // 方案乙：区间即权威（不再塌成点）。确保「建议值」落在区间内，供提示词引用时不自相矛盾。
  // 出口不变量（2026-09-21）：**里程碑区间永不为单点**——两端一旦相等，validator 会退化成
  //   「精确校验」，数量就被代码拍死（这才是体量塌缩的真正机制，而不是"收得小"）。
  //   任何分支的意外塌缩（含今后新增的收紧）都在这里兜住，不必逐个分支打补丁。
  const hintedMilestoneTarget = targetMilestones ?? milestoneRange[0];
  const milestoneLo = Math.min(milestoneRange[0], hintedMilestoneTarget);
  const milestoneHi = Math.max(milestoneRange[1], hintedMilestoneTarget);
  const effectiveMilestoneRange: [number, number] = [milestoneLo, Math.max(milestoneLo + 1, milestoneHi)];

  // 强制每阶段子任务数量：总学时 ÷ 里程碑数 ÷ 每任务约 1 小时 → 每阶段任务目标。
  // 总学时 fallback 链（goal 数值推断产出率极低，必须有多级信号兜底，保证总能算出确定值）：
  //   ① timeDimensions.estimatedHours（goal 直接推断）
  //   ② totalWeeks × sessionsPerWeek × sessionsLengthMin/60（频率×时长×周期推算总小时）
  //   ③ pace 档位中位数（compact→3, standard→4, extended→5）
  // 2026-09-28 P0（真实案例 rw-school-16=2340h / rw-career-14=无锚 双驱动）：
  // a) 结构化 timeDimensions 可能给出荒谬预算（180min/天 × 252 天被算成 2340h）——
  //    用户自述的「每日可投入 × 周期」是现实上限，超过它按现实钳制；
  // b) 结构化字段缺失但 timeHorizon + timePerSession 可解析时，做兜底推断
  //    （周期天数 × 每日分钟），否则这类案例完全没有守恒锚（career-14 空锚）。
  const inferredBudgetCap = Number.isFinite(parsedSessionMinutes) && inferredWeeks
    ? Math.round(((parsedSessionMinutes as number) * inferredWeeks * 7) / 60)
    : null;
  const structuredHoursTotal =
    totalSessions !== null && oneSessionMinutes !== null
      ? totalSessions * oneSessionMinutes / 60
      : Number.isFinite(timeDimensions?.estimatedHours) && (timeDimensions!.estimatedHours as number) > 0
      ? (timeDimensions!.estimatedHours as number)
      : Number.isFinite(timeDimensions?.totalWeeks)
          && (timeDimensions!.totalWeeks as number) > 0
          && Number.isFinite(timeDimensions?.sessionsPerWeek)
          && (timeDimensions!.sessionsPerWeek as number) > 0
          && Number.isFinite(timeDimensions?.sessionsLengthMin)
          && (timeDimensions!.sessionsLengthMin as number) > 0
        ? (timeDimensions!.totalWeeks as number) * (timeDimensions!.sessionsPerWeek as number)
          * (timeDimensions!.sessionsLengthMin as number) / 60
        : null;
  const estimatedHoursTotal =
    structuredHoursTotal !== null && inferredBudgetCap !== null
      // R1-d（rw-school-11/exam-12 target=1h 案例）：结构化锚也可能被污染成荒谬小值，
      // 直接 min() 会信任垃圾下限。预算应落在每日现实上限的 [25%, 100%] 带内。
      ? Math.max(Math.min(structuredHoursTotal, inferredBudgetCap), inferredBudgetCap * 0.25)
      : structuredHoursTotal !== null
        ? structuredHoursTotal
        : inferredBudgetCap;
  // ---- 大预算扩容（2026-09-27，基线 31 格实测驱动）：锚定总学时超过结构天花板
  // （阶段×任务×单任务分钟上限）时，按需抬升每阶段任务上限与单任务分钟上界——
  // 任务语义升级为「学习单元（可含多次坐学）」。基线收缩比 0.07-0.74（中位 0.13-0.26）
  // 的根因即此天花板：90-180h 真实预算被 5 阶段×6 任务×120min 压掉 70-90%，
  // 且 mastery 人设的"把预算排满"抵抗对它零效果（对话信号不进结构先验）。
  // 触发判据 = 容量赤字：锚定分钟数 > 当前上界容量（分钟上界×每阶段任务上限）。
  const perStageHours = targetMilestones !== null && estimatedHoursTotal !== null
    ? estimatedHoursTotal / targetMilestones
    : null;
  const capacityMin = subtaskMinutesRange[1] * subtasksPerStageRange[1];
  const anchorMin = estimatedHoursTotal !== null ? estimatedHoursTotal * 60 : null;
  // 容量赤字布尔开关：锚定分钟数 > 当前上界容量，且每阶段需求 >6h（低于此不值得扩，见下方判据）。
  // 与下方 `capacityDeficitReport`（可观测结构化报告）分工：本开关只决定「要不要扩容」，
  // 报告负责「缺口多少、卡在哪道上界」。
  const needsCapacityExpansion = anchorMin !== null && perStageHours !== null && targetMilestones !== null
    ? anchorMin > capacityMin && perStageHours > 6
    : false;
  if (needsCapacityExpansion) {
    // 2026-09-28 粒度修正：扩容只加「课数」，不再放大「单课时长」。此前 avgTaskMin*2 会把
    // 分钟上界顶到 240（session=60min 时实测单课均值 82min、锚 108min）——单课超过用户
    // 单次可用时间 = 一节课一天上不完（真实案例：90h 预算被切成 5×10×82min）。
    // 单课上界保持会话档（subtaskMinutesRange[1]，已按 timePerSession 一比一校准）；
    // 预算缺口由课数吸收；仍装不下的部分由
    // targetHoursPerMilestone 的结构容量钳制诚实收缩（不多排账面学时）。
    //
    // 2026-09-29 R5-1：旧代码硬帽 Math.min(14, needed)——needed=54（school-16 型：650h/8 阶段
    // = 81h/阶段）被夹回 14，且下限公式产出倒挂区间 [18,14]（range[0]>range[1]，下游
    // 「遵守区间」的消费方拿到垃圾）。实证：扩容从未真正生效，长周期路径交付比 7-42%，
    // 31 条缺口声明全是这个天花板。改为按需抬升：上界 = clamp(needed, 14, 30)。
    // 30 的上限是防 filler 副作用（评审实测：强填课会产换皮复读，B 维同质化）——
    // 超过 30 课/阶段仍由缺口声明诚实兜底，不靠堆课数虚增容量。
    // 2026-09-29 用户口径修正：去掉这里额外的 90 封顶——它与 structureStageCapacityHours 用的
    // subtaskMinutesRange[1] 不一致（CPA 实测 96 vs 90），造成「课数目标按 90 算、容量报告按 96 算」
    // 两张皮。现在两处同源。
    const perStageMin = anchorMin / targetMilestones;
    const lessonMinutesCap = subtaskMinutesRange[1];
    const needed = Math.ceil(perStageMin / lessonMinutesCap);
    // 上界按需抬升（needed），30 封顶：强填课会产换皮复读（评审实证 B 维同质化），
    // 超过 30 课/阶段仍由缺口声明诚实兜底，不靠堆课数虚增容量。
    // 区间有序性天然保持：lower ≤ 原上界 ≤ 新上界。
    subtasksPerStageRange = [
      Math.max(3, Math.min(subtasksPerStageRange[0], Math.ceil(needed / 3))),
      Math.min(30, Math.max(subtasksPerStageRange[1], needed)),
    ];
  }
  // 锚定总学时透传（供 path-planning prompt 把"总预算"显式交给 LLM 分配）
  const targetTotalHours = estimatedHoursTotal;
  // perStage 从总学时反推时，上限必须被 subtasksPerStageRange 钳制：scope_size 是"问题多大"的硬约束，
  // 不能因为 goal 碰巧推断出 estimatedHours 就突破 scope 的任务密度上限（否则 micro/small 又会被撑大）。
  // 下限保持宽松（硬编码 2），允许比 pace 默认更少，不被抬升。
  // 单任务小时：常规 1h/任务；仅抬升分支按均摊小时计（任务=学习单元，含多次坐学）。
  const subtasksCap = subtasksPerStageRange[1];
  const perStageFromHours: number | null =
    targetMilestones !== null && estimatedHoursTotal !== null
      ? Math.min(subtasksCap, Math.max(2, Math.round(estimatedHoursTotal / targetMilestones / 1.0)))
      : null;
  // 无总学时信息时兜底：单阶段至少 2 个任务（预算未知时保守，但不再落到 1），
  // 上限仍受 subtasksPerStageRange 钳制。避免 micro + 学时缺失时产出"2 里程碑 × 1 任务"的空壳路径。
  const paceFloor = subtasksPerStageRange[0];
  const fallbackPerStage = Math.min(subtasksCap, Math.max(paceFloor, 2));
  const targetSubtasksPerStage: number | null =
    perStageFromHours ?? (targetMilestones !== null ? fallbackPerStage : null);
  // 2026-09-28 去等分：学时反推的锚从单点 [t,t] 改为 ±3 带。单点锚 + stage-designer
  // 「恰好 N 课」强规则 = 全路径每阶段等数（真实案例 5×10；WPS 小预算路径 5×2 同理），
  // 与各阶段学时占比脱钩。带内由逐阶段锚（stage-enrichment 的 targetSubtasksForStage）
  // 按本阶段学时定数，全局锚只兜底无学时信息的阶段。
  const effectiveSubtasksPerStageRange: [number, number] = targetSubtasksPerStage !== null
    ? (perStageFromHours !== null
        ? [Math.max(2, targetSubtasksPerStage - 3), Math.min(subtasksCap, targetSubtasksPerStage + 3)]
        : [fallbackPerStage, subtasksCap])
    : subtasksPerStageRange;

  // ---- 量级锚（2026-09-27 横向扩测驱动）：switch-data 270h 预算实得 94.5h（收缩比 0.35）——
  // 扩容块抬了结构天花板，但模型惯性仍按 ~11h/阶段、~60min/任务填充，守恒 prompt 的抽象区间被无视。
  // 显式数字锚比区间可跟随：每阶段学时锚 + 单任务分钟锚，直接随 hints JSON 进 prompt。
  // 每阶段学时锚被结构容量（任务数上限×分钟上限）钳制：预算真装不下时锚到容量上限（诚实装不下），
  // 而不是给出任务层永远填不满的账面注水锚（里程碑学时与任务分钟两张皮）。
  const structureStageCapacityHours = (effectiveSubtasksPerStageRange[1] * subtaskMinutesRange[1]) / 60;
  const targetHoursPerMilestone =
    targetMilestones !== null && estimatedHoursTotal !== null
      ? Math.min(
          structureStageCapacityHours,
          Math.round((estimatedHoursTotal / targetMilestones) * 10) / 10,
        )
      : null;
  const targetMinutesPerTask =
    targetMilestones !== null && estimatedHoursTotal !== null && targetSubtasksPerStage !== null
      ? Math.min(
          subtaskMinutesRange[1],
          Math.round((estimatedHoursTotal * 60) / (targetMilestones * targetSubtasksPerStage)),
        )
      : null;

  // ---- 预算派生链留痕（2026-09-29 I6-3）：把「每阶段锚为什么是这个数」记下来 ----
  // 动机：实审只看到 targetHoursPerMilestone=22.4 与 targetTotalHours/targetMilestones=69.3
  // 相差 68%，两个字段都不带来源，只能记「hints 内部不自洽」；实际是容量夹（22.4 = 14 课 ×
  // 96min / 60）。留痕后「推导错」与「容量夹」当场可分。
  // 注意口径：本字段记的是**锚的夹**（用 effectiveSubtasksPerStageRange[1]，与上一行同源）；
  // 最终交付侧的夹是 skills/path-planning 的 enforceBudgetConservation（用 subtasksPerStageRange[1]），
  // 两者在 effective 上界 < 原上界时会不同——所以两处都留痕，不做合并（合并即掩盖分歧）。
  const budgetDerivation: BudgetDerivation | null = estimatedHoursTotal !== null
    ? (() => {
        const requestedPerMilestone = targetMilestones !== null
          ? Math.round((estimatedHoursTotal / targetMilestones) * 10) / 10
          : null;
        const source: BudgetDerivation['source'] =
          structuredHoursTotal !== null
            ? (totalSessions !== null && oneSessionMinutes !== null
                ? 'structured_sessions'
                : Number.isFinite(timeDimensions?.estimatedHours) && (timeDimensions!.estimatedHours as number) > 0
                  ? 'structured_estimated_hours'
                  : 'structured_sessions')
            : inferredBudgetCap !== null
              ? 'inferred_daily_minutes'
              : 'none';
        return {
          source,
          structuredHours: structuredHoursTotal,
          inferredCapHours: inferredBudgetCap,
          totalHours: estimatedHoursTotal,
          perMilestoneRequested: requestedPerMilestone,
          structureStageCapacityHours: targetMilestones !== null ? structureStageCapacityHours : null,
          perMilestoneAnchored: targetHoursPerMilestone,
          anchorClamped: requestedPerMilestone !== null
            && targetHoursPerMilestone !== null
            && targetHoursPerMilestone < requestedPerMilestone - 0.05,
        };
      })()
    : null;

  // ---- 结构容量缺口（2026-09-29 I2b）：把「装不下」变成可观测、可复核的事实 ----
  // 口径：容量上界 = 每阶段课数上界 × 单课分钟上界 × 阶段数。该上界同时受两道**有意设计**约束——
  //   ① 每阶段 30 课封顶（防 filler 换皮复读，评审实证 B 维同质化）；
  //   ② 单课分钟上界按用户单次可用坐姿校准（一节课要能一次上完）。
  // 因此长周期/大预算诉求必然装不下，问题从来不是「要不要夹」，而是「夹了多少有没有人知道」。
  // 此前 targetHoursPerMilestone 被钳到容量上界（对规划器诚实），但缺口本身既不落库也无处可看，
  // 用户侧只见 estimatedHours 而不知自述预算被吃掉多少。
  const capacityDeficit: CapacityDeficitReport | null = (() => {
    if (targetMilestones === null || estimatedHoursTotal === null) return null;
    // 课数上界：沿用 `subtasksPerStageRange[1]`（容量扩容分支已按需抬到 ≤30）。
    // 注意：**这里不再对课数封 30**——扩容块已经把上界压到 30 以内，再封一次是恒等的；
    // 真正需要显式封顶的只有扩容块内部那个 `Math.min(30, ...)`。
    const lessonCountCap = subtasksPerStageRange[1];
    // 单课分钟上界：**必须与 targetHoursPerMilestone 的钳制口径逐字一致**（都用
    // `subtaskMinutesRange[1]`，不再额外封 90）。否则报告的容量上界会和锚脱节：
    // 用户单次坐姿只支持 30 分钟时写"上界 90 分钟"，等于把"一节课上不完"的约束瞒报。
    const lessonMinutesCap = subtaskMinutesRange[1];
    const capacityHours = (lessonCountCap * lessonMinutesCap * targetMilestones) / 60;
    const deficitRatio = 1 - capacityHours / estimatedHoursTotal;
    if (!(deficitRatio > 0.05)) return null; // 装得下（或只差一点点）→ 无需声明
    // 瓶颈来源：分别把每道上界抬到能装下所需的量，看哪个最先触顶（倍数最小者）。
    // 三个"所需上界"都以**另外两道保持现状**为前提，故只反映"单靠这一道能不能补救"。
    const needCount = (estimatedHoursTotal * 60) / (lessonMinutesCap * targetMilestones);
    const needMinutes = (estimatedHoursTotal * 60) / (lessonCountCap * targetMilestones);
    // 判据与 ReplanAdvisoryService 的「缺口深度」不同义，这里纯粹是容量补救路径排序：
    // 能补救的那道就是瓶颈。三者都补救不了时不谎称某个是唯一原因——标为 milestone_count
    // 只是"相对最可能的一档"，故 bounds 里同时给出三道现值供人工判断。
    const limitingFactor: CapacityDeficitReport['limitingFactor'] =
      needCount <= 1.0001
        ? 'lesson_count'
        : needMinutes <= 1.0001
          ? 'lesson_minutes'
          : 'milestone_count';
    return {
      requestedHours: Math.round(estimatedHoursTotal * 10) / 10,
      capacityHours: Math.round(capacityHours * 10) / 10,
      deficitRatio: Math.round(deficitRatio * 1000) / 1000,
      limitingFactor,
      bounds: {
        subtasksPerStage: lessonCountCap,
        subtaskMinutes: lessonMinutesCap,
        milestones: targetMilestones,
      },
    };
  })();
  // 缺口留痕由 `capacityDeficit` 随 hints 落库承担：本文件是**纯函数层**（被 coordinator / learning.service
  // 直接调用，无 logger 依赖），不在此处打日志；审计侧读 aiPromptTemplate.normalizedInput.planningHints
  // .capacityDeficit 即可拿到全部口径，不必翻日志。

  return {
    paceSignal,
    scopeSize: scope,
    milestoneRange: effectiveMilestoneRange,
    targetMilestones,
    conceptRange,
    subtasksPerStageRange: effectiveSubtasksPerStageRange,
    targetSubtasksPerStage,
    targetSubtasksForStage: null,
    targetTotalHours,
    targetHoursPerMilestone,
    targetMinutesPerTask,
    capacityDeficit,
    budgetDerivation,
    subtaskMinutesRange,
    maxWeeks,
  };
}

/**
 * 预览用：按**路径生成同一口径**归一「用户确认的大纲」。
 *
 * 返回 plannedMilestones（**建议值**，与 path-planning 的 planningHints.targetMilestones 同源）、
 * milestoneRange（**权威区间**，生成时 LLM 在区间内决定里程碑数）与 stages（原始阶段，不再正则删减）。
 *
 * 背景（走查 P7）：预览与生成必须同源。方案乙把口径从"精确相等"放宽为"区间内"，
 * 因此确认卡应展示区间（而非承诺一个精确数）。
 */
export function derivePlannedOutline(confirmedProposal: any): {
  plannedMilestones: number | null;
  milestoneRange: [number, number] | null;
  stages: string[];
} {
  const stages = normalizeStringArray(
    confirmedProposal?.key_stages ?? confirmedProposal?.keyStages
  );
  const scopeSize = normalizeScopeSize(
    confirmedProposal?.scope_size ?? confirmedProposal?.scopeSize
  );
  // targetMilestones 只由「阶段数 + scope_size」决定，其余入参不影响计数
  const hints = derivePlanningHints(null, null, null, null, stages, null, scopeSize);
  const planned = typeof hints?.targetMilestones === 'number' ? hints.targetMilestones : null;
  const hasSignal = stages.length > 0 || scopeSize !== null;
  const range = hasSignal && Array.isArray(hints?.milestoneRange) && hints.milestoneRange.length === 2
    ? ([hints.milestoneRange[0], hints.milestoneRange[1]] as [number, number])
    : null;
  return { plannedMilestones: planned, milestoneRange: range, stages };
}

/**
 * 把任意结构的 normalizedInput 做确定性清洗并附加 planningHints。
 * 原 skill 的 LLM 环节被证明信息零增量（seed 覆盖模型输出），此处即其确定性替代。
 * 输入缺字段保持缺失，不猜测、不扩写。
 */
/**
 * 透传 + 归一化（2026-09-22）。
 *
 * 背景：本函数原先对 resources / successCriteria 做**白名单重建**（不展开原对象），
 * 导致任何未声明的字段被静默裁掉 —— `resources.materials` 就是这样丢掉资料的
 * （下游 path.coordinator 只好"定帧后再挂一次"打补丁），排查花了 3 轮实验。
 * 现在语义改为：**先原样透传，再用归一化值覆盖已知字段**；未声明的键保留并打一条留痕日志
 * （静默裁剪必须可观测——与 stage-hints-clamp 同一个教训）。
 */
function passThroughFramedFields(
  raw: Record<string, any> | null | undefined,
  normalized: Record<string, any>
): Record<string, any> {
  const base = raw && typeof raw === 'object' ? raw : {};
  const passthroughKeys = Object.keys(base).filter((key) => !(key in normalized));
  if (passthroughKeys.length > 0) {
    console.warn(`[path-framing] 未声明字段原样透传（不再裁剪）：${passthroughKeys.join(', ')}`);
  }
  return { ...base, ...normalized };
}

export function buildFramedNormalizedInput(input: any): any {
  if (!input || typeof input !== 'object') return null;

  const learnerProfile = input.learnerProfile && typeof input.learnerProfile === 'object'
    ? input.learnerProfile
    : {};
  const problemSpace = input.problemSpace && typeof input.problemSpace === 'object'
    ? input.problemSpace
    : {};
  const confirmedProposal = input.confirmedProposal && typeof input.confirmedProposal === 'object'
    ? input.confirmedProposal
    : null;
  const resources = input.resources && typeof input.resources === 'object'
    ? input.resources
    : {};

  const surfaceGoal = normalizeString(learnerProfile.surfaceGoal);
  const explicitProblem = normalizeString(problemSpace.realProblem);
  // 方案乙：不再用动词前缀黑名单静默删阶段（"学习/设计/分析/梳理…"开头的阶段会被误删，
  // 实测把"设计…固定动作"这类真阶段删掉）。"哪些算认知阶段"是语义判断，交给 LLM：
  // goal 提示词给约束，path-planning 可自行合并/拆分里程碑。
  const keyStages = normalizeStringArray(confirmedProposal?.keyStages);
  const scopeSize = normalizeScopeSize(confirmedProposal?.scopeSize ?? confirmedProposal?.scope_size);
  const timeBudget = normalizeString(resources.timeBudget) || normalizeString(resources.timePerWeek);
  const timeBudgetCadence = normalizeCadence(resources.timeBudgetCadence);
  const timePerSession = normalizeString(resources.timePerSession);
  const timeHorizon = normalizeString(resources.timeHorizon);
  const timeDimensions = input.timeDimensions && typeof input.timeDimensions === 'object'
    ? input.timeDimensions
    : null;
  // 可选负荷信号：仅当调用方显式在 normalizedInput 上提供 learnerLoadProfile 时才影响推导，
  // 缺失（真实用户现有链路）时与今天完全一致。
  const learnerLoadProfile = input.learnerLoadProfile && typeof input.learnerLoadProfile === 'object'
    ? input.learnerLoadProfile
    : null;
  // 可选分流判定（Goal 层产出）：仅当显式提供时收紧体量上界，缺失时行为与今天完全一致。
  const triage = input.triage && typeof input.triage === 'object'
    ? (input.triage as TriageHint)
    : null;
  const planningHints = derivePlanningHints(timeHorizon, timePerSession, timeBudget, timeBudgetCadence, keyStages, timeDimensions, scopeSize, learnerLoadProfile, triage);

  return {
    ...input,
    version: typeof input.version === 'string' ? input.version : '1.0',
    learnerProfile: {
      ...learnerProfile,
      surfaceGoal,
      currentBaseline: {
        level: normalizePathDifficulty(learnerProfile.currentBaseline?.level),
        evidence: normalizeString(learnerProfile.currentBaseline?.evidence),
      },
      motivation: normalizeString(learnerProfile.motivation),
      urgency: normalizeString(learnerProfile.urgency),
      backgroundExperience: normalizeString(learnerProfile.backgroundExperience),
      painPoints: normalizeStringArray(learnerProfile.painPoints),
      learningSignal: normalizeString(learnerProfile.learningSignal),
      goalOrientation: normalizeString(learnerProfile.goalOrientation),
      constraintsAndBoundaries: normalizeStringArray(learnerProfile.constraintsAndBoundaries),
    },
    problemSpace: {
      ...problemSpace,
      realProblem: explicitProblem,
      scenario: normalizeString(problemSpace.scenario),
      currentPainPoint: normalizeString(problemSpace.currentPainPoint),
    },
    resources: passThroughFramedFields(resources, {
      timeBudget,
      timeBudgetCadence,
      timePerWeek: normalizeString(resources.timePerWeek) || timeBudget,
      timePerSession,
      timeHorizon,
      deadlineText: normalizeString(resources.deadlineText),
    }),
    successCriteria: passThroughFramedFields(input.successCriteria, {
      observableResult: normalizeString(input.successCriteria?.observableResult),
      acceptanceCheck: normalizeString(input.successCriteria?.acceptanceCheck),
    }),
    confirmedProposal: confirmedProposal
      ? {
          learningDirection: normalizeString(confirmedProposal.learningDirection),
          firstDeliverable: normalizeString(confirmedProposal.firstDeliverable),
          keyStages,
          outOfScope: normalizeStringArray(confirmedProposal.outOfScope),
          scopeSize: normalizeScopeSize(confirmedProposal.scopeSize ?? confirmedProposal.scope_size),
        }
      : null,
    timeDimensions,
    planningHints,
  };
}
