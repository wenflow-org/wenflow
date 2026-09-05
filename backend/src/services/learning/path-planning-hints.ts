/**
 * path 阶段确定性输入定帧层（原 skill:path-scene-framing 的纯函数部分）
 *
 * skill:path-scene-framing 已于 2026-08 移除：其 LLM 环节信息零增量
 * （prompt 禁止扩写、输出被 seed 覆盖），全部确定性逻辑平移到此处，
 * 由 coordinator / learning.service 直接调用。
 */

import { paceSignalRangeConfig, timeHorizonPaceMapping, tightBudgetConfig, operationalStagePatterns } from '../../config/pedagogy.config';

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

function isOperationalStageLike(value: string | null): boolean {
  if (!value) return false;
  const prefixPattern = `^(${operationalStagePatterns.verbPrefixes.join('|')})`;
  const matchPattern = `(${operationalStagePatterns.patternMatches.join('|')}|先.+再.+)`;
  return new RegExp(prefixPattern).test(value)
    || new RegExp(matchPattern).test(value);
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
  if (!timeHorizon) return 'extended';
  return (timeHorizonPaceMapping[timeHorizon] as PlanningPaceSignal) || 'extended';
}

export interface PlanningHints {
  paceSignal: PlanningPaceSignal;
  milestoneRange: [number, number];
  conceptRange: [number, number];
  subtasksPerStageRange: [number, number];
  subtaskMinutesRange: [number, number];
  maxWeeks: number;
  /** 强制里程碑目标数量（由上游 keyStages 数量直接透传，path LLM 必须精确输出该值，不增减） */
  targetMilestones: number | null;
}

export function derivePlanningHints(
  timeHorizon: string | null,
  timePerSession: string | null,
  timeBudget: string | null,
  timeBudgetCadence: TimeBudgetCadence | null,
  keyStages: string[],
  timeDimensions?: { totalWeeks?: number | null; estimatedHours?: number | null; sessionsPerWeek?: number | null; sessionsLengthMin?: number | null } | null
): PlanningHints {
  const paceSignal = inferPaceSignal(timeHorizon);
  const keyStageCount = keyStages.length;
  const paceConfig = paceSignalRangeConfig[paceSignal];

  let milestoneRange: [number, number] = [...paceConfig.milestoneRange];
  let conceptRange: [number, number] = [...paceConfig.conceptRange];
  let subtasksPerStageRange: [number, number] = [...paceConfig.subtasksPerStageRange];
  const defaultMinutesRange: [number, number] = [...paceConfig.defaultMinutesRange];
  // 强制里程碑数量：直接透传上游 keyStages 数量（用户已确认的阶段数），上下限夹取 2-8。
  // 不再依赖 LLM 在区间内自行选值（实测区间总是懒选下限 3-4）。
  const targetMilestones: number | null = keyStageCount > 0
    ? Math.min(8, Math.max(2, keyStageCount))
    : null;
  // maxWeeks：优先用 goal 层 LLM 推断的 totalWeeks（×1.2 缓冲）；
  // 其次用自由文本 time_horizon 的确定性周数兜底（LLM 未产出 totalWeeks 时仍能钳制紧迫场景）；
  // 最后回退 pace 档位固定值，硬上限 52
  const inferredWeeks = Number.isFinite(timeDimensions?.totalWeeks) && (timeDimensions!.totalWeeks as number) > 0
    ? (timeDimensions!.totalWeeks as number)
    : inferMaxWeeksFromTimeHorizon(timeHorizon);
  const maxWeeks: number = inferredWeeks
    ? Math.min(52, Math.max(1, Math.ceil(inferredWeeks * 1.2)))
    : paceConfig.maxWeeks;

  const parsedSessionMinutes = timePerSession && timePerSession.match(/(\d+)/)
    ? Number(timePerSession.match(/(\d+)/)?.[1])
    : null;

  const subtaskMinutesRange: [number, number] = Number.isFinite(parsedSessionMinutes)
    ? [
        Math.max(15, Math.round((parsedSessionMinutes as number) * 0.3)),
        Math.max(30, Math.min(120, Math.round((parsedSessionMinutes as number) * 0.8))),
      ]
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
    }
  }

  // 强制里程碑数量存在时，milestoneRange 同步为精确目标（消除 LLM 区间懒选），保留 pace 默认作为无 target 时的兜底
  const effectiveMilestoneRange: [number, number] = targetMilestones !== null
    ? [targetMilestones, targetMilestones]
    : milestoneRange;

  return {
    paceSignal,
    milestoneRange: effectiveMilestoneRange,
    targetMilestones,
    conceptRange,
    subtasksPerStageRange,
    subtaskMinutesRange,
    maxWeeks,
  };
}

/**
 * 把任意结构的 normalizedInput 做确定性清洗并附加 planningHints。
 * 原 skill 的 LLM 环节被证明信息零增量（seed 覆盖模型输出），此处即其确定性替代。
 * 输入缺字段保持缺失，不猜测、不扩写。
 */
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
  const rawKeyStages = normalizeStringArray(confirmedProposal?.keyStages);
  const keyStages = rawKeyStages.filter((item) => !isOperationalStageLike(item));
  const timeBudget = normalizeString(resources.timeBudget) || normalizeString(resources.timePerWeek);
  const timeBudgetCadence = normalizeCadence(resources.timeBudgetCadence);
  const timePerSession = normalizeString(resources.timePerSession);
  const timeHorizon = normalizeString(resources.timeHorizon);
  const timeDimensions = input.timeDimensions && typeof input.timeDimensions === 'object'
    ? input.timeDimensions
    : null;
  const planningHints = derivePlanningHints(timeHorizon, timePerSession, timeBudget, timeBudgetCadence, keyStages, timeDimensions);

  return {
    ...input,
    version: typeof input.version === 'string' ? input.version : '1.0',
    learnerProfile: {
      ...learnerProfile,
      surfaceGoal,
      currentBaseline: {
        level: normalizeString(learnerProfile.currentBaseline?.level),
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
    resources: {
      timeBudget,
      timeBudgetCadence,
      timePerWeek: normalizeString(resources.timePerWeek) || timeBudget,
      timePerSession,
      timeHorizon,
      deadlineText: normalizeString(resources.deadlineText),
    },
    successCriteria: {
      observableResult: normalizeString(input.successCriteria?.observableResult),
      acceptanceCheck: normalizeString(input.successCriteria?.acceptanceCheck),
    },
    confirmedProposal: confirmedProposal
      ? {
          learningDirection: normalizeString(confirmedProposal.learningDirection),
          firstDeliverable: normalizeString(confirmedProposal.firstDeliverable),
          keyStages,
          outOfScope: normalizeStringArray(confirmedProposal.outOfScope),
        }
      : null,
    timeDimensions,
    planningHints,
  };
}
