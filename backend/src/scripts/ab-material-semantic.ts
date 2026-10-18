/**
 * material:semantic:ab —— 语义层**A/B 对照**（有 embed+rerank vs 没有）的真实语料实测。
 *
 * 两组对照：
 *   AB-1「brief 输入质量」：同一批超长真实文档，比"语义代表采样"与"头部截断"各覆盖了原文多少小节、
 *        尤其是只出现在文档后半的小节。这是 brief 生成那条链（material-brief.service）A/B。
 *   AB-2「课堂章节取回」：构造**结构化取回必然失手**的查询（几个来自同一小节、但彼此不相邻的关键词
 *        拼成的串 —— 逐字匹配与标题匹配都命中不了），比"语义兜底"与"退回全文开头窗口"哪个把课堂
 *        真正需要的那一节内容交给了教学模型。这是 TeachingContextBuilder 那条链的 A/B。
 *
 * 隔离：把真实文档**拷进临时沙箱**再跑，对真实资料库只读（不写侧车、不改记录）。
 * 用法：npm --prefix backend run material:semantic:ab
 *      npm --prefix backend run material:semantic:ab -- --docs=12 --queries=2 --only=1
 * 退出码：恒为 0（这是对照测量，不是门禁）；结论以打印的对照表为准。
 */

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveMaterialsRoot, writeMaterial, type MaterialRecord } from '../services/materials/material-store';
import { chunkMaterialMarkdown, type MaterialChunk } from '../services/materials/material-chunker';
import { extractSectionWindow } from '../services/materials/material-sections';
import {
  buildMaterialVectorIndex,
  recallMaterialChunks,
  selectRepresentativeText,
} from '../services/materials/material-semantic.service';

const BRIEF_BUDGET = 24_000;

interface SourceDoc {
  userId: string;
  id: string;
  name: string;
  markdown: string;
}

interface Ab1Row {
  name: string;
  chars: number;
  sections: number;
  /** 语义代表采样覆盖的小节数。 */
  sampledHit: number;
  /** 头部截断覆盖的小节数。 */
  headHit: number;
  /** 混合采样（头部结构 + 语义补全）覆盖的小节数。 */
  hybridHit: number;
  /** 后半正文片段命中数（不受目录页干扰的判据）：三臂各一。 */
  lateProbeTotal: number;
  lateHead: number;
  lateSampled: number;
  lateHybrid: number;
}

interface Ab2Row {
  name: string;
  query: string;
  /** 语义兜底 top1 是否命中目标小节。 */
  semanticHit: boolean;
  /** 头部窗口是否命中目标小节。 */
  headHit: boolean;
  /** 语义 top1 的余弦分。 */
  score: number;
  /** rerank 后 top1 是否命中（另一臂：有 rerank vs 只余弦）。 */
  rerankHit: boolean;
}

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

/** 枚举真实资料库里最大的若干份正文（只读）。 */
function collectSources(limit: number): SourceDoc[] {
  const root = path.resolve(resolveMaterialsRoot());
  if (!fs.existsSync(root)) return [];
  const out: SourceDoc[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const userId = entry.name;
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, entry.name));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.vectors.json')) continue;
      const id = file.slice(0, -'.json'.length);
      let record: { name?: string } = {};
      try {
        record = JSON.parse(fs.readFileSync(path.join(root, entry.name, file), 'utf-8')) as { name?: string };
      } catch {
        continue;
      }
      let markdown = '';
      try {
        markdown = fs.readFileSync(path.join(root, entry.name, `${id}.md`), 'utf-8');
      } catch {
        continue;
      }
      if (markdown.length > BRIEF_BUDGET) out.push({ userId, id, name: String(record.name || id), markdown });
    }
  }
  out.sort((a, b) => b.markdown.length - a.markdown.length);
  return out.slice(0, limit);
}

/** 把源文档拷进临时沙箱（跑真代码路径但不写真实库）。 */
function sandbox(sources: SourceDoc[], root: string): Array<{ record: MaterialRecord; markdown: string }> {
  const out: Array<{ record: MaterialRecord; markdown: string }> = [];
  for (const source of sources) {
    const record: MaterialRecord = {
      id: crypto.randomUUID(),
      userId: source.userId,
      name: source.name,
      ext: '.md',
      format: 'web',
      size: Buffer.byteLength(source.markdown, 'utf-8'),
      charCount: source.markdown.length,
      structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 0, tableCount: 0, listCount: 0, paragraphCount: 0, chunkCount: 0 },
      anchors: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
    writeMaterial(record, source.markdown);
    out.push({ record, markdown: source.markdown });
  }
  return out;
}

/** 像「小节标题」的块标题（与审计探针同口径）。 */
function looksLikeHeading(title: string): boolean {
  const t = String(title || '').replace(/^[#\s]+/, '').trim();
  if (t.length < 4 || t.length > 30) return false;
  if (/^[。，、；：,.;:!?！？]/.test(t)) return false;
  if (/[。，；、：]/.test(t)) return false;
  if (/[\u4e00-\u9fa5][\s\u3000]+[\u4e00-\u9fa5][\s\u3000]+[\u4e00-\u9fa5]/.test(t)) return false;
  if (/\s\d{1,4}$/.test(t)) return false;
  if (/^[\d.\-—、\s]+$/.test(t)) return false;
  return /[\u4e00-\u9fa5]/.test(t) || /^[A-Z0-9]/.test(t);
}

/** 归一文本：去空白，用于「是否包含」判定（两臂同口径）。 */
function flat(text: string): string {
  return String(text || '').replace(/\s+/g, '');
}

/** 文档的「真值小节」：块标题里像标题的，去重保序，附其块序号。 */
function truthSections(chunks: MaterialChunk[]): Array<{ title: string; index: number }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; index: number }> = [];
  for (const chunk of chunks) {
    const title = String(chunk.title || '').replace(/^[#\s]+/, '').trim();
    if (!looksLikeHeading(title) || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, index: chunk.index });
  }
  return out;
}

/**
 * 造一个「结构化取回必然失手」的查询：从目标小节里取 3 段**互不相邻**的文字拼成串。
 * 逐字匹配（quote）与标题匹配都命中不了这个串，但它的语义指向该小节。
 * 返回 null 表示这段素材造不出合规查询（跳过该样例）。
 */
function buildDegradedQuery(markdown: string, sectionText: string): string | null {
  const flatDoc = flat(markdown);
  const sentences = sectionText
    .split(/[\n。；]+/)
    .map((s) => s.replace(/^[#\s\d.、()（）]+/, '').trim())
    .filter((s) => s.length >= 12);
  if (sentences.length < 3) return null;
  const picks = [sentences[0], sentences[Math.floor(sentences.length / 2)], sentences[sentences.length - 1]]
    .filter((s): s is string => Boolean(s))
    .map((s) => s.slice(0, 12));
  const query = picks.join(' ');
  // 合规检查：整串（去空白后）不得在原文里连续出现，否则不是「失手」情形
  if (flat(query).length < 12 || flatDoc.includes(flat(query))) return null;
  return query;
}

async function main(): Promise<void> {
  const docs = Math.max(4, arg('docs', 12));
  const queriesPerDoc = Math.max(1, arg('queries', 2));
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';

  const sources = collectSources(docs);
  console.log(`[ab] 真实长文档候选 ${sources.length} 份（>${BRIEF_BUDGET} 字）`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ab-'));
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;
  const sandboxed: Array<{ record: MaterialRecord; markdown: string }> = [];
  const ab1: Ab1Row[] = [];
  const ab2: Ab2Row[] = [];

  try {
    sandboxed.push(...sandbox(sources, tmpRoot));

    if (only === 'all' || only === '1') {
      console.log('\n=========== AB-1｜brief 输入：头部截断 vs 纯语义采样 vs 混合 ===========');
      for (const doc of sandboxed) {
        const markdown = doc.markdown;
        const chunks = chunkMaterialMarkdown(markdown);
        const truth = truthSections(chunks);
        if (truth.length < 3) continue;

        // 三臂：B=头部截断（改造前）｜A=纯语义采样（headRatio 0）｜C=混合（头部结构+语义补全）
        const head = markdown.slice(0, BRIEF_BUDGET);
        const pure = (await selectRepresentativeText(doc.record, markdown, BRIEF_BUDGET, { headRatio: 0 })) ?? '';
        const hybrid = (await selectRepresentativeText(doc.record, markdown, BRIEF_BUDGET)) ?? '';
        const flatHead = flat(head);
        const flatPure = flat(pure);
        const flatHybrid = flat(hybrid);
        const count = (text: string) => truth.filter((s) => text.includes(flat(s.title))).length;

        // 不受目录页干扰的判据：从**文档后半正文**里取片段，看哪一臂真的够到了（头部臂结构上不可能）
        const latePhrases = chunks
          .filter((c) => c.index >= chunks.length * 0.75 && flat(c.text).length >= 120)
          .slice(0, 3)
          .map((c) => flat(c.text).slice(20, 80));
        const lateCount = (text: string) => latePhrases.filter((p) => p.length >= 20 && text.includes(p)).length;

        ab1.push({
          name: doc.record.name.slice(0, 34),
          chars: markdown.length,
          sections: truth.length,
          sampledHit: count(flatPure),
          headHit: count(flatHead),
          hybridHit: count(flatHybrid),
          lateProbeTotal: latePhrases.filter((p) => p.length >= 20).length,
          lateHead: lateCount(flatHead),
          lateSampled: lateCount(flatPure),
          lateHybrid: lateCount(flatHybrid),
        });
      }

      const sum = (pick: (r: Ab1Row) => number) => ab1.reduce((acc, r) => acc + pick(r), 0);
      const total = sum((r) => r.sections);
      const lateTotal = sum((r) => r.lateProbeTotal);
      const pct = (n: number, d: number) => `${n}/${d}（${Math.round((n / Math.max(1, d)) * 100)}%）`;
      console.log('文档 | 字数 | 真值小节 | 小节覆盖(头部/纯语义/混合) | 后半正文命中(头部/纯语义/混合)');
      for (const row of ab1) {
        console.log(
          `${row.name} | ${row.chars} | ${row.sections} | ${row.headHit}/${row.sampledHit}/${row.hybridHit} | ` +
            `${row.lateHead}/${row.lateSampled}/${row.lateHybrid}（共${row.lateProbeTotal}）`
        );
      }
      console.log(`\n合计（${ab1.length} 份，真值小节 ${total}）：`);
      console.log(`  小节覆盖（含目录页虚高）：头部 ${pct(sum((r) => r.headHit), total)}｜纯语义 ${pct(sum((r) => r.sampledHit), total)}｜混合 ${pct(sum((r) => r.hybridHit), total)}`);
      console.log(`  后半正文命中（不受目录干扰）：头部 ${pct(sum((r) => r.lateHead), lateTotal)}｜纯语义 ${pct(sum((r) => r.lateSampled), lateTotal)}｜混合 ${pct(sum((r) => r.lateHybrid), lateTotal)}`);
    }

    if (only === 'all' || only === '2') {
      console.log('\n=========== AB-2｜课堂取回：语义兜底 vs 退回全文开头 ===========');
      for (const doc of sandboxed) {
        const markdown = doc.markdown;
        const chunks = chunkMaterialMarkdown(markdown);
        const truth = truthSections(chunks);
        const half = chunks.length / 2;
        const targets = truth.filter((s) => s.index >= half).slice(0, queriesPerDoc);
        if (targets.length === 0) continue;
        const index = await buildMaterialVectorIndex(markdown);
        if (!index) continue;

        for (const target of targets) {
          const targetChunk = index.chunks[target.index];
          if (!targetChunk) continue;
          const query = buildDegradedQuery(markdown, targetChunk.text);
          if (!query) continue;

          // 无语义臂：结构化取回（标题/引文都命中不了 → 退回全文开头窗口）
          const structured = extractSectionWindow(markdown, { sectionTitle: query, quote: query });
          // 有语义臂：同一份资料内做召回（余弦序 + rerank 精排）
          const cosineHits = await recallMaterialChunks({
            userId: doc.record.userId,
            query,
            materialIds: [doc.record.id],
            topK: 3,
            records: [doc.record],
          });
          const rerankHits = await recallMaterialChunks({
            userId: doc.record.userId,
            query,
            materialIds: [doc.record.id],
            topK: 3,
            records: [doc.record],
            rerank: true,
          });

          const marker = flat(targetChunk.text).slice(0, 24);
          const has = (text: string) => flat(text).includes(marker);
          ab2.push({
            name: doc.record.name.slice(0, 30),
            query: query.slice(0, 28),
            semanticHit: has(cosineHits[0]?.text ?? ''),
            headHit: has(structured.excerpt),
            score: cosineHits[0]?.score ?? 0,
            rerankHit: has(rerankHits[0]?.text ?? ''),
          });
        }
      }

      const hits = (pick: (r: Ab2Row) => boolean) => ab2.filter(pick).length;
      console.log('文档 | 查询（截断） | 语义top1命中 | rerank命中 | 头部窗口命中 | 余弦分');
      for (const row of ab2) {
        console.log(
          `${row.name} | ${row.query} | ${row.semanticHit ? '是' : '否'} | ${row.rerankHit ? '是' : '否'} | ` +
            `${row.headHit ? '是' : '否'} | ${row.score.toFixed(3)}`
        );
      }
      console.log(
        `\n合计（${ab2.length} 条查询）：语义兜底命中 ${hits((r) => r.semanticHit)}｜rerank 精排命中 ${hits((r) => r.rerankHit)}｜` +
          `退回全文开头命中 ${hits((r) => r.headHit)}`
      );
      const avgScore = ab2.length ? ab2.reduce((a, r) => a + r.score, 0) / ab2.length : 0;
      console.log(`语义 top1 平均余弦分 ${avgScore.toFixed(3)}（同资料内 3 候选；余弦分本身不参与命中判定，仅作观测）`);
    }

    console.log('\n[ab] 说明：本轮对真实资料库只读（跑在临时沙箱），沙箱路径 ' + tmpRoot);
  } finally {
    delete process.env.MATERIAL_UPLOAD_DIR;
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((error: unknown) => {
  console.error('[material:semantic:ab] 运行失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
