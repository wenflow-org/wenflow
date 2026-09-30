#!/usr/bin/env node
/**
 * 清理 teaching_sessions.messages 的过期副本（2026-10-01 页面性能优化）。
 *
 * 前提（均已成立）：
 * 1. 这些会话在 teaching_session_messages 侧表有行——store 读（loadTeachingMessages）
 *    侧表有行即权威、不读旧列；列表的 messageCount 子查询同样侧表优先。
 * 2. 直读旧列的 4 处代码已迁移到 store 权威读
 *    （TeachingContextBuilder / feedback-collection ×2 / assemble-learning-state+path-views 批量水合）。
 *
 * messages 均摊 499KB/行：424 个有侧表行的会话残留约 240MB 死副本，内联在热表行里——
 * 任何碰 teaching_sessions 的查询（哪怕 SELECT id）都要扫过这些溢出页，
 * 实测管理台教学会话列表基础扫描 3.5-6s。清副本后热表缩到毫秒级。
 *
 * 幂等：只清「有侧表行且 messages 非空」的行。无侧表行的旧会话不碰
 * （由 backfill-teaching-messages-side-table.mjs 先回灌）。
 * 空间回收：已释放页不参与扫描，无需 VACUUM（dev 可选）。
 *
 * 用法：node scripts/clear-stale-teaching-messages-column.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(here, '..', 'prisma', 'dev.db'));
db.exec('PRAGMA busy_timeout = 5000');

const t0 = Date.now();
const result = db
  .prepare(
    `UPDATE teaching_sessions
     SET messages = NULL
     WHERE messages IS NOT NULL
       AND EXISTS (SELECT 1 FROM teaching_session_messages m WHERE m.sessionId = teaching_sessions.id)`
  )
  .run();
console.log(`已清理 ${result.changes} 个会话的过期 messages 副本，耗时 ${Date.now() - t0}ms`);
console.log('（页空间由 SQLite freelist 复用，如需归还文件系统请手动 VACUUM）');
