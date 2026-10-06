// R3 F2 验收（只读）：探针 grep + review:completed 证据 + 温故点 FSRS 对照
// 用法：node r3-f2-verify.mjs <logStartLine>   （logStartLine = F2 段开始的 backend-3011.log 行号）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, 'out', 'backend-3011.log');
const DB_PATH = path.resolve(__dirname, '../../prisma/dev.db');
const UID = '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5'; // VL-B1 = vl-r1b-01-strong（老周）
const fromLine = Number(process.argv[2] || 6620); // 3011 重启后的行号基线

const lines = fs.readFileSync(LOG, 'utf8').split('\n');
const window = lines.slice(fromLine - 1);
console.log(`log window: lines ${fromLine}..${lines.length} (${window.length} lines)`);

const probe1 = [];
const probe2 = [];
window.forEach((line, i) => {
  const n = fromLine + i;
  if (line.includes('课内温故结果已回写记忆引擎')) probe1.push({ line: n, text: line.slice(0, 260) });
  if (line.includes('review:completed 事件已入队')) probe2.push({ line: n, text: line.slice(0, 260) });
});
console.log('probe 课内温故结果已回写记忆引擎:', probe1.length, JSON.stringify(probe1, null, 1));
console.log('probe review:completed 事件已入队:', probe2.length, JSON.stringify(probe2, null, 1));

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
// F2 段窗口内（2026-10-06T02:20Z 之后）的 review:completed 证据
const ev = db.prepare(
  `SELECT id, evidenceType, eventId, evidenceKey, sessionId, taskId, payload, confidence, occurredAt
   FROM learner_evidence WHERE userId = ? AND evidenceType = 'review:completed' AND occurredAt > ?
   ORDER BY occurredAt`, [UID, Date.parse('2026-10-06T02:20:00Z')]).all();
for (const e of ev) {
  let p = null; try { p = JSON.parse(e.payload || '{}'); } catch {}
  console.log('review:completed evidence:', JSON.stringify({ id: e.id, eventId: e.eventId, sessionId: String(e.sessionId || '').slice(-12), occurredAt: new Date(e.occurredAt).toISOString(), reviewItems: p?.reviewItems?.map((x) => ({ conceptKey: x.conceptKey, rating: x.rating, status: x.status })) ?? p }, null, 1).slice(0, 900));
}
if (ev.length === 0) console.log('review:completed evidence: 0 rows in F2 window');
// 温故相关点 FSRS 现值（对照用）
const traces = db.prepare(
  `SELECT conceptKey, masteryScore, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, dueAt, lastSeenAt, source, updatedAt
   FROM memory_traces WHERE userId = ? ORDER BY conceptKey`, [UID]).all(UID);
for (const t of traces) {
  console.log('trace:', JSON.stringify({ conceptKey: String(t.conceptKey).slice(0, 30), fsrsReps: t.fsrsReps, fsrsStability: t.fsrsStability, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null, lastSeenAt: t.lastSeenAt ? new Date(t.lastSeenAt).toISOString() : null, updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null }));
}
// outbox 里 review:completed 事件（双口径）
const outbox = db.prepare(
  `SELECT id, eventType, aggregateId, status, occurredAt FROM domain_event_outbox
   WHERE userId = ? AND eventType = 'review:completed' AND occurredAt > ? ORDER BY occurredAt`, [UID, Date.parse('2026-10-06T02:20:00Z')]).all();
console.log('outbox review:completed in window:', outbox.length, JSON.stringify(outbox.map((o) => ({ id: o.id, aggregate: String(o.aggregateId || '').slice(-12), status: o.status, at: new Date(o.occurredAt).toISOString() }))));
db.close();
