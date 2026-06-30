/**
 * Prompt Compiler — 字段引用解析
 * ============================================================
 * 把 prompt 源里的 {{skill:xxx.fieldPath}} 占位符解析为可读的字段说明.
 *
 * 语法:
 *   {{skill:goal-conversation.understanding.surface_goal}}
 *     ↓ 编译后
 *   <字段引用 skill=goal-conversation path=understanding.surface_goal type=string note=...>
 *
 * 当前 MVP 只做"内联文档化" — 把引用 token 渲染成人类可读的注解文本,
 * 让 LLM 知道这里引用了哪个 skill 的哪个字段. 不做真实数据替换 (运行时数据替换是
 * user message JSON 的事, 不是 prompt 的事).
 *
 * 失败兜底: 找不到的引用保留原 token 不动, 加 warning.
 */

import { parsePromptSchema, type WfField } from '../prompt-schema';

export interface FieldRef {
  raw: string;          // 原始 token, 如 {{skill:goal-conversation.understanding.surface_goal}}
  skillId: string;      // 'goal-conversation' 或 'skill:goal-conversation'
  fieldPath: string;    // 'understanding.surface_goal'
  kind: 'input' | 'output' | 'unknown';
}

export interface FieldRefResolveResult {
  text: string;            // 替换后的文本
  refs: FieldRef[];        // 找到的所有引用
  resolved: number;        // 成功解析数
  unresolved: number;      // 未解析数
  warnings: string[];
}

// 引用 token 语法: {{skill:<skillId>.<fieldPath>}}
//   skillId 允许 a-z 0-9 _ - : (支持 'skill:goal-conversation' 或 'goal-conversation')
//   fieldPath 允许 a-z A-Z 0-9 _ . [] -
const REF_TOKEN_RE = /\{\{\s*skill:([a-zA-Z0-9_\-:]+)\.([a-zA-Z0-9_.\[\]\-]+)\s*\}\}/g;

/**
 * 从一段文本里抽出所有引用 token
 */
export function extractFieldRefs(text: string): FieldRef[] {
  const refs: FieldRef[] = [];
  let m: RegExpExecArray | null;
  REF_TOKEN_RE.lastIndex = 0;
  while ((m = REF_TOKEN_RE.exec(text)) !== null) {
    refs.push({
      raw: m[0],
      skillId: m[1],
      fieldPath: m[2],
      kind: 'unknown',
    });
  }
  return refs;
}

/**
 * 用 skill catalog 解析引用并替换为内联注解.
 *
 * @param text 原始 prompt 文本
 * @param resolver 函数: (skillId, fieldPath) → { found, kind, valueType, note } | null
 */
export function resolveFieldRefs(
  text: string,
  resolver: (skillId: string, fieldPath: string) => {
    found: boolean;
    kind: 'input' | 'output' | 'unknown';
    valueType: string | null;
    note: string;
  } | null
): FieldRefResolveResult {
  const refs = extractFieldRefs(text);
  const warnings: string[] = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;

  if (refs.length === 0) {
    return { text, refs, resolved: 0, unresolved: 0, warnings };
  }

  // 替换: 用 String.replace 单遍, 避免重复扫描
  const newText = text.replace(REF_TOKEN_RE, (raw, skillId, fieldPath) => {
    const info = resolver(skillId, fieldPath);
    if (!info || !info.found) {
      unresolvedCount++;
      warnings.push(`未解析的字段引用: ${raw}`);
      return raw; // 保留原 token 不破坏 prompt
    }
    resolvedCount++;
    // 内联渲染为人类可读的注解
    const typeStr = info.valueType ? ` : ${info.valueType}` : '';
    const noteStr = info.note ? ` -- ${info.note}` : '';
    const kindStr = info.kind === 'input' ? '输入' : info.kind === 'output' ? '输出' : '字段';
    return `「${skillId}.${fieldPath}${typeStr}」(${kindStr}${noteStr})`;
  });

  // 更新 refs 的 kind/found 状态 (再扫一次)
  refs.forEach((r) => {
    const info = resolver(r.skillId, r.fieldPath);
    if (info) r.kind = info.kind;
  });

  return {
    text: newText,
    refs,
    resolved: resolvedCount,
    unresolved: unresolvedCount,
    warnings,
  };
}

/**
 * 便利函数: 给定一组 skill 的源文本, 构建 resolver
 */
export function buildResolverFromSkills(
  skills: Array<{
    skillId: string;
    source: string;
  }>
): (skillId: string, fieldPath: string) => ReturnType<Parameters<typeof resolveFieldRefs>[1]> {
  // 预解析所有 skill 的 inputFields / outputFields
  const cache = new Map<
    string,
    { inputs: WfField[]; outputs: WfField[] }
  >();
  for (const s of skills) {
    try {
      const schema = parsePromptSchema(s.source);
      const data = {
        inputs: schema.inputFields || [],
        outputs: schema.outputFields || [],
      };
      cache.set(s.skillId, data);
      // 也允许 +/- skill: 前缀的查询
      if (s.skillId.startsWith('skill:')) {
        cache.set(s.skillId.slice(6), data);
      } else {
        cache.set(`skill:${s.skillId}`, data);
      }
    } catch {
      // ignore parse errors
    }
  }

  return (skillId, fieldPath) => {
    const data = cache.get(skillId);
    if (!data) return { found: false, kind: 'unknown', valueType: null, note: '' };

    const inField = data.inputs.find((f) => f.path === fieldPath);
    if (inField) {
      return {
        found: true,
        kind: 'input',
        valueType: inField.valueType,
        note: inField.note || '',
      };
    }
    const outField = data.outputs.find((f) => f.path === fieldPath);
    if (outField) {
      return {
        found: true,
        kind: 'output',
        valueType: outField.valueType,
        note: outField.note || '',
      };
    }
    return { found: false, kind: 'unknown', valueType: null, note: '' };
  };
}
