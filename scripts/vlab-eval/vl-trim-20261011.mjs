#!/usr/bin/env node
/** vl-trim-20261011.mjs — 精简虚拟学习者账号到 5 个（2026-10-11 用户令「精简当前账号，只保留五个」）
 *
 * 保留集：5 个多故事 preset VL（人物立体化延展测试的种子）——
 *   nurse-career-transition / vocational-electrician-exam / zhongkao-streaming /
 *   student-geo-essay / gaokao-science（含 2-3 条既备故事、最富人设）。
 * 删除路径与 vl-cleanup-20261010 同构：预清 userId 挂靠行 → 生产 batch-delete 端点（cascadeDeleteProfile
 *   + 审计）→ 验证。备份 VACUUM INTO 到 20261011/vl-evals。
 * 用法：node scripts/vlab-eval/vl-trim-20261011.mjs [--dry] [--batch=100]
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
const OUT_DIR = path.join(ROOT, 'doc', 'local', 'runs', '20261011', 'vl-evals');
const MANIFEST = path.join(OUT_DIR, 'trim-manifest-20261011.json');

const KEEP_PRESETS = [
  'nurse-career-transition',
  'vocational-electrician-exam',
  'zhongkao-streaming',
  'student-geo-essay',
  'gaokao-science',
];

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie, refreshAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// ---------- 1) 保留/删除集 ----------
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=30000');

const profiles = db.prepare('SELECT id, userId, presetKey, createdAt FROM virtual_learner_profiles').all();
const userFlag = new Map(db.prepare('SELECT id, isVirtualLearner FROM users').all().map((u) => [u.id, u.isVirtualLearner === 1]));

const keepPresetSet = new Set(KEEP_PRESETS);
// 活会话保护（审计 2026-10-12）：30 分钟内有写入的 running 会话 → 其画像一并保留，
// 避免删掉正在跑评/后台批处理的账号（cascadeDeleteProfile 会连 virtual_sessions 一起删）。
const liveMs = Date.now() - 30 * 60 * 1000;
const liveProfiles = new Set(db.prepare(
  "SELECT DISTINCT virtualProfileId pid FROM virtual_sessions WHERE status='running' AND updatedAt >= ?"
).all(liveMs).map((r) => r.pid));
const keep = [];
const del = [];
for (const p of profiles) {
  if (keepPresetSet.has(String(p.presetKey || ''))) {
    keep.push({ profileId: p.id, userId: p.userId, presetKey: p.presetKey, reason: 'preset' });
  } else if (liveProfiles.has(p.id)) {
    keep.push({ profileId: p.id, userId: p.userId, presetKey: p.presetKey || '-', reason: 'live-session' });
  } else {
    del.push({ profileId: p.id, userId: p.userId, presetKey: p.presetKey || '-', createdAt: new Date(Number(p.createdAt)).toISOString() });
  }
}
log(`总画像 ${profiles.length}｜保留 ${keep.length}｜待删 ${del.length}`);
log('保留:' + keep.map((k) => `${k.presetKey}(${k.userId.slice(0, 8)}${k.reason === 'live-session' ? '·live' : ''})`).join(', '));

// 断言：保留集必须覆盖全部目标 preset（拼写漂移/被误删即失败）；允许额外 live 保护项
const keptPresets = new Set(keep.filter((k) => k.reason === 'preset').map((k) => k.presetKey));
const missing = KEEP_PRESETS.filter((k) => !keptPresets.has(k));
if (missing.length) {
  console.error(`FATAL: 保留集缺 preset ${missing.join(', ')}（presetKey 拼写漂移？）`);
  process.exit(1);
}

const notVl = del.filter((d) => userFlag.get(d.userId) === false);
if (notVl.length) {
  console.error('FATAL: 待删集合含非虚拟学习者', notVl.slice(0, 3));
  process.exit(1);
}

const delProfileIds = del.map((d) => d.profileId);
const delUserIds = [...new Set(del.map((d) => d.userId))];
fs.mkdirSync(OUT_DIR, { recursive: true });
// dry 清单写独立文件（审计 2026-10-12）：旧实现 dry 覆盖正式 manifest → 审计记录被 dry 结果冲掉
const dryManifest = MANIFEST.replace(/\.json$/, '.dry.json');
fs.writeFileSync(DRY ? dryManifest : MANIFEST, JSON.stringify({
  at: new Date().toISOString(), dry: DRY,
  totals: { profiles: profiles.length, keep: keep.length, delete: del.length },
  keepPresets: KEEP_PRESETS,
  keep: keep.map((k) => ({ presetKey: k.presetKey, profileId: k.profileId, userId: k.userId })),
  deleteUsers: delUserIds.length,
}, null, 1));
log(`manifest → ${DRY ? dryManifest : MANIFEST}`);
db.close();
if (DRY) { log('dry 模式：到此为止'); process.exit(0); }

// ---------- 2) 备份 ----------
// 每次运行独立时间戳备份（审计 2026-10-12）：旧实现「备份已存在则跳过」会用上一次运行的陈旧
// 快照冒充「本次删除前状态」，回滚会静默丢掉两次运行之间的所有变更。
const backupPath = path.join(OUT_DIR, `dev-backup-trim-${Date.now()}.db`);
log('备份开始（VACUUM INTO）…');
const w = new DatabaseSync(DB_PATH);
w.exec('PRAGMA busy_timeout=30000');
w.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
w.close();
log('备份完成 → ' + backupPath);

// ---------- 3) 预清端点级联不覆盖的挂靠行 ----------
const RISK_TABLES = ['concepts', 'concept_aliases', 'concept_edges', 'user_agent_model_configs', 'user_agent_configs', 'user_api_configs', 'user_mcp_configs', 'user_skill_configs', 'user_sessions', 'notifications', 'login_attempts', 'password_reset_tokens'];
const wdb = new DatabaseSync(DB_PATH);
wdb.exec('PRAGMA busy_timeout=30000');
wdb.exec('PRAGMA foreign_keys=ON');
const preDeleted = {};
const CHUNK = 40;
for (let i = 0; i < delUserIds.length; i += CHUNK) {
  const chunk = delUserIds.slice(i, i + CHUNK);
  const ph = chunk.map(() => '?').join(',');
  wdb.exec('BEGIN');
  try {
    for (const t of RISK_TABLES) {
      const r = wdb.prepare(`DELETE FROM ${t} WHERE userId IN (${ph})`).run(...chunk);
      preDeleted[t] = (preDeleted[t] || 0) + r.changes;
    }
    wdb.exec('COMMIT');
  } catch (e) { wdb.exec('ROLLBACK'); console.error('预清块失败，已回滚:', e.message); process.exit(1); }
}
log('预清完成: ' + JSON.stringify(preDeleted));

// ---------- 4) 生产端点分批删除 ----------
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
for (let i = 0; i < delProfileIds.length; i += BATCH) {
  const chunk = delProfileIds.slice(i, i + BATCH);
  let r = await api('POST', '/api/admin/virtual-learners/batch-delete', { profileIds: chunk });
  // 401/403：共享 cookie 被并发进程踢了 → 认领/重登后重发本批一次（审计 2026-10-12）
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
  log(`批次 ${i}/${delProfileIds.length}: +${(d.deleted || []).length} 删, ${(d.skipped || []).length} 跳过, ${(d.errors || []).length} 失败`);
  if (r.status !== 200) { log('  响应: ' + r.text); if (!(d.deleted || []).length) results.errors.push({ chunk: `${i}`, http: r.status }); }
}

// ---------- 5) 验证 ----------
const vdb = new DatabaseSync(DB_PATH, { readOnly: true });
const after = {
  profiles: vdb.prepare('SELECT COUNT(*) n FROM virtual_learner_profiles').get().n,
  vlUsers: vdb.prepare('SELECT COUNT(*) n FROM users u WHERE u.isVirtualLearner=1').get().n,
  keepIntact: vdb.prepare(`SELECT COUNT(*) n FROM virtual_learner_profiles WHERE id IN (${keep.map(() => '?').join(',')})`).get(...keep.map((k) => k.profileId)).n,
  orphanConcepts: delUserIds.length ? vdb.prepare(`SELECT COUNT(*) n FROM concepts WHERE userId IN (${delUserIds.slice(0, 50).map(() => '?').join(',')})`).get(...delUserIds.slice(0, 50)).n : 0,
};
vdb.close();
fs.writeFileSync(MANIFEST, JSON.stringify({
  at: new Date().toISOString(), dry: false,
  totals: { profiles: profiles.length, keep: keep.length, delete: del.length, actuallyDeleted: results.deleted.length },
  keepPresets: KEEP_PRESETS,
  keep: keep.map((k) => ({ presetKey: k.presetKey, profileId: k.profileId, userId: k.userId })),
  preDeleted, results, after,
}, null, 1));
log(`验证: 剩余画像 ${after.profiles}｜剩余 VL 用户 ${after.vlUsers}｜保留集完好 ${after.keepIntact}/${keep.length}｜孤儿概念抽查 ${after.orphanConcepts}`);
log(`manifest → ${MANIFEST}`);
if (after.keepIntact !== keep.length) { console.error('FATAL: 保留集受损'); process.exit(1); }
// 失败必须非零退出（审计 2026-10-12）：旧实现 API 全 401/失败也打印「完成」并退出 0 → 静默假成功
const failedChunks = results.chunks.filter((c) => c.status !== 200).length;
if (results.errors.length > 0 || failedChunks > 0) {
  console.error(`FATAL: 删除未完全成功：errors=${results.errors.length}｜非 200 批次=${failedChunks}`);
  process.exit(1);
}
log('完成');
