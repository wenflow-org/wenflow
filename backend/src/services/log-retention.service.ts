import prisma from '../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { runBackgroundTask } from './background-task-tracker.service';
import { boundSimulationLog } from './virtual-lab/simulation-log-buffer';
import type { ApplicationLifecycle } from './application-lifecycle.service';

export const DEFAULT_LOG_RETENTION_DAYS = 90;
export const DEFAULT_LOG_RETENTION_INTERVAL_HOURS = 6;
export const LOG_RETENTION_CUTOFF_BUFFER_MS = 60 * 60 * 1000;
export const LOG_RETENTION_BATCH_SIZE = 5000;
/** 旧虚拟会话 `logs` 裁剪后的字节预算（比写入期预算更小：这些是过期现场，只留尾部） */
export const DEFAULT_VIRTUAL_SESSION_LOG_MAX_BYTES = 256 * 1024;
/**
 * 虚拟会话 logs 的**冷却窗**（小时）。日志保留窗是 90 天，但会话轨迹"冷得很快"：
 * 实测 >24h 的 26 个会话就占 91 MB（总 92 MB），且状态全是终态。等 90 天等于不回收。
 * 冷却窗内的会话由写入期预算（默认 2 MB）兜住，不会被这里裁。
 */
export const DEFAULT_VIRTUAL_SESSION_LOG_TRIM_AFTER_HOURS = 24;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLIS_PER_HOUR = 60 * 60 * 1000;

export interface LogRetentionTableSpec {
  table: 'agent_call_logs' | 'llm_execution_attempts' | 'prompt_call_logs' | 'login_attempts';
  timeField: 'calledAt' | 'startedAt' | 'createdAt';
}

export const LOG_RETENTION_TABLES: readonly LogRetentionTableSpec[] = [
  { table: 'agent_call_logs', timeField: 'calledAt' },
  { table: 'llm_execution_attempts', timeField: 'startedAt' },
  { table: 'prompt_call_logs', timeField: 'createdAt' },
  // 登录尝试遥测：安全调查窗口 90 天足够，且该表增速高于业务表（数据实证 4.6k 行）
  { table: 'login_attempts', timeField: 'createdAt' }
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
  /** 旧虚拟会话 `logs` 裁剪结果（只裁列、不删行） */
  virtualSessions?: VirtualSessionTrimResult;
  totalDeletedRows: number;
  durationMs: number;
}

export interface VirtualSessionTrimResult {
  scanned: number;
  trimmed: number;
  durationMs: number;
}

/**
 * 旧虚拟会话 logs 裁剪用的最小委托（仅用到 findMany/update，便于单测注入 mock）。
 * `updatedAt` 不参与裁剪条件之外的排序，故可安全按 id 游标翻页。
 */
interface VirtualSessionLogModel {
  findMany(args: Record<string, unknown>): Promise<Array<{ id: string; logs: string | null }>>;
  update(args: { where: { id: string }; data: { logs: string } }): Promise<unknown>;
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
  'agent_call_logs' | 'llm_execution_attempts' | 'prompt_call_logs' | 'login_attempts' | '$queryRawUnsafe'
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

export function resolveVirtualSessionLogMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.VIRTUAL_SESSION_LOG_RETENTION_MAX_BYTES;
  if (!raw || raw.trim() === '') return DEFAULT_VIRTUAL_SESSION_LOG_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 16 * 1024) return DEFAULT_VIRTUAL_SESSION_LOG_MAX_BYTES;
  return Math.floor(parsed);
}

export function resolveVirtualSessionLogTrimAfterHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.VIRTUAL_SESSION_LOG_TRIM_AFTER_HOURS;
  if (!raw || raw.trim() === '') return DEFAULT_VIRTUAL_SESSION_LOG_TRIM_AFTER_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_VIRTUAL_SESSION_LOG_TRIM_AFTER_HOURS;
  return Math.floor(parsed);
}

export interface LogRetentionServiceOptions {
  database?: LogRetentionDatabase;
  retentionDays?: number;
  intervalMs?: number;
  dryRun?: boolean;
  /** 旧虚拟会话 logs 裁剪预算（字节）；<=0 则关闭该步骤 */
  virtualSessionLogMaxBytes?: number;
  /** 虚拟会话 logs 的冷却窗（小时，默认 24）；<=0 则关闭该步骤 */
  virtualSessionLogTrimAfterHours?: number;
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
  private readonly virtualSessionLogMaxBytes: number;
  private readonly virtualSessionLogTrimAfterHours: number;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null;

  constructor(options: LogRetentionServiceOptions = {}) {
    this.database = options.database ?? prisma;
    this.retentionDays = options.retentionDays ?? resolveLogRetentionDays(process.env.LOG_RETENTION_DAYS);
    this.intervalMs = options.intervalMs ?? resolveLogRetentionIntervalMs(process.env.LOG_RETENTION_INTERVAL_HOURS);
    this.dryRun = options.dryRun ?? isLogRetentionDryRun(process.env.LOG_RETENTION_DRY_RUN);
    this.virtualSessionLogMaxBytes = options.virtualSessionLogMaxBytes ?? resolveVirtualSessionLogMaxBytes();
    this.virtualSessionLogTrimAfterHours = options.virtualSessionLogTrimAfterHours ?? resolveVirtualSessionLogTrimAfterHours();
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

    const virtualSessions = await this.trimVirtualSessionLogs();

    await this.checkpoint();

    return {
      dryRun: this.dryRun,
      cutoff,
      tables,
      virtualSessions,
      totalDeletedRows: tables.reduce((sum, item) => sum + item.deletedRows, 0),
      durationMs: Date.now() - startedAt
    };
  }

  /**
   * 旧虚拟会话 `logs` 裁剪：只改列、不删行。
   *
   * 为什么需要：虚拟会话的 `logs` 是追加式轨迹，实测有**单行 31.9 MB**（整表 92 MB 几乎全在此）。
   * VACUUM 只回收 freelist 空闲页，**不会**缩小仍存活的大字段——必须先把列裁小。
   */
  private async trimVirtualSessionLogs(): Promise<VirtualSessionTrimResult> {
    const startedAt = Date.now();
    const budget = this.virtualSessionLogMaxBytes;
    const delegate = (this.database as unknown as { virtual_sessions?: VirtualSessionLogModel }).virtual_sessions;
    if (budget <= 0 || this.virtualSessionLogTrimAfterHours <= 0 || !delegate?.findMany || !delegate?.update) {
      return { scanned: 0, trimmed: 0, durationMs: 0 };
    }
    // 冷却窗（默认 24h）而非 90 天日志保留窗：会话轨迹冷得快，等 90 天等于不回收
    const trimCutoff = new Date(startedAt - this.virtualSessionLogTrimAfterHours * MILLIS_PER_HOUR);
    let cursor: string | null = null;
    let scanned = 0;
    let trimmed = 0;
    for (;;) {
      const rows = await delegate.findMany({
        where: { updatedAt: { lt: trimCutoff } },
        orderBy: { id: 'asc' },
        take: LOG_RETENTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, logs: true }
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        scanned += 1;
        const raw = typeof row.logs === 'string' ? row.logs : '';
        if (raw.length <= budget) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // 解析不了的不动：宁可不裁，也不毁数据
          continue;
        }
        const bounded = JSON.stringify(boundSimulationLog(Array.isArray(parsed) ? parsed : [], budget));
        if (bounded.length >= raw.length) continue;
        if (!this.dryRun) {
          await delegate.update({ where: { id: row.id }, data: { logs: bounded } });
        }
        trimmed += 1;
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < LOG_RETENTION_BATCH_SIZE) break;
    }
    const durationMs = Date.now() - startedAt;
    logger.info('[log-retention] 虚拟会话 logs 裁剪完成', {
      scanned,
      trimmed,
      budget,
      trimAfterHours: this.virtualSessionLogTrimAfterHours,
      dryRun: this.dryRun,
      durationMs
    });
    return { scanned, trimmed, durationMs };
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
