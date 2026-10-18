/**
 * 联网正文的「结构恢复」（2026-10-17）。
 *
 * 真机发现：抓取 provider 返回的 markdown 常常是**扁平文本**——章节标题只是普通行，
 * 全文一个 `#` 都没有（50 份长文里 48 份如此）。而 `document-parser` 对 `.md` 只从
 * ATX 标题建锚点，于是联网资料的 `anchors` 恒为空，path 资料包的 sections/keyPoints
 * 只能退回「正文前 24 行」，整份长文的后半段在路径阶段彻底不可见。
 *
 * 这里在**入库前**按确定性规则把明显的标题行补成 ATX；只在原文几乎没有 ATX 标题时动手
 * （已经结构良好的 markdown 原样返回）。规则刻意保守：宁少认，不把正文句子误当标题。
 */

const ATX_RE = /^#{1,6}\s+\S/;

/** 明确的结构化标题写法（按层级）。 */
const STRUCTURE_PATTERNS: Array<{ re: RegExp; level: number }> = [
  { re: /^第[一二三四五六七八九十百零〇\d]+篇\s*\S/, level: 2 },
  { re: /^第[一二三四五六七八九十百零〇\d]+[章讲]\s*\S/, level: 3 },
  { re: /^第[一二三四五六七八九十百零〇\d]+节\s*\S/, level: 4 },
  { re: /^[一二三四五六七八九十]+[、.．]\s*\S/, level: 4 },
  { re: /^（[一二三四五六七八九十]+）\s*\S/, level: 5 },
  { re: /^\([一二三四五六七八九十]+\)\s*\S/, level: 5 },
];

/**
 * 小节编号（`4.1 一般要求`、`3、 实施步骤`）：**必须带空白**才认。
 * 不带空白的 `1、熟悉教材` 与普通编号列表无法区分——真机实测这类误判在大纲文档里
 * 能刷出上千条假标题（400 上限直接打满），所以降级为弱规则。
 */
const NUMBERED_SECTION_RE = /^(?:\d{1,2}(?:\.\d{1,2})+|\d{1,2}[、.．])\s+\S/;
const NUMBERED_SECTION_MAX_CHARS = 30;

/** 整行就是这些词时按二级标题处理（书的常见骨架）。 */
const TITLE_WORDS = new Set([
  '目录', '前言', '序', '序言', '引言', '导言', '绪论', '附录', '参考文献',
  '后记', '跋', '致谢', '索引', '作者简介', '内容简介',
]);

/** 目录行：以省略号/点线连页码，或行尾是纯页码。 */
const TOC_LINE_RE = /(\.{3,}|…{2,}|·{3,})|[\s.·．]{2,}\d{1,4}\s*$/;
const PAGE_NO_RE = /^[-—–\s]*(第\s*)?\d{1,4}\s*(页)?[-—–\s]*$/;
const URL_ONLY_RE = /^(https?:\/\/|www\.)\S+$/i;
const SENTENCE_PUNCT_RE = /[。，；：！？,;:!?]/;
const BULLET_RE = /^[-*+•·]\s+/;

export const MAX_DERIVED_HEADINGS = 400;

export interface WebStructureNormalization {
  markdown: string;
  /** 补出的标题数（0 = 未改动）。 */
  headings: number;
}

/** 该行是否是「可补成标题」的行；返回层级，null = 不是。 */
function headingLevelOf(rawLine: string): number | null {
  const line = String(rawLine || '').trim();
  if (line.length < 2 || line.length > 40) return null;
  if (ATX_RE.test(line) || BULLET_RE.test(line)) return null;
  if (PAGE_NO_RE.test(line) || URL_ONLY_RE.test(line) || TOC_LINE_RE.test(line)) return null;
  if (SENTENCE_PUNCT_RE.test(line)) return null;

  const compact = line.replace(/\s+/g, '');
  if (TITLE_WORDS.has(compact)) return 2;
  for (const { re, level } of STRUCTURE_PATTERNS) {
    if (re.test(line)) return level;
  }
  if (line.length <= NUMBERED_SECTION_MAX_CHARS && NUMBERED_SECTION_RE.test(line)) return 5;
  return null;
}

/**
 * 把扁平正文里的结构标题补成 ATX。已有 ≥2 个 ATX 标题的文档视为“已结构化”，原样返回。
 */
export function normalizeWebTextStructure(text: string): WebStructureNormalization {
  const source = String(text || '');
  if (!source.trim()) return { markdown: source, headings: 0 };

  const lines = source.split(/\r?\n/);
  const existing = lines.filter((line) => ATX_RE.test(line.trim())).length;
  if (existing >= 2) return { markdown: source, headings: 0 };

  let headings = 0;
  const out: string[] = [];
  for (const raw of lines) {
    if (headings >= MAX_DERIVED_HEADINGS) {
      out.push(raw);
      continue;
    }
    const level = headingLevelOf(raw);
    if (level === null) {
      out.push(raw);
      continue;
    }
    headings += 1;
    out.push(`${'#'.repeat(level)} ${raw.trim()}`);
  }
  return { markdown: out.join('\n'), headings };
}
