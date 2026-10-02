#!/usr/bin/env node
/** dedupe-vl.mjs — 虚拟学习者去重：同名（users.name）多行时保留画像最全的行（scenarioCard > seed 键数多），
 * 其余按清理顺序级联删除。幂等，可随时跑。用法：node scripts/vlab-eval/dedupe-vl.mjs [--dry] */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'));
db.exec('PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON;');

const rows = db.prepare("SELECT u.name, p.id, p.userId, p.presetKey, p.profile FROM virtual_learner_profiles p JOIN users u ON p.userId = u.id").all();
const byName = new Map();
for (const r of rows) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }

const score = (r) => {
  let keys = 0, card = 0;
  try { const s = (JSON.parse(r.profile) || {}).personaSeed || {}; keys = Object.keys(s).length; card = s.scenarioCard ? 1 : 0; } catch { }
  return card * 1000 + keys;
};
const ORDER = ['learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records', 'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger', 'domain_event_outbox', 'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts', 'teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals', 'learning_metrics', 'achievements', 'content_feedback', 'projection_access_grants'];

let removed = 0;
for (const [name, list] of byName) {
  if (list.length < 2) continue;
  list.sort((a, b) => score(b) - score(a));
  const keep = list[0], drop = list.slice(1);
  console.log(`${name}: 保留 ${keep.id}（分 ${score(keep)}），删除 ${drop.length} 行`);
  if (DRY) continue;
  db.exec('BEGIN');
  try {
    for (const d of drop) {
      db.prepare('DELETE FROM virtual_sessions WHERE virtualProfileId=?').run(d.id);
      for (const t of ORDER) db.prepare('DELETE FROM ' + t + ' WHERE userId=?').run(d.userId);
      db.prepare('DELETE FROM virtual_learner_profiles WHERE id=?').run(d.id);
      db.prepare('DELETE FROM users WHERE id=?').run(d.userId);
      removed++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error('回滚:', e.message.slice(0, 120)); process.exit(1); }
}
console.log(DRY ? '[dry] 完成（未删除）' : `去重完成，删除 ${removed} 行`);
db.close();
