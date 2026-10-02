#!/usr/bin/env node
/**
 * review-export.mjs — 把跑批结果导成「可评审」的数据结构（NAMING.md reviews/ 层）。
 *
 * 三层产物（doc/local/runs/<当日>/reviews/）：
 *   review_table_<date>.csv / .jsonl   一行一格的横向对照表（子代理评审喂料、Excel 排序筛选）
 *   review_case-<persona>_r<N>_<date>.md   评审单元：人设卡+目标锚+对话+路径全结构+守恒比+配对链接
 *   review_overview_<date>.md          总览：域分布、量级守恒直方、异常名单、配对离散、抽样建议
 *
 * 数据来源：results/<id>-r<N>.json（格子态）+ real-goals-cases/golden-personas/teaching-quality-cases
 * （人设卡与 budget.expectedHours 锚）+ dev.db（path/阶段/课 权威结构）+ wave-*-summary.jsonl（波次）。
 * 用法：node review-export.mjs [--ids=results/wave5-ids.txt,...] [--date=20260930] [--out=<dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RESULTS = path.join(HERE, 'results');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const localDate = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const RUN_DATE = arg('date', localDate());
const OUT_DIR = path.resolve(arg('out', path.join(ROOT, 'doc/local/runs', RUN_DATE, 'reviews')));

// ---- 人设卡（量级锚 = budget.expectedHours；tq/golden 为其它批次人设） ----
const cards = new Map();
for (const [f, key] of [['real-goals-cases.json', 'cases'], ['teaching-quality-cases.json', 'cases'], ['golden-personas.json', 'personas']]) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
    for (const c of j[key] || []) if (c.personaId) cards.set(c.personaId, c);
  } catch { /* 缺文件不致命 */ }
}

// ---- 格子清单：--ids 文件优先，否则扫 results 全量 ----
let idList = [];
const idsArg = arg('ids', '');
if (idsArg) {
  for (const f of idsArg.split(',')) {
    for (const id of fs.readFileSync(path.resolve(HERE, f), 'utf8').split(/\r?\n/)) if (id.trim()) idList.push(id.trim());
  }
} else {
  for (const f of fs.readdirSync(RESULTS)) { const m = f.match(/^(.+)-r(\d+)\.json$/); if (m) idList.push(m[1]); }
}
const cells = [];
for (const id of [...new Set(idList)]) {
  for (const r of [1, 2]) {
    const sf = path.join(RESULTS, `${id}-r${r}.json`);
    if (!fs.existsSync(sf)) continue;
    try { cells.push({ id, run: r, st: JSON.parse(fs.readFileSync(sf, 'utf8')) }); } catch { cells.push({ id, run: r, st: null, torn: true }); }
  }
}

// ---- 波次参与（wave-<tag>-summary.jsonl，按 id 取最后一条） ----
const waves = new Map();
for (const f of fs.readdirSync(RESULTS)) {
  const m = f.match(/^wave-(.+)-summary\.jsonl$/); if (!m) continue;
  try {
    for (const line of fs.readFileSync(path.join(RESULTS, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (!waves.has(j.id)) waves.set(j.id, []); waves.get(j.id).push(m[1]); } catch { }
    }
  } catch { }
}

// ---- DB 权威路径结构 ----
const db = new DatabaseSync(`file:${path.join(ROOT, 'backend/prisma/dev.db')}?mode=ro`, { readOnly: true });
const pathRow = db.prepare('SELECT id,name,status,estimatedHours,totalMilestones,createdAt FROM learning_paths WHERE id=?');
const stagesOf = db.prepare(`SELECT m.id, m.stageNumber, m.title, m.goal, m.estimatedHours,
  (SELECT COUNT(*) FROM subtasks s WHERE s.milestoneId=m.id) AS tasks,
  (SELECT COALESCE(SUM(s.estimatedMinutes),0) FROM subtasks s WHERE s.milestoneId=m.id) AS taskMinutes
  FROM milestones m WHERE m.learningPathId=? ORDER BY m.stageNumber`);
const tasksOf = db.prepare('SELECT title, taskType, estimatedMinutes FROM subtasks WHERE milestoneId=? ORDER BY "order"');

// ---- 组装每格记录 ----
const domainOf = (id, card) => (id.match(/^rw-([a-z0-9]+?)[0-]/) || [])[1] || (card?.domain || '').slice(0, 6) || 'other';
const clamp1 = (x) => Math.round(x * 10) / 10;
const rows = [];
for (const { id, run, st, torn } of cells) {
  const card = cards.get(id) || null;
  const pathId = st?.pathId || null;
  const pr = pathId ? pathRow.get(pathId) : null;
  const stages = pathId ? stagesOf.all(pathId) : [];
  let tasks = 0, taskMinutes = 0;
  const stageList = [];
  for (const m of stages) {
    const subs = tasksOf.all(m.id);
    tasks += subs.length; taskMinutes += m.taskMinutes || 0;
    stageList.push({ n: m.stageNumber, title: m.title, goal: m.goal, hours: m.estimatedHours, tasks: subs.map(s => ({ t: s.title, type: s.taskType, min: s.estimatedMinutes })) });
  }
  const target = card?.budget?.expectedHours ?? null;
  const est = pr?.estimatedHours ?? st?.path?.estimatedHours ?? null;
  const ratio = target && est ? clamp1(est / target) : null;
  // 容量口径：budget.dailyMinutes × horizonDays（管线在 锚→交付 之间有容量夹层，I 维审计三夹）——
  // est≈cap=容量夹后足额；est≪cap 且 est≪锚=真缩水。只看锚会把「设计上就该小」误报成缺口。
  const b = card?.budget || {};
  const cap = b.dailyMinutes && b.horizonDays ? clamp1(b.dailyMinutes * b.horizonDays / 60) : null;
  const ratioCap = cap && est ? clamp1(est / cap) : null;
  const dom = domainOf(id, card);
  const wl = [...new Set(waves.get(id) || [])];
  rows.push({
    personaId: id, run, domain: dom, family: dom.replace(/5$/, ''), intentType: card?.intentType || null,
    cellStatus: st?.status || (torn ? 'torn-json' : 'missing'),
    pathId, pathName: pr?.name || st?.path?.name || null, pathStatus: pr?.status || null,
    targetHours: target, estHours: est, ratio, capHours: cap, ratioCap,
    stages: stages.length, tasks, avgTaskMin: tasks ? Math.round(taskMinutes / tasks) : null,
    estTaskHours: taskMinutes ? clamp1(taskMinutes / 60) : null,
    rounds: st?.rounds ?? null, resistances: st?.resistances ?? 0,
    transcriptTurns: (st?.transcript || []).length,
    genLifecycle: st?.generationLifecycle || null,
    waves: (wl.length > 3 ? `${wl[0]}…${wl[wl.length - 1]}(${wl.length}波)` : wl.join('+')),
    paired: null, startedAt: st?.startedAt || null, finishedAt: st?.finishedAt || null,
    errors: (st?.errors || []).length, lastError: (st?.errors || []).slice(-1)[0]?.note || (st?.errors || []).slice(-1)[0]?.message || null,
    stageList,
  });
}
// 配对标记（同 persona 双 run）
const byId = new Map();
for (const r of rows) { byId.set(r.personaId, (byId.get(r.personaId) || 0) + 1); }
for (const r of rows) r.paired = (byId.get(r.personaId) || 0) > 1 ? 'Y' : '';

fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- CSV / JSONL ----
const csvCols = ['personaId', 'run', 'domain', 'family', 'intentType', 'cellStatus', 'pathId', 'pathName', 'pathStatus', 'targetHours', 'capHours', 'estHours', 'ratio', 'ratioCap', 'stages', 'tasks', 'avgTaskMin', 'estTaskHours', 'rounds', 'resistances', 'transcriptTurns', 'genLifecycle', 'waves', 'paired', 'errors', 'lastError'];
const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [csvCols.join(',')].concat(rows.map(r => csvCols.map(c => q(r[c])).join(','))).join('\n');
fs.writeFileSync(path.join(OUT_DIR, `review_table_${RUN_DATE}.csv`), '\ufeff' + csv + '\n');
const jsonl = rows.map(({ stageList, ...r }) => JSON.stringify({ ...r, stageBrief: stageList.map(s => `M${s.n}[${s.hours}h ${s.tasks.length}课] ${String(s.title).slice(0, 30)}`) })).join('\n');
fs.writeFileSync(path.join(OUT_DIR, `review_table_${RUN_DATE}.jsonl`), jsonl + '\n');

// ---- 评审单元 case md ----
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
for (const r of rows) {
  const card = cards.get(r.personaId);
  const b = card?.budget || {};
  const L = [];
  L.push(`# ${r.personaId}#r${r.run}（${r.domain}${card?.intentType ? ' / ' + card.intentType : ''}）`);
  L.push(`\n- 路径: ${r.pathId} 「${clip(r.pathName, 40)}」 ${r.pathStatus || '-'} | 生成: ${r.genLifecycle || r.cellStatus}`);
  L.push(`- 量级: 期望锚 ${r.targetHours ?? '?'}h / 容量 ${r.capHours ?? '?'}h → 交付 ${r.estHours ?? '?'}h = **ratio ${r.ratio ?? '?'}**（对容量 ${r.ratioCap ?? '?'}）${r.ratio !== null ? (r.ratio < 0.6 ? (r.ratioCap !== null && r.ratioCap >= 0.8 ? ' ⚠️低于期望（容量夹解释）' : ' ⚠️缺口') : r.ratio > 1.5 ? ' ⚠️超量' : '') : ''} | ${r.stages} 阶段 / ${r.tasks} 课 / 均课 ${r.avgTaskMin ?? '?'}min（课面合计 ${r.estTaskHours ?? '?'}h）`);
  L.push(`- 对话: ${r.rounds ?? '?'} 轮（异议 ${r.resistances}）| 波次: ${r.waves || '-'} | 配对: ${r.paired || '单'}`);
  if (card) {
    L.push(`\n## 人设\n- 预算: ${b.horizon || '-'}（${b.horizonDays ?? '?'} 天，每日 ${b.dailyMinutes ?? '?'}min，期望 ${b.expectedHours ?? '?'}h）`);
    const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
    if (card.schoolAnchor) L.push(`- 校内锚: ${clip(asText(card.schoolAnchor), 140)}`);
    if (card.source) L.push(`- 情景来源: ${clip(asText(card.source), 180)}`);
    L.push(`\n**Opening**：${clip(card.opening, 300)}`);
    const fus = card.followUps || [];
    if (fus.length) L.push(fus.map((f, i) => `${i + 1}. ${clip(f, 120)}`).join('\n'));
  }
  const st = rows && cells.find(c => c.id === r.personaId && c.run === r.run)?.st;
  if (st?.transcript?.length) {
    L.push(`\n## 对话回放（压缩）`);
    L.push(st.transcript.map(t => `- **${t.role === 'user' ? '学' : 'AI'}** ${clip(t.text, 110)}`).join('\n'));
  }
  if (r.stageList.length) {
    L.push(`\n## 路径结构`);
    for (const s of r.stageList) {
      L.push(`\n### M${s.n} ${s.title}（${s.hours}h）`);
      if (s.goal) L.push(`目标: ${clip(s.goal, 200)}`);
      L.push(s.tasks.map((t, i) => `${i + 1}. [${t.type || '?'} ${t.min}min] ${clip(t.t, 80)}`).join('\n'));
    }
  }
  if (r.errors) L.push(`\n## 异常（${r.errors}）\n- ${clip(r.lastError, 200)}`);
  const sib = rows.find(x => x.personaId === r.personaId && x.run !== r.run);
  if (sib) L.push(`\n> 配对兄弟：r${sib.run} ratio=${sib.ratio ?? '?'}（Δ ${r.ratio !== null && sib.ratio !== null ? clamp1(Math.abs(r.ratio - sib.ratio)) : '?'}）`);
  fs.writeFileSync(path.join(OUT_DIR, `review_case-${r.personaId}_r${r.run}_${RUN_DATE}.md`), L.join('\n') + '\n');
}

// ---- 总览 ----
const median = (a) => { const v = a.filter(x => x !== null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

const O = [];
O.push(`# 跑批评审总览（${RUN_DATE}）`);
O.push(`\n格子 ${rows.length}（r1 ${rows.filter(r => r.run === 1).length} / r2 ${rows.filter(r => r.run === 2).length}），完成 ${rows.filter(r => r.cellStatus === 'done').length}，配对 ${rows.filter(r => r.paired).length / 2} 组。`);
O.push(`\n## 量级守恒（双镜头：交付 / 期望锚、交付 / 容量）`);
const ratios = rows.filter(r => r.ratio !== null).map(r => r.ratio);
const ratiosCap = rows.filter(r => r.ratioCap !== null).map(r => r.ratioCap);
const bucket = (a, lo, hi) => a.filter(x => x >= lo && x < hi).length;
O.push(`对**期望锚**（人设想要的总量）ratio 中位 **${median(ratios)}**：<0.4 ${bucket(ratios, 0, 0.4)} | 0.4-0.6 ${bucket(ratios, 0.4, 0.6)} | 0.6-1.2 ✓ ${bucket(ratios, 0.6, 1.2)} | 1.2-1.5 ${bucket(ratios, 1.2, 1.5)} | >1.5 ${ratios.filter(x => x > 1.5).length}（无锚 ${rows.filter(r => r.ratio === null).length}）`);
O.push(`对**容量**（budget.dailyMinutes×horizonDays，容量夹后的可行预算）ratioCap 中位 **${median(ratiosCap)}**：<0.4 ⚠️ ${bucket(ratiosCap, 0, 0.4)} | 0.4-0.8 ${bucket(ratiosCap, 0.4, 0.8)} | ≥0.8 ✓ ${ratiosCap.filter(x => x >= 0.8).length}（无容量 ${rows.filter(r => r.ratioCap === null).length}）`);
O.push(`> 判读：管线在 锚→交付 之间有容量夹层（I 维审计三夹），**ratioCap 才是交付足额度**；ratio<0.6 且 ratioCap≥0.8 = 设计上就该小，不算缺口。`);
const fams = [...new Set(rows.map(r => r.family))];
O.push(`\n## 域族分布`);
O.push(`| 域族 | 格数 | ratio 中位 | ratioCap 中位 | 阶段中位 | 课中位 | 均课min 中位 |`);
O.push(`|---|---|---|---|---|---|---|`);
for (const d of fams.sort()) {
  const g = rows.filter(r => r.family === d);
  O.push(`| ${d} | ${g.length} | ${median(g.map(r => r.ratio))} | ${median(g.map(r => r.ratioCap))} | ${median(g.map(r => r.stages))} | ${median(g.map(r => r.tasks))} | ${median(g.map(r => r.avgTaskMin))} |`);
}
const bad = rows.filter(r => (r.ratio !== null && r.ratio < 0.6 && !(r.ratioCap !== null && r.ratioCap >= 0.8)) || (r.ratio !== null && r.ratio > 1.5));
O.push(`\n## 异常名单（真缺口：ratio<0.6 且 ratioCap<0.8；或 ratio>1.5，共 ${bad.length}）`);
O.push(bad.sort((a, b) => a.ratio - b.ratio).slice(0, 40).map(r => `- ${r.personaId}#r${r.run} 锚${r.targetHours}h/容${r.capHours ?? '?'}h → ${r.estHours}h ratio=${r.ratio} ratioCap=${r.ratioCap ?? '?'}${r.pathId ? '' : ' ⚠️无路径'}`).join('\n') || '- 无');
const unfinished = rows.filter(r => r.cellStatus !== 'done');
O.push(`\n## 未完成格（${unfinished.length}）`);
O.push(unfinished.slice(0, 30).map(r => `- ${r.personaId}#r${r.run} ${r.cellStatus}${r.genLifecycle ? '/' + r.genLifecycle : ''}`).join('\n') || '- 无');
const pairs = rows.filter(r => r.paired);
const pairDiffs = [];
for (const r of pairs.filter(x => x.run === 1)) {
  const s = pairs.find(x => x.personaId === r.personaId && x.run === 2);
  if (s && r.ratio !== null && s.ratio !== null) pairDiffs.push({ id: r.personaId, d: clamp1(Math.abs(r.ratio - s.ratio)), a: r.ratio, b: s.ratio });
}
pairDiffs.sort((x, y) => y.d - x.d);
O.push(`\n## 配对离散 TOP（|r1-ratio − r2-ratio|，共 ${pairDiffs.length} 组）`);
O.push(pairDiffs.slice(0, 15).map(p => `- ${p.id}: r1=${p.a} vs r2=${p.b}（Δ${p.d}）`).join('\n') || '- 无');
O.push(`\n## 评审入口\n- 横向对照：review_table_${RUN_DATE}.csv（Excel 排序筛选）/ .jsonl（子代理喂料，3-5 条/代理）`);
O.push(`- 深读单元：review_case-<persona>_r<N>_${RUN_DATE}.md（人设+对话+全结构+守恒比）`);
O.push(`- 课堂层：runs/${RUN_DATE}/lessons/lesson_*_tag_${RUN_DATE}.json + learnq-*-summary.jsonl`);
fs.writeFileSync(path.join(OUT_DIR, `review_overview_${RUN_DATE}.md`), O.join('\n') + '\n');

console.log(`导出 ${rows.length} 格 → ${OUT_DIR}`);
console.log(`  review_table_${RUN_DATE}.csv/.jsonl + case md × ${rows.length} + review_overview_${RUN_DATE}.md`);
