import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';

// File-as-Truth：systemPrompt 以 prompts/skill.path-reviewer.md 为唯一事实源
export const PATH_REVIEWER_PROMPT = loadPromptFile('skill:path-reviewer')?.systemPrompt || '';

const DIMENSION_KEYS = ['clarity', 'integrity', 'depth', 'practicality', 'pertinence'] as const;
const DIMENSION_WEIGHTS: Record<string, number> = {
  clarity: 0.2,
  integrity: 0.25,
  depth: 0.2,
  practicality: 0.2,
  pertinence: 0.15,
};

export const pathReviewerDefinition: SkillDefinition = {
  name: 'path-reviewer',
  displayName: '路径质量评审器',
  version: '1.0.0',
  category: 'analysis',
  description: '对 path-planning 生成的路径做 CIDDP 五维度评分，低于阈值输出重规划指令',
  inputSchema: {
    type: 'object',
    properties: {
      pathPlan: { type: 'object', required: true },
      goalContext: { type: 'object', required: true },
      prerequisiteTree: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      score: { type: 'number' },
      dimensions: { type: 'object' },
      issues: { type: 'array' },
      passed: { type: 'boolean' },
      replanInstructions: { type: 'string' },
    },
  },
  capabilities: ['path-quality-review', 'cidpp-evaluation'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function clamp01(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

function normalizeDimensions(raw: any): Record<string, number> {
  const dims: Record<string, number> = {};
  for (const key of DIMENSION_KEYS) {
    dims[key] = clamp01(raw?.[key]);
  }
  return dims;
}

function computeOverall(dims: Record<string, number>): number {
  let total = 0;
  let weight = 0;
  for (const key of DIMENSION_KEYS) {
    total += dims[key] * DIMENSION_WEIGHTS[key];
    weight += DIMENSION_WEIGHTS[key];
  }
  return weight > 0 ? total / weight : 0.5;
}

function normalizeIssues(raw: any): Array<{ dimension: string; severity: string; description: string; suggestion: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      dimension: typeof item?.dimension === 'string' && DIMENSION_KEYS.includes(item.dimension as any) ? item.dimension : 'clarity',
      severity: ['low', 'medium', 'high'].includes(item?.severity) ? item.severity : 'medium',
      description: typeof item?.description === 'string' ? item.description.trim().slice(0, 300) : '',
      suggestion: typeof item?.suggestion === 'string' ? item.suggestion.trim().slice(0, 300) : '',
    }))
    .filter((item) => item.description);
}

export function validatePathReviewerOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'PATH_REVIEWER_OUTPUT_NOT_OBJECT' };
  }
  if (typeof parsed.score !== 'number' && parsed.score !== undefined) {
    return { valid: false as const, failureReason: 'PATH_REVIEWER_SCORE_INVALID' };
  }
  return { valid: true as const };
}

export async function pathReviewer(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const pathPlan = input?.pathPlan && typeof input.pathPlan === 'object' ? input.pathPlan : null;
    if (!pathPlan) {
      throw new Error('PATH_REVIEWER_INVALID_INPUT: pathPlan is required');
    }
    const result = await callPrompt<any, { score: number; dimensions: any; issues: any[]; passed: boolean; replanInstructions?: string }>({
      agentId: 'skill:path-reviewer',
      defaultSystemPrompt: PATH_REVIEWER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'path-reviewer' },
      buildUserPayload: (payload) => ({
        pathPlan: payload.pathPlan,
        goalContext: payload.goalContext || null,
        prerequisiteTree: payload.prerequisiteTree || null,
      }),
      normalizeOutput: (parsed, _payload) => {
        const dims = normalizeDimensions(parsed?.dimensions);
        const overall = clamp01(parsed?.score);
        return {
          score: overall,
          dimensions: dims,
          issues: normalizeIssues(parsed?.issues),
          passed: typeof parsed?.passed === 'boolean' ? parsed.passed : overall >= 0.75,
          replanInstructions: typeof parsed?.replanInstructions === 'string' ? parsed.replanInstructions.trim() : null,
        };
      },
      validateParsedOutput: (parsed) => validatePathReviewerOutput(parsed),
      mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: 'path-reviewed',
        status: output.passed ? 'succeeded' : 'blocked',
        isTerminal: true,
        nextAction: output.passed ? null : 'replan',
        nextState: null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `请只输出一个路径评审 JSON 对象，必须包含 score/dimensions/issues/passed 字段。上次失败原因：${failureReason}`,
      },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'PATH_REVIEWER_INVALID');
    }

    // 总分与 dimensions 加权一致性（确定性兜底，防 LLM 自报总分与分项不一致）
    const recomputedOverall = computeOverall(result.output.dimensions);
    const finalScore = Math.abs(result.output.score - recomputedOverall) > 0.05
      ? recomputedOverall
      : result.output.score;

    return {
      success: true,
      output: {
        score: finalScore,
        dimensions: result.output.dimensions,
        issues: result.output.issues,
        passed: result.output.passed,
        replanInstructions: result.output.replanInstructions,
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
        code: 'PATH_REVIEWER_FAILED',
        message: error?.message || 'Unknown error'
      },
      duration: 0,
    };
  }
}

export default pathReviewer;