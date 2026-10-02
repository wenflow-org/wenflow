#!/usr/bin/env node
/** exec-vl-dedupe.mjs — 执行 LLM 判读裁决的 VL 去重（2026-10-01）。
 * drop 名单来自 5 子代理分片判读 + 同源裁决 + 主会话实证；按名字解析 id；
 * 保护：任何 drop 候选若 sessionCount>0 则跳过并报警（绝不动在跑会话）。
 * 用法：node scripts/vlab-eval/exec-vl-dedupe.mjs [--dry] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DRY = process.argv.includes('--dry');

// keep → drop 对照（LLM 判读裁决，含冲突裁决与教材差异保护）
const PAIRS = [
  // 批次1 career/acad（A1）
  ['rw-career-02', ['rw-career5-02']], ['rw-career-03', ['rw-career5-13']],
  ['rw-career-05', ['rw-career5-03', 'rw-career5-40']], ['rw-career5-04', ['rw-career-04']],
  ['rw-career-06', ['rw-career5-23']], ['rw-career-12', ['rw-career5-06']], ['rw-career-01', ['rw-career5-01']],
  ['rw-career-11', ['rw-career5-45']],
  ['rw-acad-09', ['rw-acad5-07', 'rw-acad6-01']], ['rw-acad-10', ['rw-acad5-32']],
  ['rw-acad-01', ['rw-acad5-10']], ['rw-acad5-01', ['rw-acad-02']], ['rw-acad-04', ['rw-acad5-12']],
  // 批次2 exam/career（A2）
  ['rw-exam-01', ['rw-exam5-02']], ['rw-exam5-06', ['rw-exam-02']], ['rw-exam-03', ['rw-exam5-11']],
  ['rw-exam-04', ['rw-exam5-14']], ['rw-exam-08', ['rw-exam5-26']], ['rw-exam-11', ['rw-exam5-29']],
  ['rw-exam-14', ['rw-exam5-46']], ['rw-career6-18', ['rw-career5-59']],
  // 批次3 兴趣/生活（A3 同源实证）
  ['rw-life-02', ['rw-int5-01']], ['rw-life-04', ['rw-int5-07']], ['rw-life-03', ['rw-int5-08', 'rw-int6-02']],
  ['rw-life-07', ['rw-int5-09']], ['rw-life-08', ['rw-exam5-64']], ['rw-int6-09', ['rw-int5-04']],
  ['rw-life-05', ['rw-int6-01']], ['rw-int5-25', ['rw-int6-04']], ['rw-int5-02', ['rw-life-01']],
  // 批次4 school（A1 同源裁决）
  ['rw-school5-01', ['rw-school-27']],
  // 批次5 school 大族（A5，会话优先；school6-* 全为 keep）
  ['rw-school6-12', ['rw-school-24', 'rw-school-31', 'rw-school5-24']],
  ['rw-school6-19', ['rw-school5-52']],
  ['rw-school-32', ['rw-school5-28']],
  ['rw-school5-21', ['rw-school-30']],
  ['rw-school-06', ['rw-school5-26']],
  ['rw-school-09', ['rw-school5-41']],
  ['rw-school-38', ['rw-school5-47']],
  ['rw-school-10', ['rw-school5-49']],
  ['rw-school5-53', ['rw-school-37']],
  ['rw-school-39', ['rw-school5-57']],
  ['rw-school-22', ['rw-school5-60']],
  ['rw-school-21', ['rw-school5-62', 'rw-school6-27']],
  ['rw-school-08', ['rw-school-34', 'rw-school5-36', 'rw-school5-37']],
  ['rw-school6-21', ['rw-school5-46']],
  ['rw-school6-10', ['rw-school-07', 'rw-school5-23']],
  ['rw-school6-09', ['rw-school-03']],
  ['rw-school6-03', ['rw-school-28']],
  // 预设撞名（保留内置预设）
  ['周敏', ['rw-exam6-10']], ['韩磊', ['rw-exam5-51']],
  // 跨类别（A5）
  ['rw-wild-05', ['rw-career5-37']],
];

const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'));
db.exec('PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON;');
const byName = new Map();
for (const r of db.prepare('SELECT u.name, p.id, p.userId FROM virtual_learner_profiles p JOIN users u ON p.userId = u.id').all()) byName.set(r.name, r);
const sessions = (pid) => db.prepare('SELECT COUNT(*) n FROM virtual_sessions WHERE virtualProfileId=?').get(pid).n;

const drops = [];
const problems = [];
for (const [keep, dropNames] of PAIRS) {
  if (!byName.has(keep)) problems.push(`keep 不存在: ${keep}`);
  for (const name of dropNames) {
    const row = byName.get(name);
    if (!row) { problems.push(`drop 不存在（可能已删）: ${name}`); continue; }
    const sc = sessions(row.id);
    if (sc > 0) { problems.push(`跳过 ${name}：有 ${sc} 个会话（保护）`); continue; }
    drops.push({ name, ...row });
  }
}
console.log(`待删 ${drops.length} 个（保护跳过 ${problems.filter((p) => p.includes('保护')).length} 个，问题 ${problems.filter((p) => !p.includes('保护')).length} 条）`);
for (const p of problems) console.log('  !', p);
if (DRY) { console.log('[dry] 名单:', drops.map((d) => d.name).join(', ')); db.close(); process.exit(0); }

const ORDER = ['learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records', 'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger', 'domain_event_outbox', 'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts', 'teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals', 'learning_metrics', 'achievements', 'content_feedback', 'projection_access_grants'];
const manifest = { at: new Date().toISOString(), pairs: PAIRS.length, dropped: [], skipped: problems };
db.exec('BEGIN');
try {
  for (const d of drops) {
    db.prepare('DELETE FROM virtual_sessions WHERE virtualProfileId=?').run(d.id);
    for (const t of ORDER) db.prepare('DELETE FROM ' + t + ' WHERE userId=?').run(d.userId);
    db.prepare('DELETE FROM virtual_learner_profiles WHERE id=?').run(d.id);
    db.prepare('DELETE FROM users WHERE id=?').run(d.userId);
    manifest.dropped.push(d.name);
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); console.error('回滚:', e.message.slice(0, 150)); db.close(); process.exit(1); }
const left = db.prepare('SELECT COUNT(*) n FROM virtual_learner_profiles').get().n;
manifest.leftProfiles = left;
fs.writeFileSync(path.join(ROOT, 'doc/local/runs/20261001/vl-dedupe-executed.json'), JSON.stringify(manifest, null, 1));
console.log(`删除完成 ${manifest.dropped.length} 个，VL 库剩余 ${left}`);
db.close();
