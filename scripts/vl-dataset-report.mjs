/**
 * 虚拟学习者数据集汇总（**只读**，node:sqlite 直查，不依赖 Prisma 生成客户端）
 *
 * 用途：批量跑完（vl-batch-path.mjs）后，一眼看清"造出来的数据长什么样"：
 * 有多少人、多少条路径、里程碑/任务规模分布、以及（从 learning_paths.aiPromptTemplate 的
 * `planningHints` 里读）scope_size / targetMilestones 的落点是否多样。
 *
 * 用法：
 *   node scripts/vl-dataset-report.mjs --tag=vl50
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const TAG = String(arg('tag') || 'vl50');

const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, p = []) => db.prepare(sql).all(...p);

const learners = all(
  `SELECT p.id AS profileId, p.userId, u.name, p.knowledgeLevel, p.simulationModel, p.createdAt
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.notes LIKE ? OR p.tags LIKE ?`,
  [`%${TAG}%`, `%${TAG}%`],
);

const bucket = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const dist = (m) => [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => `${k}:${v}`).join('  ');

const scope = new Map(), targetM = new Map(), hours = new Map(), levels = new Map(), models = new Map();
let withPath = 0, msTotal = 0, stTotal = 0;
const perLearner = [];

for (const l of learners) {
  bucket(levels, l.knowledgeLevel || '(null)');
  bucket(models, l.simulationModel || '(platform default)');
  const lp = all('SELECT id, status, estimatedHours, aiPromptTemplate FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [l.userId])[0];
  if (!lp) { perLearner.push({ name: l.name, path: false }); continue; }
  withPath += 1;
  const ms = all('SELECT COUNT(*) c FROM milestones WHERE learningPathId=?', [lp.id])[0].c;
  const st = all('SELECT COUNT(*) c FROM subtasks s JOIN milestones m ON m.id = s.milestoneId WHERE m.learningPathId=?', [lp.id])[0].c;
  msTotal += ms; stTotal += st;
  let hint = null;
  try { hint = JSON.parse(lp.aiPromptTemplate || '{}')?.sceneFraming?.normalizedInput?.planningHints || null; } catch { /* ignore */ }
  bucket(scope, hint?.scopeSize ?? '(无)');
  bucket(targetM, hint?.targetMilestones ?? '(无)');
  bucket(hours, lp.estimatedHours ?? '(无)');
  perLearner.push({ name: l.name, path: true, status: lp.status, milestones: ms, subtasks: st, scopeSize: hint?.scopeSize ?? null, estimatedHours: lp.estimatedHours ?? null });
}

const ok = perLearner.filter((x) => x.path);
const byM = [...ok].sort((a, b) => (b.milestones || 0) - (a.milestones || 0));

console.log(`== 数据集汇总（tag=${TAG}）==`);
console.log(`虚拟学习者：${learners.length}｜有路径：${withPath}（${learners.length ? Math.round((withPath / learners.length) * 100) : 0}%）`);
console.log(`里程碑合计：${msTotal}（人均 ${ok.length ? (msTotal / ok.length).toFixed(1) : 0}）｜任务合计：${stTotal}（人均 ${ok.length ? (stTotal / ok.length).toFixed(1) : 0}）`);
console.log(`知识水平分布：${dist(levels)}`);
console.log(`模型分布：${dist(models)}`);
console.log(`scope_size 落点：${dist(scope)}`);
console.log(`targetMilestones 落点：${dist(targetM)}`);
console.log(`预计投入(小时) 落点：${dist(hours)}`);
console.log('');
console.log('每人明细（按里程碑数降序，最多 15 条）：');
for (const r of byM.slice(0, 15)) {
  console.log(`  ${String(r.name).padEnd(22)} M=${String(r.milestones).padStart(2)} S=${String(r.subtasks).padStart(2)} scope=${String(r.scopeSize || '-').padEnd(7)} ${r.estimatedHours ?? '-'}h`);
}
const missing = perLearner.filter((x) => !x.path);
if (missing.length) console.log(`\n未产出路径 ${missing.length} 人：` + missing.slice(0, 10).map((x) => x.name).join('、'));
db.close();
