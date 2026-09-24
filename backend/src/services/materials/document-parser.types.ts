/**
 * 上传资料解析的**类型与纯函数契约**（不依赖任何解析库）。
 *
 * 单独成文件的原因：`material-store.ts` / `path.coordinator` 只需要「资料长什么样」，
 * 不应该把 officeparser（pdf/pptx/xlsx 解析）拖进它们的静态依赖图。
 * 真正的解析实现在 `document-parser.ts`（本文件被它 import 并 re-export）。
 */

/** 走 officeparser 的文本型扩展名（officeparser 覆盖 docx/pptx/xlsx/pdf/md/html/csv/rtf/epub）。 */
export const OFFICE_DOCUMENT_EXTS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.csv',
  '.html',
  '.htm',
  '.rtf',
  '.epub',
] as const;

/** 纯文本直读（officeparser 对 txt 会直接报错，故这两类不走它）。 */
export const PLAIN_TEXT_EXTS = ['.txt', '.md', '.markdown'] as const;

/** 支持的文本型扩展名（对用户承诺的范围）。 */
export const SUPPORTED_DOCUMENT_EXTS = [...OFFICE_DOCUMENT_EXTS, ...PLAIN_TEXT_EXTS] as const;

/** legacy 二进制格式：不支持，提示另存。 */
export const LEGACY_DOCUMENT_EXTS = ['.doc', '.ppt', '.xls'] as const;

/** 文本层闸门：平均每页字符数低于此值即判「无文本层」（扫描件/图片型 PDF）。 */
export const MIN_CHARS_PER_PAGE = 100;

/** 文本层闸门：整篇字符数绝对下限（页数未知时也生效）。 */
export const MIN_TOTAL_CHARS = 100;

/** 单文件解析超时（毫秒）；超时按解析失败处理，不阻塞请求。 */
export const PARSE_TIMEOUT_MS = 20_000;

/** 单文件大小上限（字节）。 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 存储正文的长度上限（防超大文件撑爆磁盘；超出按截断处理并留 warning）。 */
export const MAX_STORED_MARKDOWN_CHARS = 400_000;

/** 保留的章节锚点数量上限。 */
export const MAX_ANCHORS = 500;

export type DocumentSupport = 'supported' | 'legacy' | 'unsupported';
export type DocumentParseStatus = 'ok' | 'rejected';
export type DocumentRejectReason =
  | 'legacy_format'
  | 'unsupported_format'
  | 'no_text_layer'
  | 'empty_document'
  | 'file_too_large'
  | 'timeout'
  | 'parse_failed';

export interface DocumentStructure {
  /** 页数（PDF 有；pptx/xlsx 用 slides/sheets；docx 无页概念则为 null）。 */
  pageCount: number | null;
  slideCount: number;
  sheetCount: number;
  headingCount: number;
  tableCount: number;
  listCount: number;
  paragraphCount: number;
  chunkCount: number;
}

export interface DocumentAnchor {
  /** 该锚点所属章节标题（officeparser 的 closestHeading），可被路径里程碑直接引用核对。 */
  heading: string;
  /** 页码 / 幻灯片号 / 工作表名，取其一。 */
  location: string;
  /** 锚点正文前 80 字，供人工核对。 */
  preview: string;
}

export interface ParsedDocument {
  status: DocumentParseStatus;
  ext: string;
  format: string;
  charCount: number;
  structure: DocumentStructure;
  anchors: DocumentAnchor[];
  markdown: string;
  warnings: string[];
  rejectReason?: DocumentRejectReason;
  /** 面向用户的中文说明（成功时为空）。 */
  message?: string;
}

/** 取小写扩展名（含点）；无扩展名返回空串。 */
export function getDocumentExt(filename: string): string {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index).toLowerCase() : '';
}

/** 判定扩展名的支持档位。 */
export function classifyDocumentExtension(ext: string): DocumentSupport {
  const normalized = String(ext || '').toLowerCase();
  if ((SUPPORTED_DOCUMENT_EXTS as readonly string[]).includes(normalized)) return 'supported';
  if ((LEGACY_DOCUMENT_EXTS as readonly string[]).includes(normalized)) return 'legacy';
  return 'unsupported';
}

/** 面向用户的拒收文案（单点，前端可直接展示）。 */
export function rejectMessageFor(reason: DocumentRejectReason): string {
  switch (reason) {
    case 'legacy_format':
      return '暂不支持 .doc / .ppt / .xls 老格式，请用 Word / PowerPoint / Excel 另存为 .docx / .pptx / .xlsx 后重试';
    case 'unsupported_format':
      return '仅支持文本型文件：PDF、Word、PPT、Excel、TXT、Markdown';
    case 'no_text_layer':
      return '这份文件没有可提取的文本（多为扫描件或图片型 PDF），暂时读不了；请先转成可选中文字的版本，或直接把内容粘贴进来';
    case 'empty_document':
      return '这份文件几乎是空的，没读到可用内容';
    case 'file_too_large':
      return `文件太大，单个文件不超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`;
    case 'timeout':
      return '文件解析超时，请换一份文件或直接把内容粘贴进来';
    case 'parse_failed':
    default:
      return '文件解析失败，请换一份文件或直接把内容粘贴进来';
  }
}

/**
 * 文本层闸门（纯函数，单测锚点）：判断抽取结果是否够得上「文本型」。
 * 未知页数（docx 等）时只按绝对下限判定——**未知不等于最小**，不额外收紧。
 */
export function evaluateTextLayer(input: {
  charCount: number;
  pageCount: number | null;
}): { ok: boolean; reason?: DocumentRejectReason } {
  const charCount = Math.max(0, Math.floor(Number(input.charCount) || 0));
  if (charCount < MIN_TOTAL_CHARS) return { ok: false, reason: 'empty_document' };
  const pageCount = Number(input.pageCount || 0);
  if (pageCount > 0 && charCount / pageCount < MIN_CHARS_PER_PAGE) {
    return { ok: false, reason: 'no_text_layer' };
  }
  return { ok: true };
}

/** 「像正文」判定的最短长度（剥掉 markdown 记号后剩下的文字）。 */
export const MIN_PROSE_CHARS = 6;

/** 去掉行首的列表/引用/标题/缩进标记（含 mediawiki 的 `:` 缩进）。 */
export function stripLineMarkers(line: string): string {
  return String(line ?? '').replace(/^[#>*\-\s:]+/, '').trim();
}

/** 网页样板/元数据行（不是知识内容）：纯 URL、来源行、日期、署名统计行。 */
const BOILERPLATE_LINE_RES: RegExp[] = [
  /^https?:\/\/\S+$/i,
  /^(来源|出处|原文链接|source)\s*[:：]/i,
  /^\d{4}\s*[-/年]\s*\d{1,2}/,
  /^(原创|作者|编辑|责编|发布|浏览|阅读|时间|日期|更新时间)\s*[:：]/,
  /^(进入词条|全站搜索|当前位置|联系电话|联系|客服|版权|备案|京ICP|沪ICP|粤ICP)/i,
  /^(copyright|all rights reserved|©)/i,
];

/** 明确是样板的关键词（出现在行内即判样板：联系方式、关注引导、备案号）。 */
const BOILERPLATE_KEYWORD_RE = /(公众号|客服微信|扫码关注|长按识别|版权所有|all rights reserved|京ICP备|沪ICP备|粤ICP备|公网安备|换绑)/i;

/**
 * 是否是「像正文」的一行：剥掉链接/图片/URL 与 markdown 记号后，仍要有足够文字。
 *
 * 两处共用（单点）：
 *   - 解析器：Markdown 章节的**正文预览**（预览会变成下游的可核对引文）；
 *   - 资料包：无锚点/锚点不足时的**回退切片**。
 * 目的：网页另存的语料里，导航、来源、日期、署名会排在最前；若不过滤，
 * 它们会挤掉真正的章节与要点，引用核对只能在样板文本上"通过"。
 */
export function isProseTextLine(line: string): boolean {
  const bare = stripLineMarkers(line);
  if (!bare) return false;
  // 图片开头的行基本是图标/配图，不是知识内容
  if (bare.startsWith('![')) return false;
  if (BOILERPLATE_LINE_RES.some((re) => re.test(bare))) return false;
  if (BOILERPLATE_KEYWORD_RE.test(bare)) return false;
  // 关键：**链接文字不计入正文长度**。导航行常是「当前位置：[首页](/)」这种形态，
  // 若把链接文字算进去就会被误判成正文；正文只算链接/图片/URL 之外的部分。
  const outsideLinks = bare
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[`*_>#|~=+[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return outsideLinks.length >= MIN_PROSE_CHARS;
}
