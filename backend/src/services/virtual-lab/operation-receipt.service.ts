/**
 * 虚拟运行面「持久化请求回执」（2026-11-21）。
 *
 * 覆盖两类运营推进入口：
 *  - 批量实验手动推进：`POST /api/admin/batch-experiments/:id/runs/:runId/advance`
 *  - assisted 日期推进：`POST /api/admin/virtual-learners/sessions/:sessionId/advance-day`
 *
 * 语义与既有账本一致（黑盒 `virtual_experiment_commands` / 教学
 * `teaching_message_operations`）：
 *  - 同 key + 同请求：成功过 → 回放 `resultJson`（不重复跑模型/不重复推回合）；
 *  - 同 key + 不同请求：409 `VIRTUAL_OPERATION_KEY_REUSED`（绝不回放上一请求的结果）；
 *  - processing 且在途 TTL 内：409 `VIRTUAL_OPERATION_IN_FLIGHT`；
 *  - failed 或 processing 超过 TTL：返回 `stale`，调用方**先按阶段产物对账**，再决定：
 *      · 副作用已经落库 → `completeOperationReceipt(..., {reconciled:true})`，不重跑；
 *      · 副作用未落库 → `takeoverOperationReceipt` 后重跑；
 *  - 可选 `context`（推进前阶段摘要）只用于对账，不参与 requestHash。
 *
 * 与教学账本一样，请求指纹使用规范化 JSON（键排序）+ sha256，跨进程/重试稳定。
 */
import { createHash, randomUUID } from 'node:crypto';
import prisma from '../../config/database';

const DEFAULT_INFLIGHT_TTL_MS = 15 * 60 * 1000;
const MAX_REQUEST_KEY_LENGTH = 128;

export class OperationReceiptKeyInvalidError extends Error {
  readonly code = 'VIRTUAL_OPERATION_KEY_INVALID';
  readonly statusCode = 400;

  constructor(reason: string) {
    super(reason);
    this.name = 'OperationReceiptKeyInvalidError';
  }
}

export class OperationReceiptKeyReusedError extends Error {
  readonly code = 'VIRTUAL_OPERATION_KEY_REUSED';
  readonly statusCode = 409;

  constructor() {
    super('同一 Idempotency-Key 被用于不同请求体，请换一个新的幂等键');
    this.name = 'OperationReceiptKeyReusedError';
  }
}

export class OperationReceiptInFlightError extends Error {
  readonly code = 'VIRTUAL_OPERATION_IN_FLIGHT';
  readonly statusCode = 409;
  readonly retryable = true;
  readonly startedAt: string;

  constructor(startedAt: Date) {
    super('该操作仍在处理中，请等待完成后重试同一 Idempotency-Key');
    this.name = 'OperationReceiptInFlightError';
    this.startedAt = startedAt.toISOString();
  }
}

export class OperationReceiptKeyTooLongError extends Error {
  readonly code = 'VIRTUAL_OPERATION_KEY_TOO_LONG';
  readonly statusCode = 400;

  constructor(length: number) {
    super(`幂等键过长（${length} > ${MAX_REQUEST_KEY_LENGTH}）`);
    this.name = 'OperationReceiptKeyTooLongError';
  }
}

export interface OperationReceiptKey {
  /** 运行面：batch-run | assisted-session */
  scope: string;
  /** runId / sessionId */
  scopeId: string;
  /** 操作：advance | advance-day */
  kind: string;
  requestKey: string;
}

export interface ReserveOperationReceiptInput extends OperationReceiptKey {
  request: unknown;
  /** 推进前阶段摘要；只在首次占位时落库，对账用 */
  context?: unknown;
  /** 覆盖默认在途 TTL（测试/长事务用） */
  inflightTtlMs?: number;
}

export type OperationReceiptReservation =
  | { kind: 'reserved' }
  | { kind: 'replay'; result: unknown }
  | { kind: 'in_flight'; startedAt: Date }
  | { kind: 'stale'; previousStatus: string; updatedAt: Date; context: unknown | null };

export interface OperationReceiptRow {
  id: string;
  scope: string;
  scopeId: string;
  kind: string;
  requestKey: string;
  requestHash: string;
  status: string;
  resultJson: string | null;
  errorJson: string | null;
  contextJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** 请求指纹：只含业务请求体，键排序后哈希（不含 header 顺序/时间戳）。 */
export function operationReceiptRequestHash(request: unknown): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function inflightTtl(input: ReserveOperationReceiptInput): number {
  const configured = Number(process.env.VIRTUAL_OPERATION_RECEIPT_TTL_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return input.inflightTtlMs ?? DEFAULT_INFLIGHT_TTL_MS;
}

function validateKey(input: OperationReceiptKey): string {
  const key = String(input.requestKey || '').trim();
  if (!key) throw new OperationReceiptKeyInvalidError('缺少 Idempotency-Key');
  if (key.length > MAX_REQUEST_KEY_LENGTH) throw new OperationReceiptKeyTooLongError(key.length);
  return key;
}

function findReceipt(input: OperationReceiptKey): Promise<OperationReceiptRow | null> {
  return prisma.virtual_operation_receipts.findUnique({
    where: {
      scope_scopeId_kind_requestKey: {
        scope: input.scope,
        scopeId: input.scopeId,
        kind: input.kind,
        requestKey: String(input.requestKey || '').trim(),
      },
    },
  }) as unknown as Promise<OperationReceiptRow | null>;
}

/**
 * 占位或按同 key 语义归类。并发同 key 由唯一索引兜底：
 * create 撞 P2002 时重读一次再归类。
 */
export async function reserveOperationReceipt(
  input: ReserveOperationReceiptInput,
): Promise<OperationReceiptReservation> {
  const requestKey = validateKey(input);
  const normalized: ReserveOperationReceiptInput = { ...input, requestKey };
  const requestHash = operationReceiptRequestHash(input.request);

  const existing = await findReceipt(normalized);
  if (existing) return classify(existing, requestHash, normalized);

  try {
    await prisma.virtual_operation_receipts.create({
      data: {
        id: randomUUID(),
        scope: input.scope,
        scopeId: input.scopeId,
        kind: input.kind,
        requestKey,
        requestHash,
        status: 'processing',
        contextJson: input.context === undefined ? null : JSON.stringify(input.context),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { kind: 'reserved' };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findReceipt(normalized);
    if (!raced) throw error;
    return classify(raced, requestHash, normalized);
  }
}

function classify(
  row: OperationReceiptRow,
  requestHash: string,
  input: ReserveOperationReceiptInput,
): OperationReceiptReservation {
  if (row.requestHash !== requestHash) throw new OperationReceiptKeyReusedError();
  if (row.status === 'completed') {
    return { kind: 'replay', result: parseJson(row.resultJson) };
  }
  if (row.status === 'processing') {
    const age = Date.now() - new Date(row.updatedAt).getTime();
    if (age <= inflightTtl(input)) {
      return { kind: 'in_flight', startedAt: new Date(row.updatedAt) };
    }
    return {
      kind: 'stale',
      previousStatus: row.status,
      updatedAt: new Date(row.updatedAt),
      context: parseJson(row.contextJson),
    };
  }
  // failed（或历史未知状态）：允许同 key 重试。调用方同样先对账。
  return {
    kind: 'stale',
    previousStatus: row.status,
    updatedAt: new Date(row.updatedAt),
    context: parseJson(row.contextJson),
  };
}

/**
 * 接管一条 stale 回执（仅当状态/更新时间仍是调用方看到的旧值）：
 * 置回 processing 并允许重新执行。返回 false 表示被并发请求抢先，调用方应重新按 key 归类。
 */
export async function takeoverOperationReceipt(
  input: OperationReceiptKey & { previousStatus: string; expectedUpdatedAt: Date; context?: unknown },
): Promise<boolean> {
  const updated = await prisma.virtual_operation_receipts.updateMany({
    where: {
      scope: input.scope,
      scopeId: input.scopeId,
      kind: input.kind,
      requestKey: String(input.requestKey || '').trim(),
      status: input.previousStatus,
      updatedAt: input.expectedUpdatedAt,
    },
    data: {
      status: 'processing',
      resultJson: null,
      errorJson: null,
      completedAt: null,
      updatedAt: new Date(),
      ...(input.context === undefined ? {} : { contextJson: JSON.stringify(input.context) }),
    },
  });
  return updated.count === 1;
}

/**
 * 成功收尾：写入对外结果，供同 key 回放。
 *
 * `allowFailed` + `expectedUpdatedAt` 供「stale 对账」分支使用：对账确认副作用已落库时，
 * 直接以旧 processing/failed 行收尾；带旧 updatedAt 条件避免误覆盖并发接管者。
 * 返回 false 表示条件不再匹配（被并发请求接管/完成），调用方应重新按 key 归类。
 */
export async function completeOperationReceipt(
  input: OperationReceiptKey & {
    result: unknown;
    allowFailed?: boolean;
    expectedUpdatedAt?: Date;
  },
): Promise<boolean> {
  const updated = await prisma.virtual_operation_receipts.updateMany({
    where: {
      scope: input.scope,
      scopeId: input.scopeId,
      kind: input.kind,
      requestKey: String(input.requestKey || '').trim(),
      status: input.allowFailed ? { in: ['processing', 'failed'] } : 'processing',
      ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
    },
    data: {
      status: 'completed',
      resultJson: JSON.stringify(input.result ?? null),
      errorJson: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return updated.count === 1;
}

/** 失败收尾：同 key 可重试（不把一次性故障变成永久失败）。 */
export async function failOperationReceipt(
  input: OperationReceiptKey & { error: unknown },
): Promise<void> {
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error ?? '操作失败');
  await prisma.virtual_operation_receipts.updateMany({
    where: {
      scope: input.scope,
      scopeId: input.scopeId,
      kind: input.kind,
      requestKey: String(input.requestKey || '').trim(),
      status: 'processing',
    },
    data: {
      status: 'failed',
      errorJson: JSON.stringify({ message: message.slice(0, 300) }),
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** 测试/诊断：读取回执（只读，不改变语义）。 */
export async function getOperationReceipt(input: OperationReceiptKey): Promise<OperationReceiptRow | null> {
  return findReceipt({ ...input, requestKey: String(input.requestKey || '').trim() });
}
