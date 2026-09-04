export type GoalPathTimeBudgetCadence = 'per_day' | 'per_week' | 'per_session' | 'flexible' | 'unclear';

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
  } | null;
  /** LLM 推断的时间维度数值（totalWeeks/estimatedHours/sessionsPerWeek/sessionsLengthMin） */
  timeDimensions: {
    totalWeeks?: number | null;
    estimatedHours?: number | null;
    sessionsPerWeek?: number | null;
    sessionsLengthMin?: number | null;
  } | null;
  successCriteria: {
    observableResult: string | null;
    acceptanceCheck: string | null;
  } | null;
  confirmedProposal: {
    learningDirection: string | null;
    firstDeliverable: string | null;
    keyStages: string[];
    outOfScope: string[];
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
  const timeDimensions = buildTimeDimensions(understanding?.time_dimensions);
  const scenario = buildScenario(understanding, backgroundExperience, realProblem);
  const currentBaseline = buildCurrentBaseline(understanding);

  const hasResources = !!(timeBudget || timePerSession || timeHorizon || deadlineText);
  const observableResult = normalizeString(understanding?.success_criteria?.observable_result);
  const acceptanceCheck = normalizeString(understanding?.success_criteria?.acceptance_check);
  const learningDirection = normalizeString(confirmedProposal?.learning_direction);
  const firstDeliverable = normalizeString(confirmedProposal?.first_deliverable);
  const keyStages = normalizeStringArray(confirmedProposal?.key_stages);
  const outOfScope = normalizeStringArray(confirmedProposal?.out_of_scope);

  return {
    surfaceGoal,
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
        }
      : null,
    successCriteria: observableResult || acceptanceCheck
      ? {
          observableResult,
          acceptanceCheck,
        }
      : null,
    confirmedProposal: learningDirection || firstDeliverable || keyStages.length > 0 || outOfScope.length > 0
      ? {
          learningDirection,
          firstDeliverable,
          keyStages,
          outOfScope,
        }
      : null,
    timeDimensions,
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
  };
  return Object.values(result).some((v) => v !== null) ? result : null;
}
