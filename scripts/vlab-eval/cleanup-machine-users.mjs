#!/usr/bin/env node
/**
 * cleanup-machine-users.mjs — 软删「机器/探针账号」，让管理台「真实口径」用户数回到现实。
 *
 * 背景：platform-overview 的 totalUsers 只排除「虚拟学习者 + 命中 TEST_ACCOUNT_PREFIXES 的账号」，
 * 于是 pe-*（评测探针）、ev2_*、随机后缀批量注册等大量非真人账号被算成「真实用户」。
 *
 * 判据（全部满足才入选）：
 *   - email 以 @wenflow.local 结尾（内网域名，真实注册不会落这里）
 *   - 零学习活动：无 learning_paths / goal_conversations / teaching_sessions / virtual_learner_profiles
 *   - 非 admin、非虚拟学习者、未软删
 *   - 不在 KEEP 名单（人工/评审用账号，见下）
 *
 * 分两组汇报：
 *   A. onboard=0 → 从未走完引导流程，自动清理目标
 *   B. onboard=1 → 有人点过引导流，可能是手工建的，只列清单待拍板（默认不动）
 *
 * 安全（照 purge-pe-users.mjs 家法）：默认 dry-run；--yes 才写库；写前 VACUUM INTO 备份 + manifest；
 * 软删（deletedAt/deletedBy/updatedAt）而非物理删——统计口径立即生效且可一键回滚，
 * 物理清除交给既有的 backend/src/scripts/purge-soft-deleted-users.ts。
 *
 * 用法：node scripts/vlab-eval/cleanup-machine-users.mjs [--yes] [--include-onboarded]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const OUT_DIR = path.join(ROOT, 'doc/local/runs/20261014/cleanup-machine-users');
const APPLY = process.argv.includes('--yes');
const INCLUDE_ONBOARDED = process.argv.includes('--include-onboarded');
const OPERATOR = 'cleanup-machine-20261014';

// 人工/评审用账号：名字像真人或可能刻意创建，不自动清。
const KEEP = new Set(['xiaoyun_lin_88', 'reviewer_2026', 'reviewer2_2026']);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout=30000;');

const CAND_SQL = `
  select u.id, u.email, u.name, ifnull(u.onboardingCompleted,0) onboard, u.isAdmin
  from users u
  where u.deletedAt is null
    and ifnull(u.isAdmin,0)=0
    and ifnull(u.isVirtualLearner,0)=0
    and u.email like '%@wenflow.local'
    and not exists (select 1 from learning_paths l where l.userId=u.id)
    and not exists (select 1 from goal_conversations g where g.userId=u.id)
    and not exists (select 1 from teaching_sessions s where s.userId=u.id)
    and not exists (select 1 from virtual_learner_profiles v where v.userId=u.id)
`;
const allCand = db.prepare(CAND_SQL).all().filter((r) => !KEEP.has(String(r.email).split('@')[0]));

const groupA = allCand.filter((r) => r.onboard === 0); // 自动清理目标
const groupB = allCand.filter((r) => r.onboard !== 0); // 列清单待拍板

// 依赖行统计（软删不改这些表，仅用于说明这些账号确实没资产）
const DEP = ['learning_paths', 'goal_conversations', 'teaching_sessions', 'user_sessions', 'learner_projections', 'achievements'];
const depCount = (ids, t) => ids.length ? db.prepare(`select count(*) c from ${t} where userId in (${ids.map(() => '?').join(',')})`).get(...ids).c : 0;

const target = INCLUDE_ONBOARDED ? [...groupA, ...groupB] : groupA;
console.log(`候选（零活动 @wenflow.local，去掉 KEEP ${KEEP.size} 个）= ${allCand.length}`);
console.log(`  A 组 onboard=0 → 本次清理目标 = ${groupA.length}`);
console.log(`  B 组 onboard=1 → 需拍板 = ${groupB.length}${INCLUDE_ONBOARDED ? '（--include-onboarded：并入本次）' : ''}`);
console.log(`\n本次将软删 = ${target.length}`);
const tIds = target.map((r) => r.id);
if (tIds.length) {
  const dep = {}; for (const t of DEP) { const n = depCount(tIds, t); if (n > 0) dep[t] = n; }
  console.log('  依赖行（软删不动，仅佐证无资产）:', JSON.stringify(dep));
}
console.log('\n-- B 组清单（onboard=1，默认保留）');
for (const r of groupB.slice(0, 60)) console.log('   ', String(r.email).padEnd(34), r.name);
if (groupB.length > 60) console.log('   … 其余', groupB.length - 60, '个');

if (!APPLY) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'cleanup.dry.json'), JSON.stringify({
    at: new Date().toISOString(), dry: true, groupA: groupA.map((r) => r.email), groupB: groupB.map((r) => r.email),
  }, null, 1));
  console.log('\ndry-run：未改库。加 --yes 执行软删。清单 → doc/local/runs/20261014/cleanup-machine-users/cleanup.dry.json');
  db.close();
  process.exit(0);
}

if (!target.length) { console.log('\n无目标，退出。'); db.close(); process.exit(0); }

// 备份
fs.mkdirSync(OUT_DIR, { recursive: true });
const backupPath = path.join(OUT_DIR, `dev-backup-${Date.now()}.db`);
{
  const w = new DatabaseSync(DB_PATH);
  w.exec('PRAGMA busy_timeout=30000;');
  w.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
  w.close();
  console.log('\n备份 → ' + backupPath);
}

const now = new Date().toISOString();
const CHUNK = 50;
let done = 0;
const manifest = { at: now, operator: OPERATOR, backup: backupPath, groupA: groupA.length, groupB: groupB.length, includedOnboarded: INCLUDE_ONBOARDED, softDeleted: [] };
for (let i = 0; i < tIds.length; i += CHUNK) {
  const chunk = tIds.slice(i, i + CHUNK);
  const ph = chunk.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    const r = db.prepare(`UPDATE users SET deletedAt = ?, deletedBy = ?, updatedAt = ? WHERE id IN (${ph}) AND ifnull(isAdmin,0)=0`).run(now, OPERATOR, now, ...chunk);
    db.exec('COMMIT');
    done += r.changes;
  } catch (e) { db.exec('ROLLBACK'); console.error('块失败已回滚:', String(e.message).slice(0, 200)); db.close(); process.exit(1); }
}
manifest.softDeletedCount = done;
manifest.softDeleted = target.map((r) => r.email);
fs.writeFileSync(path.join(OUT_DIR, 'cleanup.manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`软删完成 = ${done} 条 | manifest → doc/local/runs/20261014/cleanup-machine-users/cleanup.manifest.json`);

const left = db.prepare(`select count(*) c from users where deletedAt is null and ifnull(isVirtualLearner,0)=0 and email like '%@wenflow.local' and not exists (select 1 from learning_paths l where l.userId=users.id) and not exists (select 1 from goal_conversations g where g.userId=users.id) and not exists (select 1 from teaching_sessions s where s.userId=users.id)`).get().c;
console.log('剩余「零活动 @wenflow.local 且未软删」=', left, '（应为 0 或仅剩 B 组）');
db.close();
