#!/usr/bin/env node
/**
 * wave5 统一矿机：对 wave5 跑批产出的每条 path 抽结构化指标（纯读 DB + 状态文件，不碰后端）。
 *
 * 度量面（每条 path 一行）：
 *   budgetDerivation（锚定来源/钳制）· budgetConservation（target/before/after/capacitySum/clampReason）
 *   delivery（实交付 vs 人设自述 expectedHours / vs 锚定 target）· 结构（阶段/课数/等分/分钟档）
 *   crossStageFiller（跨阶段复读，与 stage-filler 同口径阈值 0.7）· anchorMention（教材/考纲锚命中率）
 *   failure（生成未就绪/空内容）· 配对 r1 vs r2（存量人设修复前后 A/B）
 *
 * 用法：node wave5-mine.mjs [--only=new|old|all] [--out=results/wave5-metrics.jsonl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DB = `file:${path.join(ROOT, 'backend/prisma/dev.db')}?mode=ro`;
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const ONLY = arg('only', 'all');
const SESSION_SINCE = Number(arg('since', '0')); // 本会话起点 epoch ms；>0 时只统计本轮新跑的格子
const OUT = path.join(HERE, arg('out', 'results/wave5-metrics.jsonl'));

const jp = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---- 人设语料 ----
const personaFiles = [
  'scripts/paradigm-eval/real-goals-cases.json',
  'scripts/paradigm-eval/golden-personas.json',
  'scripts/paradigm-eval/teaching-quality-cases.json',
];
const byId = new Map();
for (const f of personaFiles) {
  const d = jp(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const c of (d?.cases || d?.personas || [])) if (c.personaId) byId.set(c.personaId, c);
}

// ---- filler 同口径检测器副本（stage-filler.ts 的 JS 复刻）----
const STOP = ['回补', '重推', '重做', '验证', '梳理', '整理', '对照', '盘点', '合上书', '基础题',
  '前置概念', '综合', '闭环', '复现', '自查', '形成', '输出', '制定', '明确', '例题'];
const VOCAB = ['三角函数', '数列', '立体几何', '平面向量', '解三角形', '导数', '函数', '不等式',
  '解析几何', '统计概率', '复数', '算法', '集合', '逻辑用语', '力学', '电磁学', '电学', '欧姆定律',
  '错位清单', '错题', '长投', '增值税', '申论', '资料分析', '数量关系', '听力', '词汇', '口语',
  '写作', '阅读', '分录', '民法', '刑法', '行政法', '挣值', '敏捷', 'SQL', 'Python', 'RAG', 'Zotero', '回归', '问卷'];
const norm = (t) => { let s = String(t || ''); for (const w of STOP) s = s.split(w).join(''); return s.replace(/[\s，。、；：:；,.;/／·\-—－()（）[\]【】"'“”‘’]/g, ''); };
const bigrams = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); if (s.length === 1) o.add(s); return o; };
const sim = (a, b) => { const na = norm(a), nb = norm(b); if (!na || !nb) return 0; if (na === nb) return 1; const A = bigrams(na), B = bigrams(nb); let i = 0; for (const g of A) if (B.has(g)) i++; return i / (A.size + B.size - i); };

// ---- 状态文件 → {id, run, pathId, status, durSec} ----
const resultDir = path.join(HERE, 'results');
const cells = [];
for (const f of fs.readdirSync(resultDir)) {
  const m = f.match(/^(.+)-r(\d+)\.json$/);
  if (!m) continue;
  const id = m[1];
  if (/^learn-|-classroom$/.test(id)) continue; // 教学驱动态，不是 path 格
  const st = jp(fs.readFileSync(path.join(resultDir, f), 'utf8'));
  if (!st) continue;
  const run = Number(m[2]);
  const isNew = /^rw-(school5|exam5|career5|life5|acad5|int5)-/.test(id);
  if (ONLY === 'new' && !isNew) continue;
  if (ONLY === 'old' && isNew) continue;
  if (SESSION_SINCE && !(isNew || Number(st.startedAt) >= SESSION_SINCE)) continue;
  cells.push({
    id, run, isNew,
    status: st.status || null,
    pathId: st.pathId || null,
    durSec: st.startedAt && st.finishedAt ? Math.round((st.finishedAt - st.startedAt) / 1000) : null,
    startedAt: st.startedAt || null,
    err: st.error || null,
  });
}

const db = new DatabaseSync(DB, { readOnly: true });
const rows = [];
const failures = [];

for (const c of cells) {
  if (c.status !== 'done' || !c.pathId) { failures.push(c); continue; }
  const p = db.prepare('SELECT id, name, title, estimatedHours, createdAt, aiPromptTemplate FROM learning_paths WHERE id=?').get(c.pathId);
  if (!p) { failures.push({ ...c, err: 'path-not-found' }); continue; }
  const ms = db.prepare('SELECT id, stageNumber, title, goal, estimatedHours FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(p.id);
  const tasks = [];
  for (const m of ms) {
    for (const t of db.prepare('SELECT title, taskType, estimatedMinutes, "order", icapLevel FROM subtasks WHERE milestoneId=? ORDER BY "order"').all(m.id)) {
      tasks.push({ ...t, stage: m.stageNumber, stageTitle: m.title });
    }
  }
  const mins = tasks.map((t) => Number(t.estimatedMinutes) || 0);
  const deliveredH = +(mins.reduce((a, b) => a + b, 0) / 60).toFixed(1);

  const tpl = jp(p.aiPromptTemplate) || {};
  const h = tpl?.normalizedInput?.normalizedInput?.planningHints || tpl?.normalizedInput?.planningHints || {};
  const cons = tpl?._generation?.budgetConservation || null;
  const der = h.budgetDerivation || null;
  const persona = byId.get(c.id) || null;
  const expect = Number(persona?.budget?.expectedHours) || null;
  const daily = Number(persona?.budget?.dailyMinutes) || null;

  // 跨阶段复读：不同 stage 的课标题两两相似度 ≥0.7（同阶段内由 detectStageFiller 管）
  const crossPairs = [];
  const byStage = new Map();
  for (const t of tasks) { const a = byStage.get(t.stage) || []; a.push(t); byStage.set(t.stage, a); }
  const stageNums = [...byStage.keys()].sort((a, b) => a - b);
  for (let i = 0; i < stageNums.length; i++) {
    for (let j = i + 1; j < stageNums.length; j++) {
      const worst = [];
      for (const a of byStage.get(stageNums[i])) {
        for (const b of byStage.get(stageNums[j])) {
          const s = sim(a.title, b.title);
          if (s >= 0.7) worst.push({ a: a.title, b: b.title, s: Math.round(s * 1000) / 1000 });
        }
      }
      if (worst.length) crossPairs.push({ stageA: stageNums[i], stageB: stageNums[j], pairs: worst.slice(0, 3), n: worst.length });
    }
  }

  // 锚命中：教材/考纲锚词是否出现在课/阶段标题里（粗粒度覆盖探针）
  let anchorHits = 0, anchorWords = 0;
  if (persona?.schoolAnchor) {
    const raw = [persona.schoolAnchor.textbook, persona.schoolAnchor.examScope, persona.schoolAnchor.pace, persona.domain]
      .filter(Boolean).join(' ');
    const words = raw.split(/[（(）、，,\s；;：:]+/)
      .map((w) => w.replace(/[）)]/g, '').trim())
      .filter((w) => w.length >= 4 && w.length <= 12 && /[\u4e00-\u9fa5]/.test(w)
        && !/版|上册|下册|年级|学期|单元|期中|期末|考试|试卷|进度|测试|范围|合办|中英/.test(w));
    const titles = tasks.map((t) => t.title).join('|') + '|' + ms.map((m) => m.title).join('|');
    const uniq = [...new Set(words)];
    anchorWords = uniq.length;
    anchorHits = uniq.filter((w) => titles.includes(w)).length;
  }

  const lessonsPerStage = stageNums.map((n) => byStage.get(n).length);
  const equalSplit = lessonsPerStage.length > 1 && new Set(lessonsPerStage).size === 1;
  const range1 = h.subtaskMinutesRange ? Number(h.subtaskMinutesRange[1]) : null;
  const overSession = range1 ? mins.filter((m) => m > range1).length : null;

  rows.push({
    id: c.id, run: c.run, isNew: c.isNew, pathId: p.id,
    domainTag: (c.id.match(/^rw-([a-z]+\d*)-/) || [])[1] || c.id,
    intent: persona?.intentType || null,
    durSec: c.durSec,
    expect, daily,
    target: Number(h.targetTotalHours) || null,
    tpm: Number(h.targetHoursPerMilestone) || null,
    tm: Number(h.targetMilestones) || null,
    deliveredH,
    ratioExpect: expect && deliveredH ? Math.round((deliveredH / expect) * 100) / 100 : null,
    ratioTarget: h.targetTotalHours && deliveredH ? Math.round((deliveredH / Number(h.targetTotalHours)) * 100) / 100 : null,
    der: der ? { source: der.source, structuredHours: der.structuredHours, cap: der.inferredCapHours, anchorClamped: der.anchorClamped } : null,
    cons: cons ? { target: cons.target, before: cons.before, after: cons.after, capSum: cons.capacitySum, scaled: cons.scaled, reason: cons.clampReason } : null,
    stages: ms.length,
    lessons: tasks.length,
    lessonsPerStage,
    equalSplit,
    avgMin: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    maxMin: mins.length ? Math.max(...mins) : null,
    overSession,
    emptyStages: stageNums.filter((n) => byStage.get(n).length === 0).length,
    crossFiller: crossPairs.length ? crossPairs : null,
    anchorHits, anchorWords,
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ---- 汇总 ----
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const med = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };

// 配对 A/B：同一人设的旧路径 vs 新路径（按 startedAt 取首末两个 done）
const byPersona = new Map();
for (const r of rows) { const a = byPersona.get(r.id) || []; a.push(r); byPersona.set(r.id, a); }
const pairs = [];
for (const [id, rs] of byPersona) {
  if (rs.length < 2) continue;
  rs.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const [first, last] = [rs[0], rs[rs.length - 1]];
  if (first.pathId === last.pathId) continue;
  pairs.push({
    id, oldRun: first.run, newRun: last.run,
    oldH: first.deliveredH, newH: last.deliveredH,
    oldR: first.ratioExpect, newR: last.ratioExpect,
    oldEqual: first.equalSplit, newEqual: last.equalSplit,
    oldStages: first.stages, newStages: last.stages,
    oldLessons: first.lessons, newLessons: last.lessons,
    improved: (last.ratioExpect ?? 0) - (first.ratioExpect ?? 0),
  });
}
const improved = pairs.filter((p) => p.improved > 0.05).length;
const regressed = pairs.filter((p) => p.improved < -0.05).length;
const eqCleared = pairs.filter((p) => p.oldEqual && !p.newEqual).length;
const eqNew = pairs.filter((p) => !p.oldEqual && p.newEqual).length;

function band(rs) {
  const rE = rs.map((r) => r.ratioExpect).filter((x) => x != null);
  const b = [[0, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.2], [1.2, 1e9]].map(([lo, hi]) => {
    const hit = rE.filter((x) => x >= lo && x < hi).length;
    return `${lo}-${hi === 1e9 ? '∞' : hi}×: ${hit}(${pct(hit, rE.length)}%)`;
  });
  const reasons = {};
  for (const r of rs) { const k = r.cons?.reason || 'none'; reasons[k] = (reasons[k] || 0) + 1; }
  console.log(`== cells=${cells.length} done=${rs.length} fail=${failures.length} ==`);
  console.log('failure:', failures.length ? failures.map((f) => `${f.id}#r${f.run}:${f.status || f.err}`).slice(0, 12).join(', ') : '无');
  console.log('delivery vs 人设自述:', b.join('  '), ' median:', med(rE));
  console.log('clampReason:', JSON.stringify(reasons));
  console.log('anchorClamped:', rs.filter((r) => r.der?.anchorClamped).length, '/', rs.filter((r) => r.der).length);
  console.log('equalSplit(等分课数):', rs.filter((r) => r.equalSplit).length, '/', rs.length);
  console.log('crossStageFiller:', rs.filter((r) => r.crossFiller).length, '/', rs.length);
  console.log('anchorHits(教材词命中):', rs.filter((r) => r.anchorWords).length ? `${rs.filter((r) => r.anchorWords && r.anchorHits > 0).length}/${rs.filter((r) => r.anchorWords).length}` : 'n/a');
  console.log('emptyStages:', rs.filter((r) => r.emptyStages > 0).length);
  const d = rs.map((r) => r.durSec).filter(Boolean).sort((a, z) => a - z);
  console.log('durSec p50:', d.length ? d[d.length >> 1] : '-', 'max:', d.length ? d[d.length - 1] : '-');
}
band(rows);
if (pairs.length) {
  console.log(`== 配对 A/B（同人设旧 vs 新，n=${pairs.length}）==`);
  console.log(`delivery 改善 ${improved} / 退化 ${regressed} / 持平 ${pairs.length - improved - regressed}`);
  console.log(`等分现象：清除 ${eqCleared} / 新增 ${eqNew}`);
  const medImp = med(pairs.map((p) => p.improved));
  console.log('delivery 变化中位:', medImp);
  const worst = [...pairs].sort((a, b) => a.improved - a.improved).slice(0, 5);
  console.log('退化最大:', worst.map((p) => `${p.id} ${p.oldR}→${p.newR}`).join(', '));
}
