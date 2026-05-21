import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';

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
4.1 如果 learnerProfile.surfaceGoal 本身已经是明显的问题陈述，且 problemSpace.realProblem 缺失，不要继续留空；直接把这句问题陈述收敛到 problemSpace.realProblem。
4.2 “明显的问题陈述”指包含不知道如何、不会、缺少、困难、痛点、卡住、没方向、无从下手等阻塞表达。
4.3 problemSpace.realProblem 优先描述用户当前卡住的矛盾或阻塞，不要复述成任务计划。
4.4 problemSpace.realProblem 允许等于 surfaceGoal，但不允许写成“第1步/先做A再做B/梳理-提炼-整合”这类步骤句。
5. 不要在 normalizedInput 中输出 source、mode 这类编排控制字段。
6. confirmedProposal.keyStages 只保留高层阶段提示，不要原样回声任务步骤句。
6.1 如果上游 keyStages 更像执行步骤、检查清单、动作链、梳理/提炼/整合式操作语句，不要把它们继续放在 keyStages，留空数组即可。
6.2 keyStages 是给 path 提供阶段方向提示，不是给隐藏概念层提供命名素材。
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

function isProblemLikeStatement(value: string | null): boolean {
  if (!value) return false;
  return /(不知道如何|不会|缺少|困难|痛点|卡住|没方向|无从下手)/.test(value);
}

function isOperationalStageLike(value: string | null): boolean {
  if (!value) return false;
  return /^(梳理|提炼|整合|记录|分析|学习|设计|绘制|撰写|汇总|复盘|验证|拆解|总结|产出|模拟|试用)/.test(value)
    || /(3-5个|检查点|清单|试用验证|模拟场景|先.+再.+)/.test(value);
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
  const realProblem = explicitProblem
    || (isProblemLikeStatement(surfaceGoal) ? surfaceGoal : null);
  const rawKeyStages = normalizeStringArray(confirmedProposal?.keyStages);
  const keyStages = rawKeyStages.filter((item) => !isOperationalStageLike(item));

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
        realProblem,
        scenario: normalizeString(problemSpace.scenario),
        currentPainPoint: normalizeString(problemSpace.currentPainPoint),
      },
      resources: {
        timePerWeek: normalizeString(normalizedInput.resources?.timePerWeek),
        timePerSession: normalizeString(normalizedInput.resources?.timePerSession),
        timeHorizon: normalizeString(normalizedInput.resources?.timeHorizon),
        deadlineText: normalizeString(normalizedInput.resources?.deadlineText),
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
    },
  };
}

export async function pathSceneFraming(
  input: PathSceneFramingInput
): Promise<SkillExecutionResult<any>> {
  const startTime = Date.now();

  try {
    const promptConfig = await new AgentConfigService().getActivePrompt('skill:path-scene-framing');
    const systemPrompt = promptConfig?.systemPrompt || PATH_SCENE_FRAMING_PROMPT;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          goal: input.goal,
          currentLevel: input.currentLevel,
          timePerDay: input.timePerDay,
          structuredData: input.structuredData,
          confirmedProposal: input.confirmedProposal,
          metadata: input.metadata || {}
        }, null, 2)
      }
    ];

    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'path-scene-framing' };
    const response = await gateway.execute({
      messages,
      max_tokens: PATH_SCENE_FRAMING_MAX_TOKENS,
      temperature: PATH_SCENE_FRAMING_TEMPERATURE,
    }, caller, {});

    const content = response.choices[0]?.message.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('PATH_SCENE_FRAMING_INVALID: response does not contain valid JSON');
    }

    const output = normalizeSceneFramingOutput(JSON.parse(jsonMatch[0]));
    return {
      success: true,
      output: {
        ...output,
        _debug: {
          rawModelOutput: content,
          extractedJson: jsonMatch[0],
        },
      },
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'PATH_SCENE_FRAMING_FAILED',
        message: error?.message || 'Unknown error'
      },
      duration: Date.now() - startTime,
    };
  }
}

export default pathSceneFraming;
