// 监督课完整复盘：teaching_202f0609-a9f8-4e79-97f2-ae035669c3c8_6d9c1707-122c-4214-99b8-0a043bd751e4
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 200) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

const ts = q("SELECT * FROM teaching_sessions WHERE id = 'teaching_202f0609-a9f8-4e79-97f2-ae035669c3c8_05e4b2e7-8814-4adb-b770-f20b0e7d0dea'")[0];
if (!ts) { console.log('not found'); process.exit(0); }
console.log('topic:', ts.topic, '| status:', ts.status, '| taskType:', ts.taskType);
console.log('start:', ts.startTime, '| end:', ts.endTime, '| duration:', ts.duration, 's');

const msgs = JSON.parse(ts.messages || '[]');
console.log('\n=== 对话全览（analysis 摘要）===');
let round = 0;
const knowledgeTrail = [];
for (const m of msgs) {
  if (m.role === 'assistant') {
    round++;
    const a = m.analysis || {};
    const k = a.knowledge || m.knowledge;
    if (k?.points) knowledgeTrail.push({ round, points: k.points });
    const c = a.control || {};
    console.log(`R${round} | u=${a.understanding} cog=${a.cognitiveLevel} emo=${a.emotionalState} load=${a.loadIndex} | complete=${c.isCompletionCandidate} peer=${c.shouldTriggerPeer}`);
    console.log(`  回复: ${trunc(m.content, 130)}`);
  } else {
    console.log(`  [${m.role}] ${trunc(m.content, 110)}`);
  }
}

console.log('\n=== 知识看板演化 ===');
for (const k of knowledgeTrail) {
  const pts = (k.points || []).map(p => `${p.name}(${p.status}/${p.progress})`).join(' | ');
  console.log(`R${k.round}: ${trunc(pts, 300)}`);
}
console.log('\n=== 知识看板终态 ===');
const ks = JSON.parse(ts.knowledgeState || '[]');
for (const p of ks) console.log(`- ${p.name} | ${p.status} | ${p.progress}%`);

console.log('\n=== wrapup ===');
const w = JSON.parse(ts.wrapup || '{}');
if (w.summary) {
  console.log('topicSummary:', trunc(w.summary.topicSummary, 180));
  console.log('learningEvaluation:', trunc(w.summary.learningEvaluation, 180));
  console.log('keyTakeaways:', JSON.stringify(w.summary.keyTakeaways));
  console.log('actionPlan:', JSON.stringify(w.summary.actionPlan));
  console.log('metricInterpretation:', trunc(JSON.stringify(w.summary.metricInterpretation || {}), 200));
}
if (w.evaluation) console.log('evaluation:', JSON.stringify(w.evaluation));
console.log('\n=== 任务 ===');
const st = q('SELECT title, status FROM subtasks WHERE id=?', ts.taskId);
console.log(JSON.stringify(st[0] || {}));

db.close();
