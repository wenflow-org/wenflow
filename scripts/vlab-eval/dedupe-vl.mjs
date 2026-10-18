#!/usr/bin/env node
/** dedupe-vl.mjs — 虚拟学习者去重：同一「稳定身份」多行时保留画像最全的行，其余级联删除。
 *
 * 审计加固（2026-10-12）：
 *   - 去重键从 users.name 改为**稳定身份** presetKey → profile.cardKey → userId（userId 兜底使
 *     无身份行各自唯一、永不被合并）；旧实现按 name 分组会误删同名但无关的账号、且并列时结果不确定；
 *   - 同名但无稳定身份的行**只报告不删**（交人工裁决，见 problems）；
 *   - 删除前 VACUUM INTO 备份 + 写 manifest（崩溃也留证据）；默认 dry（需 --yes 执行）；
 *   - 禁删非虚拟学习者（isVirtualLearner≠1 断言）；补齐无 FK 挂靠表（concepts/edges/login_attempts
 *     等）与 batch_experiment_runs 的清理，避免孤儿行。
 * 用法：node scripts/vlab-eval/dedupe-vl.mjs [--yes]   （不带 --yes 即 dry-run 列清单） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = !process.argv.includes('--yes');
const OUT_DIR = path.join(ROOT, 'doc', 'local', 'runs', RUN_DATE());
const DB_PATH = path.join(ROOT, 'backend/prisma/dev.db');
function RUN_DATE() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON;');

const rows = db.prepare("SELECT u.name, u.isVirtualLearner, p.id, p.userId, p.presetKey, p.profile FROM virtual_learner_profiles p JOIN users u ON p.userId = u.id").all();

/** 稳定身份：presetKey → cardKey → userId（兜底唯一）。 */
const identityOf = (r) => {
  if (r.presetKey) return `preset:${r.presetKey}`;
  try { const ck = (JSON.parse(r.profile) || {}).cardKey; if (ck) return `card:${ck}`; } catch { /* 坏档案 */ }
  return `uid:${r.userId}`;
};
const score = (r) => {
  let keys = 0; let card = 0;
  try { const s = (JSON.parse(r.profile) || {}).personaSeed || {}; keys = Object.keys(s).length; card = s.scenarioCard ? 1 : 0; } catch { /* 坏档案 */ }
  return card * 1000 + keys;
};

const groups = new Map();
for (const r of rows) { const k = identityOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }

const plan = [];   // { key, keep, drop:[] }
const problems = [];
const byName = new Map();
for (const r of rows) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }
for (const [name, list] of byName) if (list.length > 1) {
  // 同名但稳定身份不同 → 只报告，不自动合并（防误删无关账号）
  if (new Set(list.map(identityOf)).size > 1) problems.push(`同名「${name}」${list.length} 行但身份不同 → 不自动合并，需人工裁决`);
}
for (const [key, list] of groups) {
  if (list.length < 2) continue;
  // 确定性 tie-break：先按画像分降序，再按 id 升序
  list.sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  plan.push({ key, keep: list[0], drop: list.slice(1) });
}

const allDrop = plan.flatMap((p) => p.drop);
const nonVl = allDrop.filter((r) => r.isVirtualLearner !== 1);
if (nonVl.length) { console.error('FATAL: 待删集合含非虚拟学习者，拒绝继续', nonVl.slice(0, 3).map((r) => r.name)); db.close(); process.exit(1); }

console.log(`画像 ${rows.length}｜去重组 ${plan.length}｜待删 ${allDrop.length}｜同名冲突(不自动合并) ${problems.length}`);
for (const p of plan) console.log(`  ${p.key}: 保留 ${p.keep.id.slice(0, 8)}(分 ${score(p.keep)})，删除 ${p.drop.length} 行`);
for (const p of problems) console.log('  !', p);

fs.mkdirSync(OUT_DIR, { recursive: true });
const baseManifest = {
  at: new Date().toISOString(), dry: DRY, total: rows.length,
  plan: plan.map((p) => ({ key: p.key, keep: p.keep.id, keepUser: p.keep.userId, drop: p.drop.map((d) => ({ id: d.id, userId: d.userId, name: d.name })) })),
  problems,
};
if (DRY) {
  fs.writeFileSync(path.join(OUT_DIR, 'vl-dedupe-manifest.dry.json'), JSON.stringify(baseManifest, null, 1));
  console.log(`dry-run：仅列清单，未删。manifest → ${path.join(OUT_DIR, 'vl-dedupe-manifest.dry.json')}`);
  db.close();
  process.exit(0);
}

// 备份（删真实 users 行前必须有回滚点）
const backupPath = path.join(OUT_DIR, `dev-backup-dedupe-${Date.now()}.db`);
{
  const w = new DatabaseSync(DB_PATH);
  w.exec('PRAGMA busy_timeout=30000;');
  w.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
  w.close();
  console.log('备份 → ' + backupPath);
}

// 清理顺序：业务表 → 无 FK 挂靠表 → 画像/会话/用户
const ORDER = ['learner_evidence', 'learner_projections', 'memory_traces', 'prediction_records', 'misconception_ledger', 'virtual_quick_learn_runs', 'goal_scheduling_ledger', 'domain_event_outbox', 'agent_call_logs', 'prompt_call_logs', 'llm_execution_attempts', 'teaching_sessions', 'learning_paths', 'goal_conversations', 'learning_goals', 'learning_metrics', 'achievements', 'content_feedback', 'projection_access_grants'];
// 无 FK 到 users 的挂靠表（审计 2026-10-12 补齐，避免孤儿）
const ORPHAN_TABLES = ['concepts', 'concept_aliases', 'concept_edges', 'user_agent_model_configs', 'user_agent_configs', 'user_api_configs', 'user_mcp_configs', 'user_skill_configs', 'user_sessions', 'notifications', 'login_attempts', 'password_reset_tokens'];

const manifest = { ...baseManifest, dry: false, backup: backupPath, removed: [], perTable: {} };
fs.writeFileSync(path.join(OUT_DIR, 'vl-dedupe-manifest.json'), JSON.stringify(manifest, null, 1));

let removed = 0;
for (const p of plan) {
  for (const d of p.drop) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM batch_experiment_runs WHERE profileId=?').run(d.id);
      db.prepare('DELETE FROM virtual_sessions WHERE virtualProfileId=?').run(d.id);
      for (const t of [...ORDER, ...ORPHAN_TABLES]) {
        const r = db.prepare('DELETE FROM ' + t + ' WHERE userId=?').run(d.userId);
        manifest.perTable[t] = (manifest.perTable[t] || 0) + r.changes;
      }
      db.prepare('DELETE FROM virtual_learner_profiles WHERE id=?').run(d.id);
      db.prepare('DELETE FROM users WHERE id=? AND isVirtualLearner=1').run(d.userId);
      db.exec('COMMIT');
      removed++;
      manifest.removed.push(d.name);
      fs.writeFileSync(path.join(OUT_DIR, 'vl-dedupe-manifest.json'), JSON.stringify(manifest, null, 1));
    } catch (e) { db.exec('ROLLBACK'); console.error('回滚:', String(e.message).slice(0, 140)); manifest.aborted = true; fs.writeFileSync(path.join(OUT_DIR, 'vl-dedupe-manifest.json'), JSON.stringify(manifest, null, 1)); db.close(); process.exit(1); }
  }
}
console.log(`去重完成，删除 ${removed} 行 | manifest → ${path.join(OUT_DIR, 'vl-dedupe-manifest.json')}`);
db.close();
