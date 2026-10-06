#!/usr/bin/env node
/** r1b-db-read.cjs — 测量验证轮只读 DB 查询 CLI。
 * 用法：node r1b-db-read.cjs '<sql>' [param1 param2 ...]
 * 纪律：只读打开 dev.db（WAL 多进程安全）；SQL 必须显式列名（teaching_sessions.messages
 * 是大列且已迁侧表，禁止 SELECT *）；外部输入一律 ? 参数绑定。
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..'); // backend/
const DB = path.join(ROOT, 'prisma', 'dev.db');

const sql = process.argv[2];
if (!sql) {
  console.error('usage: node r1b-db-read.cjs "<SELECT 显式列名 ...>" [params...]');
  process.exit(2);
}
if (!/^\s*select/i.test(sql) && !/^\s*pragma/i.test(sql)) {
  console.error('refused: 只允许 SELECT/PRAGMA');
  process.exit(2);
}
if (/\bselect\s+\*/i.test(sql)) {
  console.error('refused: 禁止 SELECT *，必须显式列名');
  process.exit(2);
}
const params = process.argv.slice(3);
const db = new DatabaseSync(DB, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
try {
  const rows = db.prepare(sql).all(...params);
  console.log(JSON.stringify(rows, null, 1));
} finally {
  db.close();
}
