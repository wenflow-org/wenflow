/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性分析 CLI，读两侧产物 JSON 按 any 取字段 */
/**
 * 汇总 goal→path A/B：读取 old/new 两次运行的 JSON，重算「引用落在原文后半」的比例
 * （目录污染修正：同一标题在目录页也出现，取正文侧匹配），并生成 Markdown 报告。
 *
 * 用法：npm --prefix backend run material:ab:goal-path:report -- --old=<old.json> --new=<new.json>
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getLearningPath } from '../services/learning/queries/path-views.queries';
import {
  buildUploadedMaterialPacks,
  buildUploadedMaterialPacksAsync,
} from '../services/materials/material-pack.builder';
import { chunkMaterialMarkdown, type MaterialChunk } from '../services/materials/material-chunker';
import { resolveMaterialsRoot } from '../services/materials/material-store';

interface Doc {
  name: string;
  chunks: MaterialChunk[];
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

/**
 * 引用在原文中的位置（0..1）。目录修正：同一标题会在开头目录页复现，
 * 若前 10% 与后段都命中，取正文侧（后段）匹配的中位序号。
 */
function positionOf(doc: Doc | undefined, quote: string, title: string): number | null {
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

function collectRefs(detail: any): Array<{ quote: string; title: string }> {
  const refs: Array<{ quote: string; title: string }> = [];
  const milestones = Array.isArray(detail?.milestones) ? detail.milestones : [];
  for (const milestone of milestones) {
    for (const ref of Array.isArray(milestone.materialRefs) ? milestone.materialRefs : []) {
      refs.push({ quote: String(ref?.quote || ''), title: String(ref?.sectionTitle || '') });
    }
    for (const task of Array.isArray(milestone.subtasks) ? milestone.subtasks : []) {
      for (const ref of Array.isArray(task.materialRefs) ? task.materialRefs : []) {
        refs.push({ quote: String(ref?.quote || ''), title: String(ref?.sectionTitle || '') });
      }
    }
  }
  return refs;
}

async function packMetrics(userId: string, arm: 'old' | 'new', docs: Doc[]) {
  process.env.MATERIAL_PACK_SEMANTIC_DISABLED = arm === 'old' ? '1' : '0';
  let packs: any[] = [];
  try {
    packs = arm === 'old' ? buildUploadedMaterialPacks(userId) : await buildUploadedMaterialPacksAsync(userId);
  } finally {
    delete process.env.MATERIAL_PACK_SEMANTIC_DISABLED;
  }
  let points = 0;
  let pointsLate = 0;
  let chars = 0;
  let sections = 0;
  let sectionsLate = 0;
  for (const result of packs) {
    const pack = result?.pack;
    if (!pack) continue;
    chars += pack.tldr.length;
    for (const section of pack.sections) {
      sections += 1;
      const pos = docs
        .map((doc) => positionOf(doc, '', String(section.title || '')))
        .find((candidate) => candidate !== null);
      if (pos !== undefined && pos !== null && pos >= 0.5) sectionsLate += 1;
    }
    for (const point of pack.keyPoints) {
      points += 1;
      chars += point.text.length;
      const pos = docs
        .map((doc) => positionOf(doc, String(point.cite || ''), ''))
        .find((candidate) => candidate !== null);
      if (pos !== undefined && pos !== null && pos >= 0.5) pointsLate += 1;
    }
  }
  return { points, pointsLate, chars, sections, sectionsLate };
}

async function main(): Promise<void> {
  const oldFile = argText('old');
  const newFile = argText('new');
  if (!oldFile || !newFile) throw new Error('需要 --old= 与 --new= 两个运行结果 JSON');
  const oldRows = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  const newRows = JSON.parse(fs.readFileSync(newFile, 'utf8'));
  const library = loadLibrary();
  const docByName = new Map(library.map((doc) => [doc.name, doc]));

  const merged: any[] = [];
  for (const oldRow of oldRows) {
    const newRow = newRows.find((row: any) => row.goal === oldRow.goal);
    if (!newRow) continue;
    const entry: any = {
      goal: oldRow.goal,
      rawGoal: oldRow.rawGoal,
      materials: oldRow.materials,
      old: { ...oldRow.arms.old },
      new: { ...newRow.arms.new },
    };
    const docs = (oldRow.materials || [])
      .map((name: string) => docByName.get(name))
      .filter((doc: Doc | undefined): doc is Doc => Boolean(doc));

    for (const arm of ['old', 'new'] as const) {
      const armRow = entry[arm];
      const detail: any = armRow.pathId ? await getLearningPath(armRow.pathId).catch(() => null) : null;
      const milestones = Array.isArray(detail?.milestones) ? detail.milestones : [];
      armRow.milestones = milestones.length;
      armRow.tasks = milestones.reduce((sum: number, m: any) => sum + (m.subtasks?.length || 0), 0);
      armRow.estimatedHours = Number(detail?.estimatedHours || 0);
      armRow.milestoneTitles = milestones.map((m: any) => String(m.title || ''));
      const refs = collectRefs(detail);
      armRow.refsTotal = refs.length;
      armRow.refsLate = refs.filter((ref) => {
        const pos = docs.map((doc) => positionOf(doc, ref.quote, ref.title)).find((p) => p !== null);
        return pos !== undefined && pos !== null && pos >= 0.5;
      }).length;
      if (armRow.userId) {
        const pack = await packMetrics(armRow.userId, arm, docs);
        armRow.pack = { ...armRow.pack, ...pack };
      }
    }
    merged.push(entry);
  }

  const dir = path.dirname(oldFile);
  const dataFile = path.join(dir, `merged-${Date.now()}.json`);
  fs.writeFileSync(dataFile, JSON.stringify(merged, null, 2), 'utf-8');

  const sum = (key: string, arm: 'old' | 'new') => merged.reduce((acc, row) => acc + Number(row[arm][key] || 0), 0);
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '-');
  console.log(`合并 ${merged.length} 个 goal → ${dataFile}`);
  console.log(
    `任务数 old ${sum('tasks', 'old')} / new ${sum('tasks', 'new')}｜课时 old ${sum('estimatedHours', 'old').toFixed(1)} / new ${sum('estimatedHours', 'new').toFixed(1)}`
  );
  console.log(
    `引用 old ${sum('refsTotal', 'old')}（后半 ${sum('refsLate', 'old')}, ${pct(sum('refsLate', 'old'), sum('refsTotal', 'old'))}）` +
      ` / new ${sum('refsTotal', 'new')}（后半 ${sum('refsLate', 'new')}, ${pct(sum('refsLate', 'new'), sum('refsTotal', 'new'))}）`
  );
  const psum = (arm: 'old' | 'new', key: 'points' | 'pointsLate' | 'sections' | 'sectionsLate') =>
    merged.reduce((acc, row) => acc + Number(row[arm].pack?.[key] || 0), 0);
  console.log(
    `资料包要点 old ${psum('old', 'points')}（后半 ${psum('old', 'pointsLate')}）` +
      ` / new ${psum('new', 'points')}（后半 ${psum('new', 'pointsLate')}）`
  );
  console.log(
    `资料包 chapters old ${psum('old', 'sections')}（后半 ${psum('old', 'sectionsLate')}）` +
      ` / new ${psum('new', 'sections')}（后半 ${psum('new', 'sectionsLate')}）`
  );
  const refsImproved = merged.filter((r) => Number(r.new.refsLate) > Number(r.old.refsLate)).length;
  const refsWorse = merged.filter((r) => Number(r.new.refsLate) < Number(r.old.refsLate)).length;
  console.log(`后半引用：new 更多 ${refsImproved}｜更少 ${refsWorse}｜相同 ${merged.length - refsImproved - refsWorse}`);
}

main()
  .catch((error) => {
    console.error('[report] 失败', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    const { default: prisma } = await import('../config/database');
    await prisma.$disconnect().catch(() => undefined);
  });
