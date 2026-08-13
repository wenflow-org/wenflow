/**
 * 总览 /overview/stats 脉搏聚合测试（P0-1：全量聚合替代 take:50 抽样）
 * - buildHourlyTrend 纯函数：总数=各小时和 / 时间窗过滤 / 空窗口 / 超时与错误分类
 * - 路由级：mock prisma 注入 >50 行 24h 日志，断言响应聚合数=全量行数（无 50 截断）
 */

const mockAgentCallLogs = {
  groupBy: jest.fn(),
  count: jest.fn(),
  findMany: jest.fn(),
};

const mockPrisma = {
  users: { count: jest.fn(), findUnique: jest.fn() },
  teaching_sessions: { findMany: jest.fn() },
  learning_paths: { count: jest.fn(), findMany: jest.fn() },
  subtasks: { count: jest.fn() },
  goal_conversations: { count: jest.fn() },
  agent_call_logs: mockAgentCallLogs,
  llm_execution_attempts: { aggregate: jest.fn(), groupBy: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

import { buildHourlyTrend } from '../platform';
import router from '../platform';

function getRouteHandler(path: string, method: 'get' | 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function hourLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

describe('buildHourlyTrend（24h 脉搏全量聚合）', () => {
  // 固定锚点（本地时区）：窗口起点 = 当前整点 - 23h
  const now = new Date(2026, 7, 13, 13, 30, 0, 0);
  const windowStart = new Date(2026, 7, 12, 14, 0, 0, 0);

  const log = (
    y: number, mo: number, d: number, h: number, mi = 0,
    success = true, errorCode: string | null = null, errorCategory: string | null = null
  ) => ({ calledAt: new Date(y, mo, d, h, mi, 0, 0), success, errorCode, errorCategory });

  beforeEach(() => jest.clearAllMocks());

  it('总数 = 各小时之和（跨 3 小时分布，含失败/超时行）', () => {
    const rows = [
      ...Array.from({ length: 42 }, (_, i) => log(2026, 7, 13, 11, 5 + (i % 50), i % 7 !== 0, 'ERR_X')),
      ...Array.from({ length: 7 }, (_, i) => log(2026, 7, 12, 15, 10 + i, i % 2 === 0, 'ATTEMPT_TIMEOUT')),
      log(2026, 7, 13, 13, 0),
    ];
    const trend = buildHourlyTrend(rows, windowStart, now);

    expect(trend).toHaveLength(24);
    expect(trend[0].label).toBe('14:00');
    expect(trend[23].label).toBe('13:00');
    const total = trend.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(50);

    const h11 = trend.find((b) => b.label === '11:00');
    const h15 = trend.find((b) => b.label === '15:00');
    const h13 = trend.find((b) => b.label === '13:00');
    expect(h11?.total).toBe(42);
    expect(h11?.error).toBe(6);
    expect(h11?.timeout).toBe(0);
    expect(h15?.total).toBe(7);
    expect(h15?.timeout).toBe(3);
    expect(h13?.total).toBe(1);
  });

  it('时间窗过滤：窗口起点前 1 分钟与未来日志不计入，边界点计入', () => {
    const rows = [
      log(2026, 7, 12, 13, 59),      // 窗口前 1 分钟 → 丢弃
      log(2026, 7, 12, 14, 0),       // 恰在窗口起点 → 计入
      log(2026, 7, 13, 13, 29),      // 当前小时 → 计入
      { calledAt: new Date(2026, 7, 13, 13, 31, 0, 0), success: true, errorCode: null, errorCategory: null }, // 未来 → 丢弃
    ];
    const trend = buildHourlyTrend(rows, windowStart, now);

    const total = trend.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(2);
    expect(trend[0].total).toBe(1); // 14:00 边界桶
    expect(trend[23].total).toBe(1); // 13:00 桶
  });

  it('空窗口 → 24 个全零桶，标签自 23h 前整点起', () => {
    const trend = buildHourlyTrend([], windowStart, now);

    expect(trend).toHaveLength(24);
    expect(trend.every((b) => b.total === 0 && b.error === 0 && b.timeout === 0)).toBe(true);
    expect(trend[0].label).toBe('14:00');
    expect(trend[23].label).toBe('13:00');
    expect(trend[0].time).toBe(new Date(2026, 7, 12, 14, 0, 0, 0).toISOString());
  });

  it('错误分类：errorCategory=provider_timeout 计入 timeout；普通失败计入 error；成功不计', () => {
    const rows = [
      { ...log(2026, 7, 13, 13, 0, false, 'SOME_CODE'), errorCategory: 'provider_timeout' },
      { ...log(2026, 7, 13, 12, 0, false, 'ERR_X'), errorCategory: null },
      { ...log(2026, 7, 13, 12, 1, false, 'ETIMEDOUT'), errorCategory: null },
      log(2026, 7, 13, 11, 0, true),
    ];
    const trend = buildHourlyTrend(rows, windowStart, now);

    const total = trend.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(4);
    expect(trend.find((b) => b.label === '13:00')?.timeout).toBe(1);
    expect(trend.find((b) => b.label === '12:00')?.error).toBe(1);
    expect(trend.find((b) => b.label === '12:00')?.timeout).toBe(1);
    expect(trend.find((b) => b.label === '11:00')?.total).toBe(1);
    expect(trend.find((b) => b.label === '11:00')?.error).toBe(0);
  });
});

describe('GET /overview/stats 脉搏全量聚合（路由级，无 50 条截断）', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.users.count.mockResolvedValue(0);
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([]);
    mockPrisma.learning_paths.count.mockResolvedValue(0);
    mockPrisma.learning_paths.findMany.mockResolvedValue([]);
    mockPrisma.subtasks.count.mockResolvedValue(0);
    mockPrisma.goal_conversations.count.mockResolvedValue(0);
    mockAgentCallLogs.groupBy.mockResolvedValue([]);
    mockAgentCallLogs.count.mockResolvedValue(0);
    mockPrisma.llm_execution_attempts.aggregate.mockResolvedValue({ _sum: { totalTokens: null }, _count: 0 });
    mockPrisma.llm_execution_attempts.groupBy.mockResolvedValue([]);
  });

  it('注入 120 行（>50）→ 响应 24h 总数=120、高峰=当前小时、24 桶之和=120', async () => {
    const now = new Date();
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `trend-${i}`,
      calledAt: now,
      success: i % 3 !== 0,
      errorCode: i % 3 === 0 ? 'ATTEMPT_TIMEOUT' : null,
      errorCategory: null,
    }));
    // 趋势查询：窄 select（无 output）→ 全量行；wrapup 查询：select.output → 空
    mockAgentCallLogs.findMany.mockImplementation((args: any) =>
      args?.select?.output ? Promise.resolve([]) : Promise.resolve(rows)
    );

    const handler = getRouteHandler('/overview/stats', 'get');
    const res = createResponse();
    await handler({}, res);

    expect(res.status).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0].data;
    const buckets = payload.agents.last24h;

    expect(buckets).toHaveLength(24);
    const sum = buckets.reduce((s: number, b: any) => s + b.total, 0);
    expect(sum).toBe(120);
    expect(payload.agents.last24hTotal).toBe(120);
    expect(payload.agents.last24hPeak).toBe(hourLabel(now));

    const current = buckets[buckets.length - 1];
    expect(current.total).toBe(120);
    expect(current.timeout).toBe(40);
    expect(current.error).toBe(0);
  });
});
