// 查看本轮测试生成的 path 与 teaching 会话
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

const pathRow = q('SELECT * FROM learning_paths WHERE id=?', 'lp_1786860329076_nb7b7hi')[0];
if (pathRow) {
  console.log('=== PATH ===');
  console.log('title:', pathRow.title);
  console.log('desc:', trunc(pathRow.description, 150));
  console.log('status:', pathRow.status, '| totalMilestones:', pathRow.totalMilestones, '| estimatedHours:', pathRow.estimatedHours);
  const ms = q('SELECT stageNumber,title,coreConceptName,goal,estimatedHours FROM milestones WHERE learningPathId=? ORDER BY stageNumber', 'lp_1786860329076_nb7b7hi');
  console.log('milestones:', ms.length);
  for (const m of ms) console.log(`  M${m.stageNumber} [${m.title}] concept=${trunc(m.coreConceptName, 40)} h=${m.estimatedHours}`);
  const st = q('SELECT COUNT(*) c FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=?', 'lp_1786860329076_nb7b7hi');
  console.log('subtasks:', st[0].c);
  const stl = q(`SELECT s.title,s.taskType,s.estimatedMinutes FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=? AND m2.stageNumber=1`, 'lp_1786860329076_nb7b7hi');
  for (const s of stl) console.log(`  T [${s.taskType}] ${s.title} (${s.estimatedMinutes}min)`);
} else console.log('path not found');

console.log('\n=== TEACHING (recent) ===');
const ts = q(`SELECT id,topic,status,taskType,length(messages) AS L, (wrapup IS NOT NULL) AS w FROM teaching_sessions WHERE createdAt > datetime('now','-3 hours') ORDER BY createdAt DESC LIMIT 5`);
for (const t of ts) console.log(t.id.slice(0, 16), '|', trunc(t.topic, 40), '|', t.status, t.taskType, '| L=', t.L, '| w=', t.w);

console.log('\n=== GOAL collectedData ===');
const gc = q('SELECT collectedData FROM goal_conversations WHERE id=?', 'gc_1786859201576_0njwfi9')[0];
if (gc) {
  const cd = JSON.parse(gc.collectedData || '{}');
  const u = cd.understanding || {};
  const cp = cd.confirmedProposal || {};
  console.log('time_horizon:', u.available_resources?.time_horizon, '| time_budget:', u.available_resources?.time_budget);
  console.log('baseline:', JSON.stringify(u.current_baseline));
  console.log('constraints:', JSON.stringify(u.constraints_and_boundaries));
  console.log('key_stages:', JSON.stringify(cp.key_stages));
  console.log('first_deliverable:', cp.first_deliverable);
  console.log('out_of_scope:', JSON.stringify(cp.out_of_scope));
}
db.close();
