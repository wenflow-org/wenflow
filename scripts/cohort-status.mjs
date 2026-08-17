// 按 state 实际 sessionId 检查三人状态
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'logs', 'cohort-state.json'), 'utf8'));
for (const l of state.learners) {
  const vs = q('SELECT id, status, currentStage, goalConversationId, learningPathId, updatedAt FROM virtual_sessions WHERE id=?', l.sessionId)[0];
  if (!vs) { console.log(`${l.name}: session ${l.sessionId} NOT FOUND`); continue; }
  let gc = null;
  if (vs.goalConversationId) {
    const g = q('SELECT stage, length(messages) L FROM goal_conversations WHERE id=?', vs.goalConversationId)[0];
    gc = g ? `${g.stage} L=${g.L}` : 'none';
  }
  let tasks = '?';
  if (vs.learningPathId) {
    const t = q('SELECT COUNT(*) c FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=?', vs.learningPathId)[0];
    tasks = t.c;
  }
  console.log(`${l.name} | phase=${l.phase} | session=${vs.id.slice(0, 12)} | ${vs.status}/${vs.currentStage} | gc=${gc} | tasks=${tasks} | updated=${new Date(vs.updatedAt).toISOString().slice(11, 19)}`);
}
db.close();
