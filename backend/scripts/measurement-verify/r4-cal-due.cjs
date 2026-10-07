// r4-cal-due.cjs — 只读：列出目标 VL 的 memory_traces 到期状态（墙钟 vs 各模拟 asOf）
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const DB = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');
const UIDS = {
  'rw-school6-01': '109d5d76-41e7-4d3d-aac3-6f3b7ea6ee60',
  'rw-school6-09': 'a3a4f770-655c-4c7f-b624-cfe7f7d9fa94',
  'rw-school6-21': 'f17d03c0-c976-4986-933a-e0124f57cfec',
  'rw-school6-28': '83f02d14-5b16-4ecf-8003-df3913ec439f',
  'rw-exam6-08': 'eac48271-1275-4f8f-8a82-4429b389a4f3',
  'rw-acad6-03': '4b7d8df6-a894-47d2-8bb6-bed2d54348f6',
  'rw-career6-05': 'a595a2f7-c788-438a-8708-81b6c259b4a9',
  'rw-life6-06': '32eee25a-2a0c-44b9-b1fe-45ee1262dbd3',
};
const db = new DatabaseSync(DB, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const now = Date.now();
const iso = (v) => (v ? new Date(v).toISOString() : 'null');
for (const [key, uid] of Object.entries(UIDS)) {
  const rows = db.prepare('SELECT conceptKey, masteryScore, extractionCount, dueAt, lastSeenAt, pathId FROM memory_traces WHERE userId = ? ORDER BY dueAt').all(uid);
  const dueNow = rows.filter((r) => r.dueAt && r.dueAt <= now).length;
  console.log(`\n== ${key} (${uid.slice(0, 8)}) traces=${rows.length} due@wallclock=${dueNow}`);
  for (const r of rows) {
    const flag = r.dueAt && r.dueAt <= now ? 'DUE' : '   ';
    console.log(`  ${flag} ${String(r.conceptKey).slice(0, 26).padEnd(28)} m=${r.masteryScore} ec=${r.extractionCount} due=${iso(r.dueAt)} seen=${iso(r.lastSeenAt)} path=${r.pathId ? 'Y' : 'null'}`);
  }
}
db.close();