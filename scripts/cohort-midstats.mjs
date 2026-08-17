// 中间统计：三人实验已产出数据
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'logs', 'cohort-state.json'), 'utf8'));
for (const l of state.learners) {
  const userId = (() => { const u = db.prepare('SELECT userId FROM virtual_learner_profiles WHERE id=?').get(l.profileId); return u?.userId; })();
  console.log(`=== ${l.name} ===`);
  // goal
  const gc = l.goalConversationId ? q('SELECT stage, length(messages) L FROM goal_conversations WHERE id=?', l.goalConversationId)[0] : null;
  console.log('goal:', gc ? `${gc.stage} (msgs ${Math.round(gc.L / 100) / 10}k chars)` : 'none');
  // paths
  const paths = q('SELECT id, title, totalMilestones, status FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC', userId);
  console.log('paths:', paths.length);
  for (const p of paths) {
    const st = q('SELECT COUNT(*) c FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=?', p.id)[0].c;
    console.log(`  - ${String(p.title).slice(0, 40)} | ms=${p.totalMilestones} tasks=${st} | ${p.status}`);
  }
  // teaching sessions
  const ts = q(`SELECT id, topic, status, length(messages) L FROM teaching_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 5`, userId);
  console.log('teaching sessions:', ts.length);
  for (const t of ts) console.log(`  - ${String(t.topic).slice(0, 30)} | ${t.status} | msgs=${Math.round((t.L || 0) / 1000)}k`);
  // memory traces
  const mt = q('SELECT COUNT(*) c FROM memory_traces WHERE userId=?', userId)[0].c;
  const ev = q('SELECT COUNT(*) c FROM learner_evidence WHERE userId=?', userId)[0].c;
  console.log(`memory_traces=${mt} learner_evidence=${ev}`);
}
db.close();
