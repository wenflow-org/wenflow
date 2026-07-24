import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { paceSignalRangeConfig, timeHorizonPaceMapping, tightBudgetConfig, operationalStagePatterns } from '../../config/pedagogy.config';

export const PATH_SCENE_FRAMING_MAX_TOKENS = 32000;
export const PATH_SCENE_FRAMING_TEMPERATURE = 0.2;

export const PATH_SCENE_FRAMING_PROMPT = `你是一个学习路径输入清洗器。

你的任务不是生成学习路径，也不是补充认知判断，而是把上游已存在的目标信息清洗成一份稳定、统一、可下游直接消费的结构化输入。

输入会包含：
- 原始学习目标 goal
- currentLevel
- timePerDay
- normalizedInput（如果上游已经做过结构化归一化，这里会作为高优先级种子输入）
- structuredData
- confirmedProposal
- metadata

清洗原则：
1. 只做字段收敛、命名统一、缺失保留，不做推理扩写。
2. 不要重新解释用户的真实问题，不要补动机，不要补风险，不要补认知域。
3. 输入里没有的信息，输出中保留为 null、空数组或空对象，不要猜。
4. confirmedProposal 是已确认信息，直接结构化保留，不要改写语义。
4.1 learnerProfile.surfaceGoal 与 problemSpace.realProblem 是两种不同信息：surfaceGoal 保留用户原话，realProblem 保留上游已经形成的诊断结论，不要互相覆盖。
4.2 如果 problemSpace.realProblem 缺失，就保持缺失，不要用 learnerProfile.surfaceGoal 自动补齐，更不要把用户原话伪装成诊断结论。
4.3 problemSpace.realProblem 优先描述用户当前卡住的具体矛盾或阻塞，不要复述成任务计划，也不要只是把 surfaceGoal 换一种说法重写。
4.4 problemSpace.realProblem 不允许写成“第1步/先做A再做B/梳理-提炼-整合”这类步骤句。
4.5 如果上游已经明确给出 backgroundExperience、painPoints、learningSignal、constraintsAndBoundaries、scenario、currentPainPoint，请直接保留为结构化字段，不要丢失，也不要改写成更抽象的泛化说法。
5. 不要在 normalizedInput 中输出 source、mode 这类编排控制字段。
6. confirmedProposal.keyStages 只保留高层阶段提示，不要原样回声任务步骤句。
6.1 如果上游 keyStages 更像执行步骤、检查清单、动作链、梳理/提炼/整合式操作语句，不要把它们继续放在 keyStages，留空数组即可。
6.2 keyStages 是给 path 提供阶段方向提示，不是给隐藏概念层提供命名素材。
6.3 你还需要根据 timeHorizon、timeBudget、timeBudgetCadence、timePerSession、confirmedProposal.keyStages 的信息，为下游 skill:path-planning 与 stage-designer 推算一份 planningHints。planningHints 是节奏建议，不是新增事实。
6.4 planningHints 的推算目标是：让不同时间窗口下的阶段数、概念数、每阶段任务数更匹配，而不是所有路径都写死成同一个节奏。
6.5 planningHints.paceSignal 只能是 compact|standard|extended：
- compact：通常对应 半天 / 1天 / 2天 这类短时窗口
- standard：通常对应 3-7天 / 1-2周 这类中等窗口
- extended：通常对应 1个月+ / 未明确 / 更长周期
6.6 planningHints.milestoneRange、conceptRange、subtasksPerStageRange、subtaskMinutesRange 都是建议范围，不是用户显式提供的事实；请根据输入给出合理范围。
6.7 timeBudget / timeBudgetCadence 表示用户平时能投入多少学习预算；timeHorizon / deadlineText 表示整体时间窗口或完成窗口。不要把投入预算误写成 timeHorizon，也不要把 timeHorizon 误写成 timeBudget。
7. 只输出 1 个 JSON 对象，不要输出 markdown，不要输出解释。

请输出：
{
  "normalizedInput": {
    "version": "1.0",
    "learnerProfile": {
      "surfaceGoal": "",
      "currentBaseline": {
        "level": null,
        "evidence": null
      },
      "motivation": null,
      "urgency": null,
      "backgroundExperience": null,
      "painPoints": [],
      "learningSignal": null,
      "constraintsAndBoundaries": []
    },
    "problemSpace": {
      "realProblem": "",
      "scenario": null,
      "currentPainPoint": null
    },
    "resources": {
      "timeBudget": null,
      "timeBudgetCadence": null,
      "timePerWeek": null,
      "timePerSession": null,
      "timeHorizon": null,
      "deadlineText": null
    },
    "successCriteria": {
      "observableResult": null,
      "acceptanceCheck": null
    },
    "confirmedProposal": {
      "learningDirection": null,
      "firstDeliverable": null,
      "keyStages": [],
      "outOfScope": []
    },
    "planningHints": {
      "paceSignal": "standard",
      "milestoneRange": [3, 5],
      "conceptRange": [2, 4],
      "subtasksPerStageRange": [3, 5],
      "subtaskMinutesRange": [30, 90],
      "maxWeeks": 8
    }
  }
}`;

export const pathSceneFramingDefinition: SkillDefinition = {
  name: 'path-scene-framing',
  version: '1.0.0',
  category: 'analysis',
  description: '为学习路径生成前统一清洗输入结构',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', required: true },
      currentLevel: { type: 'string' },
      timePerDay: { type: 'string' },
      normalizedInput: { type: 'object' },
      structuredData: { type: 'object' },
      confirmedProposal: { type: 'object' },
      metadata: { type: 'object' },
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      normalizedInput: { type: 'object' },
    }
  },
  capabilities: ['path-input-normalization', 'path-input-cleaning'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

export interface PathSceneFramingInput {
  goal: string;
  currentLevel?: string;
  timePerDay?: string;
  normalizedInput?: any;
  structuredData?: any;
  confirmedProposal?: any;
  metadata?: any;
}

function normalizeString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => !!item);
}

function isOperationalStageLike(value: string | null): boolean {
  if (!value) return false;
  const prefixPattern = `^(${operationalStagePatterns.verbPrefixes.join('|')})`;
  const matchPattern = `(${operationalStagePatterns.patternMatches.join('|')}|先.+再.+)`;
  return new RegExp(prefixPattern).test(value)
    || new RegExp(matchPattern).test(value);
}

type PlanningPaceSignal = 'compact' | 'standard' | 'extended';

type TimeBudgetCadence = 'per_day' | 'per_week' | 'per_session' | 'flexible' | 'unclear';

function clampRange(value: any, fallback: [number, number], minFloor = 1): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return fallback;
  const start = Math.max(minFloor, Math.round(first));
  const end = Math.max(start, Math.round(second));
  return [start, end];
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

function derivePlanningHints(
  timeHorizon: string | null,
  timePerSession: string | null,
  timeBudget: string | null,
  timeBudgetCadence: TimeBudgetCadence | null,
  keyStages: string[]
) {
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

function normalizeSceneFramingOutput(output: any, payload?: PathSceneFramingInput) {
  if (!output || typeof output !== 'object') return output;

  const seedNormalizedInput = payload?.normalizedInput && typeof payload.normalizedInput === 'object'
    ? payload.normalizedInput
    : payload?.metadata?.normalizedInput && typeof payload.metadata.normalizedInput === 'object'
      ? payload.metadata.normalizedInput
      : {};
  const modelNormalizedInput = output.normalizedInput && typeof output.normalizedInput === 'object'
    ? output.normalizedInput
    : {};
  const normalizedInput = {
    ...seedNormalizedInput,
    ...modelNormalizedInput,
  };
  const learnerProfile = normalizedInput.learnerProfile && typeof normalizedInput.learnerProfile === 'object'
    ? normalizedInput.learnerProfile
    : {};
  const problemSpace = normalizedInput.problemSpace && typeof normalizedInput.problemSpace === 'object'
    ? normalizedInput.problemSpace
    : {};
  const confirmedProposal = normalizedInput.confirmedProposal && typeof normalizedInput.confirmedProposal === 'object'
    ? normalizedInput.confirmedProposal
    : null;
  const surfaceGoal = normalizeString(learnerProfile.surfaceGoal);
  const explicitProblem = normalizeString(problemSpace.realProblem);
  const rawKeyStages = normalizeStringArray(confirmedProposal?.keyStages);
  const keyStages = rawKeyStages.filter((item) => !isOperationalStageLike(item));
  const resources = normalizedInput.resources && typeof normalizedInput.resources === 'object'
    ? normalizedInput.resources
    : {};
  const timeBudget = normalizeString(resources.timeBudget) || normalizeString(resources.timePerWeek);
  const timeBudgetCadence = normalizeCadence(resources.timeBudgetCadence);
  const timePerSession = normalizeString(resources.timePerSession);
  const timeHorizon = normalizeString(resources.timeHorizon);
  const rawPlanningHints = normalizedInput.planningHints && typeof normalizedInput.planningHints === 'object'
    ? normalizedInput.planningHints
    : null;
  const derivedPlanningHints = derivePlanningHints(timeHorizon, timePerSession, timeBudget, timeBudgetCadence, keyStages);

  return {
    normalizedInput: {
      ...normalizedInput,
      learnerProfile: {
        ...learnerProfile,
        surfaceGoal,
        backgroundExperience: normalizeString(learnerProfile.backgroundExperience),
        painPoints: normalizeStringArray(learnerProfile.painPoints),
        motivation: normalizeString(learnerProfile.motivation),
        urgency: normalizeString(learnerProfile.urgency),
        learningSignal: normalizeString(learnerProfile.learningSignal),
        constraintsAndBoundaries: normalizeStringArray(learnerProfile.constraintsAndBoundaries),
        currentBaseline: {
          level: normalizeString(learnerProfile.currentBaseline?.level),
          evidence: normalizeString(learnerProfile.currentBaseline?.evidence),
        },
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
        observableResult: normalizeString(normalizedInput.successCriteria?.observableResult),
        acceptanceCheck: normalizeString(normalizedInput.successCriteria?.acceptanceCheck),
      },
      confirmedProposal: normalizedInput.confirmedProposal && typeof normalizedInput.confirmedProposal === 'object'
        ? {
            learningDirection: normalizeString(confirmedProposal?.learningDirection),
            firstDeliverable: normalizeString(confirmedProposal?.firstDeliverable),
            keyStages,
            outOfScope: normalizeStringArray(confirmedProposal?.outOfScope),
          }
        : null,
      planningHints: {
        paceSignal: rawPlanningHints?.paceSignal === 'compact' || rawPlanningHints?.paceSignal === 'standard' || rawPlanningHints?.paceSignal === 'extended'
          ? rawPlanningHints.paceSignal
          : derivedPlanningHints.paceSignal,
        milestoneRange: clampRange(rawPlanningHints?.milestoneRange, derivedPlanningHints.milestoneRange),
        conceptRange: clampRange(rawPlanningHints?.conceptRange, derivedPlanningHints.conceptRange),
        subtasksPerStageRange: clampRange(rawPlanningHints?.subtasksPerStageRange, derivedPlanningHints.subtasksPerStageRange),
        subtaskMinutesRange: clampRange(rawPlanningHints?.subtaskMinutesRange, derivedPlanningHints.subtaskMinutesRange, 15),
        maxWeeks: Number.isFinite(Number(rawPlanningHints?.maxWeeks)) ? Math.max(1, Math.round(Number(rawPlanningHints.maxWeeks))) : derivedPlanningHints.maxWeeks,
      },
    },
  };
}

export async function pathSceneFraming(
  input: PathSceneFramingInput
): Promise<SkillExecutionResult<any>> {
  try {
    const FRAMING_RUNTIME_CONTRACT = buildDefaultRuntimeContract('path-scene-framing', 'extractor');
    const result = await callPrompt<PathSceneFramingInput, any>({
      agentId: 'skill:path-scene-framing',
      defaultSystemPrompt: PATH_SCENE_FRAMING_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'path-scene-framing' },
      modelDefaults: {
        maxTokens: PATH_SCENE_FRAMING_MAX_TOKENS,
        temperature: PATH_SCENE_FRAMING_TEMPERATURE,
      },
      buildUserPayload: (payload) => ({
        goal: payload.goal,
        currentLevel: payload.currentLevel,
        timePerDay: payload.timePerDay,
        normalizedInput: payload.normalizedInput || null,
        structuredData: payload.structuredData,
        confirmedProposal: payload.confirmedProposal,
        metadata: payload.metadata || {},
      }),
      normalizeOutput: (parsed, payload) => normalizeSceneFramingOutput(parsed, payload),
      mapEnvelope: (output) => adaptToRuntimeEnvelope({
        contract: FRAMING_RUNTIME_CONTRACT,
        artifact: output,
        phase: 'input-framed',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'PATH_SCENE_FRAMING_INVALID');
    }

    return {
      success: true,
      output: {
        ...result.output,
        runtimeEnvelope: result.runtimeEnvelope,
        _debug: {
          rawModelOutput: result.debug.rawModelOutput,
          extractedJson: result.debug.extractedJson,
          userPayload: result.debug.userPayload,
          systemPromptVersion: result.debug.systemPromptVersion,
        },
      },
      duration: result.debug.durationMs,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'PATH_SCENE_FRAMING_FAILED',
        message: error?.message || 'Unknown error'
      },
      duration: 0,
    };
  }
}

export default pathSceneFraming;
