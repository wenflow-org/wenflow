/**
 * goal:material:answerability:eval —— 「这段材料能不能回答这个问题」的独立评测（扩大样本版）。
 *
 * 为什么需要这一份：
 *   `eval-goal-material-retrieval.ts` 只测了「能不能把金标块召回」，没有测「召回出来的块里到底有没有答案」。
 *   而生产链路（`recallMaterialChunks`）**没有相似度阈值**，恒返回 topK，所以「答不上来也会硬塞 6 条」。
 *   这件事用余弦分解决不了（正负样本分布重叠），需要用决策模型判可答性。
 *
 * 本脚本做的事：
 *   1. 按生产口径切块（160K 截断 + 900 字预算）；
 *   2. 每个探针构造三类配对，扩大样本并覆盖真实的难例：
 *        pos      —— 含金标锚点的块（材料里确实有答案）
 *        hard_neg —— **同主题**、但锚点不出现的块（最容易骗过模型的一类）
 *        easy_neg —— 跨主题的块（对照组，预期都容易判对）
 *   3. 对每个配对同时算两种分：bge-m3 余弦、决策模型 noul；
 *   4. 用 AUC 与最佳阈值（平衡准确率最优）对比两种分，直接回答「余弦阈值为什么不行、替代方案能到什么水平」。
 *
 * 跑法：
 *   npx ts-node --transpile-only src/scripts/eval-goal-material-answerability.ts
 *   ... --judge=clef-omni | clef-flash | clef | alibaba   （默认 alibaba）
 *   ... --pairs=2                                          （每个探针每个类别取几对，默认 2）
 *   ... --topics=http,food
 *   ... --no-cosine                                        （跳过 embedding，只跑决策模型）
 *
 * 环境变量：
 *   CF_TOKEN / CF_ACCOUNT_ID      Cloudflare Workers AI（clef 系）
 *   DASHSCOPE_API_KEY             阿里云 MaaS（judge=alibaba）
 *   本地 embedding 走 backend/.env 的 EMBEDDING_*（bge-m3）
 *
 * 隔离：不写平台资料库、不调 HTTP 服务、不落 DB。报告写 doc/local。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chunkMaterialMarkdown, chunkEmbedText } from '../services/materials/material-chunker';
import { parseDocument } from '../services/materials/document-parser';
import { normalizeWebTextStructure } from '../services/materials/material-web-structure';
import { embedTexts, cosineSimilarity, rerankDocuments } from '../services/embedding';

const OUT_DIR = path.resolve(__dirname, '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18');
const CORPUS_FILE = path.join(OUT_DIR, 'corpus.json');
const REPORT_FILE = path.join(OUT_DIR, 'answerability-report.json');

const MAX_WEB_TEXT_CHARS = 160_000;

// ───────────────────────────── 探针集（64 条） ─────────────────────────────
// kind 只用于分组统计，不参与判定：
//   direct     —— 问题用词与材料接近
//   paraphrase —— 问题换说法，材料里没有这些字眼
//   inference  —— 需要跨句/跨段把线索拼起来

interface Probe {
  topic: string;
  q: string;
  anchors: string[];
  kind: 'direct' | 'paraphrase' | 'inference';
}

const PROBES: Probe[] = [
  // ── bio 光合作用 ──
  { topic: 'bio', kind: 'direct', q: '光反应发生在细胞的哪个结构上', anchors: ['类囊体'] },
  { topic: 'bio', kind: 'direct', q: '暗反应还有一个名字叫什么循环', anchors: ['卡尔文循环', 'Calvin'] },
  { topic: 'bio', kind: 'direct', q: '哪个物质负责在光反应里提供还原力', anchors: ['NADPH', 'NADP'] },
  { topic: 'bio', kind: 'paraphrase', q: '植物把光能转成化学能的两个阶段分别叫什么', anchors: ['光反应', '暗反应'] },
  { topic: 'bio', kind: 'paraphrase', q: '二氧化碳是在哪一步被固定成有机物的', anchors: ['暗反应', '叶绿体基质'] },
  { topic: 'bio', kind: 'inference', q: '如果叶绿体类囊体膜被破坏，哪一步会先停下来', anchors: ['类囊体', '光反应'] },
  { topic: 'bio', kind: 'inference', q: '光合作用释放的气体来自哪个原料', anchors: ['二氧化碳', '水', '氧气'] },
  { topic: 'bio', kind: 'direct', q: '光反应和暗反应在位置上有什么区别', anchors: ['类囊体', '叶绿体基质'] },

  // ── http 缓存 ──
  { topic: 'http', kind: 'direct', q: 'max-age 的单位是什么', anchors: ['max-age'] },
  { topic: 'http', kind: 'direct', q: '服务器用什么状态码告诉浏览器资源没变', anchors: ['304'] },
  { topic: 'http', kind: 'direct', q: 'ETag 是干什么用的', anchors: ['ETag', 'Etag'] },
  { topic: 'http', kind: 'direct', q: '协商缓存用哪个请求头带上上次的修改时间', anchors: ['If-Modified-Since'] },
  { topic: 'http', kind: 'paraphrase', q: '想让浏览器每次都去问服务器有没有更新，该用哪个指令', anchors: ['no-cache'] },
  { topic: 'http', kind: 'paraphrase', q: '完全禁止缓存任何副本的指令是哪个', anchors: ['no-store'] },
  { topic: 'http', kind: 'inference', q: '共享缓存和私有缓存分别给谁用', anchors: ['共享缓存', '私有缓存'] },
  { topic: 'http', kind: 'inference', q: '给 CDN 单独设置缓存时间的指令是什么', anchors: ['s-maxage'] },

  // ── edu 3-6 岁指南 ──
  { topic: 'edu', kind: 'direct', q: '指南把幼儿的学习与发展分成哪几个领域', anchors: ['五个领域', '五大领域'] },
  { topic: 'edu', kind: 'direct', q: '指南是哪个部门印发的', anchors: ['教育部关于印发', '教育部'] },
  { topic: 'edu', kind: 'direct', q: '指南的语言领域要求幼儿做到什么', anchors: ['语言领域'] },
  { topic: 'edu', kind: 'direct', q: '指南的社会领域关注哪些方面', anchors: ['社会领域'] },
  { topic: 'edu', kind: 'paraphrase', q: '这份文件适用的孩子年龄范围是多少', anchors: ['3-6岁', '3—6岁', '3～6岁'] },
  { topic: 'edu', kind: 'paraphrase', q: '教师可以照着哪些提示来设计活动', anchors: ['教育建议'] },
  { topic: 'edu', kind: 'inference', q: '指南为什么反对提前教小学内容', anchors: ['小学化', '提前'] },
  { topic: 'edu', kind: 'inference', q: '判断幼儿发展水平时可以看哪些具体行为', anchors: ['典型表现'] },

  // ── math 勾股定理 ──
  { topic: 'math', kind: 'direct', q: '直角三角形三条边的平方关系是什么', anchors: ['平方和'] },
  { topic: 'math', kind: 'direct', q: '中国古代把这个定理叫什么', anchors: ['勾股'] },
  { topic: 'math', kind: 'direct', q: '公式里最长的那条边叫什么', anchors: ['斜边'] },
  { topic: 'math', kind: 'paraphrase', q: '三边长度是 3、4、5 的三角形有什么特点', anchors: ['3、4、5', '3,4,5', '3 4 5', '3，4，5'] },
  { topic: 'math', kind: 'paraphrase', q: '西方把这个定理归功于谁', anchors: ['毕达哥拉斯'] },
  { topic: 'math', kind: 'inference', q: '已知两条直角边怎么求第三边', anchors: ['平方和', '直角边'] },
  { topic: 'math', kind: 'inference', q: '用面积拼图的方法怎么证明这个定理', anchors: ['弦图', '赵爽', '面积'] },
  { topic: 'math', kind: 'direct', q: '反过来，知道三边平方和能判断什么', anchors: ['逆定理', '直角'] },

  // ── psych 建构主义 ──
  { topic: 'psych', kind: 'direct', q: '建构主义认为学习是怎么发生的', anchors: ['建构'] },
  { topic: 'psych', kind: 'direct', q: '建构主义强调哪几个环境要素', anchors: ['情境', '协作', '会话'] },
  { topic: 'psych', kind: 'direct', q: '最近发展区是谁提出的', anchors: ['维果茨基', '维果斯基'] },
  { topic: 'psych', kind: 'direct', q: '发现学习是谁的主张', anchors: ['布鲁纳'] },
  { topic: 'psych', kind: 'paraphrase', q: '认知结构通过哪两种方式发生变化', anchors: ['同化', '顺应'] },
  { topic: 'psych', kind: 'paraphrase', q: '别人给的临时帮助、逐渐撤掉，这种支持叫什么', anchors: ['支架', '脚手架'] },
  { topic: 'psych', kind: 'inference', q: '为什么建构主义课堂强调小组讨论', anchors: ['协作', '会话', '社会性'] },
  { topic: 'psych', kind: 'inference', q: '学习者原有的经验在新知识学习中起什么作用', anchors: ['原有', '经验'] },

  // ── food 食品添加剂 ──
  { topic: 'food', kind: 'direct', q: '食品添加剂使用标准的代号是什么', anchors: ['GB 2760', 'GB2760'] },
  { topic: 'food', kind: 'direct', q: '标准里规定的用量上限叫什么', anchors: ['最大使用量'] },
  { topic: 'food', kind: 'direct', q: '哪些情形下明确不允许使用添加剂', anchors: ['不得以掩盖食品腐败变质', '不得使用', '禁止使用'] },
  { topic: 'food', kind: 'paraphrase', q: '常见的防腐类添加剂有哪些', anchors: ['苯甲酸', '山梨酸'] },
  { topic: 'food', kind: 'paraphrase', q: '甜味剂属于哪一类食品添加剂', anchors: ['甜味剂'] },
  { topic: 'food', kind: 'paraphrase', q: '上一步工序带进来的添加剂怎么算', anchors: ['带入原则'] },
  { topic: 'food', kind: 'inference', q: '超出允许范围使用添加剂算不算违规', anchors: ['超范围', '超限量'] },
  { topic: 'food', kind: 'inference', q: '最终食品里残留多少添加剂有没有规定', anchors: ['残留量'] },

  // ── cloud 云服务模式 ──
  { topic: 'cloud', kind: 'direct', q: '自己管操作系统的是哪种云服务', anchors: ['IaaS'] },
  { topic: 'cloud', kind: 'direct', q: '只提供开发部署环境的是哪种', anchors: ['PaaS'] },
  { topic: 'cloud', kind: 'direct', q: '拿来就能用的软件属于哪种', anchors: ['SaaS'] },
  { topic: 'cloud', kind: 'paraphrase', q: '三种模式的英文缩写分别是什么', anchors: ['IaaS', 'PaaS', 'SaaS'] },
  { topic: 'cloud', kind: 'paraphrase', q: '用户需要自己维护的东西在三种模式里怎么递减', anchors: ['运维', '责任'] },
  { topic: 'cloud', kind: 'inference', q: '想只关心自己的代码、不管服务器该选哪种', anchors: ['PaaS'] },
  { topic: 'cloud', kind: 'inference', q: '容器作为一种服务有没有单独的类别', anchors: ['CaaS'] },
  { topic: 'cloud', kind: 'direct', q: '哪家厂商的文档里提到了容器服务 CaaS', anchors: ['CaaS', 'OpenShift'] },

  // ── photo 摄影 ──
  { topic: 'photo', kind: 'direct', q: '想让背景更虚该怎么办', anchors: ['景深'] },
  { topic: 'photo', kind: 'direct', q: '光圈数值越小代表什么', anchors: ['光圈'] },
  { topic: 'photo', kind: 'direct', q: '拍流水丝滑用什么快门', anchors: ['快门'] },
  { topic: 'photo', kind: 'direct', q: '感光度高会带来什么副作用', anchors: ['ISO', '噪点'] },
  { topic: 'photo', kind: 'paraphrase', q: '进光量由哪三个参数决定', anchors: ['曝光'] },
  { topic: 'photo', kind: 'paraphrase', q: '把主体放在画面交叉点上是什么构图法', anchors: ['三分法'] },
  { topic: 'photo', kind: 'inference', q: '逆光拍人像需要注意什么', anchors: ['逆光', '补光'] },
  { topic: 'photo', kind: 'inference', q: '拍夜景不想糊，参数上要牺牲什么', anchors: ['ISO', '快门', '噪点'] },
];

// ───────────────────────────── 数据结构 ─────────────────────────────

interface Doc {
  topicKey: string;
  title: string;
  url: string;
  text: string;
}

interface Chunk {
  idx: number;
  docIdx: number;
  topic: string;
  text: string;
  embedText: string;
  position: number;
}

type PairKind = 'pos' | 'hard_neg' | 'easy_neg';

interface Pair {
  probeIdx: number;
  topic: string;
  kind: PairKind;
  question: string;
  probeKind: Probe['kind'];
  chunk: Chunk;
  anchorHit: boolean;
}

interface ScoredPair extends Pair {
  cosine: number | null;
  judge: number | null;
  /** 独立标注复核：true=这段材料确实能回答，false=不能，null=复核失败 */
  label?: boolean | null;
}

const norm = (s: string): string => String(s || '').replace(/\s+/g, '').toLowerCase();
const hasAnchor = (text: string, anchors: string[]): boolean => anchors.some((a) => norm(text).includes(norm(a)));

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

// ───────────────────────────── 切块（生产口径） ─────────────────────────────

/**
 * 与 ingestWebMaterial 同一套清洗：结构恢复 → parseDocument 文本闸门。
 * 不这么做的话，抓取原文里的导航/页头会变成块，正例标签会把「只含锚点、不含答案」的碎块算成可答。
 */
async function buildChunks(docs: Doc[]): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const [docIdx, doc] of docs.entries()) {
    const bounded = doc.text.slice(0, MAX_WEB_TEXT_CHARS);
    let markdown = bounded;
    try {
      const structured = normalizeWebTextStructure(bounded);
      const parsed = await parseDocument(Buffer.from(structured.markdown, 'utf-8'), 'web-source.md');
      if (parsed.status === 'rejected') continue;
      markdown = parsed.markdown;
    } catch {
      continue;
    }
    for (const c of chunkMaterialMarkdown(markdown)) {
      out.push({
        idx: out.length,
        docIdx,
        topic: doc.topicKey,
        text: c.text,
        embedText: chunkEmbedText(c),
        position: c.index,
      });
    }
  }
  return out;
}

/** 正例质量：锚点必须落在一句像正文的话里（≥15 字），不能只是导航/标题里出现过。 */
function anchorInProse(text: string, anchors: string[]): boolean {
  const sentences = text.split(/[。！？；\n]/);
  return sentences.some((sentence) => {
    const flat = sentence.replace(/\s+/g, '');
    if (flat.length < 15) return false;
    return anchors.some((a) => norm(flat).includes(norm(a)));
  });
}

// ───────────────────────────── 配对构造 ─────────────────────────────

function buildPairs(probes: Probe[], chunks: Chunk[], perProbe: number): { pairs: Pair[]; coverage: { found: number; total: number; misses: string[] } } {
  const byTopic = new Map<string, Chunk[]>();
  for (const c of chunks) {
    const list = byTopic.get(c.topic) ?? [];
    list.push(c);
    byTopic.set(c.topic, list);
  }
  const topics = [...byTopic.keys()];
  const pairs: Pair[] = [];
  const misses: string[] = [];

  probes.forEach((probe, probeIdx) => {
    const sameTopic = byTopic.get(probe.topic) ?? [];
    const gold = sameTopic.filter((c) => anchorInProse(c.text, probe.anchors));
    if (gold.length === 0) {
      misses.push(`${probe.topic}:${probe.q}`);
      return;
    }
    // 正例：取含锚点（且在正文句里）的前 N 个块
    for (const chunk of gold.slice(0, perProbe)) {
      pairs.push({ probeIdx, topic: probe.topic, kind: 'pos', question: probe.q, probeKind: probe.kind, chunk, anchorHit: true });
    }

    // 难负例：同主题、锚点不出现；优先同文档（同一篇材料里最容易混淆的段落），按离金标块的距离从远到近挑
    const goldDocs = new Set(gold.map((g) => g.docIdx));
    const candidates = sameTopic
      .filter((c) => !hasAnchor(c.text, probe.anchors))
      .map((c) => ({
        c,
        sameDoc: goldDocs.has(c.docIdx),
        dist: Math.min(...gold.map((g) => Math.abs(g.position - c.position))),
      }))
      .sort((a, b) => (Number(b.sameDoc) - Number(a.sameDoc)) || (b.dist - a.dist));
    for (const { c } of candidates.slice(0, perProbe)) {
      pairs.push({ probeIdx, topic: probe.topic, kind: 'hard_neg', question: probe.q, probeKind: probe.kind, chunk: c, anchorHit: false });
    }

    // 易负例：换一个主题的块
    const otherTopic = topics.find((t) => t !== probe.topic);
    const pool = otherTopic ? byTopic.get(otherTopic) ?? [] : [];
    if (pool.length) {
      const pick = pool[(probeIdx * 3) % pool.length];
      pairs.push({ probeIdx, topic: probe.topic, kind: 'easy_neg', question: probe.q, probeKind: probe.kind, chunk: pick, anchorHit: false });
    }
  });

  return { pairs, coverage: { found: probes.length - misses.length, total: probes.length, misses } };
}

// ───────────────────────────── 打分 ─────────────────────────────

interface JudgeConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
  /** 部分端点要求模型写在 body 里（Cloudflare 写在路径，阿里云写在 body） */
  bodyModel?: string;
  extract: (body: unknown) => number | null;
}

function buildJudge(name: string): JudgeConfig {
  if (name === 'custom') {
    // 自建 SystemOne 兼容部署（laya 等）：只靠环境变量，便于同一批样本横向对比
    const style = (process.env.DECISION_CUSTOM_AUTH_STYLE || 'bearer').toLowerCase();
    const key = process.env.DECISION_CUSTOM_API_KEY || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) {
      if (style === 'header') headers['X-API-Key'] = key;
      else if (style === 'raw') headers.Authorization = key;
      else headers.Authorization = `Bearer ${key}`;
    }
    return {
      name: `custom:${process.env.DECISION_CUSTOM_MODEL || 'unnamed'}`,
      url: process.env.DECISION_CUSTOM_URL || '',
      headers,
      bodyModel: process.env.DECISION_CUSTOM_MODEL || undefined,
      extract: (body: unknown) => {
        const obj = body as { result?: { answers?: { a?: { noul?: number } } }; answers?: { a?: { noul?: number } } };
        const c = obj?.result ?? obj;
        return typeof c?.answers?.a?.noul === 'number' ? c.answers.a.noul : null;
      },
    };
  }
  if (name === 'alibaba') {
    const key = process.env.DASHSCOPE_API_KEY || '';
    return {
      name: 'alibaba:decision-model-preview',
      url: 'https://ws-j2djr3yj51rhlwmw.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      bodyModel: 'decision-model-preview',
      extract: (body: unknown) => {
        const b = body as { answers?: { a?: { noul?: number } } };
        return typeof b?.answers?.a?.noul === 'number' ? b.answers.a.noul : null;
      },
    };
  }
  const token = process.env.CF_TOKEN || '';
  const account = process.env.CF_ACCOUNT_ID || process.env.CF_ACCT || '';
  const model = name === 'clef-flash' || name === 'clef' ? name : 'clef-omni';
  return {
    name: `cloudflare:${model}`,
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    extract: (body: unknown) => {
      const b = body as { result?: { answers?: { a?: { noul?: number } } } };
      return typeof b?.result?.answers?.a?.noul === 'number' ? b.result.answers.a.noul : null;
    },
  };
}

async function judgeOne(cfg: JudgeConfig, chunk: string, question: string): Promise<number | null> {
  const instructions =
    process.env.ANSWERABILITY_INSTRUCTIONS ||
    '这段材料是否包含足以回答该问题所需的信息？材料里明确说明了该问题所问的概念、数值或结论才给高概率；' +
    '只有同一大主题但没有直接相关信息给低概率。';
  // ANSWERABILITY_QUESTION_TYPE=choice 时改用「有/没有」二选一，用 P(有) 当分数：
  // 部分模型（如 laya 部署）的 noul 有明显「偏说能答」的校准偏差，choice 的概率分布可能更分得开。
  const useChoice = (process.env.ANSWERABILITY_QUESTION_TYPE || 'noul') === 'choice';
  const questions = useChoice
    ? {
        a: {
          type: 'choice',
          instructions,
          criteria: { 有: '材料里明确写出了回答该问题所需的具体答案内容', 没有: '材料里没有该问题所问的具体答案内容' },
        },
      }
    : { a: { type: 'noul', instructions } };
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: cfg.headers,
    body: JSON.stringify({
      ...(cfg.bodyModel ? { model: cfg.bodyModel } : {}),
      state: { 材料: chunk, 问题: question },
      questions,
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (useChoice) {
    const container = (body as { result?: unknown })?.result ?? body;
    const probs = (container as { answers?: { a?: { probabilities?: Record<string, number> } } })?.answers?.a
      ?.probabilities;
    const yes = probs?.['有'];
    return typeof yes === 'number' ? yes : null;
  }
  return cfg.extract(body);
}

// ───────────────────────────── 独立标注复核 ─────────────────────────────
// 锚点法只能证明「这段里有这个词」，不能证明「这段能回答问题」。
// 用另一个会生成文本的模型（默认 deepseek-v4.1-flash，与做判定的 clef 不同家族）独立作答，
// 答不出 ⇒ 该配对实际不可答；由此得到 raw（锚点标签）与 clean（模型复核后）两套指标。

const LABEL_URL = process.env.LABEL_API_URL || 'https://newapi.wenflow.org/v1/chat/completions';
const LABEL_MODEL = process.env.LABEL_MODEL || 'deepseek-v4.1-flash';

async function labelOne(chunk: string, question: string): Promise<boolean | null> {
  const key = process.env.LABEL_API_KEY || process.env.EMBEDDING_API_KEY || '';
  if (!key) return null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(LABEL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LABEL_MODEL,
          messages: [
            {
              role: 'user',
              content: `材料：${chunk}\n\n问题：${question}\n\n只回答答案；如果材料里没有足够信息回答，只回答「无法回答」。`,
            },
          ],
          max_tokens: 300,
          temperature: 0,
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = String(body?.choices?.[0]?.message?.content ?? '').trim();
      if (!content) continue;
      return !/无法回答/.test(content);
    } catch {
      /* retry */
    }
  }
  return null;
}

// ───────────────────────────── 指标 ─────────────────────────────

function auc(pos: number[], neg: number[]): number {
  if (pos.length === 0 || neg.length === 0) return 0;
  let wins = 0;
  for (const p of pos) for (const n of neg) {
    if (p > n) wins += 1;
    else if (p === n) wins += 0.5;
  }
  return wins / (pos.length * neg.length);
}

interface ThresholdResult {
  threshold: number;
  tpr: number;
  tnr: number;
  balanced: number;
}

function bestThreshold(pos: number[], neg: number[]): ThresholdResult | null {
  if (pos.length === 0 || neg.length === 0) return null;
  const candidates = [...new Set([...pos, ...neg])].sort((a, b) => a - b);
  let best: ThresholdResult | null = null;
  for (const t of candidates) {
    const tpr = pos.filter((x) => x >= t).length / pos.length;
    const tnr = neg.filter((x) => x < t).length / neg.length;
    const balanced = (tpr + tnr) / 2;
    if (!best || balanced > best.balanced) best = { threshold: t, tpr, tnr, balanced };
  }
  return best;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** 有限并发 map（外部 API 调用用，避免串行太慢、并发过高被限流）。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ───────────────────────────── main ─────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS_FILE)) {
    console.error(`缺少语料缓存 ${CORPUS_FILE}，请先跑 eval-goal-material-retrieval --stage=fetch`);
    process.exitCode = 1;
    return;
  }
  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf-8'));
  const docs: Doc[] = Array.isArray(corpus?.docs) ? corpus.docs : [];
  const topicFilter = arg('topics')?.split(',').map((s) => s.trim()) ?? null;
  const perProbe = Math.max(1, Number(arg('pairs') ?? 2));
  const judgeName = arg('judge') ?? 'alibaba';
  const skipCosine = hasFlag('no-cosine');

  const probes = topicFilter ? PROBES.filter((p) => topicFilter.includes(p.topic)) : PROBES;
  const chunks = await buildChunks(docs);
  const { pairs, coverage } = buildPairs(probes, chunks, perProbe);

  console.log(`[setup] 语料 ${docs.length} 份 / ${chunks.length} 块；探针 ${coverage.found}/${coverage.total} 有金标`);
  if (coverage.misses.length) console.log(`[setup] 无金标（语料未覆盖）：${coverage.misses.join(' | ')}`);
  const countBy = (k: PairKind): number => pairs.filter((p) => p.kind === k).length;
  console.log(`[setup] 配对 ${pairs.length} 条：pos ${countBy('pos')} / hard_neg ${countBy('hard_neg')} / easy_neg ${countBy('easy_neg')}`);

  // 余弦分（按配对逐条算，块也会被重复算，规模可接受）
  const cosineByPair = new Map<number, number>();
  if (!skipCosine) {
    console.log('[cosine] 计算 bge-m3 余弦…');
    const uniqueQuestions = [...new Set(pairs.map((p) => p.question))];
    const qRes = await embedTexts({ input: uniqueQuestions });
    const qVec = new Map<string, number[]>();
    qRes.vectors.forEach((v, i) => qVec.set(uniqueQuestions[i], v.embedding));
    const uniqueChunks = [...new Map(pairs.map((p) => [p.chunk.idx, p.chunk])).values()];
    const cRes = await embedTexts({ input: uniqueChunks.map((c) => c.embedText.slice(0, 5900)) });
    const cVec = new Map<number, number[]>();
    cRes.vectors.forEach((v, i) => cVec.set(uniqueChunks[i].idx, v.embedding));
    pairs.forEach((p, i) => {
      const q = qVec.get(p.question);
      const c = cVec.get(p.chunk.idx);
      if (q && c) cosineByPair.set(i, cosineSimilarity(q, c));
    });
    console.log(`[cosine] 完成 ${cosineByPair.size}/${pairs.length}`);
  }

  // 打分：默认走决策模型；--ranker=rerank 时改用交叉编码重排器（查询 × 候选成对精排）
  const useRerank = (arg('ranker') ?? 'judge') === 'rerank';
  let cfg = buildJudge(judgeName);
  let scored: ScoredPair[];
  let failed = 0;

  if (useRerank) {
    // 生产同形：一条 query 带它那几条候选，一次调用拿回逐条精排分（不是逐对请求）
    cfg = { name: 'reranker:bge-reranker-v2-m3', url: 'local:rerank', headers: {}, extract: () => null };
    const byQuestion = new Map<string, number[]>();
    pairs.forEach((p, i) => {
      const list = byQuestion.get(p.question) ?? [];
      list.push(i);
      byQuestion.set(p.question, list);
    });
    const scores = new Array<number | null>(pairs.length).fill(null);
    console.log(`[reranker] bge-reranker-v2-m3，${byQuestion.size} 条 query（每条带 2~4 个候选）…`);
    let groups = 0;
    for (const [question, idxs] of byQuestion) {
      try {
        const res = await rerankDocuments({
          query: question,
          documents: idxs.map((i) => pairs[i].chunk.text.slice(0, 1800)),
        });
        for (const item of res.results) {
          const pairIdx = idxs[item.index];
          if (pairIdx !== undefined) scores[pairIdx] = item.relevanceScore;
        }
      } catch (error) {
        failed += idxs.length;
        console.log(`\n  rerank 失败（${question}）：${error instanceof Error ? error.message : String(error)}`);
      }
      groups += 1;
      if (groups % 10 === 0 || groups === byQuestion.size) process.stdout.write(`\r[reranker] ${groups}/${byQuestion.size}`);
    }
    process.stdout.write('\n');
    scored = pairs.map((p, i) => ({ ...p, cosine: cosineByPair.get(i) ?? null, judge: scores[i] }));
  } else if (!cfg.url || (cfg.headers.Authorization !== undefined && /Bearer\s*$/.test(String(cfg.headers.Authorization)))) {
    console.error(`[judge] 缺少凭证（judge=${judgeName}）`);
    process.exitCode = 1;
    return;
  } else {
    console.log(`[judge] ${cfg.name}，逐条打分（并发 6）…`);
    let done = 0;
    scored = await mapLimit(pairs, 6, async (pair, i) => {
      let score: number | null = null;
      try {
        score = await judgeOne(cfg, pair.chunk.text.slice(0, 4000), pair.question);
      } catch {
        score = null;
      }
      if (score === null) failed += 1;
      done += 1;
      if (done % 20 === 0 || done === pairs.length) process.stdout.write(`\r[judge] ${done}/${pairs.length}（失败 ${failed}）`);
      return { ...pair, cosine: cosineByPair.get(i) ?? null, judge: score };
    });
    process.stdout.write('\n');
  }

  // ── 独立标注复核（--no-label 可跳过） ──
  if (!hasFlag('no-label')) {
    console.log(`[label] 用 ${LABEL_MODEL} 复核每条配对是否真的可答（并发 8）…`);
    let done2 = 0;
    let failed2 = 0;
    await mapLimit(scored, 8, async (pair) => {
      pair.label = await labelOne(pair.chunk.text.slice(0, 4000), pair.question);
      if (pair.label === null || pair.label === undefined) failed2 += 1;
      done2 += 1;
      if (done2 % 20 === 0 || done2 === scored.length) process.stdout.write(`\r[label] ${done2}/${scored.length}（失败 ${failed2}）`);
    });
    process.stdout.write('\n');
  }

  // ── 分析 ──
  const usable = scored.filter((p) => p.judge !== null);
  const pos = usable.filter((p) => p.kind === 'pos').map((p) => p.judge as number);
  const hard = usable.filter((p) => p.kind === 'hard_neg').map((p) => p.judge as number);
  const easy = usable.filter((p) => p.kind === 'easy_neg').map((p) => p.judge as number);
  const allNeg = [...hard, ...easy];

  const cosPairs = scored.filter((p) => p.cosine !== null);
  const cosPos = cosPairs.filter((p) => p.kind === 'pos').map((p) => p.cosine as number);
  const cosHard = cosPairs.filter((p) => p.kind === 'hard_neg').map((p) => p.cosine as number);
  const cosEasy = cosPairs.filter((p) => p.kind === 'easy_neg').map((p) => p.cosine as number);
  const cosAllNeg = [...cosHard, ...cosEasy];

  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const min = (xs: number[]): number => (xs.length ? Math.min(...xs) : 0);
  const max = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0);

  console.log('\n════════════════ 可答性判定 ════════════════');
  console.log(`样本：正例 ${pos.length}，难负例 ${hard.length}，易负例 ${easy.length}（judge 失败 ${failed}）`);
  console.log('\n决策模型 noul：');
  console.log(`  正例  均值 ${mean(pos).toFixed(3)}  最小 ${min(pos).toFixed(3)}`);
  console.log(`  难负例 均值 ${mean(hard).toFixed(3)}  最大 ${max(hard).toFixed(3)}`);
  console.log(`  易负例 均值 ${mean(easy).toFixed(3)}  最大 ${max(easy).toFixed(3)}`);
  console.log(`  AUC  正例 vs 全部负例 ${auc(pos, allNeg).toFixed(4)}｜正例 vs 难负例 ${auc(pos, hard).toFixed(4)}`);
  const jBest = bestThreshold(pos, allNeg);
  if (jBest) {
    console.log(`  最佳阈值 ${jBest.threshold.toFixed(4)}：正例通过 ${pct(jBest.tpr)}，负例拒绝 ${pct(jBest.tnr)}（平衡准确率 ${jBest.balanced.toFixed(3)}）`);
  }
  // 固定阈值下的表现（便于生产取值）
  for (const t of [0.2, 0.3, 0.5, 0.7]) {
    const tpr = pos.filter((x) => x >= t).length / Math.max(1, pos.length);
    const tnrHard = hard.filter((x) => x < t).length / Math.max(1, hard.length);
    const tnrEasy = easy.filter((x) => x < t).length / Math.max(1, easy.length);
    console.log(`  th=${t.toFixed(1)}  正例通过 ${pct(tpr)}｜难负拒绝 ${pct(tnrHard)}｜易负拒绝 ${pct(tnrEasy)}`);
  }

  if (!skipCosine && cosPos.length && cosAllNeg.length) {
    console.log('\n纯余弦（bge-m3）：');
    console.log(`  正例  均值 ${mean(cosPos).toFixed(3)}  最小 ${min(cosPos).toFixed(3)}`);
    console.log(`  难负例 均值 ${mean(cosHard).toFixed(3)}  最大 ${max(cosHard).toFixed(3)}`);
    console.log(`  易负例 均值 ${mean(cosEasy).toFixed(3)}  最大 ${max(cosEasy).toFixed(3)}`);
    console.log(`  AUC  正例 vs 全部负例 ${auc(cosPos, cosAllNeg).toFixed(4)}｜正例 vs 难负例 ${auc(cosPos, cosHard).toFixed(4)}`);
    const cBest = bestThreshold(cosPos, cosAllNeg);
    if (cBest) {
      console.log(`  最佳阈值 ${cBest.threshold.toFixed(4)}：正例通过 ${pct(cBest.tpr)}，负例拒绝 ${pct(cBest.tnr)}（平衡准确率 ${cBest.balanced.toFixed(3)}）`);
    }
  }

  // 分类别看探针类型（direct / paraphrase / inference）
  console.log('\n按问题类型（决策模型，阈值 0.5）：');
  for (const kind of ['direct', 'paraphrase', 'inference'] as const) {
    const kp = usable.filter((p) => p.kind === 'pos' && p.probeKind === kind).map((p) => p.judge as number);
    const kn = usable.filter((p) => p.kind !== 'pos' && p.probeKind === kind).map((p) => p.judge as number);
    if (!kp.length) continue;
    const tpr = kp.filter((x) => x >= 0.5).length / kp.length;
    const tnr = kn.length ? kn.filter((x) => x < 0.5).length / kn.length : 0;
    console.log(`  ${kind.padEnd(10)} 正例 ${kp.length}（通过 ${pct(tpr)}）｜负例 ${kn.length}（拒绝 ${pct(tnr)}）`);
  }

  // ── 标注复核后的 clean 指标 ──
  const labeled = scored.filter((p) => p.label === true || p.label === false);
  if (labeled.length) {
    const posWrong = labeled.filter((p) => p.kind === 'pos' && p.label === false);
    const negWrong = labeled.filter((p) => p.kind !== 'pos' && p.label === true);
    const posClean = labeled.filter((p) => p.kind === 'pos' && p.label === true);
    const hardClean = labeled.filter((p) => p.kind === 'hard_neg' && p.label === false);
    const easyClean = labeled.filter((p) => p.kind === 'easy_neg' && p.label === false);

    console.log('\n标注复核：');
    console.log(`  可复核 ${labeled.length}/${scored.length}`);
    console.log(`  正例被复核判为「答不了」 ${posWrong.length}/${labeled.filter((p) => p.kind === 'pos').length}（锚点标签噪声）`);
    console.log(`  负例被复核判为「能答」 ${negWrong.length}/${labeled.filter((p) => p.kind !== 'pos').length}（难负例里混入真可答段）`);
    for (const kind of ['hard_neg', 'easy_neg'] as const) {
      const all = labeled.filter((p) => p.kind === kind);
      const wrong = all.filter((p) => p.label === true);
      if (all.length) console.log(`    ${kind}: ${wrong.length}/${all.length} 被判可答`);
    }

    const jPos = posClean.map((p) => p.judge as number);
    const jHard = hardClean.map((p) => p.judge as number);
    const jEasy = easyClean.map((p) => p.judge as number);
    const jAllNeg = [...jHard, ...jEasy];
    console.log(`\n清理后样本：正例 ${jPos.length}，难负例 ${jHard.length}，易负例 ${jEasy.length}`);
    console.log(`  决策模型 AUC ${auc(jPos, jAllNeg).toFixed(4)}（vs 难负 ${auc(jPos, jHard).toFixed(4)}）`);
    for (const t of [0.2, 0.3, 0.5, 0.7]) {
      const tpr = jPos.filter((x) => x >= t).length / Math.max(1, jPos.length);
      const tnrHard = jHard.filter((x) => x < t).length / Math.max(1, jHard.length);
      const tnrEasy = jEasy.filter((x) => x < t).length / Math.max(1, jEasy.length);
      console.log(`  th=${t.toFixed(1)}  正例通过 ${pct(tpr)}｜难负拒绝 ${pct(tnrHard)}｜易负拒绝 ${pct(tnrEasy)}`);
    }
    const cPos = posClean.map((p) => p.cosine).filter((x): x is number => x !== null);
    const cHard = hardClean.map((p) => p.cosine).filter((x): x is number => x !== null);
    const cEasy = easyClean.map((p) => p.cosine).filter((x): x is number => x !== null);
    if (cPos.length && (cHard.length || cEasy.length)) {
      console.log(`  余弦 AUC ${auc(cPos, [...cHard, ...cEasy]).toFixed(4)}（vs 难负 ${auc(cPos, cHard).toFixed(4)}）`);
    }
  }

  // 可疑样本：正例低分 / 负例高分（用于人工复核标注）
  const suspicious = [
    ...usable.filter((p) => p.kind === 'pos' && (p.judge as number) < 0.3),
    ...usable.filter((p) => p.kind === 'hard_neg' && (p.judge as number) > 0.7),
  ].slice(0, 15);
  if (suspicious.length) {
    console.log('\n可疑配对（建议人工复核，可能是标注错而非模型错）：');
    for (const p of suspicious) {
      console.log(`  ${p.kind} judge=${(p.judge as number).toFixed(3)} cos=${p.cosine?.toFixed(3) ?? '-'} | ${p.question} | 块「${p.chunk.text.slice(0, 40).replace(/\s+/g, ' ')}」`);
    }
  }

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        judge: cfg.name,
        corpus: { docs: docs.length, chunks: chunks.length },
        coverage,
        pairs: scored.map((p) => ({
          kind: p.kind,
          probeKind: p.probeKind,
          topic: p.topic,
          question: p.question,
          chunkTitle: p.chunk.text.slice(0, 80),
          cosine: p.cosine,
          judge: p.judge,
          label: p.label ?? null,
        })),
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(`\n报告已写入 ${REPORT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('[answerability] 失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
