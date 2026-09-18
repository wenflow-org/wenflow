/**
 * SQLite 空间回收（一次性，可重复运行）
 *
 * 为什么需要：`log-retention.service` 只**删行**——SQLite 删除后只把页放回 freelist，
 * **不会缩小文件**。实测 dev 主库 1648 MB 中 **661 MB 是空闲页**（有效数据 987 MB）；
 * 同一现象也解释了"清了日志但磁盘不降"。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/vacuum-database.ts            # 只报告（dry-run）
 *   npx ts-node --transpile-only src/scripts/vacuum-database.ts --apply    # wal_checkpoint + VACUUM
 *
 * 注意：
 * - VACUUM 需要 ≈2× 库文件的临时空间，并对整库加**独占锁**（期间写入阻塞）；
 * - 请在低写入窗口执行，且**先备份**；
 * - 仅 SQLite 有意义；Postgres 等 provider 直接跳过。
 */
import 'dotenv/config';
import prisma from '../config/database';

interface PageStats {
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  totalBytes: number;
  liveBytes: number;
  freeBytes: number;
}

const fmt = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

async function readStats(): Promise<PageStats> {
  const pageSize = Number((await prisma.$queryRawUnsafe<Array<{ page_size: number }>>('PRAGMA page_size'))[0]?.page_size ?? 0);
  const pageCount = Number((await prisma.$queryRawUnsafe<Array<{ page_count: number }>>('PRAGMA page_count'))[0]?.page_count ?? 0);
  const freelistCount = Number((await prisma.$queryRawUnsafe<Array<{ freelist_count: number }>>('PRAGMA freelist_count'))[0]?.freelist_count ?? 0);
  return {
    pageSize,
    pageCount,
    freelistCount,
    totalBytes: pageSize * pageCount,
    liveBytes: pageSize * (pageCount - freelistCount),
    freeBytes: pageSize * freelistCount,
  };
}

function report(label: string, stats: PageStats): void {
  console.log(`[vacuum] ${label}：文件 ${fmt(stats.totalBytes)}｜有效数据 ${fmt(stats.liveBytes)}｜空闲可回收 ${fmt(stats.freeBytes)}`);
}

async function main(): Promise<void> {
  const isSqlite = (process.env.DATABASE_URL || '').trim().startsWith('file:');
  if (!isSqlite) {
    console.log('[vacuum] 当前 DATABASE_URL 不是 SQLite（file:），无需本脚本');
    return;
  }
  if (process.env.DATABASE_URL?.trim().startsWith('file::memory:')) {
    console.log('[vacuum] 内存库（file::memory:），跳过');
    return;
  }

  const apply = process.argv.includes('--apply');
  const before = await readStats();
  report('执行前', before);

  if (before.freeBytes <= 0) {
    console.log('[vacuum] 没有空闲页可回收（文件已是紧凑状态）');
    return;
  }

  if (!apply) {
    console.log(`[vacuum] dry-run：加 --apply 执行 wal_checkpoint(TRUNCATE) + VACUUM，预计回收 ${fmt(before.freeBytes)}`);
    console.log('[vacuum] 提醒：需要 ≈2× 文件大小的临时空间，且期间整库独占（写入阻塞）');
    return;
  }

  const startedAt = Date.now();
  // 先把 WAL 落盘并截断（该 PRAGMA **有返回行**，只能用 queryRaw），再 VACUUM 重写主库文件
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  await prisma.$executeRawUnsafe('VACUUM');
  const after = await readStats();
  report('执行后', after);
  console.log(`[vacuum] 完成：回收 ${fmt(Math.max(0, before.totalBytes - after.totalBytes))}，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[vacuum] 执行失败:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
