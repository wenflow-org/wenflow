/**
 * JSON 提取器（共享核心）
 *
 * 三套提取逻辑在 2026-08 合入本模块（原 skills/structured-output-parser 已退役；
 * goal-conversation 的 structured-validator 复用本核心，仅保留领域校验）：
 *  - extractJsonObject：默认路径（callPrompt），先最简贪婪提取，失败后依次降级：
 *    直接 parse → 剥离代码围栏 → 修复残缺 JSON → 截取首个完整 JSON 对象。
 *    容错链在 2026-08-30 加入（修复 learning-predictor 等默认路径 INVALID_JSON 失败）。
 *  - extractStructuredPayloadWithDialogue：3 级策略（raw-trailing → code-fence → JSON: marker）
 *    + 不完整 JSON 修复 + 对话文本拆分（goal 阶段等需要"正文 + JSON"分离的场景）
 */

function parseJsonLoose(raw: string): { json: string; parsed: any } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  // 1) 直接 parse
  try {
    return { json: raw.trim(), parsed: JSON.parse(raw.trim()) };
  } catch { /* fall through */ }
  // 2) 剥离 ```json / ``` 代码围栏后 parse
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      return { json: fenceMatch[1], parsed: JSON.parse(fenceMatch[1]) };
    } catch { /* fall through */ }
  }
  // 3) 修复残缺 JSON（补右括号/尾逗号/冒号）后 parse。
  //    先剥离到首个 '{'，避免 ```json 前缀/解释文字干扰括号配对与 JSON.parse。
  const firstBrace = raw.indexOf('{');
  if (firstBrace !== -1) {
    const jsonish = raw.slice(firstBrace);
    // 截断的代码围栏：补上闭合标记后再按"围栏内 JSON"修复
    try {
      return { json: jsonish, parsed: safeJsonParse(jsonish) };
    } catch { /* fall through */ }
  }
  // 4) 截取首个完整 JSON 对象（跨层括号配对，丢弃尾部截断/多余文本）
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') {
      if (start === -1) start = i;
      depth += 1;
    } else if (ch === '}' && start !== -1) {
      depth -= 1;
      if (depth === 0) {
        try {
          const slice = raw.slice(start, i + 1);
          return { json: slice, parsed: JSON.parse(slice) };
        } catch { /* fall through */ }
      }
    }
  }
  return null;
}

export function extractJsonObject(raw: string): { extractedJson: string | null; parsed: any | null } {
  const result = parseJsonLoose(raw);
  return result
    ? { extractedJson: result.json, parsed: result.parsed }
    : { extractedJson: raw?.trim() ? raw.match(/\{[\s\S]*\}/)?.[0] ?? null : null, parsed: null };
}

// ============================================================
// 3 级策略提取（含修复与对话文本拆分）
// ============================================================

export type StructuredParseMode = 'json-marker' | 'code-fence' | 'raw-json' | 'none';

export interface StructuredPayloadParseResult {
  parsedJson: any | null;
  dialogueText: string;
  parseMode: StructuredParseMode;
  /** 任一策略检测到 JSON 片段但解析失败（用于失败归因：json_parse_error vs missing_json_block） */
  parseError: boolean;
}

/**
 * 尝试修复不完整 JSON（缺右括号/尾逗号/末尾冒号/奇数引号）。
 * 修复仍是尽力而为，失败由调用方走下一级策略或判定解析失败。
 */
function fixIncompleteJson(jsonStr: string): string {
  let fixed = jsonStr.trim();
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;

  // 先补内层方括号，再补外层大括号：若顺序相反，`[1,2,3,` 会补成 `[1,2,3,}]`，
  // 尾逗号清理后变成 `[1,2,3}]`——右方括号被挤到大括号外，JSON 依旧非法。
  if (openBrackets > closeBrackets) fixed += ']'.repeat(openBrackets - closeBrackets);
  if (openBraces > closeBraces) fixed += '}'.repeat(openBraces - closeBraces);

  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) fixed += '"';

  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.replace(/:\s*$/, ': null');
  return fixed;
}

function safeJsonParse(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return JSON.parse(fixIncompleteJson(jsonStr));
  }
}

function extractJsonFromJsonMarker(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const jsonIndex = content.lastIndexOf('JSON:');
  if (jsonIndex === -1) return { parsedJson: null, dialogueText: content, parseError: false };

  const afterJson = content.substring(jsonIndex + 5).trim();
  let braceCount = 0;
  let jsonStart = -1;
  let jsonEnd = -1;

  for (let i = 0; i < afterJson.length; i += 1) {
    if (afterJson[i] === '{') {
      if (jsonStart === -1) jsonStart = i;
      braceCount += 1;
    } else if (afterJson[i] === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (jsonStart === -1 || jsonEnd === -1) {
    return { parsedJson: null, dialogueText: content, parseError: false };
  }

  try {
    const parsedJson = safeJsonParse(afterJson.substring(jsonStart, jsonEnd));
    return { parsedJson, dialogueText: content.substring(0, jsonIndex).trim(), parseError: false };
  } catch {
    return { parsedJson: null, dialogueText: content, parseError: true };
  }
}

function extractJsonFromCodeFence(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const patterns = [/```json\s*([\s\S]*?)\s*```/, /```\s*([\s\S]*?\})\s*```/];
  let sawFence = false;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    sawFence = true;
    try {
      const parsedJson = safeJsonParse(match[1]);
      return { parsedJson, dialogueText: content.split(match[0])[0].trim(), parseError: false };
    } catch {
      continue;
    }
  }

  return { parsedJson: null, dialogueText: content, parseError: sawFence };
}

function extractRawTrailingJson(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const rawJsonMatch = content.match(/\{[\s\S]*\}$/);
  if (!rawJsonMatch) return { parsedJson: null, dialogueText: content, parseError: false };

  try {
    const parsedJson = safeJsonParse(rawJsonMatch[0]);
    return {
      parsedJson,
      dialogueText: content.substring(0, content.length - rawJsonMatch[0].length).trim(),
      parseError: false
    };
  } catch {
    return { parsedJson: null, dialogueText: content, parseError: true };
  }
}

/**
 * 3 级策略提取：raw-trailing → code-fence → JSON: marker。
 * 返回 JSON 与"正文"（对话文本）的拆分，供"正文 + 结构化 JSON"混合输出场景消费。
 */
export function extractStructuredPayloadWithDialogue(content: string): StructuredPayloadParseResult {
  let parsedJson: any | null = null;
  let dialogueText = content;
  let parseError = false;

  ({ parsedJson, dialogueText, parseError } = extractRawTrailingJson(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'raw-json', parseError: false };
  }

  ({ parsedJson, dialogueText, parseError } = extractJsonFromCodeFence(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'code-fence', parseError: false };
  }

  ({ parsedJson, dialogueText, parseError } = extractJsonFromJsonMarker(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'json-marker', parseError: false };
  }

  return { parsedJson: null, dialogueText: content, parseMode: 'none', parseError };
}
