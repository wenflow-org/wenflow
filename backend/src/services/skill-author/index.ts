/**
 * Skill Author Service - V3.5
 * ============================================================
 * 双能力服务：
 *   1. draftSkillPrompt() - "Prompt-AI"：经 skill:skill-author 起草新 skill 的 system prompt
 *   2. compileSkill() - "Skill Compiler"：经 skill:skill-compiler 单轮验收必填字段覆盖
 *
 * 两个能力均为正式 v4 Skill；prompt 真相源为 prompts/core/skill-author.yaml 与
 * prompts/core/skill-compiler.yaml（ACTIVE 存于 agent_prompts）。
 */

import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import { logger } from '../../utils/logger';

export interface DraftSkillPromptInput {
  skillId: string;
  displayName: string;
  description: string;
  /** 该 skill 必须输出的字段（来自 fieldBindings 协议或 admin 选择） */
  requiredFields: Array<{
    fieldId: string;
    valueType: string;
    description?: string;
    enumValues?: string[];
  }>;
  /** 可选：示例输入用于上下文 */
  sampleInput?: Record<string, unknown>;
  /** 可选：admin 的额外要求 */
  authorNote?: string;
}

export interface DraftSkillPromptResult {
  systemPrompt: string;
  outputSchemaSummary: string;
  durationMs: number;
  modelUsed?: string;
  metaRulesVersion: string;
}

const META_RULES_VERSION = 'v1.0.0-2026-06-18';

export async function draftSkillPrompt(
  input: DraftSkillPromptInput
): Promise<DraftSkillPromptResult> {
  const start = Date.now();

  const result = await executeSkillWithResult(auxSkillDefinitionMap['skill-author'], {
    ...input,
    __prompt: { requestPath: '/services/skill-author/draft' },
  });
  const systemPrompt = String(result.output || '').trim();
  if (!systemPrompt) {
    throw new Error('SKILL_AUTHOR_EMPTY_OUTPUT');
  }

  const outputSchemaSummary = input.requiredFields
    .map((f) => `${f.fieldId}: ${f.valueType}${f.enumValues?.length ? ` (enum)` : ''}`)
    .join('\n');

  return {
    systemPrompt,
    outputSchemaSummary,
    durationMs: Date.now() - start,
    modelUsed: result.debug.model || undefined,
    metaRulesVersion: META_RULES_VERSION,
  };
}

// ============================================================
// Skill Compiler
// ============================================================

export interface CompileSkillInput {
  /** 待验证的 system prompt 全文 */
  systemPrompt: string;
  /** 必须能在 LLM 输出中找到的 fieldId 列表（dot 路径，如 understanding.real_problem） */
  requiredFieldIds: string[];
  /** 测试用 user 输入（默认是 "{}" 或 description 文本） */
  testUserPrompt: string;
  /** 可选：覆盖 model / temperature / maxTokens */
  modelOverride?: string;
  temperatureOverride?: number;
  maxTokensOverride?: number;
}

export interface CompileSkillResult {
  pass: boolean;
  rawOutput: string;
  parsedJson: any;
  parseError?: string;
  /** 检查每个 fieldId 的命中情况 */
  fieldHits: Array<{
    fieldId: string;
    found: boolean;
    rawValue?: any;
  }>;
  missingFields: string[];
  durationMs: number;
  modelUsed?: string;
  /** 平台给的可读建议（不调 LLM，是规则推导） */
  suggestions: string[];
}

/**
 * 取嵌套对象路径上的值；返回 [found, value]
 */
function getByPath(obj: any, path: string): [boolean, any] {
  if (!obj || typeof obj !== 'object') return [false, undefined];
  const parts = path.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return [false, undefined];
    if (typeof cur !== 'object') return [false, undefined];
    if (!(p in cur)) return [false, undefined];
    cur = cur[p];
  }
  // 命中条件：key 存在；即便 value=null/""/[] 也算 found（让 LLM 显式声明）
  return [true, cur];
}

export async function compileSkill(input: CompileSkillInput): Promise<CompileSkillResult> {
  const start = Date.now();
  const suggestions: string[] = [];

  if (!input.systemPrompt || !input.systemPrompt.trim()) {
    return {
      pass: false,
      rawOutput: '',
      parsedJson: null,
      parseError: 'empty system prompt',
      fieldHits: input.requiredFieldIds.map((fieldId) => ({ fieldId, found: false })),
      missingFields: [...input.requiredFieldIds],
      durationMs: Date.now() - start,
      suggestions: ['system prompt 为空，无法编译'],
    };
  }

  if (!Array.isArray(input.requiredFieldIds) || input.requiredFieldIds.length === 0) {
    suggestions.push('未声明任何必填字段；编译只能验证 JSON 格式正确性');
  }

  let rawOutput = '';
  let modelUsed: string | undefined;
  try {
    const result = await executeSkillWithResult(auxSkillDefinitionMap['skill-compiler'], {
      ...input,
      __prompt: { requestPath: '/services/skill-author/compile' },
    });
    rawOutput = result.output?.rawOutput || result.debug?.rawModelOutput || '';
    modelUsed = result.debug?.model || undefined;
    if (result.success && result.output) {
      const parsedJson = result.output.parsedJson ?? null;
      const modelMissing = Array.isArray(result.output.missingFields) ? result.output.missingFields : [];
      const fieldHits = input.requiredFieldIds.map((fieldId) => {
        const [found, rawValue] = getByPath(parsedJson, fieldId);
        return { fieldId, found: found && !modelMissing.includes(fieldId), rawValue };
      });
      const missingFields = fieldHits.filter((h) => !h.found).map((h) => h.fieldId);
      if (missingFields.length > 0) {
        suggestions.push(`Prompt 中应明确列出每个必填字段：${missingFields.join(', ')}`);
        suggestions.push('在 prompt 中给每个字段一个简短的"如何推断"说明 + 一个示例值');
      }
      const pass = missingFields.length === 0 && result.output.pass !== false && parsedJson !== null && typeof parsedJson === 'object';
      if (pass) suggestions.push('编译通过 ✓ 单轮解析覆盖所有必填字段');
      return {
        pass,
        rawOutput,
        parsedJson,
        fieldHits,
        missingFields,
        durationMs: Date.now() - start,
        modelUsed,
        suggestions,
      };
    }
    logger.error('[skill-compiler] LLM call failed', { error: 'SKILL_COMPILER_FAILED' });
  } catch (err) {
    logger.error('[skill-compiler] LLM call failed', { error: (err as Error).message });
  }
}

export const __META_RULES_VERSION__ = META_RULES_VERSION;
