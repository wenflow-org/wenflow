import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';

export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_MAX_TOKENS = 800;
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_TEMPERATURE = 0.3;
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED = 'VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED';

// File-as-Truth: the ACTIVE prompt at runtime is compiled from prompts/core/*.yaml.
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_PROMPT =
  loadPromptFile('skill:virtual-learner-epistemic-grounding')?.systemPrompt || '';

export interface EpistemicGrounding {
  sampledCorrectness: boolean;
  blockedConcept: string | null;
  errorPattern: string | null;
  masteryProb: number;
}

export interface EpistemicGroundingInput {
  learner: Record<string, any>;
  currentTask?: { title?: string | null; description?: string | null } | null;
  knowledgeSnapshot?: Array<{ name: string; status?: string; progress?: number }>;
  previousLearnerState?: Record<string, any> | null;
}

function clamp01(value: any, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGrounding(parsed: any): EpistemicGrounding {
  const g = parsed?.epistemicGrounding && typeof parsed.epistemicGrounding === 'object'
    ? parsed.epistemicGrounding
    : {};
  return {
    sampledCorrectness: typeof g.sampledCorrectness === 'boolean' ? g.sampledCorrectness : false,
    blockedConcept: typeof g.blockedConcept === 'string' ? g.blockedConcept.trim() || null : null,
    errorPattern: typeof g.errorPattern === 'string' ? g.errorPattern.trim() || null : null,
    masteryProb: clamp01(g.masteryProb, 0.5),
  };
}

function buildUserPayload(input: EpistemicGroundingInput) {
  return {
    learner: input.learner || {},
    currentTask: input.currentTask || null,
    knowledgeSnapshot: Array.isArray(input.knowledgeSnapshot) ? input.knowledgeSnapshot.slice(0, 5) : [],
    previousLearnerState: input.previousLearnerState || null,
  };
}

export const virtualLearnerEpistemicGroundingDefinition: SkillDefinition = {
  name: 'virtual-learner-epistemic-grounding',
  displayName: '虚拟学习者认知判决器',
  version: '1.0.0',
  category: 'generation',
  description: '基于学习者画像掌握度，对本轮能否做对当前步骤做离散认知判决（BEAGLE Strategist 段，物理两阶段第一段）。',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像（含掌握度描述）', required: true },
      currentTask: { type: 'object', description: '当前 task 信息' },
      knowledgeSnapshot: { type: 'array', description: '当前任务知识看板' },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      epistemicGrounding: { type: 'object', description: '本轮认知判决（sampledCorrectness/blockedConcept/errorPattern/masteryProb）' },
    },
  },
  capabilities: ['learner-epistemic-grounding', 'competency-bias-mitigation'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

export async function virtualLearnerEpistemicGrounding(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-epistemic-grounding',
      defaultSystemPrompt: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-epistemic-grounding' },
      buildUserPayload,
      validateParsedOutput: (parsed: any) => {
        const g = parsed?.epistemicGrounding;
        const ok = g && typeof g === 'object' && typeof g.sampledCorrectness === 'boolean';
        return {
          valid: ok,
          failureReason: ok ? undefined : 'missing epistemicGrounding.sampledCorrectness',
        };
      },
      normalizeOutput: (parsed: any) => ({ epistemicGrounding: normalizeGrounding(parsed) }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `上一次输出失败：${failureReason}。请只返回一个完整、可解析的 JSON 对象；不要 markdown，不要代码块，不要解释。`,
      },
    }, input || {});

    if (!result.success || !result.output) {
      return {
        success: false,
        error: {
          code: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED,
          message: result.error?.message || 'epistemic-grounding-failed',
        },
        duration: result.debug.durationMs || 0,
      };
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
        code: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED,
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerEpistemicGrounding;
