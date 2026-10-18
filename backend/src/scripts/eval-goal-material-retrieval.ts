/**
 * goal:material:retrieval:eval —— goal 阶段「联网资料 → 切分 → embedding → 召回 → rerank」的独立质量评测。
 *
 * 与 `eval-material-semantic.ts` 的区别：
 *   - 那份是**人造语料 + 手写 query + top-1 命中**（测链路通不通）；
 *   - 这份是**真实网页语料 + 事实锚点真值 + 排序指标**（测效果好不好）。
 *
 * 真值来源（关键设计）：不用 LLM 判分。每个 query 配一组「锚点串」（anchor），
 * 锚点在语料中的出现位置就是金标块。这样：
 *   - gold chunk = 含 anchor 的块（graded=2），同文档其他块 = 1，其他文档 = 0；
 *   - 锚点在全文存在但**没有任何块包含它** ⇒ 该事实被切分切断（确定性可测）；
 *   - 锚点在整个语料都不存在 ⇒ 记为 corpus_miss（联网采集没抓到该主题，本身是有价值的发现）。
 *
 * 跑法：
 *   cd backend && npx ts-node --transpile-only src/scripts/eval-goal-material-retrieval.ts
 *   ... --stage=fetch        只抓语料（带磁盘缓存，重复跑不重抓）
 *   ... --stage=chunk        只跑切分诊断
 *   ... --stage=retrieval    只跑检索/重排评测（需要已缓存语料）
 *   ... --topics=bio,http     只跑指定主题
 *
 * 语料缓存：<repo>/doc/local/GOAL-MATERIAL-EVAL-2026-10-18/corpus.json
 * 报告：    <repo>/doc/local/GOAL-MATERIAL-EVAL-2026-10-18/report.json
 *
 * 独立性：只 import backend 的 search/fetch/chunk/embedding 纯函数，不碰 HTTP 服务、不碰平台 DB。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { searchWeb } from '../services/search';
import { fetchWeb } from '../services/fetch';
import { chunkMaterialMarkdown, chunkEmbedText } from '../services/materials/material-chunker';
import { embedTexts, rerankDocuments, cosineSimilarity } from '../services/embedding';

const OUT_DIR = path.resolve(__dirname, '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18');
const CORPUS_FILE = path.join(OUT_DIR, 'corpus.json');
const REPORT_FILE = path.join(OUT_DIR, 'report.json');

// ───────────────────────────── 探针集 ─────────────────────────────
// anchors：该问题的「答案事实」必须在正文里出现的字符串（任一命中即为金标）。
// 选型原则：锚点是**事实性专名/术语**，不是泛词，避免误命中无关块。

interface Probe {
  /** 学习者口吻的提问（不含锚点原词或只含部分，考语义而非字符串匹配） */
  q: string;
  /** 金标锚点（任一出现在某块内，该块即为 gold，graded=2） */
  anchors: string[];
}

interface Topic {
  key: string;
  /** 主题名 */
  label: string;
  /** 联网检索用的查询（模拟 goal 阶段 buildQueries 的产物） */
  searchQueries: string[];
  probes: Probe[];
  /** 该主题**不该**被答上的问题（测系统有没有能力拒答/低分） */
  negative: string;
}

const TOPICS: Topic[] = [
  {
    key: 'bio',
    label: '光合作用',
    searchQueries: ['光合作用 光反应 暗反应 区别 高中生物', '光合作用 类囊体 叶绿体基质 卡尔文循环'],
    probes: [
      { q: '光反应具体在哪里进行', anchors: ['类囊体'] },
      { q: '暗反应又叫什么循环', anchors: ['卡尔文循环', 'Calvin'] },
      { q: '光合作用放出的氧气最后去向哪里', anchors: ['氧气'] },
      { q: 'ATP 和 NADPH 是在哪个阶段产生的', anchors: ['NADPH', 'NADP'] },
      { q: '光合作用分几个阶段', anchors: ['光反应'] },
    ],
    negative: '光合作用里叶绿素的分子式怎么推导',
  },
  {
    key: 'http',
    label: 'HTTP 缓存',
    searchQueries: ['HTTP 缓存 Cache-Control max-age ETag 详解', '强缓存 协商缓存 304 区别'],
    probes: [
      { q: 'max-age 单位是什么', anchors: ['max-age'] },
      { q: '服务器怎么告诉浏览器资源没变', anchors: ['304'] },
      { q: 'ETag 是用来做什么的', anchors: ['ETag'] },
      { q: '协商缓存用哪个响应头判断', anchors: ['Last-Modified', 'If-Modified-Since'] },
      { q: '什么时候浏览器会直接用本地副本', anchors: ['强缓存', 'Cache-Control'] },
    ],
    negative: 'HTTP/3 的 QUIC 握手丢包重传算法细节',
  },
  {
    key: 'edu',
    label: '3-6岁儿童学习与发展指南',
    searchQueries: ['3-6岁儿童学习与发展指南 五大领域 教育部', '3-6岁儿童学习与发展指南 全文'],
    probes: [
      { q: '指南把幼儿学习分成哪几个领域', anchors: ['五个领域', '五大领域', '健康、语言、社会、科学、艺术'] },
      { q: '指南是哪个部门发布的', anchors: ['教育部关于印发《3-6岁儿童学习与发展指南》'] },
      { q: '指南在幼儿语言领域要求什么', anchors: ['语言领域'] },
      { q: '指南对幼儿社会交往有什么目标', anchors: ['社会领域'] },
      { q: '指南有没有说明适用年龄', anchors: ['3-6岁儿童', '3—6岁儿童', '3～6岁儿童'] },
    ],
    negative: '指南里关于幼儿园教师资格证考试的报名条件',
  },
  {
    key: 'math',
    label: '勾股定理',
    searchQueries: ['勾股定理 证明 斜边 直角边 平方和', '勾股定理 常见应用 例题'],
    probes: [
      { q: '直角三角形的两条直角边和斜边满足什么关系', anchors: ['平方和'] },
      { q: '中国古代怎么称呼这个定理', anchors: ['勾股'] },
      { q: '斜边在公式里对应哪个字母', anchors: ['斜边'] },
      { q: '这个定理有哪些证明方法', anchors: ['证明'] },
      { q: '三边是 3、4、5 时说明什么', anchors: ['3、4、5', '3,4,5', '3 4 5', '3，4，5'] },
    ],
    negative: '勾股定理在非欧几何里如何失效的严格推导',
  },
  {
    key: 'psych',
    label: '建构主义学习理论',
    searchQueries: ['建构主义学习理论 情境 协作 会话 意义建构', '建构主义 布鲁纳 维果茨基 教学应用'],
    probes: [
      { q: '建构主义认为学习靠什么发生', anchors: ['建构'] },
      { q: '建构主义强调哪几个要素', anchors: ['情境'] },
      { q: '谁提出最近发展区', anchors: ['维果茨基'] },
      { q: '发现学习是谁的主张', anchors: ['布鲁纳'] },
      { q: '建构主义对教师角色怎么看', anchors: ['教师'] },
    ],
    negative: '建构主义和行为主义在 fMRI 层面的脑区差异实验',
  },
  {
    key: 'food',
    label: '食品添加剂',
    searchQueries: ['食品添加剂 使用标准 GB2760 限量', '食品添加剂 不得添加 情形 规定'],
    probes: [
      { q: '食品添加剂里说的标准代号是哪个', anchors: ['GB 2760', 'GB2760'] },
      { q: '什么情况下不允许用添加剂', anchors: ['不得以掩盖食品腐败变质', '不得使用', '禁止使用'] },
      { q: '添加剂可以在什么范围内使用', anchors: ['最大使用量', '最大使用限量'] },
      { q: '超范围使用添加剂怎么处理', anchors: ['超范围', '超限量'] },
      { q: '哪些是常见的防腐剂', anchors: ['苯甲酸', '山梨酸', '防腐剂'] },
    ],
    negative: '食品添加剂在太空站失重环境下的代谢变化',
  },
  {
    key: 'cloud',
    label: '云计算服务模式',
    searchQueries: ['IaaS PaaS SaaS 区别 通俗解释', '云计算 三种服务模式 责任边界'],
    probes: [
      { q: '自己管操作系统的是哪种云服务', anchors: ['IaaS'] },
      { q: '只提供一个开发部署环境的是哪种', anchors: ['PaaS'] },
      { q: '拿来就能用的软件属于哪种', anchors: ['SaaS'] },
      { q: '三种模式谁来负责运维', anchors: ['运维', '责任'] },
      { q: '云服务按什么维度分层', anchors: ['基础设施', '平台', '软件'] },
    ],
    negative: '云计算 IDC 机柜的液冷压降计算',
  },
  {
    key: 'photo',
    label: '摄影光圈快门',
    searchQueries: ['摄影 光圈 快门 感光度 景深 关系', '光圈大小 影响 曝光 虚化'],
    probes: [
      { q: '想让背景更虚该怎么办', anchors: ['景深'] },
      { q: '光圈数值越小代表什么', anchors: ['光圈'] },
      { q: '拍流水丝滑用什么快门', anchors: ['快门'] },
      { q: '进光量由哪些参数决定', anchors: ['曝光'] },
      { q: '感光度高会有什么副作用', anchors: ['ISO', '噪点'] },
    ],
    negative: '摄影镜头镜片的研磨公差对 MTF 曲线的影响',
  },
];

// ───────────────────────────── 数据结构 ─────────────────────────────

interface Doc {
  topicKey: string;
  url: string;
  title: string;
  text: string;
  provider: string;
  fetchedAt: string;
  /** 抓取上游给的 meta 线索 */
  publishedAt?: string;
  suspicious?: boolean;
}

interface Chunk {
  docIdx: number;
  id: string;
  title: string;
  text: string;
  charCount: number;
  embedText: string;
}

interface CaseResult {
  topicKey: string;
  query: string;
  anchors: string[];
  /** 语料里能否找到该事实（false = 联网采集没覆盖到这个点） */
  anchorFound: boolean;
  /** 含锚点的块数（gold 数） */
  goldCount: number;
  /** 金标块在纯余弦序里的名次（1 起；0 = 未进入候选池） */
  cosineRankOfGold: number;
  /** rerank 后金标块的名次 */
  rerankRankOfGold: number;
  /** 各 @k 是否命中 */
  recallAtK: Record<string, boolean>;
  rrCosine: number;
  rrRerank: number;
  ndcg10Cosine: number;
  ndcg10Rerank: number;
  /** 纯余弦 top-1 的块是否属于 gold 文档 */
  top1DocCorrectCosine: boolean;
  top1DocCorrectRerank: boolean;
  topCosineScore: number;
  topRerankScore: number | null;
}

// ───────────────────────────── 工具 ─────────────────────────────

const norm = (s: string): string => String(s || '').replace(/\s+/g, '').toLowerCase();

function ensureDir(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadCorpus(): Doc[] {
  if (!fs.existsSync(CORPUS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf-8'));
    return Array.isArray(parsed?.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

function saveCorpus(docs: Doc[]): void {
  ensureDir();
  fs.writeFileSync(CORPUS_FILE, JSON.stringify({ docs, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

/** NDCG@k with graded relevance：gold 块 = 2，同文档其他块 = 1，其他 = 0。 */
function ndcgAt(rankedDocIdx: number[], goldDocIdx: Set<number>, heldChunkIdxs: GoldIndex, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, rankedDocIdx.length); i += 1) {
    const g = heldChunkIdxs.grade(i);
    dcg += (Math.pow(2, g) - 1) / Math.log2(i + 2);
  }
  // 理想序：把 gold 块排到最前，其余同文档块次之
  const totalGold = heldChunkIdxs.goldCount();
  const totalSameDoc = heldChunkIdxs.sameDocCount();
  let idcg = 0;
  let pos = 0;
  for (let i = 0; i < totalGold && pos < k; i += 1, pos += 1) idcg += 3 / Math.log2(pos + 2);
  for (let i = 0; i < totalSameDoc && pos < k; i += 1, pos += 1) idcg += 1 / Math.log2(pos + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

interface GoldIndex {
  grade: (rank: number) => number;
  goldCount: () => number;
  sameDocCount: () => number;
}

// ───────────────────────────── 阶段 1：抓语料 ─────────────────────────────

async function stageFetch(topicFilter: string[] | null): Promise<void> {
  const existing = loadCorpus();
  const kept = existing.filter((d) => !topicFilter || topicFilter.includes(d.topicKey));
  const docs: Doc[] = [...kept];

  for (const topic of TOPICS) {
    if (topicFilter && !topicFilter.includes(topic.key)) continue;
    if (docs.some((d) => d.topicKey === topic.key)) {
      console.log(`[fetch] ${topic.label} —— 已有缓存，跳过`);
      continue;
    }
    console.log(`\n[fetch] ${topic.label}`);
    const urls: string[] = [];
    for (const q of topic.searchQueries) {
      try {
        const res = await searchWeb({ query: q, maxResults: 6, purpose: `采集学习资料：${topic.label}` });
        console.log(`  搜索「${q}」→ ${res.results.length} 条 (${res.provider}, ${res.latencyMs}ms)`);
        for (const item of res.results) {
          if (!urls.includes(item.url)) urls.push(item.url);
        }
      } catch (error) {
        console.log(`  搜索失败「${q}」：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const picked = urls.slice(0, 6);
    if (picked.length === 0) {
      console.log('  → 无可抓 URL');
      continue;
    }
    try {
      const res = await fetchWeb({
        urls: picked,
        format: 'markdown',
        ttl: 0,
        purpose: `采集学习资料：${topic.label}`,
        extractDepth: 'advanced',
      });
      console.log(`  抓取 ${res.results.length}/${picked.length} 成功 (${res.provider}, ${res.latencyMs}ms)`);
      for (const item of res.results) {
        const text = typeof item.text === 'string' ? item.text : '';
        if (!text.trim()) continue;
        docs.push({
          topicKey: topic.key,
          url: item.url,
          title: item.title || item.url,
          text,
          provider: res.provider,
          fetchedAt: new Date().toISOString(),
          publishedAt: item.publishedAt,
          suspicious: item.suspicious,
        });
        console.log(`    ✓ ${(item.title || '').slice(0, 40)} | ${text.length} 字 | ${item.url.slice(0, 70)}`);
      }
      for (const err of res.errors ?? []) {
        console.log(`    ✗ ${err.url.slice(0, 70)} → ${err.code}`);
      }
    } catch (error) {
      console.log(`  抓取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  saveCorpus(docs);
  console.log(`\n[fetch] 语料共 ${docs.length} 份，已写入 ${CORPUS_FILE}`);
}

// ───────────────────────────── 阶段 2：切分诊断 ─────────────────────────────

/** 与 material-web-ingest.service.ts 的 MAX_WEB_TEXT_CHARS 对齐（生产入库截断点）。 */
const MAX_WEB_TEXT_CHARS = 160_000;

/**
 * 语料质量分类（确定性，不调模型）。
 *
 * 上游 fetch 的 `suspicious` 只查「正文过短 + 控制字符比例」，
 * 而真实联网采集的垃圾形态远不止这两种：机器人拦截页、编码乱码、无字幕视频页、整本 PDF 转储。
 * 这里把它们做成可量化指标，用于回答「goal 阶段联网整理拿到的到底是不是能用的资料」。
 */
export type CorpusDefect =
  | 'bot-wall'
  | 'mojibake'
  | 'video-no-transcript'
  | 'low-cjk-ratio'
  | 'oversized-dump'
  | 'thin';

const BOT_WALL = /Client Challenge|Just a moment\.\.\.|Enable JavaScript and cookies|cf-browser-verification|Access Denied|验证码/i;
const MOJIBAKE = /[\uFFFD]|ʳƷ|ҳ׼|Ӽʹñ׼|Ð|Ñ|Ã¤|â€™/;

export function classifyDoc(doc: Doc): CorpusDefect[] {
  const text = doc.text || '';
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const cjkRatio = cjkCount / Math.max(1, text.length);
  const isVideoUrl = /youtube\.com|youtu\.be|bilibili\.com|vimeo\.com/i.test(doc.url);
  const defects: CorpusDefect[] = [];
  if (BOT_WALL.test(text)) defects.push('bot-wall');
  if (MOJIBAKE.test(text)) defects.push('mojibake');
  if (isVideoUrl && text.length < 800) defects.push('video-no-transcript');
  if (text.length >= 200 && cjkRatio < 0.15) defects.push('low-cjk-ratio');
  if (text.length > 200_000) defects.push('oversized-dump');
  if (text.trim().length < 400) defects.push('thin');
  return defects;
}

interface ChunkDiag {
  topicKey: string;
  docs: number;
  /** 抓到但被判为垃圾（至少一项缺陷）的文档数 */
  junkDocs: number;
  junkByDefect: Record<string, number>;
  totalChars: number;
  chunks: number;
  medianChars: number;
  p10Chars: number;
  p90Chars: number;
  /** 短于 200 字的碎块占比 */
  fragmentRatio: number;
  /** 撞 200 块上限而被截断的文档占比 */
  cappedRatio: number;
  /** 生产入库 160K 截断会丢多少字（> 0 即尾部内容不可能被召回） */
  truncatedChars: number;
  /** 锚点事实存活率：锚点在全文存在、且至少一个块完整包含 */
  factSurvival: { found: number; survived: number; missing: number; lost: number };
  /** 按生产口径（先 160K 截断再切块）后会丢的事实数 */
  factLostByTruncation: number;
}

function chunkDoc(doc: Doc, docIdx: number): Chunk[] {
  const raw = chunkMaterialMarkdown(doc.text);
  return raw.map((c) => ({
    docIdx,
    id: c.id,
    title: c.title,
    text: c.text,
    charCount: c.charCount,
    embedText: chunkEmbedText(c),
  }));
}

function buildChunks(docs: Doc[]): Chunk[] {
  const all: Chunk[] = [];
  docs.forEach((doc, i) => {
    all.push(...chunkDoc(doc, i));
  });
  return all;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function diagnoseChunking(docs: Doc[], chunks: Chunk[], topicFilter: string[] | null): ChunkDiag[] {
  const out: ChunkDiag[] = [];
  for (const topic of TOPICS) {
    if (topicFilter && !topicFilter.includes(topic.key)) continue;
    const topicDocs = docs.map((d, i) => ({ d, i })).filter((x) => x.d.topicKey === topic.key);
    if (topicDocs.length === 0) continue;
    const topicChunks = chunks.filter((c) => docs[c.docIdx]?.topicKey === topic.key);
    const lens = topicChunks.map((c) => c.charCount).sort((a, b) => a - b);
    const capped = topicDocs.filter(({ d }) => chunkMaterialMarkdown(d.text).length >= 200).length;

    const junkByDefect: Record<string, number> = {};
    let junkDocs = 0;
    for (const { d } of topicDocs) {
      const defects = classifyDoc(d);
      if (defects.length === 0) continue;
      junkDocs += 1;
      for (const defect of defects) junkByDefect[defect] = (junkByDefect[defect] ?? 0) + 1;
    }
    const truncatedChars = topicDocs.reduce((s, { d }) => s + Math.max(0, d.text.length - MAX_WEB_TEXT_CHARS), 0);

    let found = 0;
    let survived = 0;
    let lost = 0;
    let factLostByTruncation = 0;
    for (const probe of topic.probes) {
      const presentInCorpus = topicDocs.some(({ d }) => probe.anchors.some((a) => norm(d.text).includes(norm(a))));
      if (!presentInCorpus) continue;
      found += 1;
      const inChunk = topicChunks.some((c) => probe.anchors.some((a) => norm(c.text).includes(norm(a))));
      if (inChunk) survived += 1;
      else lost += 1;
      // 生产口径：入库先截到 160K，再切块 —— 该事实是否仍可见
      const inProdBounded = topicDocs.some(({ d }) => {
        const bounded = d.text.slice(0, MAX_WEB_TEXT_CHARS);
        return probe.anchors.some((a) => norm(bounded).includes(norm(a)));
      });
      if (!inProdBounded) factLostByTruncation += 1;
    }

    out.push({
      topicKey: topic.key,
      docs: topicDocs.length,
      junkDocs,
      junkByDefect,
      totalChars: topicDocs.reduce((s, { d }) => s + d.text.length, 0),
      chunks: topicChunks.length,
      medianChars: percentile(lens, 50),
      p10Chars: percentile(lens, 10),
      p90Chars: percentile(lens, 90),
      fragmentRatio: lens.length ? lens.filter((n) => n < 200).length / lens.length : 0,
      cappedRatio: topicDocs.length ? capped / topicDocs.length : 0,
      truncatedChars,
      factSurvival: { found, survived, missing: topic.probes.length - found, lost },
      factLostByTruncation,
    });
  }
  return out;
}

// ───────────────────────────── 阶段 3：检索/重排评测 ─────────────────────────────

async function embedAll(chunks: Chunk[]): Promise<number[][]> {
  const BATCH = 32;
  const vectors: number[][] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const res = await embedTexts({ input: slice.map((c) => c.embedText.slice(0, 5900)) });
    res.vectors.forEach((v, j) => {
      vectors[i + j] = v.embedding;
    });
    process.stdout.write(`\r[embed] ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  process.stdout.write('\n');
  return vectors;
}

async function stageRetrieval(docs: Doc[], chunks: Chunk[], topicFilter: string[] | null, scope: string): Promise<{
  cases: CaseResult[];
  negatives: Array<{ topicKey: string; query: string; topCosine: number; topTitle: string }>;
}> {
  console.log(`[retrieval] 嵌入 ${chunks.length} 个块…`);
  const vectors = await embedAll(chunks);
  const cases: CaseResult[] = [];
  const negatives: Array<{ topicKey: string; query: string; topCosine: number; topTitle: string }> = [];
  // 生产口径：recallMaterialChunks 不按目标分区，候选是「该用户全部资料」（截 8 份）
  const globalIdxs = chunks.map((c, i) => i);

  for (const topic of TOPICS) {
    if (topicFilter && !topicFilter.includes(topic.key)) continue;
    // 候选集：topic = 该主题抓到的资料（贴近「一个目标的资料包」）；
    //         global = 全部资料混在一起（贴近生产的用户级召回，考跨主题误召）
    const idxs = scope === 'global'
      ? globalIdxs
      : globalIdxs.filter((i) => docs[chunks[i].docIdx]?.topicKey === topic.key);
    if (idxs.length === 0) continue;
    console.log(`\n[retrieval] ${topic.label}：候选块 ${idxs.length}（scope=${scope}）`);

    for (const probe of topic.probes) {
      const queryVec = (await embedTexts({ input: probe.q })).vectors[0]?.embedding;
      if (!queryVec) continue;

      const scored = idxs.map((i) => ({
        idx: i,
        score: cosineSimilarity(queryVec, vectors[i]),
      })).sort((a, b) => b.score - a.score);

      const goldIdxs = scored.filter((s) => probe.anchors.some((a) => norm(chunks[s.idx].text).includes(norm(a))));
      const anchorFound = goldIdxs.length > 0;
      const goldDocIds = new Set(goldIdxs.map((g) => chunks[g.idx].docIdx));
      const goldSet = new Set(goldIdxs.map((g) => g.idx));

      // 纯余弦名次
      const cosRank = goldIdxs.length ? scored.findIndex((s) => goldSet.has(s.idx)) + 1 : 0;

      // rerank：取余弦 top-30 候选池（与 material-semantic 的放大策略一致）
      const pool = scored.slice(0, Math.min(30, scored.length));
      let rerankOrder = pool.map((p) => p.idx);
      let topRerankScore: number | null = null;
      try {
        const rr = await rerankDocuments({ query: probe.q, documents: pool.map((p) => chunks[p.idx].text.slice(0, 1800)) });
        rerankOrder = rr.results.map((r) => pool[r.index]?.idx).filter((v): v is number => typeof v === 'number');
        topRerankScore = rr.results[0]?.relevanceScore ?? null;
      } catch (error) {
        console.log(`  rerank 失败（${probe.q}）：${error instanceof Error ? error.message : String(error)}`);
      }
      const rrRank = goldIdxs.length ? rerankOrder.findIndex((i) => goldSet.has(i)) + 1 : 0;

      const goldIndexObj: GoldIndex = {
        grade: (rank: number) => {
          const idx = rerankOrder[rank];
          if (idx === undefined) return 0;
          if (goldSet.has(idx)) return 2;
          return goldDocIds.has(chunks[idx].docIdx) ? 1 : 0;
        },
        goldCount: () => goldSet.size,
        sameDocCount: () => idxs.filter((i) => goldDocIds.has(chunks[i].docIdx) && !goldSet.has(i)).length,
      };
      const goldIndexCosine: GoldIndex = {
        grade: (rank: number) => {
          const s = scored[rank];
          if (!s) return 0;
          if (goldSet.has(s.idx)) return 2;
          return goldDocIds.has(chunks[s.idx].docIdx) ? 1 : 0;
        },
        goldCount: () => goldSet.size,
        sameDocCount: () => idxs.filter((i) => goldDocIds.has(chunks[i].docIdx) && !goldSet.has(i)).length,
      };

      const recallAtK: Record<string, boolean> = {};
      for (const k of [1, 3, 5, 10, 20]) {
        recallAtK[`@${k}`] = cosRank > 0 && cosRank <= k;
      }

      cases.push({
        topicKey: topic.key,
        query: probe.q,
        anchors: probe.anchors,
        anchorFound,
        goldCount: goldSet.size,
        cosineRankOfGold: cosRank,
        rerankRankOfGold: rrRank,
        recallAtK,
        rrCosine: cosRank > 0 ? 1 / cosRank : 0,
        rrRerank: rrRank > 0 ? 1 / rrRank : 0,
        ndcg10Cosine: ndcgAt(scored.map((s) => s.idx), new Set(), goldIndexCosine, 10),
        ndcg10Rerank: ndcgAt(rerankOrder, new Set(), goldIndexObj, 10),
        top1DocCorrectCosine: scored[0] ? goldDocIds.has(chunks[scored[0].idx].docIdx) : false,
        top1DocCorrectRerank: rerankOrder[0] !== undefined ? goldDocIds.has(chunks[rerankOrder[0]].docIdx) : false,
        topCosineScore: scored[0]?.score ?? 0,
        topRerankScore,
      });
      console.log(
        `  ${anchorFound ? 'GOLD' : 'MISS'} 「${probe.q}」 cosRank=${cosRank || '-'} → rrRank=${rrRank || '-'} ` +
        `top1Doc ${goldDocIds.has(chunks[scored[0]?.idx]?.docIdx ?? -1) ? '✓' : '✗'} score=${(scored[0]?.score ?? 0).toFixed(3)}`
      );
    }

    // 负样本：语料答不上的问题，看最高分是不是照样很高（无阈值 ⇒ 无法拒答）
    try {
      const qv = (await embedTexts({ input: topic.negative })).vectors[0]?.embedding;
      if (qv) {
        const scored = idxs.map((i) => ({ idx: i, score: cosineSimilarity(qv, vectors[i]) })).sort((a, b) => b.score - a.score);
        negatives.push({
          topicKey: topic.key,
          query: topic.negative,
          topCosine: scored[0]?.score ?? 0,
          topTitle: chunks[scored[0]?.idx]?.title ?? '',
        });
        console.log(`  NEG 「${topic.negative}」 topCos=${(scored[0]?.score ?? 0).toFixed(3)}`);
      }
    } catch {
      /* ignore */
    }
  }

  return { cases, negatives };
}

// ───────────────────────────── 汇总 ─────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function summarize(cases: CaseResult[], negatives: Array<{ topCosine: number }>, diags: ChunkDiag[]): void {
  const graded = cases.filter((c) => c.anchorFound);
  console.log('\n════════════════ 汇总 ════════════════');
  console.log(`语料/切分：${diags.reduce((s, d) => s + d.docs, 0)} 份文档，${diags.reduce((s, d) => s + d.chunks, 0)} 个块`);
  const totalDocs = diags.reduce((s, d) => s + d.docs, 0);
  const totalJunk = diags.reduce((s, d) => s + d.junkDocs, 0);
  const defectTotals: Record<string, number> = {};
  for (const d of diags) for (const [k, v] of Object.entries(d.junkByDefect)) defectTotals[k] = (defectTotals[k] ?? 0) + v;
  console.log(`语料可用性：可用 ${totalDocs - totalJunk}/${totalDocs}（${((1 - totalJunk / Math.max(1, totalDocs)) * 100).toFixed(1)}%），缺陷分布 ${Object.entries(defectTotals).map(([k, v]) => `${k}:${v}`).join(' ') || '无'}`);
  const truncTotal = diags.reduce((s, d) => s + d.truncatedChars, 0);
  const truncFactTotal = diags.reduce((s, d) => s + d.factLostByTruncation, 0);
  console.log(`生产口径（160K 截断）：丢 ${truncTotal} 字，${truncFactTotal} 个探针事实因此不可召回`);
  console.log(`块长中位 ${diags.map((d) => d.medianChars).join('/')}（按主题），碎块率 ${(mean(diags.map((d) => d.fragmentRatio)) * 100).toFixed(1)}%`);
  const fs2 = diags.reduce((s, d) => ({ f: s.f + d.factSurvival.found, v: s.v + d.factSurvival.survived, l: s.l + d.factSurvival.lost }), { f: 0, v: 0, l: 0 });
  console.log(`事实存活：${fs2.v}/${fs2.f}（被切分切断 ${fs2.l}）`);
  console.log(`\n检出 query：${graded.length}/${cases.length}`);
  if (graded.length) {
    console.log(`Recall@1  ${(mean(graded.map((c) => (c.recallAtK['@1'] ? 1 : 0))) * 100).toFixed(1)}%`);
    console.log(`Recall@5  ${(mean(graded.map((c) => (c.recallAtK['@5'] ? 1 : 0))) * 100).toFixed(1)}%`);
    console.log(`Recall@10 ${(mean(graded.map((c) => (c.recallAtK['@10'] ? 1 : 0))) * 100).toFixed(1)}%`);
    console.log(`Recall@20 ${(mean(graded.map((c) => (c.recallAtK['@20'] ? 1 : 0))) * 100).toFixed(1)}%`);
    console.log(`MRR@10    余弦 ${mean(graded.map((c) => c.rrCosine)).toFixed(3)} → rerank ${mean(graded.map((c) => c.rrRerank)).toFixed(3)}`);
    console.log(`nDCG@10   余弦 ${mean(graded.map((c) => c.ndcg10Cosine)).toFixed(3)} → rerank ${mean(graded.map((c) => c.ndcg10Rerank)).toFixed(3)}`);
    const better = graded.filter((c) => c.rerankRankOfGold > 0 && c.cosineRankOfGold > 0 && c.rerankRankOfGold < c.cosineRankOfGold).length;
    const worse = graded.filter((c) => c.rerankRankOfGold > 0 && c.cosineRankOfGold > 0 && c.rerankRankOfGold > c.cosineRankOfGold).length;
    console.log(`rerank 名次改善 ${better} 例 / 变差 ${worse} 例`);
    console.log(`Top1 文档正确率 余弦 ${(mean(graded.map((c) => (c.top1DocCorrectCosine ? 1 : 0))) * 100).toFixed(1)}% → rerank ${(mean(graded.map((c) => (c.top1DocCorrectRerank ? 1 : 0))) * 100).toFixed(1)}%`);
  }
  const negScores = negatives.map((n) => n.topCosine);
  const posScores = graded.map((c) => c.topCosineScore);
  console.log(`\n正样本 top 余弦 ${mean(posScores).toFixed(3)}（min ${Math.min(...posScores).toFixed(3)}）`);
  console.log(`负样本 top 余弦 ${mean(negScores).toFixed(3)}（max ${Math.max(...negScores).toFixed(3)}）`);
}

// ───────────────────────────── main ─────────────────────────────

async function main(): Promise<void> {
  const arg = (name: string): string | null => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : null;
  };
  const stage = arg('stage') ?? 'all';
  const topicsArg = arg('topics');
  const topicFilter = topicsArg ? topicsArg.split(',').map((s) => s.trim()) : null;
  // 对照开关：--junk=exclude 剔除含缺陷语料（模拟「入库闸门有效」的反事实世界）
  const junkMode = arg('junk') ?? 'include';

  ensureDir();
  if (stage === 'fetch' || stage === 'all') {
    await stageFetch(topicFilter);
  }
  let docs = loadCorpus();
  if (topicFilter) docs = docs.filter((d) => topicFilter.includes(d.topicKey));
  if (junkMode === 'exclude') {
    const before = docs.length;
    docs = docs.filter((d) => classifyDoc(d).length === 0);
    console.log(`[corpus] --junk=exclude：剔除 ${before - docs.length} 份缺陷资料`);
  }
  console.log(`\n[corpus] ${docs.length} 份文档，${docs.reduce((s, d) => s + d.text.length, 0)} 字`);

  const chunks = buildChunks(docs);
  const diags = diagnoseChunking(docs, chunks, topicFilter);
  console.log('\n════════════════ 切分诊断 ════════════════');
  for (const d of diags) {
    const junk = d.junkDocs > 0
      ? ` 垃圾 ${d.junkDocs}/${d.docs}(${Object.entries(d.junkByDefect).map(([k, v]) => `${k}:${v}`).join(',')})`
      : '';
    const trunc = d.truncatedChars > 0 ? ` 160K截断丢${d.truncatedChars}字/丢事实${d.factLostByTruncation}` : '';
    console.log(
      `${d.topicKey}: ${d.docs} 份 / ${d.chunks} 块，中位 ${d.medianChars} 字（p10=${d.p10Chars}, p90=${d.p90Chars}），` +
      `碎块 ${(d.fragmentRatio * 100).toFixed(0)}%，撞上限 ${(d.cappedRatio * 100).toFixed(0)}%，事实存活 ${d.factSurvival.survived}/${d.factSurvival.found}${junk}${trunc}`
    );
  }

  if (stage === 'chunk') return;

  const { cases, negatives } = await stageRetrieval(docs, chunks, topicFilter, arg('scope') ?? 'topic');
  summarize(cases, negatives, diags);
  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), docs: docs.length, chunks: chunks.length, diags, cases, negatives }, null, 2),
    'utf-8'
  );
  console.log(`\n报告已写入 ${REPORT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('[goal-material-retrieval] 失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
