// 轨道B：33 个 human-candidate 会话真实画像（漏斗主交付物）
// 只读：readOnly + busy_timeout=5000 + 显式列名 + 参数绑定。不改任何数据。
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const HC = 'human-candidate';
const rows = db.prepare(`
  SELECT v.sessionId, v.userId, v.email, v.provenance, v.synthetic_student, v.measurement_sealed,
         s.status, s.subject, s.topic, s.taskType, s.mode, s.createdAt, s.startTime, s.endTime,
         s.updatedAt, s.revision, LENGTH(s.wrapup) AS wrapupLen, LENGTH(s.messages) AS messagesColLen,
         LENGTH(s.teachingState) AS teachingStateLen, LENGTH(s.advisory) AS advisoryLen
  FROM v_session_provenance v
  JOIN teaching_sessions s ON s.id = v.sessionId
  WHERE v.provenance = ?
  ORDER BY s.createdAt ASC
`).all(HC);

console.log('== total human-candidate sessions ==', rows.length);

// ---- 状态分布 ----
const byStatus = {};
for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log('\n== status distribution ==');
console.log(JSON.stringify(byStatus));

// ---- 消息数分布（侧表，按 role 计）----
const msgStmt = db.prepare('SELECT id, payload, createdAt FROM teaching_session_messages WHERE sessionId = ? ORDER BY id ASC');
function payloadParse(p) { try { return JSON.parse(p); } catch { return null; } }

console.log('\n== per-session detail (createdAt ASC) ==');
const dayDist = {};
const statusByDay = {};
const funnelStep = { msg0: 0, onlyUser1: 0, assistantReplied1: 0, multiTurn: 0 };
const perSession = [];
for (const r of rows) {
  const msgs = msgStmt.all(r.sessionId).map(m => ({ ...m, ...payloadParse(m.payload) }));
  const roles = msgs.map(m => m.role);
  const userCount = roles.filter(x => x === 'user').length;
  const assistantCount = roles.filter(x => x === 'assistant').length;
  const createdIso = new Date(Number(r.createdAt)).toISOString();
  const day = createdIso.slice(0, 10);
  dayDist[day] = (dayDist[day] || 0) + 1;
  statusByDay[day] = statusByDay[day] || {};
  statusByDay[day][r.status] = (statusByDay[day][r.status] || 0) + 1;
  // 弃置点判定
  let step;
  if (msgs.length === 0) { step = 'no-message'; funnelStep.msg0++; }
  else if (assistantCount === 0) { step = 'user-spoke-no-reply'; funnelStep.onlyUser1++; }
  else if (userCount <= 1) { step = 'after-first-reply'; funnelStep.assistantReplied1++; }
  else { step = 'multi-turn'; funnelStep.multiTurn++; }
  const dur = (Number(r.endTime) - Number(r.startTime)) / 1000;
  perSession.push({ sid8: r.sessionId.slice(9, 17), status: r.status, day, createdIso, msgs: msgs.length, userCount, assistantCount, step, wrapupLen: r.wrapupLen, revision: r.revision, durSec: Math.round(dur), subject: (r.subject || '').slice(0, 24), topic: (r.topic || '').slice(0, 40), firstRole: roles[0] || null, lastRole: roles[roles.length - 1] || null });
  console.log(JSON.stringify(perSession[perSession.length - 1]));
}

console.log('\n== funnel step ==', JSON.stringify(funnelStep));
console.log('\n== day distribution ==', JSON.stringify(dayDist));
console.log('\n== status by day ==', JSON.stringify(statusByDay));
console.log('\n== message-count histogram ==');
const hist = {};
for (const p of perSession) hist[p.msgs] = (hist[p.msgs] || 0) + 1;
console.log(JSON.stringify(hist));
console.log('\n== wrapup non-null ==', perSession.filter(p => p.wrapupLen > 0).length);

// ---- 全量消息文本落盘（供缺陷扫描）----
const fs = require('fs');
const outDir = 'D:/wenflow/wenflow/backend/scripts/measurement-verify/out';
fs.mkdirSync(outDir, { recursive: true });
const dump = [];
for (const r of rows) {
  const msgs = msgStmt.all(r.sessionId);
  dump.push({
    sessionId: r.sessionId, userId: r.userId, email: r.email, status: r.status,
    subject: r.subject, topic: r.topic, taskType: r.taskType, mode: r.mode,
    createdAt: new Date(Number(r.createdAt)).toISOString(), startTime: new Date(Number(r.startTime)).toISOString(),
    endTime: r.endTime ? new Date(Number(r.endTime)).toISOString() : null,
    wrapup: null, messages: []
  });
  const rec = dump[dump.length - 1];
  const w = db.prepare('SELECT wrapup FROM teaching_sessions WHERE id = ?').get(r.sessionId);
  rec.wrapup = w && w.wrapup ? w.wrapup : null;
  for (const m of msgs) {
    const p = payloadParse(m.payload) || {};
    let iso = null;
    const t = Number(m.createdAt);
    iso = Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : (typeof m.createdAt === 'string' ? m.createdAt : String(m.createdAt));
    rec.messages.push({ seq: m.id, role: p.role, createdAt: iso, content: p.content, kind: p.kind || null, meta: p.meta !== undefined ? p.meta : undefined });
  }
}
fs.writeFileSync(outDir + '/r5b-human-candidate-dump.json', JSON.stringify(dump, null, 1), 'utf8');
console.log('\n== dump written ==', outDir + '/r5b-human-candidate-dump.json', 'sessions:', dump.length, 'totalMsgs:', dump.reduce((a, b) => a + b.messages.length, 0));
db.close();
