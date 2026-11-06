/**
 * 联网采集资料的展示层清洗与排版（2026-11-06 走查）
 *
 * 病根：联网抓取的是双语法律库网页，入库正文原样保留了整页抓取痕迹——
 *  ① 开头十几行英文元数据（Institutions of Democratic Governance / Major Law /
 *     Issued: Sun, 07/01/2012 / State Council / Body (Chinese)）；
 *  ② 正文裸露 Markdown 源码（`## 第一章 总则`、`*第一条*`），且各法条之间没有换行，
 *     几千字挤成一坨；
 *  ③ 资料库列表直接拿英文标题当章节名。
 *
 * 这里只做**展示层**兜底：入库清洗归采集链路（backend），前端不再把原始脏文本
 * 直接铺到用户面前。全部是纯函数，便于单测与在资料库 / 路径详情 / 弹窗复用。
 */

/** 网页抓取器给正文打的标记：`Body (Chinese)` / `正文（中文）`（可带冒号） */
const BODY_MARKER = /\b(?:body|正文)\s*(?:\(\s*chinese\s*\)|（\s*中文\s*）)/i;
/** 抓取元数据的键名（整行只有「键 + 值」且不含中文句读，才算元数据） */
const CRAWL_KEY = /^\s*(?:institutions?|major\s+law|issued|issuer|source|url|retrieved|publisher|jurisdiction|language|title|body|date|status|citation|document|about)\b/i;
/** 抓取器自己写的那句说明 */
const RETRIEVED_LINE = /^\s*(?:the\s+following\s+text\s+was\s+retrieved|retrieved\s+from)\b/i;
/** 中文（含 CJK 标点以外的汉字）判定 */
const CJK = /[\u3400-\u9fff]/;

/**
 * 去掉联网采集文本里的英文爬虫头。
 * 优先按 `Body (Chinese)` 标记切：标记行之后就是中文正文；
 * 没有标记时，丢掉开头连续的「无中文英文行」元数据块（遇到第一行中文即停）。
 */
export function stripCrawlMetadata(raw: string | null | undefined): string {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  // ① 有 Body(Title) (Chinese) 标记：正文从标记行之后开始（同一行还带内容时保留其后半段）
  for (let i = 0; i < lines.length; i += 1) {
    const marker = BODY_MARKER.exec(lines[i]);
    if (!marker) continue;
    const tail = lines[i].slice(marker.index + marker[0].length).replace(/^\s*[:：]\s*/, '');
    const rest = [tail, ...lines.slice(i + 1)].join('\n');
    return cleanupTail(rest);
  }

  // ② 无标记：丢掉开头连续的英文元数据块（空行 / 无中文的短行 / 已知键名行）
  let start = 0;
  for (; start < lines.length; start += 1) {
    const line = lines[start];
    if (!line.trim()) continue;
    if (CJK.test(line)) break;
    if (line.length > 200) break;
    if (RETRIEVED_LINE.test(line) || CRAWL_KEY.test(line) || !CJK.test(line)) continue;
  }
  return cleanupTail(lines.slice(start).join('\n'));
}

/** 收尾：删掉残留的抓取说明行、压掉多余空行与首尾空白 */
function cleanupTail(text: string): string {
  return text
    .split('\n')
    .filter((line) => !RETRIEVED_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 断行只认句末标点之后：避免把「依照本条例第十条规定」从句子中间劈开 */
const CLAUSE_BREAK = /([。；;！!？?）)])\s*(第[〇零一二三四五六七八九十百千]+条)/g;

/**
 * 资料正文 → 可渲染的 markdown：
 *  - 先去爬虫头；
 *  - `*第一条*` / `**第一条**` 统一成加粗小标题（斜体读起来像错字）；
 *  - 每条法条独立成段（只在句末标点后断行，句中的「第X条规定」不拆）；
 *  - 压掉多余空行。
 */
export function normalizeMaterialMarkdown(raw: string | null | undefined): string {
  let text = stripCrawlMetadata(raw);
  if (!text) return '';
  text = text.replace(/(\*{1,3})\s*(第[〇零一二三四五六七八九十百千]+条)\s*\1/g, '**$2**');
  text = text.replace(CLAUSE_BREAK, '$1\n\n$2');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 资料引用去重：同一章节只留一条。
 *
 * 后端引用层（material-refs.ts）的去重键是 `sectionId|quote`，同一章节下**不同引文**
 * 会并存（最多 3 条）；而前端的标签只显示章节名 —— 于是同一条任务下会连排三颗
 * 「公文种类」按钮（2026-11-06 走查 图1/2/3 的实测根因）。按章节身份去重：
 * 引用是「指向哪一节」的入口，不是「摘了哪几句话」的清单。
 */
export function dedupeMaterialRefs<T>(refs: T[] | null | undefined): T[] {
  const list = Array.isArray(refs) ? refs : [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of list) {
    const r = ref as Record<string, unknown> | null | undefined;
    const section = String(r?.sectionId || r?.sectionTitle || '').trim();
    const key = section
      ? `${String(r?.materialId || '')}|${section}`
      : `${String(r?.materialId || '')}|${String(r?.quote || r?.sourceUrl || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** 一段文字是否像「英文标题」（无中文且不是纯数字/符号）——资料库章节名过滤用 */
export function looksLikeEnglishTitle(value: string | null | undefined): boolean {
  const text = String(value ?? '').trim();
  if (!text || CJK.test(text)) return false;
  return /[a-z]/i.test(text);
}
