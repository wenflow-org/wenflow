#!/usr/bin/env node
/** vl-cleanup-20261010.mjs — 清理旧虚拟学习者账号（2026-10-10 用户令「清理账号，太多之前的虚拟学习者账号了」）
 *
 * 保留集（三重并集，宁多勿误删）：
 *   1. cohort-epoch2（FSRS 深度轨 19 人，backend/scripts/measurement-verify/cohort-epoch2.json 按 userId）
 *   2. batch5a/5b 名单（80 人，按画像 tag 命中；含 realclass 波一/波二证据课）
 *   3. 建号 >= 2026-10-10 的全部账号（当日工作产物一律不动）
 * 删除路径：走生产 batch-delete 端点（逐人 cascadeDeleteProfile + 审计留痕），不另写 DB 删除链；
 *   端点级联不覆盖的 userId 挂靠行（concepts/aliases/edges、user_* 配置、notifications、
 *   login_attempts 等，预检实测 3.1 万行）先按块直删并计入 manifest。
 * 用法：node scripts/vlab-eval/vl-cleanup-20261010.mjs [--dry] [--batch=100]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry');
const BATCH = Number((process.argv.find((a) => a.startsWith('--batch=')) || '').split('=')[1]) || 100;
const BASE = 'http://127.0.0.1:3011';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const OUT_DIR = path.join(ROOT, 'doc', 'local', 'runs', '20261010', 'vl-evals');
const MANIFEST = path.join(OUT_DIR, 'cleanup-manifest-20261010.json');
const CUTOFF = '2026-10-10T00:00:00+08:00';

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie, refreshAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// ---------- 1) 保留/删除集 ----------
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=30000');

const cohort = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/scripts/measurement-verify/cohort-epoch2.json'), 'utf8'));
const cohortArr = Array.isArray(cohort) ? cohort : (cohort.vls || cohort.profiles || Object.values(cohort));
const keepUserIds = new Set(cohortArr.map((v) => v.userId).filter(Boolean));

const keepTags = new Set([
  ...fs.readFileSync(path.join(OUT_DIR, 'batch5a-ids.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
  ...fs.readFileSync(path.join(OUT_DIR, 'batch5b-ids.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
]);

const profiles = db.prepare('SELECT id, userId, tags, createdAt FROM virtual_learner_profiles').all();
const userFlag = new Map(db.prepare('SELECT id, isVirtualLearner FROM users').all().map((u) => [u.id, u.isVirtualLearner === 1]));
const cutoffMs = Date.parse(CUTOFF);

// 保留集：cohort-epoch2（userId）∪ batch5a/5b（tag）∪ 真·活跃会话（30min 内有写入的 running 会话）
// 注意：不用「建号 >= 某日」规则——批1-4 账号建号跨当地 10-09 夜→10-10 晨，日期规则会误保留。
const keep = new Set();
const del = [];
const liveMs = Date.now() - 30 * 60 * 1000;
const liveProfiles = new Set(db.prepare(
  "SELECT DISTINCT virtualProfileId pid FROM virtual_sessions WHERE status='running' AND updatedAt >= ?"
).all(liveMs).map((r) => r.pid));
for (const p of profiles) {
  const tags = (() => { try { return JSON.parse(p.tags || '[]'); } catch { return []; } })();
  if (keepUserIds.has(p.userId) || tags.some((t) => keepTags.has(t)) || liveProfiles.has(p.id)) {
    keep.add(p.id);
  } else {
    del.push({ profileId: p.id, userId: p.userId, createdAt: new Date(Number(p.createdAt)).toISOString(), tags: tags.slice(0, 4) });
  }
}
log(`总画像 ${profiles.length}｜保留 ${keep.size}｜待删 ${del.length}`);
const byDay = {};
for (const d of del) { const k = d.createdAt.slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
log('待删建号分布: ' + JSON.stringify(byDay));

// 防御：待删集合里绝不允许出现非虚拟学习者（端点也会拒，这里提前断言）
const notVl = del.filter((d) => userFlag.get(d.userId) === false);
if (notVl.length) {
  console.error('FATAL: 待删集合含非虚拟学习者', notVl.slice(0, 3));
  process.exit(1);
}

const delProfileIds = del.map((d) => d.profileId);
const delUserIds = [...new Set(del.map((d) => d.userId))];
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({
  at: new Date().toISOString(), dry: DRY, cutoff: CUTOFF,
  totals: { profiles: profiles.length, keep: keep.size, delete: del.length },
  keepRule: ['cohort-epoch2 userIds', 'batch5a/5b tags', '30min 内活跃 running 会话'],
  deleteUsers: delUserIds.length, deleteProfiles: delProfileIds, byDay,
}, null, 1));
log(`manifest → ${MANIFEST}`);
db.close();
if (DRY) { log('dry 模式：到此为止'); process.exit(0); }

// ---------- 2) 备份（VACUUM INTO 一致性快照） ----------
// 每次运行独立时间戳备份（审计 2026-10-12）：旧「存在则跳过」会用陈旧快照冒充本次删除前状态
const backupPath = path.join(OUT_DIR, `dev-backup-${Date.now()}.db`);
log('备份开始（VACUUM INTO，1.2GB 约需 1-2 分钟）…');
{
  const w = new DatabaseSync(DB_PATH);
  w.exec('PRAGMA busy_timeout=30000');
  w.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
  w.close();
  log('备份完成 → ' + backupPath);
}

// ---------- 3) 预清端点级联不覆盖的挂靠行（按 userId，分块事务） ----------
const RISK_TABLES = ['concepts', 'concept_aliases', 'concept_edges', 'user_agent_model_configs', 'user_agent_configs', 'user_api_configs', 'user_mcp_configs', 'user_skill_configs', 'user_sessions', 'notifications', 'login_attempts', 'password_reset_tokens'];
const wdb = new DatabaseSync(DB_PATH);
wdb.exec('PRAGMA busy_timeout=30000');
wdb.exec('PRAGMA foreign_keys=ON');
const preDeleted = {};
/** 清单个批次的 userId 挂靠行（事务内）。审计 2026-10-12：改成按批调用，与端点删除交错。 */
function preCleanBatch(userIds) {
  if (!userIds.length) return;
  const ph = userIds.map(() => '?').join(',');
  wdb.exec('BEGIN');
  try {
    for (const t of RISK_TABLES) {
      const r = wdb.prepare(`DELETE FROM ${t} WHERE userId IN (${ph})`).run(...userIds);
      preDeleted[t] = (preDeleted[t] || 0) + r.changes;
    }
    wdb.exec('COMMIT');
  } catch (e) {
    wdb.exec('ROLLBACK');
    console.error('预清块失败，已回滚:', String(e.message).slice(0, 160));
    process.exit(1);
  }
}

// ---------- 3+4) 按批交错删除（先清该批挂靠行 → 再走端点删该批画像） ----------
// 审计 2026-10-12：旧实现「先清全部 target 的挂靠行 → 再分批删画像」非事务——中途失败会让
// **尚未删除**的账号 concepts/edges/配置被清空（画像还在、概念没了）。改为逐批交错，失败只影响当前批。
let cookie = await getAdminCookie(BASE, envGet);
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(600_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) };
};

const results = { deleted: [], skipped: [], errors: [], chunks: [] };
for (let i = 0; i < del.length; i += BATCH) {
  const batch = del.slice(i, i + BATCH);
  const chunkUserIds = [...new Set(batch.map((b) => b.userId))];
  const chunk = batch.map((b) => b.profileId);
  preCleanBatch(chunkUserIds); // 先清本批挂靠行
  let r = await api('POST', '/api/admin/virtual-learners/batch-delete', { profileIds: chunk });
  // 401/403：共享 cookie 被并发进程踢 → 认领/重登后重发本批一次（审计 2026-10-12）
  if (r.status === 401 || r.status === 403) {
    log(`批次 ${i} 收到 ${r.status} → 刷新 admin cookie 重发`);
    cookie = await refreshAdminCookie(BASE, envGet, cookie);
    r = await api('POST', '/api/admin/virtual-learners/batch-delete', { profileIds: chunk });
  }
  const d = r.json?.data || {};
  results.deleted.push(...(d.deleted || []));
  results.skipped.push(...(d.skipped || []));
  results.errors.push(...(d.errors || []));
  results.chunks.push({ range: `${i}-${i + chunk.length}`, status: r.status, deleted: (d.deleted || []).length, skipped: (d.skipped || []).length, errors: (d.errors || []).length });
  log(`批次 ${i}/${del.length}: +${(d.deleted || []).length} 删, ${(d.skipped || []).length} 跳过, ${(d.errors || []).length} 失败`);
  if (r.status !== 200) {
    log('  响应: ' + r.text);
    if (!(d.deleted || []).length) results.errors.push({ chunk: `${i}`, http: r.status });
  }
}
log('预清完成: ' + JSON.stringify(preDeleted));

// ---------- 5) 验证 ----------
const vdb = new DatabaseSync(DB_PATH, { readOnly: true });
const after = {
  profiles: vdb.prepare('SELECT COUNT(*) n FROM virtual_learner_profiles').get().n,
  vlUsers: vdb.prepare('SELECT COUNT(*) n FROM users u WHERE u.isVirtualLearner=1').get().n,
  cohortIntact: vdb.prepare(`SELECT COUNT(*) n FROM virtual_learner_profiles WHERE userId IN (${[...keepUserIds].map(() => '?').join(',')})`).get(...keepUserIds).n,
  orphanConcepts: vdb.prepare(`SELECT COUNT(*) n FROM concepts WHERE userId IN (${delUserIds.slice(0, 50).map(() => '?').join(',')})`).get(...delUserIds.slice(0, 50)).n,
};
vdb.close();
fs.writeFileSync(MANIFEST, JSON.stringify({
  at: new Date().toISOString(), dry: false, cutoff: CUTOFF,
  totals: { profiles: profiles.length, keep: keep.size, delete: del.length, actuallyDeleted: results.deleted.length },
  keepRule: ['cohort-epoch2 userIds', 'batch5a/5b tags', '30min 内活跃 running 会话'],
  byDay, preDeleted, results, after,
}, null, 1));
log(`验证: 剩余画像 ${after.profiles}｜剩余 VL 用户 ${after.vlUsers}｜cohort 完好 ${after.cohortIntact}/19｜孤儿概念抽查 ${after.orphanConcepts}`);
log(`manifest 更新 → ${MANIFEST}`);
if (after.cohortIntact !== keepUserIds.size) { console.error('FATAL: cohort 保留集受损'); process.exit(1); }
// 失败必须非零退出（审计 2026-10-12）：旧实现 API 全失败/401 也打印「完成」退出 0 → 静默假成功
const failedChunks = results.chunks.filter((c) => c.status !== 200).length;
if (results.errors.length > 0 || failedChunks > 0) {
  console.error(`FATAL: 删除未完全成功：errors=${results.errors.length}｜非 200 批次=${failedChunks}`);
  process.exit(1);
}
log('完成');
