/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * admin 批量实验路由（2026-11-21）：实验声明归一化 + 手动推进的 Idempotency-Key 透传。
 */
const mockCreateExperiment: jest.Mock = jest.fn();
const mockAdvanceRunWithMeta: jest.Mock = jest.fn();

jest.mock('../../../services/virtual-lab/batch-experiment.service', () => ({
  __esModule: true,
  createExperiment: (...args: any[]) => mockCreateExperiment(...args),
  advanceRunWithMeta: (...args: any[]) => mockAdvanceRunWithMeta(...args),
  manualDecay: jest.fn(),
  manualSnapshot: jest.fn(),
  startBatchExperimentScheduler: jest.fn(),
  listExperiments: jest.fn(),
  getExperimentDetail: jest.fn(),
  stopExperiment: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import router from '../batch-experiments';

function handlerFor(method: 'post' | 'get', path: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function call(handler: any, req: any) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, payload: unknown) { this.body = payload; return this; }),
  };
  await handler(req, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/admin/batch-experiments', () => {
  it('持久化 sampleType / expectedNoPath，非法枚举回落到缺省', async () => {
    mockCreateExperiment.mockResolvedValue({ id: 'exp1' });
    const res = await call(handlerFor('post', '/'), {
      user: { userId: 'admin1' },
      body: {
        name: '实验 A',
        learners: [
          { name: '学生样本', learningGoal: '高考数学', sampleType: 'student', expectedNoPath: true, frictionBudget: 'high' },
          { name: '自由样本', sampleType: 'alien', frictionBudget: 'invalid' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreateExperiment).toHaveBeenCalledWith('admin1', {
      name: '实验 A',
      description: undefined,
      learners: [
        { name: '学生样本', learningGoal: '高考数学', sampleType: 'student', expectedNoPath: true, frictionBudget: 'high' },
        { name: '自由样本', learningGoal: undefined, sampleType: undefined, expectedNoPath: undefined, frictionBudget: 'normal' },
      ],
    });
  });
});

describe('POST /:id/runs/:runId/advance', () => {
  it('Idempotency-Key 透传给 service 并回传 reused', async () => {
    mockAdvanceRunWithMeta.mockResolvedValue({ phase: 'learn', reused: true });
    const res = await call(handlerFor('post', '/:id/runs/:runId/advance'), {
      params: { id: 'exp1', runId: 'run1' },
      body: {},
      get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? 'key-1' : undefined),
    });

    expect(mockAdvanceRunWithMeta).toHaveBeenCalledWith('run1', {
      requestKey: 'key-1',
      request: { runId: 'run1', experimentId: 'exp1' },
    });
    expect(res.body).toEqual({ success: true, data: { phase: 'learn' }, reused: true });
  });

  it('无 key 时不传 requestKey（调度器同款直通语义）', async () => {
    mockAdvanceRunWithMeta.mockResolvedValue({ phase: 'goal', reused: false });
    const res = await call(handlerFor('post', '/:id/runs/:runId/advance'), {
      params: { id: 'exp1', runId: 'run1' },
      body: {},
      get: () => undefined,
    });
    expect(mockAdvanceRunWithMeta).toHaveBeenCalledWith('run1', {
      requestKey: '',
      request: { runId: 'run1', experimentId: 'exp1' },
    });
    expect(res.body).toEqual({ success: true, data: { phase: 'goal' } });
  });

  it('回执冲突映射为 409 + code', async () => {
    mockAdvanceRunWithMeta.mockRejectedValue(Object.assign(new Error('key reused'), {
      statusCode: 409,
      code: 'VIRTUAL_OPERATION_KEY_REUSED',
    }));
    const res = await call(handlerFor('post', '/:id/runs/:runId/advance'), {
      params: { id: 'exp1', runId: 'run1' },
      body: {},
      get: () => 'key-2',
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: 'VIRTUAL_OPERATION_KEY_REUSED' });
  });
});
