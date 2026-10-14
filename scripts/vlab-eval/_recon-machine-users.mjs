// 侦察（只读）：列出所有带 userId 的表，并统计「零学习活动的 @wenflow.local 机器账号」在各表的行数。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });

// 1. 找出所有含 userId 列的表
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
const withUserId = [];
for (const t of tables) {
  const cols = db.prepare(`pragma table_info(${t})`).all().map((c) => c.name);
  if (cols.includes('userId')) withUserId.push(t);
}
console.log('含 userId 列的表 (' + withUserId.length + '):', withUserId.join(', '));

// 2. 候选账号：@wenflow.local + 零学习活动 + 非 admin + 非虚拟
const cand = db.prepare(`
  select u.id, u.email, u.name from users u
  where u.deletedAt is null
    and ifnull(u.isAdmin,0)=0
    and ifnull(u.isVirtualLearner,0)=0
    and u.email like '%@wenflow.local'
    and not exists (select 1 from learning_paths l where l.userId=u.id)
    and not exists (select 1 from goal_conversations g where g.userId=u.id)
    and not exists (select 1 from teaching_sessions s where s.userId=u.id)
    and not exists (select 1 from virtual_learner_profiles v where v.userId=u.id)
`).all();
console.log('\n候选（零活动 @wenflow.local）=', cand.length);
const ids = cand.map((r) => r.id);
const ph = ids.map(() => '?').join(',');

console.log('\n-- 候选在各 userId 表的行数（>0 的才打印）');
let totalRows = 0;
for (const t of withUserId) {
  const n = db.prepare(`select count(*) c from ${t} where userId in (${ph})`).get(...ids).c;
  if (n > 0) { console.log('   ', t.padEnd(30), n); totalRows += n; }
}
console.log('    合计依赖行 =', totalRows);

// 3. 有活动、仍在 270 内的 @wenflow.local 账号（保留观察名单）
const keep = db.prepare(`
  select u.email, u.name,
    (select count(*) from learning_paths l where l.userId=u.id) paths,
    (select count(*) from goal_conversations g where g.userId=u.id) goals,
    (select count(*) from teaching_sessions s where s.userId=u.id) sess
  from users u
  where u.deletedAt is null and ifnull(u.isVirtualLearner,0)=0
    and u.email like '%@wenflow.local'
    and (exists (select 1 from learning_paths l where l.userId=u.id)
      or exists (select 1 from goal_conversations g where g.userId=u.id)
      or exists (select 1 from teaching_sessions s where s.userId=u.id))
  order by paths desc, sess desc
`).all();
console.log('\n-- 有学习活动、将保留的 @wenflow.local 账号 =', keep.length);
for (const r of keep) console.log('   ', String(r.email).padEnd(32), 'paths=' + r.paths, 'goals=' + r.goals, 'sess=' + r.sess);
db.close();
