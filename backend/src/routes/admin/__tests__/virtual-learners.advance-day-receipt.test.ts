/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * assisted advance-day 持久化回执（2026-11-21）：
 *  - 同 Idempotency-Key 同请求：只跑一次，第二次回放（reused=true）；
 *  - 同 key 不同请求：409 VIRTUAL_OPERATION_KEY_REUSED；
 *  - stale processing：先按库内模拟钟对账。时钟已推进 → 不重跑；未推进 → 接管重试；
 *  - 不带 key：保持旧行为（每次直通）。
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
  if (rows.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
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

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSessionState: { session: any } = { session: null };
const mockFindSessionById: jest.Mock = jest.fn(async () => mockSessionState.session);
jest.mock('../../../services/virtual-lab/virtual-session.repo', () => ({
  __esModule: true,
  findSessionById: (...args: any[]) => mockFindSessionById(...args),
  updateSessionStageResults: jest.fn(),
}));
jest.mock('../../../services/virtual-lab/virtual-learner-profile.repo', () => ({
  __esModule: true,
  findProfileJsonById: jest.fn(async () => ({ profile: '{}' })),
}));

const mockRunDayLearning: jest.Mock = jest.fn();
const mockMergeStageResults: jest.Mock = jest.fn(async (_sessionId: string, patch: any) => {
  const stageResults = JSON.parse(mockSessionState.session.stageResults || '{}');
  mockSessionState.session.stageResults = JSON.stringify({ ...stageResults, ...patch });
});
jest.mock('../virtual-learners.assisted-shared', () => ({
  __esModule: true,
  getAssistedCommandId: (req: any) => String(req.get?.('Idempotency-Key') || req.body?.commandId || '').trim(),
  runAssistedSessionMutation: async (_sessionId: string, work: any) =>
    work(mockSessionState.session, async () => undefined),
  runDayLearning: (...args: any[]) => mockRunDayLearning(...args),
  mergeSessionStageResults: (...args: any[]) => mockMergeStageResults(...args),
}));

jest.mock('../../../virtual-lab/session-factory', () => ({
  __esModule: true,
  SIMULATION_FRICTION_BUDGETS: ['none', 'low', 'normal', 'high', 'stress_test'],
  parseJson: (raw: unknown, fallback: unknown) => {
    try { return typeof raw === 'string' && raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
}));

jest.mock('../../../services/virtual-lab-settings.service', () => {
  const actual = jest.requireActual('../../../services/virtual-lab-settings.service');
  return { ...actual, getVirtualLabSettings: jest.fn(async () => actual.DEFAULT_VIRTUAL_LAB_SETTINGS) };
});

import { registerAssistedSimulationRoutes } from '../virtual-learners.assisted-simulation';
import simulatedDayService from '../../../services/virtual-lab/simulated-day.service';
import { operationReceiptRequestHash } from '../../../services/virtual-lab/operation-receipt.service';

const BASE_DATE = '2026-09-14'; // 周一

function makeSession(dayIndex: number) {
  return {
    id: 's1',
    userId: 'u1',
    virtualProfileId: 'p1',
    status: 'running',
    currentStage: 'teaching',
    createdAt: new Date('2026-09-14T00:00:00Z'),
    stageResults: JSON.stringify({
      simulationClock: {
        enabled: true,
        baseDate: BASE_DATE,
        dayIndex,
        timezone: 'Asia/Shanghai',
      },
    }),
  };
}

function routeHandler() {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const router: any = {
    put: (path: string, handle: any) => handlers.set(`PUT ${path}`, handle),
    post: (path: string, handle: any) => handlers.set(`POST ${path}`, handle),
  };
  registerAssistedSimulationRoutes(router);
  return handlers.get('POST /sessions/:sessionId/advance-day')!;
}

function createRequest(body: Record<string, unknown>, idempotencyKey?: string) {
  return {
    params: { sessionId: 's1' },
    body,
    get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined),
  };
}

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, payload: unknown) { this.body = payload; return this; }),
  };
  return res;
}

async function call(body: Record<string, unknown>, key?: string) {
  const res = createResponse();
  await routeHandler()(createRequest(body, key) as any, res);
  return res;
}

function seedStaleReceipt(requestKey: string, request: unknown, context: unknown, ageMs = 60 * 60 * 1000) {
  const old = new Date(Date.now() - ageMs);
  rows.set(composite('assisted-session', 's1', 'advance-day', requestKey), {
    id: 'row-1',
    scope: 'assisted-session',
    scopeId: 's1',
    kind: 'advance-day',
    requestKey,
    requestHash: operationReceiptRequestHash(request),
    status: 'processing',
    resultJson: null,
    errorJson: null,
    contextJson: JSON.stringify(context),
    createdAt: old,
    updatedAt: old,
    completedAt: null,
  });
}

beforeEach(() => {
  rows.clear();
  jest.clearAllMocks();
  mockSessionState.session = makeSession(1);
  mockFindSessionById.mockImplementation(async () => mockSessionState.session);
  mockRunDayLearning.mockResolvedValue({ started: true, chunks: 1 });
  jest.spyOn(simulatedDayService, 'getSimulationClock').mockResolvedValue(null as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('advance-day 持久化回执', () => {
  it('同 key 同请求只跑一次，第二次回放且不再上课', async () => {
    const first = await call({ days: 1, runTasks: true }, 'day-key-1');
    expect(first.statusCode).toBe(200);
    expect(first.body.data.advancedDayIndexes).toEqual([2]);
    expect(mockRunDayLearning).toHaveBeenCalledTimes(1);

    const second = await call({ days: 1, runTasks: true }, 'day-key-1');
    expect(second.statusCode).toBe(200);
    expect(second.body.data.reused).toBe(true);
    expect(second.body.data.advancedDayIndexes).toEqual([2]);
    expect(mockRunDayLearning).toHaveBeenCalledTimes(1);
  });

  it('同 key 不同请求 → 409 VIRTUAL_OPERATION_KEY_REUSED', async () => {
    await call({ days: 1, runTasks: true }, 'day-key-2');
    const conflict = await call({ days: 2, runTasks: false }, 'day-key-2');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body.code).toBe('VIRTUAL_OPERATION_KEY_REUSED');
  });

  it('stale processing 且模拟钟已推进 → 对账收尾，不重跑当天', async () => {
    mockSessionState.session = makeSession(2); // 上次已推进到第 2 天
    const request = { days: 1, runTasks: true };
    seedStaleReceipt('day-key-3', request, {
      preDayIndex: 1,
      plannedIndexes: [2],
      simulatedDay: '2026-09-15',
      runTasks: true,
    });

    const res = await call(request, 'day-key-3');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      advancedDayIndexes: [2],
      simulatedDay: '2026-09-15',
      reconciled: true,
      reused: true,
    });
    expect(mockRunDayLearning).not.toHaveBeenCalled();
    const row = rows.get(composite('assisted-session', 's1', 'advance-day', 'day-key-3'))!;
    expect(row.status).toBe('completed');
  });

  it('stale processing 且模拟钟未推进 → 接管重试同一天', async () => {
    mockSessionState.session = makeSession(1);
    const request = { days: 1, runTasks: true };
    seedStaleReceipt('day-key-4', request, {
      preDayIndex: 1,
      plannedIndexes: [2],
      simulatedDay: '2026-09-15',
      runTasks: true,
    });

    const res = await call(request, 'day-key-4');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.advancedDayIndexes).toEqual([2]);
    expect(mockRunDayLearning).toHaveBeenCalledTimes(1);
    const clock = JSON.parse(mockSessionState.session.stageResults).simulationClock;
    expect(clock.dayIndex).toBe(2);
    const row = rows.get(composite('assisted-session', 's1', 'advance-day', 'day-key-4'))!;
    expect(row.status).toBe('completed');
  });

  it('不带 key → 每次直通（旧行为，不建回执）', async () => {
    await call({ days: 1, runTasks: true });
    await call({ days: 1, runTasks: true });
    expect(mockRunDayLearning).toHaveBeenCalledTimes(2);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
