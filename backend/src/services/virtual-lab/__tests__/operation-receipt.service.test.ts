/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 持久化请求回执（2026-11-21）：同 key 回放 / 不同请求 409 / 在途 409 / stale 接管。
 * 用内存表替代 Prisma，覆盖批量推进与 assisted advance-day 共用的账本语义。
 */
type Row = Record<string, any>;

const rows = new Map<string, Row>();

function composite(scope: string, scopeId: string, kind: string, requestKey: string): string {
  return `${scope}\u0000${scopeId}\u0000${kind}\u0000${requestKey}`;
}

function fromWhere(where: any): string | null {
  const nested = where?.scope_scopeId_kind_requestKey;
  if (nested) return composite(nested.scope, nested.scopeId, nested.kind, nested.requestKey);
  if (where?.scope && where?.scopeId && where?.kind && where?.requestKey) {
    return composite(where.scope, where.scopeId, where.kind, where.requestKey);
  }
  return null;
}

function matches(row: Row, where: any): boolean {
  for (const [key, value] of Object.entries(where || {})) {
    if (key === 'scope_scopeId_kind_requestKey') continue;
    if (key === 'updatedAt') {
      if (value instanceof Date) {
        if (new Date(row.updatedAt).getTime() !== value.getTime()) return false;
      } else if (value && typeof value === 'object' && 'lt' in (value as any)) {
        if (!(new Date(row.updatedAt) < new Date((value as any).lt))) return false;
      }
      continue;
    }
    if (value && typeof value === 'object' && 'in' in (value as any)) {
      if (!(value as any).in.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

const mockFindUnique: jest.Mock = jest.fn(async ({ where }: any) => {
  const key = fromWhere(where);
  return key ? rows.get(key) ?? null : null;
});

const mockCreate: jest.Mock = jest.fn(async ({ data }: any) => {
  const key = composite(data.scope, data.scopeId, data.kind, data.requestKey);
  if (rows.has(key)) throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
  const row = { ...data };
  rows.set(key, row);
  return row;
});

const mockUpdateMany: jest.Mock = jest.fn(async ({ where, data }: any) => {
  let count = 0;
  for (const row of rows.values()) {
    if (!matches(row, where)) continue;
    Object.assign(row, data);
    count += 1;
  }
  return { count };
});

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_operation_receipts: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
    },
  },
}));

import {
  completeOperationReceipt,
  failOperationReceipt,
  operationReceiptRequestHash,
  OperationReceiptInFlightError,
  OperationReceiptKeyInvalidError,
  OperationReceiptKeyReusedError,
  OperationReceiptKeyTooLongError,
  reserveOperationReceipt,
  takeoverOperationReceipt,
} from '../operation-receipt.service';

const KEY = { scope: 'assisted-session', scopeId: 's1', kind: 'advance-day', requestKey: 'k1' };

beforeEach(() => {
  rows.clear();
  jest.clearAllMocks();
});

describe('operation receipt：占位/回放/冲突', () => {
  it('首次 reserved；完成后同 key 同请求回放结果', async () => {
    const first = await reserveOperationReceipt({ ...KEY, request: { days: 1, runTasks: true } });
    expect(first.kind).toBe('reserved');
    await completeOperationReceipt({ ...KEY, result: { advancedDayIndexes: [2], reused: false } });
    const second = await reserveOperationReceipt({ ...KEY, request: { days: 1, runTasks: true } });
    expect(second).toEqual({ kind: 'replay', result: { advancedDayIndexes: [2], reused: false } });
  });

  it('同 key 不同请求 → 409 冲突，不回放上一请求结果', async () => {
    await reserveOperationReceipt({ ...KEY, request: { days: 1, runTasks: true } });
    await completeOperationReceipt({ ...KEY, result: { ok: true } });
    await expect(
      reserveOperationReceipt({ ...KEY, request: { days: 2, runTasks: false } }),
    ).rejects.toBeInstanceOf(OperationReceiptKeyReusedError);
  });

  it('processing 且在途 TTL 内 → in_flight（由路由层映射为 409）', async () => {
    await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    const second = await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    expect(second.kind).toBe('in_flight');
    expect(OperationReceiptInFlightError).toBeTruthy();
  });

  it('请求指纹与键顺序无关（规范化 JSON）', () => {
    expect(operationReceiptRequestHash({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(operationReceiptRequestHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('空键/超长键 → 400', async () => {
    await expect(reserveOperationReceipt({ ...KEY, requestKey: '', request: {} }))
      .rejects.toBeInstanceOf(OperationReceiptKeyInvalidError);
    await expect(reserveOperationReceipt({ ...KEY, requestKey: 'x'.repeat(129), request: {} }))
      .rejects.toBeInstanceOf(OperationReceiptKeyTooLongError);
  });
});

describe('operation receipt：stale 对账与接管', () => {
  it('stale processing 返回旧 context，接管后可重跑并成功收尾', async () => {
    await reserveOperationReceipt({
      ...KEY,
      request: { days: 1 },
      context: { preDayIndex: 1, plannedIndexes: [2] },
    });
    const stored = rows.get(composite(KEY.scope, KEY.scopeId, KEY.kind, KEY.requestKey))!;
    stored.updatedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h 前 → 超 stale TTL

    const stale = await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    expect(stale.kind).toBe('stale');
    if (stale.kind !== 'stale') throw new Error('expected stale');
    expect(stale.context).toEqual({ preDayIndex: 1, plannedIndexes: [2] });

    const taken = await takeoverOperationReceipt({
      ...KEY,
      previousStatus: stale.previousStatus,
      expectedUpdatedAt: stale.updatedAt,
      context: { preDayIndex: 1, plannedIndexes: [2], resumed: true },
    });
    expect(taken).toBe(true);

    const afterTakeover = rows.get(composite(KEY.scope, KEY.scopeId, KEY.kind, KEY.requestKey))!;
    expect(afterTakeover.status).toBe('processing');
    expect(afterTakeover.resultJson).toBeNull();

    await completeOperationReceipt({ ...KEY, result: { advancedDayIndexes: [2] } });
    const replay = await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    expect(replay).toEqual({ kind: 'replay', result: { advancedDayIndexes: [2] } });
  });

  it('失败回执允许同 key 重试（stale → takeover → completed）', async () => {
    await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    await failOperationReceipt({ ...KEY, error: new Error('boom') });
    const stored = rows.get(composite(KEY.scope, KEY.scopeId, KEY.kind, KEY.requestKey))!;
    expect(stored.status).toBe('failed');

    const stale = await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    expect(stale.kind).toBe('stale');
    if (stale.kind !== 'stale') throw new Error('expected stale');
    expect(await takeoverOperationReceipt({
      ...KEY,
      previousStatus: stale.previousStatus,
      expectedUpdatedAt: stale.updatedAt,
    })).toBe(true);
    await completeOperationReceipt({ ...KEY, result: { ok: true } });
    expect((await reserveOperationReceipt({ ...KEY, request: { days: 1 } })).kind).toBe('replay');
  });

  it('接管时旧状态已被并发请求改变 → 返回 false（不抢别人的处理权）', async () => {
    await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    const stored = rows.get(composite(KEY.scope, KEY.scopeId, KEY.kind, KEY.requestKey))!;
    stored.updatedAt = new Date(Date.now() - 60 * 60 * 1000);
    const stale = await reserveOperationReceipt({ ...KEY, request: { days: 1 } });
    if (stale.kind !== 'stale') throw new Error('expected stale');
    stored.status = 'completed';
    expect(await takeoverOperationReceipt({
      ...KEY,
      previousStatus: stale.previousStatus,
      expectedUpdatedAt: stale.updatedAt,
    })).toBe(false);
  });
});
