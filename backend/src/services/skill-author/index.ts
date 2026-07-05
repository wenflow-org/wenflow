/**
 * Skill Author Service - V3.5
 * ============================================================
 * 双能力服务：
 *   1. draftSkillPrompt() - "Prompt-AI"：用元规则模板让 LLM 起草新 skill 的 system prompt
 *   2. compileSkill() - "Skill Compiler"：单轮调 skill prompt + 解析必填字段 + pass 判定
 *
 * 元规则被写死在 META_RULES_TEMPLATE 中，admin 不可改（V3.5 设计）。
 */

import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { logger } from '../../utils/logger';

// ============================================================
// 元规则模板（admin 不可改，必须走代码 PR 修改）
// ============================================================
const META_RULES_TEMPLATE = `你是「问流」教育平台的 Prompt 设计助手。

【你的任务】
为下面的 skill 起草一份 system prompt 草稿，让 LLM 在按这份 prompt 工作时，能稳定输出"约定字段"。
你的输出会被平台的 Skill Compiler 自动验收：单轮跑一次 LLM，看你设计的 prompt 是否能让 LLM 产出所有必填字段。

【硬性输出契约（不可破）】
1. LLM 的回复必须是合法的 JSON。
2. JSON 顶层必须是单个 object，不要包外层数组、不要返回多个对象。
3. JSON 中必须包含每一个【约定字段】的 key，缺一不可——即使你不知道该填什么，也填 null 或 ""。
4. 不允许在 JSON 之外额外输出 markdown / 注释 / 自然语言解释。
5. 如果约定字段是 string[]，请输出真数组；如果是 enum，必须从给定枚举中选；如果是 object，遵循 schema。
6. 不要在 prompt 中暴露这个元规则文本本身。

【设计原则】
- 角色定位先行：第一段告诉 LLM "你是谁、给谁服务、目标是什么"。
- 输入消化：第二段告诉 LLM "你会拿到什么样的输入"。
- 字段产出指引：第三段逐字段说明"应该如何推断 / 提取 / 生成它"，并给一个简短示例。
- JSON 输出格式：最后明确给出"输出格式 = {字段}: {类型}"清单（不是 JSON Schema，是给 LLM 的口语化清单）。
- 简洁：保持 600-1500 字，不要写超过这个长度。

【你的输出格式】
直接输出 system prompt 全文，不要任何前后缀解释。`;

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

function buildAuthorUserPrompt(input: DraftSkillPromptInput): string {
  const fieldsBlock = input.requiredFields
    .map((f, i) => {
      const enumPart = f.enumValues?.length ? `（枚举：${f.enumValues.join(' / ')}）` : '';
      const desc = f.description ? `——${f.description}` : '';
      return `${i + 1}. ${f.fieldId}: ${f.valueType}${enumPart}${desc}`;
    })
    .join('\n');

  const sampleBlock = input.sampleInput
    ? `\n【示例输入】\n${JSON.stringify(input.sampleInput, null, 2)}`
    : '';

  const noteBlock = input.authorNote ? `\n【管理员额外要求】\n${input.authorNote}` : '';

  return `【目标 skill】
- skillId: ${input.skillId}
- displayName: ${input.displayName}
- description: ${input.description}

【约定字段（必须每个都出现在 LLM 的 JSON 输出中）】
${fieldsBlock}
${sampleBlock}${noteBlock}

请直接输出 system prompt 全文。`;
}

export async function draftSkillPrompt(
  input: DraftSkillPromptInput
): Promise<DraftSkillPromptResult> {
  const start = Date.now();

  const messages: ChatMessage[] = [
    { role: 'system', content: META_RULES_TEMPLATE },
    { role: 'user', content: buildAuthorUserPrompt(input) },
  ];

  const gateway = getAPIGateway();
  const caller: CallerInfo = { skillId: 'platform:skill-author' };

  const response = await gateway.execute(
    {
      messages,
      max_tokens: 2400,
      temperature: 0.5,
    },
    caller,
    {}
  );

  const systemPrompt = (response.choices[0]?.message?.content || '').trim();
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
    modelUsed: (response as any).model,
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

/**
 * 尝试从 LLM 文本中提取 JSON。容错策略：
 *   1. 整体 JSON.parse
 *   2. 找第一个 { 到最后一个 } 之间的子串再 parse
 *   3. 找 ```json ... ``` 代码块
 */
function extractJson(text: string): { ok: true; data: any } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty output' };

  // 优先 ```json fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return { ok: true, data: JSON.parse(fenceMatch[1].trim()) };
    } catch {
      // fallthrough
    }
  }

  // 整体 parse
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    // fallthrough
  }

  // 子串 parse
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sub = trimmed.slice(first, last + 1);
    try {
      return { ok: true, data: JSON.parse(sub) };
    } catch (err) {
      return { ok: false, error: `JSON parse failed: ${(err as Error).message}` };
    }
  }

  return { ok: false, error: 'no JSON object found in output' };
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

  const messages: ChatMessage[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.testUserPrompt || '请按 system prompt 的要求输出 JSON。' },
  ];

  const gateway = getAPIGateway();
  const caller: CallerInfo = { skillId: 'platform:skill-compiler' };

  let rawOutput = '';
  let modelUsed: string | undefined;
  try {
    const response = await gateway.execute(
      {
        messages,
        max_tokens: input.maxTokensOverride || 2000,
        temperature: input.temperatureOverride ?? 0.3,
        model: input.modelOverride,
      },
      caller,
      {}
    );
    rawOutput = response.choices[0]?.message?.content || '';
    modelUsed = (response as any).model;
  } catch (err) {
    logger.error('[skill-compiler] LLM call failed', { error: (err as Error).message });
    return {
      pass: false,
      rawOutput: '',
      parsedJson: null,
      parseError: `LLM 调用失败：${(err as Error).message}`,
      fieldHits: input.requiredFieldIds.map((fieldId) => ({ fieldId, found: false })),
      missingFields: [...input.requiredFieldIds],
      durationMs: Date.now() - start,
      suggestions: ['LLM 调用失败，请检查 API Key / 模型配置'],
    };
  }

  const extract = extractJson(rawOutput);
  if (extract.ok === false) {
    suggestions.push('Prompt 应明确要求"只输出 JSON，不要 markdown / 注释 / 解释"');
    suggestions.push('在 prompt 末尾追加示例输出 JSON 块，引导格式');
    return {
      pass: false,
      rawOutput,
      parsedJson: null,
      parseError: extract.error,
      fieldHits: input.requiredFieldIds.map((fieldId) => ({ fieldId, found: false })),
      missingFields: [...input.requiredFieldIds],
      durationMs: Date.now() - start,
      modelUsed,
      suggestions,
    };
  }

  const parsedJson = extract.data;
  const fieldHits = input.requiredFieldIds.map((fieldId) => {
    const [found, rawValue] = getByPath(parsedJson, fieldId);
    return { fieldId, found, rawValue };
  });
  const missingFields = fieldHits.filter((h) => !h.found).map((h) => h.fieldId);

  if (missingFields.length > 0) {
    suggestions.push(`Prompt 中应明确列出每个必填字段：${missingFields.join(', ')}`);
    suggestions.push('在 prompt 中给每个字段一个简短的"如何推断"说明 + 一个示例值');
  }

  // 即便 missingFields 为空，也要确认 JSON 不是空对象等异常
  const pass = missingFields.length === 0 && parsedJson !== null && typeof parsedJson === 'object';

  if (pass) {
    suggestions.push('编译通过 ✓ 单轮解析覆盖所有必填字段');
  }

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

export const __META_RULES_VERSION__ = META_RULES_VERSION;
