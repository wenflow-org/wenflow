// 检查 cohort 三人的 setup 进度
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const rows = q(`SELECT id, learningGoal, profile FROM virtual_learner_profiles WHERE tags LIKE '%cohort%'`);
for (const r of rows) {
  const prof = JSON.parse(r.profile || '{}');
  console.log(`${r.id.slice(0, 10)} | ${(r.learningGoal || '').slice(0, 24)} | profileLen=${(r.profile || '').length} | stories=${(prof.storyPool || []).length}`);
}
console.log('cohort profiles:', rows.length);
db.close();
