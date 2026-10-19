/**
 * 学习者可用时间权威（#106）
 *
 * 背景：此前「可用时间」没有单一解析函数——path-planning-hints 自带 40 分钟默认、
 * path.coordinator / requirement.coordinator 各自 `|| 1 小时`、goal-schedule 自带
 * `?? 30`，四处各定各的兜底，改一处不传导。
 *
 * 本文件是唯一权威：
 * - 默认常量只出现在 CAPACITY_DEFAULTS；
 * - 原文解析（含中文数字）只在 parseSessionMinutes；
 * - 优先级只在 resolveCapacity 里定义一次：
 *     L1 understanding.time_dimensions 的数值字段
 *     L2 understanding.available_resources.time_budget / time_per_session
 *     L3 collected.timePerDay
 *     L4 visibleSummary.resources
 *   其余调用方不得再自行拼接兜底。
 *
 * 纯同步纯函数：不读库、不读 env，便于各调用点（含同步推导）复用与单测。
 */

/** 可用时间兜底常量（全仓唯一出处；其他模块不得再自定 30/40/45/5/1 小时） */
export const CAPACITY_DEFAULTS = {
  /** 一次学习的默认时长（分钟） */
  sessionMinutes: 40,
  /** 默认每周学习次数 */
  sessionsPerWeek: 5,
  /** 默认每周学习天数 */
  daysPerWeek: 5,
  /** 默认每日计划分钟（今日日程在目标未配置 plannedMinutesPerDay 时的兜底） */
  dailyMinutes: 30,
  /** 默认展示用可用时间（沿用历史口径） */
  display: '1 小时',
} as const;

export type CapacitySource =
  | 'understanding.time_dimensions'
  | 'understanding.available_resources.time_per_session'
  | 'understanding.available_resources.time_budget'
  | 'visibleSummary.resources.time_per_session'
  | 'visibleSummary.resources'
  | 'collected.timePerDay'
  | 'timePerSession'
  | 'timeBudget'
  | 'default';

export interface CapacityTimeDimensions {
  totalWeeks?: number | null;
  estimatedHours?: number | null;
  sessionsPerWeek?: number | null;
  sessionsLengthMin?: number | null;
  totalSessions?: number | null;
}

export interface CapacityInput {
  /** L1：goal 结构化时间维度（数值优先） */
  timeDimensions?: CapacityTimeDimensions | null;
  /** 扁平输入（调用方已归一；path-planning-hints / path.coordinator 使用） */
  timePerSession?: string | null;
  timeBudget?: string | null;
  timePerDay?: string | null;
  /** 结构化来源（可选）：用于保留 #106 定的优先级与 source 归因 */
  understanding?: {
    available_resources?: { time_budget?: unknown; time_per_session?: unknown } | null;
    background?: { available_time?: unknown } | null;
  } | null;
  collected?: { timePerDay?: unknown } | null;
  visibleSummary?: {
    resources?: { timeBudget?: unknown; timePerWeek?: unknown; timePerSession?: unknown } | null;
  } | null;
}

export interface ResolvedCapacity {
  /** 一次学习的时长（分钟） */
  sessionMinutes: number;
  /** 每周学习次数 */
  sessionsPerWeek: number;
  /** 每周学习天数（1..7） */
  daysPerWeek: number;
  /** 每日可用/计划分钟 */
  dailyMinutes: number;
  /** 展示给提示词/UI 的可用时间文本 */
  display: string;
  /** 本次解析的权威来源 */
  source: CapacitySource;
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 「一次学多久」文本解析（分钟）。支持：
 * 3小时 / 3.5小时 / 三个半小时 / 半小时 / 三十分钟 / 30分钟 / 裸数字（分钟）/ 一个钟头。
 * 解析不出返回 null（由 resolveCapacity 统一兜底）。
 */
export function parseSessionMinutes(value: string | null | undefined): number | null {
  const text = (value || '').trim();
  if (!text) return null;
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
}

function clampDays(value: number): number {
  return Math.min(7, Math.max(1, Math.round(value)));
}

/**
 * 解析可用时间（#106 单一权威）。
 * 优先级：time_dimensions 数值 → understanding 预算/单次时长 → collected.timePerDay
 *        → visibleSummary.resources → 默认值。
 */
export function resolveCapacity(input: CapacityInput = {}): ResolvedCapacity {
  const understandingRes = input.understanding?.available_resources ?? null;
  const understandingBudget = normalizeText(understandingRes?.time_budget)
    ?? normalizeText(input.understanding?.background?.available_time);
  const understandingSession = normalizeText(understandingRes?.time_per_session);
  const collectedTimePerDay = normalizeText(input.collected?.timePerDay) ?? normalizeText(input.timePerDay);
  const visibleRes = input.visibleSummary?.resources ?? null;
  const visibleBudget = normalizeText(visibleRes?.timeBudget) ?? normalizeText(visibleRes?.timePerWeek);
  const visibleSession = normalizeText(visibleRes?.timePerSession);
  // 扁平输入排在结构化输入之后：调用方已把多来源合并成一个值（如 normalizedInputV1.resources）
  const flatBudget = normalizeText(input.timeBudget);
  const flatSession = normalizeText(input.timePerSession);

  const structuredSession = positiveNumber(input.timeDimensions?.sessionsLengthMin);
  const structuredSessionsPerWeek = positiveNumber(input.timeDimensions?.sessionsPerWeek);

  const budgetText = understandingBudget ?? flatBudget ?? collectedTimePerDay ?? visibleBudget;
  const sessionText = understandingSession ?? flatSession ?? visibleSession;
  const parsedSession = parseSessionMinutes(sessionText);

  let source: CapacitySource;
  let sessionMinutes: number;
  if (structuredSession !== null) {
    // L1：结构化数值优先（即使同时存在自由文本）
    sessionMinutes = Math.round(structuredSession);
    source = 'understanding.time_dimensions';
  } else if (parsedSession !== null) {
    sessionMinutes = parsedSession;
    source = understandingSession
      ? 'understanding.available_resources.time_per_session'
      : visibleSession
        ? 'visibleSummary.resources.time_per_session'
        : 'timePerSession';
  } else {
    sessionMinutes = CAPACITY_DEFAULTS.sessionMinutes;
    source = understandingBudget
      ? 'understanding.available_resources.time_budget'
      : flatBudget
        ? 'timeBudget'
        : collectedTimePerDay
          ? 'collected.timePerDay'
          : visibleBudget
            ? 'visibleSummary.resources'
            : 'default';
  }

  const hasSessionSignal = structuredSession !== null || parsedSession !== null;
  const sessionsPerWeek = structuredSessionsPerWeek !== null
    ? Math.max(1, Math.round(structuredSessionsPerWeek))
    : CAPACITY_DEFAULTS.sessionsPerWeek;
  const daysPerWeek = structuredSessionsPerWeek !== null
    ? clampDays(structuredSessionsPerWeek)
    : CAPACITY_DEFAULTS.daysPerWeek;
  // 有单次时长信号时，每日可用 = 一次学习时长（默认一天一次）；否则沿用 30 分钟口径
  const dailyMinutes = hasSessionSignal ? sessionMinutes : CAPACITY_DEFAULTS.dailyMinutes;

  const display = budgetText
    ?? sessionText
    ?? (hasSessionSignal ? `每天 ${dailyMinutes} 分钟` : CAPACITY_DEFAULTS.display);

  return { sessionMinutes, sessionsPerWeek, daysPerWeek, dailyMinutes, display, source };
}
