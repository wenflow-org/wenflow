// 取证只读查询：教学测量验证第一轮 —— learner_evidence + teaching_sessions.wrapup
// 只读打开 dev.db（WAL 多进程安全），显式列名，参数绑定，禁 SELECT *。
'use strict';
const { DatabaseSync } = require('node:sqlite');

const SESSIONS = [
  { label: 'GUI-1',   userId: 'user_c93a688c-56aa-4253-a24a-a162550186ce', sessionId: 'teaching_user_c93a688c-56aa-4253-a24a-a162550186ce_51e8f0df-da4a-4647-a702-fd80bbb33983' },
  { label: 'S1-pass', userId: 'user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca', sessionId: 'teaching_user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca_a438786c-f859-401e-8e11-d2f4db9b2d49' },
  { label: 'S2-skip', userId: 'user_dbb62604-d3d5-4da1-a733-3688d96fce4b', sessionId: 'teaching_user_dbb62604-d3d5-4da1-a733-3688d96fce4b_fee1b341-a11c-47d0-b784-43171227ca01' },
  { label: 'S3-cap',  userId: 'user_7d2c6046-887a-4900-a4df-af9061b63bf2', sessionId: 'teaching_user_7d2c6046-887a-4900-a4df-af9061b63bf2_30a25984-6623-4165-94f8-581866a40f84' },
  { label: 'S4-unresolved', userId: 'user_6c042205-50c3-4177-b640-fd4d606a3fba', sessionId: 'teaching_user_6c042205-50c3-4177-b640-fd4d606a3fba_27f1e68f-d298-4d29-af07-a93afdf746dd' },
  { label: 'VL-1',    userId: 'ee52b287-29b4-4d0b-9995-303f13322f8c', sessionId: '6131973e-72d6-4f23-819f-fb3a896dfe9d' },
  { label: 'VL-B1',   userId: '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5', sessionId: 'teaching_0b27bb9e-afed-4a7a-9991-1dd404b6c4b5_ccee4b32-60a4-49cb-867c-d098edb64e63' },
  { label: 'VL-B2',   userId: '802c1a8a-423f-4e9c-aa15-68035cecede2', sessionId: 'teaching_802c1a8a-423f-4e9c-aa15-68035cecede2_16e1515c-3994-49a5-b0a9-57ffadfcabde' },
  { label: 'VL-B3',   userId: '7a3f3955-6f4e-4dbb-9f00-d92969cd019c', sessionId: 'teaching_7a3f3955-6f4e-4dbb-9f00-d92969cd019c_89e6e0d5-6950-493c-97c0-67a52519e31d' },
  { label: 'VL-B4',   userId: 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847', sessionId: 'teaching_b78b4b66-dd38-4a7b-ab0f-23284c7b3847_d9ca93b6-5289-41c9-882f-728cd1b2489b' },
  { label: 'VL-B5',   userId: '7099f596-8962-4ada-a10f-6dcc6c2d4578', sessionId: 'teaching_7099f596-8962-4ada-a10f-6dcc6c2d4578_95d31f21-9a97-4755-bcc2-611ae03f3640' },
];

function parseMaybeJson(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return { __unparsedHead: String(text).slice(0, 120) }; }
}

function topicSummaryInfo(wrapupObj) {
  if (!wrapupObj || typeof wrapupObj !== 'object') return null;
  const keys = Object.keys(wrapupObj);
  const summary = wrapupObj.summary;
  let topicSummary = null;
  if (summary && typeof summary === 'object') {
    topicSummary = summary.topicSummary ?? null;
    return {
      wrapupKeys: keys,
      status: wrapupObj.status ?? null,
      sources: wrapupObj.sources ?? null,
      summaryKeys: Object.keys(summary),
      topicSummaryLen: typeof topicSummary === 'string' ? topicSummary.length : null,
      topicSummaryHead: typeof topicSummary === 'string' ? topicSummary.slice(0, 160) : String(topicSummary).slice(0, 160),
      practiceAdviceLen: typeof summary.practiceAdvice === 'string' ? summary.practiceAdvice.length : null,
    };
  }
  return { wrapupKeys: keys, status: wrapupObj.status ?? null, sources: wrapupObj.sources ?? null, summaryKeys: null, topicSummaryLen: null, topicSummaryHead: null, practiceAdviceLen: null };
}

const db = new DatabaseSync('backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

const out = { generatedAt: new Date().toISOString(), db: 'backend/prisma/dev.db (readOnly)', sessions: {} };

for (const s of SESSIONS) {
  // 1) learner_evidence 全量（显式列）
  const ev = db.prepare(
    'SELECT id, eventId, evidenceKey, evidenceType, userId, taskId, sessionId, payload, confidence, occurredAt, createdAt FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt ASC'
  ).all(s.sessionId);

  const parsed = ev.map(r => ({
    eventId: r.eventId,
    evidenceKey: r.evidenceKey,
    evidenceType: r.evidenceType,
    userId: r.userId,
    confidence: r.confidence,
    occurredAt: r.occurredAt,
    payload: parseMaybeJson(r.payload),
  }));

  const byType = {};
  for (const p of parsed) (byType[p.evidenceType] = byType[p.evidenceType] || []).push(p);

  // 2) 重复检查：eventId 与 evidenceKey
  const dupEventId = {}, dupEvidenceKey = {};
  for (const p of parsed) {
    (dupEventId[p.eventId] = dupEventId[p.eventId] || []).push(p.evidenceType);
    (dupEvidenceKey[p.evidenceKey] = dupEvidenceKey[p.evidenceKey] || []).push(p.evidenceType);
  }
  const eventIdDups = Object.entries(dupEventId).filter(([, v]) => v.length > 1);
  const evidenceKeyDups = Object.entries(dupEvidenceKey).filter(([, v]) => v.length > 1);

  // 3) 该 userId 名下全部 session（会话数是否 = 1）
  const userSessions = db.prepare(
    'SELECT id, status, startTime, endTime FROM teaching_sessions WHERE userId = ? ORDER BY startTime ASC'
  ).all(s.userId);

  // 4) teaching_sessions 结算产物（wrapup / status；不取 messages 大列）
  const sess = db.prepare(
    'SELECT id, userId, status, wrapup, startTime, endTime, duration, revision FROM teaching_sessions WHERE id = ?'
  ).get(s.sessionId);

  const wrapupRaw = sess ? sess.wrapup : null;
  const wrapupObj = parseMaybeJson(wrapupRaw);

  out.sessions[s.label] = {
    sessionRow: sess ? { id: sess.id, status: sess.status, startTime: sess.startTime, endTime: sess.endTime, duration: sess.duration, revision: sess.revision } : null,
    evidenceCount: parsed.length,
    typeCounts: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
    rows: parsed,
    eventIdDups,
    evidenceKeyDups,
    userSessionCount: userSessions.length,
    userSessions: userSessions.map(x => ({ id: x.id, status: x.status, startTime: x.startTime })),
    wrapup: {
      isNull: wrapupRaw == null,
      byteLen: wrapupRaw == null ? 0 : Buffer.byteLength(wrapupRaw, 'utf8'),
      parsed: wrapupObj,
      info: topicSummaryInfo(wrapupObj),
    },
  };
}

// 5) 全表级 evidenceKey 重复扫描（仅这 11 个 session 的行）
const ids = SESSIONS.map(s => s.sessionId);
const ph = ids.map(() => '?').join(',');
const dupRows = db.prepare(
  `SELECT evidenceKey, sessionId, COUNT(*) AS n FROM learner_evidence WHERE sessionId IN (${ph}) GROUP BY evidenceKey HAVING n > 1`
).all(...ids);
out.globalEvidenceKeyDupsAmongScenarios = dupRows;

process.stdout.write(JSON.stringify(out, null, 1));
