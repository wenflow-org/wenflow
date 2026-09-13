import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s) => db.prepare(s).all();
const trunc = (s, n = 40) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t; };

console.log('=== virtual_learner_profiles 完整（profile JSON 里有 name）===');
for (const r of q('SELECT id, profile, learningGoal, updatedAt FROM virtual_learner_profiles ORDER BY updatedAt DESC')) {
  let name = '?';
  try { name = JSON.parse(r.profile || '{}').name || '?'; } catch {}
  console.log(`${name}  |  id=${r.id.slice(0,8)}  goal=${trunc(r.learningGoal, 24)}  updated=${r.updatedAt}`);
}

console.log('\n=== virtual_sessions 全量（profile -> 会话状态）===');
const profs = new Map();
for (const r of q('SELECT id, profile FROM virtual_learner_profiles')) {
  let name = '?'; try { name = JSON.parse(r.profile || '{}').name || '?'; } catch {}
  profs.set(r.id, name);
}
for (const r of q(`SELECT virtualProfileId, status, currentStage, completedTasks, totalTasks, createdAt, updatedAt FROM virtual_sessions ORDER BY updatedAt DESC`)) {
  const name = profs.get(r.virtualProfileId) || r.virtualProfileId?.slice(0,8);
  console.log(`${name}  status=${r.status}  stage=${r.currentStage}  tasks=${r.completedTasks}/${r.totalTasks}  updated=${r.updatedAt}`);
}

console.log('\n=== batch_experiments 列 + 数据 ===');
console.log(q('PRAGMA table_info(batch_experiments)').map(c => c.name).join(', '));
for (const r of q('SELECT * FROM batch_experiments ORDER BY rowid DESC')) console.log(JSON.stringify(r).slice(0, 400));

console.log('\n=== batch_experiment_runs ===');
console.log(q('PRAGMA table_info(batch_experiment_runs)').map(c => c.name).join(', '));
for (const r of q('SELECT * FROM batch_experiment_runs ORDER BY rowid DESC')) console.log(JSON.stringify(r).slice(0, 400));

db.close();