/**
 * goal:material:ingest:eval —— 联网资料**入库闸门**的独立评测（不调 LLM、不碰 DB）。
 *
 * 回答的问题：goal→path 阶段联网抓到的正文，经过生产入库路径
 * （normalizeWebTextStructure → parseDocument 文本闸门 → 160K 截断 → chunkMaterialMarkdown 无内容闸门）
 * 之后，有多少垃圾真的进了学习者资料库？
 *
 * 语料复用 eval-goal-material-retrieval 的缓存（同一份真实抓取结果），
 * 因此两份脚本的「垃圾判定」口径可直接对账。
 *
 * 跑法：cd backend && npx ts-node --transpile-only src/scripts/eval-goal-material-ingest.ts
 * 隔离：MATERIAL_UPLOAD_DIR 指向临时目录，MATERIAL_SEMANTIC_DISABLED=1 关掉向量预热。
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.MATERIAL_SEMANTIC_DISABLED = '1';

import { ingestWebMaterial } from '../services/materials/material-web-ingest.service';
import { readMaterial } from '../services/materials/material-store';
import { chunkMaterialMarkdown } from '../services/materials/material-chunker';

const OUT_DIR = path.resolve(__dirname, '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18');
const CORPUS_FILE = path.join(OUT_DIR, 'corpus.json');

interface Doc {
  topicKey: string;
  url: string;
  title: string;
  text: string;
  provider: string;
}

/** 与 eval-goal-material-retrieval 同口径的垃圾分类（保持两脚本可对账）。 */
const BOT_WALL = /Client Challenge|Just a moment\.\.\.|Enable JavaScript and cookies|cf-browser-verification|Access Denied|验证码/i;
const MOJIBAKE = /[\uFFFD]|ʳƷ|ҳ׼|Ӽʹñ׼|Ð|Ñ|Ã¤|â€™/;

function classify(doc: Doc): string[] {
  const text = doc.text || '';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ratio = cjk / Math.max(1, text.length);
  const defects: string[] = [];
  if (BOT_WALL.test(text)) defects.push('bot-wall');
  if (MOJIBAKE.test(text)) defects.push('mojibake');
  if (/youtube\.com|youtu\.be|bilibili\.com|vimeo\.com/i.test(doc.url) && text.length < 800) defects.push('video-no-transcript');
  if (text.length >= 200 && ratio < 0.15) defects.push('low-cjk-ratio');
  if (text.length > 200_000) defects.push('oversized-dump');
  if (text.trim().length < 400) defects.push('thin');
  return defects;
}

interface Row {
  topicKey: string;
  title: string;
  url: string;
  defects: string[];
  /** 入库结果：accepted / rejected(null) */
  status: 'accepted' | 'rejected';
  /** 入库后的实际字数（含 160K 截断） */
  storedChars: number;
  /** 入库后的块数 */
  chunks: number;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS_FILE)) {
    console.error(`缺少语料缓存 ${CORPUS_FILE}，请先跑 eval-goal-material-retrieval --stage=fetch`);
    process.exitCode = 1;
    return;
  }
  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf-8'));
  const docs: Doc[] = Array.isArray(corpus?.docs) ? corpus.docs : [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ingest-eval-'));
  const prevDir = process.env.MATERIAL_UPLOAD_DIR;
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;

  const userId = 'ingest_eval_user';
  const rows: Row[] = [];

  try {
    for (const [i, doc] of docs.entries()) {
      const defects = classify(doc);
      let status: 'accepted' | 'rejected' = 'rejected';
      let storedChars = 0;
      let chunks = 0;
      try {
        const res = await ingestWebMaterial({ userId, url: doc.url, title: doc.title, text: doc.text });
        if (res?.record) {
          status = 'accepted';
          const found = readMaterial(userId, res.record.id);
          const markdown = found?.markdown ?? '';
          storedChars = markdown.length;
          chunks = chunkMaterialMarkdown(markdown).length;
        }
      } catch {
        status = 'rejected';
      }
      rows.push({ topicKey: doc.topicKey, title: doc.title, url: doc.url, defects, status, storedChars, chunks });
      const flag = status === 'accepted' ? 'ACC' : 'REJ';
      const junk = defects.length ? `[${defects.join(',')}]` : '[ok]';
      console.log(
        `${String(i + 1).padStart(2)}. ${flag} ${junk.padEnd(34)} ${String(doc.text.length).padStart(7)}→${String(storedChars).padStart(7)}字 ` +
        `${String(chunks).padStart(4)}块 | ${doc.title.slice(0, 36)}`
      );
    }
  } finally {
    if (prevDir === undefined) delete process.env.MATERIAL_UPLOAD_DIR;
    else process.env.MATERIAL_UPLOAD_DIR = prevDir;
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ── 汇总：垃圾拦截率 ──
  const junkRows = rows.filter((r) => r.defects.length > 0);
  const cleanRows = rows.filter((r) => r.defects.length === 0);
  const junkAccepted = junkRows.filter((r) => r.status === 'accepted');
  const cleanAccepted = cleanRows.filter((r) => r.status === 'accepted');
  const pct = (n: number, d: number): string => `${((n / Math.max(1, d)) * 100).toFixed(1)}%`;

  console.log('\n════════════════ 入库闸门汇总 ════════════════');
  console.log(`总计 ${rows.length} 份：干净 ${cleanRows.length}，含缺陷 ${junkRows.length}`);
  console.log(`干净资料放行 ${cleanAccepted.length}/${cleanRows.length}（${pct(cleanAccepted.length, cleanRows.length)}）`);
  console.log(`缺陷资料放行 ${junkAccepted.length}/${junkRows.length}（${pct(junkAccepted.length, junkRows.length)}）← 越低越好`);

  const byDefect = new Map<string, { total: number; accepted: number }>();
  for (const row of junkRows) {
    for (const d of row.defects) {
      const e = byDefect.get(d) ?? { total: 0, accepted: 0 };
      e.total += 1;
      if (row.status === 'accepted') e.accepted += 1;
      byDefect.set(d, e);
    }
  }
  console.log('\n按缺陷类型：');
  for (const [defect, e] of byDefect) {
    console.log(`  ${defect.padEnd(20)} 放行 ${e.accepted}/${e.total}（${pct(e.accepted, e.total)}）`);
  }

  const junkChunks = junkAccepted.reduce((s, r) => s + r.chunks, 0);
  const cleanChunks = cleanAccepted.reduce((s, r) => s + r.chunks, 0);
  console.log(`\n入库块数：干净资料 ${cleanChunks} 块，缺陷资料 ${junkChunks} 块（污染占比 ${pct(junkChunks, cleanChunks + junkChunks)}）`);

  fs.writeFileSync(path.join(OUT_DIR, 'ingest-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2), 'utf-8');
  console.log(`\n报告已写入 ${path.join(OUT_DIR, 'ingest-report.json')}`);
}

main().catch((error: unknown) => {
  console.error('[goal-material-ingest] 失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
