import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const sid = 'd3a2d6b6-ba29-4a37-863b-1fc17f8e50bb';
const r = q('SELECT stageResults FROM virtual_sessions WHERE id = ?', sid)[0];
const sr = JSON.parse(r.stageResults || '{}');
const teaching = sr.teaching || {};

console.log('=== teaching 完整字段 ===');
for (const [k, v] of Object.entries(teaching)) {
  let s = JSON.stringify(v);
  if (s.length > 1500) s = s.slice(0, 1500) + '...(截断)';
  console.log(`\n${k}: ${s}`);
}

console.log('\n=== teachingSessionHistory 状态分布 ===');
const hist = teaching.teachingSessionHistory || [];
console.log('历史条目数:', hist.length);
const byStatus = {};
for (const h of hist) byStatus[h.status] = (byStatus[h.status] || 0) + 1;
console.log(byStatus);
console.log('\n最近 10 条:');
for (const h of hist.slice(-10)) {
  console.log(`  task=${h.taskId} "${(h.taskTitle||'').slice(0,20)}" status=${h.status} ${h.restartedAt || h.completedAt || h.failedAt || ''}`);
}

db.close();