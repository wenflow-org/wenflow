#!/usr/bin/env node
/**
 * 验证资料引用：对每个 pathId，检查 materialRefs 的 quote 是否逐字来自资料包文本（isQuoteVerbatim 口径）。
 * 用法: node scripts/school-demo/verify-refs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'));
const q = (s) => db.prepare(s).all();
const OUT = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');

const norm = (s) => String(s || '').replace(/\s+/g, '');
// pack 文本 = 章节标题 + 要点 cite/text + tldr（与 material-refs.ts packText 同口径）
function packText(pack) {
  const parts = [];
  if (pack?.tldr) parts.push(pack.tldr);
  for (const s of pack?.sections || []) parts.push(s.title || '', s.summary || '');
  for (const k of pack?.keyPoints || []) parts.push(k.text || '', k.cite || '');
  return norm(parts.join(''));
}

const bands = { P1: '小学', J1: '初中', S1: '高中', C1: '大学' };
const report = [];
for (const [run, label] of Object.entries(bands)) {
  let state; try { state = JSON.parse(fs.readFileSync(path.join(OUT, `${run}-state.json`), 'utf8')); } catch { continue; }
  const pid = q(`select learningPathId from virtual_sessions where id='${state.sessionId}'`)[0]?.learningPathId;
  if (!pid) continue;
  const p = q(`select title,aiPromptTemplate from learning_paths where id='${pid}'`)[0];
  const tpl = JSON.parse(p.aiPromptTemplate || '{}');
  const mats = tpl.sceneFraming?.normalizedInput?.resources?.materials || [];
  const byTask = tpl.materialRefs?.byTask || {};
  const byStage = tpl.materialRefs?.byStage || {};

  let totalRefs = 0, verbatim = 0, notFound = 0;
  const check = (refs) => {
    for (const r of refs || []) {
      totalRefs++;
      const pack = mats[r.packIndex]?.pack;
      if (pack && norm(r.quote) && packText(pack).includes(norm(r.quote))) verbatim++;
      else notFound++;
    }
  };
  Object.values(byTask).forEach(check);
  Object.values(byStage).forEach(v => check(Array.isArray(v) ? v : [v]));

  report.push({ label, title: p.title, mats: mats.length, byTask: Object.keys(byTask).length, byStage: Object.keys(byStage).length, totalRefs, verbatim, notFound });
}
console.log('| 学段 | 路径 | 资料包 | 有引用任务 | 阶段引用 | 引用总数 | 逐字命中 | 未命中 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of report) console.log(`| ${r.label} | ${r.title} | ${r.mats} | ${r.byTask} | ${r.byStage} | ${r.totalRefs} | ${r.verbatim} | ${r.notFound} |`);
fs.writeFileSync(path.join(OUT, 'verify-refs.json'), JSON.stringify(report, null, 2));
