import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';

export const PATH_SCENE_FRAMING_MAX_TOKENS = 32000;
export const PATH_SCENE_FRAMING_TEMPERATURE = 0.2;

export const PATH_SCENE_FRAMING_PROMPT = `你是一个学习路径输入清洗器。

你的任务不是生成学习路径，也不是补充认知判断，而是把上游已存在的目标信息清洗成一份稳定、统一、可下游直接消费的结构化输入。

输入会包含：
- 原始学习目标 goal
- currentLevel
- timePerDay
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
5. 不要在 normalizedInput 中输出 source、mode 这类编排控制字段。
6. confirmedProposal.keyStages 只保留高层阶段提示，不要原样回声任务步骤句。
6.1 如果上游 keyStages 更像执行步骤、检查清单、动作链、梳理/提炼/整合式操作语句，不要把它们继续放在 keyStages，留空数组即可。
6.2 keyStages 是给 path 提供阶段方向提示，不是给隐藏概念层提供命名素材。
6.3 你还需要根据 timeHorizon、timePerSession、confirmedProposal.keyStages 的信息，为下游 path-agent 与 stage-designer 推算一份 planningHints。planningHints 是节奏建议，不是新增事实。
6.4 planningHints 的推算目标是：让不同时间窗口下的阶段数、概念数、每阶段任务数更匹配，而不是所有路径都写死成同一个节奏。
6.5 planningHints.paceSignal 只能是 compact|standard|extended：
- compact：通常对应 半天 / 1天 / 2天 这类短时窗口
- standard：通常对应 3-7天 / 1-2周 这类中等窗口
- extended：通常对应 1个月+ / 未明确 / 更长周期
6.6 planningHints.milestoneRange、conceptRange、subtasksPerStageRange、subtaskMinutesRange 都是建议范围，不是用户显式提供的事实；请根据输入给出合理范围。
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
      "painPoints": [],
      "learningSignal": null
    },
    "problemSpace": {
      "realProblem": "",
      "scenario": null,
      "currentPainPoint": null
    },
    "resources": {
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
  return /^(梳理|提炼|整合|记录|分析|学习|设计|绘制|撰写|汇总|复盘|验证|拆解|总结|产出|模拟|试用)/.test(value)
    || /(3-5个|检查点|清单|试用验证|模拟场景|先.+再.+)/.test(value);
}

type PlanningPaceSignal = 'compact' | 'standard' | 'extended';

function clampRange(value: any, fallback: [number, number], minFloor = 1): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return fallback;
  const start = Math.max(minFloor, Math.round(first));
  const end = Math.max(start, Math.round(second));
  return [start, end];
}

function inferPaceSignal(timeHorizon: string | null): PlanningPaceSignal {
  if (!timeHorizon) return 'extended';
  if (['半天', '1天', '2天'].includes(timeHorizon)) return 'compact';
  if (['3-7天', '1-2周'].includes(timeHorizon)) return 'standard';
  return 'extended';
}

function derivePlanningHints(timeHorizon: string | null, timePerSession: string | null, keyStages: string[]) {
  const paceSignal = inferPaceSignal(timeHorizon);
  const keyStageCount = keyStages.length;

  let milestoneRange: [number, number];
  let conceptRange: [number, number];
  let subtasksPerStageRange: [number, number];
  let defaultMinutesRange: [number, number];
  let maxWeeks: number;

  if (paceSignal === 'compact') {
    milestoneRange = [2, 3];
    conceptRange = [2, 3];
    subtasksPerStageRange = [2, 4];
    defaultMinutesRange = [15, 45];
    maxWeeks = 2;
  } else if (paceSignal === 'standard') {
    milestoneRange = [3, 5];
    conceptRange = [2, 4];
    subtasksPerStageRange = [3, 5];
    defaultMinutesRange = [30, 90];
    maxWeeks = 8;
  } else {
    milestoneRange = [4, 8];
    conceptRange = [3, 5];
    subtasksPerStageRange = [4, 6];
    defaultMinutesRange = [30, 120];
    maxWeeks = 24;
  }

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

  return {
    paceSignal,
    milestoneRange,
    conceptRange,
    subtasksPerStageRange,
    subtaskMinutesRange,
    maxWeeks,
  };
}

function normalizeSceneFramingOutput(output: any) {
  if (!output || typeof output !== 'object') return output;

  const normalizedInput = output.normalizedInput && typeof output.normalizedInput === 'object'
    ? output.normalizedInput
    : {};
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
  const timePerSession = normalizeString(resources.timePerSession);
  const timeHorizon = normalizeString(resources.timeHorizon);
  const rawPlanningHints = normalizedInput.planningHints && typeof normalizedInput.planningHints === 'object'
    ? normalizedInput.planningHints
    : null;
  const derivedPlanningHints = derivePlanningHints(timeHorizon, timePerSession, keyStages);

  return {
    normalizedInput: {
      ...normalizedInput,
      learnerProfile: {
        ...learnerProfile,
        surfaceGoal,
        painPoints: normalizeStringArray(learnerProfile.painPoints),
        motivation: normalizeString(learnerProfile.motivation),
        urgency: normalizeString(learnerProfile.urgency),
        learningSignal: normalizeString(learnerProfile.learningSignal),
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
        timePerWeek: normalizeString(resources.timePerWeek),
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
        structuredData: payload.structuredData,
        confirmedProposal: payload.confirmedProposal,
        metadata: payload.metadata || {},
      }),
      normalizeOutput: (parsed) => normalizeSceneFramingOutput(parsed),
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'PATH_SCENE_FRAMING_INVALID');
    }

    return {
      success: true,
      output: {
        ...result.output,
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
