// 独立读者意见复核·第二轮：只读 DB 对账 + 产物补抽。
// readOnly + busy_timeout + 显式列名 + ? 参数绑定；不写库、不触 src。
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const log = console.log;
const DB = path.join(__dirname, '..', '..', 'prisma', 'dev.db');
const db = new DatabaseSync(DB, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const SEQ = 'user_1447d5a2-8ff8-47f1-a0e8-cc67d741223d';

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const has = (t, c) => cols(t).includes(c);

log('== misconception_ledger cols ==', cols('misconception_ledger').join(','));

// 1) 台账 5→8 对账
log('\n== [1] misconception_ledger seq user (createdAt asc) ==');
{
  const sel = ['id', 'conceptKey', 'canonicalLabel', 'confidence', 'firstSeenAt', 'lastSeenAt']
    .filter((c) => has('misconception_ledger', c));
  const rows = db.prepare(`SELECT ${sel.join(',')} FROM misconception_ledger WHERE userId = ? ORDER BY ${has('misconception_ledger','firstSeenAt') ? 'firstSeenAt' : sel[sel.length-1]} ASC`).all(SEQ);
  for (const r of rows) log(JSON.stringify(r));
  log('total =', rows.length);
}

// 2) learner_evidence review:completed 对账
log('\n== [2] learner_evidence review:completed seq user ==');
{
  const rows = db.prepare(`SELECT id, evidenceType, createdAt, substr(payload,1,200) AS p FROM learner_evidence WHERE userId = ? AND evidenceType = 'review:completed' ORDER BY createdAt ASC`).all(SEQ);
  for (const r of rows) log(JSON.stringify(r));
  log('total =', rows.length);
}

// 3) outbox review:completed 载荷（每事件 item 数）
log('\n== [3] domain_event_outbox review:completed seq user ==');
{
  const rows = db.prepare(`SELECT id, eventType, status, occurredAt, payload FROM domain_event_outbox WHERE userId = ? AND eventType = 'review:completed' ORDER BY occurredAt ASC`).all(SEQ);
  for (const r of rows) {
    let n = null, first = null;
    try {
      const j = JSON.parse(r.payload);
      const items = j?.data?.reviewItems || j?.payload?.reviewItems || j?.reviewItems;
      if (Array.isArray(items)) { n = items.length; first = items.map((i) => i.conceptKey); }
    } catch (_) {}
    log(JSON.stringify({ id: r.id, status: r.status, occurredAt: r.occurredAt, itemCount: n, items: first }));
  }
  log('total =', rows.length);
}

// 4) memory_traces 三概念现值（3.4 出处佐证）
log('\n== [4] memory_traces seq user 三概念 ==');
{
  const keys = ['叶绿体存在于哪些细胞', '识别叶绿体与线粒体', '线粒体存在于哪些细胞'];
  const rows = db.prepare(`SELECT conceptKey, fsrsStability, fsrsDifficulty, fsrsReps, lastSeenAt, updatedAt, extractionCount FROM memory_traces WHERE userId = ? AND conceptKey IN (${keys.map(() => '?').join(',')})`).all(SEQ, ...keys);
  for (const r of rows) log(JSON.stringify(r));
}

// 5) a2.after 快照里 叶绿体存在于哪些细胞 的 fsrsStability（delta before 的出处）
log('\n== [5] seq-a2.after.json 叶绿体存在于哪些细胞 ==');
{
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'seq-a2.after.json'), 'utf8'));
  const row = (f.memoryTraces || []).find((t) => t.conceptKey === '叶绿体存在于哪些细胞');
  log(JSON.stringify(row && { conceptKey: row.conceptKey, fsrsStability: row.fsrsStability, fsrsReps: row.fsrsReps, lastSeenAt: row.lastSeenAt }));
}

// 6) crossloop-seq.json §S17 与 §S7 全文（弃跑 EWMA 对账）
log('\n== [6] crossloop-seq.json S17 / S7-full / S10 ==');
{
  const raw = fs.readFileSync(path.join(__dirname, 'out', 'crossloop-seq.json'), 'utf8');
  const secOf = (name, len) => {
    const i = raw.indexOf(`===== ${name}`);
    return i < 0 ? `(missing ${name})` : raw.slice(i, i + (len || 1800));
  };
  log(secOf('S17', 1700));
  log(secOf('S10', 1500));
  const i7 = raw.indexOf('===== S7');
  const iEnd = raw.indexOf('=====', i7 + 10);
  log('--S7-full--');
  log(raw.slice(i7, iEnd > 0 ? Math.min(iEnd, i7 + 4200) : i7 + 4200));
}

// 7) ad-day3.json B2 traceDelta 口径
log('\n== [7] ad-day3.json B2 ==');
{
  const d3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'ad-day3.json'), 'utf8'));
  const findB2 = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) { for (const x of o) { const r = findB2(x); if (r) return r; } return null; }
    const j = JSON.stringify(o);
    if (j.includes('VL-B2') && (o.traceDelta || o.decayReadings)) return o;
    for (const v of Object.values(o)) { const r = findB2(v); if (r) return r; }
    return null;
  };
  const b2 = findB2(d3);
  if (b2) log(JSON.stringify({ keys: Object.keys(b2), traceDeltaLen: Array.isArray(b2.traceDelta) ? b2.traceDelta.length : typeof b2.traceDelta, note: b2.note, traceDelta: b2.traceDelta }).slice(0, 2200));
  else log('B2 block not found by scan; topKeys=', Object.keys(d3).join(','));
}
