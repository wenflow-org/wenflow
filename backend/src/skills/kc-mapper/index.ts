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
      normalizeOutput: (parsed) => ({
        conceptKcs: Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [],
        taskKcLinks: Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [],
        kcGraph: parsed?.kcGraph || { nodes: [], edges: [] },
        gapCoverage: parsed?.gapCoverage || null,
      }),
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