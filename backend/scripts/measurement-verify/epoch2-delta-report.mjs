/**
 * 纪元 2 · 理解度 Δ 基线报告（只读，机械口径，无 LLM）。
 * 用法：node backend/scripts/measurement-verify/epoch2-delta-report.mjs \
 *         --ids-file=<personaId 清单> --since=<ms 时间窗起点> [--out=<md 路径>]
 * 口径（同 r6post-eval.mjs mechUnderstanding）：
 *   每会话 understanding 序列取 teaching_session_messages.payload.analysis.understanding；
 *   Δ = 后半段均值 − 前半段均值（前后半差）；<2 个观测点的会话不计。
 * 聚合：逐会话 Δ → 逐人均 Δ（每人多课）→ 总体均值/中位数/正增长占比。
 * 退出码恒 0（测量报告，非门禁）。
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

// r6post 同款：前后半差
const halfDelta = (series) => {
  if (series.length < 2) return null;
  const half = Math.floor(series.length / 2) || 1;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return +(avg(series.slice(half)) - avg(series.slice(0, half))).toFixed(3);
};

const lessons = [];
for (const pid of ids) {
  const prof = findByPersona(pid);
  if (!prof) { lessons.push({ persona: pid, error: 'profile 未找到' }); continue; }
  const sess = db.prepare(
    'SELECT id, status, subject, topic, startTime, wrapup IS NOT NULL AND length(wrapup)>0 AS hasWrapup FROM teaching_sessions WHERE userId = ? AND createdAt >= ? ORDER BY startTime'
  ).all(prof.userId, SINCE);
  for (const s of sess) {
    const msgs = db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY id').all(s.id);
    const series = [];
    for (const m of msgs) {
      try {
        const p = JSON.parse(m.payload);
        if (p && p.analysis && typeof p.analysis.understanding === 'number') series.push(p.analysis.understanding);
      } catch { /* 跳过坏行 */ }
    }
    lessons.push({
      persona: pid, sessionId: s.id, status: s.status,
      subject: s.subject || '', topic: String(s.topic || '').slice(0, 40),
      turns: msgs.length, pts: series.length,
      first: series.length >= 2 ? +(series.slice(0, Math.floor(series.length / 2) || 1).reduce((a, b) => a + b, 0) / (Math.floor(series.length / 2) || 1)).toFixed(3) : null,
      delta: halfDelta(series),
      hasWrapup: Boolean(s.hasWrapup),
    });
  }
}

const ok = lessons.filter((l) => l.delta != null);
const deltas = ok.map((l) => l.delta).sort((a, b) => a - b);
const mean = deltas.length ? +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(3) : null;
const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
const pos = ok.filter((l) => l.delta > 0).length;
// 逐人均 Δ（每人多课取均值）
const byPersona = new Map();
for (const l of ok) {
  if (!byPersona.has(l.persona)) byPersona.set(l.persona, []);
  byPersona.get(l.persona).push(l.delta);
}
const perPersona = [...byPersona.entries()].map(([pid, ds]) => ({
  persona: pid, lessons: ds.length,
  meanDelta: +(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(3),
})).sort((a, b) => b.meanDelta - a.meanDelta);

const md = [
  '# 纪元 2 · 理解度 Δ 基线报告',
  '',
  `- 时间窗：since=${SINCE}；目标 ${ids.length} 人，实际出课会话 ${lessons.length} 节（可算 Δ ${ok.length} 节）`,
  `- 总体：均值 ${mean}，中位数 ${median}，正增长 ${pos}/${ok.length}`,
  `- 逐人均 Δ：${perPersona.map((p) => `${p.persona}(${p.lessons}课 ${p.meanDelta >= 0 ? '+' : ''}${p.meanDelta})`).join('，') || '（无）'}`,
  '',
  '| persona | 课 | 状态 | 轮数 | 观测点 | 前半 | Δ | wrapup |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...lessons.map((l) => l.error
    ? `| ${l.persona} | ERR ${l.error} | | | | | | |`
    : `| ${l.persona} | ${String(l.sessionId).slice(-8)} | ${l.status} | ${l.turns} | ${l.pts} | ${l.first ?? '—'} | ${l.delta != null ? (l.delta >= 0 ? '+' : '') + l.delta : '—'} | ${l.hasWrapup ? '有' : '无'} |`),
].join('\n');
if (OUT) fs.writeFileSync(path.resolve(ROOT, OUT), md);
console.log(md);
console.log('\n[json]', JSON.stringify({ total: ids.length, sessions: lessons.length, computable: ok.length, mean, median, positive: pos }, null, 0));
db.close();
process.exit(0);
