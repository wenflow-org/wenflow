#!/usr/bin/env node
/** purge-pe-users.mjs — 彻底删除 pe-* 脚本测试账号及其全部数据（2026-10-01 用户拍板"彻底删除"）。
 * 删除顺序镜像 virtual-cleanup.service.ts（FK 级联清 milestones/subtasks/teaching messages 等）。
 *
 * 安全加固（审计 2026-10-12）：
 *   - 默认只列清单（dry）；真正删除必须显式 --yes；
 *   - 删除前 VACUUM INTO 备份 + 写 manifest（崩溃也留证据）；
 *   - 匹配用 GLOB 'pe-*'（大小写敏感，避免误伤 PE- 或 Pe- 开头的名字）+ 禁删 admin（isAdmin=0 断言）；
 *   - 复核后若有残留 → 非零退出。
 * 用法：node scripts/vlab-eval/purge-pe-users.mjs [--yes]   （不带 --yes 即 dry-run 列清单） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = !process.argv.includes('--yes');
const OUT_DIR = path.join(ROOT, 'doc/local/runs/voided-20261001');
const DB_PATH = path.join(ROOT, 'backend/prisma/dev.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout=30000;');
db.exec('PRAGMA foreign_keys=ON;');

// GLOB 大小写敏感（LIKE 对 ASCII 不敏感会误伤 PE-*/Pe-*）；禁删 admin。
const users = db.prepare("SELECT id, name, isAdmin, isVirtualLearner FROM users WHERE name GLOB 'pe-*'").all();
const admins = users.filter((u) => u.isAdmin === 1);
console.log(`pe-* 用户: ${users.length}（其中 isAdmin=1: ${admins.length}）`);
if (admins.length) { console.error('FATAL: 命中管理员账号，拒绝继续', admins.map((u) => u.name)); db.close(); process.exit(1); }
if (!users.length) { db.close(); process.exit(0); }
const ids = users.map((u) => u.id);
const ph0 = ids.map(() => '?').join(',');

const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE userId IN (${ph0})`).get(...ids).n;

if (DRY) {
  const snap = { at: new Date().toISOString(), dry: true, users: users.length, names: users.slice(0, 20).map((u) => u.name) };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'purge-manifest.dry.json'), JSON.stringify(snap, null, 1));
  console.log('dry-run：仅列清单，未删任何数据。加 --yes 执行删除。manifest → doc/local/runs/voided-20261001/purge-manifest.dry.json');
  db.close();
  process.exit(0);
}

// 备份（删真实 users 行前必须有回滚点）
const backupPath = path.join(OUT_DIR, `dev-backup-purge-${Date.now()}.db`);
fs.mkdirSync(OUT_DIR, { recursive: true });
{
  const w = new DatabaseSync(DB_PATH);
  w.exec('PRAGMA busy_timeout=30000;');
  w.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
  w.close();
  console.log('备份 → ' + backupPath);
}

const before = {
  learning_paths: count('learning_paths'),
  teaching_sessions: count('teaching_sessions'),
  goal_conversations: count('goal_conversations'),
};

// 先写 manifest（崩溃也留取证），删除中持续更新
const MANIFEST = path.join(OUT_DIR, 'purge-manifest.json');
const ORDER = [
  'learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records',
  'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger',
  'domain_event_outbox', 'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts',
  'teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals',
  'learning_metrics', 'achievements', 'content_feedback', 'projection_access_grants',
];
const manifest = { at: new Date().toISOString(), dry: false, users: users.length, backup: backupPath, before, perTable: {} };
const writeManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
writeManifest();

const CHUNK = 40;
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const ph = chunk.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    for (const t of ORDER) {
      const r = db.prepare(`DELETE FROM ${t} WHERE userId IN (${ph})`).run(...chunk);
      manifest.perTable[t] = (manifest.perTable[t] || 0) + r.changes;
    }
    const r2 = db.prepare(`DELETE FROM users WHERE id IN (${ph}) AND isAdmin = 0`).run(...chunk);
    manifest.perTable.users = (manifest.perTable.users || 0) + r2.changes;
    db.exec('COMMIT');
    writeManifest();
    console.log(`chunk ${i / CHUNK + 1}: ok (${Math.min(i + CHUNK, ids.length)}/${ids.length})`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('块失败，已回滚:', String(e.message).slice(0, 200));
    manifest.aborted = true; writeManifest();
    db.close();
    process.exit(1);
  }
}

const left = db.prepare("SELECT COUNT(*) n FROM users WHERE name GLOB 'pe-*'").get().n;
manifest.leftUsers = left;
writeManifest();
console.log('剩余 pe-*:', left, '| manifest → doc/local/runs/voided-20261001/purge-manifest.json');
db.close();
if (left > 0) { console.error(`FATAL: 仍有 ${left} 个 pe-* 未删净，非零退出`); process.exit(1); }
