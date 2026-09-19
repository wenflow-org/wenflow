/**
 * 事务写入单点封装（架构审计 P0：Prisma 交互式事务系统性缺失 timeout/maxWait）
 *
 * 背景：Prisma 交互式事务默认 timeout=5s、maxWait=2s。本仓大量 `$transaction`
 * 承载路径生成/阶段任务落库等重写入，5s 超时会被误判为失败并触发回滚，
 * 曾复现「批量回滚产出零子任务里程碑」的空壳路径（学习服务阶段设计提交事务）。
 *
 * 本模块统一：
 * - 传入 `timeout`（默认 10s，可经 `PRISMA_TX_TIMEOUT_MS` 覆盖）与
 *   `maxWait`（默认 5s，可经 `PRISMA_TX_MAX_WAIT_MS` 覆盖）；
 * - 对瞬时冲突（Prisma `P2034`、SQLite `SQLITE_BUSY`/`database is locked`/
 *   write conflict）做有界指数退避重试（默认 2 次，可经 `PRISMA_TX_MAX_RETRIES`）；
 * - 非瞬时错误不重试；重试耗尽后**抛出原始错误**并打印结构化日志，绝不吞错。
 *
 * 使用约束：仅在真正的事务写入调用点使用；已持有事务客户端（tx）的嵌套调用
 * 禁止再调用本封装（会开启新事务，破坏原子性）。
 */
import type { Prisma } from '@prisma/client';
import type { Prisma as SystemPrisma } from '../generated/system-client';
import prisma from '../config/database';
import { logger } from './logger';

/** 主库事务客户端类型（与 Prisma.TransactionClient 一致，调用方保留原类型） */
export type TransactionClient = Prisma.TransactionClient;

/** system 库事务客户端类型（供接入 system client 的调用方使用） */
export type SystemTransactionClient = SystemPrisma.TransactionClient;

export interface WithTransactionOptions {
  /** 事务执行超时（ms）；缺省读 env / 默认 10_000 */
  timeout?: number;
  /** 从连接池获取事务连接的最大等待（ms）；缺省读 env / 默认 5_000 */
  maxWait?: number;
  /** 瞬时冲突的最大重试次数（不含首次）；缺省读 env / 默认 2 */
  maxRetries?: number;
  /** 结构化日志标签，便于定位调用点 */
  label?: string;
}

/** 供事务执行器约束的最小客户端形状，避免绑定具体 PrismaClient 版本 */
export interface TransactionHost<TxClient> {
  $transaction<R>(
    fn: (tx: TxClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<R>;
}

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 10_000;
export const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;
export const DEFAULT_TRANSACTION_MAX_RETRIES = 2;

/** 重试基础退避（ms），按 2 的幂增长：100 / 200 / 400 ... */
const RETRY_BASE_DELAY_MS = 100;

const TRANSIENT_PRISMA_CODES = new Set(['P2034']);
const TRANSIENT_RAW_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT']);
const TRANSIENT_MESSAGE_PATTERNS = [
  /SQLITE_BUSY/i,
  /database (?:is|table is) locked/i,
  /write conflict/i,
  /deadlock/i,
];

const PRISMA_CODE_HINTS: Record<string, string> = {
  P2034: '事务写冲突或死锁 (P2034)',
  P2028: '事务已关闭/超时 (P2028)',
  P1008: '数据库操作超时 (P1008)',
};

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTimeout(options: WithTransactionOptions): number {
  return options.timeout ?? readPositiveInt(process.env.PRISMA_TX_TIMEOUT_MS, DEFAULT_TRANSACTION_TIMEOUT_MS);
}

function resolveMaxWait(options: WithTransactionOptions): number {
  return options.maxWait ?? readPositiveInt(process.env.PRISMA_TX_MAX_WAIT_MS, DEFAULT_TRANSACTION_MAX_WAIT_MS);
}

function resolveMaxRetries(options: WithTransactionOptions): number {
  return options.maxRetries ?? readPositiveInt(process.env.PRISMA_TX_MAX_RETRIES, DEFAULT_TRANSACTION_MAX_RETRIES);
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * 是否为可重试的瞬时事务冲突。
 * 只认 Prisma P2034 与 SQLite busy/write-conflict 等价物；其余错误一律不重试。
 */
export function isTransientTransactionError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code && (TRANSIENT_PRISMA_CODES.has(code) || TRANSIENT_RAW_CODES.has(code))) return true;
  const message = readErrorMessage(error);
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/** 将 Prisma 错误码翻译为可读提示（用于结构化日志） */
export function describeTransactionErrorCode(code: string | null): string | null {
  if (!code) return null;
  return PRISMA_CODE_HINTS[code] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在指定 Prisma 客户端上执行带 timeout/maxWait + 有界重试的交互式事务。
 * 泛型 TxClient 保证调用方拿到的仍是原事务客户端类型。
 */
export async function runWithTransaction<TxClient, R>(
  client: TransactionHost<TxClient>,
  fn: (tx: TxClient) => Promise<R>,
  options: WithTransactionOptions = {}
): Promise<R> {
  const timeout = resolveTimeout(options);
  const maxWait = resolveMaxWait(options);
  const maxRetries = resolveMaxRetries(options);
  const label = options.label || 'prisma.transaction';
  const maxAttempts = maxRetries + 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(fn, { timeout, maxWait });
    } catch (error) {
      lastError = error;
      const transient = isTransientTransactionError(error);
      const code = readErrorCode(error);
      const canRetry = transient && attempt < maxAttempts;

      if (!canRetry) {
        const exhausted = transient;
        logger.error(
          exhausted ? 'Prisma 事务重试耗尽，抛出原始错误' : 'Prisma 事务失败（非瞬时错误，不重试）',
          {
            label,
            attempt,
            maxAttempts,
            timeout,
            maxWait,
            transient,
            code,
            codeHint: describeTransactionErrorCode(code),
            error: readErrorMessage(error),
          }
        );
        throw error;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn('Prisma 事务遇到瞬时冲突，退避后重试', {
        label,
        attempt,
        maxAttempts,
        delayMs,
        code,
        codeHint: describeTransactionErrorCode(code),
        error: readErrorMessage(error),
      });
      await sleep(delayMs);
    }
  }

  // 理论上不可达（循环内必 return 或 throw）；保留以满足 TS 控制流并杜绝静默吞错。
  throw lastError;
}

/**
 * 主库（`@prisma/client`）事务写入封装。
 *
 * @example
 * const path = await withTransaction(async (tx) => {
 *   return tx.learning_paths.create({ data });
 * }, { label: 'learning.persistGeneratedPath' });
 */
export function withTransaction<R>(
  fn: (tx: TransactionClient) => Promise<R>,
  options?: WithTransactionOptions
): Promise<R> {
  return runWithTransaction(prisma as unknown as TransactionHost<TransactionClient>, fn, options);
}

/** 绑定任意 Prisma 客户端的事务执行器工厂（system client 可复用同一形状） */
export function createTransactionRunner<TxClient>(client: TransactionHost<TxClient>) {
  return function withClientTransaction<R>(
    fn: (tx: TxClient) => Promise<R>,
    options?: WithTransactionOptions
  ): Promise<R> {
    return runWithTransaction(client, fn, options);
  };
}

/**
 * system 库（`src/generated/system-client`）事务写入封装。
 * 延迟加载 system client，避免主库调用链在测试/启动阶段连带实例化。
 */
export async function withSystemTransaction<R>(
  fn: (tx: SystemTransactionClient) => Promise<R>,
  options?: WithTransactionOptions
): Promise<R> {
  const mod = await import('../config/system-database');
  const client = (mod.systemPrisma ?? mod.default) as unknown as TransactionHost<SystemTransactionClient>;
  return runWithTransaction(client, fn, options);
}
