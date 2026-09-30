#!/usr/bin/env node
/**
 * 一次性回灌：teaching_sessions.messages 旧列 → teaching_session_messages 侧表。
 *
 * 背景（2026-10-01 页面性能优化实测）：messages 列均摊 ~499KB/行（573 行合计 246MB），
 * 内联在热表里——任何碰 teaching_sessions 的查询（哪怕 SELECT id ORDER BY createdAt）
 * 都要扫过这些溢出页，实测列表基础扫描 3.5s，是管理台教学会话页与驾驶舱慢的根因。
 * 侧表与双读/惰性播种（teaching-session-message-store.ts ensureTeachingMessagesSeeded）
 * 早已上线，但播种只在会话被写到时发生——149 条只读历史会话永远留在旧列。
 *
 * 本脚本把惰性播种改成主动全量：转换逻辑与 store 的 toRows/parseLegacyColumn 完全一致
 * （仅保留 object 元素、payload = JSON.stringify(message)），灌入侧表后置 messages = NULL
 * （与 store 播种成功后的处置相同）。幂等：只处理「无侧表行且 messages 为合法数组」的会话，
 * 重复执行零效果。执行后列表查询不再触发 json_each 回退分支，基础扫描回到毫秒级。
 *
 * 用法：node scripts/backfill-teaching-messages-side-table.mjs
 * 并发：busy_timeout 5s（dev 后端持库时也可安全执行）。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, '..', 'prisma', 'dev.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000');

const targets = db
  .prepare(
    `SELECT s.id, s.messages
     FROM teaching_sessions s
     WHERE s.messages IS NOT NULL
       AND json_valid(s.messages)
       AND json_type(s.messages) = 'array'
       AND NOT EXISTS (SELECT 1 FROM teaching_session_messages m WHERE m.sessionId = s.id)`
  )
  .all();

console.log(`待回灌旧会话：${targets.length} 条`);
if (!targets.length) {
  console.log('无需回灌，退出。');
  process.exit(0);
}

const insert = db.prepare(
  'INSERT INTO teaching_session_messages (sessionId, payload) VALUES (?, ?)'
);
const clear = db.prepare('UPDATE teaching_sessions SET messages = NULL WHERE id = ?');

let sessionsDone = 0;
let rowsInserted = 0;
let bytesFreed = 0;

const migrateSession = (row) => {
  const messages = JSON.parse(row.messages);
  const objs = (messages || []).filter((m) => m && typeof m === 'object');
  db.exec('BEGIN');
  try {
    for (const m of objs) insert.run(row.id, JSON.stringify(m));
    bytesFreed += row.messages.length;
    clear.run(row.id);
    db.exec('COMMIT');
    sessionsDone += 1;
    rowsInserted += objs.length;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

for (const row of targets) {
  try {
    migrateSession(row);
  } catch (e) {
    console.error(`会话 ${row.id} 回灌失败（跳过，不影响其它）:`, e.message);
  }
}

console.log(
  `回灌完成：${sessionsDone}/${targets.length} 个会话，插入侧表 ${rowsInserted} 行，` +
    `旧列释放 ${Math.round(bytesFreed / 1024 / 1024)}MB。`
);
console.log(
  '（可选）空间回收需 VACUUM（重写整库文件，dev 环境可不做——已释放页不参与查询扫描）。'
);
