// 深挖：小夏会话的教学失败细节
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'logs', 'cohort-state.json'), 'utf8'));
const rec = state.learners.find((x) => x.name === '备考新人小夏');
const vs = q('SELECT status, currentStage, stageResults, logs FROM virtual_sessions WHERE id=?', rec.sessionId)[0];
console.log('status:', vs.status, '| stage:', vs.currentStage);

const logs = JSON.parse(vs.logs || '[]');
console.log('logs count:', logs.length);
const tail = logs.slice(-25);
for (const lg of tail) {
  const d = lg.details || {};
  const out = d.output || d.error || '';
  console.log(`${lg.timestamp?.slice(11, 19) || '?'} [${lg.phase}] ${typeof out === 'string' ? out.slice(0, 160) : JSON.stringify(out).slice(0, 200)}`);
}

const sr = JSON.parse(vs.stageResults || '{}');
const t = sr.teaching || {};
console.log('\nteaching.learnerState:', JSON.stringify(t.learnerState || {}).slice(0, 200));
console.log('teaching.latestLearnerFeedback:', JSON.stringify(t.latestLearnerFeedback || '').slice(0, 150));
console.log('teaching.currentTaskTitle:', t.currentTaskTitle);
db.close();
