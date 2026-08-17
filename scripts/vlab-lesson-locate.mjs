// 定位监督课的真实 teaching session 与 wrapup
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 260) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

console.log('=== 最近 teaching sessions ===');
const ts = q(`SELECT id, topic, status, taskType, length(messages) L, (wrapup IS NOT NULL) w, createdAt FROM teaching_sessions ORDER BY createdAt DESC LIMIT 6`);
for (const t of ts) console.log(`${t.id.slice(0, 44)} | ${trunc(t.topic, 30)} | ${t.status} ${t.taskType} | L=${t.L} w=${t.w}`);

console.log('\n=== virtual session stageResults.teaching ===');
const vs = q('SELECT stageResults FROM virtual_sessions WHERE id=?', '6d53ee90-dfc5-4cc1-b2f1-b2f868bda7e5')[0];
const sr = JSON.parse(vs.stageResults || '{}');
const t = sr.teaching || {};
console.log('teaching keys:', Object.keys(t).join(', '));
console.log('currentMilestone:', t.currentMilestone, '| currentTask:', t.currentTaskTitle, '| currentTaskId:', t.currentTaskId);
console.log('wrapup:', trunc(JSON.stringify(t.wrapup || '无'), 500));

console.log('\n=== 该会话最新会话详情（找 teachingSessionId）===');
const vs2 = q('SELECT stageResults FROM virtual_sessions WHERE id=?', '6d53ee90-dfc5-4cc1-b2f1-b2f868bda7e5')[0];
const sr2 = JSON.parse(vs2.stageResults || '{}');
console.log('teachingSessionId:', sr2.teaching?.teachingSessionId || '(none)');

db.close();
