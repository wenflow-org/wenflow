/**
 * 用户可见文本的**内部流程术语**收口（2026-10-12）。
 *
 * 背景：stage-designer / path-planning 是内部流水线角色，其提示词动词会随生成文本漏到
 * 学习者面前——实测 lp_1791817016486_mot0ov1 两条任务标题写成「回捞学科全景框架并校准理论映射」
 * 「回捞学习理论，整理动机差异与学习机制的对照清单」，而任务标题在学习路径页**直接渲染**。
 * 「回捞」是跨阶段回访巩固的内部动作名，学习者语言是「回顾」。
 *
 * 与 path-naming.ts 同族：**确定性**替换（不新增 LLM 调用、不改语义），命中即打标
 * （约定：允许降级，不允许未打标降级）。prompt 层管口径（path-planning.yaml 已禁止
 * 「回捞…关系」句式复读），本模块管下限——代码保证用户可见标题不含内部动作名。
 */

/** 内部流程术语 → 学习者语言。只收「出现在用户可见文本里必然是漏出」的词，避免误伤正常用词。 */
export const INTERNAL_PROCESS_TERMS: ReadonlyArray<{ term: string; replacement: string }> = [
  { term: '回捞', replacement: '回顾' },
];

export interface UserFacingTextResult {
  /** 替换后的文本（无命中时原样返回） */
  text: string;
  /** 实际命中的内部词（按词表顺序）；空数组=未命中 */
  replaced: string[];
}

/**
 * 剔除用户可见文本里的内部流程术语。纯函数、幂等。
 * 传入非字符串（模型漏字段）时原样返回，交由调用方各自的空值兜底。
 */
export function sanitizeUserFacingText(raw: unknown): UserFacingTextResult {
  const original = typeof raw === 'string' ? raw : '';
  if (!original) return { text: original, replaced: [] };
  let text = original;
  const replaced: string[] = [];
  for (const { term, replacement } of INTERNAL_PROCESS_TERMS) {
    if (text.includes(term)) {
      text = text.split(term).join(replacement);
      replaced.push(term);
    }
  }
  return { text, replaced };
}

/**
 * 「回捞…关系」式模板复读句（prompt 已禁止，这里是**可观测信号**，不阻断生成）。
 * 必须在 sanitizeUserFacingText **之前**用原始文本调用——替换后词面已变，检测不到。
 */
const BOILERPLATE_RELATION_RE = /回捞[^。；，,、\n]{0,40}关系/;

export function detectBoilerplateClause(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const matched = raw.match(BOILERPLATE_RELATION_RE);
  return matched ? matched[0] : null;
}
