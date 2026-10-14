// 只读侦察：可疑账号详查 + pe-* 规模 + 候选前缀族分布。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
const all = (s, ...a) => db.prepare(s).all(...a);
const get = (s, ...a) => db.prepare(s).get(...a);
const dt = (v) => { const n = Number(v); return Number.isFinite(n) && n > 1e12 ? new Date(n).toISOString().slice(0, 16) : String(v || '').slice(0, 16); };

const sus = ['xiaoyun_lin_88', 'reviewer_2026', 'reviewer2_2026', '123', 'mb', 'qq', 'went', 'adad', '789', 'a123', 'a789'];
console.log('-- 可疑账号详查');
for (const e of sus) {
  const r = get('select email,name,createdAt,lastLoginAt,onboardingCompleted from users where email=?', e + '@wenflow.local');
  if (!r) { console.log('  ', e, '(不存在)'); continue; }
  console.log('  ', e.padEnd(16), 'created=' + dt(r.createdAt), 'lastLogin=' + dt(r.lastLoginAt), 'onboard=' + r.onboardingCompleted, 'name=' + r.name);
}

console.log('\n-- pe-*@wenflow.local');
console.log('   总数 =', get("select count(*) c from users where email like 'pe-%@wenflow.local'").c,
  '| 未删 =', get("select count(*) c from users where deletedAt is null and email like 'pe-%@wenflow.local'").c);

const rows = all(`select email from users
  where deletedAt is null and ifnull(isAdmin,0)=0 and ifnull(isVirtualLearner,0)=0
    and email like '%@wenflow.local'
    and not exists (select 1 from learning_paths l where l.userId=users.id)
    and not exists (select 1 from goal_conversations g where g.userId=users.id)
    and not exists (select 1 from teaching_sessions s where s.userId=users.id)
    and not exists (select 1 from virtual_learner_profiles v where v.userId=users.id)`);
console.log('\n-- 候选(' + rows.length + ') 按前缀族分布');
const fam = {};
for (const r of rows) {
  const lp = r.email.split('@')[0];
  let k;
  if (/^pe-abdlv/.test(lp)) k = 'pe-abdlv*-rw-*';
  else if (/^pe-/.test(lp)) k = 'pe-* (其他)';
  else if (/^(s\d|f\d|gu-|seq-|mv-|obsweep|align_|uitest|e2e|vizcheck|vcheck|logocheck|audit_|motion_|gw-upload|simB_|ev2_)/.test(lp)) k = lp.replace(/[-_].*$/, '') + '*';
  else if (/^[a-z]{1,4}$/.test(lp)) k = '(极短字母: ' + lp + ')';
  else k = '(其他)';
  fam[k] = (fam[k] || 0) + 1;
}
for (const [k, v] of Object.entries(fam).sort((a, b) => b[1] - a[1])) console.log('  ', k.padEnd(26), v);
db.close();
