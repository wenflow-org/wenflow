import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { normalizeMaterialRefs } from '../../services/materials/material-refs';
import type { PromptMaterial } from '../../services/materials/material-prompt-projection';

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
      // 白名单归一**必须带上** materialRefs，否则任务级资料引用在此被丢掉
      // （随后由 withMaterialRefs 逐字核对；核对不过会在那里被删除）
      materialRefs: Array.isArray(item?.materialRefs) ? item.materialRefs : undefined,
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

/**
 * 规则 39 以 `milestone.loadTarget` 为键，但 path 层只把它写在
 * `cognitiveCore.loadProfile.stageLoadDistribution[]`（按 stageNumber 索引）里——
 * 此前两个调用点都不注入该键 ⇒ 规则永不生效（审计 §3.19 P1⑤）。
 * 这里按 stageNumber 取回并挂到 milestone 上；找不到就不加（规则文本本就写"若输入提供"）。
 */
export function withLoadTargetForMilestone(milestone: any, cognitiveCore: any): any {
  if (!milestone || typeof milestone !== 'object') return milestone;
  if (normalizeString(milestone.loadTarget)) return milestone; // 已提供则不覆盖
  const distribution = cognitiveCore?.loadProfile?.stageLoadDistribution;
  const stageNumber = Number(milestone.stageNumber ?? milestone.stage);
  if (!Array.isArray(distribution) || !Number.isFinite(stageNumber)) return milestone;
  const hit = distribution.find((item: any) => Number(item?.stageNumber) === stageNumber);
  const loadTarget = normalizeString(hit?.loadTarget);
  return loadTarget ? { ...milestone, loadTarget } : milestone;
}

/**
 * materialRefs：任务 → 资料条目（**逐字核对**，编造的引用丢弃）。
 * 输入里带了投影后的 materials（由 stage-enrichment 注入），核对不通过就不落该键。
 */
function withMaterialRefs(subtasks: any[], materials: unknown): any[] {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const normalizedMaterials = Array.isArray(materials) ? (materials as PromptMaterial[]) : null;
  if (!normalizedMaterials?.length) return list;
  return list.map((task) => {
    if (!task || typeof task !== 'object') return task;
    const refs = normalizeMaterialRefs(task.materialRefs, normalizedMaterials);
    const next = { ...task };
    if (refs.length) next.materialRefs = refs;
    else delete next.materialRefs;
    return next;
  });
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
      // 稳定前缀（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：cognitiveCore/normalizedInput 跨里程碑稳定，前置；
      // milestone/previousMilestone/repairHints 逐次变化，后置。
      buildUserPayload: (payload) => (process.env.PAYLOAD_STABLE_PREFIX !== '0'
        ? {
            cognitiveCore: payload.cognitiveCore,
            normalizedInput: payload.normalizedInput || null,
            materials: payload.materials || null,
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            repairHints: payload.repairHints || null,
          }
        : {
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            cognitiveCore: payload.cognitiveCore,
            normalizedInput: payload.normalizedInput || null,
            materials: payload.materials || null,
            repairHints: payload.repairHints || null,
          }),
      normalizeOutput: (parsed, payload) => ({
        subtasks: withMaterialRefs(
          normalizeSubtasks(parsed?.subtasks, normalizeString(payload?.milestone?.coreConcept)),
          payload?.materials,
        ),
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
