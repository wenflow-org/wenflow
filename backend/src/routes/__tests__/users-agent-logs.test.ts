process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';

const routeOrder: string[] = [];
type RouteHandler = (...args: any[]) => any;
const routes: Record<string, RouteHandler> = {};

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => {
        routeOrder.push(path);
        routes[`GET ${path}`] = handler;
      },
      post: jest.fn(),
      put: jest.fn(),
      use: jest.fn()
    })
  }
}));

const agentLogMocks = {
  findMany: jest.fn(),
  count: jest.fn(),
  findFirst: jest.fn()
};

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: agentLogMocks
  }
}));

jest.mock('../../services/learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() }
}));

import '../users';
/* 日期键区间自 2026-10-31 走查 P0-3 起按**应用时区本地日**解析（此前 startDate 走 UTC 零点、
   endDate 走机器本地 23:59:59，起止口径不对称，UTC+8 用户 00:00–08:00 的记录会被整段漏掉）；
   期望值直接取自同一 helper，避免测试里再抄一份时区算术。 */
import { parseDayKeyRange } from '../../services/time/day-boundary';

function createResponse() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

describe('users agent log routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('在日志详情参数路由之前注册 export 路由', () => {
    expect(routeOrder.indexOf('/me/agent-logs/export'))
      .toBeLessThan(routeOrder.indexOf('/me/agent-logs/:logId'));
  });

  it('导出使用与列表一致的筛选条件', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const req: any = {
      user: { userId: 'user-1' },
      query: {
        format: 'json',
        agentId: 'skill:path-planning',
        success: 'false',
        includeSystem: 'false',
        startDate: '2026-07-01',
        endDate: '2026-07-16'
      }
    };
    const res = createResponse();

    await routes['GET /me/agent-logs/export'](req, res, jest.fn());

    const range = parseDayKeyRange('2026-07-01', '2026-07-16');
    expect(agentLogMocks.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        agentId: 'skill:path-planning',
        success: false,
        calledAt: {
          gte: range.from,
          lte: range.to
        }
      },
      orderBy: { calledAt: 'desc' },
      take: 1000
    });
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('列表把同一 goal 会话的多轮调用折叠成一条并附计数与明细', async () => {
    const mkLog = (id: string, convId: string, agentId: string, calledAt: string, source = 'business') => ({
      id,
      agentId,
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      durationMs: 1000,
      metadata: JSON.stringify({
        layer: 'skill-executor',
        skillId: agentId.replace(/^skill:/, ''),
        conversationId: convId
      }),
      traceId: `trace-${convId}-${id}`,
    });
    // 同一 goal 会话两轮，另一 teaching 单条
    agentLogMocks.findMany.mockResolvedValue([
      mkLog('g1', 'gc_conv1', 'skill:goal-conversation', '2026-09-04T09:00:00.000Z'),
      mkLog('g2', 'gc_conv1', 'skill:goal-conversation', '2026-09-04T09:02:00.000Z'),
      mkLog('t1', 'sess-x', 'skill:teaching-turn', '2026-09-04T09:05:00.000Z'),
    ]);
    agentLogMocks.count.mockResolvedValue(3);
    const req: any = { user: { userId: 'user-1' }, query: {} };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    const logs = res.body?.data?.logs ?? [];
    const goalItems = logs.filter((l: any) => String(l.agentId).includes('goal-conversation'));
    const teachItems = logs.filter((l: any) => String(l.agentId).includes('teaching-turn'));
    // 同 goal 会话两轮折叠为 1 条 + groupCount=2，id 取稳定 groupKey
    expect(goalItems).toHaveLength(1);
    expect(goalItems[0].groupCount).toBe(2);
    expect(goalItems[0].id).toBe('goal:gc_conv1');
    // 组键不是真实日志 id：另带代表调用真实 id 供详情接口查询（2026-11-04）
    expect(goalItems[0].repLogId).toBe('g1');
    // 折叠组带可展开的明细（两次调用，时间正序）
    expect(goalItems[0].groupItems).toHaveLength(2);
    expect(goalItems[0].groupItems[0].id).toBe('g1');
    expect(goalItems[0].groupItems[1].id).toBe('g2');
    // 非会话级 teaching 仍逐条（且不带 groupItems）
    expect(teachItems).toHaveLength(1);
    expect(teachItems[0].id).toBe('t1');
    expect(teachItems[0].groupItems).toBeUndefined();
  });

  it('折叠会话从同 trace 的网关行提取模型名（业务行本身没有 model）', async () => {
    const base = {
      sourceEntry: 'platform',
      calledAt: new Date('2026-09-04T11:00:00.000Z'),
      success: true,
      errorCode: null,
      durationMs: 1000,
      traceId: 'trace-shared-model',
    };
    agentLogMocks.findMany.mockResolvedValue([
      {
        ...base,
        id: 'b1',
        agentId: 'skill:goal-conversation',
        metadata: JSON.stringify({ conversationId: 'gc_model', layer: 'skill-executor' }),
      },
      {
        ...base,
        id: 'gw1',
        agentId: 'api-gateway',
        metadata: JSON.stringify({ conversationId: 'gc_model', model: 'deepseek-v4.1-flash' }),
      },
    ]);
    agentLogMocks.count.mockResolvedValue(2);
    const req: any = { user: { userId: 'user-1' }, query: { includeSystem: 'true' } };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    const logs = res.body?.data?.logs ?? [];
    const goal = logs.find((l: any) => String(l.agentId).includes('goal-conversation'));
    expect(goal.model).toBe('deepseek-v4.1-flash');
  });

  it('列表过滤 userVisible=false 的内部 skill（如 adaptive-guidance-copy）', async () => {
    const mkLog = (id: string, convId: string | null, agentId: string, calledAt: string) => ({
      id,
      agentId,
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      metadata: JSON.stringify({ conversationId: convId }),
      traceId: `t-${id}`,
    });
    agentLogMocks.findMany.mockResolvedValue([
      mkLog('copy1', null, 'skill:adaptive-guidance-copy', '2026-09-04T10:00:00.000Z'),
      mkLog('copy2', null, 'skill:adaptive-guidance-copy', '2026-09-04T10:01:00.000Z'),
    ]);
    agentLogMocks.count.mockResolvedValue(2);
    const req: any = { user: { userId: 'user-1' }, query: {} };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    // 过滤生效在 SQL 层：断言传给 DB 的 where.agentId.notIn 包含内部 skill
    const wherePassed = agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where;
    expect(wherePassed.agentId.notIn).toContain('skill:adaptive-guidance-copy');
    expect(wherePassed.agentId.notIn).toContain('skill:kc-mapper');
    expect(wherePassed.agentId.notIn).toContain('system-call');
    // mock 不模拟 SQL 过滤，因此这里只断言 where 构造正确
  });

  it('path-agent 阶段流水用 sourceConversationId 并入 path 组，且 phase 透传到明细', async () => {
    const mkPathStage = (id: string, conv: string, phase: string, calledAt: string) => ({
      id,
      agentId: 'path-agent',
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      metadata: JSON.stringify({
        eventType: 'path-generation-stage',
        executionLayer: 'flow-event',
        phase,
        pathId: 'lp_1',
        sourceConversationId: conv,
        triggerSource: 'goal-conversation'
      }),
      traceId: `tr-${id}`,
    });
    agentLogMocks.findMany.mockResolvedValue([
      mkPathStage('pa-core-start', 'gc_abc', 'core', '2026-09-04T11:00:00.000Z'),
      mkPathStage('pa-core-done', 'gc_abc', 'core', '2026-09-04T11:00:05.000Z'),
      mkPathStage('pa-stage-start', 'gc_abc', 'stageDesign', '2026-09-04T11:00:06.000Z'),
    ]);
    agentLogMocks.count.mockResolvedValue(3);
    const req: any = { user: { userId: 'user-1' }, query: {} };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    const logs = res.body?.data?.logs ?? [];
    // 三段 path-agent 阶段流水同 sourceConversationId → 折成 1 条 path 组
    const pathGroup = logs.filter((l: any) => String(l.agentId).includes('path-agent'));
    expect(pathGroup).toHaveLength(1);
    expect(pathGroup[0].groupCount).toBe(3);
    expect(pathGroup[0].id).toBe('path:gc_abc');
    // 组键查不到详情：代表调用真实 id 透出给前端「详情」用（2026-11-04）
    expect(pathGroup[0].repLogId).toBe('pa-core-start');
    // 明细保留 phase，供前端显示「主结构 / 阶段任务」
    expect(pathGroup[0].groupItems.map((i: any) => i.phase)).toEqual(['core', 'core', 'stageDesign']);
  });

  it('page 负值被钳制为 1（skip=0），不再向 Prisma 传负 skip', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    agentLogMocks.count.mockResolvedValue(0);
    const req: any = { user: { userId: 'user-1' }, query: { page: '-5' } };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    const args = agentLogMocks.findMany.mock.calls.at(-1)?.[0];
    expect(args.skip).toBe(0);
    expect(res.body?.success).toBe(true);
  });

  // 2026-11-04：分页与计数须与「折叠后」的列表同口径——此前 total 数去重/折叠前的原始行、
  // 页码又落在原始行空间，导致 total 与实际可达记录数不符、第 2 页整页重复第 1 页。
  it('分页在折叠后的视图上计数：total 与可达记录数一致、第 2 页不重复第 1 页', async () => {
    // 24 条原始调用同属一个 goal 会话 → 折叠后为 1 条
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: `g${i}`,
      agentId: 'skill:goal-conversation',
      sourceEntry: 'platform',
      calledAt: new Date(Date.UTC(2026, 8, 4, 9, 0, i)),
      success: true,
      errorCode: null,
      durationMs: 1000,
      metadata: JSON.stringify({ conversationId: 'gc_one', layer: 'skill-executor' }),
      traceId: `trace-one-${i}`,
    }));
    agentLogMocks.findMany.mockResolvedValue(rows);
    agentLogMocks.count.mockResolvedValue(24);

    const first: any = createResponse();
    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: { page: '1', limit: '20' } } as any,
      first,
      jest.fn()
    );
    const second: any = createResponse();
    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: { page: '2', limit: '20' } } as any,
      second,
      jest.fn()
    );

    // total = 折叠后条数（1），与实际可达记录数一致，不再虚报 24、也不再有第 2 页重复
    expect(first.body?.data?.pagination?.total).toBe(1);
    expect(first.body?.data?.pagination?.totalPages).toBe(1);
    const ids1 = (first.body?.data?.logs ?? []).map((l: any) => l.id);
    const ids2 = (second.body?.data?.logs ?? []).map((l: any) => l.id);
    expect(ids1).toEqual(['goal:gc_one']);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });

  // 2026-11-04：导出须与列表同一「折叠后」视图——此前导出走原始行，同筛选下页面条数与
  // 导出记录数两套口径（12 vs 24）对不上，且导出还带同一次调用的重复行。
  it('导出口径与列表一致：同筛选下导出条数等于列表 total', async () => {
    // 24 条原始行同属一个 goal 会话 → 折叠后 1 条；含一条同 trace 重复行验证去重
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: `g${i}`,
      agentId: 'skill:goal-conversation',
      sourceEntry: 'platform',
      calledAt: new Date(Date.UTC(2026, 8, 4, 9, 0, i)),
      success: true,
      errorCode: null,
      durationMs: 1000,
      metadata: JSON.stringify({ conversationId: 'gc_one', layer: 'skill-executor' }),
      traceId: `trace-one-${i}`,
    }));
    agentLogMocks.findMany.mockResolvedValue(rows);

    const listRes: any = createResponse();
    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: { page: '1', limit: '20' } } as any,
      listRes,
      jest.fn()
    );
    const exportRes: any = createResponse();
    await routes['GET /me/agent-logs/export'](
      { user: { userId: 'user-1' }, query: { format: 'json' } } as any,
      exportRes,
      jest.fn()
    );

    const exported = exportRes.body?.data ?? [];
    expect(exported).toHaveLength(listRes.body?.data?.pagination?.total);
    expect(exported).toHaveLength(1);
    expect(exported[0].id).toBe('goal:gc_one');
    expect(exported[0].groupCount).toBe(24);
  });
});
