#!/usr/bin/env node
/**
 * 一次性清洗：教学会话开场消息尾巴上的字面量 "undefined"（2026-10-11 走查）。
 *
 * 成因：`startSession` 曾用裸模板 `${opening.message}\n\n${opening.question}` 拼开场正文，
 * 而 `question` 是可选字段（与 quickReplies 互斥；确定性兜底 buildDeterministicOpening 只给 quickReplies）
 * ⇒ 落库消息尾部多出 "\n\nundefined"，学习者开课第一句话就能看到。
 * 代码侧已改为 composeWelcome（services/ai-teaching/teaching-session-views.ts）；
 * 本脚本收尾存量数据。
 *
 * 形态唯一性（本脚本执行前先校验）：108/108 行命中，全部匹配 /\n\nundefined$/，无中间态、无整条等于 undefined。
 * 任何一行不符合该形态即中止，不做模糊替换。
 *
 * 用法（默认 dry-run，不改库）：
 *   node backend/scripts/fix-undefined-opening-20261011.cjs
 *   node backend/scripts/fix-undefined-opening-20261011.cjs --apply
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = process.env.DATABASE_PATH || path.join(REPO_ROOT, 'backend', 'prisma', 'dev.db');
const BACKUP_PATH = path.join(REPO_ROOT, 'doc', 'local', 'undefined-opening-backup-20261011.json');
const APPLY = process.argv.includes('--apply');
const TAIL = '\n\nundefined';

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });
db.exec('PRAGMA busy_timeout = 8000');

const rows = db
  .prepare(
    `SELECT id, sessionId, payload FROM teaching_session_messages
     WHERE json_valid(payload) AND json_extract(payload, '$.content') LIKE '%undefined%'
     ORDER BY id`
  )
  .all();

if (rows.length === 0) {
  console.log('没有需要清洗的行（已完成）。');
  process.exit(0);
}

const plan = [];
for (const row of rows) {
  const payload = JSON.parse(String(row.payload));
  const content = String(payload.content ?? '');
  if (!content.endsWith(TAIL)) {
    console.error(`形态不符，中止：id=${row.id} 结尾=${JSON.stringify(content.slice(-40))}`);
    process.exit(1);
  }
  payload.content = content.slice(0, -TAIL.length).trimEnd();
  plan.push({ id: row.id, sessionId: row.sessionId, before: content, after: payload.content, payload: JSON.stringify(payload) });
}

const sessions = new Set(plan.map((p) => p.sessionId));
console.log(`命中 ${plan.length} 行 / ${sessions.size} 个会话`);
console.log('样例 before→after：');
for (const item of plan.slice(0, 2)) {
  console.log(`  …${JSON.stringify(item.before.slice(-46))} → …${JSON.stringify(item.after.slice(-44))}`);
}

if (!APPLY) {
  console.log('\nDRY-RUN：未改库。加 --apply 执行（会先写备份）。');
  process.exit(0);
}

fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
fs.writeFileSync(
  BACKUP_PATH,
  JSON.stringify({ createdAt: new Date().toISOString(), db: DB_PATH, rows: plan.map(({ id, sessionId, before }) => ({ id, sessionId, payload: JSON.stringify({ content: before }) })) }, null, 2)
);
console.log(`备份已写：${BACKUP_PATH}`);

const update = db.prepare('UPDATE teaching_session_messages SET payload = ? WHERE id = ?');
db.exec('BEGIN');
try {
  for (const item of plan) update.run(item.payload, item.id);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();

const check = new DatabaseSync(DB_PATH, { readOnly: true });
const left = check
  .prepare(`SELECT COUNT(*) AS n FROM teaching_session_messages WHERE json_valid(payload) AND json_extract(payload, '$.content') LIKE '%undefined%'`)
  .get().n;
const total = check.prepare('SELECT COUNT(*) AS n FROM teaching_session_messages').get().n;
console.log(`已更新 ${plan.length} 行；全表 ${total} 行中残留含 undefined 的行：${left}`);
