import prisma from '../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { runBackgroundTask } from './background-task-tracker.service';
import type { ApplicationLifecycle } from './application-lifecycle.service';

/**
 * 审计数据 90 天清理（独立于 log-retention，避免破坏既有日志表清理）。
 * 覆盖 admin_audit_logs / login_attempts 两张审计表。
 * 环境变量：AUDIT_RETENTION_DAYS（默认 90）、AUDIT_CLEANUP_INTERVAL_HOURS（默认 24）。
 */

export const DEFAULT_AUDIT_RETENTION_DAYS = 90;
export const DEFAULT_AUDIT_CLEANUP_INTERVAL_HOURS = 24;
export const AUDIT_CLEANUP_BATCH_SIZE = 5000;
export const AUDIT_CLEANUP_CUTOFF_BUFFER_MS = 60 * 60 * 1000;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLIS_PER_HOUR = 60 * 60 * 1000;

export const AUDIT_CLEANUP_TABLES = ['admin_audit_logs', 'login_attempts'] as const;
export type AuditCleanupTable = (typeof AUDIT_CLEANUP_TABLES)[number];

export interface AuditCleanupTableResult {
  table: AuditCleanupTable;
  deletedRows: number;
  durationMs: number;
}

export interface AuditCleanupRunResult {
  skipped?: boolean;
  cutoff: Date;
  tables: AuditCleanupTableResult[];
  totalDeletedRows: number;
  durationMs: number;
}

interface AuditCleanupFindManyArgs {
  where: { createdAt: { lt: Date } };
  orderBy: { createdAt: 'asc' };
  take: number;
  select: { id: true };
}

interface AuditCleanupDeleteManyArgs {
  where: { id: { in: string[] } };
}

interface AuditCleanupModel {
  findMany(args: AuditCleanupFindManyArgs): Promise<Array<{ id: string }>>;
  deleteMany(args: AuditCleanupDeleteManyArgs): Promise<{ count: number }>;
}

type AuditCleanupDatabase = Pick<PrismaClient, 'admin_audit_logs' | 'login_attempts'>;

export function resolveAuditRetentionDays(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_AUDIT_RETENTION_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[audit-cleanup] AUDIT_RETENTION_DAYS 无效（${value}），使用默认 ${DEFAULT_AUDIT_RETENTION_DAYS} 天`);
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }
  return parsed;
}

export function resolveAuditCleanupIntervalMs(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_AUDIT_CLEANUP_INTERVAL_HOURS * MILLIS_PER_HOUR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(
      `[audit-cleanup] AUDIT_CLEANUP_INTERVAL_HOURS 无效（${value}），使用默认 ${DEFAULT_AUDIT_CLEANUP_INTERVAL_HOURS} 小时`
    );
    return DEFAULT_AUDIT_CLEANUP_INTERVAL_HOURS * MILLIS_PER_HOUR;
  }
  return parsed * MILLIS_PER_HOUR;
}

export class AuditCleanupService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private inFlightRun: Promise<AuditCleanupRunResult | null> | null = null;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null = null;
  private readonly database: AuditCleanupDatabase;
  private readonly retentionDays: number;
  private readonly intervalMs: number;

  constructor(
    options: {
      database?: AuditCleanupDatabase;
      retentionDays?: number;
      intervalMs?: number;
      lifecycle?: Pick<ApplicationLifecycle, 'isDraining'>;
    } = {}
  ) {
    this.database = options.database ?? prisma;
    this.retentionDays = options.retentionDays ?? resolveAuditRetentionDays(process.env.AUDIT_RETENTION_DAYS);
    this.intervalMs = options.intervalMs ?? resolveAuditCleanupIntervalMs(process.env.AUDIT_CLEANUP_INTERVAL_HOURS);
    this.lifecycle = options.lifecycle ?? null;
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  /** 启动定时清理并立即执行一轮；幂等，重复调用仅补充 lifecycle 引用 */
  start(lifecycle: Pick<ApplicationLifecycle, 'isDraining'>): void {
    this.lifecycle = lifecycle;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.scheduleRun();
    }, this.intervalMs);
    this.timer.unref?.();
    logger.info('[audit-cleanup] 审计数据定时清理已启动', {
      retentionDays: this.retentionDays,
      intervalHours: this.intervalMs / MILLIS_PER_HOUR,
      tables: AUDIT_CLEANUP_TABLES
    });
    this.scheduleRun();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlightRun;
  }

  private scheduleRun(): void {
    if (this.inFlight) {
      logger.warn('[audit-cleanup] 上一轮清理仍在进行，跳过本轮');
      return;
    }
    runBackgroundTask('audit.cleanup.run', () => this.run());
  }

  /** 执行一轮清理；已有轮次在途时跳过并返回 null */
  run(): Promise<AuditCleanupRunResult | null> {
    if (this.inFlight) {
      logger.warn('[audit-cleanup] 上一轮清理仍在进行，跳过本轮');
      return Promise.resolve(null);
    }
    const run = this.performRun()
      .catch((error) => {
        logger.error('[audit-cleanup] 清理失败', {
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      })
      .finally(() => {
        this.inFlight = false;
        this.inFlightRun = null;
      });
    this.inFlight = true;
    this.inFlightRun = run;
    return run;
  }

  private async performRun(): Promise<AuditCleanupRunResult> {
    if (this.lifecycle?.isDraining()) {
      logger.info('[audit-cleanup] 服务正在关闭，跳过本轮清理');
      return { cutoff: new Date(), skipped: true, tables: [], totalDeletedRows: 0, durationMs: 0 };
    }

    const startedAt = Date.now();
    // cutoff = now - 保留期 - 1h 缓冲（容忍各端时钟偏差，避免误删窗口内新写入的审计）
    const cutoff = new Date(startedAt - this.retentionDays * MILLIS_PER_DAY - AUDIT_CLEANUP_CUTOFF_BUFFER_MS);
    const tables: AuditCleanupTableResult[] = [];

    for (const table of AUDIT_CLEANUP_TABLES) {
      const tableStartedAt = Date.now();
      const deletedRows = await this.cleanupTable(table, cutoff);
      const durationMs = Date.now() - tableStartedAt;
      tables.push({ table, deletedRows, durationMs });
      logger.info('[audit-cleanup] 清理完成', {
        table,
        deletedRows,
        durationMs,
        cutoff: cutoff.toISOString()
      });
    }

    return {
      cutoff,
      tables,
      totalDeletedRows: tables.reduce((sum, item) => sum + item.deletedRows, 0),
      durationMs: Date.now() - startedAt
    };
  }

  /** 分页循环删除：每次取最旧的一批，直到空批；每批独立事务（Prisma 自动） */
  private async cleanupTable(table: AuditCleanupTable, cutoff: Date): Promise<number> {
    const model = this.database[table] as unknown as AuditCleanupModel;
    let deletedRows = 0;
    for (;;) {
      const batch = await model.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: 'asc' },
        take: AUDIT_CLEANUP_BATCH_SIZE,
        select: { id: true }
      });
      if (batch.length === 0) break;
      const result = await model.deleteMany({
        where: { id: { in: batch.map(row => row.id) } }
      });
      deletedRows += result.count;
    }
    return deletedRows;
  }
}

export const auditCleanupService = new AuditCleanupService();
