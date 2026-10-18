/**
 * 资料正文**确定性分块**（向量检索与代表采样的共同底座）。
 *
 * 为什么不复用 material-pack 的 sections：pack 的章节只带 preview（几十字摘要），
 * 是给提示词「目录」用的；向量召回与 brief 采样都需要**成段原文**，因此这里按行切、按字符预算聚合。
 *
 * 切分规则（确定性、无 LLM、无外部依赖）：
 *   - 标题行开新块（ATX `#` / 「第X部分·章·讲·单元」/「一、」/「（一）」/「1、」「1.」）；
 *   - 超长块按空行段落贪心聚合，块间带 overlap 字符重叠（跨块语义不丢）；
 *   - 纯样板行（页码/页眉/导航，见 isProseTextLine）丢弃，除非它本身是标题行。
 *
 * 边界：单块 ≤ maxChars；总块数 ≤ maxChunks（超出按顺序截断，防超长资料把成本撑爆）。
 */

import { isProseTextLine } from './document-parser.types';

export interface MaterialChunk {
  /** 稳定 id（c-1、c-2…按正文顺序），供引用回指。 */
  id: string;
  /** 块所属标题（无标题块用块首行兜底）。 */
  title: string;
  /** 块正文（含标题行）。 */
  text: string;
  /** 正文长度（字符）。 */
  charCount: number;
  /** 在全文中的序号（0 起）。 */
  index: number;
}

export interface ChunkOptions {
  /** 单块最大字符数，默认 900。 */
  maxChars?: number;
  /** 块间重叠字符数，默认 120。 */
  overlapChars?: number;
  /** 最多产出块数，默认 200。 */
  maxChunks?: number;
}

export const DEFAULT_CHUNK_CHARS = 900;
export const DEFAULT_CHUNK_OVERLAP = 120;
export const MAX_MATERIAL_CHUNKS = 200;

/** 剥掉 docx 转 md 的装饰（任意 HTML 标签、加粗 **）得到行文本——注意**不剥 ATX 井号**，否则标题判定失效。 */
function headingText(line: string): string {
  return String(line ?? '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
}

/** 标题行层级（数值越小越粗）；非标题返回 4。与 material-sections 同款判定，保持两侧一致。 */
function headingLevel(line: string): number {
  const trimmed = headingText(line);
  const atx = trimmed.match(/^(#{1,6})\s/);
  if (atx) return atx[1].length;
  if (/^第[一二三四五六七八九十百\d]+(部分|章|讲|单元)/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十]+、/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(trimmed) || /^\d+[、.]/.test(trimmed)) return 3;
  return 4;
}

function isHeadingLine(line: string): boolean {
  if (!line.trim()) return false;
  // 长行（CJK 40 字以上）不算标题——「一、为深入贯彻……」是段落首，不是标题
  return headingLevel(line) < 4 && headingText(line).length <= 40;
}

/** 行是否保留进块：标题行恒留；正文行须「像正文」（样板行丢弃）；空行保留做段落分隔。 */
function keepLine(line: string): boolean {
  if (!line.trim()) return true;
  if (isHeadingLine(line)) return true;
  return isProseTextLine(line);
}

/** 把一段文本按空行切成段落（保留内部换行）。 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 硬切超长段落：单个段落本身超过 maxChars 时按字符窗口切开。
 * 必要性：真实语料里存在「一整篇没有一个空行」的长文（联网抓取的正文、单段排版的文章），
 * 若不硬切，会产出超过上游单条文本上限（bge-m3 8192 token）的块，导致该资料**整篇索引失败**。
 */
function hardSplitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
  return out;
}

/** 贪心聚合段落成 ≤ maxChars 的子块；相邻子块间带 overlap 重叠。 */
function packParagraphs(paragraphs: string[], maxChars: number, overlapChars: number): string[] {
  const out: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    if (!buffer) {
      buffer = paragraph;
      continue;
    }
    if (buffer.length + paragraph.length + 2 <= maxChars) {
      buffer = `${buffer}\n\n${paragraph}`;
      continue;
    }
    out.push(buffer);
    const tail = overlapChars > 0 && buffer.length > overlapChars ? buffer.slice(-overlapChars) : '';
    buffer = tail ? `${tail}\n\n${paragraph}` : paragraph;
  }
  if (buffer) out.push(buffer);
  return out;
}

/**
 * 主入口：正文 → 块序列。
 *
 * **按字符预算贪心合并相邻小节**（2026-10-16 真机修正）：初版「一个标题行 = 一块」在真实语料上
 * 产出了大量碎块——考试大纲/规范/目录类文档满是「一、」「1、」「（一）」这类会被判为标题的短行，
 * 中位块长只有 37 字，69% 的块不足 200 字；碎块既无上下文（embedding 质量差），又让长文档撞上
 * 块数上限、尾部正文不可召回（实测 42 份资料共丢 134 万字）。改为：
 *   - 小节（含标题行）作为最小单元，连续累积到接近 maxChars 才落块（标题取该块**首个小节**的标题）；
 *   - 单个小节本身就超过 maxChars → 先清空缓冲，再按段落聚合/硬切（保留块间重叠）；
 *   - 其余情况不引入额外重叠（内容是连续拼接，无丢失）。
 *
 * 空/纯空白正文返回 []；超 maxChunks 截断（保头部语义，尾部丢弃）。
 */
export function chunkMaterialMarkdown(markdown: string, options: ChunkOptions = {}): MaterialChunk[] {
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_CHUNK_CHARS);
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? DEFAULT_CHUNK_OVERLAP, Math.floor(maxChars / 3)));
  const maxChunks = Math.max(1, options.maxChunks ?? MAX_MATERIAL_CHUNKS);

  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];

  // 切成「节」：标题行开新节，其余行归入当前节
  interface Section { title: string; lines: string[]; }
  const sections: Section[] = [];
  let current: Section = { title: '', lines: [] };
  for (const raw of text.split('\n')) {
    if (!keepLine(raw)) continue;
    if (isHeadingLine(raw)) {
      if (current.lines.length || current.title) sections.push(current);
      current = { title: raw.trim(), lines: [raw] };
    } else {
      current.lines.push(raw);
    }
  }
  if (current.lines.length || current.title) sections.push(current);

  const chunks: MaterialChunk[] = [];
  const emit = (title: string, body: string): void => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const fallback = trimmed.split('\n')[0]?.trim() || '';
    chunks.push({
      id: `c-${chunks.length + 1}`,
      title: (title || fallback).slice(0, 80),
      text: trimmed,
      charCount: trimmed.length,
      index: chunks.length,
    });
  };

  let buffer = '';
  let bufferTitle = '';
  const flush = (): void => {
    if (buffer) emit(bufferTitle, buffer);
    buffer = '';
    bufferTitle = '';
  };

  for (const section of sections) {
    if (chunks.length >= maxChunks) return chunks;
    const body = section.lines.join('\n').trim();
    if (!body) continue;

    if (body.length > maxChars) {
      // 单节超预算：先落掉已积累的缓冲，再把这节按段落聚合/硬切
      flush();
      const parts = packParagraphs(
        splitParagraphs(body).flatMap((p) => hardSplitOversized(p, maxChars)),
        maxChars,
        overlapChars
      );
      for (const part of parts) {
        emit(section.title, part);
        if (chunks.length >= maxChunks) return chunks;
      }
      continue;
    }

    // 合并进当前缓冲；装不下先落块
    if (buffer && buffer.length + body.length + 2 > maxChars) flush();
    buffer = buffer ? `${buffer}\n\n${body}` : body;
    if (!bufferTitle) bufferTitle = section.title;
  }
  flush();
  return chunks;
}

/** 块的**可嵌入文本**：标题 + 正文（标题作为语境前缀，提升短块的语义可判性）。 */
export function chunkEmbedText(chunk: MaterialChunk): string {
  const title = chunk.title && !chunk.text.startsWith(chunk.title) ? `${chunk.title}\n` : '';
  return `${title}${chunk.text}`;
}
