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
}

export function derivePlanningHints(
  timeHorizon: string | null,
  timePerSession: string | null,
  timeBudget: string | null,
  timeBudgetCadence: TimeBudgetCadence | null,
  keyStages: string[]
): PlanningHints {
  const paceSignal = inferPaceSignal(timeHorizon);
  const keyStageCount = keyStages.length;
  const paceConfig = paceSignalRangeConfig[paceSignal];

  let milestoneRange: [number, number] = [...paceConfig.milestoneRange];
  let conceptRange: [number, number] = [...paceConfig.conceptRange];
  let subtasksPerStageRange: [number, number] = [...paceConfig.subtasksPerStageRange];
  const defaultMinutesRange: [number, number] = [...paceConfig.defaultMinutesRange];
  const maxWeeks: number = paceConfig.maxWeeks;

  if (keyStageCount > 0) {
    milestoneRange = [keyStageCount, keyStageCount + 2];
  }

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

  return {
    paceSignal,
    milestoneRange,
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
  const planningHints = derivePlanningHints(timeHorizon, timePerSession, timeBudget, timeBudgetCadence, keyStages);

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
    planningHints,
  };
}
