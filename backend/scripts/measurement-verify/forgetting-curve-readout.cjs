#!/usr/bin/env node
/**
 * forgetting-curve-readout.cjs — 长程遗忘曲线读数（动态发现全部 day 文件）
 * 主曲线只吃 day10+ 样本（C4 修复后 FSRS 调度才按模拟日历走，day7-9 的间距被墙钟污染）。
 * 输出：①校准分桶（预测保持率带 × 实际回忆率）②间隔分桶（elapsedDays × 回忆率）
 * ③FSRS 原生占比 ④监测面三查。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const OUT = path.join(__dirname, 'out');
const DAY_MS = 86400000;
// --tag=<tag>：读 r4-cal-day<N>-<tag>*.json（并行分组/新 cohort 批次；同 tag 前缀的多组文件合并，
// 成对样本按 conceptKey|occurredAt|teachingSessionId 去重）；不带 tag = 旧单轨文件
const TAG_ARG = process.argv.find((a) => a.startsWith('--tag=')) || '';
const TAG = TAG_ARG ? TAG_ARG.slice('--tag='.length) : '';
const dayFiles = (d) => {
  if (!TAG) {
    const f = path.join(OUT, `r4-cal-day${d}.json`);
    return fs.existsSync(f) ? [f] : [];
  }
  const re = new RegExp(`^r4-cal-day${d}-${TAG}[A-Za-z0-9_-]*\\.json$`);
  try { return fs.readdirSync(OUT).filter((f) => re.test(f)).sort().map((f) => path.join(OUT, f)); } catch { return []; }
};

// ---------- ①② 曲线：动态聚合全部已有 day 文件（主曲线 = day10+，见下）----------
const pairs = [];
const seen = new Set();
let dayMin = null;
let dayMax = null;
for (let d = 1; d <= 60; d++) {
  const files = dayFiles(d);
  if (!files.length) continue;
  dayMin = dayMin === null ? d : dayMin;
  dayMax = d;
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      continue; // 文件半写或损坏（跑批进行中），跳过该文件
    }
    for (const vl of j.vls || []) {
    // 修复后（day10+）模拟日窗口结束点 = 本次复习时刻的近似（±1 天粒度）。
    // pair.occurredAt 是温故点的**原始教学时刻**而非本次复习时刻，不能拿来算间距。
    const asOfMs = vl.window?.asOf ? Date.parse(vl.window.asOf) : (j.generatedAt ? Date.parse(j.generatedAt) : NaN);
    for (const p of vl.warmupPairs || []) {
      const key = `${p.conceptKey}|${p.occurredAt}|${p.source?.teachingSessionId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const elapsed = (asOfMs - Date.parse(p.predictedLastSeenAt)) / DAY_MS;
      if (!Number.isFinite(elapsed)) continue;
      pairs.push({
        day: d,
        vl: p.source?.vlKey,
        concept: p.conceptKey,
        elapsed,
        pred: p.predictedRetentionAtAsOf,
        predPath: p.predictedFormulaPath,
        stability: p.predictedStability,
        rating: p.actualRating,
        recalled: p.actualRating && p.actualRating !== 'again' ? 1 : 0,
      });
      }
    }
  }
}
// tag 批（纪元 2 等）的 day 标签是本批新计数，全部视为有效样本；无 tag（纪元 1 存档）保留 day10+ 分组
const post = pairs.filter((p) => (TAG ? true : p.day >= 10));
const pre = pairs.filter((p) => (TAG ? false : p.day < 10));

const fmt = (arr) => {
  if (!arr.length) return '  （无样本）';
  const n = arr.length;
  const recall = arr.reduce((s, p) => s + p.recalled, 0) / n;
  const pred = arr.reduce((s, p) => s + (p.pred ?? 0), 0) / n;
  return `n=${String(n).padStart(3)}  预测均=${pred.toFixed(2)}  实际回忆率=${recall.toFixed(2)}`;
};

console.log(`== 总样本：day${dayMin ?? '?'}-${dayMax ?? '?'} 共 ${pairs.length} 对${TAG ? `（tag=${TAG}，全样本入主曲线）` : `（主曲线 day10+ = ${post.length}，此前 = ${pre.length}）`}`);
console.log(`\n== 间隔分桶（elapsedDays，修复后样本）——遗忘曲线主读数`);
for (const [lo, hi] of [[0, 1], [1, 2], [2, 4], [4, 7], [7, 100]]) {
  const b = post.filter((p) => p.elapsed >= lo && p.elapsed < hi);
  console.log(`  ${lo}-${hi === 100 ? '∞' : hi} 天: ${fmt(b)}`);
}
console.log(`\n== 校准分桶（预测保持率带，修复后样本）——预测准不准`);
for (const [lo, hi] of [[0, 0.3], [0.3, 0.6], [0.6, 0.85], [0.85, 1.01]]) {
  const b = post.filter((p) => p.pred >= lo && p.pred < hi);
  console.log(`  预测 ${lo}-${hi === 1.01 ? '1.0' : hi}: ${fmt(b)}`);
}
const hiPred = post.filter((p) => p.pred >= 0.6);
const loPred = post.filter((p) => p.pred < 0.6);
if (hiPred.length && loPred.length) {
  const sep = hiPred.reduce((s, p) => s + p.recalled, 0) / hiPred.length
    - loPred.reduce((s, p) => s + p.recalled, 0) / loPred.length;
  console.log(`  判别力（高预测带回忆率 − 低预测带回忆率）= ${sep.toFixed(2)}（>0 = 预测有方向性）`);
}
console.log(`\n== 评分分布（修复后）：`, JSON.stringify(post.reduce((m, p) => { m[p.rating] = (m[p.rating] || 0) + 1; return m; }, {})));
console.log(`== 预测公式路径：`, JSON.stringify(post.reduce((m, p) => { m[p.predPath] = (m[p.predPath] || 0) + 1; return m; }, {})));

// ---------- ③ FSRS 原生占比（监测面按 cohort 清单 cohort-<tag>.json，缺省=旧 R4 名单）----------
console.log(`\n== 监测面①：memory_traces FSRS 原生占比（现库）`);
const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
let UIDS = {
  'rw-school6-01': '109d5d76-41e7-4d3d-aac3-6f3b7ea6ee60', 'rw-school6-09': 'a3a4f770-655c-4c7f-b624-cfe7f7d9fa94',
  'rw-school6-21': 'f17d03c0-c976-4986-933a-e0124f57cfec', 'rw-exam6-08': 'eac48271-1275-4f8f-8a82-4429b389a4f3',
  'rw-acad6-03': '4b7d8df6-a894-47d2-8bb6-bed2d54348f6', 'rw-career6-05': 'a595a2f7-c788-438a-8708-81b6c259b4a9',
  'rw-life6-06': '32eee25a-2a0c-44b9-b1fe-45ee1262dbd3',
};
const manifestFile = path.join(__dirname, `cohort-${TAG || 'r4'}.json`);
if (fs.existsSync(manifestFile)) {
  UIDS = Object.fromEntries(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).map((e) => [e.key, e.userId]));
}
for (const [key, uid] of Object.entries(UIDS)) {
  const r = db.prepare('SELECT COUNT(*) n, SUM(fsrsStability IS NOT NULL) native, SUM(dueAt IS NOT NULL) withDue FROM memory_traces WHERE userId = ?').get(uid);
  console.log(`  ${key}: traces=${r.n} 原生FSRS=${r.native} 有dueAt=${r.withDue}`);
}
// ---------- ④ 监测面②：到期结构按模拟时钟 ----------
const now = Date.now();
const dueStats = db.prepare(`SELECT userId, COUNT(*) n, SUM(CASE WHEN dueAt <= ? THEN 1 ELSE 0 END) dueWall, MIN(dueAt) minDue, MAX(dueAt) maxDue FROM memory_traces WHERE userId IN (${Object.values(UIDS).map(() => '?').join(',')}) GROUP BY userId`).all(now, ...Object.values(UIDS));
console.log(`\n== 监测面②：dueAt 结构（墙钟口径；C4 修复后新事件 dueAt 应落在模拟日期）`);
for (const r of dueStats) {
  const key = Object.entries(UIDS).find(([, u]) => u === r.userId)?.[0] || r.userId.slice(0, 8);
  console.log(`  ${key}: 到期(墙钟口径)=${r.dueWall}/${r.n}  最近due=${r.minDue ? new Date(r.minDue).toISOString().slice(0, 10) : '-'}  最远=${r.maxDue ? new Date(r.maxDue).toISOString().slice(0, 10) : '-'}`);
}
// ---------- ⑤ 监测面③：投影保持率 vs 痕迹 ----------
console.log(`\n== 监测面③：learner_projections retention（按记忆域口径投影）`);
for (const [key, uid] of Object.entries(UIDS)) {
  try {
    const row = db.prepare(`SELECT payload FROM learner_projections WHERE userId = ? AND scope = 'memory' ORDER BY version DESC LIMIT 1`).get(uid);
    if (!row) { console.log(`  ${key}: （无 memory 投影）`); continue; }
    const payload = JSON.parse(row.payload);
    const ret = payload.retentionOf ? Object.values(payload.retentionOf) : [];
    const avg = ret.length ? ret.reduce((s, v) => s + (typeof v === 'number' ? v : Number(v?.retention ?? 0)), 0) / ret.length : null;
    console.log(`  ${key}: 概念数=${ret.length} 平均保持率=${avg === null ? '-' : avg.toFixed(2)}`);
  } catch (e) { console.log(`  ${key}: 投影读取失败 ${e.message.slice(0, 60)}`); }
}
db.close();
