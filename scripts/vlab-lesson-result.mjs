// 监督课结果汇总：教学会话消息/知识看板/wrapup/任务状态
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 260) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

const ts = q(`SELECT * FROM teaching_sessions WHERE id LIKE 'teaching_202f0609%' ORDER BY createdAt DESC LIMIT 1`)[0];
if (!ts) { console.log('teaching session not found'); process.exit(0); }
console.log('=== TEACHING SESSION ===');
console.log('id:', ts.id.slice(0, 40));
console.log('topic:', ts.topic, '| status:', ts.status, '| taskType:', ts.taskType, '| duration:', ts.duration, 's');

const msgs = JSON.parse(ts.messages || '[]');
console.log('\n=== 对话轮次 ===');
let round = 0;
for (const m of msgs) {
  if (m.role === 'assistant') {
    round++;
    const analysis = m.analysis || {};
    console.log(`\n[R${round}] understanding=${analysis.understanding} cognitive=${analysis.cognitiveLevel} emotion=${analysis.emotionalState} engagement=${analysis.engagement}`);
    console.log('  confusion:', JSON.stringify(analysis.confusionPoints || []));
    if (analysis.control) console.log('  control:', JSON.stringify(analysis.control));
  } else {
    console.log(`  [${m.role}] ${trunc(m.content, 140)}`);
  }
}

console.log('\n=== 知识看板（终态）===');
const ks = JSON.parse(ts.knowledgeState || '[]');
for (const p of ks) console.log(`- ${p.name} | ${p.status} | ${p.progress}%`);

console.log('\n=== wrapup ===');
const w = JSON.parse(ts.wrapup || '{}');
if (w.summary) {
  console.log('topicSummary:', trunc(w.summary.topicSummary, 200));
  console.log('knowledgeSummary:', trunc(w.summary.knowledgeSummary, 200));
  console.log('keyTakeaways:', JSON.stringify(w.summary.keyTakeaways || []));
  console.log('actionPlan:', JSON.stringify(w.summary.actionPlan || []));
  console.log('evaluationHighlights:', trunc(JSON.stringify(w.summary.evaluationHighlights || {}), 200));
}
if (w.evaluation) console.log('evaluation:', JSON.stringify(w.evaluation));

console.log('\n=== 任务状态 ===');
const st = q('SELECT title, status, rating, feedback FROM subtasks WHERE id=?', ts.taskId);
if (st.length) console.log(JSON.stringify(st[0], null, 1).slice(0, 300));
console.log('taskId:', ts.taskId);

console.log('\n=== 画像/证据沉淀 ===');
const ev = q(`SELECT evidenceKey, COUNT(*) c FROM learner_evidence WHERE userId=? AND createdAt > ? GROUP BY evidenceKey`, ts.userId, Date.now() - 2 * 3600 * 1000);
for (const e of ev) console.log(`- ${e.evidenceKey} × ${e.c}`);
const mt = q(`SELECT conceptKey, label, masteryScore, stability FROM memory_traces WHERE userId=? ORDER BY updatedAt DESC LIMIT 6`, ts.userId);
for (const m of mt) console.log(`- trace: ${trunc(m.conceptKey, 40)} | ${m.label} | m=${m.masteryScore} st=${m.stability}`);

db.close();
