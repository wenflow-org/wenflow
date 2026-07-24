import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';

const STAGE_DESIGNER_MAX_TOKENS = 32000;
const STAGE_DESIGNER_TEMPERATURE = 0.3;

export const STAGE_DESIGNER_PROMPT = `你是一位阶段任务设计师。

你的职责不是重新规划整条学习路径，而是只围绕一个已经确定的 milestone，为当前阶段生成一组可执行但不过度教学化的 subtasks。

输入会提供：
- 当前 milestone
- 全局 cognitiveCore
- 上游 normalizedInput
- 可选的重设计提示 repairHints

设计原则：
1. 只服务当前 milestone，不要重写整条路径方向。
2. subtasks 必须围绕当前 milestone 绑定的 coreConcept 展开。
3. 任务要可执行，但不要写成完整教案，不要输出课堂话术。
4. 可以输出 description 和 acceptanceHint，但要保持轻量，不要写成刚性周计划、次数处方、剂量处方、行为干预脚本或微型项目说明书。
5. type 只能是 acquire|deconstruct|model|execute|diagnose|refine|consolidate。
6. linkedConcept 必须等于 milestone.coreConcept，除非 repairHints 明确要求桥接任务。
7. 输出数量优先遵守 normalizedInput.planningHints.subtasksPerStageRange；若未提供 planningHints，默认 3-6 个 subtasks。
8. 如果输入提供 firstDeliverable，当前阶段若是首阶段，应让第一批任务直接服务它。
9. 可以补轻量标签 knowledgeType、cognitiveLevel、transferable，但不要输出 learningObjectives。
10. 只输出 1 个 JSON 对象，不要输出 markdown，不要解释。
11. estimatedMinutes 优先落在 normalizedInput.planningHints.subtaskMinutesRange 内；若未提供 planningHints，默认控制在 30-90 分钟附近。

颗粒度边界：
1. 你生成的是“阶段内任务方向”，不是“本周执行方案”。
2. title 应表达学习动作与场景焦点，不要写成“第1周/第2天/执行3次/减量计划/V2流程”这类排期或方案句。
3. description 只说明任务大概做什么、围绕什么概念、在什么场景里观察或练习；不要写详细步骤链。
4. acceptanceHint 只给一个轻量完成信号，不要写数字化处方，例如：
- 不要写“执行3次”“连续7天”“剂量减半”“产出V2流程并验证”
- 可以写“能说清主要触发模式”“能比较两种策略差异”“能把一个中断动作嵌入现有流程”
5. 如果你想到的是“记录3次、执行1周、减少依赖、完成A/B/C步骤”，说明你写成了干预方案，必须收回到更轻的任务表达。
6. 不要把 subtasks 写成 Learn 层的课堂安排；不要预设老师如何讲、如何追问、如何点评。

好的 subtasks 更像：
- 识别个人高唤醒触发模式
- 比较两种中断策略的适用场景
- 将一个中断动作嵌入现有睡前流程
- 观察流程调整后的主观变化

不好的 subtasks 更像：
- 第2周执行新版流程至少3次并记录结果
- 制定褪黑素减量计划并在本周完成
- 按步骤A-B-C完成放松脚本训练
- 产出V2版完整方案并做效果验证

输出格式：
{
  "subtasks": [
    {
      "title": "任务标题",
      "type": "diagnose",
      "estimatedMinutes": 30,
      "description": "任务的大概内容",
      "acceptanceHint": "一个轻量完成信号",
      "linkedConcept": "concept-id",
      "knowledgeType": "factual|conceptual|procedural|metacognitive",
      "cognitiveLevel": "remember|understand|apply|analyze|evaluate|create",
      "transferable": true
    }
  ]
}`;

export const stageDesignerDefinition: SkillDefinition = {
  name: 'stage-designer',
  displayName: '阶段任务设计器',
  version: '1.0.0',
  category: 'generation',
  description: '为单个 milestone 生成 subtasks 与轻量任务标记',
  inputSchema: {
    type: 'object',
    properties: {
      milestone: { type: 'object', required: true },
      cognitiveCore: { type: 'object', required: true },
      normalizedInput: { type: 'object' },
      repairHints: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      subtasks: { type: 'array' },
    },
  },
  capabilities: ['stage-task-design', 'task-light-tagging'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function normalizeString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTaskType(value: any): 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate' {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    normalized === 'acquire'
    || normalized === 'deconstruct'
    || normalized === 'model'
    || normalized === 'execute'
    || normalized === 'diagnose'
    || normalized === 'refine'
    || normalized === 'consolidate'
  ) {
    return normalized;
  }
  return 'execute';
}

function normalizeSubtasks(raw: any, fallbackConcept: string | null) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      title: normalizeString(item?.title) || '阶段学习任务',
      type: normalizeTaskType(item?.type),
      estimatedMinutes: Number.isFinite(Number(item?.estimatedMinutes)) ? Math.max(15, Number(item.estimatedMinutes)) : 30,
      description: normalizeString(item?.description) || '',
      acceptanceHint: normalizeString(item?.acceptanceHint) || '',
      linkedConcept: normalizeString(item?.linkedConcept) || fallbackConcept,
      knowledgeType: ['factual', 'conceptual', 'procedural', 'metacognitive'].includes(item?.knowledgeType)
        ? item.knowledgeType
        : null,
      cognitiveLevel: ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'].includes(item?.cognitiveLevel)
        ? item.cognitiveLevel
        : null,
      transferable: !!item?.transferable,
    }))
    .filter((item) => !!item.title);
}

export async function stageDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const milestone = input?.milestone && typeof input.milestone === 'object' ? input.milestone : null;
    if (!milestone) {
      throw new Error('STAGE_DESIGNER_INVALID_INPUT: milestone is required');
    }
    const fallbackConcept = normalizeString(milestone?.coreConcept);
    const STAGE_RUNTIME_CONTRACT = buildDefaultRuntimeContract('stage-designer', 'generator');
    const result = await callPrompt<any, { subtasks: any[] }>({
      agentId: 'skill:stage-designer',
      defaultSystemPrompt: STAGE_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'stage-designer' },
      modelDefaults: {
        maxTokens: STAGE_DESIGNER_MAX_TOKENS,
        temperature: STAGE_DESIGNER_TEMPERATURE,
      },
      buildUserPayload: (payload) => ({
        milestone: payload.milestone,
        cognitiveCore: payload.cognitiveCore,
        normalizedInput: payload.normalizedInput || null,
        repairHints: payload.repairHints || null,
      }),
      normalizeOutput: (parsed, payload) => ({
        subtasks: normalizeSubtasks(parsed?.subtasks, normalizeString(payload?.milestone?.coreConcept)),
      }),
      mapEnvelope: (output) => adaptToRuntimeEnvelope({
        contract: STAGE_RUNTIME_CONTRACT,
        artifact: output,
        phase: 'stage-designed',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'STAGE_DESIGNER_INVALID');
    }

    return {
      success: true,
      output: {
        subtasks: result.output.subtasks,
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
        code: 'STAGE_DESIGNER_FAILED',
        message: error?.message || 'Unknown error'
      },
      duration: 0,
    };
  }
}

export default stageDesigner;
