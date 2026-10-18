/**
 * goal:material:packing:eval —— goal→path **资料包/摘要采样**的独立评测（真实语料、不调 LLM）。
 *
 * 为什么单独测这一段：goal→path 的资料打包（material-pack.builder）与 brief 采样
 * 用的**不是** recall + rerank，而是 selectStratifiedChunks / selectRepresentativeText。
 * 也就是说「学习者最终看到的资料内容」这条路径，前面检索/重排的指标覆盖不到。
 *
 * 测什么（全部确定性）：
 *   1. 代表采样（brief 用，预算 6000 字）：真实超长资料里，探针事实还剩几条能进采样文本；
 *   2. 分层采样（资料包用，6 块）：章覆盖度与事实存活；
 *   3. 对照组：纯头部截断（旧口径）的事实存活，用来量化采样到底救回多少。
 *
 * 跑法：cd backend && npx ts-node --transpile-only src/scripts/eval-goal-material-packing.ts
 * 隔离：资料写临时目录，跑完删除；MATERIAL_SEMANTIC_DISABLED 不设（需要 embedding）。
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { writeMaterial, type MaterialRecord } from '../services/materials/material-store';
import {
  buildMaterialVectorIndex,
  selectRepresentativeText,
  selectStratifiedChunks,
} from '../services/materials/material-semantic.service';

const OUT_DIR = path.resolve(__dirname, '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18');
const CORPUS_FILE = path.join(OUT_DIR, 'corpus.json');
const PACK_BUDGET = 6000;
const PACK_CHUNKS = 6;

interface Doc {
  topicKey: string;
  url: string;
  title: string;
  text: string;
}

interface AnchorProbe {
  topicKey: string;
  q: string;
  anchors: string[];
}

/**
 * 与 eval-goal-material-retrieval 保持同一批探针（只取锚点，不需要检索）。
 * 这里重复一份是为了让本脚本可以单独运行；两边改动请同步。
 */
const PROBES: AnchorProbe[] = [
  { topicKey: 'bio', q: '光反应具体在哪里进行', anchors: ['类囊体'] },
  { topicKey: 'bio', q: '暗反应又叫什么循环', anchors: ['卡尔文循环', 'Calvin'] },
  { topicKey: 'bio', q: 'ATP 和 NADPH 是在哪个阶段产生的', anchors: ['NADPH', 'NADP'] },
  { topicKey: 'http', q: 'max-age 单位是什么', anchors: ['max-age'] },
  { topicKey: 'http', q: '服务器怎么告诉浏览器资源没变', anchors: ['304'] },
  { topicKey: 'http', q: '协商缓存用哪个响应头判断', anchors: ['Last-Modified', 'If-Modified-Since'] },
  { topicKey: 'edu', q: '指南把幼儿学习分成哪几个领域', anchors: ['五个领域', '五大领域', '健康、语言、社会、科学、艺术'] },
  { topicKey: 'edu', q: '指南在幼儿语言领域要求什么', anchors: ['语言领域'] },
  { topicKey: 'edu', q: '指南有没有说明适用年龄', anchors: ['3-6岁儿童', '3—6岁儿童', '3～6岁儿童'] },
  { topicKey: 'math', q: '直角三角形的三条边满足什么关系', anchors: ['平方和'] },
  { topicKey: 'math', q: '中国古代怎么称呼这个定理', anchors: ['勾股'] },
  { topicKey: 'math', q: '这个定理有哪些证明方法', anchors: ['证明'] },
  { topicKey: 'psych', q: '建构主义认为学习靠什么发生', anchors: ['建构'] },
  { topicKey: 'psych', q: '谁提出最近发展区', anchors: ['维果茨基'] },
  { topicKey: 'psych', q: '发现学习是谁的主张', anchors: ['布鲁纳'] },
  { topicKey: 'food', q: '食品添加剂里说的标准代号是哪个', anchors: ['GB 2760', 'GB2760'] },
  { topicKey: 'food', q: '什么情况下不允许用添加剂', anchors: ['不得以掩盖食品腐败变质', '不得使用', '禁止使用'] },
  { topicKey: 'food', q: '哪些是常见的防腐剂', anchors: ['苯甲酸', '山梨酸', '防腐剂'] },
  { topicKey: 'cloud', q: '自己管操作系统的是哪种云服务', anchors: ['IaaS'] },
  { topicKey: 'cloud', q: '拿来就能用的软件属于哪种', anchors: ['SaaS'] },
  { topicKey: 'photo', q: '想让背景更虚该怎么办', anchors: ['景深'] },
  { topicKey: 'photo', q: '拍流水丝滑用什么快门', anchors: ['快门'] },
];

const norm = (s: string): string => String(s || '').replace(/\s+/g, '').toLowerCase();
const hasAny = (text: string, anchors: string[]): boolean => anchors.some((a) => norm(text).includes(norm(a)));

function makeRecord(doc: Doc, markdown: string): MaterialRecord {
  return {
    id: crypto.randomUUID(),
    userId: 'pack_eval_user',
    name: doc.title.slice(0, 80),
    ext: '.md',
    format: 'md',
    size: Buffer.byteLength(markdown, 'utf-8'),
    charCount: markdown.length,
    structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 0, tableCount: 0, listCount: 0, paragraphCount: 0, chunkCount: 0 },
    anchors: [],
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

interface DocResult {
  topicKey: string;
  title: string;
  chars: number;
  /** 只统计该文档里确实存在的事实 */
  factsPresent: number;
  /** 头部截断（旧口径）保住的事实数 */
  headKept: number;
  /** selectRepresentativeText 保住的事实数（null = 采样不可用，回退截断） */
  sampleKept: number | null;
  /** 分层采样 6 块保住的事实数 */
  stratifiedKept: number | null;
  /** 分层采样覆盖的不同标题数（章节覆盖代理指标） */
  stratifiedTitles: number;
  /** 分层采样占全文的比例 */
  stratifiedCoverage: number;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS_FILE)) {
    console.error(`缺少语料缓存 ${CORPUS_FILE}，请先跑 eval-goal-material-retrieval --stage=fetch`);
    process.exitCode = 1;
    return;
  }
  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf-8'));
  const docs: Doc[] = Array.isArray(corpus?.docs) ? corpus.docs : [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pack-eval-'));
  const prevDir = process.env.MATERIAL_UPLOAD_DIR;
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;

  const results: DocResult[] = [];
  try {
    for (const doc of docs) {
      const probes = PROBES.filter((p) => p.topicKey === doc.topicKey && hasAny(doc.text, p.anchors));
      const markdown = doc.text;
      const record = makeRecord(doc, markdown);
      writeMaterial(record, markdown);

      const headKept = probes.filter((p) => hasAny(markdown.slice(0, PACK_BUDGET), p.anchors)).length;

      let sampleKept: number | null = null;
      try {
        const sampled = await selectRepresentativeText(record, markdown, PACK_BUDGET);
        sampleKept = sampled === null ? null : probes.filter((p) => hasAny(sampled, p.anchors)).length;
      } catch {
        sampleKept = null;
      }

      let stratifiedKept: number | null = null;
      let stratifiedTitles = 0;
      let stratifiedCoverage = 0;
      try {
        const index = await buildMaterialVectorIndex(markdown);
        if (index && index.chunks.length > 0) {
          const picked = selectStratifiedChunks(index.chunks, PACK_CHUNKS);
          const joined = picked.map((c) => c.text).join('\n\n');
          stratifiedKept = probes.filter((p) => hasAny(joined, p.anchors)).length;
          stratifiedTitles = new Set(picked.map((c) => c.title.trim()).filter(Boolean)).size;
          stratifiedCoverage = joined.length / Math.max(1, markdown.length);
        }
      } catch {
        stratifiedKept = null;
      }

      const row: DocResult = {
        topicKey: doc.topicKey,
        title: doc.title,
        chars: markdown.length,
        factsPresent: probes.length,
        headKept,
        sampleKept,
        stratifiedKept,
        stratifiedTitles,
        stratifiedCoverage,
      };
      results.push(row);
      if (probes.length > 0) {
        console.log(
          `${doc.topicKey.padEnd(6)} ${String(markdown.length).padStart(7)}字 事实${probes.length} | ` +
          `头部${headKept} 采样${sampleKept ?? 'n/a'} 分层${stratifiedKept ?? 'n/a'}(${stratifiedTitles}标题/${(stratifiedCoverage * 100).toFixed(1)}%) | ${doc.title.slice(0, 30)}`
        );
      }
    }
  } finally {
    if (prevDir === undefined) delete process.env.MATERIAL_UPLOAD_DIR;
    else process.env.MATERIAL_UPLOAD_DIR = prevDir;
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ── 汇总：只看「有事实可测」的文档 ──
  const testable = results.filter((r) => r.factsPresent > 0);
  const sum = (f: (r: DocResult) => number | null): number =>
    testable.reduce((s, r) => s + (f(r) ?? 0), 0);
  const facts = sum((r) => r.factsPresent);
  const head = sum((r) => r.headKept);
  const sample = sum((r) => r.sampleKept);
  const strat = sum((r) => r.stratifiedKept);
  const sampleFallback = testable.filter((r) => r.sampleKept === null).length;
  const pct = (n: number): string => `${((n / Math.max(1, facts)) * 100).toFixed(1)}%`;

  console.log('\n════════════════ 资料包/采样事实存活 ════════════════');
  console.log(`可测文档 ${testable.length} 份，事实锚点 ${facts} 条`);
  console.log(`头部截断（旧口径，${PACK_BUDGET} 字）  ${head}/${facts} = ${pct(head)}`);
  console.log(`代表采样（brief 现口径）           ${sample}/${facts} = ${pct(sample)}${sampleFallback ? `（${sampleFallback} 份回退截断）` : ''}`);
  console.log(`分层采样（资料包现口径，${PACK_CHUNKS} 块）  ${strat}/${facts} = ${pct(strat)}`);

  // 只对「超预算」文档比较才有意义（预算内全文直返，三者恒等）
  const overBudget = testable.filter((r) => r.chars > PACK_BUDGET);
  if (overBudget.length) {
    const f2 = sum((r) => r.factsPresent);
    const h2 = overBudget.reduce((s, r) => s + r.headKept, 0);
    const s2 = overBudget.reduce((s, r) => s + (r.sampleKept ?? 0), 0);
    const t2 = overBudget.reduce((s, r) => s + (r.stratifiedKept ?? 0), 0);
    const p2 = (n: number): string => `${((n / Math.max(1, f2)) * 100).toFixed(1)}%`;
    console.log(`\n只看超预算（>${PACK_BUDGET} 字）的 ${overBudget.length} 份 / ${f2} 条事实：`);
    console.log(`  头部截断 ${h2} (${p2(h2)}) → 代表采样 ${s2} (${p2(s2)}) → 分层采样 ${t2} (${p2(t2)})`);
  }

  const avgCov = testable.filter((r) => r.stratifiedCoverage > 0);
  if (avgCov.length) {
    console.log(`\n分层采样平均覆盖全文 ${(avgCov.reduce((s, r) => s + r.stratifiedCoverage, 0) / avgCov.length * 100).toFixed(1)}%，平均覆盖 ${(avgCov.reduce((s, r) => s + r.stratifiedTitles, 0) / avgCov.length).toFixed(1)} 个不同标题`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'packing-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf-8');
  console.log(`\n报告已写入 ${path.join(OUT_DIR, 'packing-report.json')}`);
}

main().catch((error: unknown) => {
  console.error('[goal-material-packing] 失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
