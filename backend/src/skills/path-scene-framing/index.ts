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
5. qualityFlags 只能做确定性映射：
   - lowConfidenceFields 只能依据上游已提供的 confidenceScores 映射，不能自行判断。
   - 如果某个 confidence score < 0.5，则把对应字段名放入 lowConfidenceFields。
   - 如果没有 confidenceScores，就返回空的 lowConfidenceFields。
   - missingFields 只标记字段不存在。
   - missingOrEmptyFields 只标记字段存在但值为 null、空字符串、空数组或空对象。
6. conversationHistory 等原始上下文如果在 metadata 中出现，只能降级放入 supportingEvidence，不作为主输入事实改写来源。
7. supportingEvidence 必须使用固定子字段，不要自由发明额外结构。
8. 不要在 normalizedInput 中输出 source、mode 这类编排控制字段。
9. 只输出 1 个 JSON 对象，不要输出 markdown，不要输出解释。

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
    "qualityFlags": {
      "confidenceScores": {},
      "missingFields": [],
      "lowConfidenceFields": [],
      "missingOrEmptyFields": []
    }
  },
  "supportingEvidence": {
    "usagePolicy": "reference_only",
    "conversationHistory": [],
    "learnerQA": [],
    "behaviorLog": [],
    "notes": []
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
      supportingEvidence: { type: 'object' },
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
