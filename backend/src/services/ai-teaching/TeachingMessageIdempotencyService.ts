/**
 * 教学写操作幂等账本（2026-10-20）。
 *
 * 背景：`/finalize` 早已有 `(sessionId, idempotencyKey)` 账本 + 租约 + 202 轮询，
 * 但 `/messages`、`/continue`、checkpoint 提交没有——客户端丢响应后重发会重复追加
 * 用户消息、重复扣费、甚至把同一轮教学跑两遍。本模块把 finalize 的模式复制到回合写入。
 *
 * 语义：
 * - 同 key 同请求：成功过 → 重放 `resultJson`（不再跑模型）；仍在途 → 409 `TEACHING_MESSAGE_IN_FLIGHT`；
 * - 同 key 不同请求：409 `TEACHING_IDEMPOTENCY_KEY_REUSED`（绝不静默返回上一请求的结果）；
 * - 失败或超过在途 TTL：允许同 key 重试（教学回合失败后用户重试是正常操作）。
 *
 * 只存对外结果：回合类写操作由引擎在**提交事务内**写入原始回合载荷（供重放时按调用方
 * 语义投影），checkpoint 类由路由写入最终结果；resultJson 与 revision 一并落库，
 * 重放时前端拿到的 revision 与首次一致。
 */
import { createHash, randomUUID } from 'crypto';
import prisma from '../../config/database';

/** Prisma 唯一索引冲突（并发同 key 由它兜底）。 */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}

/** 在途记录超过该时长视为僵死（教学回合最长约 8 分钟；留一倍余量）。 */
export const DEFAULT_INFLIGHT_TTL_MS = 15 * 60 * 1000;

export class TeachingIdempotencyConflictError extends Error {
  readonly code = 'TEACHING_IDEMPOTENCY_KEY_REUSED';
  readonly status = 409;

  constructor(message = '同一 Idempotency-Key 被用于不同请求') {
    super(message);
    this.name = 'TeachingIdempotencyConflictError';
  }
}

export class TeachingMessageInFlightError extends Error {
  readonly code = 'TEACHING_MESSAGE_IN_FLIGHT';
  readonly status = 409;
  readonly startedAt: string;

  constructor(startedAt: Date) {
    super('该请求仍在处理中，请等待完成后重试同一 Idempotency-Key');
    this.name = 'TeachingMessageInFlightError';
    this.startedAt = startedAt.toISOString();
  }
}

export type TeachingOperationReservation =
  | { kind: 'reserved' }
  | {
      kind: 'replay';
      result: Record<string, any>;
      revision: number | null;
      /**
       * 账本里记录的写操作类型（message / resume-continue / checkpoint:<id>）。
       * 回合类结果存的是引擎原始载荷，重放时需按调用方语义再做一次对外投影。
       */
      operationKind: string | null;
    }
  | { kind: 'in_flight'; startedAt: Date };

export interface ReserveTeachingOperationInput {
  sessionId: string;
  idempotencyKey: string;
  /** message | resume-continue | checkpoint:<id> */
  kind: string;
  requestHash: string;
  inflightTtlMs?: number;
}

/**
 * 请求指纹：kind + 业务体（不含 header 顺序/时间戳）。
 * 规范化 JSON（键排序）保证同一请求在不同进程/重试间得到同一 hash。
 */
export function teachingOperationRequestHash(kind: string, payload: unknown): string {
  return createHash('sha256').update(`${kind}\n${canonicalJson(payload)}`).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function inflightTtl(input: ReserveTeachingOperationInput): number {
  const configured = Number(process.env.TEACHING_IDEMPOTENCY_INFLIGHT_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : input.inflightTtlMs ?? DEFAULT_INFLIGHT_TTL_MS;
}

/**
 * 占位/重放。并发同 key 由唯一索引兜底：create 撞 P2002 时重读一次，按同 key 语义归类。
 */
export async function reserveTeachingOperation(
  input: ReserveTeachingOperationInput
): Promise<TeachingOperationReservation> {
  const existing = await findOperation(input.sessionId, input.idempotencyKey);
  if (existing) return classify(existing, input);

  try {
    await prisma.teaching_message_operations.create({
      data: {
        id: randomUUID(),
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        requestHash: input.requestHash,
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { kind: 'reserved' };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findOperation(input.sessionId, input.idempotencyKey);
    if (!raced) throw error;
    return classify(raced, input);
  }
}

function findOperation(sessionId: string, idempotencyKey: string) {
  return prisma.teaching_message_operations.findUnique({
    where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
  });
}

function classify(
  row: {
    requestHash: string;
    kind: string;
    status: string;
    resultJson: string | null;
    revision: number | null;
    updatedAt: Date;
  },
  input: ReserveTeachingOperationInput
): TeachingOperationReservation | Promise<TeachingOperationReservation> {
  if (row.requestHash !== input.requestHash) throw new TeachingIdempotencyConflictError();
  if (row.status === 'completed') {
    return { kind: 'replay', result: parseResult(row.resultJson), revision: row.revision, operationKind: row.kind };
  }
  const stale = Date.now() - row.updatedAt.getTime() > inflightTtl(input);
  if (row.status === 'processing' && !stale) {
    throw new TeachingMessageInFlightError(row.updatedAt);
  }
  // failed 或僵死 processing：允许同 key 重试（抢回处理权）。
  return takeover(input, row.status);
}

async function takeover(
  input: ReserveTeachingOperationInput,
  previousStatus: string
): Promise<TeachingOperationReservation> {
  const updated = await prisma.teaching_message_operations.updateMany({
    where: {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      status: previousStatus,
    },
    data: { status: 'processing', resultJson: null, revision: null, errorCode: null, updatedAt: new Date() },
  });
  if (updated.count !== 1) {
    // 并发重试：另一请求刚完成/接管，重新按同 key 语义归类一次。
    const row = await findOperation(input.sessionId, input.idempotencyKey);
    if (!row) throw new TeachingIdempotencyConflictError('幂等记录在接管期间被移除');
    return classify(row, input);
  }
  return { kind: 'reserved' };
}

/** 幂等账本的写入面（真 prisma 与事务客户端同形）。 */
export interface TeachingOperationLedgerClient {
  teaching_message_operations: {
    updateMany(args: any): Promise<{ count: number }>;
  };
}

/**
 * 成功收尾：写入对外结果，供同 key 重放。
 *
 * `db` 可传事务客户端——回合提交把「业务写入 + 账本 completed」放进同一事务
 * （2026-10-21），消除「消息已落库、账本仍 processing」的崩溃窗口。
 */
export async function completeTeachingOperation(input: {
  sessionId: string;
  idempotencyKey: string;
  result: Record<string, any>;
  revision: number | null;
}, db?: TeachingOperationLedgerClient): Promise<void> {
  const client = db ?? (prisma as unknown as TeachingOperationLedgerClient);
  await client.teaching_message_operations.updateMany({
    where: { sessionId: input.sessionId, idempotencyKey: input.idempotencyKey, status: 'processing' },
    data: {
      status: 'completed',
      resultJson: JSON.stringify(input.result),
      revision: Number.isInteger(input.revision) ? input.revision : null,
      errorCode: null,
      updatedAt: new Date(),
    },
  });
}

/** 失败收尾：标记 failed，同 key 重试可重新占位（不把一次性故障变成永久失败）。 */
export async function failTeachingOperation(input: {
  sessionId: string;
  idempotencyKey: string;
  errorCode?: string | null;
}): Promise<void> {
  await prisma.teaching_message_operations.updateMany({
    where: { sessionId: input.sessionId, idempotencyKey: input.idempotencyKey, status: 'processing' },
    data: {
      status: 'failed',
      errorCode: (input.errorCode || 'TEACHING_MESSAGE_FAILED').slice(0, 120),
      updatedAt: new Date(),
    },
  });
}

function parseResult(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
