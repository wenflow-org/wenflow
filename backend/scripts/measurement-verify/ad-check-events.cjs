// 快查：6 VL 的 outbox 事件与 learner_evidence 全貌（只读）
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const VL = ['ee52b287-29b4-4d0b-9995-303f13322f8c', '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5', '802c1a8a-423f-4e9c-aa15-68035cecede2', '7a3f3955-6f4e-4dbb-9f00-d92969cd019c', 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847', '7099f596-8962-4ada-a10f-6dcc6c2d4578'];
const ph = VL.map(() => '?').join(',');
console.log('== outbox events for 6 VLs since 2026-10-05T20:00Z (1791230400000) ==');
const rows = db.prepare(`SELECT eventType, status, COUNT(*) AS cnt, MIN(occurredAt) AS firstAt, MAX(occurredAt) AS lastAt FROM domain_event_outbox WHERE userId IN (${ph}) AND occurredAt >= 1791230400000 GROUP BY eventType, status`).all(...VL);
for (const r of rows) console.log(JSON.stringify(r));
console.log('== learner_evidence for 6 VLs (any type, all time) ==');
for (const r of db.prepare(`SELECT evidenceType, COUNT(*) AS cnt, MIN(occurredAt) AS firstAt, MAX(occurredAt) AS lastAt FROM learner_evidence WHERE userId IN (${ph}) GROUP BY evidenceType`).all(...VL))
  console.log(JSON.stringify(r));
console.log('== fsrsStability non-null count for 6 VLs ==');
console.log(JSON.stringify(db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) AS withFsrs FROM memory_traces WHERE userId IN (${ph})`).get(...VL)));
db.close();
