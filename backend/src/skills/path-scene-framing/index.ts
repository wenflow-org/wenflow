import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';

export const PATH_SCENE_FRAMING_MAX_TOKENS = 32000;
export const PATH_SCENE_FRAMING_TEMPERATURE = 0.2;

export const PATH_SCENE_FRAMING_PROMPT = `你是一个学习路径场景编排器中的 framing 规划器。

你的任务不是直接输出完整学习路径，而是先把已确认的目标信息压缩成一份稳定的路径 framing，供后续完整任务级路径生成使用。

输入会包含：
- 原始学习目标
- goal conversation 沉淀的 structuredData
- 用户已确认的 confirmedProposal
- 时间/资源/边界信息

要求：
1. 不要重新质疑用户已确认的方向。
2. 不要输出完整路径、周计划或任务清单。
3. 只输出 1 个 JSON 对象。
4. framing 必须明确：这版路径先解决什么、首个最小产出是什么、暂不展开什么、时间投入如何影响任务颗粒度。
5. framing 必须额外指出：这条路径要优先训练的底层认知域是什么。它不是学科名，而是更抽象的能力锚点。

请输出：
{
  "intent": "这版路径先聚焦解决什么",
  "targetState": "用户将达到的可观察状态",
  "firstDeliverable": "第一个最小可交付结果",
  "cognitiveDomain": "这条路径优先训练的底层认知域",
  "planningFocus": ["重点1", "重点2"],
  "excludedScope": ["暂不展开1"],
  "resourceProfile": {
    "timeBudget": "每天/每周可投入时间",
    "timeHorizon": "整体时间窗",
    "pace": "任务颗粒度判断"
  },
  "riskFlags": ["风险1"],
  "sourceGoal": {
    "surfaceGoal": "",
    "realProblem": "",
    "motivation": "",
    "urgency": ""
  }
}`;

export const pathSceneFramingDefinition: SkillDefinition = {
  name: 'path-scene-framing',
  version: '1.0.0',
  category: 'analysis',
  description: '为学习路径生成方向 framing 与约束框架',
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
      intent: { type: 'string' },
      targetState: { type: 'string' },
      firstDeliverable: { type: 'string' },
      cognitiveDomain: { type: 'string' },
      planningFocus: { type: 'array' },
      excludedScope: { type: 'array' },
      resourceProfile: { type: 'object' },
      riskFlags: { type: 'array' },
      sourceGoal: { type: 'object' },
    }
  },
  capabilities: ['path-framing', 'planning-focus', 'cognitive-domain'],
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

export async function pathSceneFraming(
  input: PathSceneFramingInput
): Promise<SkillExecutionResult<any>> {
  const startTime = Date.now();

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: PATH_SCENE_FRAMING_PROMPT },
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

    const output = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      output,
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
