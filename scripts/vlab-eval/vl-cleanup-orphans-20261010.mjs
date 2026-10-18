#!/usr/bin/env node
/** vl-cleanup-orphans-20261010.mjs — 删除无画像的孤儿虚拟学习者用户（vl-cleanup 的第二步）
 * 背景：batch-delete 端点只删「有画像」的账号（级联入口=profileId）；实测 460 个
 * isVirtualLearner=1 但无 virtual_learner_profiles 的孤儿用户（2026-10-01 v1 残留，
 * 数据足迹 ≤2 教学会话/类）。按 purge-pe-users.mjs 家法（显式表序 + 分块事务）直删。
 * 用法：node scripts/vlab-eval/vl-cleanup-orphans-20261010.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry');
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const MANIFEST = path.join(ROOT, 'doc', 'local', 'runs', '20261010', 'vl-evals', 'cleanup-manifest-20261010.json');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout=30000');
db.exec('PRAGMA foreign_keys=ON');

const orphans = db.prepare(
  'SELECT u.id, u.createdAt FROM users u LEFT JOIN virtual_learner_profiles p ON p.userId=u.id WHERE u.isVirtualLearner=1 AND p.id IS NULL'
).all();
console.log(`孤儿 VL 用户: ${orphans.length}`);
if (!orphans.length) { db.close(); process.exit(0); }
const ids = orphans.map((u) => u.id);

// 删除前足迹（进 manifest）
const FOOTPRINT = ['teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals',
  'learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records',
  'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger', 'domain_event_outbox',
  'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts', 'learning_metrics',
  'achievements', 'content_feedback', 'projection_access_grants',
  'concepts', 'concept_aliases', 'concept_edges',
  'user_agent_model_configs', 'user_agent_configs', 'user_api_configs', 'user_mcp_configs',
  'user_skill_configs', 'user_sessions', 'notifications', 'login_attempts', 'password_reset_tokens'];
const ph = ids.map(() => '?').join(',');
const footprint = {};
for (const t of FOOTPRINT) {
  const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE userId IN (${ph})`).get(...ids).n;
  if (n > 0) footprint[t] = n;
}
console.log('足迹:', JSON.stringify(footprint));
if (DRY) { db.close(); process.exit(0); }

const CHUNK = 40;
const perTable = {};
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const cph = chunk.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    for (const t of FOOTPRINT) {
      const r = db.prepare(`DELETE FROM ${t} WHERE userId IN (${cph})`).run(...chunk);
      perTable[t] = (perTable[t] || 0) + r.changes;
    }
    const r2 = db.prepare(`DELETE FROM users WHERE id IN (${cph})`).run(...chunk);
    perTable.users = (perTable.users || 0) + r2.changes;
    db.exec('COMMIT');
    console.log(`chunk ${Math.floor(i / CHUNK) + 1}: ok (${Math.min(i + CHUNK, ids.length)}/${ids.length})`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('块失败，已回滚:', e.message.slice(0, 200));
    db.close();
    process.exit(1);
  }
}

// 回写主 manifest 的 orphans 段
try {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  m.orphans = { at: new Date().toISOString(), users: ids.length, footprint, perTable };
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
} catch { /* manifest 缺失不阻塞 */ }

const left = db.prepare('SELECT COUNT(*) n FROM users u LEFT JOIN virtual_learner_profiles p ON p.userId=u.id WHERE u.isVirtualLearner=1 AND p.id IS NULL').get().n;
const vlLeft = db.prepare('SELECT COUNT(*) n FROM users WHERE isVirtualLearner=1').get().n;
db.close();
console.log(`验证: 剩余孤儿 ${left}｜剩余 VL 用户 ${vlLeft}`);
console.log('完成');
