/**
 * goal:material:gate —— 用决策模型做**入库前文档分流**的离线验证。
 *
 * 背景：生产入库闸门（`ingestWebMaterial`）只拒「切不出任何块」的正文，
 * 实测 46 份真实抓取里 15 份垃圾（拦截页 / 乱码 / 纯导航 / 无字幕视频页 / 整本 PDF 转储）**全部放行**，
 * 且它们贡献了资料库 65.3% 的块。确定性规则（长度、中文占比、控制字符）只能覆盖其中一部分。
 *
 * 本脚本验证「再加一道决策模型判定」的收益：
 *   对每份正文（首/中/尾各取一段，覆盖乱码与转储的异常区）一次调用问三个问题：
 *     usable    (noul)  这份正文能不能给学习者看
 *     defect    (choice) 缺陷类型（ok / bot_wall / navigation_only / mojibake / video_page / dump）
 *     topic     (noul)  是否与目标主题一致
 *   然后用启发式标签（与 retrieval/ingest 脚本同一套 classifyDoc）当参照，算拒绝率与误杀率。
 *
 * 跑法：npx ts-node --transpile-only src/scripts/eval-goal-material-gate.ts
 *      ... --judge=clef-omni|clef-flash|alibaba
 * 凭证：CF_TOKEN + CF_ACCOUNT_ID（或 DASHSCOPE_API_KEY）
 *
 * 注意：启发式标签本身不完美（尤其 oversized-dump 与 low-cjk-ratio 有重叠），
 * 因此这里报告的是「与启发式参照的一致度」，不是绝对真值；不一致的样本会列出来供人工复核。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const OUT_DIR = path.resolve(__dirname, '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18');
const CORPUS_FILE = path.join(OUT_DIR, 'corpus.json');
const REPORT_FILE = path.join(OUT_DIR, 'gate-report.json');

interface Doc {
  topicKey: string;
  title: string;
  url: string;
  text: string;
}

const TOPIC_LABEL: Record<string, string> = {
  bio: '光合作用',
  http: 'HTTP 缓存',
  edu: '3-6岁儿童学习与发展指南',
  math: '勾股定理',
  food: '食品添加剂',
  cloud: '云计算服务模式',
  psych: '建构主义学习理论',
  photo: '摄影光圈快门',
};

// 与 eval-goal-material-retrieval / ingest 同口径的启发式参照
const BOT_WALL = /Client Challenge|Just a moment\.\.\.|Enable JavaScript and cookies|cf-browser-verification|Access Denied|验证码/i;
const MOJIBAKE = /[\uFFFD]|ʳƷ|ҳ׼|Ӽʹñ׼|Ð|Ñ|Ã¤|â€™/;

function heuristicDefect(doc: Doc): string[] {
  const text = doc.text || '';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ratio = cjk / Math.max(1, text.length);
  const out: string[] = [];
  if (BOT_WALL.test(text)) out.push('bot_wall');
  if (MOJIBAKE.test(text)) out.push('mojibake');
  if (/youtube\.com|youtu\.be|bilibili\.com|vimeo\.com/i.test(doc.url) && text.length < 800) out.push('video_page');
  if (text.length >= 200 && ratio < 0.15) out.push('low_cjk');
  if (text.length > 200_000) out.push('dump');
  if (text.trim().length < 400) out.push('thin');
  return out;
}

/** 首/中/尾采样：只看开头会把乱码转储误判成正常文档。 */
function sampleText(text: string, budget = 7000): string {
  if (text.length <= budget) return text;
  const head = text.slice(0, Math.floor(budget * 0.4));
  const mid = text.slice(Math.floor(text.length / 2) - Math.floor(budget * 0.2), Math.floor(text.length / 2) + Math.floor(budget * 0.2));
  const tail = text.slice(-Math.floor(budget * 0.2));
  return `${head}\n\n[...中间省略...]\n\n${mid}\n\n[...尾部...]\n\n${tail}`;
}

interface JudgeCfg {
  name: string;
  url: string;
  headers: Record<string, string>;
  bodyModel?: string;
  extract: (body: unknown) => Record<string, unknown> | null;
}

function buildJudge(name: string): JudgeCfg {
  if (name === 'custom') {
    // 自建 SystemOne 兼容部署（laya 等）：只靠环境变量，便于同一批文档横向对比
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
      extract: (b) => {
        const obj = b as { result?: { answers?: Record<string, unknown> }; answers?: Record<string, unknown> };
        return (obj?.result?.answers ?? obj?.answers ?? null) as Record<string, unknown> | null;
      },
    };
  }
  if (name === 'alibaba') {
    return {
      name: 'alibaba:decision-model-preview',
      url: 'https://ws-j2djr3yj51rhlwmw.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
      headers: { Authorization: process.env.DASHSCOPE_API_KEY || '', 'Content-Type': 'application/json' },
      bodyModel: 'decision-model-preview',
      extract: (b) => (b as { answers?: Record<string, unknown> })?.answers ?? null,
    };
  }
  const model = name === 'clef-flash' || name === 'clef' ? name : 'clef-omni';
  return {
    name: `cloudflare:${model}`,
    url: `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID || process.env.CF_ACCT || ''}/ai/run/@cf/cloudflare/${model}`,
    headers: { Authorization: `Bearer ${process.env.CF_TOKEN || ''}`, 'Content-Type': 'application/json' },
    extract: (b) => (b as { result?: { answers?: Record<string, unknown> } })?.result?.answers ?? null,
  };
}

const DEFECT_CRITERIA: Record<string, string> = {
  ok: '成段的实质正文，学习者能正常阅读并获得知识',
  bot_wall: '机器人验证、访问拦截、"Client Challenge"、要求开启 JavaScript 的中间页',
  navigation_only: '页面主体是导航、目录、页脚、版权声明、评论区或下载按钮，没有成段正文',
  mojibake: '编码损坏，中文显示为乱码或问号方块，无法阅读',
  video_page: '视频播放页，正文只有标题与简介，没有字幕或讲稿',
  dump: '整本标准/手册/PDF 转储，体量远超单份学习材料所需',
};

async function gateOne(cfg: JudgeCfg, doc: Doc): Promise<{ usable: number | null; defect: string | null; topic: number | null; hasProse: number | null; raw: unknown }> {
  const state = {
    目标主题: TOPIC_LABEL[doc.topicKey] ?? doc.topicKey,
    页面标题: doc.title,
    来源URL: doc.url,
    正文节选: sampleText(doc.text),
  };
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: cfg.headers,
    body: JSON.stringify({
      ...(cfg.bodyModel ? { model: cfg.bodyModel } : {}),
      state,
      questions: {
        usable: {
          type: 'noul',
          instructions: '这份正文是否可以提供给学习者作为学习材料？拦截页、纯导航页、乱码、无字幕视频页、超大体量转储都给低概率；成段且可读的正文给高概率。',
        },
        defect: {
          type: 'choice',
          instructions: '这份正文最主要的缺陷类型是什么？',
          criteria: DEFECT_CRITERIA,
        },
        topic: {
          type: 'noul',
          instructions: '这份正文的内容是否与"目标主题"一致？同名文件的不同版本、主题相近但讲别的事都给低概率。',
        },
        has_prose: {
          type: 'noul',
          instructions: '这段正文里是否存在成段的连续论述（至少连续两三百字围绕同一主题展开，而不是导航项、短句堆叠、按钮文字、列表或评论区）？存在给高概率，只有碎片式页面元素给低概率。',
        },
      },
    }),
  });
  if (!res.ok) return { usable: null, defect: null, topic: null, hasProse: null, raw: `HTTP ${res.status}` };
  const answers = cfg.extract(await res.json()) as Record<string, { noul?: number; choice?: string }> | null;
  return {
    usable: typeof answers?.usable?.noul === 'number' ? answers.usable.noul : null,
    defect: typeof answers?.defect?.choice === 'string' ? answers.defect.choice : null,
    topic: typeof answers?.topic?.noul === 'number' ? answers.topic.noul : null,
    hasProse: typeof answers?.has_prose?.noul === 'number' ? answers.has_prose.noul : null,
    raw: answers,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS_FILE)) {
    console.error(`缺少语料缓存 ${CORPUS_FILE}`);
    process.exitCode = 1;
    return;
  }
  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf-8'));
  const docs: Doc[] = Array.isArray(corpus?.docs) ? corpus.docs : [];
  const judgeName = (process.argv.find((a) => a.startsWith('--judge=')) || '').split('=')[1] || 'alibaba';
  const cfg = buildJudge(judgeName);
  if (!cfg.url || (cfg.headers.Authorization !== undefined && /Bearer\s*$/.test(String(cfg.headers.Authorization)))) {
    console.error(`缺少凭证（judge=${judgeName}）`);
    process.exitCode = 1;
    return;
  }

  console.log(`[gate] ${cfg.name}，判定 ${docs.length} 份文档…`);
  let done = 0;
  const rows = await mapLimit(docs, 5, async (doc) => {
    const verdict = await gateOne(cfg, doc);
    done += 1;
    process.stdout.write(`\r[gate] ${done}/${docs.length}`);
    return { doc, verdict, heuristic: heuristicDefect(doc) };
  });
  process.stdout.write('\n');

  const isJunk = (h: string[]): boolean => h.length > 0;
  const junk = rows.filter((r) => isJunk(r.heuristic));
  const clean = rows.filter((r) => !isJunk(r.heuristic));
  const usableVal = (r: (typeof rows)[number]): number | null => r.verdict.usable;

  console.log('\n════════════════ 文档分流 ════════════════');
  console.log(`启发式参照：干净 ${clean.length}，含缺陷 ${junk.length}`);
  console.log('\n按 usable 阈值：');
  for (const t of [0.2, 0.3, 0.5, 0.7, 0.8]) {
    const junkRejected = junk.filter((r) => (usableVal(r) ?? 1) < t).length;
    const cleanKept = clean.filter((r) => (usableVal(r) ?? 0) >= t).length;
    console.log(
      `  th=${t.toFixed(1)}  垃圾拦截 ${junkRejected}/${junk.length}（${((junkRejected / junk.length) * 100).toFixed(0)}%）` +
      `｜干净放行 ${cleanKept}/${clean.length}（${((cleanKept / clean.length) * 100).toFixed(0)}%）`
    );
  }

  console.log('\n按 has_prose 阈值：');
  for (const t of [0.2, 0.3, 0.5, 0.7]) {
    const jr = junk.filter((r) => (r.verdict.hasProse ?? 1) < t).length;
    const ck = clean.filter((r) => (r.verdict.hasProse ?? 0) >= t).length;
    console.log(`  th=${t.toFixed(1)}  垃圾拦截 ${jr}/${junk.length}（${((jr / junk.length) * 100).toFixed(0)}%）｜干净放行 ${ck}/${clean.length}（${((ck / clean.length) * 100).toFixed(0)}%）`);
  }

  // 缺陷类型分布
  const distribution = new Map<string, number>();
  for (const r of rows) {
    const key = r.verdict.defect ?? 'n/a';
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
  }
  console.log('\ndefect 分布：', [...distribution.entries()].map(([k, v]) => `${k}:${v}`).join('  '));

  // 不一致样本：启发式判垃圾但模型说可用 / 启发式干净但模型说不可用
  const disagreements = rows.filter((r) => {
    const junkHeuristic = isJunk(r.heuristic);
    const modelUsable = (usableVal(r) ?? 0.5) >= 0.5;
    return junkHeuristic === modelUsable;
  });
  if (disagreements.length) {
    console.log(`\n分歧样本 ${disagreements.length} 份（建议人工复核）：`);
    for (const r of disagreements) {
      console.log(
        `  heuristic=[${r.heuristic.join(',') || 'ok'}] usable=${(usableVal(r) ?? -1).toFixed(3)} defect=${r.verdict.defect} topic=${(r.verdict.topic ?? -1).toFixed(2)}` +
        ` | ${r.doc.title.slice(0, 40)} | ${r.doc.url.slice(0, 60)}`
      );
    }
  }

  // 组合规则：usable 高 + topic 低 ⇒ 主题错配，也应拦
  const topicMismatch = rows.filter((r) => (usableVal(r) ?? 0) >= 0.5 && (r.verdict.topic ?? 1) < 0.3);
  if (topicMismatch.length) {
    console.log(`\n主题错配（usable 高但 topic < 0.3）${topicMismatch.length} 份：`);
    for (const r of topicMismatch) {
      console.log(`  topic=${(r.verdict.topic ?? 0).toFixed(2)} | ${r.doc.title.slice(0, 50)}`);
    }
  }

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        judge: cfg.name,
        rows: rows.map((r) => ({
          topic: r.doc.topicKey,
          title: r.doc.title,
          url: r.doc.url,
          chars: r.doc.text.length,
          heuristic: r.heuristic,
          usable: r.verdict.usable,
          defect: r.verdict.defect,
          topicMatch: r.verdict.topic,
          hasProse: r.verdict.hasProse,
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
  console.error('[gate] 失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
