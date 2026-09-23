/**
 * 上传资料解析（**只支持文本型文档**）——officeparser 抽取 + 「文本层闸门」。
 *
 * 口径（2026-09-22 定稿，与前端文案一致）：
 *   1. 只收**文本型**文件：pdf / docx / pptx / xlsx / md / txt（csv、html、rtf、epub 同路径）。
 *   2. 扫描件、图片型 PDF（**无文本层**）一律**拒收并告知**：不做 OCR、不伪造内容。
 *   3. legacy `.doc / .ppt / .xls`（OLE2 二进制）不支持，提示用户另存为 docx/pptx/xlsx。
 *   4. 输出除正文外还给**结构**（页/幻灯片/标题/表格计数）与**章节锚点**（closestHeading +
 *      页码/幻灯片号），供下游「资料画像」与「里程碑引用资料条目」的可核对性使用。
 *   5. Markdown（`.md/.markdown`）从 ATX 标题（`#`~`######`）建锚点——此前 txt/md 一律不建锚点，
 *      资料包会回退成「正文前 N 行」，网页另存的语料里排在最前的标题/来源/导航会把真正的章节挤掉
 *      （2026-09-23 四学段测试：四份 .md 语料的 pack 全是样板，引用只能引到页面标题与来源 URL）。
 *
 * 类型与纯函数契约在 `document-parser.types.ts`（那里不引解析库，可被 store / path 安全复用）。
 * 选型依据（实测）：officeparser 纯 JS、无原生依赖、无外发；结构保留与 markitdown 持平或更好
 * （pptx 标题 27/24 对 27/25），且**无文本层样本快 36 倍**（3.7s 对 133.7s）。
 */
import { parseOffice } from 'officeparser';
import {
  MAX_ANCHORS,
  MAX_STORED_MARKDOWN_CHARS,
  MAX_UPLOAD_BYTES,
  PARSE_TIMEOUT_MS,
  PLAIN_TEXT_EXTS,
  classifyDocumentExtension,
  evaluateTextLayer,
  getDocumentExt,
  isProseTextLine,
  rejectMessageFor,
  type DocumentAnchor,
  type DocumentRejectReason,
  type DocumentStructure,
  type ParsedDocument,
} from './document-parser.types';

export * from './document-parser.types';

interface AstLike {
  type?: string;
  content?: unknown;
  warnings?: unknown;
  to?: (format: string) => Promise<unknown>;
}

/** 递归统计 AST 节点类型（content/children 两种容器都覆盖）。 */
function countNodeTypes(node: unknown, acc: Record<string, number>): Record<string, number> {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const child of node) countNodeTypes(child, acc);
    return acc;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string') {
    acc[record.type] = (acc[record.type] || 0) + 1;
  }
  if (Array.isArray(record.children)) countNodeTypes(record.children, acc);
  return acc;
}

/** 取出 to() 的返回值（不同格式可能返回字符串或 { value } 信封）。 */
function unwrapToResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.value === 'string') return record.value;
  }
  return '';
}

/** 章节锚点：officeparser chunks 带 closestHeading + 页码/幻灯片号/工作表名。 */
function extractAnchors(chunks: unknown): DocumentAnchor[] {
  if (!Array.isArray(chunks)) return [];
  const anchors: DocumentAnchor[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const record = chunk as Record<string, unknown>;
    const meta = (record.metadata && typeof record.metadata === 'object')
      ? (record.metadata as Record<string, unknown>)
      : {};
    const heading = String(meta.closestHeading || '').trim();
    const location = String(
      meta.pageNumber ?? meta.slideNumber ?? meta.sheetName ?? ''
    ).trim();
    const text = String(record.text || '').trim();
    if (!text) continue;
    anchors.push({
      heading: heading || '（无标题）',
      location: location || '',
      preview: text.slice(0, 80),
    });
    if (anchors.length >= MAX_ANCHORS) break;
  }
  return anchors;
}

/** Markdown ATX 标题（`#` ~ `######`），尾部可带闭合 `#`。 */
const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** 仅 Markdown 扩展名走标题锚点（ATX 标题语义确定，不会把 `# 注释` 误当章节）。 */
function isMarkdownExt(ext: string): boolean {
  return ext === '.md' || ext === '.markdown';
}

/**
 * 从标题下正文里挑**第一段像正文的行**（样板过滤见 `isProseTextLine`）。
 * 返回**原行**（不剥 markdown 记号）——引文要逐字可回溯到原文。
 */
function firstProseLine(lines: string[]): string {
  for (const raw of lines) {
    const trimmed = String(raw || '').trim();
    if (!trimmed || MARKDOWN_HEADING_RE.test(trimmed)) continue;
    if (!isProseTextLine(trimmed)) continue;
    return trimmed;
  }
  return '';
}

/**
 * Markdown 标题锚点：把 `#`~`######` 标题与其下第一段正文切成锚点。
 *
 * 标题本身可能是链接（网页另存的 markdown 常见）：取链接文字当标题。
 * 正文预览取标题下第一段"像正文"的行；若整节只有样板（如页面标题下的"来源/导航"），
 * preview 留空 → 下游 `buildKeyPoints` 会跳过它，不会产出样板引用。
 */
function extractMarkdownAnchors(markdown: string): DocumentAnchor[] {
  const anchors: DocumentAnchor[] = [];
  let heading = '';
  let bodyLines: string[] = [];

  const flush = () => {
    if (!heading) return;
    anchors.push({ heading, location: '', preview: firstProseLine(bodyLines).slice(0, 80) });
    heading = '';
    bodyLines = [];
  };

  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const match = MARKDOWN_HEADING_RE.exec(String(raw).trim());
    if (match) {
      flush();
      heading = match[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
      continue;
    }
    if (heading) bodyLines.push(raw);
  }
  flush();

  return anchors.slice(0, MAX_ANCHORS);
}

function emptyStructure(): DocumentStructure {
  return {
    pageCount: null,
    slideCount: 0,
    sheetCount: 0,
    headingCount: 0,
    tableCount: 0,
    listCount: 0,
    paragraphCount: 0,
    chunkCount: 0,
  };
}

function reject(ext: string, reason: DocumentRejectReason, format = ''): ParsedDocument {
  return {
    status: 'rejected',
    ext,
    format,
    charCount: 0,
    structure: emptyStructure(),
    anchors: [],
    markdown: '',
    warnings: [],
    rejectReason: reason,
    message: rejectMessageFor(reason),
  };
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('PARSE_TIMEOUT')), timeoutMs);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); rejectPromise(error); }
    );
  });
}

/**
 * 解析一份上传文件。**不抛异常**：一切失败都落到 `status: 'rejected'` + 用户可读 message。
 * @param file 文件内容（Buffer）或磁盘路径
 * @param filename 原始文件名（用于取扩展名）
 */
export async function parseDocument(file: Buffer | string, filename: string): Promise<ParsedDocument> {
  const ext = getDocumentExt(filename);
  const support = classifyDocumentExtension(ext);
  if (support === 'legacy') return reject(ext, 'legacy_format');
  if (support === 'unsupported') return reject(ext, 'unsupported_format');
  if (Buffer.isBuffer(file) && file.byteLength > MAX_UPLOAD_BYTES) return reject(ext, 'file_too_large');

  // 纯文本直读（officeparser 不接 txt/md）
  if ((PLAIN_TEXT_EXTS as readonly string[]).includes(ext)) {
    const text = Buffer.isBuffer(file) ? file.toString('utf-8') : '';
    const evaluated = evaluateTextLayer({ charCount: text.length, pageCount: null });
    if (!evaluated.ok) return reject(ext, evaluated.reason as DocumentRejectReason, 'text');
    // Markdown 从 ATX 标题建锚点；其余纯文本保持无锚点（下游 pack 回退到正文行）
    const anchors = isMarkdownExt(ext) ? extractMarkdownAnchors(text) : [];
    return {
      status: 'ok',
      ext,
      format: 'text',
      charCount: text.length,
      structure: { ...emptyStructure(), headingCount: anchors.length, chunkCount: anchors.length },
      anchors,
      markdown: text.slice(0, MAX_STORED_MARKDOWN_CHARS),
      warnings: [],
    };
  }

  const warnings: string[] = [];
  let ast: AstLike;
  try {
    ast = (await withTimeout(parseOffice(file), PARSE_TIMEOUT_MS)) as AstLike;
  } catch (error) {
    const reason: DocumentRejectReason = error instanceof Error && error.message === 'PARSE_TIMEOUT'
      ? 'timeout'
      : 'parse_failed';
    return reject(ext, reason);
  }

  const format = typeof ast?.type === 'string' ? ast.type : ext.replace('.', '');
  let counts: Record<string, number> = {};
  try {
    counts = countNodeTypes(ast?.content, {});
  } catch {
    counts = {};
  }

  let markdown = '';
  try {
    markdown = unwrapToResult(await withTimeout(Promise.resolve(ast?.to?.('md')), PARSE_TIMEOUT_MS));
  } catch {
    markdown = '';
  }
  if (!markdown) {
    try {
      markdown = unwrapToResult(await withTimeout(Promise.resolve(ast?.to?.('text')), PARSE_TIMEOUT_MS));
    } catch {
      markdown = '';
    }
  }

  let anchors: DocumentAnchor[] = [];
  try {
    const chunks = await withTimeout(Promise.resolve(ast?.to?.('chunks')), PARSE_TIMEOUT_MS);
    anchors = extractAnchors((chunks as Record<string, unknown>)?.value ?? chunks);
  } catch {
    anchors = [];
  }

  if (Array.isArray(ast?.warnings) && ast.warnings.length) {
    for (const warning of ast.warnings.slice(0, 5)) {
      const text = typeof warning === 'string'
        ? warning
        : String((warning as Record<string, unknown>)?.message || '');
      if (text) warnings.push(text.slice(0, 200));
    }
  }

  const pageCount = format === 'pdf' ? (counts.page || null) : null;
  const structure: DocumentStructure = {
    pageCount,
    slideCount: counts.slide || 0,
    sheetCount: counts.sheet || 0,
    headingCount: counts.heading || 0,
    tableCount: counts.table || 0,
    listCount: counts.list || 0,
    paragraphCount: counts.paragraph || 0,
    chunkCount: anchors.length,
  };

  const totalPages = pageCount || structure.slideCount || structure.sheetCount || 0;
  const evaluated = evaluateTextLayer({ charCount: markdown.length, pageCount: totalPages || null });
  if (!evaluated.ok) {
    return { ...reject(ext, evaluated.reason as DocumentRejectReason, format), warnings };
  }

  let stored = markdown;
  if (stored.length > MAX_STORED_MARKDOWN_CHARS) {
    stored = stored.slice(0, MAX_STORED_MARKDOWN_CHARS);
    warnings.push('内容过长，已截断存储');
  }

  return {
    status: 'ok',
    ext,
    format,
    charCount: markdown.length,
    structure,
    anchors,
    markdown: stored,
    warnings,
  };
}
