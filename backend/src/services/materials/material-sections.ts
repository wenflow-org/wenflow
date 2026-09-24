/**
 * 资料章节取回（结构化检索，无向量）：从已落盘的资料正文里，
 * 按「引用锚定优先、章节标题回退」取回一个**原文窗口**。
 *
 * 设计（2026-09-24，parent-child 检索的「取大」半边）：
 * - 打包投影只带 ≤24 条要点/目录；教学回合讲到某条引用时需要**该章节的原文**，
 *   前端点开引用也要直接定位到章节，而不是全文前 4000 字。
 * - quote 在落库时做过空白归一（material-refs.normalizeWhitespace），且空白在中文
 *   文本里无语义 → 匹配前对正文与引文**剥除全部空白**（带原位映射），CJK 场景最稳。
 * - 窗口有硬上限（默认 4000 字），防止把整份文档塞进课堂上下文。
 */

export interface SectionWindowOptions {
  /** 章节标题（materialRefs.sectionTitle，原文措辞）。 */
  sectionTitle?: string | null;
  /** 逐字引文（materialRefs.quote，已空白归一）。 */
  quote?: string | null;
  /** 窗口最大字符数，默认 4000。 */
  maxChars?: number;
}

export interface MaterialSectionWindow {
  excerpt: string;
  /** 命中方式：quote=引文锚定（最可靠）；title=章节标题定位；none=回退全文开头。 */
  anchor: 'quote' | 'title' | 'none';
}

/** 教学回合注入用的「当前任务引用章节原文窗口」（带出处元信息）。 */
export interface ActiveTaskMaterialExcerpt {
  materialId: string;
  materialName: string;
  sectionTitle: string | null;
  quote: string | null;
  anchor: MaterialSectionWindow['anchor'];
  excerpt: string;
}

/** 剥除全部空白：返回压平文本 + 每个压平字符在原文中的下标映射。 */
function flattenForSearch(text: string): { flat: string; map: number[] } {
  const flatChars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue;
    flatChars.push(text[i]);
    map.push(i);
  }
  return { flat: flatChars.join(''), map };
}

function lineStartAt(markdown: string, pos: number): number {
  return markdown.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
}

/** 引文锚定：剥空白查找；命中后取「前 1/4 + 后 3/4」窗口（向后信息密度更高），硬上限 maxChars。 */
function findByQuote(markdown: string, quote: string, maxChars: number): string | null {
  if (!quote.trim()) return null;
  const { flat, map } = flattenForSearch(markdown);
  const needle = quote.replace(/\s+/g, '');
  if (!needle) return null;
  const probes = needle.length > 80 ? [needle, needle.slice(0, 80), needle.slice(-60)] : [needle];
  for (const probe of probes) {
    const pos = flat.indexOf(probe);
    if (pos === -1) continue;
    const originalStart = map[pos] ?? 0;
    const originalEnd = (map[Math.min(pos + probe.length - 1, map.length - 1)] ?? originalStart) + 1;
    const back = Math.floor(maxChars / 4);
    let start = Math.max(0, originalStart - back);
    let excerpt = markdown.slice(start, Math.min(markdown.length, originalEnd + maxChars));
    if (excerpt.length > maxChars) excerpt = excerpt.slice(0, maxChars);
    start = lineStartAt(markdown, start);
    return markdown.slice(start, start + excerpt.length);
  }
  return null;
}

/** 标题行层级（数值越小越粗）：ATX 按井号数；「第X部分/章」=1；「一、」=2；「（一）/1、」=3；非标题=4。 */
function headingLevel(line: string): number {
  const trimmed = line.trim();
  const atx = trimmed.match(/^(#{1,6})\s/);
  if (atx) return atx[1].length;
  if (/^第[一二三四五六七八九十百\d]+(部分|章|讲|单元)/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十]+、/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(trimmed) || /^\d+[、.]/.test(trimmed)) return 3;
  return 4;
}

/** 标题定位：找包含标题的行，从该行起到下一个**同级或更粗**的标题行（子标题算本节内容）或 maxChars 上限。 */
function findByTitle(markdown: string, sectionTitle: string, maxChars: number): string | null {
  const needle = sectionTitle.replace(/\s+/g, '').toLowerCase();
  if (!needle) return null;
  const lines = markdown.split('\n');
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].replace(/\s+/g, '').toLowerCase().includes(needle)) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;
  // 起始行不是标题形态（标题匹配到正文句）时按细粒度处理：任何标题行都可截断
  const matchedLevel = Math.min(headingLevel(lines[startLine]), 3);
  const out: string[] = [];
  let length = 0;
  for (let i = startLine; i < lines.length && length < maxChars; i += 1) {
    if (i > startLine && headingLevel(lines[i]) <= matchedLevel) break;
    out.push(lines[i]);
    length += lines[i].length + 1;
  }
  return out.join('\n');
}

/**
 * 取章节原文窗口。优先级：引文锚定 > 章节标题 > 回退全文开头。
 * 永不抛错、excerpt 一定非空（有正文时）。
 */
export function extractSectionWindow(
  markdown: string,
  options: SectionWindowOptions,
  maxChars = 4000
): MaterialSectionWindow {
  const text = String(markdown || '');
  if (!text.trim()) {
    return { excerpt: '', anchor: 'none' };
  }

  const byQuote = options.quote ? findByQuote(text, String(options.quote), maxChars) : null;
  if (byQuote) {
    return { excerpt: byQuote, anchor: 'quote' };
  }

  if (options.sectionTitle) {
    const byTitle = findByTitle(text, String(options.sectionTitle), maxChars);
    if (byTitle) {
      return { excerpt: byTitle, anchor: 'title' };
    }
  }

  return { excerpt: text.slice(0, maxChars), anchor: 'none' };
}
