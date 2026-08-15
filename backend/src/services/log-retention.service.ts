import prisma from '../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { runBackgroundTask } from './background-task-tracker.service';
import type { ApplicationLifecycle } from './application-lifecycle.service';

export const DEFAULT_LOG_RETENTION_DAYS = 90;
export const DEFAULT_LOG_RETENTION_INTERVAL_HOURS = 6;
export const LOG_RETENTION_CUTOFF_BUFFER_MS = 60 * 60 * 1000;
export const LOG_RETENTION_BATCH_SIZE = 5000;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLIS_PER_HOUR = 60 * 60 * 1000;

export interface LogRetentionTableSpec {
  table: 'agent_call_logs' | 'llm_execution_attempts' | 'prompt_call_logs';
  timeField: 'calledAt' | 'startedAt' | 'createdAt';
}

export const LOG_RETENTION_TABLES: readonly LogRetentionTableSpec[] = [
  { table: 'agent_call_logs', timeField: 'calledAt' },
  { table: 'llm_execution_attempts', timeField: 'startedAt' },
  { table: 'prompt_call_logs', timeField: 'createdAt' }
];

export interface LogRetentionTableResult {
  table: string;
  deletedRows: number;
  durationMs: number;
}

export interface LogRetentionRunResult {
  dryRun: boolean;
  cutoff: Date;
  skipped?: boolean;
  tables: LogRetentionTableResult[];
  totalDeletedRows: number;
  durationMs: number;
}

interface LogRetentionFindManyArgs {
  where: Record<string, { lt: Date }>;
  orderBy: Record<string, 'asc'>;
  take: number;
  select: { id: true };
}

interface LogRetentionDeleteManyArgs {
  where: { id: { in: string[] } };
}

interface LogRetentionModel {
  findMany(args: LogRetentionFindManyArgs): Promise<Array<{ id: string }>>;
  deleteMany(args: LogRetentionDeleteManyArgs): Promise<{ count: number }>;
}

type LogRetentionDatabase = Pick<
  PrismaClient,
  'agent_call_logs' | 'llm_execution_attempts' | 'prompt_call_logs' | '$queryRawUnsafe'
>;

function isSqliteDatabaseUrl(value: string | undefined): boolean {
  return (value || '').trim().startsWith('file:');
}

export function resolveLogRetentionDays(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_LOG_RETENTION_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[log-retention] LOG_RETENTION_DAYS 无效（${value}），使用默认 ${DEFAULT_LOG_RETENTION_DAYS} 天`);
    return DEFAULT_LOG_RETENTION_DAYS;
  }
  return parsed;
}

export function resolveLogRetentionIntervalMs(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_LOG_RETENTION_INTERVAL_HOURS * MILLIS_PER_HOUR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(
      `[log-retention] LOG_RETENTION_INTERVAL_HOURS 无效（${value}），使用默认 ${DEFAULT_LOG_RETENTION_INTERVAL_HOURS} 小时`
    );
    return DEFAULT_LOG_RETENTION_INTERVAL_HOURS * MILLIS_PER_HOUR;
  }
  return parsed * MILLIS_PER_HOUR;
}

export function isLogRetentionDryRun(value: string | undefined): boolean {
  return value === '1';
}

export interface LogRetentionServiceOptions {
  database?: LogRetentionDatabase;
  retentionDays?: number;
  intervalMs?: number;
  dryRun?: boolean;
  lifecycle?: Pick<ApplicationLifecycle, 'isDraining'>;
}

export class LogRetentionService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private inFlightRun: Promise<LogRetentionRunResult | null> | null = null;
  private readonly database: LogRetentionDatabase;
  private readonly retentionDays: number;
  private readonly intervalMs: number;
  private readonly dryRun: boolean;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null;

  constructor(options: LogRetentionServiceOptions = {}) {
    this.database = options.database ?? prisma;
    this.retentionDays = options.retentionDays ?? resolveLogRetentionDays(process.env.LOG_RETENTION_DAYS);
    this.intervalMs = options.intervalMs ?? resolveLogRetentionIntervalMs(process.env.LOG_RETENTION_INTERVAL_HOURS);
    this.dryRun = options.dryRun ?? isLogRetentionDryRun(process.env.LOG_RETENTION_DRY_RUN);
    this.lifecycle = options.lifecycle ?? null;
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  isRunning(): boolean {
    return this.inFlight;
  }

  /** 启动定时清理并立即执行一轮；幂等，重复调用仅补充 lifecycle 引用 */
  start(lifecycle: Pick<ApplicationLifecycle, 'isDraining'>): void {
    this.lifecycle = lifecycle;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.scheduleRun();
    }, this.intervalMs);
    this.timer.unref?.();
    logger.info('[log-retention] 定时清理已启动', {
      retentionDays: this.retentionDays,
      intervalHours: this.intervalMs / MILLIS_PER_HOUR,
      dryRun: this.dryRun,
      cutoffBufferMs: LOG_RETENTION_CUTOFF_BUFFER_MS,
      batchSize: LOG_RETENTION_BATCH_SIZE,
      tables: LOG_RETENTION_TABLES.map(item => item.table)
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
      logger.warn('[log-retention] 上一轮清理仍在进行，跳过本轮');
      return;
    }
    runBackgroundTask('logs.retention.run', () => this.run());
  }

  /** 执行一轮清理；已有轮次在途时跳过并返回 null */
  run(): Promise<LogRetentionRunResult | null> {
    if (this.inFlight) {
      logger.warn('[log-retention] 上一轮清理仍在进行，跳过本轮');
      return Promise.resolve(null);
    }
    const run = this.performRun()
      .catch((error) => {
        logger.error('[log-retention] 清理失败', {
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

  private async performRun(): Promise<LogRetentionRunResult> {
    if (this.lifecycle?.isDraining()) {
      logger.info('[log-retention] 服务正在关闭，跳过本轮清理');
      return {
        dryRun: this.dryRun,
        cutoff: new Date(),
        skipped: true,
        tables: [],
        totalDeletedRows: 0,
        durationMs: 0
      };
    }

    const startedAt = Date.now();
    // cutoff = now - 保留期 - 1h 缓冲（容忍各端时钟偏差，避免误删窗口内新写入的日志）
    const cutoff = new Date(startedAt - this.retentionDays * MILLIS_PER_DAY - LOG_RETENTION_CUTOFF_BUFFER_MS);
    const tables: LogRetentionTableResult[] = [];

    for (const spec of LOG_RETENTION_TABLES) {
      const tableStartedAt = Date.now();
      const deletedRows = await this.cleanupTable(spec, cutoff);
      const durationMs = Date.now() - tableStartedAt;
      tables.push({ table: spec.table, deletedRows, durationMs });
      logger.info('[log-retention] 清理完成', {
        table: spec.table,
        deletedRows,
        durationMs,
        cutoff: cutoff.toISOString(),
        dryRun: this.dryRun
      });
    }

    await this.checkpoint();

    return {
      dryRun: this.dryRun,
      cutoff,
      tables,
      totalDeletedRows: tables.reduce((sum, item) => sum + item.deletedRows, 0),
      durationMs: Date.now() - startedAt
    };
  }

  /** 分页循环删除：每次取最旧的一批，直到空批；每批独立事务（Prisma 自动） */
  private async cleanupTable(spec: LogRetentionTableSpec, cutoff: Date): Promise<number> {
    const model = this.database[spec.table] as unknown as LogRetentionModel;
    let deletedRows = 0;
    for (;;) {
      const batch = await model.findMany({
        where: { [spec.timeField]: { lt: cutoff } },
        orderBy: { [spec.timeField]: 'asc' },
        take: LOG_RETENTION_BATCH_SIZE,
        select: { id: true }
      });
      if (batch.length === 0) break;
      if (this.dryRun) {
        deletedRows += batch.length;
        continue;
      }
      const result = await model.deleteMany({
        where: { id: { in: batch.map(row => row.id) } }
      });
      deletedRows += result.count;
    }
    return deletedRows;
  }

  /** 收尾触发 SQLite WAL checkpoint，回收 WAL 空间；非 SQLite 或无 WAL 时静默跳过 */
  private async checkpoint(): Promise<void> {
    if (!isSqliteDatabaseUrl(process.env.DATABASE_URL)) return;
    try {
      await this.database.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      logger.warn('[log-retention] WAL checkpoint 失败（忽略，不影响清理结果）', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const logRetentionService = new LogRetentionService();
