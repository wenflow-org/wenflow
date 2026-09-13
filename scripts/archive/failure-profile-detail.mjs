import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const id = '2b1c201c-b9cb-495b-bad3-cdee3c6636ee';
const r = q('SELECT * FROM virtual_learner_profiles WHERE id = ?', id)[0];
if (!r) { console.log('not found'); process.exit(0); }
console.log('=== profile 字段 ===');
for (const k of ['id', 'learningGoal', 'knowledgeLevel', 'simulationMode', 'simulationModel', 'simulationTemperature', 'notes', 'createdAt', 'updatedAt']) {
  console.log(`${k}: ${JSON.stringify(r[k])}`);
}
console.log('\n=== profile JSON (完整) ===');
try { console.log(JSON.stringify(JSON.parse(r.profile || '{}'), null, 2).slice(0, 3000)); } catch (e) { console.log('parse err', e.message); }
console.log('\n=== personalityTraits ===');
console.log(r.personalityTraits);
console.log('\n=== tags ===');
console.log(r.tags);
console.log('\n=== knownConcepts ===');
console.log(r.knownConcepts);
console.log('\n=== struggleConcepts ===');
console.log(r.struggleConcepts);

console.log('\n=== 该 profile 的 sessions ===');
for (const s of q('SELECT id, status, currentStage, completedTasks, totalTasks, createdAt, updatedAt FROM virtual_sessions WHERE virtualProfileId = ? ORDER BY updatedAt DESC', id))
  console.log(JSON.stringify(s));

console.log('\n=== 该 profile 的 storyPool ===');
try {
  const p = JSON.parse(r.profile || '{}');
  const pool = p.storyPool || [];
  console.log('storyPool 条数:', pool.length);
  for (const s of pool) {
    console.log('--- story ---');
    console.log(JSON.stringify(s, null, 2).slice(0, 1500));
  }
} catch (e) { console.log('err', e.message); }

db.close();