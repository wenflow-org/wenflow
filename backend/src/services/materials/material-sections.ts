/**
 * 资料章节取回（结构化检索，无向量）：从已落盘的资料正文里，
 * 按「章节标题优先、引文锚定回退」取回一个**原文窗口**。
 *
 * 设计（2026-09-24，parent-child 检索的「取大」半边）：
 * - 打包投影只带 ≤24 条要点/目录；教学回合讲到某条引用时需要**该章节的原文**，
 *   前端点开引用也要直接定位到章节，而不是全文前 4000 字。
 * - quote 在落库时做过空白归一（material-refs.normalizeWhitespace），且空白在中文
 *   文本里无语义 → 匹配前对正文与引文**剥除全部空白**（带原位映射），CJK 场景最稳。
 * - 窗口有硬上限（默认 4000 字），防止把整份文档塞进课堂上下文。
 * - 优先级：标题定位（最长窗口，跳过目录行）> 引文锚定（精确定位）> 全文开头。
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
  /** 命中方式：title=章节标题定位（最长窗口）；quote=引文锚定；none=回退全文开头。 */
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

/** 剥掉 docx 转 md 的装饰（任意 HTML 标签 <a id>/<u>/<div>…、加粗 **），得到行文本——标题判定用它。 */
function lineText(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

/** 标题行层级（数值越小越粗）：ATX 按井号数；「第X部分/章」=1；「一、」=2；「（一）/1、」=3；非标题=4。 */
function headingLevel(line: string): number {
  const trimmed = lineText(line);
  const atx = trimmed.match(/^(#{1,6})\s/);
  if (atx) return atx[1].length;
  if (/^第[一二三四五六七八九十百\d]+(部分|章|讲|单元)/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十]+、/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(trimmed) || /^\d+[、.]/.test(trimmed)) return 3;
  return 4;
}

/**
 * 标题定位：所有命中行里取**最长窗口**——标题常先出现在目录（窗口被下一条目录行
 * 截断，只有几十字），正文标题的窗口才有整章内容；取最长自然跳过目录/交叉引用。
 */
function findByTitle(markdown: string, sectionTitle: string, maxChars: number): string | null {
  // needle 与行文本同源剥装饰（引用落库的 sectionTitle 是原始装饰行，如 <u>一、健康</u>3）
  const base = lineText(String(sectionTitle)).replace(/\s+/g, '').toLowerCase();
  if (!base) return null;
  // docx 目录标题常带页码尾巴（「一、健康3」），正文标题没有 → 补一个去页码变体
  const needles = [base];
  const withoutPageNo = base.replace(/\d+$/, '');
  if (withoutPageNo && withoutPageNo !== base) needles.push(withoutPageNo);
  const lines = markdown.split('\n');
  const needleCap = Math.max(...needles.map((n) => n.length)) + 12;
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lineText(lines[i]).replace(/\s+/g, '').toLowerCase();
    // 标题行必然与标题等长（短行）；正文句里顺带提到标题词的长行不算候选——
    // 否则「最长窗口」会被远处的顺带提及劫持（实测：短标题「说明」落在社会领域的长句上）
    if (line.length <= needleCap && needles.some((n) => line.includes(n))) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  let best: string | null = null;
  for (const startLine of candidates.slice(0, 20)) {
    // 起始行不是标题形态（标题匹配到正文句）时按细粒度处理：任何标题行都可截断
    const matchedLevel = Math.min(headingLevel(lines[startLine]), 3);
    const out: string[] = [];
    let length = 0;
    for (let i = startLine; i < lines.length && length < maxChars; i += 1) {
      // 「一、」形态既是章节标题也是列举段落的段首——真标题是短行（CJK 40 字内），
      // 长行（一、为深入贯彻……）是段落，不能截断窗口（实测：说明节正文全以一、二、三、开头）
      if (
        i > startLine &&
        headingLevel(lines[i]) <= matchedLevel &&
        lineText(lines[i]).length <= 40
      ) break;
      out.push(lines[i]);
      length += lines[i].length + 1;
    }
    const excerpt = out.join('\n');
    if (!best || excerpt.length > best.length) best = excerpt;
    if (best.length >= maxChars) break; // 已到上限，不会有更长的候选
  }
  return best;
}

/**
 * 取章节原文窗口。优先级：章节标题 > 引文锚定 > 回退全文开头
 * （计划定案：消费者（课堂注入/前端点引用）要的都是「那一章」；
 *   引文兜底负责无标题引用的精确定位。另外标题定位走最长窗口，
 *   天然跳过目录行，而引文锚定对 docx 目录装饰行会命中目录区）。
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

  if (options.sectionTitle) {
    const byTitle = findByTitle(text, String(options.sectionTitle), maxChars);
    if (byTitle) {
      return { excerpt: byTitle, anchor: 'title' };
    }
  }

  const byQuote = options.quote ? findByQuote(text, String(options.quote), maxChars) : null;
  if (byQuote) {
    return { excerpt: byQuote, anchor: 'quote' };
  }

  return { excerpt: text.slice(0, maxChars), anchor: 'none' };
}
