/**
 * 联网正文的「抓取痕迹清洗」（2026-11-06 真机根因）。
 *
 * 真机样本：《党政机关公文处理工作条例》，抓自双语法律库页面（cecc.gov 转载）。
 * 入库的 `web-source.md` 里：开头十几行是网页自带的英文元数据
 * （`# Regulations Regarding…` / `Institutions of Democratic Governance` / `Major Law` /
 * `Issued: Sun, 07/01/2012` / `State Council` / `The following text was retrieved from…`），
 * 中文正文前面还有 `Title (Chinese)` / `Body (Chinese)` 两行标记；正文里 `## 第一章` 之后
 * **全部条文挤在同一个 5752 字的长行**里，且 `*第一条*` 这种斜体标记原样保留。
 *
 * 三个下游后果（全部实测）：
 *  ① `anchors[0]` 是那行英文 H1 → 资料库卡片把英文标题当成「第一章」；
 *  ② 长行让切片按 1022 字硬切，8 个章切出 8 块、块标题是行内碎片，章节划分彻底失效；
 *  ③ 原文直接铺给用户时，`##` 与 `*` 裸露、几千字一坨。
 *
 * 这里在**入库前**做确定性清洗（纯函数，不依赖模型）：切掉抓取头、把 `第X条` 断成独立行。
 * 展示层另有一份同类兜底（frontend `utils/materialText`），存量脏资料靠它先顶住。
 */

/** 网页抓取器给正文打的标记：`Body (Chinese)` / `正文（中文）` */
const BODY_MARKER = /\b(?:body|正文)\s*(?:\(\s*chinese\s*\)|（\s*中文\s*）)/i;
/** 抓取元数据的键名行（`Issued:` / `Issuer:` / `Major Law` / `Institutions of…` …） */
const CRAWL_KEY =
  /^\s*(?:institutions?|major\s+law|additional\s+laws?|issued|issuer|source|url|retrieved|publisher|jurisdiction|language|title|body|date|status|citation|document|about)\b/i;
/** 抓取器自己写的那句说明 */
const RETRIEVED_LINE = /^\s*(?:the\s+following\s+text\s+was\s+retrieved|retrieved\s+from)\b/i;
/** 汉字（判断「这一行是不是已经是中文正文」） */
const CJK = /[\u3400-\u9fff]/;
/**
 * 断行只认句末标点之后：避免把「依照本条例第十条规定」从句子中间劈开。
 * 允许条文前带 markdown 强调符（样本里是 `。*第二条*`，加粗归一后为 `。**第二条**`）。
 */
const CLAUSE_BREAK = /([。；;！!？?）)])\s*(\*{0,3})(第[〇零一二三四五六七八九十百千]+条)/g;

export interface WebTextSanitization {
  text: string;
  /** 被切掉的抓取头行数（0 = 没认出来，原文照旧） */
  strippedHeaderLines: number;
  /** 由长行断出的条文段数 */
  clauseBreaks: number;
}

/**
 * 清洗联网抓取正文：切掉英文爬虫头 + 把法条断成独立行。
 * 只处理「看起来确实是抓取页」的文本（有 Body 标记或开头有无中文元数据块）；
 * 正常中文正文原样返回，避免误伤。
 */
export function sanitizeWebMaterialText(raw: string): WebTextSanitization {
  const source = String(raw || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return { text: '', strippedHeaderLines: 0, clauseBreaks: 0 };

  const { body, strippedHeaderLines } = stripHeader(source);
  const { text, clauseBreaks } = breakClauses(body);
  return { text, strippedHeaderLines, clauseBreaks };
}

/** 切掉抓取头：优先按 `Body (Chinese)` 标记，其次丢掉开头连续的无中文行 */
function stripHeader(source: string): { body: string; strippedHeaderLines: number } {
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const marker = BODY_MARKER.exec(lines[i]);
    if (!marker) continue;
    const tail = lines[i].slice(marker.index + marker[0].length).replace(/^\s*[:：]\s*/, '').trim();
    const rest = [tail, ...lines.slice(i + 1)].filter((line, idx) => idx > 0 || !!line).join('\n');
    return { body: cleanup(rest), strippedHeaderLines: i + 1 };
  }

  // 没有标记：丢掉开头连续的无中文行（空行 / 抓取说明 / 短英文元数据）
  let start = 0;
  for (; start < lines.length; start += 1) {
    const line = lines[start];
    if (!line.trim()) continue;
    if (CJK.test(line)) break;
    if (line.length > 200) break;
    if (RETRIEVED_LINE.test(line) || CRAWL_KEY.test(line) || !CJK.test(line)) continue;
  }
  if (start === 0) return { body: source, strippedHeaderLines: 0 };
  /* 只有丢掉的确实像抓取头（出现元数据键名或说明句）才认，否则可能是英文原文本身 */
  const head = lines.slice(0, start).join('\n');
  if (!CRAWL_KEY.test(head) && !RETRIEVED_LINE.test(head)) {
    return { body: source, strippedHeaderLines: 0 };
  }
  return { body: cleanup(lines.slice(start).join('\n')), strippedHeaderLines: start };
}

/** 清洗收尾：删残留说明行、压空行、去首尾空白 */
function cleanup(text: string): string {
  return text
    .split('\n')
    .filter((line) => !RETRIEVED_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 法条断行：`*第X条*` 规范成加粗，每条另起一行（只认句末标点之后） */
function breakClauses(body: string): { text: string; clauseBreaks: number } {
  let breaks = 0;
  const emphasized = body.replace(/(\*{1,3})\s*(第[〇零一二三四五六七八九十百千]+条)\s*\1/g, '**$2**');
  const text = emphasized.replace(CLAUSE_BREAK, (_m, punc: string, marks: string, clause: string) => {
    breaks += 1;
    return `${punc}\n\n${marks}${clause}`;
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), clauseBreaks: breaks };
}
