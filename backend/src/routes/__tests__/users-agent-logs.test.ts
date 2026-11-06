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
import { listAgentManifest, listUserListedAgentIds } from '../../services/agent-manifest.service';

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

  // #218 复核残余：能力筛选此前 = manifest 监控组 ∩ userListed，而 Profile 组十条 manifest
  // 一条 userListed 都没有（学习模型 / 预测 / 状态复盘都是平台内部 skill），于是
  // map.profile 恒为空数组——库里真实存在 skill:learning-predictor 等调用却永远筛不出来。
  // 现在能力筛选 = 该监控组的 manifest 全量成员（kind !== 'alias'），默认视图仍是
  // userListed 白名单（见上一个用例），两条范围解耦。
  it('capabilityType 分组 = manifest 监控组全量成员；profile 不再恒空（#218）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const agentIdsFor = async (capabilityType: string): Promise<string[]> => {
      const req: any = { user: { userId: 'user-1' }, query: { format: 'json', capabilityType } };
      await routes['GET /me/agent-logs/export'](req, createResponse(), jest.fn());
      return agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where?.agentId?.in as string[];
    };
    const groupIdsOf = (group: string): string[] =>
      listAgentManifest()
        .filter((entry) => entry.monitoringGroup === group && entry.kind !== 'alias')
        .map((entry) => entry.id);

    // 真实授课 id 是 skill:teaching-turn（manifest Teaching 组，线上 327 行）；
    // 旧硬编码 id ai-teaching-agent 线上 0 行，曾让该筛选恒空。
    const teaching = await agentIdsFor('teaching');
    expect(teaching).toContain('skill:teaching-turn');
    expect(teaching).not.toContain('ai-teaching-agent');
    expect([...teaching].sort()).toEqual([...groupIdsOf('Teaching')].sort());

    // 病灶断言：Profile 组必须非空，且必须带上真在写日志的 profile skill。
    // 恒空（上一轮）会让 /me/agent-logs?capabilityType=profile 永远 0 行。
    const profile = await agentIdsFor('profile');
    expect(profile.length).toBeGreaterThan(0);
    expect(profile).toEqual(expect.arrayContaining([
      'skill:learning-predictor',
      'skill:learner-state-review',
      'skill:learner-model',
    ]));
    expect([...profile].sort()).toEqual([...groupIdsOf('Profile')].sort());
    // alias 节点不得混进集合（旧 id 线上 0 行，混进来只会白占 SQL in 列表）
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

  // #218/#229：两个契约同时成立——(a) 合法能力键必出该能力的集合，且不同能力集合互不重叠；
  // (b) 能力集合绝不包含 manifest 之外/平台底层 id（api-gateway / system-call / unknown）。
  // 原「能力筛选 ⊆ 默认结果集」的断言是上一轮为解释 profile 恒空而引入的，已被产品口径
  // 有意取代（system 这个合法键本来就不在默认白名单内）；它在下面单独改写为新契约用例，
  // 这里换成能抓住真实病灶的两条。
  it('能力筛选 = 各自监控组的集合，互不重叠且不含平台底层 id（#218/#229）', async () => {
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

    const seen = new Map<string, string>();
    for (const capabilityType of ['goal', 'path', 'teaching', 'profile']) {
      const { status, agentIds } = await request({ capabilityType });
      expect(status).toBeUndefined();
      expect(Array.isArray(agentIds)).toBe(true);
      const ids = agentIds as string[];
      expect(ids.length).toBeGreaterThan(0);
      // 不越出 manifest 的已知 id（能力筛选不是全量出口）
      for (const id of ids) {
        expect(listAgentManifest().some((entry) => entry.id === id)).toBe(true);
        expect(['api-gateway', 'system-call', 'unknown']).not.toContain(id);
      }
      // 不同能力集合互不重叠（同一个 id 只能属于一个监控组）
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, capabilityType);
      }
    }

    // 大小写变体明确等价：同一集合（而不是被当成未知值 / 静默全量）
    for (const [variant, canonical] of [['Teaching', 'teaching'], ['PROFILE', 'profile']] as const) {
      const variantIds = (await request({ capabilityType: variant })).agentIds as string[];
      const canonicalIds = (await request({ capabilityType: canonical })).agentIds as string[];
      expect([...variantIds].sort()).toEqual([...canonicalIds].sort());
    }

    // 空串 = 不筛选，回到 userListed 默认白名单（不是「能力键被静默吞掉」）
    const empty = await request({ capabilityType: '' });
    expect(empty.status).toBeUndefined();
    expect(empty.agentIds).toEqual(listUserListedAgentIds());

    // 未知值不再静默退化为 includeSystem 级别的全量，而是明确拒绝
    for (const capabilityType of ['x', 'tutoring2']) {
      const { status } = await request({ capabilityType });
      expect(status).toBe(400);
    }
  });

  // 旧契约「能力筛选 ⊆ 默认视图（userListed）」被产品口径**有意取代**（2026-11-06 定论，
  // #218 × #226 子项 3）——不是被悄悄破坏，所以这里保留对旧不变式的说明、把它改写为对新
  // 契约的明确断言，而不是删掉：
  //   默认视图（不带 capabilityType）= manifest userListed；
  //   显式指定 capabilityType      = 该监控组全量成员，**可以有意超出默认视图**。
  // 取代理由：这条子集约束从来不是产品语义——system（['system-call','unknown']）早就是
  // 「显式选择 = 放宽到默认视图之外」的先例；#218 的病灶恰恰是把它强加到 profile 上，
  // 使 Profile 组（十条 manifest 全部非 userListed）恒空。用户点「学习者模型」是明确要
  // 看这一类调用，内部 skill 照常出现（这正是 #226 子项 3 与 #218 的取舍：显式选择优先）。
  it('显式能力筛选刻意放宽到默认视图之外：profile/system 含 userListed 默认集合看不到的成员（#218/#226 子项 3）', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const agentIdsFor = async (capabilityType: string): Promise<string[]> => {
      const req: any = { user: { userId: 'user-1' }, query: { format: 'json', capabilityType } };
      await routes['GET /me/agent-logs/export'](req, createResponse(), jest.fn());
      return agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where?.agentId?.in as string[];
    };

    const userListed = listUserListedAgentIds();

    // profile：能力集合 = Profile 组全量成员，刻意包含默认视图（userListed）看不到的内部 skill
    const profile = await agentIdsFor('profile');
    expect(profile).toEqual(expect.arrayContaining(['skill:learning-predictor', 'skill:learner-model']));
    expect(userListed).not.toContain('skill:learning-predictor');
    expect(userListed).not.toContain('skill:learner-model');
    // 直接断言「确实不是默认视图的子集」：确有成员在默认集合之外（旧不变式在此被有意打破）
    expect(profile.some((id) => !userListed.includes(id))).toBe(true);

    // system：同一口径的既有先例——显式键本来就是「放宽到默认视图之外」
    const system = await agentIdsFor('system');
    expect(system).toEqual(['system-call', 'unknown']);
    expect(system.every((id) => !userListed.includes(id))).toBe(true);
  });

  // #218：筛选结果必须真的能被用户看见——服务端筛出 skill:learning-predictor 的行后，
  // 列表接口要把它们放进 data.logs（mock 不模拟 SQL 过滤，但能锁住「where 命中 + 响应透出」）。
  it('capabilityType=profile 时列表返回学习模型类调用行（#218）', async () => {
    const row = {
      id: 'acl_predict',
      agentId: 'skill:learning-predictor',
      sourceEntry: 'platform',
      calledAt: new Date('2026-11-05T02:00:00.000Z'),
      success: true,
      errorCode: null,
      durationMs: 900,
      metadata: JSON.stringify({ model: 'deepseek-v4.1-flash', layer: 'skill-executor' }),
      traceId: 'trace-predict',
    };
    agentLogMocks.findMany.mockResolvedValue([row]);
    const res = createResponse();
    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: { capabilityType: 'profile' } } as any,
      res,
      jest.fn()
    );

    // 列表路径后面还会发模型补全查询（按 traceId/pathId 取网关行，where 不带 agentId），
    // 所以取「带 agentId.in 的那次」而不是最后一次 mock 调用。
    const mainCall = agentLogMocks.findMany.mock.calls
      .find((call: any[]) => Array.isArray(call[0]?.where?.agentId?.in));
    expect(mainCall).toBeTruthy();
    expect(mainCall![0].where.agentId.in).toContain('skill:learning-predictor');
    expect((res.body?.data?.logs ?? []).map((log: any) => log.agentId)).toContain('skill:learning-predictor');
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

  // #246：无 traceId 时的去重键退化成「同 agentId + 同秒即重复」，把「同一次调用重复落库」
  // 的语义降级成「同秒不同事件也互撞」。path-agent 阶段流水写侧不写 traceId，而父阶段
  // succeeded 与子阶段 started 在生产上只差几十毫秒、必然落进同一秒，于是一条真实事件被
  // 静默丢弃、groupCount 少 1。修复：退化键必须带上事件身份（metadata.phase + metadata.status）。
  it('#246 同秒、无 traceId、但 phase/status 不同的 path-agent 行不再被当重复吞掉', async () => {
    const mkStage = (id: string, phase: string, status: string, ms: number) => ({
      id,
      agentId: 'path-agent',
      sourceEntry: 'platform',
      calledAt: new Date(`2026-09-04T11:00:00.${String(ms).padStart(3, '0')}Z`),
      success: status === 'succeeded',
      errorCode: null,
      metadata: JSON.stringify({
        eventType: 'path-generation-stage',
        executionLayer: 'flow-event',
        phase,
        status,
        pathId: 'lp_events',
        sourceConversationId: 'gc_events',
      }),
      traceId: null,
    });
    // 同秒（11:00:00.000 vs .017）、同为 path-agent、traceId 均为 null，但阶段/状态不同
    agentLogMocks.findMany.mockResolvedValue([
      mkStage('acl_core_done', 'core', 'succeeded', 0),
      mkStage('acl_stage_start', 'stageDesign', 'started', 17),
    ]);
    const res = createResponse();

    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: {} } as any,
      res,
      jest.fn()
    );

    const logs = res.body?.data?.logs ?? [];
    // 修复前两条被去重成 1 行，items.length<=1 时组键不生效、只剩一条原始行（groupCount 缺失）；
    // 修复后应出现 path:gc_events 组且 groupCount=2。
    const group = logs.find((l: any) => l.id === 'path:gc_events')
      ?? logs.find((l: any) => String(l.agentId) === 'path-agent');
    expect(group).toBeTruthy();
    // 两条都是真实事件：都被保留、groupCount 必须是 2
    expect(group.groupCount).toBe(2);
    expect(group.groupItems.map((i: any) => i.id).sort())
      .toEqual(['acl_core_done', 'acl_stage_start']);
  });

  it('#246 没修过头：真重复（同秒、同 agent、同 phase/status）的行仍被合并', async () => {
    const mkStage = (id: string, phase: string, status: string, ms: number) => ({
      id,
      agentId: 'path-agent',
      sourceEntry: 'platform',
      calledAt: new Date(`2026-09-04T12:00:00.${String(ms).padStart(3, '0')}Z`),
      success: true,
      errorCode: null,
      metadata: JSON.stringify({
        eventType: 'path-generation-stage',
        executionLayer: 'flow-event',
        phase,
        status,
        pathId: 'lp_dup',
        sourceConversationId: 'gc_dup',
      }),
      traceId: null,
    });
    agentLogMocks.findMany.mockResolvedValue([
      mkStage('acl_dup_a', 'core', 'succeeded', 0),
      mkStage('acl_dup_b', 'core', 'succeeded', 400),
      mkStage('acl_other', 'stageDesign', 'started', 600),
    ]);
    const res = createResponse();

    await routes['GET /me/agent-logs'](
      { user: { userId: 'user-1' }, query: {} } as any,
      res,
      jest.fn()
    );

    const logs = res.body?.data?.logs ?? [];
    const group = logs.find((l: any) => l.id === 'path:gc_dup')
      ?? logs.find((l: any) => String(l.agentId) === 'path-agent');
    expect(group).toBeTruthy();
    // 两条同 phase/status 的真重复折成 1 条，加上 stageDesign 那条 → groupCount=2（不是 3）
    expect(group.groupCount).toBe(2);
    const ids = group.groupItems.map((i: any) => i.id);
    expect(ids).toContain('acl_other');
    expect(ids.filter((id: string) => id !== 'acl_other')).toHaveLength(1);
  });

  // #247：agentId 与 capabilityType 同时下发时，此前是 if / else-if：agentId 真值直接短路，
  // capabilityType 连读都不读（合法键被静默吞掉，既不取交集也不 400）。前端是两个独立下拉、
  // buildFilterParams 会把两者同时发出，因此这是日常可达路径。修复：两者取交集。
  it('#247 agentId 与 capabilityType 同时下发时取交集，capabilityType 不再被静默忽略', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const whereFor = async (query: Record<string, unknown>) => {
      await routes['GET /me/agent-logs/export'](
        { user: { userId: 'user-1' }, query: { format: 'json', ...query } } as any,
        createResponse(),
        jest.fn()
      );
      return agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where;
    };

    // 相容：agentId 属于 path 能力集合（skill:path-planning / path-agent）→ 交集即该 id
    const compatible = await whereFor({ agentId: 'skill:path-planning', capabilityType: 'path' });
    expect(compatible.agentId).toEqual({ in: ['skill:path-planning'] });

    // 不相容：交集为空集，绝不退化成「只用 agentId」
    const incompatible = await whereFor({ agentId: 'skill:teaching-turn', capabilityType: 'path' });
    expect(incompatible.agentId).toEqual({ in: [] });
    expect(incompatible.agentId).not.toBe('skill:teaching-turn');
  });

  it('#247 没修过头：只传一个参数时的既有行为不变', async () => {
    agentLogMocks.findMany.mockResolvedValue([]);
    const whereFor = async (query: Record<string, unknown>) => {
      await routes['GET /me/agent-logs/export'](
        { user: { userId: 'user-1' }, query: { format: 'json', ...query } } as any,
        createResponse(),
        jest.fn()
      );
      return agentLogMocks.findMany.mock.calls.at(-1)?.[0]?.where;
    };

    // 只传 agentId：仍是单值字符串（不是 in 集合）
    expect((await whereFor({ agentId: 'skill:teaching-turn' })).agentId)
      .toBe('skill:teaching-turn');
    // 只传 capabilityType：仍是能力集合，且与修复前逐字段相同
    expect((await whereFor({ capabilityType: 'path' })).agentId)
      .toEqual({ in: expect.arrayContaining(['skill:path-planning', 'path-agent']) });
    // 两者都不传：仍是 manifest userListed 默认白名单
    const defaultWhere = await whereFor({});
    expect(Array.isArray(defaultWhere.agentId.in)).toBe(true);
    expect(defaultWhere.agentId.in.length).toBeGreaterThan(0);
    // includeSystem=true（无 agentId/capabilityType）：仍不带 agentId 条件
    expect((await whereFor({ includeSystem: 'true' })).agentId).toBeUndefined();
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

  it('真实主键 id 的详情走主键查询，并带上列表的可见/筛选口径（#220/#245）', async () => {
    agentLogMocks.findFirst.mockResolvedValue({ id: 'acl_real', agentId: 'skill:teaching-turn' });
    const res = createResponse();

    await routes['GET /me/agent-logs/:logId'](
      { user: { userId: 'user-1' }, params: { logId: 'acl_real' }, query: {} },
      res,
      jest.fn()
    );

    // #245 语义订正：此前详情只按 { id, userId } 取，绕过列表的可见口径（默认白名单与
    // success/日期筛选在详情分支整段失效）。现在与列表同一个 buildAgentLogWhere，主键仍精确匹配。
    // 该行无 traceId ⇒ 不需要补数查询，故 findMany 仍不应被调用。
    expect(agentLogMocks.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'acl_real',
        userId: 'user-1',
        agentId: { in: expect.any(Array) }
      })
    });
    expect(agentLogMocks.findMany).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: true,
      // 无 traceId 也无可补模型 ⇒ 与列表一致地归一化为 null（不再是原始行原样返回）
      data: { id: 'acl_real', agentId: 'skill:teaching-turn', model: null }
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

  // #251②：CSV 导出此前是 7 列 + 原始 Date（join 调 toString 的本地化长串），
  // 与列表两套口径（列表有模型/折叠条数、时间是格式化后的值）。
  it('CSV 导出列与列表同口径：含 model/groupCount，时间走 ISO 8601（#251）', async () => {
    const rows = [
      {
        id: 'acl_1',
        agentId: 'skill:teaching-turn',
        sourceEntry: 'platform',
        calledAt: new Date(Date.UTC(2026, 10, 5, 2, 3, 4)),
        success: true,
        errorCode: null,
        durationMs: 1200,
        tokensUsed: 321,
        metadata: JSON.stringify({ layer: 'skill-executor', model: 'deepseek-v4.1-flash' }),
        traceId: 'trace-1',
      },
    ];
    agentLogMocks.findMany.mockResolvedValue(rows);
    const res = createResponse();
    await routes['GET /me/agent-logs/export'](
      { user: { userId: 'user-1' }, query: { format: 'csv' } } as any,
      res,
      jest.fn()
    );

    expect(res.headers['Content-Type']).toBe('text/csv');
    const lines = String(res.body).split('\r\n');
    const headers = lines[0].split(',');
    // 列表里的「模型」「折叠条数」必须在导出里存在，否则用户核对页面数字对不上
    expect(headers).toEqual(expect.arrayContaining(['model', 'groupCount', 'calledAt']));
    expect(headers).toHaveLength(10);

    const record = Object.fromEntries(
      headers.map((header, index) => [header, lines[1].split(',')[index]])
    );
    // 时间必须是 ISO（UTC），不是 Date.toString() 的本地化长串
    expect(record.calledAt).toBe('2026-11-05T02:03:04.000Z');
    expect(record.model).toBe('deepseek-v4.1-flash');
    expect(record.groupCount).toBe('1');
    expect(record.tokensUsed).toBe('321');
    expect(record.success).toBe('true');
    expect(record.error).toBe('');
  });
});
