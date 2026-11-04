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

import { parseDayKeyRange } from '../../services/time/day-boundary';

import '../users';

function createResponse() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as any,
    statusCode: undefined as number | undefined,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
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

    // 日界口径同源（#201）：buildAgentLogWhere 自 b54e0b31 起用 parseDayKeyRange 按
    // **应用时区本地日**解析日期键。此处直接引用被测实现所用的同一 helper，避免断言
    // 与实现口径二次漂移（旧断言写死 new Date('2026-07-01')，即 P0-3 已废止的 UTC 零点口径）。
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

  it('默认口径按 manifest userListed 放行真实业务动作，排除内部 skill 与 0 行编排器（#219）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const req: any = { user: { userId: 'user-1' }, query: {} };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    // 过滤生效在 SQL 层：断言传给 DB 的 where.agentId.in 是 manifest userListed 白名单
    const wherePassed = agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where;
    const listed = wherePassed.agentId.in as string[];
    // 真实写日志的业务 skill（线上行数见 #219 证据）必须放行，否则默认列表只剩 path-agent
    expect(listed).toEqual(
      expect.arrayContaining([
        'skill:goal-conversation',
        'skill:path-planning',
        'skill:teaching-turn',
        'skill:session-wrapup',
        'path-agent',
      ])
    );
    // goal-agent / teaching-agent 是 userVisible 的展示身份，全表 0 行，放进默认口径只会是空
    expect(listed).not.toContain('goal-agent');
    expect(listed).not.toContain('teaching-agent');
    // 内部噪音与网关不得进入默认列表
    expect(listed).not.toContain('skill:adaptive-guidance-copy');
    expect(listed).not.toContain('skill:kc-mapper');
    expect(listed).not.toContain('api-gateway');
    expect(listed).not.toContain('system-call');
    // mock 不模拟 SQL 过滤，因此这里只断言 where 构造正确
  });

  it('capabilityType 分组从 manifest 派生且限定在用户可见集内（#218/#226）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const agentIdsFor = async (capabilityType: string): Promise<string[]> => {
      const req: any = { user: { userId: 'user-1' }, query: { format: 'json', capabilityType } };
      await routes['GET /me/agent-logs/export'](req, createResponse(), jest.fn());
      return agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where?.agentId?.in as string[];
    };

    // 真实授课 id 是 skill:teaching-turn（manifest Teaching 组，线上 327 行）；
    // 旧硬编码 id ai-teaching-agent 线上 0 行，曾让该筛选恒空。
    const teaching = await agentIdsFor('teaching');
    expect(teaching).toContain('skill:teaching-turn');
    expect(teaching).not.toContain('ai-teaching-agent');

    // #226：Profile 组内没有任何 userListed 的 id（learner-model / adaptive-guidance-copy
    // 都是内部 skill），能力筛选在用户可见集内再筛后为空——不再把 86 行内部 skill
    // 从筛选视图放出来（默认视图对它们本来就是 0 行）。
    const profile = await agentIdsFor('profile');
    expect(profile).toEqual([]);
    expect(profile).not.toContain('learner-model-agent');

    const path = await agentIdsFor('path');
    expect(path).toContain('skill:path-planning');
    expect(path).toContain('path-agent');

    // tutoring / tracking 在 manifest 里没有对应监控组：显式空数组 ——
    // 若删键，capabilityType 不命中就会退化成「不筛选、返回全部日志」。
    expect(await agentIdsFor('tutoring')).toEqual([]);
    expect(await agentIdsFor('tracking')).toEqual([]);
    expect(await agentIdsFor('system')).toEqual(['system-call', 'unknown']);
  });

  it('capabilityType 结果集 ⊆ 默认结果集：合法值出子集，未知值被拒（#226/#229）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const request = async (query: Record<string, unknown>) => {
      const req: any = { user: { userId: 'user-1' }, query: { format: 'json', ...query } };
      const res = createResponse();
      await routes['GET /me/agent-logs/export'](req, res, jest.fn());
      return {
        status: res.statusCode as number | undefined,
        agentIds: agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where?.agentId?.in as string[] | undefined,
      };
    };

    const defaultIds = (await request({})).agentIds as string[];
    expect(defaultIds.length).toBeGreaterThan(0);

    // 能力筛选 = 在用户可见集内按能力再筛：任何 X 的 id 集合都必须是默认口径的子集。
    // 修复前 profile 会返回 skill:adaptive-guidance-copy 等内部 skill（默认视图不含）。
    // #229：相邻的坑是「未知值不命中任何分支 → where 退化成 { userId }」，这里把合法性
    // 检查做成 status 感知的，避免在 400 分支上读到上一条 mock 调用而假绿。
    for (const capabilityType of ['goal', 'path', 'teaching', 'profile', 'Teaching', 'PROFILE', '']) {
      const { status, agentIds } = await request({ capabilityType });
      expect(status).toBeUndefined();
      expect(agentIds.filter((id) => !defaultIds.includes(id))).toEqual([]);
    }

    // 未知值不再静默退化为 includeSystem 级别的全量，而是明确拒绝
    for (const capabilityType of ['x', 'tutoring2']) {
      const { status } = await request({ capabilityType });
      expect(status).toBe(400);
    }
  });

  // #229：`?capabilityType=x` / `Teaching` / `PROFILE` / `tutoring2` 修前既不命中
  // `capabilityType in capabilityAgents`、又因是「真值」跳过默认白名单，where 退化成
  // { userId }，逐字节等于 includeSystem=true 的全量日志（api-gateway 与内部 skill 全漏出）。
  it('#229 未知 capabilityType 返回 400 VALIDATION_ERROR 并列出允许值，不退化成全量日志', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const callWith = async (capabilityType: unknown) => {
      const res = createResponse();
      await routes['GET /me/agent-logs'](
        { user: { userId: 'user-1' }, query: { capabilityType } } as any,
        res,
        jest.fn()
      );
      return res;
    };

    const allowed = ['goal', 'path', 'teaching', 'profile', 'tutoring', 'tracking', 'system'];
    // 未知字符串（拼错 / 大小写变体之外的错值）+ 非字符串（重复参数成数组 / 数字）：一律拒绝
    for (const bad of ['x', 'tutoring2', 'teaching2', ['teaching', 'x'], 7]) {
      const res = await callWith(bad);
      expect(res.statusCode).toBe(400);
      expect(res.body?.success).toBe(false);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      // 允许值必须回给调用方（静默退化是最差选项）
      for (const value of allowed) {
        expect(res.body?.error?.message).toContain(value);
      }
      if (typeof bad === 'string') {
        // 报错回显具体非法值，便于前端定位是哪个筛选键写错了
        expect(res.body?.error?.message).toContain(`无效：${bad}`);
      }
    }
    // 被拒即不触库：没有任何一条请求落到「无 agentId 筛选」的 where
    expect(agentLogMocks.findMany).not.toHaveBeenCalled();
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

  it('page 负值被钳制为 1（组起点=0），不向 Prisma 传负 skip', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const req: any = { user: { userId: 'user-1' }, query: { page: '-5' } };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    // #214：分页建立在折叠后的组上，取数不再传 skip/take，而是全量（有上限）后对组切片
    const args = agentLogMocks.findMany.mock.calls.at(-1)?.[0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBe(5000);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.pagination?.page).toBe(1);
  });

  it('total/分页以折叠后的组为准（#214：原始行数 4 折成 1 组时 total=1）', async () => {
    const mkPathStage = (id: string, calledAt: string) => ({
      id,
      agentId: 'path-agent',
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      metadata: JSON.stringify({
        eventType: 'path-generation-stage',
        executionLayer: 'flow-event',
        phase: 'core',
        sourceConversationId: 'gc_same',
      }),
      traceId: `tr-${id}`,
    });
    // 同一会话 4 条原始行 → 折叠成 1 个 path 组
    agentLogMocks.findMany.mockResolvedValue([
      mkPathStage('pa1', '2026-09-04T11:00:00.000Z'),
      mkPathStage('pa2', '2026-09-04T11:00:01.000Z'),
      mkPathStage('pa3', '2026-09-04T11:00:02.000Z'),
      mkPathStage('pa4', '2026-09-04T11:00:03.000Z'),
    ]);
    const req: any = { user: { userId: 'user-1' }, query: { page: '1', limit: '100' } };
    const res = createResponse();

    await routes['GET /me/agent-logs'](req, res, jest.fn());

    expect(res.body?.data?.logs).toHaveLength(1);
    expect(res.body?.data?.pagination).toEqual({ page: 1, limit: 100, total: 1, totalPages: 1 });
  });

  it('翻页在组上推进，不再跨页重复返回同一组（#214）', async () => {
    const mkPathStage = (id: string, conv: string, calledAt: string) => ({
      id,
      agentId: 'path-agent',
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      metadata: JSON.stringify({
        eventType: 'path-generation-stage',
        executionLayer: 'flow-event',
        phase: 'core',
        sourceConversationId: conv,
      }),
      traceId: `tr-${id}`,
    });
    // 三个不同会话，各 2 条 → 3 个组（每组折叠后 id 取稳定 groupKey）
    agentLogMocks.findMany.mockResolvedValue([
      mkPathStage('a1', 'gc_a', '2026-09-04T11:00:03.000Z'),
      mkPathStage('a2', 'gc_a', '2026-09-04T11:00:03.500Z'),
      mkPathStage('b1', 'gc_b', '2026-09-04T11:00:02.000Z'),
      mkPathStage('b2', 'gc_b', '2026-09-04T11:00:02.500Z'),
      mkPathStage('c1', 'gc_c', '2026-09-04T11:00:01.000Z'),
      mkPathStage('c2', 'gc_c', '2026-09-04T11:00:01.500Z'),
    ]);

    const page1: any = { user: { userId: 'user-1' }, query: { page: '1', limit: '2' } };
    const res1 = createResponse();
    await routes['GET /me/agent-logs'](page1, res1, jest.fn());

    const page2: any = { user: { userId: 'user-1' }, query: { page: '2', limit: '2' } };
    const res2 = createResponse();
    await routes['GET /me/agent-logs'](page2, res2, jest.fn());

    const ids1 = (res1.body?.data?.logs ?? []).map((l: any) => l.id);
    const ids2 = (res2.body?.data?.logs ?? []).map((l: any) => l.id);
    expect(ids1).toEqual(['path:gc_a', 'path:gc_b']);
    expect(ids2).toEqual(['path:gc_c']);
    // 两页无重复
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    expect(res1.body?.data?.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(res2.body?.data?.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('列表返回的每个折叠组 id 都能被详情端点取到（#220：合成组键不再 404）', async () => {
    const mkLog = (id: string, agentId: string, calledAt: string, metadata: Record<string, any>) => ({
      id,
      agentId,
      sourceEntry: 'platform',
      calledAt: new Date(calledAt),
      success: true,
      errorCode: null,
      durationMs: 1000,
      metadata: JSON.stringify(metadata),
      traceId: `trace-${id}`,
    });
    agentLogMocks.findMany.mockResolvedValue([
      mkLog('g1', 'skill:goal-conversation', '2026-09-04T09:00:00.000Z', { conversationId: 'gc_conv1' }),
      mkLog('g2', 'skill:goal-conversation', '2026-09-04T09:02:00.000Z', { conversationId: 'gc_conv1' }),
      mkLog('p1', 'path-agent', '2026-09-04T09:05:00.000Z', { sourceConversationId: 'gc_path', phase: 'core' }),
      mkLog('p2', 'path-agent', '2026-09-04T09:06:00.000Z', { sourceConversationId: 'gc_path', phase: 'stageDesign' }),
    ]);

    const listRes = createResponse();
    await routes['GET /me/agent-logs']({ user: { userId: 'user-1' }, query: {} }, listRes, jest.fn());
    const logs = listRes.body?.data?.logs ?? [];
    expect(logs.map((l: any) => l.id).sort()).toEqual(['goal:gc_conv1', 'path:gc_path']);

    // 契约：列表里声明可查的 id（折叠组键），详情端点必须 200 且返回同一组
    for (const row of logs) {
      agentLogMocks.findFirst.mockClear();
      const detailRes = createResponse();
      await routes['GET /me/agent-logs/:logId'](
        { user: { userId: 'user-1' }, params: { logId: row.id }, query: {} },
        detailRes,
        jest.fn()
      );
      expect(detailRes.statusCode).toBeUndefined();
      expect(detailRes.body?.success).toBe(true);
      expect(detailRes.body?.data?.id).toBe(row.id);
      expect(detailRes.body?.data?.groupCount).toBe(row.groupCount);
      expect(detailRes.body?.data?.groupItems).toHaveLength(row.groupCount);
      // 组内明细与列表完全一致（真实子项 id 可直接用于单条详情）
      expect(detailRes.body?.data?.groupItems.map((i: any) => i.id))
        .toEqual(row.groupItems.map((i: any) => i.id));
      // 组键走会话反查，不再拿合成键去主键表查
      expect(agentLogMocks.findFirst).not.toHaveBeenCalled();
    }

    // 组明细保留 phase，与列表口径一致
    const pathDetail = createResponse();
    await routes['GET /me/agent-logs/:logId'](
      { user: { userId: 'user-1' }, params: { logId: 'path:gc_path' }, query: {} },
      pathDetail,
      jest.fn()
    );
    expect(pathDetail.body?.data?.groupItems.map((i: any) => i.phase)).toEqual(['core', 'stageDesign']);
  });

  it('真实主键 id 的详情仍走主键查询（#220 不改变非折叠行）', async () => {
    agentLogMocks.findFirst.mockResolvedValue({ id: 'acl_real', agentId: 'skill:teaching-turn' });
    const res = createResponse();

    await routes['GET /me/agent-logs/:logId'](
      { user: { userId: 'user-1' }, params: { logId: 'acl_real' }, query: {} },
      res,
      jest.fn()
    );

    expect(agentLogMocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'acl_real', userId: 'user-1' }
    });
    expect(agentLogMocks.findMany).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: true,
      data: { id: 'acl_real', agentId: 'skill:teaching-turn' }
    });
  });

  it('查不到任何真实行的组键仍返回 404（不伪造组详情）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const res = createResponse();

    await routes['GET /me/agent-logs/:logId'](
      { user: { userId: 'user-1' }, params: { logId: 'path:gc_missing' }, query: {} },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(404);
    expect(res.body?.success).toBe(false);
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
