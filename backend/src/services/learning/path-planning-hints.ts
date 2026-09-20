/**
 * path 阶段确定性输入定帧层（原 skill:path-scene-framing 的纯函数部分）
 *
 * skill:path-scene-framing 已于 2026-08 移除：其 LLM 环节信息零增量
 * （prompt 禁止扩写、输出被 seed 覆盖），全部确定性逻辑平移到此处，
 * 由 coordinator / learning.service 直接调用。
 */

import { paceSignalRangeConfig, timeHorizonPaceMapping, tightBudgetConfig, operationalStagePatterns } from '../../config/pedagogy.config';
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

function isOperationalStageLike(value: string | null): boolean {
  if (!value) return false;
  const prefixPattern = `^(${operationalStagePatterns.verbPrefixes.join('|')})`;
  const matchPattern = `(${operationalStagePatterns.patternMatches.join('|')}|先.+再.+)`;
  return new RegExp(prefixPattern).test(value)
    || new RegExp(matchPattern).test(value);
}

/** 学习者负荷画像（可选）：可用时间与认知负荷耐受。仅在显式传入时影响推导。 */
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

/** 认知负荷耐受是否极低：能识别"关页面/合电脑/三步以上就放弃/信息一多"这类信号。 */
function isLowLoadToleranceSignal(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(low|very\s*low|低|极低)$/i.test(text)) return true;
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
}

export function derivePlanningHints(
  timeHorizon: string | null,
  timePerSession: string | null,
  timeBudget: string | null,
  timeBudgetCadence: TimeBudgetCadence | null,
  keyStages: string[],
  timeDimensions?: { totalWeeks?: number | null; estimatedHours?: number | null; sessionsPerWeek?: number | null; sessionsLengthMin?: number | null } | null,
  scopeSize?: ScopeSize | null,
  learnerLoadProfile?: LearnerLoadProfile | null
): PlanningHints {
  const paceSignal = inferPaceSignal(timeHorizon);
  const keyStageCount = keyStages.length;
  const paceConfig = paceSignalRangeConfig[paceSignal];

  // 体量与节奏分轴（A′，2026-09-20 修正）：
  //   历史：9-05「里程碑数精确匹配 keyStages」+ 9-14「scope_size 钳制体量」两次都是为了防**膨胀**
  //   （原话："小问题不再被撑成大路径"）；但 scope 判定长期退化成 ~95% small，反过来**压小**——
  //   goal 自己排出 4-6 个阶段却被 min(scopeCap, …) 静默砍成 2~3 个。
  //   现在：scope_size 降级为「下界参考」，计数以 keyStages（用户在确认卡上真正确认过的阶段计划）为准；
  //   上界取「scope 与 pace 中较松者」再压全局硬上限，**保留防膨胀**，同时不让单一退化信号独裁。
  const scope = normalizeScopeSize(scopeSize);
  const scopeConfig = scope ? SCOPE_SIZE_RANGES[scope] : null;

  let milestoneRange: [number, number] = scopeConfig ? [...scopeConfig.milestoneRange] : [...paceConfig.milestoneRange];
  let conceptRange: [number, number] = [...paceConfig.conceptRange];
  const defaultMinutesRange: [number, number] = [...paceConfig.defaultMinutesRange];

  const HARD_MILESTONE_CAP = 8;
  const scopeMilestoneFloor = scopeConfig ? scopeConfig.milestoneRange[0] : 2;
  // micro 是**定义类**（"一个动作/一次判断"，1-2 段）——上下界是定义，不参与放宽；
  // small/medium/large 是**估计类**——允许被 pace 放宽（仍受 pace 上界与硬上限夹），
  // 避免"估小了就被静默砍掉"（实测 4/10 例 scope=small 却排出 4-5 个阶段）。
  const milestoneCap = scope === 'micro'
    ? scopeConfig!.milestoneRange[1]
    : Math.min(
        HARD_MILESTONE_CAP,
        Math.max(
          scopeConfig ? scopeConfig.milestoneRange[1] : HARD_MILESTONE_CAP,
          paceConfig.milestoneRange[1],
        ),
      );
  let targetMilestones: number | null = keyStageCount > 0
    ? Math.min(milestoneCap, Math.max(scopeMilestoneFloor, keyStageCount))
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
  const inferredWeeks = Number.isFinite(timeDimensions?.totalWeeks) && (timeDimensions!.totalWeeks as number) > 0
    ? (timeDimensions!.totalWeeks as number)
    : inferMaxWeeksFromTimeHorizon(timeHorizon);
  let maxWeeks: number = inferredWeeks
    ? Math.min(52, Math.max(1, Math.ceil(inferredWeeks * 1.2)))
    : paceConfig.maxWeeks;

  const parsedSessionMinutes = timePerSession && timePerSession.match(/(\d+)/)
    ? Number(timePerSession.match(/(\d+)/)?.[1])
    : null;

  let subtaskMinutesRange: [number, number] = Number.isFinite(parsedSessionMinutes)
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
      // 里程碑上界 ≤2
      milestoneRange = [Math.min(milestoneRange[0], 2), Math.min(milestoneRange[1], 2)];
      if (targetMilestones !== null) targetMilestones = Math.min(targetMilestones, 2);
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

  // 强制里程碑数量存在时，milestoneRange 同步为精确目标（消除 LLM 区间懒选），保留 pace 默认作为无 target 时的兜底
  const effectiveMilestoneRange: [number, number] = targetMilestones !== null
    ? [targetMilestones, targetMilestones]
    : milestoneRange;

  // 强制每阶段子任务数量：总学时 ÷ 里程碑数 ÷ 每任务约 1 小时 → 每阶段任务目标。
  // 总学时 fallback 链（goal 数值推断产出率极低，必须有多级信号兜底，保证总能算出确定值）：
  //   ① timeDimensions.estimatedHours（goal 直接推断）
  //   ② totalWeeks × sessionsPerWeek × sessionsLengthMin/60（频率×时长×周期推算总小时）
  //   ③ pace 档位中位数（compact→3, standard→4, extended→5）
  const estimatedHoursTotal =
    Number.isFinite(timeDimensions?.estimatedHours) && (timeDimensions!.estimatedHours as number) > 0
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
  // perStage 从总学时反推时，上限必须被 subtasksPerStageRange 钳制：scope_size 是"问题多大"的硬约束，
  // 不能因为 goal 碰巧推断出 estimatedHours 就突破 scope 的任务密度上限（否则 micro/small 又会被撑大）。
  // 下限保持宽松（硬编码 2），允许比 pace 默认更少，不被抬升。
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
  // 学时反推时区间精确化为 [target, target]（沿用旧行为）；
  // 兜底时区间与目标自洽但不塌成单点：下界抬到 ≥2，上界保留 subtasksCap。
  const effectiveSubtasksPerStageRange: [number, number] = targetSubtasksPerStage !== null
    ? (perStageFromHours !== null
        ? [targetSubtasksPerStage, targetSubtasksPerStage]
        : [fallbackPerStage, subtasksCap])
    : subtasksPerStageRange;

  return {
    paceSignal,
    scopeSize: scope,
    milestoneRange: effectiveMilestoneRange,
    targetMilestones,
    conceptRange,
    subtasksPerStageRange: effectiveSubtasksPerStageRange,
    targetSubtasksPerStage,
    subtaskMinutesRange,
    maxWeeks,
  };
}

/**
 * 预览用：按**路径生成同一口径**归一「用户确认的大纲」。
 *
 * 返回 plannedMilestones（与 path-planning 的 planningHints.targetMilestones 同源）
 * 与 stages（已剔除「操作性阶段」，与生成时的清洗一致）。
 *
 * 背景（走查 P7）：目标对话让 LLM 同时给 key_stages（如 4 段）与 scope_size
 * （如 small = 2~3 段），两者可自相矛盾；生成时会被 scope 夹回 3 段，
 * 而预览直接照抄 4 段 ⇒ 承诺 4 段、实际 3 段。这里让预览改用同一计算。
 */
export function derivePlannedOutline(confirmedProposal: any): {
  plannedMilestones: number | null;
  stages: string[];
} {
  const rawKeyStages = normalizeStringArray(
    confirmedProposal?.key_stages ?? confirmedProposal?.keyStages
  );
  const stages = rawKeyStages.filter((item) => !isOperationalStageLike(item));
  const scopeSize = normalizeScopeSize(
    confirmedProposal?.scope_size ?? confirmedProposal?.scopeSize
  );
  // targetMilestones 只由「阶段数 + scope_size」决定，其余入参不影响计数
  const hints = derivePlanningHints(null, null, null, null, stages, null, scopeSize);
  const planned = typeof hints?.targetMilestones === 'number' ? hints.targetMilestones : null;
  return { plannedMilestones: planned, stages };
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
  const planningHints = derivePlanningHints(timeHorizon, timePerSession, timeBudget, timeBudgetCadence, keyStages, timeDimensions, scopeSize, learnerLoadProfile);

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
          scopeSize: normalizeScopeSize(confirmedProposal.scopeSize ?? confirmedProposal.scope_size),
        }
      : null,
    timeDimensions,
    planningHints,
  };
}
