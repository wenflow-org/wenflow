export type GoalPathTimeBudgetCadence = 'per_day' | 'per_week' | 'per_session' | 'flexible' | 'unclear';

/**
 * 技能性质（goal 层 understanding.skill_nature）：决定 AI 能不能替学习者代跑核心动作。
 * 见 prompts/core/goal-conversation.yaml 同名规则。
 */
export type SkillNature = 'tool_operation' | 'internalized_skill' | 'knowledge_structure';

import type { MaterialNeed } from '../../skills/material-collector/types';
import { normalizeDeadlineDate } from './deadline-date';

export interface GoalPathVisibleSummary {
  surfaceGoal: string | null;
  realProblem: string | null;
  motivation: string | null;
  urgency: string | null;
  backgroundExperience: string | null;
  learningSignal: string | null;
  goalOrientation: string | null;
  painPoints: string[];
  constraintsAndBoundaries: string[];
  scenario: string | null;
  currentPainPoint: string | null;
  currentBaseline: {
    level: string | null;
    evidence: string | null;
  } | null;
  resources: {
    timeBudget: string | null;
    timeBudgetCadence: GoalPathTimeBudgetCadence | null;
    timePerWeek: string | null;
    timePerSession: string | null;
    timeHorizon: string | null;
    deadlineText: string | null;
    /**
     * 绝对日期（P0.1，TIME-TRUST-SCHEME-20261001）：goal 对话模型解析出的外部截止锚
     * （understanding.deadline_date，YYYY-MM-DD）。可空；path.coordinator 以此优先于正则启发式。
     */
    deadlineDate: string | null;
  } | null;
  /**
   * 校内锚（2026-09-30，LLM 抽取替代正则）：学习者身处某套教材/考试体系时，由 goal-conversation
   * 的 understanding.school_anchor 产出（模型自己的判断，不靠正则匹配关键词）。
   * textbook=教材册次/单元、examScope=考试范围、schoolPace=学校进度；非校内学习者该字段为 null。
   */
  schoolAnchor: {
    textbook: string | null;
    examScope: string | null;
    schoolPace: string | null;
  } | null;
  /** LLM 推断的时间维度数值（totalWeeks/estimatedHours/sessionsPerWeek/sessionsLengthMin） */
  timeDimensions: {
    totalWeeks?: number | null;
    estimatedHours?: number | null;
    sessionsPerWeek?: number | null;
    sessionsLengthMin?: number | null;
    /** 课次锚（体量 = totalSessions × sessionsLengthMin） */
    totalSessions?: number | null;
    /**
     * 日历容量上限（2026-10-26 解耦，goal 层新字段）：周期天数 × 每日可用分钟 / 60。
     * 只用于识别「预算来自日历乘法」，不参与体量计算。
     */
    calendarCapacityHours?: number | null;
  } | null;
  /**
   * 外部权威资料需求（hidden，goal→path 资料采集缝）。
   * 由 goal-conversation 产出、随 collectedData.understanding.needsMaterial 落库；
   * 白名单透传后供 path.coordinator 调 material-collector 采集（未声明则为 null）。
   */
  needsMaterial?: MaterialNeed | MaterialNeed[] | null;
  /**
   * 技能性质（hidden，goal→path 教学策略缝，2026-10-26 外部评审实证）。
   * 决定「AI 能否替学习者代跑核心动作」：工具操作型可以，内化训练型绝对不行
   * （实证：英语长难句路径让 AI 代跑拆句，学习者到独立阅读照样懵）。
   * 未声明 = null，下游按通用口径处理，不强制任何一档。
   */
  skillNature?: SkillNature | null;
  skillNatureEvidence?: string | null;
  successCriteria: {
    observableResult: string | null;
    acceptanceCheck: string | null;
  } | null;
  confirmedProposal: {
    learningDirection: string | null;
    firstDeliverable: string | null;
    keyStages: string[];
    outOfScope: string[];
    scopeSize: string | null;
  } | null;
}

function normalizeString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter((item): item is string => !!item);
  }

  const singleValue = normalizeString(value);
  return singleValue ? [singleValue] : [];
}

export function inferTimeBudgetCadence(value: any): GoalPathTimeBudgetCadence | null {
  const text = normalizeString(value);
  if (!text) return null;

  if (/(有空|看情况|不固定|灵活|碎片时间)/.test(text)) {
    return 'flexible';
  }

  if (/(每次|单次|一节|一回|一轮)/.test(text)) {
    return 'per_session';
  }

  if (/(每周|一周|每星期|每礼拜|周末)/.test(text)) {
    return 'per_week';
  }

  if (/(每天|每日|每一天|每晚|每天可用|每天能拿出)/.test(text)) {
    return 'per_day';
  }

  return 'unclear';
}

function normalizeNeedsMaterial(value: any): MaterialNeed | MaterialNeed[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is MaterialNeed => !!item && typeof item === 'object' && !!normalizeString(item.title)
    );
    return items.length > 0 ? items : null;
  }
  return typeof value === 'object' && normalizeString(value.title) ? (value as MaterialNeed) : null;
}

/**
 * 绝对日期归一化（P0.1）现驻 `./deadline-date`（独立小模块，见该文件头注释）；此处按原位再导出，
 * 保持「visible-summary 是 goal→path 摘要口径的家」的调用习惯。
 */
export { normalizeDeadlineDate } from './deadline-date';

function buildCurrentBaseline(understanding: any) {
  const currentBaseline = understanding?.current_baseline;
  const level = normalizeString(currentBaseline?.level) || normalizeString(understanding?.background?.current_level);
  const evidence = normalizeString(currentBaseline?.evidence);

  if (!level && !evidence) return null;

  return {
    level,
    evidence,
  };
}

function buildBackgroundExperience(understanding: any): string | null {
  const rawValue = understanding?.background_experience;
  if (Array.isArray(rawValue)) {
    const items = normalizeStringArray(rawValue);
    return items.length > 0 ? items.join('；') : null;
  }
  return normalizeString(rawValue);
}

function buildScenario(understanding: any, backgroundExperience: string | null, realProblem: string | null): string | null {
  return normalizeString(understanding?.recent_failure_scenario)
    || normalizeString(understanding?.recent_failure_context)
    || normalizeString(understanding?.scenario)
    || backgroundExperience
    || realProblem
    || null;
}

export function buildGoalPathVisibleSummary(params: {
  understanding?: any;
  confirmedProposal?: any;
  collected?: any;
}): GoalPathVisibleSummary {
  const understanding = params.understanding || {};
  const confirmedProposal = params.confirmedProposal || {};
  const collected = params.collected || {};

  const surfaceGoal = normalizeString(understanding?.surface_goal);
  const realProblem = normalizeString(understanding?.real_problem);
  const backgroundExperience = buildBackgroundExperience(understanding);
  const painPoints = normalizeStringArray(understanding?.pain_points);
  const constraintsAndBoundaries = normalizeStringArray(understanding?.constraints_and_boundaries);
  const currentPainPoint = normalizeString(understanding?.current_pain_point) || painPoints[0] || null;
  const timeBudget = normalizeString(understanding?.available_resources?.time_budget)
    || normalizeString(understanding?.background?.available_time)
    || normalizeString(collected?.timePerDay)
    || null;
  const timeBudgetCadence = inferTimeBudgetCadence(timeBudget);
  const timePerSession = normalizeString(understanding?.available_resources?.time_per_session)
    || normalizeString(collected?.timePerSession)
    || (timeBudgetCadence === 'per_session' ? timeBudget : null);
  const timeHorizon = normalizeString(understanding?.available_resources?.time_horizon);
  const deadlineText = normalizeString(understanding?.deadline_text);
  // P0.1：模型解析出的绝对日期（understanding.deadline_date）。可空；相对表述不会进这里。
  const deadlineDate = normalizeDeadlineDate(understanding?.deadline_date);
  const timeDimensions = buildTimeDimensions(understanding?.time_dimensions);
  const scenario = buildScenario(understanding, backgroundExperience, realProblem);
  const currentBaseline = buildCurrentBaseline(understanding);
  const needsMaterial = normalizeNeedsMaterial(understanding?.needsMaterial);
  const schoolAnchor = normalizeSchoolAnchorShape(understanding?.school_anchor);
  const skillNature = normalizeSkillNature(understanding?.skill_nature);
  const skillNatureEvidence = normalizeString(understanding?.skill_nature_evidence) || null;

  const hasResources = !!(timeBudget || timePerSession || timeHorizon || deadlineText || deadlineDate);
  const observableResult = normalizeString(understanding?.success_criteria?.observable_result);
  const acceptanceCheck = normalizeString(understanding?.success_criteria?.acceptance_check);
  const learningDirection = normalizeString(confirmedProposal?.learning_direction);
  const firstDeliverable = normalizeString(confirmedProposal?.first_deliverable);
  const keyStages = normalizeStringArray(confirmedProposal?.key_stages);
  const outOfScope = normalizeStringArray(confirmedProposal?.out_of_scope);
  const scopeSize = normalizeString(confirmedProposal?.scope_size);

  return {
    surfaceGoal,
    schoolAnchor,
    realProblem,
    motivation: normalizeString(understanding?.motivation),
    urgency: normalizeString(understanding?.urgency),
    backgroundExperience,
    learningSignal: normalizeString(understanding?.learning_signal),
    goalOrientation: normalizeString(understanding?.goal_orientation),
    painPoints,
    constraintsAndBoundaries,
    scenario,
    currentPainPoint,
    currentBaseline,
    resources: hasResources
      ? {
          timeBudget,
          timeBudgetCadence,
          timePerWeek: timeBudget,
          timePerSession,
          timeHorizon,
          deadlineText,
          deadlineDate,
        }
      : null,
    successCriteria: observableResult || acceptanceCheck
      ? {
          observableResult,
          acceptanceCheck,
        }
      : null,
    confirmedProposal: learningDirection || firstDeliverable || keyStages.length > 0 || outOfScope.length > 0 || scopeSize
      ? {
          learningDirection,
          firstDeliverable,
          keyStages,
          outOfScope,
          scopeSize,
        }
      : null,
    timeDimensions,
    needsMaterial,
    skillNature,
    skillNatureEvidence,
  };
}

/** LLM 推断的时间维度数值（goal 层 time_dimensions）：数值型钳制，非法/缺失给 null */
function buildTimeDimensions(raw: unknown): NonNullable<GoalPathVisibleSummary['timeDimensions']> {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  const result = {
    totalWeeks: num(r.totalWeeks),
    estimatedHours: num(r.estimatedHours),
    sessionsPerWeek: num(r.sessionsPerWeek),
    sessionsLengthMin: num(r.sessionsLengthMin),
    // 课次锚（2026-09-21）：体量 = totalSessions × sessionsLengthMin。
    // 让 LLM 估"总学时"产出率只有 10%，估"几节课"才估得动。
    totalSessions: num(r.totalSessions),
    // 日历容量（2026-10-26 解耦）：周期天数 × 每日可用分钟 / 60。仅用于识别
    // 「预算来自日历乘法」并降级，不参与体量计算本身。
    calendarCapacityHours: num(r.calendarCapacityHours),
  };
  return Object.values(result).some((v) => v !== null) ? result : null;
}

/** 校内锚形状归一化（LLM 产出口径）：三项都可空，但至少一项有值；否则按无锚处理（不编造） */
export function normalizeSchoolAnchorShape(raw: any): GoalPathVisibleSummary['schoolAnchor'] {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  const textbook = str(raw.textbook);
  const examScope = str(raw.examScope);
  const schoolPace = str(raw.schoolPace);
  if (!textbook && !examScope && !schoolPace) return null;
  return { textbook, examScope, schoolPace };
}

/** 技能性质归一化：只认三档枚举，其余（含大小写变体外的脏值）一律 null——不猜测、不降级成默认档 */
export function normalizeSkillNature(raw: unknown): SkillNature | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value === 'tool_operation' || value === 'internalized_skill' || value === 'knowledge_structure'
    ? value
    : null;
}
