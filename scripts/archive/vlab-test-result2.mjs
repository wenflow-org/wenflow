// 检查新路径与生成结果
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const p = q('SELECT * FROM learning_paths WHERE id=?', 'lp_1786871579214_bpxbjci')[0];
if (p) {
  console.log('=== NEW PATH ===');
  console.log('title:', p.title);
  console.log('desc:', (p.description || '').slice(0, 220));
  const ms = q('SELECT stageNumber,title,coreConceptName FROM milestones WHERE learningPathId=? ORDER BY stageNumber', 'lp_1786871579214_bpxbjci');
  console.log('milestones:', ms.length);
  for (const m of ms) console.log('  M' + m.stageNumber + ' [' + m.title + '] concept=' + (m.coreConceptName || '').slice(0, 50));
  const st = q('SELECT COUNT(*) c FROM subtasks s JOIN milestones m2 ON m2.id=s.milestoneId WHERE m2.learningPathId=?', 'lp_1786871579214_bpxbjci');
  console.log('subtasks:', st[0].c);
}
console.log('\n=== generation runs ===');
for (const r of q('SELECT phase,status,errorCode,errorMessage FROM path_generation_runs WHERE learningPathId=?', 'lp_1786871579214_bpxbjci'))
  console.log(r.phase, r.status, r.errorCode || '', (r.errorMessage || '').slice(0, 130));

console.log('\n=== wrapup（若 teaching 空转，验证零证据分支）===');
const vs = q('SELECT stageResults FROM virtual_sessions WHERE id=?', '6d53ee90-dfc5-4cc1-b2f1-b2f868bda7e5')[0];
if (vs) {
  const sr = JSON.parse(vs.stageResults || '{}');
  const w = sr.teaching?.wrapup;
  if (w) {
    console.log('topicSummary:', (w.summary?.topicSummary || '').slice(0, 150));
    console.log('actionPlan:', JSON.stringify(w.summary?.actionPlan || []).slice(0, 200));
    console.log('evaluation:', JSON.stringify(w.evaluation || {}).slice(0, 200));
  } else console.log('no wrapup in stageResults');
}
db.close();
