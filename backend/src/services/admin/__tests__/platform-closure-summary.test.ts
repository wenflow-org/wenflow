/* eslint-disable @typescript-eslint/no-explicit-any -- 测试桩：证据行/聚合外观无类型导出 */
/**
 * #105 读侧接入：完课量按轨道/通道拆分（平台总览 KPI 的数据层 + 路由契约）。
 *
 * 数据 = learner_evidence 的已投影收束事件（task:completed / path:completed）。
 * 锁定：
 *  - 完课量主值 total 走**非虚拟口径**（与同文件调用统计同判据 findNonVirtualUserIds）；
 *  - byTrack/bySource 与主值**同源同口径（非虚拟）**：三项轨道相加恒等于 total（卡面自证）；
 *  - 虚拟学习者任务数单列 virtualCount、明确不计入 total/byTrack/bySource（#186 口径对齐）；
 *  - path:completed 单位不同，只作 pathCompletions 披露，不进 total；
 *  - 2026-10-18 前无 track 的历史行如实归 legacy，不回填不猜（口径单点 closure-observability.ts）；
 *  - 路由信封 { success, data } 与失败 500。
 */
const mockFindMany = jest.fn();
const mockUsersFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_evidence: { findMany: mockFindMany },
    users: { findMany: mockUsersFindMany },
  },
}));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

import { computeClosureCompletionSummary } from '../platform-overview.service';
import router from '../../../routes/admin/platform';

function getRouteHandler(path: string, method: 'get') {
  const stack = (router as any).stack;
  const layer = stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function createResponse() {
  const res: any = { statusCode: 200, body: undefined, status: jest.fn() };
  res.status.mockReturnValue(res);
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}

const taskRow = (overrides: Record<string, unknown>, userId = 'u-real') => ({
  evidenceType: 'task:completed',
  payload: JSON.stringify(overrides),
  userId,
});

beforeEach(() => {
  jest.clearAllMocks();
  // 非虚拟口径判据的数据源：u-real 计入主值，u-vl 只进 byTrack/bySource 披露
  mockUsersFindMany.mockResolvedValue([
    { id: 'u-real', isVirtualLearner: false },
    { id: 'u-vl', isVirtualLearner: true },
  ]);
});

describe('computeClosureCompletionSummary（完课量轨道/通道拆分）', () => {
  it('主值与 byTrack/bySource 同源同口径：轨道相加恒等于 total；VL 单列 virtualCount 不计入', async () => {
    mockFindMany.mockResolvedValue([
      taskRow({ taskId: 't1', track: 'human', completionSource: 'human-ui' }),
      taskRow({ taskId: 't2', track: 'human', completionSource: 'teaching-finalize' }),
      taskRow({ taskId: 't3', track: 'virtual-learner', completionSource: 'vl-blackbox' }, 'u-vl'),
      taskRow({ taskId: 't4', actualMinutes: 30 }), // 2026-10-18 前的历史行：无 track
      { evidenceType: 'path:completed', payload: JSON.stringify({ pathId: 'p1', track: 'human', completionSource: 'human-ui' }), userId: 'u-real' },
    ]);

    const summary = await computeClosureCompletionSummary();

    // 主值：t1/t2/t4 属真实用户；t3(u-vl) 不进主值，只计 virtualCount
    expect(summary.total).toBe(3);
    // byTrack/bySource 与主值同口径（非虚拟）：轨道三项相加恒等于 total，卡面数值行内自证
    expect(summary.byTrack.human).toBe(2);
    expect(summary.byTrack['virtual-learner']).toBe(0); // VL 不混入主口径分解
    expect(summary.byTrack.legacy).toBe(1);
    expect(summary.byTrack.human + summary.byTrack.unknown + summary.byTrack.legacy).toBe(summary.total);
    expect(summary.bySource['vl-blackbox']).toBeUndefined(); // VL 通道不进入主口径
    expect(summary.bySource.unknown).toBe(1); // legacy 行无通道 → unknown
    // 虚拟学习者单列披露、明确不计入主值
    expect(summary.virtualCount).toBe(1);
    expect(summary.pathCompletions).toBe(1); // 单位不同：不进 total，仅披露
  });

  it('坏 payload 仍计入样本（track=legacy / source=unknown），不静默丢行', async () => {
    mockFindMany.mockResolvedValue([{ evidenceType: 'task:completed', payload: '{broken-json', userId: 'u-real' }]);

    const summary = await computeClosureCompletionSummary();

    expect(summary.total).toBe(1);
    expect(summary.byTrack.legacy).toBe(1);
    expect(summary.bySource.unknown).toBe(1);
    expect(summary.virtualCount).toBe(0);
  });

  it('查询只取两类收束事件（不扫全表 evidenceType）', async () => {
    mockFindMany.mockResolvedValue([]);
    await computeClosureCompletionSummary();

    expect(mockFindMany.mock.calls[0][0].where).toEqual({
      evidenceType: { in: ['task:completed', 'path:completed'] },
    });
  });
});

describe('GET /overview/closure（路由契约）', () => {
  it('成功 → { success: true, data }（含 byTrack/bySource/pathCompletions）', async () => {
    mockFindMany.mockResolvedValue([taskRow({ taskId: 't1', track: 'human', completionSource: 'human-ui' })]);
    const handler = getRouteHandler('/overview/closure', 'get');
    const res = createResponse();

    await handler({ query: {} }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.byTrack.human).toBe(1);
    expect(res.body.data.bySource['human-ui']).toBe(1);
    expect(res.body.data.pathCompletions).toBe(0);
  });

  it('查询失败 → 500 错误信封', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));
    const handler = getRouteHandler('/overview/closure', 'get');
    const res = createResponse();

    await handler({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('获取完课量收束观测失败');
  });
});
