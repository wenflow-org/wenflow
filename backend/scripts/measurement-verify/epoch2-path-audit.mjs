/**
 * 纪元 2 · path 稳住批审计（只读）。
 * 用法：node backend/scripts/measurement-verify/epoch2-path-audit.mjs \
 *         --ids-file=<personaId 清单> --since=<ms 时间窗起点> [--out=<json 路径>]
 * 口径：
 *   就绪 = 该 VL 在时间窗内有 learning_path，里程碑 ≥1 且每个里程碑都有 ≥1 子任务，path 未终态失败
 *   守恒比1 = Σ里程碑估时 / path.estimatedHours（阶段预算 vs path 锚）
 *   守恒比2 = Σ子任务估时(分)/60 / Σ里程碑估时（任务交付 vs 阶段预算）
 *   概念归属覆盖 = milestones 的 COALESCE(conceptId, coreConceptId) 非空占比（活列是 coreConceptId）
 * 门禁（退出码 0=过 / 1=不过）：就绪率 ≥0.9、守恒比2 中位数 ∈[0.5,2]、概念覆盖 ≥0.85、每 path 任务数 ≥3。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (k, d = '') => {
  const hit = process.argv.find((s) => s.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const IDS_FILE = arg('ids-file');
const SINCE = Number(arg('since', '0'));
const OUT = arg('out', '');

if (!IDS_FILE || !SINCE) {
  console.error('用法：--ids-file=<personaId 清单> --since=<ms>');
  process.exit(2);
}

const ids = fs.readFileSync(path.resolve(ROOT, IDS_FILE), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

const profiles = db.prepare('SELECT userId, presetKey, learningGoal, tags FROM virtual_learner_profiles').all();
const tagSegs = (raw) => {
  const s = String(raw || '').trim();
  try { const j = JSON.parse(s); if (Array.isArray(j)) return j.map((x) => String(x).trim()); } catch { /* 非 JSON 按逗号分段 */ }
  return s.split(',').map((x) => x.trim());
};
const findByPersona = (pid) => profiles.find((p) => tagSegs(p.tags).includes(pid));

const rows = [];
for (const pid of ids) {
  const prof = findByPersona(pid);
  if (!prof) { rows.push({ persona: pid, error: 'profile 未找到' }); continue; }
  const paths = db.prepare(
    'SELECT id, status, estimatedHours, title, createdAt FROM learning_paths WHERE userId = ? AND createdAt >= ? ORDER BY createdAt DESC LIMIT 1'
  ).all(prof.userId, SINCE);
  const p = paths[0];
  if (!p) { rows.push({ persona: pid, user: prof.userId, error: '时间窗内无 path' }); continue; }
  const ms = db.prepare(
    'SELECT id, stageNumber, title, estimatedHours, COALESCE(conceptId, coreConceptId) AS conceptId, status FROM milestones WHERE learningPathId = ? ORDER BY stageNumber'
  ).all(p.id);
  const stByMs = new Map();
  for (const m of ms) stByMs.set(m.id, []);
  const ph = ms.map(() => '?').join(',');
  if (ms.length) {
    const sts = db.prepare(
      `SELECT id, milestoneId, estimatedMinutes, status FROM subtasks WHERE milestoneId IN (${ph})`
    ).all(...ms.map((m) => m.id));
    for (const s of sts) stByMs.get(s.milestoneId)?.push(s);
  }
  const msHours = ms.reduce((a, m) => a + (Number(m.estimatedHours) || 0), 0);
  const stMinutes = [...stByMs.values()].flat().reduce((a, s) => a + (Number(s.estimatedMinutes) || 0), 0);
  const dead = ['failed', 'archived'].includes(String(p.status || ''));
  const ready = ms.length >= 1 && ms.every((m) => (stByMs.get(m.id) || []).length >= 1) && !dead;
  rows.push({
    persona: pid, user: prof.userId, presetKey: prof.presetKey,
    pathId: p.id, pathStatus: p.status, pathHours: Number(p.estimatedHours) || 0,
    milestones: ms.length,
    tasks: [...stByMs.values()].flat().length,
    conceptCoverage: ms.length ? +(ms.filter((m) => m.conceptId).length / ms.length).toFixed(3) : 0,
    ratioStageToPath: Number(p.estimatedHours) > 0 ? +(msHours / Number(p.estimatedHours)).toFixed(3) : null,
    ratioTasksToStage: msHours > 0 ? +(stMinutes / 60 / msHours).toFixed(3) : null,
    ready,
  });
}

const ok = rows.filter((r) => r.ready);
const r2 = ok.map((r) => r.ratioTasksToStage).filter((v) => v != null).sort((a, b) => a - b);
const median = r2.length ? +(r2[Math.floor(r2.length / 2)]).toFixed(3) : null;
const cov = ok.length ? +(ok.reduce((a, r) => a + r.conceptCoverage, 0) / ok.length).toFixed(3) : 0;
const minTasks = ok.length ? Math.min(...ok.map((r) => r.tasks)) : 0;
const checks = [
  { name: 'path就绪率≥0.9', value: ids.length ? +(ok.length / ids.length).toFixed(3) : 0, pass: ids.length > 0 && ok.length / ids.length >= 0.9 },
  { name: '守恒比2中位数∈[0.5,2]', value: median, pass: median != null && median >= 0.5 && median <= 2 },
  { name: '概念归属覆盖≥0.85', value: cov, pass: cov >= 0.85 },
  { name: '每path任务数≥3', value: minTasks, pass: minTasks >= 3 },
];
const pass = checks.every((c) => c.pass);
const report = { since: SINCE, total: ids.length, ready: ok.length, checks, pass, rows };
const text = JSON.stringify(report, null, 1);
if (OUT) fs.writeFileSync(path.resolve(ROOT, OUT), text);
console.log(text);
db.close();
process.exit(pass ? 0 : 1);
