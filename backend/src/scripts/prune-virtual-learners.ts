/* eslint-disable no-console -- 运维 CLI：面向人读的输出 */
/**
 * 清理虚拟学习者（**默认 dry-run**）。
 *
 * 背景：虚拟学习者列表被脚本/实验堆到 89 个，深度测试前需要收敛。
 * 口径（默认）：删掉 `isVirtualLearner=1 AND email LIKE '%@test.local'` 的临时 VL；
 * **保留** `builtin_*@preset.local` 的内置预设（深度测试要用）。
 *
 * 安全：
 *   1. 默认只打印计划，不改数据；`--apply` 才执行；
 *   2. `--apply` 前**自动备份**主库到 `data/backups/dev.db.bak-<时间戳>`（data/ 已 gitignore）；
 *   3. 主链（users→learning_paths→milestones→subtasks、users→teaching_sessions→messages）由
 *      数据库 `ON DELETE CASCADE` 处理；**无外键**的 14 张表按 userId 显式删除；
 *   4. 执行后做孤儿检查（子表引用不到父表的行数必须为 0）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/prune-virtual-learners.ts                # 看计划
 *   npx ts-node --transpile-only src/scripts/prune-virtual-learners.ts --apply        # 执行
 *   npx ts-node --transpile-only src/scripts/prune-virtual-learners.ts --keep=a@x.com,b@y.com
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');
const BACKUP_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'backups');

const APPLY = process.argv.includes('--apply');
/** `--orphans`：只清理悬空子行（父行已不存在的历史遗留），不动用户。 */
const ORPHANS_ONLY = process.argv.includes('--orphans');
const KEEP = (process.argv.find((a) => a.startsWith('--keep='))?.slice('--keep='.length) || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/** 无外键、需按 userId 显式清理的子表（顺序无关，但先子后父更干净）。 */
const CHILD_TABLES_BY_USER = [
  'agent_call_logs',
  'prompt_call_logs',
  'learner_evidence',
  'learner_projections',
  'llm_execution_attempts',
  'goal_scheduling_ledger',
  'login_attempts',
  'virtual_quick_learn_runs',
  'prediction_records',
  'memory_traces',
  'misconception_ledger',
  'user_sessions',
  'domain_event_outbox',
  'concepts',
  'concept_aliases',
  'concept_edges',
];

function openDb(readonly = false): sqlite3.Database {
  return new sqlite3.Database(DB_PATH, readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
}

function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params as never, function onDone(error: Error | null) {
      if (error) reject(error);
      else resolve({ changes: this?.changes ?? 0 });
    });
  });
}

function all<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params as never, (error: Error | null, rows: T[]) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function get<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params as never, (error: Error | null, row: T) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

/** 待删 VL 的筛选条件（内置预设一律保留）。 */
function targetWhere(): { sql: string; params: unknown[] } {
  const clauses = ["COALESCE(isVirtualLearner,0)=1", "email LIKE '%@test.local'"];
  const params: unknown[] = [];
  if (KEEP.length) {
    const placeholders = KEEP.map(() => '?').join(',');
    clauses.push(`email NOT IN (${placeholders})`);
    clauses.push(`id NOT IN (${placeholders})`);
    params.push(...KEEP, ...KEEP);
  }
  return { sql: clauses.join(' AND '), params };
}

/** 悬空子行清理（父行已不存在）：顺序必须子 → 父。 */
const ORPHAN_CLEANUP: Array<{ label: string; sql: string }> = [
  { label: 'teaching_session_messages', sql: 'DELETE FROM teaching_session_messages WHERE NOT EXISTS (SELECT 1 FROM teaching_sessions s WHERE s.id = sessionId)' },
  { label: 'session_finalization_operations', sql: 'DELETE FROM session_finalization_operations WHERE NOT EXISTS (SELECT 1 FROM teaching_sessions s WHERE s.id = sessionId)' },
  { label: 'subtasks', sql: 'DELETE FROM subtasks WHERE NOT EXISTS (SELECT 1 FROM milestones m WHERE m.id = milestoneId)' },
  { label: 'path_generation_stage_items', sql: 'DELETE FROM path_generation_stage_items WHERE NOT EXISTS (SELECT 1 FROM path_generation_runs r WHERE r.id = runId)' },
  { label: 'path_generation_runs', sql: 'DELETE FROM path_generation_runs WHERE NOT EXISTS (SELECT 1 FROM learning_paths p WHERE p.id = learningPathId)' },
  { label: 'milestones', sql: 'DELETE FROM milestones WHERE NOT EXISTS (SELECT 1 FROM learning_paths p WHERE p.id = learningPathId)' },
];

async function cleanupOrphans(db: sqlite3.Database) {
  console.log('悬空子行清理（父行已不存在的历史遗留）：');
  let total = 0;
  for (const item of ORPHAN_CLEANUP) {
    const result = await run(db, item.sql);
    total += result.changes;
    console.log(`  ${item.label.padEnd(32)} ${result.changes}`);
  }
  console.log(`  合计 ${total} 行`);
  return total;
}

async function main() {
  const db = openDb(!APPLY);

  if (ORPHANS_ONLY) {
    if (!APPLY) {
      console.log(`主库：${DB_PATH}`);
      console.log('模式：DRY-RUN（--orphans 只打印；加 --apply 执行）');
      const dry = openDb(true);
      let planned = 0;
      for (const item of ORPHAN_CLEANUP) {
        const row = await get<{ n: number }>(dry, item.sql.replace(/^DELETE FROM (\w+) WHERE/, 'SELECT COUNT(*) AS n FROM $1 WHERE'));
        const n = Number(row?.n || 0);
        planned += n;
        if (n) console.log(`  ${item.label.padEnd(32)} ${n}`);
      }
      console.log(`  合计 ${planned} 行`);
      dry.close();
      db.close();
      return;
    }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `dev.db.bak-${stamp}`);
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`已备份主库 → ${backupPath}`);
    await run(db, 'PRAGMA foreign_keys = ON');
    await cleanupOrphans(db);
    db.close();
    return;
  }

  const where = targetWhere();
  const targets = await all<{ id: string; name: string; email: string }>(
    db,
    `SELECT id, name, email FROM users WHERE ${where.sql} ORDER BY createdAt`,
    where.params,
  );

  console.log(`主库：${DB_PATH}`);
  console.log(`模式：${APPLY ? 'APPLY（会改数据）' : 'DRY-RUN（只打印）'}｜待删 VL：${targets.length} 个`);
  if (KEEP.length) console.log(`保留白名单：${KEEP.join(', ')}`);
  if (!targets.length) {
    console.log('没有匹配的虚拟学习者。');
    db.close();
    return;
  }
  console.log('待删清单（前 20）：');
  for (const row of targets.slice(0, 20)) {
    console.log(`  - ${row.name || '(无名)'}｜${row.email}`);
  }
  if (targets.length > 20) console.log(`  … 其余 ${targets.length - 20} 个`);

  const ids = targets.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  console.log('\n关联数据（按 userId）：');
  let totalRows = 0;
  for (const table of CHILD_TABLES_BY_USER) {
    const row = await get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE userId IN (${placeholders})`, ids);
    const n = Number(row?.n || 0);
    totalRows += n;
    if (n) console.log(`  ${table.padEnd(26)} ${n}`);
  }
  for (const table of ['learning_paths', 'teaching_sessions', 'goal_conversations', 'virtual_learner_profiles']) {
    const row = await get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE userId IN (${placeholders})`, ids);
    const n = Number(row?.n || 0);
    totalRows += n;
    if (n) console.log(`  ${table.padEnd(26)} ${n}  （级联删除）`);
  }
  console.log(`  合计 ${totalRows} 行`);

  if (!APPLY) {
    console.log('\n（dry-run 结束；加 --apply 执行，执行前会自动备份主库）');
    db.close();
    return;
  }

  // ---- 备份 ----
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `dev.db.bak-${stamp}`);
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`\n已备份主库 → ${backupPath}`);

  // ---- 执行：先无外键子表，再删 users（主链走 CASCADE）----
  await run(db, 'PRAGMA foreign_keys = ON');
  const deleted: Record<string, number> = {};
  for (const table of CHILD_TABLES_BY_USER) {
    const result = await run(db, `DELETE FROM ${table} WHERE userId IN (${placeholders})`, ids);
    if (result.changes) deleted[table] = result.changes;
  }
  const usersResult = await run(db, `DELETE FROM users WHERE id IN (${placeholders})`, ids);
  deleted.users = usersResult.changes;

  console.log('\n删除结果：');
  for (const [table, n] of Object.entries(deleted)) console.log(`  ${table.padEnd(26)} ${n}`);

  // ---- 孤儿检查 ----
  const orphans: Array<[string, number]> = [];
  const check = async (label: string, sql: string) => {
    const row = await get<{ n: number }>(db, sql);
    const n = Number(row?.n || 0);
    if (n) orphans.push([label, n]);
  };
  await check('learning_paths 无主', 'SELECT COUNT(*) AS n FROM learning_paths p LEFT JOIN users u ON u.id = p.userId WHERE u.id IS NULL');
  await check('milestones 无主', 'SELECT COUNT(*) AS n FROM milestones m LEFT JOIN learning_paths p ON p.id = m.learningPathId WHERE p.id IS NULL');
  await check('subtasks 无主', 'SELECT COUNT(*) AS n FROM subtasks s LEFT JOIN milestones m ON m.id = s.milestoneId WHERE m.id IS NULL');
  await check('teaching_sessions 无主', 'SELECT COUNT(*) AS n FROM teaching_sessions s LEFT JOIN users u ON u.id = s.userId WHERE u.id IS NULL');
  await check('teaching_session_messages 无主', 'SELECT COUNT(*) AS n FROM teaching_session_messages msg LEFT JOIN teaching_sessions s ON s.id = msg.sessionId WHERE s.id IS NULL');

  const remainVl = await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE COALESCE(isVirtualLearner,0)=1');
  console.log(`\n剩余虚拟学习者：${remainVl?.n}`);
  console.log(orphans.length ? `⚠️ 孤儿行：${orphans.map(([k, n]) => `${k}=${n}`).join('｜')}` : '✅ 孤儿检查通过（无悬空引用）');
  db.close();
}

void main().catch((error) => {
  console.error('[prune] 失败', error);
  process.exitCode = 1;
});
