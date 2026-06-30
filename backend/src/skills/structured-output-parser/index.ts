/**
 * structured-output-parser Skill
 *
 * 通用的结构化输出解析器。
 * 从 LLM 原始响应中提取 JSON 对象，处理 markdown 代码块、裸 JSON、多段落等场景。
 *
 * 所有 agent 的 JSON 解析都可复用此 skill 以消除重复代码。
 */

import { SkillDefinition, SkillExecutionResult } from '../protocol'

export const STRUCTURED_OUTPUT_PARSER_PROMPT = ''

export const structuredOutputParserDefinition: SkillDefinition = {
  name: 'structured-output-parser',
  displayName: '结构化输出解析器',
  version: '1.0.0',
  category: 'parsing',
  description: '从 LLM 原始响应中提取 JSON 对象，处理 markdown 代码块、裸 JSON、多段落等场景',
  capabilities: ['json-extraction', 'markdown-parsing', 'structured-output-validation'],
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'LLM 原始响应文本' },
      mode: { type: 'string', description: '解析模式: auto / strict / tolerant' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      parsedJson: { type: 'object', description: '解析出的 JSON 对象，失败时为 null' },
      parseMode: { type: 'string', description: '实际使用的解析模式' },
      extractionMethod: { type: 'string', description: '提取方法: json_block / bare_json / markdown_fenced / none' }
    }
  },
  stats: { callCount: 0, successRate: 1, avgLatency: 0 }
}

export interface StructuredOutputParserInput {
  content: string
  mode?: 'auto' | 'strict' | 'tolerant'
}

export interface StructuredOutputParserOutput {
  parsedJson: any
  parseMode: string
  extractionMethod: 'json_block' | 'bare_json' | 'markdown_fenced' | 'none'
  valid: boolean
  failureType: string
  violations: string[]
}

export async function structuredOutputParser(
  input: StructuredOutputParserInput
): Promise<SkillExecutionResult<StructuredOutputParserOutput>> {
  const startedAt = Date.now()
  try {
    const result = extractStructuredPayload(input.content, input.mode || 'auto')
    return {
      success: true,
      output: result,
      duration: Date.now() - startedAt
    }
  } catch (error: any) {
    return {
      success: false,
      error: { code: 'PARSE_FAILED', message: error?.message || '解析失败' },
      duration: Date.now() - startedAt
    }
  }
}

function extractStructuredPayload(content: string, mode: string): StructuredOutputParserOutput {
  const trimmed = (content || '').trim()
  if (!trimmed) {
    return { parsedJson: null, parseMode: mode, extractionMethod: 'none', valid: false, failureType: 'empty_content', violations: ['content is empty'] }
  }

  let jsonStr = ''
  let extractionMethod: StructuredOutputParserOutput['extractionMethod'] = 'none'

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim()
    extractionMethod = 'json_block'
  }

  if (!jsonStr) {
    const fencedMatch = trimmed.match(/```\s*([\s\S]*?)```/)
    const inner = (fencedMatch?.[1] || '').trim()
    if (inner) {
      try { JSON.parse(inner); jsonStr = inner; extractionMethod = 'markdown_fenced' } catch {}
    }
  }

  if (!jsonStr) {
    const braceMatch = extractBareBraceJSON(trimmed)
    if (braceMatch) {
      jsonStr = braceMatch
      extractionMethod = 'bare_json'
    }
  }

  if (!jsonStr) {
    try { JSON.parse(trimmed); jsonStr = trimmed; extractionMethod = 'bare_json' } catch {}
  }

  try {
    const parsedJson = jsonStr ? JSON.parse(jsonStr) : null
    if (parsedJson && typeof parsedJson === 'object') {
      return { parsedJson, parseMode: mode, extractionMethod, valid: true, failureType: 'none', violations: [] }
    }
    return { parsedJson: null, parseMode: mode, extractionMethod, valid: false, failureType: 'parsed_non_object', violations: ['parsed result is not an object'] }
  } catch {
    return { parsedJson: null, parseMode: mode, extractionMethod, valid: false, failureType: 'json_parse_failed', violations: ['JSON.parse failed'] }
  }
}

function extractBareBraceJSON(text: string): string | null {
  const firstBrace = text.indexOf('{')
  if (firstBrace === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(firstBrace, i + 1) }
  }
  return null
}
