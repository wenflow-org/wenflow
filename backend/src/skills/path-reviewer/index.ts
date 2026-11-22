import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import {
  PATH_REVIEW_DIMENSION_KEYS,
  computePathReviewScore,
  validatePathReviewOutput,
  type PathReviewDimensions,
} from './contract';

export { PATH_REVIEW_PASS_THRESHOLD, computePathReviewNeedsReplan } from './contract';

// File-as-Truth：systemPrompt 以 prompts/skill.path-reviewer.md 为唯一事实源
export const PATH_REVIEWER_PROMPT = loadPromptFile('skill:path-reviewer')?.systemPrompt || '';

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

function normalizeIssues(raw: any): Array<{ dimension: string; severity: string; description: string; suggestion: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      dimension: typeof item?.dimension === 'string' && (PATH_REVIEW_DIMENSION_KEYS as readonly string[]).includes(item.dimension) ? item.dimension : 'clarity',
      severity: ['low', 'medium', 'high'].includes(item?.severity) ? item.severity : 'medium',
      description: typeof item?.description === 'string' ? item.description.trim().slice(0, 300) : '',
      suggestion: typeof item?.suggestion === 'string' ? item.suggestion.trim().slice(0, 300) : '',
    }))
    .filter((item) => item.description);
}

/**
 * 归一化前校验：五个维度必须齐全（档位 strong|adequate|weak|fail，兼容旧 0-1 数字），
 * needsReplan（加权分不达标 ∨ severity=high ∨ fail 档）时必须带返工指令。
 * 失败即抛（callPrompt 会按 retryStrategy 重试）；重试耗尽后调用方记「证据不足」。
 */
export function validatePathReviewerOutput(parsed: any) {
  const verdict = validatePathReviewOutput(parsed);
  if (verdict.valid === false) {
    return { valid: false as const, failureReason: verdict.failureReason };
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
      // 稳定前缀（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：prerequisiteTree(常量) 前置，pathPlan 后置
      buildUserPayload: (payload) => (process.env.PAYLOAD_STABLE_PREFIX !== '0'
        ? {
            prerequisiteTree: payload.prerequisiteTree || null,
            goalContext: payload.goalContext || null,
            pathPlan: payload.pathPlan,
          }
        : {
            pathPlan: payload.pathPlan,
            goalContext: payload.goalContext || null,
            prerequisiteTree: payload.prerequisiteTree || null,
          }),
      normalizeOutput: (parsed, _payload) => {
        const verdict = validatePathReviewOutput(parsed);
        if (verdict.valid === false) {
          // 理论上 callPrompt 已用 validateParsedOutput 拦过一次；这里防归一化绕过校验。
          throw new Error(verdict.failureReason);
        }
        const dims: PathReviewDimensions = verdict.dimensions;
        const finalScore = verdict.score;
        return {
          score: finalScore,
          dimensions: dims,
          issues: normalizeIssues(parsed?.issues),
          // #172-6① + 2026-11-22 合取闸：passed 由平台确定性判定（加权分 + severity=high
          // 结构红线 + fail 档三合一，见 contract.ts），不采信模型自报 passed/score。
          passed: !verdict.needsReplan,
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
        onValidationFail: ({ failureReason }) => `请只输出一个路径评审 JSON 对象：dimensions 五维（clarity/integrity/depth/practicality/pertinence）各填 strong|adequate|weak|fail 档位（不要小数分数），先在 issues 里列具体缺陷（含 severity/dimension/description/suggestion）再定档；存在 severity=high 缺陷、或五维出现任意 fail/weak 档位、或加权分不达 0.75 时必须给出具体 replanInstructions。上次失败原因：${failureReason}`,
      },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'PATH_REVIEWER_INVALID');
    }

    // 总分与 dimensions 加权一致性（确定性兜底，防 LLM 自报总分与分项不一致）：
    // normalizeOutput 已按同一公式重算；这里再算一次，保证 skill 直调也同一口径。
    const dimensions = result.output.dimensions as PathReviewDimensions;
    const finalScore = computePathReviewScore(dimensions);

    return {
      success: true,
      output: {
        score: finalScore,
        dimensions,
        issues: result.output.issues,
        // #172-6① + 2026-11-22 合取闸：passed 沿用 normalizeOutput 的确定性判定
        // （加权分 ∨ severity=high ∨ fail 档）——分数可复算，fail 档信息只在归一化层可得，
        // 这里不再用纯阈值重判，否则合取闸会被稀释。
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