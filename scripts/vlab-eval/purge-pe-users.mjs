#!/usr/bin/env node
/** purge-pe-users.mjs — 彻底删除 pe-* 脚本测试账号及其全部数据（2026-10-01 用户拍板"彻底删除"）。
 * 删除顺序镜像 virtual-cleanup.service.ts（FK 级联清 milestones/subtasks/teaching messages 等）。
 * 用法：node scripts/vlab-eval/purge-pe-users.mjs [--dry] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry');
const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'));
db.exec('PRAGMA busy_timeout=30000;');
db.exec('PRAGMA foreign_keys=ON;');

const users = db.prepare("SELECT id, name FROM users WHERE name LIKE 'pe-%'").all();
console.log(`pe-* 用户: ${users.length}`);
if (!users.length) { db.close(); process.exit(0); }
const ids = users.map((u) => u.id);

// 删除前快照（计数证据，写入 manifest）
const count = (sql) => db.prepare(sql).get(...ids).n;
const before = {
  learning_paths: count('SELECT COUNT(*) n FROM learning_paths WHERE userId IN (%s)'.replace('%s', ids.map(() => '?').join(','))),
  teaching_sessions: count('SELECT COUNT(*) n FROM teaching_sessions WHERE userId IN (%s)'.replace('%s', ids.map(() => '?').join(','))),
  goal_conversations: count('SELECT COUNT(*) n FROM goal_conversations WHERE userId IN (%s)'.replace('%s', ids.map(() => '?').join(','))),
};

// 按用户分块事务，块内按 virtual-cleanup 的依赖顺序删
const ORDER = [
  'learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records',
  'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger',
  'domain_event_outbox', 'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts',
  'teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals',
  'learning_metrics', 'achievements', 'content_feedback', 'projection_access_grants',
];
const CHUNK = 40;
const manifest = { at: new Date().toISOString(), users: users.length, before, perTable: {} };
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const ph = chunk.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    for (const t of ORDER) {
      const r = db.prepare(`DELETE FROM ${t} WHERE userId IN (${ph})`).run(...chunk);
      manifest.perTable[t] = (manifest.perTable[t] || 0) + r.changes;
    }
    const r2 = db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...chunk);
    manifest.perTable.users = (manifest.perTable.users || 0) + r2.changes;
    db.exec('COMMIT');
    console.log(`chunk ${i / CHUNK + 1}: ok (${Math.min(i + CHUNK, ids.length)}/${ids.length})`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('块失败，已回滚:', e.message.slice(0, 200));
    fs.writeFileSync(path.join(ROOT, 'doc/local/runs/voided-20261001/purge-manifest-partial.json'), JSON.stringify(manifest, null, 1));
    db.close();
    process.exit(1);
  }
}

// 复核
const left = db.prepare("SELECT COUNT(*) n FROM users WHERE name LIKE 'pe-%'").get().n;
manifest.leftUsers = left;
fs.mkdirSync(path.join(ROOT, 'doc/local/runs/voided-20261001'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'doc/local/runs/voided-20261001/purge-manifest.json'), JSON.stringify(manifest, null, 1));
console.log('剩余 pe-*:', left, '| manifest → doc/local/runs/voided-20261001/purge-manifest.json');
db.close();
