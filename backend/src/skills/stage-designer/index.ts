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
import { assessMaterialRefCoverage } from '../../services/materials/material-ref-coverage.service';
import type { PromptMaterial } from '../../services/materials/material-prompt-projection';
import { logger } from '../../utils/logger';

const STAGE_DESIGNER_MAX_TOKENS = 64000;
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
      previousStageOutcome: { type: 'object' },
      supplementRequest: { type: 'object' },
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

function normalizeAdjustability(value: any, taskType: ReturnType<typeof normalizeTaskType>): 'core' | 'flexible' {
  if (value === 'core' || value === 'flexible') return value;
  // 未标注时的确定性兜底：交付/收口/应用类任务是骨干，建立/拆解/诊断类可被压缩。
  // 兜底与提示词规则同口径，保证旧输出（无 adjustability）也有可用的重排语义。
  return taskType === 'acquire' || taskType === 'deconstruct' || taskType === 'diagnose'
    ? 'flexible'
    : 'core';
}

export function normalizeSubtasks(raw: any, fallbackConcept: string | null) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => {
      const taskType = normalizeTaskType(item?.type);
      return {
      title: normalizeString(item?.title) || '阶段学习任务',
      type: taskType,
      // 下沿取 10：path-planning-hints 对"一节课量级"的路径给的是 subtaskMinutesRange=[10,15]，
      // 而规则 49 要求此时 estimatedMinutes 取该区间下沿——此前硬抬到 15，等于静默覆盖规则
      // （审计 P2「下沿不一致」）。地板仍保留，用来挡模型给出的荒谬小值。
      estimatedMinutes: Number.isFinite(Number(item?.estimatedMinutes)) ? Math.max(10, Number(item.estimatedMinutes)) : 30,
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
      // 动态规划（2026-10-17）：任务级可调整性，重排压缩时据此保护骨干（core）、
      // 优先删减 flexible。白名单归一必须带上，否则模型输出会被剥掉（与 materialRefs 同坑）。
      adjustability: normalizeAdjustability(item?.adjustability, taskType),
      // 白名单归一**必须带上** materialRefs，否则任务级资料引用在此被丢掉
      // （随后由 withMaterialRefs 逐字核对；核对不过会在那里被删除）
      materialRefs: Array.isArray(item?.materialRefs) ? item.materialRefs : undefined,
      // 同理必须带上 anticipatedMisconceptions（2026-09-26 课前注入）：白名单归一没带 =
      // 模型输出了也被剥掉（真实 LLM 端到端实测：原始输出含键、sidecar 空）
      anticipatedMisconceptions: Array.isArray(item?.anticipatedMisconceptions)
        ? item.anticipatedMisconceptions
            .map((hint: any) => ({
              conceptKey: normalizeString(hint?.conceptKey) || '',
              label: normalizeString(hint?.label) || '',
              why: normalizeString(hint?.why) || '',
            }))
            .filter((hint: { conceptKey: string; label: string }) => hint.conceptKey && hint.label)
            .slice(0, 2)
        : undefined,
      };
    })
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
 * 输入里带了投影后的 materials（由 stage-enrichment 注入）。
 *
 * 无资料时**也要走核对**：`normalizeMaterialRefs` 对空资料一律返回 []，于是模型编造的引用被删除。
 * 此前直接 `return list`，等于放行编造引用落库给学习者看（违反"宁缺勿编"），
 * 也与 path-planning 的口径不一致（审计 P1 §2.3b）。
 */
export function withMaterialRefs(subtasks: any[], materials: unknown): any[] {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const normalizedMaterials = Array.isArray(materials) ? (materials as PromptMaterial[]) : null;
  return list.map((task) => {
    if (!task || typeof task !== 'object') return task;
    const refs = normalizeMaterialRefs(task.materialRefs, normalizedMaterials);
    const next = { ...task };
    if (refs.length) next.materialRefs = refs;
    else delete next.materialRefs;
    return next;
  });
}

/**
 * 资料只从顶层 `materials`（投影后）投递。`normalizedInput.resources.materials` 是**全量原文**，
 * 与顶层投影同进载荷既浪费 token，又制造"模型看到投影外内容、却被逐字核对丢弃"的口径不一致
 * （审计 P1 §2.3c）。这里在投递前剥掉嵌套的那份，保持单一投递点。
 */
export function stripNestedMaterials(normalizedInput: any): any {
  if (!normalizedInput || typeof normalizedInput !== 'object') return normalizedInput ?? null;
  const resources = normalizedInput.resources;
  if (!resources || typeof resources !== 'object' || resources.materials === undefined) return normalizedInput;
  const { materials: _dropped, ...restResources } = resources;
  return { ...normalizedInput, resources: restResources };
}

export async function stageDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const milestone = input?.milestone && typeof input.milestone === 'object' ? input.milestone : null;
    if (!milestone) {
      throw new Error('STAGE_DESIGNER_INVALID_INPUT: milestone is required');
    }
    const fallbackConcept = normalizeString(milestone?.coreConcept);
    const stageMaterials = Array.isArray(input?.materials) ? (input.materials as PromptMaterial[]) : [];
    const coverageNodes = (subtasks: any[]) => (Array.isArray(subtasks) ? subtasks : []).map((task: any, index: number) => ({
      label: `任务 ${index + 1}「${normalizeString(task?.title) || '未命名'}」`,
      refs: task?.materialRefs,
    }));
    const coverageText = (subtasks: any[]) => [
      milestone.title,
      milestone.goal,
      milestone.description,
      milestone.coreConcept,
      ...(Array.isArray(subtasks) ? subtasks : []).map((task: any) => (
        [task?.title, task?.description, task?.acceptanceHint].filter(Boolean).join(' ')
      )),
    ].filter(Boolean).join(' ');
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
            normalizedInput: stripNestedMaterials(payload.normalizedInput),
            materials: payload.materials || null,
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            pathStageMap: payload.pathStageMap || null,
            schoolAnchor: payload.schoolAnchor || null,
            firstDeliverable: payload.firstDeliverable || null,
            successCriteria: payload.successCriteria || null,
            repairHints: payload.repairHints || null,
            // 动态规划信号（2026-10-17）：上一阶段真实学习结果。此前 progressive 模式在
            // stage-enrichment 里算出了 previousStageOutcome，但 skill 的载荷白名单没带它 →
            // 信号在边界被静默丢弃（提示词侧从未见过）。同理补上 supplementRequest——
            // 补课调用一直在传，提示词的 supplementRequest 规则却永远拿不到输入。
            previousStageOutcome: payload.previousStageOutcome || null,
            supplementRequest: payload.supplementRequest || null,
          }
        : {
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            pathStageMap: payload.pathStageMap || null,
            schoolAnchor: payload.schoolAnchor || null,
            firstDeliverable: payload.firstDeliverable || null,
            successCriteria: payload.successCriteria || null,
            cognitiveCore: payload.cognitiveCore,
            normalizedInput: stripNestedMaterials(payload.normalizedInput),
            materials: payload.materials || null,
            repairHints: payload.repairHints || null,
            previousStageOutcome: payload.previousStageOutcome || null,
            supplementRequest: payload.supplementRequest || null,
          }),
      normalizeOutput: (parsed, payload) => {
        const subtasks = withMaterialRefs(
          normalizeSubtasks(parsed?.subtasks, normalizeString(payload?.milestone?.coreConcept)),
          payload?.materials,
        );
        if (stageMaterials.length) {
          const coverage = assessMaterialRefCoverage({
            materials: stageMaterials,
            nodes: coverageNodes(subtasks),
            text: coverageText(subtasks),
            scope: 'STAGE',
          });
          logger.info('[stage-designer] materialRefs 覆盖度', {
            milestone: milestone.title,
            materials: stageMaterials.length,
            subtasks: subtasks.length,
            relevant: coverage.relevant,
            covered: coverage.covered,
            coverageRatio: `${coverage.covered}/${coverage.total}`,
          });
          if (coverage.relevant && coverage.covered === 0) {
            logger.warn('[stage-designer] 相关资料但零引用（软校验重试后仍未通过）', {
              milestone: milestone.title,
              materials: stageMaterials.length,
              subtasks: subtasks.length,
            });
          }
        }
        return { subtasks };
      },
      validateParsedOutput: (parsed) => validateStageDesignerOutput(parsed),
      // 软校验：相关资料却零引用 → 带反馈重试一次；仍失败按当前输出继续（不阻断阶段设计）。
      softValidateParsedOutput: (parsed) => {
        const subtasks = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];
        const coverage = assessMaterialRefCoverage({
          materials: stageMaterials,
          nodes: coverageNodes(subtasks),
          text: coverageText(subtasks),
          scope: 'STAGE',
        });
        return coverage.valid
          ? { valid: true }
          : { valid: false, failureReason: coverage.failureReason, violations: coverage.violations };
      },
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
        onValidationFail: ({ failureReason }) => [
          '请只输出一个阶段任务 JSON 对象，必须包含 subtasks 数组。',
          failureReason.startsWith('MATERIAL_REFS_MISSING_')
            ? '本阶段资料与目标相关时，每个 subtask 至少给 1 条 materialRefs：sectionId 取自资料 sections[].id，quote 逐字复制该章节标题或 keyPoints[].cite；不得改写、不得编造。与目标明显无关的资料可以整体不引用。'
            : null,
          `上次失败原因：${failureReason}`,
        ].filter(Boolean).join('\n\n'),
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
