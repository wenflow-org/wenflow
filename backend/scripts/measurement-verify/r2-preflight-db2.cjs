// R2 预检（修正版）：updatedAt=epoch ms 数值比较；VL 用完整 userId（来自实测会话行）。
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const NOW = Date.now();
const CUTOFF = NOW - 15 * 60 * 1000;
const ts = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() + ' (local ' + new Date(ms).toLocaleString('sv-SE') + ')' : String(ms));
console.log('== NOW ==', ts(NOW), ' cutoff15min =', ts(CUTOFF));

// 1) 最近 12 条：数值版 15 分钟旗标
console.log('\n== teaching_sessions ORDER BY updatedAt DESC LIMIT 12 (numeric flag) ==');
for (const r of db.prepare('SELECT id, userId, status, startTime, endTime, updatedAt, revision FROM teaching_sessions ORDER BY updatedAt DESC LIMIT 12').all()) {
  const flag = r.updatedAt >= CUTOFF ? '  <-- UPDATED_WITHIN_15MIN' : '';
  console.log(JSON.stringify({ ...r, startTimeHuman: ts(r.startTime), endTimeHuman: ts(r.endTime), updatedAtHuman: ts(r.updatedAt) }) + flag);
}

// 2) 6 VL 完整 userId（预检第一轮从实测会话行取得）
const VL = {
  'VL-1':  'ee52b287-29b4-4d0b-9995-303f13322f8c',
  'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
  'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
};
const ids = Object.values(VL);
const ph = ids.map(() => '?').join(',');
console.log('\n== users WHERE id IN (6 VL ids) ==');
for (const u of db.prepare('SELECT id, name, email, isVirtualLearner, createdAt, updatedAt FROM users WHERE id IN (' + ph + ')').all(...ids)) console.log(JSON.stringify(u));

console.log('\n== per-VL ALL sessions (status/id/startTime/endTime/msgCount) ==');
const msgCount = db.prepare('SELECT COUNT(*) AS cnt FROM teaching_session_messages WHERE sessionId = ?');
for (const [lesson, uid] of Object.entries(VL)) {
  const rows = db.prepare('SELECT id, status, startTime, endTime, updatedAt, revision FROM teaching_sessions WHERE userId = ? ORDER BY startTime DESC').all(uid);
  console.log(`-- ${lesson} ${uid}: ${rows.length} session(s)`);
  for (const s of rows) {
    console.log('   ' + JSON.stringify({ id: s.id, status: s.status, startTime: ts(s.startTime), endTime: ts(s.endTime), updatedAt: ts(s.updatedAt), revision: s.revision, msgCount: msgCount.get(s.id).cnt }));
  }
}

// 3) 全库非终态行归属：finalizing / paused / initializing
console.log('\n== non-terminal rows: finalizing / paused / initializing ==');
for (const r of db.prepare("SELECT id, userId, status, startTime, endTime, updatedAt FROM teaching_sessions WHERE status IN ('finalizing','paused','initializing') ORDER BY status, updatedAt DESC").all()) {
  console.log(JSON.stringify({ ...r, startTimeHuman: ts(r.startTime), updatedAtHuman: ts(r.updatedAt) }));
}
db.close();
