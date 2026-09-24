// 只读挖掘 dev.db v3
import { DatabaseSync } from 'node:sqlite';
const DB = 'D:/wenflow/wenflow/backend/prisma/dev.db';
const db = new DatabaseSync(DB, { readOnly: true });
const q = (sql, p = []) => db.prepare(sql).all(...p);
const fmt = v => (v && /^\d{13}$/.test(String(v))) ? new Date(Number(v)).toISOString().replace('T',' ').slice(0,16) : String(v ?? '-').slice(0,16);

console.log('=== 2. 教学消息 analysis 字段落库率 ===');
const ar = q(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN payload LIKE '%"analysis"%' THEN 1 ELSE 0 END) withAnalysis,
    SUM(CASE WHEN payload LIKE '%"misconceptions"%' THEN 1 ELSE 0 END) withMisconceptions,
    SUM(CASE WHEN payload LIKE '%"ktEstimate"%' THEN 1 ELSE 0 END) withKt,
    SUM(CASE WHEN payload LIKE '%"loadIndex"%' THEN 1 ELSE 0 END) withLoad,
    SUM(CASE WHEN payload LIKE '%"loadBasis"%' THEN 1 ELSE 0 END) withLoadBasis,
    SUM(CASE WHEN payload LIKE '%"isCompletionCandidate":true%' THEN 1 ELSE 0 END) completionTrue,
    SUM(CASE WHEN payload LIKE '%"emotionalState"%' THEN 1 ELSE 0 END) withEmotion,
    SUM(CASE WHEN payload LIKE '%"cognitiveLevel"%' THEN 1 ELSE 0 END) withCogLevel,
    SUM(CASE WHEN payload LIKE '%"helpSeekingType"%' THEN 1 ELSE 0 END) withHelpSeeking,
    SUM(CASE WHEN payload LIKE '%"selfAssessmentSignal"%' THEN 1 ELSE 0 END) withSelfAssess,
    SUM(CASE WHEN payload LIKE '%"pedagogy"%' THEN 1 ELSE 0 END) withPedagogy
  FROM teaching_session_messages WHERE role='assistant'`);
console.log(JSON.stringify(ar[0], null, 1));

console.log('\n=== 3. 学习者线表规模 ===');
for (const [t, c] of [['learner_projections','updatedAt'],['learner_evidence','createdAt'],['misconception_ledger','updatedAt'],['prediction_records','createdAt'],['goal_conversations','createdAt'],['learning_paths','createdAt'],['memory_traces','createdAt'],['virtual_sessions','createdAt'],['teaching_session_messages','createdAt']]) {
  const r = q(`SELECT COUNT(*) n, MAX(${c}) last FROM ${t}`)[0];
  console.log(`${t.padEnd(28)} n=${String(r.n).padStart(7)} last=${fmt(r.last)}`);
}

console.log('\n=== 4. learner_projections scope/kind 分布 ===');
for (const r of q(`SELECT scope, COUNT(*) n, MAX(updatedAt) last FROM learner_projections GROUP BY scope ORDER BY n DESC LIMIT 10`))
  console.log(JSON.stringify({...r, last: fmt(r.last)}));

console.log('\n=== 5. 虚拟会话近况 ===');
for (const r of q(`SELECT status, currentStage, COUNT(*) n, MAX(createdAt) last FROM virtual_sessions GROUP BY status, currentStage ORDER BY n DESC LIMIT 10`))
  console.log(JSON.stringify({...r, last: fmt(r.last)}));

console.log('\n=== 6. triage-judge 调用来源 ===');
for (const r of q(`SELECT callerAgent, sourceEntry, COUNT(*) n, MAX(calledAt) last FROM agent_call_logs WHERE agentId='skill:triage-judge' GROUP BY callerAgent, sourceEntry ORDER BY n DESC LIMIT 8`))
  console.log(JSON.stringify({...r, last: fmt(r.last)}));

console.log('\n=== 7. 高失败率技能的错误类别 ===');
for (const r of q(`SELECT agentId, COALESCE(errorCategory,'(null)') ec, COUNT(*) n FROM agent_call_logs WHERE success=0 AND agentId IN ('skill:teaching-turn','skill:teaching-opening-generator','skill:learning-predictor','skill:generic-chat') GROUP BY agentId, ec ORDER BY n DESC LIMIT 12`))
  console.log(JSON.stringify(r));

console.log('\n=== 8. 最新一条带 analysis 的教学消息 ===');
const lm = q(`SELECT id, sessionId, createdAt FROM teaching_session_messages WHERE role='assistant' AND payload LIKE '%"analysis"%' ORDER BY createdAt DESC LIMIT 1`)[0];
if (lm) {
  console.log('latest:', JSON.stringify({id: lm.id, sessionId: lm.sessionId, at: fmt(lm.createdAt)}));
  const m = q(`SELECT payload FROM teaching_session_messages WHERE id=?`, [lm.id])[0];
  try {
    const c = JSON.parse(m.payload);
    console.log('top keys:', Object.keys(c).join(','));
    if (c.analysis) { console.log('analysis keys:', Object.keys(c.analysis).join(',')); console.log('analysis:', JSON.stringify(c.analysis).slice(0,900)); }
    if (c.control) console.log('control:', JSON.stringify(c.control).slice(0,300));
  } catch { console.log('not JSON:', m.payload.slice(0,300)); }
}

console.log('\n=== 9. misconception_ledger 生命周期状态分布 ===');
for (const r of q(`SELECT status, COUNT(*) n FROM misconception_ledger GROUP BY status`)) console.log(JSON.stringify(r));

console.log('\n=== 10. prediction_records 有无 outcome 回填 ===');
console.log(JSON.stringify(q(`SELECT COUNT(*) total, SUM(CASE WHEN outcome IS NOT NULL AND outcome != '' THEN 1 ELSE 0 END) withOutcome FROM prediction_records`)[0]));

db.close();
console.log('\nDONE');
