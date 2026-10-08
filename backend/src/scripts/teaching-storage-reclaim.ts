/**
 * teaching-storage-reclaim.ts —— 数据还债 B1 存量清偿（2026-10-08）。
 *
 * 清两笔止血欠账（量化见 doc/local/STOPGAP-SYSTEMIC-REVIEW-2026-10-08.md）：
 *   1. teaching_session_messages.payload 里的 promptDebug/peerDebug 调试信封
 *      （实测 3.45GB / 占 payload 99.75%，与 prompt_call_logs 冗余）——json_remove 剥离；
 *   2. teaching_sessions.messages 大列在完结会话上的双份存储（1.67GB/722 会话与侧表
 *      逐字节相同）——只对「侧表已有行」的完结会话置 NULL（读路径双读就绪，侧表权威）。
 *
 * 用法：
 *   ts-node --transpile-only src/scripts/teaching-storage-reclaim.ts --dry-run
 *   ts-node --transpile-only src/scripts/teaching-storage-reclaim.ts
 *
 * 注意：旧代码进程若仍在跑，其新写入的 debug 行会在重启后再次出现——重启后可低成本重跑本脚本。
 */
import { prisma } from '../config/database';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 500;

async function main(): Promise<void> {
  // 单次全扫收集目标行（LIKE 无索引，多批重扫 = 每批一次全表扫，57 批要数小时——
  // 一次扫完把 id/字节装内存，之后全部按 id 索引点更新）
  console.log('[reclaim] 单次扫描目标行（LIKE 全扫，约 3-8 分钟）…');
  const scanStart = Date.now();
  const targets = await prisma.$queryRawUnsafe<Array<{ id: number; n: number }>>(
    `SELECT id, LENGTH(CAST(payload AS BLOB)) n FROM teaching_session_messages
     WHERE (payload LIKE '%promptDebug%' OR payload LIKE '%peerDebug%') AND json_valid(payload)
     ORDER BY id`
  );
  const debugBytesBefore = targets.reduce((sum, row) => sum + Number(row.n || 0), 0);
  const columnRows = await prisma.$queryRawUnsafe<Array<{ id: string; n: number }>>(
    `SELECT id, LENGTH(CAST(messages AS BLOB)) n FROM teaching_sessions
     WHERE status='completed' AND messages IS NOT NULL
       AND id IN (SELECT DISTINCT sessionId FROM teaching_session_messages)`
  );
  const columnBytesBefore = columnRows.reduce((sum, row) => sum + Number(row.n || 0), 0);
  console.log(`[reclaim] 扫描完成（${Math.round((Date.now() - scanStart) / 1000)}s）：debug 信封 ${targets.length} 行 / ${(debugBytesBefore / 1e9).toFixed(2)}GB，完结双存列 ${columnRows.length} 行 / ${(columnBytesBefore / 1e9).toFixed(2)}GB，dryRun=${DRY_RUN}`);

  // ── 1) tsm debug 剥离（按 id 索引分批）───────────────────────────────────────
  let strippedRows = 0;
  for (let offset = 0; offset < targets.length; offset += BATCH) {
    const batch = targets.slice(offset, offset + BATCH);
    if (DRY_RUN) { strippedRows += batch.length; continue; }
    const ids = batch.map((r) => r.id);
    const result = await prisma.$executeRawUnsafe(
      `UPDATE teaching_session_messages
       SET payload = json_remove(payload, '$.promptDebug', '$.peerDebug')
       WHERE id IN (${ids.join(',')})`
    );
    strippedRows += result;
    if ((offset / BATCH) % 10 === 0) console.log(`  [strip] 已剥离 ${strippedRows}/${targets.length} 行…`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  // ── 2) 完结会话大列置 NULL（仅侧表已有行的）────────────────────────────────
  let nulledRows = 0;
  if (!DRY_RUN) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE teaching_sessions SET messages = NULL
       WHERE status='completed' AND messages IS NOT NULL
         AND id IN (SELECT DISTINCT sessionId FROM teaching_session_messages)`
    );
    nulledRows = result;
  } else {
    nulledRows = columnRows.length;
  }

  const savedGb = (debugBytesBefore + columnBytesBefore) / 1e9;
  console.log(`[reclaim] 完成：剥离 debug 行=${strippedRows}（${(debugBytesBefore / 1e9).toFixed(2)}GB），置空完结列=${nulledRows} 行（${(columnBytesBefore / 1e9).toFixed(2)}GB），合计释放≈${savedGb.toFixed(2)}GB（进入 freelist，由后续写入复用；主库文件体积需 VACUUM 才收缩）。`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error('[reclaim] 失败:', error);
    void prisma.$disconnect();
    process.exit(1);
  });
