// 只读：按 backend/src/utils/test-account.ts 的「真实用户」判据在现网库实算。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });

const PREFIXES = ['e2e_', 'audit_probe_', 'uxaudit_', 'ui_check', 'motion_review', 'qa_audit_', 'shotsnap',
  'verify_real_user', 'vcheck', 'vqa_audit', 'align_', 'qa_delete_test_', 'uitest', 'uxtest', 'ui_audit_',
  'audit_', 'eval', 'simb_', 'vqa_', 'vizcheck', 'logocheck', 'pe-finalverify', 'menutest', 'goalprobe',
  'ev_p', 'gw-upload-probe'];
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = new RegExp(`^(${PREFIXES.map(esc).join('|')})`, 'i');
function isTest(u) {
  const id = String(u.id || ''), name = String(u.name || ''), email = String(u.email || '');
  if (/^virtual_/.test(id)) return true;
  if (/@test\.local$/i.test(email)) return true;
  if (/^virtual_/i.test(email)) return true;
  if (RE.test(email)) return true;
  if (RE.test(name)) return true;
  return false;
}

const rows = db.prepare('select id,email,name,isVirtualLearner,deletedAt,role,isAdmin from users').all();
const nonDeleted = rows.filter((r) => r.deletedAt == null);
const real = nonDeleted.filter((r) => !r.isVirtualLearner && !isTest(r));
const excluded = nonDeleted.filter((r) => r.isVirtualLearner || isTest(r));
console.log('users 总行数（含软删）  =', rows.length);
console.log('未删除账号             =', nonDeleted.length, '（软删', rows.length - nonDeleted.length, '）');
console.log('  → 真实用户（现口径）  =', real.length);
console.log('  → 被排除（虚拟+测试） =', excluded.length);
console.log('     · isVirtualLearner=true  =', nonDeleted.filter((r) => r.isVirtualLearner).length);
console.log('     · 非虚拟但判为测试账号   =', nonDeleted.filter((r) => !r.isVirtualLearner && isTest(r)).length);

const byPre = {};
for (const r of excluded) {
  if (r.isVirtualLearner) { byPre['(isVirtualLearner 标记)'] = (byPre['(isVirtualLearner 标记)'] || 0) + 1; continue; }
  const e = String(r.email || '').toLowerCase();
  let hit = '(未命中前缀/其他)';
  for (const p of PREFIXES) { if (e.startsWith(p.toLowerCase())) { hit = p; break; } }
  byPre[hit] = (byPre[hit] || 0) + 1;
}
console.log('\n-- 被判「测试账号」的构成');
for (const [k, v] of Object.entries(byPre).sort((a, b) => b[1] - a[1])) console.log('   ', k.padEnd(26), v);

console.log('\n-- 真实用户 email 域名分布');
const dom = {};
for (const r of real) { const e = String(r.email || ''); const d = e.includes('@') ? e.slice(e.indexOf('@')) : '(无)'; dom[d] = (dom[d] || 0) + 1; }
for (const [k, v] of Object.entries(dom).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('   ', k.padEnd(26), v);

console.log('\n-- 真实用户样本（前 25）');
for (const r of real.slice(0, 25)) console.log('   ', String(r.email).padEnd(38), String(r.name || '').slice(0, 14), 'admin=' + r.isAdmin);

// 这 270 里有多少真的有学习行为？（口径外机器账号的判别补充视角）
const ids = real.map((r) => r.id);
const ph = ids.map(() => '?').join(',');
const q = (sql) => db.prepare(sql).get(...ids);
console.log('\n-- 270 个「真实用户」的活跃度');
console.log('   有 lastLoginAt（登录过）      =', q(`select count(*) c from users where id in (${ph}) and lastLoginAt is not null`).c);
console.log('   完成 onboarding               =', q(`select count(*) c from users where id in (${ph}) and onboardingCompleted=1`).c);
console.log('   有过学习路径                  =', q(`select count(distinct userId) c from learning_paths where userId in (${ph})`).c);
console.log('   有过目标对话                  =', q(`select count(distinct userId) c from goal_conversations where userId in (${ph})`).c);
console.log('   有过教学会话                  =', q(`select count(distinct userId) c from teaching_sessions where userId in (${ph})`).c);
const withPath = q(`select count(distinct userId) c from learning_paths where userId in (${ph})`).c;
console.log('\n   即：', real.length, '个里有', real.length - withPath, '个从未产生过任何学习路径');

// 非内网域名的账号（外部真人候选）
const outside = real.filter((r) => !String(r.email).endsWith('@wenflow.local'));
console.log('\n-- 非 @wenflow.local 的真实用户 =', outside.length);
for (const r of outside) console.log('   ', r.email, '/', r.name);
db.close();

