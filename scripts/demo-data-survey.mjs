// 只读调查 backend/prisma/dev.db 中的 demo 学习数据（goal/path/teaching）
// 用法: node demo-data-survey.mjs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
const trunc = (s, n = 120) => {
  if (s == null) return s;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

console.log('===== 表清单 =====');
console.log(q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name).join(', '));

console.log('\n===== users（有学习数据的账号）=====');
const users = q(`
  SELECT u.id, u.name, u.email, u.isVirtualLearner,
    (SELECT COUNT(*) FROM goal_conversations g WHERE g.userId = u.id) AS goals,
    (SELECT COUNT(*) FROM learning_paths p WHERE p.userId = u.id) AS paths,
    (SELECT COUNT(*) FROM teaching_sessions t WHERE t.userId = u.id) AS sessions
  FROM users u
  ORDER BY (goals + paths + sessions) DESC
  LIMIT 20`);
for (const u of users) console.log(JSON.stringify(pick(u, ['name', 'email', 'isVirtualLearner', 'goals', 'paths', 'sessions'])));

console.log('\n===== goal_conversations（非虚拟，含真实诉求）=====');
const gcols = q('PRAGMA table_info(goal_conversations)').map(r => r.name);
console.log('列:', gcols.join(','));
const goals = q(`
  SELECT g.id, u.name, u.email, u.isVirtualLearner, g.stage, g.collectedData
  FROM goal_conversations g JOIN users u ON u.id = g.userId
  ORDER BY g.updatedAt DESC LIMIT 15`);
for (const g of goals) {
  let cd = {};
  try { cd = typeof g.collectedData === 'string' ? JSON.parse(g.collectedData) : (g.collectedData || {}); } catch {}
  const u = cd.understanding || {};
  const cp = cd.confirmedProposal || {};
  console.log(`- [${g.name}/${u.isVirtualLearner ? '虚拟' : '真实'} ${g.stage}] 原话: ${trunc(u.surface_goal, 80)}`);
  console.log(`    问题: ${trunc(u.real_problem, 100)}`);
  console.log(`    方向: ${trunc(cp.learning_direction, 80)} | 交付物: ${trunc(cp.first_deliverable, 80)}`);
}

console.log('\n===== learning_paths（路径名/摘要）=====');
const paths = q(`
  SELECT p.id, u.name, u.isVirtualLearner, p.title AS pathName, p.description, p.status,
    p.totalMilestones, p.estimatedHours,
    (SELECT COUNT(*) FROM milestones m WHERE m.learningPathId = p.id) AS milestones,
    (SELECT COUNT(*) FROM subtasks s JOIN milestones m2 ON m2.id = s.milestoneId WHERE m2.learningPathId = p.id) AS subtasks
  FROM learning_paths p JOIN users u ON u.id = p.userId
  ORDER BY p.updatedAt DESC LIMIT 15`);
for (const p of paths) console.log(`- [${p.name}/${p.isVirtualLearner ? '虚拟' : '真实'} ${p.status}] ${trunc(p.pathName, 60)} | ms=${p.milestones} st=${p.subtasks} h=${p.estimatedHours} | ${trunc(p.description, 70)}`);

console.log('\n===== milestones（真实路径的阶段标题样例）=====');
const mls = q(`
  SELECT m.title, m.goal, m.coreConceptName, u.name, u.isVirtualLearner
  FROM milestones m JOIN learning_paths p ON p.id = m.learningPathId JOIN users u ON u.id = p.userId
  WHERE u.isVirtualLearner = 0
  ORDER BY m.updatedAt DESC LIMIT 20`);
for (const m of mls) console.log(`- [${m.name}] ${trunc(m.title, 50)} | 概念: ${trunc(m.coreConceptName, 40)} | ${trunc(m.goal, 80)}`);

console.log('\n===== teaching_sessions（会话主题/状态）=====');
const sessions = q(`
  SELECT t.id, u.name, u.isVirtualLearner, t.topic, t.status, t.mode, t.taskType,
    length(t.messages) AS msgsLen, t.wrapup IS NOT NULL AS hasWrapup
  FROM teaching_sessions t JOIN users u ON u.id = t.userId
  ORDER BY t.updatedAt DESC LIMIT 15`);
for (const s of sessions) console.log(`- [${s.name}/${s.isVirtualLearner ? '虚拟' : '真实'} ${s.status} ${s.mode} ${s.taskType}] ${trunc(s.topic, 70)} | msgsLen=${s.msgsLen} wrapup=${s.hasWrapup}`);

console.log('\n===== virtual_learner_profiles（虚拟学习者场景设计）=====');
try {
  const vp = q('SELECT * FROM virtual_learner_profiles LIMIT 10');
  const cols = vp.length ? Object.keys(vp[0]) : [];
  console.log('列:', cols.join(','));
  for (const v of vp) {
    const g = v.learningGoal || '';
    const prof = v.profile ? (typeof v.profile === 'string' ? JSON.parse(v.profile) : v.profile) : {};
    console.log(`- ${trunc(v.name, 30)} | goal: ${trunc(typeof g === 'string' ? g : JSON.stringify(g), 100)}`);
    console.log(`    profile: ${trunc(JSON.stringify(pick(prof, ['persona', 'story', 'frictionBudget', 'preferredDomains', 'avoidDomains', 'preferredMotivations'])), 160)}`);
  }
} catch (e) { console.log('virtual_learner_profiles 查询失败:', e.message); }

db.close();
