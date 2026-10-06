#!/usr/bin/env node
/**
 * apply-views.mjs —— 幂等创建两个 SQLite 来源视图（封条机制落地点）
 * ============================================================================
 * 只对 dev.db 执行 CREATE VIEW IF NOT EXISTS（唯一被授权的写操作）：
 *
 *   v_session_provenance(sessionId, userId, email, provenance,
 *                        synthetic_student, measurement_sealed, startTime)
 *     —— 每个教学会话一行的「来源 + 封条」视图。
 *        measurement_sealed = 1 表示该会话 startTime 早于修复轮上线边界，
 *        其 mastery/wrapup 学习效果标签一律封条（学习效果层不可信；
 *        平台行为层不受影响）。
 *
 *   v_user_provenance(userId, email, provenance, synthetic_student,
 *                     sessionCount, firstStartTime, lastSessionTime,
 *                     sealedSessionCount)
 *     —— 按用户聚合的来源视图。
 *
 * 视图定义由 provenance-rules.mjs 单一事实源生成（同一组 glob + 边界常量），
 * 不在此文件另写一套规则。可重跑（已存在则跳过并校验定义）。
 *
 * 用法：node backend/scripts/data-governance/apply-views.mjs
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProvenanceSqlCase,
  MEASUREMENT_FIX_BOUNDARY_MS,
  SYNTHETIC_STUDENT_PROVENANCE,
} from './provenance-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DB_PATH = resolve(REPO_ROOT, 'backend', 'prisma', 'dev.db');

const provCase = buildProvenanceSqlCase('u.email', 'u.createdAt');
const syntheticList = SYNTHETIC_STUDENT_PROVENANCE.map((p) => `'${p}'`).join(', ');

/** v_session_provenance 的 SQL 文本（用注释讲清用途，SQLite 会原样存入 sqlite_master） */
const SESSION_VIEW_SQL = `CREATE VIEW IF NOT EXISTS v_session_provenance AS
-- 用途（封条）：平台行为层 vs 学习效果层的分界视图。
--   provenance           账号来源分类（mechanical/vl/demo/test-round/human/human-candidate）
--   synthetic_student    1 = 合成学员（其 mastery/wrapup 不构成真人学习效果证据）
--   measurement_sealed   1 = 早于修复轮上线边界，学习效果标签一律封条（禁止当测量证据）；
--                        0 = 修复层生效后产生，可进入新测量口径
--   measurement_boundary 内联常量 = ${MEASUREMENT_FIX_BOUNDARY_MS}（见 provenance-rules.mjs 顶部）
SELECT
  s.id        AS sessionId,
  s.userId    AS userId,
  u.email     AS email,
  ${provCase} AS provenance,
  CASE WHEN (${provCase}) IN (${syntheticList}) THEN 1 ELSE 0 END AS synthetic_student,
  CASE WHEN s.startTime < ${MEASUREMENT_FIX_BOUNDARY_MS} THEN 1 ELSE 0 END AS measurement_sealed,
  s.startTime AS startTime
FROM teaching_sessions s
LEFT JOIN users u ON u.id = s.userId`;

/** v_user_provenance 的 SQL 文本 */
const USER_VIEW_SQL = `CREATE VIEW IF NOT EXISTS v_user_provenance AS
-- 用途：按用户聚合的来源与封条视图（不含逐会话明细）。
SELECT
  u.id        AS userId,
  u.email     AS email,
  ${provCase} AS provenance,
  CASE WHEN (${provCase}) IN (${syntheticList}) THEN 1 ELSE 0 END AS synthetic_student,
  COUNT(s.id) AS sessionCount,
  MIN(s.startTime) AS firstStartTime,
  MAX(s.startTime) AS lastSessionTime,
  SUM(CASE WHEN s.startTime < ${MEASUREMENT_FIX_BOUNDARY_MS} THEN 1 ELSE 0 END) AS sealedSessionCount
FROM users u
LEFT JOIN teaching_sessions s ON s.userId = u.id
GROUP BY u.id, u.email`;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function execWithRetry(db, sql, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      db.exec(sql);
      return true;
    } catch (err) {
      const msg = String(err && (err.errstr || err.message || err));
      const busy = /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(msg);
      if (busy && attempt < maxAttempts) {
        console.log(`  [retry ${attempt}/${maxAttempts}] ${label} 遇到 ${msg}，2s 后重试…`);
        sleepSync(2000);
        continue;
      }
      throw err;
    }
  }
  return false;
}

function existingViewSql(db, name) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name = ?")
    .get(name);
  return row ? row.sql : null;
}

function normalize(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '') // SQLite 存储时省略 IF NOT EXISTS
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  const db = new DatabaseSync(DB_PATH, { readOnly: false });
  try {
    db.exec('PRAGMA busy_timeout = 8000');
    console.log('目标库:', DB_PATH);
    console.log('封条边界常量:', MEASUREMENT_FIX_BOUNDARY_MS, '(' + new Date(MEASUREMENT_FIX_BOUNDARY_MS).toISOString() + ')');
    console.log('');

    for (const [name, sql] of [
      ['v_session_provenance', SESSION_VIEW_SQL],
      ['v_user_provenance', USER_VIEW_SQL],
    ]) {
      const before = existingViewSql(db, name);
      if (before === null) {
        execWithRetry(db, sql, name);
        console.log(`[created] ${name}`);
      } else if (normalize(before) === normalize(sql)) {
        console.log(`[exists]  ${name}（定义一致，跳过）`);
      } else {
        console.log(
          `[WARN]    ${name} 已存在但定义与当前规则不一致。` +
            `为遵守「只允许 CREATE VIEW IF NOT EXISTS」约束，脚本不会自动 DROP；` +
            `如需刷新请人工执行 DROP VIEW ${name}; 后重跑本脚本。`,
        );
      }
    }

    console.log('');
    console.log('─'.repeat(72));
    console.log('自检：SELECT provenance, COUNT(*) FROM v_session_provenance GROUP BY provenance');
    console.log('─'.repeat(72));
    const rows = db
      .prepare(
        'SELECT provenance, COUNT(*) AS sessions, COUNT(DISTINCT userId) AS users FROM v_session_provenance GROUP BY provenance ORDER BY sessions DESC',
      )
      .all();
    for (const r of rows) {
      console.log(
        '  ' + String(r.provenance).padEnd(16) + ' sessions=' + String(r.sessions).padStart(6) + '  users=' + r.users,
      );
    }
    console.log('─'.repeat(72));
  } finally {
    db.close();
  }
}

main();