// 查三会话的 teaching 停止原因
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'logs', 'cohort-state.json'), 'utf8'));
for (const l of state.learners) {
  const vs = q('SELECT status, currentStage, stageResults, updatedAt FROM virtual_sessions WHERE id=?', l.sessionId)[0];
  if (!vs) { console.log(`${l.name}: session not found`); continue; }
  const sr = JSON.parse(vs.stageResults || '{}');
  const t = sr.teaching || {};
  console.log(`=== ${l.name} | status=${vs.status} stage=${vs.currentStage} | updated=${new Date(vs.updatedAt).toISOString().slice(11, 19)}`);
  console.log('  teaching keys:', Object.keys(t).join(', ').slice(0, 200));
  console.log('  manualStop:', t.manualStop, '| stoppedReason:', t.stoppedReason || '(none)');
  console.log('  taskTitle:', t.currentTaskTitle || '(none)', '| taskId:', t.currentTaskId || '(none)');
  console.log('  teachingSessionId:', t.teachingSessionId || '(none)');
  const hist = t.teachingSessionHistory || [];
  console.log('  sessionHistory:', JSON.stringify(hist).slice(0, 300));
  // 最近日志
  const logs = JSON.parse(vs.logs || '[]');
  const lastLogs = logs.slice(-5);
  for (const lg of lastLogs) console.log('  log:', JSON.stringify(lg).slice(0, 250));
}
db.close();
