import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';

const STAGE_DESIGNER_MAX_TOKENS = 32000;
const STAGE_DESIGNER_TEMPERATURE = 0.3;

// File-as-Truth：systemPrompt 以 prompts/skill.stage-designer.md 为唯一事实源（与其他 skill 一致），
// 避免代码内嵌副本与文件/DB 漂移导致 drift 检测永久误报。
export const STAGE_DESIGNER_PROMPT = loadPromptFile('skill:stage-designer')?.systemPrompt || '';

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
      icapLevel: ['passive', 'active', 'constructive', 'interactive'].includes(item?.icapLevel)
        ? item.icapLevel
        : null,
      transferable: !!item?.transferable,
    }))
    .filter((item) => !!item.title);
}

export function validateStageDesignerOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'STAGE_DESIGNER_OUTPUT_NOT_OBJECT' };
  }

  if (!Array.isArray(parsed.subtasks)) {
    return { valid: false as const, failureReason: 'STAGE_DESIGNER_SUBTASKS_MISSING' };
  }

  return { valid: true as const };
}

export async function stageDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const milestone = input?.milestone && typeof input.milestone === 'object' ? input.milestone : null;
    if (!milestone) {
      throw new Error('STAGE_DESIGNER_INVALID_INPUT: milestone is required');
    }
    const fallbackConcept = normalizeString(milestone?.coreConcept);
    const result = await callPrompt<any, { subtasks: any[] }>({
      agentId: 'skill:stage-designer',
      defaultSystemPrompt: STAGE_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'stage-designer' },
            buildUserPayload: (payload) => ({
        milestone: payload.milestone,
        previousMilestone: payload.previousMilestone || null,
        cognitiveCore: payload.cognitiveCore,
        normalizedInput: payload.normalizedInput || null,
        repairHints: payload.repairHints || null,
      }),
      normalizeOutput: (parsed, payload) => ({
        subtasks: normalizeSubtasks(parsed?.subtasks, normalizeString(payload?.milestone?.coreConcept)),
      }),
      validateParsedOutput: (parsed) => validateStageDesignerOutput(parsed),
      mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: 'stage-designed',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `请只输出一个阶段任务 JSON 对象，必须包含 subtasks 数组。上次失败原因：${failureReason}`,
      },
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
