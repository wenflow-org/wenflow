/**
 * 后端进程启动登记表（回收「确证孤儿」判据的活性底座）
 *
 * 问题：虚拟会话回收器的快档需要区分「死于进程重启的孤儿」和「活着但安静（慢生成/外部驱动暂停）」。
 * 会话表是被动记录，两种状态表观相同（都无写入）。本表给每个后端进程一个可心跳的「代际」凭证：
 *
 *   快档孤儿判据 = 会话最后写入 < 所有存活后端进程中**最早**的启动时间
 *   （即：写入发生时不存在任何至今仍活着的进程代际 → 写它的那一代已死）
 *
 * 聚合取 MIN 是保守方向：任一长活进程都能把 floor 压回更早，让「在它启动后写过」的会话全部受保护；
 * dev 后端（ts-node-dev 频繁重启）只影响 MAX，不影响 MIN。无存活登记（全部进程刚死）时快档跳过本轮，
 * 宁可漏收（硬档 24h 兜底），不可误收。
 */

import crypto from 'node:crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backend_boot_registry (
  instance_id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  boot_at INTEGER NOT NULL,
  hb_at INTEGER NOT NULL
)`;

export interface BootRegistryLike {
  /** 进程登记 + 心跳（幂等 upsert，可重复调用） */
  heartbeat(now: Date): Promise<void>;
  /**
   * 存活进程的最早启动时间（活性窗口内的心跳才算存活）。
   * 无存活登记返回 null（调用方应跳过快档，而非全量回收）。
   */
  oldestLiveBoot(now: Date, livenessMs: number): Promise<Date | null>;
}

export class PrismaBootRegistry implements BootRegistryLike {
  private readonly instanceId = crypto.randomUUID();
  private readonly bootAt = new Date();
  private tableReady = false;

  constructor(private readonly db: Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'> = prisma) {}

  private async ensureTable(): Promise<void> {
    if (this.tableReady) return;
    await this.db.$executeRawUnsafe(ENSURE_TABLE_SQL);
    this.tableReady = true;
  }

  async heartbeat(now: Date): Promise<void> {
    await this.ensureTable();
    const boot = this.bootAt.getTime();
    const hb = now.getTime();
    await this.db.$executeRawUnsafe(
      `INSERT INTO backend_boot_registry (instance_id, pid, boot_at, hb_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET pid = excluded.pid, hb_at = excluded.hb_at`,
      this.instanceId, process.pid, boot, hb
    );
  }

  async oldestLiveBoot(now: Date, livenessMs: number): Promise<Date | null> {
    await this.ensureTable();
    const cutoff = now.getTime() - livenessMs;
    const rows = await this.db.$queryRawUnsafe<{ min_boot: number | null }[]>(
      'SELECT MIN(boot_at) AS min_boot FROM backend_boot_registry WHERE hb_at >= ?',
      cutoff
    );
    const minBoot = rows?.[0]?.min_boot;
    return Number.isFinite(minBoot) ? new Date(Number(minBoot)) : null;
  }
}

/** 生产单例：进程生命周期内固定 instanceId，随回收器心跳 */
export const backendBootRegistry = new PrismaBootRegistry();

/** 心跳失败的容错包装：登记表故障只降级（快档跳过），不阻断回收主流程 */
export async function heartbeatSafely(now: Date): Promise<boolean> {
  try {
    await backendBootRegistry.heartbeat(now);
    return true;
  } catch (error) {
    logger.warn('[boot-registry] 心跳失败（快档将跳过本轮）', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
