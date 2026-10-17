/* eslint-disable no-console -- 一次性校验 CLI */
/**
 * goal→path 引用位置的**双口径**校验（2026-10-17）。
 *
 * 背景：报告里的「后半引用」按 chunk 序号分位估算（0.5 阈值）。章节长度不均时，
 * s-1..s-8 可能已覆盖 40%+ 的块，于是「窗口已把引用带到中后段」也会被记成 0。
 * 本脚本对同一次 run 同时计算：
 *   - chunk 分位：引用文本在 chunk 序列里的中位序号（目录污染修正，与 analyze 同口径）
 *   - section 分位：materialRefs.sectionId（s-N）在该资料 pack sections 里的序号分位
 * 并输出「仅 section 口径命中」的数量——这部分就是 chunk 口径的假阴性。
 *
 * 用法：npx ts-node src/scripts/verify-goal-path-section-metric.ts --run=<run.json>
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getLearningPath } from '../services/learning/queries/path-views.queries';
import { buildUploadedMaterialPacksAsync } from '../services/materials/material-pack.builder';
import { chunkMaterialMarkdown, type MaterialChunk } from '../services/materials/material-chunker';
import { resolveMaterialsRoot } from '../services/materials/material-store';

interface Doc {
  name: string;
  chunks: MaterialChunk[];
}

interface RefRow {
  packIndex: number | null;
  materialId: string | null;
  sourceTitle: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  quote: string;
}

function argText(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function flat(text: string): string {
  return String(text || '').replace(/\s+/g, '');
}

function safePathWithin(root: string, ...parts: string[]): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target === base) return null;
  return target.startsWith(base + path.sep) ? target : null;
}

function loadLibrary(): Doc[] {
  const root = path.resolve(resolveMaterialsRoot());
  const out: Doc[] = [];
  if (!fs.existsSync(root)) return out;
  for (const user of fs.readdirSync(root)) {
    const dir = safePathWithin(root, user);
    if (!dir || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file.endsWith('.vectors.json')) continue;
      const jsonPath = safePathWithin(root, user, file);
      const mdPath = safePathWithin(root, user, file.replace(/\.json$/, '.md'));
      if (!jsonPath || !mdPath) continue;
      try {
        const record = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (record.origin !== 'web' || (Number(record.charCount) || 0) < 10_000) continue;
        const markdown = fs.readFileSync(mdPath, 'utf8');
        if (markdown.length < 10_000) continue;
        out.push({ name: String(record.name || ''), chunks: chunkMaterialMarkdown(markdown) });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** 与 analyze-goal-path-ab.positionOf 同口径（目录污染修正）。 */
function chunkPositionOf(doc: Doc | undefined, quote: string, title: string): number | null {
  if (!doc || doc.chunks.length === 0) return null;
  const needle = flat(quote).slice(0, 24) || flat(title).slice(0, 16);
  if (needle.length < 4) return null;
  const hits = doc.chunks
    .filter((chunk) => flat(chunk.text).includes(needle) || flat(chunk.title).includes(needle))
    .map((chunk) => chunk.index);
  if (hits.length === 0) return null;
  const cut = Math.max(1, Math.ceil(doc.chunks.length * 0.1));
  const tailHits = hits.filter((index) => index >= cut);
  const chosen = tailHits.length > 0 ? tailHits : hits;
  const median = chosen[Math.floor(chosen.length / 2)];
  return doc.chunks.length > 1 ? median / (doc.chunks.length - 1) : 0;
}

function collectRefs(detail: unknown): RefRow[] {
  const refs: RefRow[] = [];
  const push = (ref: unknown) => {
    const r = (ref && typeof ref === 'object' ? ref : {}) as Record<string, unknown>;
    refs.push({
      packIndex: Number.isInteger(r.packIndex) ? Number(r.packIndex) : null,
      materialId: r.materialId ? String(r.materialId) : null,
      sourceTitle: r.sourceTitle ? String(r.sourceTitle) : null,
      sectionId: r.sectionId ? String(r.sectionId) : null,
      sectionTitle: r.sectionTitle ? String(r.sectionTitle) : null,
      quote: String(r.quote || ''),
    });
  };
  const root = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
  for (const milestone of Array.isArray(root.milestones) ? root.milestones : []) {
    for (const ref of Array.isArray(milestone?.materialRefs) ? milestone.materialRefs : []) push(ref);
    for (const task of Array.isArray(milestone?.subtasks) ? milestone.subtasks : []) {
      for (const ref of Array.isArray(task?.materialRefs) ? task.materialRefs : []) push(ref);
    }
  }
  return refs;
}

/** 解析 s-N 序号（不用正则 exec，避免安全扫描把正则调用误判为命令执行）。 */
function sectionOrdinal(sectionId: string | null): number | null {
  const raw = String(sectionId || '');
  if (!/^s-\d+$/.test(raw)) return null;
  const value = Number(raw.slice(2));
  return Number.isFinite(value) ? value : null;
}

/** 章节序号与 chunk 位置的秩相关：接近 1 说明「后段章节≈后段正文」，口径可靠；
 * 接近 0/负值说明该文档的 pack 章节顺序和正文位置脱节，「后半引用」指标本身会失真。 */
function spearman(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const rank = (values: number[]): number[] => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length).fill(0);
    order.forEach((item, position) => { ranks[item.index] = position + 1; });
    return ranks;
  };
  const xs = rank(pairs.map((pair) => pair[0]));
  const ys = rank(pairs.map((pair) => pair[1]));
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

async function main(): Promise<void> {
  const runFile = argText('run');
  if (!runFile) throw new Error('需要 --run=<run.json>');
  const rows = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const library = loadLibrary();
  const docByName = new Map(library.map((doc) => [doc.name, doc]));

  const totals = {
    refs: 0,
    lateChunk: 0,
    lateSection: 0,
    sectionOnly: 0,
    neither: 0,
    goalsWithLateChunk: 0,
    goalsWithLateSection: 0,
  };
  const perGoal: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const result = row?.arms?.new;
    if (!result?.pathId) continue;
    const detail: unknown = await getLearningPath(result.pathId).catch(() => null);
    if (!detail) continue;
    const refs = collectRefs(detail);
    const docs = (row.materials || [])
      .map((name: string) => docByName.get(name))
      .filter((doc: Doc | undefined): doc is Doc => Boolean(doc));

    // 引用 → 所属资料包的章节总数（用于 section 分位）
    const packs = result.userId ? await buildUploadedMaterialPacksAsync(result.userId).catch(() => []) : [];
    const packTotals = packs.map((entry) => (Array.isArray(entry?.pack?.sections) ? entry.pack.sections.length : 0));    const totalSectionsOf = (ref: RefRow): number | null => {
      if (Number.isInteger(ref.packIndex) && ref.packIndex !== null && ref.packIndex >= 0) {
        const byIndex = packTotals[ref.packIndex];
        if (byIndex > 0) return byIndex;
      }
      const byId = packs.findIndex((entry) => entry?.pack?.materialId === ref.materialId);
      if (byId >= 0 && packTotals[byId] > 0) return packTotals[byId];
      const byTitle = packs.findIndex((entry) => ref.sourceTitle && entry?.pack?.title === ref.sourceTitle);
      if (byTitle >= 0 && packTotals[byTitle] > 0) return packTotals[byTitle];
      return null;
    };

    let lateChunk = 0;
    let lateSection = 0;
    let sectionOnly = 0;
    let neither = 0;
    const samples: Array<{ sectionId: string | null; total: number | null; sectionPos: number | null; chunkPos: number | null }> = [];
    for (const ref of refs) {
      const chunkPos = docs
        .map((doc) => chunkPositionOf(doc, ref.quote, ref.sectionTitle || ''))
        .find((value) => value !== null) ?? null;
      const ordinal = sectionOrdinal(ref.sectionId);
      const total = totalSectionsOf(ref);
      const sectionPos = ordinal !== null && total && total > 1 ? (ordinal - 1) / (total - 1) : null;
      const isLateChunk = chunkPos !== null && chunkPos >= 0.5;
      const isLateSection = sectionPos !== null && sectionPos >= 0.5;
      if (isLateChunk) lateChunk += 1;
      if (isLateSection) lateSection += 1;
      if (!isLateChunk && isLateSection) sectionOnly += 1;
      if (!isLateChunk && !isLateSection) neither += 1;
      if (samples.length < 6) samples.push({ sectionId: ref.sectionId, total, sectionPos, chunkPos });
    }

    totals.refs += refs.length;
    totals.lateChunk += lateChunk;
    totals.lateSection += lateSection;
    totals.sectionOnly += sectionOnly;
    totals.neither += neither;
    if (lateChunk > 0) totals.goalsWithLateChunk += 1;
    if (lateSection > 0) totals.goalsWithLateSection += 1;
    const primaryDoc = docs[0];
    const primaryPack = packs.find((entry) => primaryDoc && entry?.pack?.title === primaryDoc.name) || packs[0];
    const primarySections = (primaryPack?.pack?.sections || []) as Array<{ title?: string }>;
    const corrPairs: Array<[number, number]> = [];
    for (let index = 0; index < primarySections.length; index += 1) {
      const pos = chunkPositionOf(primaryDoc, '', String(primarySections[index]?.title || ''));
      if (pos !== null) corrPairs.push([index + 1, pos]);
    }
    const sectionChunkRho = spearman(corrPairs);
    perGoal.push({ goal: row.goal, refs: refs.length, lateChunk, lateSection, sectionOnly, sectionChunkRho, samples });
    console.log(
      `${String(row.goal).padEnd(20)} refs ${String(refs.length).padStart(3)}｜chunk 后半 ${String(lateChunk).padStart(2)}` +
        `｜section 后半 ${String(lateSection).padStart(2)}｜仅 section 命中 ${String(sectionOnly).padStart(2)}` +
        `｜章节↔正文秩相关 ${sectionChunkRho === null ? '-' : sectionChunkRho.toFixed(2)}`
    );
  }

  console.log('\n=== 汇总 ===');
  console.log(
    `refs ${totals.refs}｜chunk 后半 ${totals.lateChunk}（${((totals.lateChunk / Math.max(1, totals.refs)) * 100).toFixed(1)}%）` +
      `｜section 后半 ${totals.lateSection}（${((totals.lateSection / Math.max(1, totals.refs)) * 100).toFixed(1)}%）` +
      `｜仅 section 命中 ${totals.sectionOnly}｜双口径均不算后半 ${totals.neither}`
  );
  console.log(
    `有后半引用的 goal：chunk 口径 ${totals.goalsWithLateChunk} 个｜section 口径 ${totals.goalsWithLateSection} 个`
  );

  const outFile = path.join(path.dirname(runFile), `dual-metric-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ runFile, totals, perGoal }, null, 2), 'utf-8');
  console.log(`明细 → ${outFile}`);
}

main()
  .catch((error) => {
    console.error('[dual-metric] 失败', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    const { default: prisma } = await import('../config/database');
    await prisma.$disconnect().catch(() => undefined);
  });
