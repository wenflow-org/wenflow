// 跨日推进 · 盘点：6 个 R1 VL 的 profile/session/memory_traces 现状（只读）
// 纪律：readOnly + busy_timeout=5000；显式列名；参数绑定；不写库。
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const VL = {
  'VL-1': 'ee52b287-29b4-4d0b-9995-303f13322f8c',
  'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
  'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
};
const ids = Object.values(VL);
const ph = ids.map(() => '?').join(',');
const ts = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms));

// 0) 用户行核对
console.log('== users ==');
for (const u of db.prepare(`SELECT id, name, email, isVirtualLearner FROM users WHERE id IN (${ph})`).all(...ids))
  console.log(JSON.stringify(u));

// 1) profile 映射 + profile JSON 里的 simulationClock
console.log('\n== virtual_learner_profiles (id,userId) + profile.simulationClock ==');
const profiles = db.prepare(`SELECT id, userId, knowledgeLevel, createdAt, updatedAt FROM virtual_learner_profiles WHERE userId IN (${ph})`).all(...ids);
const profileIdByUser = {};
for (const p of profiles) {
  profileIdByUser[p.userId] = p.id;
  const prof = JSON.parse(db.prepare('SELECT profile AS j FROM virtual_learner_profiles WHERE id = ?').get(p.id).j || '{}');
  console.log(JSON.stringify({ userId: p.userId, profileId: p.id, knowledgeLevel: p.knowledgeLevel, simulationClock: prof.simulationClock ?? null }));
}

// 2) virtual_sessions per profile：status + stageResults.simulationClock
console.log('\n== virtual_sessions per profile ==');
const vsByProfile = db.prepare('SELECT id, status, currentStage, stageResults, createdAt, updatedAt FROM virtual_sessions WHERE virtualProfileId = ? ORDER BY createdAt DESC');
for (const [lesson, uid] of Object.entries(VL)) {
  const pid = profileIdByUser[uid];
  if (!pid) { console.log(`${lesson} ${uid}: (no profile)`); continue; }
  const rows = vsByProfile.all(pid);
  console.log(`-- ${lesson} user=${uid} profile=${pid}: ${rows.length} vsession(s)`);
  for (const s of rows) {
    let clock = null;
    try { clock = JSON.parse(s.stageResults || '{}')?.simulationClock ?? null; } catch {}
    console.log('   ' + JSON.stringify({ id: s.id, status: s.status, stage: s.currentStage, clock, createdAt: ts(s.createdAt), updatedAt: ts(s.updatedAt) }));
  }
}

// 3) teaching_sessions per user：全部行
console.log('\n== teaching_sessions per VL ==');
const tses = db.prepare('SELECT id, status, startTime, endTime, updatedAt, revision FROM teaching_sessions WHERE userId = ? ORDER BY startTime DESC');
const msgCount = db.prepare('SELECT COUNT(*) AS cnt FROM teaching_session_messages WHERE sessionId = ?');
for (const [lesson, uid] of Object.entries(VL)) {
  const rows = tses.all(uid);
  console.log(`-- ${lesson} ${uid}: ${rows.length} session(s)`);
  for (const s of rows)
    console.log('   ' + JSON.stringify({ id: s.id, status: s.status, start: ts(s.startTime), end: ts(s.endTime), updatedAt: ts(s.updatedAt), rev: s.revision, msgs: msgCount.get(s.id).cnt }));
}

// 4) memory_traces per user
console.log('\n== memory_traces per VL ==');
const mts = db.prepare('SELECT conceptKey, label, masteryScore, stability, lastSeenAt, extractionCount, dueAt, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, ktMasteryEma, source, updatedAt FROM memory_traces WHERE userId = ? ORDER BY updatedAt DESC');
for (const [lesson, uid] of Object.entries(VL)) {
  const rows = mts.all(uid);
  console.log(`-- ${lesson} ${uid}: ${rows.length} trace(s)`);
  for (const r of rows)
    console.log('   ' + JSON.stringify({ ...r, lastSeenAt: ts(r.lastSeenAt), dueAt: ts(r.dueAt), updatedAt: ts(r.updatedAt) }));
}
db.close();
