export type GoalPathTimeBudgetCadence = 'per_day' | 'per_week' | 'per_session' | 'flexible' | 'unclear';

/**
 * 技能性质（goal 层 understanding.skill_nature）：决定 AI 能不能替学习者代跑核心动作，
 * 以及**平台能不能判定核心动作做对了**。见 prompts/core/goal-conversation.yaml 同名规则。
 *
 * 2026-10-26 二拆（用户纠偏「乐器、运动…不能指导去具体画画什么的」）：
 * 原 `internalized_skill` 把「英语拆句」和「吉他弹唱」混成一档，但两者的可判定性完全不同——
 * 拆句的产出（哪句是主干、插入段挂在哪）学习者能交出来，平台能对照；
 * 弹琴的手型/音色平台看不到、听不到，只能逼出「写一张自查卡」这种假验收。
 *
 * 四档：
 *   - tool_operation        工具操作（Excel/SQL/Python/Git/剪辑）：可代跑繁琐部分
 *   - cognitive_internalized 认知内化（拆句/推导/写作/口语）：核心动作本人做，**产出物可判**
 *   - physical_internalized  身体内化（乐器/美术/运动/发音/舞蹈）：核心动作本人做，**平台判不了动作质量**
 *   - knowledge_structure    知识建构（学科体系/理论脉络/概念辨析）：AI 可整理，学习者须自己复述
 *
 * 兼容：历史行里的 `internalized_skill` 归一为 `cognitive_internalized`（保守档——
 * 至少不会因为分类变更而把可判定路径降级成不可判定）。
 */
export type SkillNature =
  | 'tool_operation'
  | 'cognitive_internalized'
  | 'physical_internalized'
  | 'knowledge_structure';

/**
 * 平台可判定性（见 GoalPathVisibleSummary.platformJudgment 注释）。
 */
export type PlatformJudgment = 'judgeable_output' | 'judgeable_sensor' | 'not_judgeable';

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
  /**
   * 平台可判定性（hidden，2026-10-26 用户纠偏「乐器、运动…不能指导去具体画画」）。
   *
   * 与 skillNature 分工：skillNature 回答「AI 能不能代跑」，本字段回答
   * 「平台能不能判断学习者做对了」。两者可以不一致——吉他弹唱是本人练（不能代跑），
   * 平台也判不了（不能验收）。
   *
   * 取值：
   *   - judgeable_output    核心动作的**产出物**可提交、可对照（拆句结果、推导过程、代码、表格、文字稿）
   *   - judgeable_sensor    核心动作发生在身体上，但有**客观读数**可判（功率计、心率带、配速、录音波形、体脂秤）
   *   - not_judgeable       核心动作发生在身体/手上，平台既看不到也读不到（手型、音色、笔触、舞姿）
   *
   * 这个字段决定任务形态：not_judgeable 时，平台只能做「训练计划 + 复盘归因」，
   * **不得**编造「自查卡/对照表」假装可判定（实证：吉他 81 任务里 27 条验收写「能说出」，
   * 把身体技能降级成口头描述，学习者练不到手，平台也没真判到）。
   */
  platformJudgment?: PlatformJudgment | null;
  /** 可判定性判据（一句，说明凭什么这么判；如「有功率计读数」/「只能靠自述」） */
  platformJudgmentEvidence?: string | null;
  /**
   * 客观读数来源（judgeable_sensor 时填，如「功率计」「心率带」「录音」「配速表」）。
   * 无传感器时为空——下游据此决定能不能把身体动作转成可判数据。
   */
  sensorReadouts?: string[] | null;
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
  const platformJudgment = normalizePlatformJudgment(understanding?.platform_judgment);
  const platformJudgmentEvidence = normalizeString(understanding?.platform_judgment_evidence) || null;
  const sensorReadouts = Array.isArray(understanding?.sensor_readouts)
    ? (understanding.sensor_readouts as unknown[])
        .map((v) => normalizeString(v))
        .filter((v): v is string => !!v)
        .slice(0, 8)
    : null;

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
    platformJudgment,
    platformJudgmentEvidence,
    sensorReadouts,
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

/**
 * 技能性质归一化：只认四档枚举，其余（脏值）一律 null——不猜测、不降级成默认档。
 * 历史兼容：旧档 `internalized_skill` 归一为 `cognitive_internalized`（保守方向——
 * 旧数据没有「身体内化」的信息，不能凭空降级成不可判定）。
 */
export function normalizeSkillNature(raw: unknown): SkillNature | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === 'internalized_skill') return 'cognitive_internalized';
  return value === 'tool_operation'
    || value === 'cognitive_internalized'
    || value === 'physical_internalized'
    || value === 'knowledge_structure'
    ? value
    : null;
}

/** 平台可判定性归一化：只认三档，脏值 null（不猜测） */
export function normalizePlatformJudgment(raw: unknown): PlatformJudgment | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value === 'judgeable_output' || value === 'judgeable_sensor' || value === 'not_judgeable'
    ? value
    : null;
}
