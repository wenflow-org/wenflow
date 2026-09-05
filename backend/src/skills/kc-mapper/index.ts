import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';

export const KC_MAPPER_PROMPT = loadPromptFile('skill:kc-mapper')?.systemPrompt || '';

const KC_TAXONOMY = ['factual', 'conceptual', 'procedural', 'metacognitive'] as const;

export const kcMapperDefinition: SkillDefinition = {
  name: 'kc-mapper',
  displayName: '知识组件映射器',
  version: '1.0.0',
  category: 'analysis',
  description: '将认知概念和子任务分解为细粒度 KC，标注前置依赖',
  inputSchema: {
    type: 'object',
    properties: { cognitiveCore: { type: 'object' }, milestones: { type: 'array' }, subtasks: { type: 'array' }, prerequisiteTree: { type: 'object' } },
  },
  outputSchema: { type: 'object', properties: { conceptKcs: { type: 'array' }, taskKcLinks: { type: 'array' }, kcGraph: { type: 'object' }, gapCoverage: { type: 'object' } } },
  capabilities: ['kc-mapping', 'knowledge-graph'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export function validateKcMapperOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false as const, failureReason: 'KC_MAPPER_OUTPUT_NOT_OBJECT' };
  if (!Array.isArray(parsed.conceptKcs)) return { valid: false as const, failureReason: 'KC_MAPPER_CONCEPT_KCS_MISSING' };
  return { valid: true as const };
}

/**
 * KC 粒度控制（警告级审计，不阻断）：
 * - 每个 coreConcept 的 KC 数应在 2-5 区间（kc-mapper.yaml rule 32）
 * - 每个 subtask 应关联 ≥1 个 KC（kc-mapper.yaml rule 36）
 * 不足时记录 warning 供审计，不打断路径生成（与 hub 复用同理，避免打回破坏生产）。
 */
export function auditKcGranularity(parsed: any, input: any): string[] {
  const warnings: string[] = [];
  const conceptKcs = Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [];
  const taskKcLinks = Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [];

  // 每个 coreConcept 的 KC 数
  const concepts = Array.isArray(input?.cognitiveCore?.coreConcepts)
    ? input.cognitiveCore.coreConcepts
    : [];
  const kcByConcept = new Map<string, number>();
  for (const item of conceptKcs) {
    if (!item || typeof item !== 'object') continue;
    const conceptId = item.conceptId;
    const kcs = Array.isArray(item.kcs) ? item.kcs.filter(Boolean) : [];
    kcByConcept.set(conceptId, kcs.length);
  }
  for (const concept of concepts) {
    if (!concept || typeof concept !== 'object') continue;
    const count = kcByConcept.get(concept.id) ?? 0;
    if (count < 2 || count > 5) {
      warnings.push(`KC_GRANULARITY_OUT_OF_RANGE(concept=${concept.id}, kcCount=${count}, expected 2-5)`);
    }
  }

  // 每个 subtask 关联 ≥1 KC
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : [];
  const linkedTaskTitles = new Set<string>();
  for (const link of taskKcLinks) {
    if (!link || typeof link !== 'object') continue;
    const title = typeof link.taskTitle === 'string' ? link.taskTitle : null;
    if (title) linkedTaskTitles.add(title);
  }
  for (const task of subtasks) {
    if (!task || typeof task !== 'object') continue;
    const title = typeof task.title === 'string' ? task.title : null;
    if (title && !linkedTaskTitles.has(title)) {
      warnings.push(`KC_TASK_UNLINKED(task=${title.slice(0, 20)}, linkedKCs 缺失)`);
    }
  }

  return warnings;
}

export async function kcMapper(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:kc-mapper',
      defaultSystemPrompt: KC_MAPPER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'kc-mapper' },
      buildUserPayload: (payload) => ({
        cognitiveCore: payload.cognitiveCore,
        milestones: payload.milestones || [],
        subtasks: payload.subtasks || [],
        prerequisiteTree: payload.prerequisiteTree || null,
      }),
      normalizeOutput: (parsed) => {
        const conceptKcs = Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [];
        const taskKcLinks = Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [];
        return {
          conceptKcs,
          taskKcLinks,
          kcGraph: parsed?.kcGraph || { nodes: [], edges: [] },
          gapCoverage: parsed?.gapCoverage || null,
          // KC 粒度审计（警告级）：每概念 2-5 KC、每任务 ≥1 关联 KC
          audit: auditKcGranularity(parsed, input),
        };
      },
      validateParsedOutput: (parsed) => validateKcMapperOutput(parsed),
      mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: 'kc-mapped',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
      retryStrategy: { maxAttempts: 2 },
    }, input);

    if (!result.success || !result.output) throw new Error(result.error?.message || 'KC_MAPPER_FAILED');
    return { success: true, output: result.output, duration: result.debug.durationMs };
  } catch (error: any) {
    return { success: false, error: { code: 'KC_MAPPER_FAILED', message: error?.message || 'Unknown error' }, duration: 0 };
  }
}

export default kcMapper;