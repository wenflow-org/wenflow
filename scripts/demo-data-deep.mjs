// 只读深挖：预算台账 / 教学会话对话样例 / 知识看板演化 / wrapup
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);
const trunc = (s, n = 200) => {
  if (s == null) return s;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };

console.log('===== learning_goals（多目标台账）=====');
const lgs = q(`SELECT lg.title, lg.status, lg.priority, lg.plannedMinutesPerDay, lg.cognitiveBandwidth, u.name
  FROM learning_goals lg JOIN users u ON u.id = lg.userId ORDER BY lg.updatedAt DESC LIMIT 12`);
for (const g of lgs) console.log(`- [${g.name}] ${trunc(g.title, 50)} | ${g.status} p=${g.priority} min/day=${g.plannedMinutesPerDay} cw=${g.cognitiveBandwidth}`);

console.log('\n===== goal_scheduling_ledger（预算消费记录）=====');
const gsl = q(`SELECT gs.date, gs.budgetMinutes, gs.consumedMinutes, gs.plannedTasks, gs.loadAvg, u.name
  FROM goal_scheduling_ledger gs JOIN users u ON u.id = gs.userId ORDER BY gs.date DESC LIMIT 12`);
for (const s of gsl) console.log(`- [${s.name} ${s.date}] budget=${s.budgetMinutes} consumed=${s.consumedMinutes} tasks=${s.plannedTasks} loadAvg=${s.loadAvg}`);

console.log('\n===== 教学会话：对话样例（completed 非虚拟）=====');
const sess = q(`SELECT t.id, u.name, t.topic, t.messages, t.knowledgeState, t.wrapup, t.advisory
  FROM teaching_sessions t JOIN users u ON u.id = t.userId
  WHERE t.status = 'completed' AND u.isVirtualLearner = 0 AND length(t.messages) > 1000
  ORDER BY t.updatedAt DESC LIMIT 1`);
if (sess.length) {
  const s = sess[0];
  const msgs = parse(s.messages);
  console.log(`会话 [${s.name}] topic=${trunc(s.topic, 60)} msgs=${Array.isArray(msgs) ? msgs.length : '?'}`);
  if (Array.isArray(msgs)) {
    let shown = 0;
    for (const m of msgs) {
      if (shown >= 8) break;
      if (typeof m === 'string') { console.log(`  ${trunc(m, 180)}`); shown++; }
      else if (m && (m.content || m.text)) {
        const c = m.content || m.text;
        console.log(`  [${m.role || m.type}] ${trunc(typeof c === 'string' ? c : JSON.stringify(c), 180)}`);
        shown++;
      }
    }
  }
  console.log('\n--- knowledgeState（知识看板终态）---');
  console.log(trunc(JSON.stringify(parse(s.knowledgeState)), 600));
  console.log('\n--- wrapup 摘要 ---');
  const w = parse(s.wrapup);
  if (w) {
    console.log('topicSummary:', trunc(w.summary?.topicSummary ?? JSON.stringify(w), 300));
    console.log('evaluation:', trunc(JSON.stringify(w.evaluation), 200));
  } else console.log(trunc(String(s.wrapup), 300));
}

console.log('\n===== learner_projections（教学提示样例）=====');
const lp = q(`SELECT u.name, lp.projectionKey, lp.payload FROM learner_projections lp JOIN users u ON u.id = lp.userId
  WHERE u.isVirtualLearner = 0 AND lp.payload IS NOT NULL ORDER BY lp.updatedAt DESC LIMIT 3`);
for (const p of lp) {
  const proj = parse(p.payload);
  console.log(`- [${p.name} ${p.projectionKey}] ${trunc(JSON.stringify(proj), 500)}`);
}

console.log('\n===== memory_traces（记忆引擎痕迹，间隔/衰减因子）=====');
const mt = q(`SELECT u.name, mt.conceptKey, mt.label, mt.masteryScore, mt.stability, mt.intervalFactor, mt.decayFactor, mt.lastRetention, mt.extractionCount
  FROM memory_traces mt JOIN users u ON u.id = mt.userId
  WHERE u.isVirtualLearner = 0 ORDER BY mt.updatedAt DESC LIMIT 12`);
for (const m of mt) console.log(`- [${m.name}] ${trunc(m.conceptKey, 30)} | ${trunc(m.label, 30)} | m=${m.masteryScore} st=${m.stability} iv=${m.intervalFactor} dec=${m.decayFactor} ret=${m.lastRetention} n=${m.extractionCount}`);

console.log('\n===== 虚拟学习者画像（结构化）=====');
const vp = q(`SELECT vp.profile, vp.learningGoal, vp.knowledgeLevel, vp.personalityTraits, vp.tags FROM virtual_learner_profiles vp LIMIT 8`);
for (const v of vp) {
  const p = parse(v.profile) || {};
  console.log(`- goal: ${trunc(String(v.learningGoal ?? ''), 60)} | level=${v.knowledgeLevel} | traits=${trunc(String(v.personalityTraits ?? ''), 40)}`);
  console.log(`    profile: ${trunc(JSON.stringify(p), 220)}`);
}

db.close();
