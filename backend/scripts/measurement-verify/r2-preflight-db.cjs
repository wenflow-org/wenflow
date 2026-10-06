// R2 预检：DB 只读核查（第二轮夜跑·预检员）
// 只读：readOnly + busy_timeout=5000；显式列名；参数绑定。不改任何数据。
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const NOW = new Date();
console.log('== NOW(wall) ==', NOW.toISOString(), '| local:', NOW.toString());

// 0) updatedAt 存储形态抽样
console.log('\n== updatedAt raw sample (top3 by updatedAt DESC) ==');
for (const r of db.prepare('SELECT id, updatedAt FROM teaching_sessions ORDER BY updatedAt DESC LIMIT 3').all()) {
  console.log(JSON.stringify(r));
}

// 1) teaching_sessions 最近 12 条（显式列）
console.log('\n== teaching_sessions ORDER BY updatedAt DESC LIMIT 12 ==');
const recent = db.prepare('SELECT id, userId, status, startTime, endTime, updatedAt, revision FROM teaching_sessions ORDER BY updatedAt DESC LIMIT 12').all();
const cutoff = NOW.getTime() - 15 * 60 * 1000;
for (const r of recent) {
  const t = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
  const flag = Number.isFinite(t) && t >= cutoff ? '  <-- UPDATED_WITHIN_15MIN' : '';
  console.log(JSON.stringify(r) + flag);
}

// 2) 6 个 VL 用户映射
const NAMES = ['vl-r1-mid-01', 'vl-r1b-01-strong', 'vl-r1b-02-strong', 'vl-r1b-03-weak', 'vl-r1b-04-weak', 'vl-r1b-05-mid'];
console.log('\n== users WHERE name IN (6 VL names) ==');
const ph = NAMES.map(() => '?').join(',');
const users = db.prepare(`SELECT id, name, isVirtualLearner, createdAt, updatedAt FROM users WHERE name IN (${ph}) AND deletedAt IS NULL`).all(...NAMES);
for (const u of users) console.log(JSON.stringify(u));
const idByLesson = {};
for (const u of users) idByLesson[u.name] = u.id;

// 3) 每个 VL 名下全部会话状态分布 + active/finalizing 残会（显式列）
console.log('\n== per-VL sessions: status distribution ==');
const statusDist = db.prepare('SELECT userId, status, COUNT(*) AS cnt FROM teaching_sessions WHERE userId IN (' + ph + ') GROUP BY userId, status ORDER BY userId, status').all(...Object.values(idByLesson));
for (const r of statusDist) console.log(JSON.stringify(r));

console.log('\n== per-VL active/finalizing sessions ==');
const msgCount = db.prepare('SELECT COUNT(*) AS cnt FROM teaching_session_messages WHERE sessionId = ?');
const firstLastMsg = db.prepare('SELECT MIN(createdAt) AS firstMsg, MAX(createdAt) AS lastMsg FROM teaching_session_messages WHERE sessionId = ?');
for (const [lesson, uid] of Object.entries(idByLesson)) {
  const rows = db.prepare("SELECT id, status, startTime, endTime, updatedAt, revision FROM teaching_sessions WHERE userId = ? AND status IN ('active','finalizing') ORDER BY startTime DESC").all(uid);
  if (rows.length === 0) { console.log(`${lesson} ${uid}: (no active/finalizing session)`); continue; }
  for (const s of rows) {
    const mc = msgCount.get(s.id).cnt;
    const fl = firstLastMsg.get(s.id);
    console.log(`${lesson} ${uid}: ${JSON.stringify({ ...s, msgCount: mc, firstMsg: fl.firstMsg, lastMsg: fl.lastMsg })}`);
  }
}

// 4) 全库 status 分布（近期上下文，帮助判断僵尸回收是否动过 R1 残会）
console.log('\n== teaching_sessions status distribution (whole table) ==');
for (const r of db.prepare('SELECT status, COUNT(*) AS cnt FROM teaching_sessions GROUP BY status ORDER BY cnt DESC').all()) console.log(JSON.stringify(r));
db.close();
