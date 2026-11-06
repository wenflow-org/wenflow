/**
 * LearnerSnapshotRefreshService.listForAdmin 口径测试
 * （2026-10-21 用户拍板「没有测试，测试只是备注」：默认只排除虚拟学习者，
 *  测试/审计账号照常计入并以行内备注标识；includeTest 是按 id 直查虚拟账号的逃生口）
 */
export {}

// 风险队列默认视图会先按单点口径扫一次 users 拿排除 id（utils/test-account），
// 与列表查询共用 mock：按入参形状分流，业务断言仍取 usersFindMany.mock.calls[0]
const mockTestAccountRows: any[] = [
  { id: 'u-test', name: 'e2e_ms0fz3yx', email: 'e2e_ms0fz3yx@example.com', isVirtualLearner: false },
];

const usersFindMany = jest.fn();
const usersCount = jest.fn();
const projectionsFindMany = jest.fn();
const projectionsFindUnique = jest.fn();
const projectionsUpsert = jest.fn();
/** #205：无 active 路径用户的「路径身份」回退查询（展示用，不参与快照锚定） */
const learningPathsFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: {
      findMany: (args: any) =>
        args?.select?.isVirtualLearner === true && !args?.where
          ? Promise.resolve(mockTestAccountRows)
          : usersFindMany(args),
      count: (...args: any[]) => usersCount(...args),
    },
    learning_paths: {
      findMany: (...args: any[]) => learningPathsFindMany(...args),
    },
    learner_projections: { findMany: projectionsFindMany, findUnique: projectionsFindUnique, upsert: projectionsUpsert },
  },
}));

// clearAllMocks 不清实现：默认「没有回退身份」；用例按需 mockResolvedValueOnce 覆写。
learningPathsFindMany.mockResolvedValue([]);

jest.mock('../LearnerSnapshotService', () => ({
  learnerSnapshotService: { getSnapshot: jest.fn() },
}));

// 用 require 而非 import：避免 import 提升导致 mock 工厂在 jest.fn() 初始化前被求值（TDZ）
const { learnerSnapshotRefreshService } = require('../LearnerSnapshotRefreshService');

const baseSnapshot: any = {
  freshness: { generatedAt: new Date().toISOString(), confidence: 0.6 },
  dynamicState: { recentTrend: 'stable', fatigueRisk: 'low' },
  knowledgeMemory: {
    currentPath: { currentPosition: { milestoneTitle: '阶段 1', taskTitle: '任务 A' } },
    globalSignals: { masteredConcepts: ['概念甲'], fragileConcepts: [], strugglingConcepts: [] },
  },
};

const baseUser = (over: Record<string, unknown>) => ({
  id: 'u1',
  name: '陈晓',
  email: 'chenxiao@example.com',
  learning_paths: [],
  ...over,
});

function stubFreshProjections() {
  const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
  learnerSnapshotService.getSnapshot.mockResolvedValue(baseSnapshot);
  projectionsFindUnique.mockResolvedValue(null);
  projectionsUpsert.mockResolvedValue({});
}

describe('listForAdmin 口径（只排除虚拟学习者）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('默认：where 只有 isVirtualLearner:false + 软删（测试账号不再被 id 排除）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isVirtualLearner).toBe(false);
    expect(where.id).toBeUndefined();
    expect(usersCount.mock.calls[0][0].where).toEqual(where);
  });

  it('includeTest=true：不过滤测试/虚拟账号（管理需要显式包含）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    await learnerSnapshotRefreshService.listForAdmin({ limit: 50, includeTest: true });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where).not.toHaveProperty('isVirtualLearner');
    expect(where).not.toHaveProperty('id');
  });

  it('列表项带 isTestAccount 标记（真实用户 false）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });
    expect(data.total).toBe(1);
    expect(data.items[0].isTestAccount).toBe(false);
  });

  it('测试账号按命名约定标记 isTestAccount=true（供行内「测试」备注）', async () => {
    usersFindMany.mockResolvedValue([
      baseUser({ id: 'u-qa', name: 'E2E_ms0fz3yx', email: 'e2e_ms0fz3yx@example.com' }),
    ]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });
    expect(data.items[0].isTestAccount).toBe(true);
  });

  /* #205：无 active 路径的用户此前行内「路径」列恒空（active-only 过滤）。
     修法：路径身份回退到最近的非 abandoned 路径用于展示，但快照锚点仍只认 active——
     pathId 保持 null、快照走 global 口径，避免 currentPath 被锚到 archived（同一 bug 在列表重现），
     也避免前端重算带 archived pathId 写 path 键而本行读 global 键（LearnerCenter.vue:390/741）。
     身份回退走独立查询，不靠放宽嵌套 where 的 take（否则更新的归档路径可能把 active 挤出窗口）。 */
  it('无 active 路径：路径身份回退展示非 abandoned 路径，但不锚定（pathId null / global 口径）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'u-arch', learning_paths: [] })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    learningPathsFindMany.mockResolvedValueOnce([{ userId: 'u-arch', title: '归档路径' }]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });
    expect(data.items[0].pathTitle).toBe('归档路径');
    expect(data.items[0].pathId).toBeNull();
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
    expect(learnerSnapshotService.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-arch', learningPathId: undefined, mode: 'global' }),
    );
  });

  it('有 active 路径：锚点与身份都取 active 路径（行为不变）', async () => {
    usersFindMany.mockResolvedValue([
      baseUser({
        id: 'u-act',
        learning_paths: [{ id: 'p-act', title: '进行中路径', status: 'active', updatedAt: new Date() }],
      }),
    ]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });
    expect(data.items[0].pathId).toBe('p-act');
    expect(data.items[0].pathTitle).toBe('进行中路径');
    // 有 active 路径时不查身份回退
    expect(learningPathsFindMany).not.toHaveBeenCalled();
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
    expect(learnerSnapshotService.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-act', learningPathId: 'p-act', mode: 'path' }),
    );
  });
});

/**
 * 数据更新列（2026-10-23 用户「怎么都是 37 分钟呢」）：
 * generatedAt 是快照重建时刻，列表一次请求会整批重建 → 全表同值；
 * 列改读 freshness.basedOn 里最新的证据时间，无证据回 null。
 */
describe('listForAdmin dataUpdatedAt（学习证据最后变化时刻）', () => {
  beforeEach(() => jest.clearAllMocks());

  /* 每个用例用独立 userId：服务实例有 5 分钟快照缓存（键含 userId），
     复用 real1 会读到前面用例缓存下来的无 basedOn 快照 */
  const withBasedOn = (basedOn: Record<string, string | undefined>, userId = 'u-dau-1') => {
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
    usersFindMany.mockResolvedValue([baseUser({ id: userId })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    projectionsFindUnique.mockResolvedValue(null);
    projectionsUpsert.mockResolvedValue({});
    learnerSnapshotService.getSnapshot.mockResolvedValue({
      ...baseSnapshot,
      freshness: { ...baseSnapshot.freshness, basedOn },
    });
  };

  it('取 basedOn 里最新的一条（不是 generatedAt）', async () => {
    withBasedOn({
      latestGoalConversationAt: '2026-10-19T17:45:18.351Z',
      latestTeachingSessionAt: '2026-10-21T08:03:00.000Z',
      latestTaskCompletionAt: '2026-10-20T18:33:26.134Z',
    });
    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: true });
    expect(data.items[0].dataUpdatedAt).toBe('2026-10-21T08:03:00.000Z');
    // 重建时刻仍随行返回（排查用，前端只在悬停里披露）
    expect(typeof data.items[0].generatedAt).toBe('string');
  });

  it('一条证据都没有（未开始学习）→ null，不拿重建时间冒充', async () => {
    withBasedOn({}, 'u-dau-2');
    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: true });
    expect(data.items[0].dataUpdatedAt).toBeNull();
  });

  it('basedOn 缺字段（老快照）→ null，不抛错', async () => {
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
    usersFindMany.mockResolvedValue([baseUser({ id: 'u-dau-3' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    projectionsFindUnique.mockResolvedValue(null);
    projectionsUpsert.mockResolvedValue({});
    learnerSnapshotService.getSnapshot.mockResolvedValue({
      ...baseSnapshot,
      freshness: { generatedAt: baseSnapshot.freshness.generatedAt, confidence: 0.6 },
    });
    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: true });
    expect(data.items[0].dataUpdatedAt).toBeNull();
  });
});

/**
 * #176-2：staleOnly 的陈旧判定改读 dataUpdatedAt（学习证据最后变化时刻）。
 * 病灶：旧实现按 generatedAt 判——列表一次请求会把过期投影整批重建，
 * 于是「刚被重建过的老用户」看起来最新被过滤掉，真正长期没学习的反而被隐藏。
 */
describe('listForAdmin staleOnly（#176-2：按 dataUpdatedAt 判陈旧）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('重建时刻很新但 dataUpdatedAt 很旧/为空 → 仍是陈旧用户；只有真正有近期证据的才被过滤', async () => {
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');
    const freshEvidence = new Date(Date.now() - 60 * 1000).toISOString();
    const staleEvidence = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const basedOnByUser: Record<string, Record<string, string>> = {
      'u-stale-evidence': { latestTaskCompletionAt: staleEvidence },
      'u-stale-null': {},
      'u-fresh-evidence': { latestTaskCompletionAt: freshEvidence },
    };

    usersFindMany.mockResolvedValue([
      baseUser({ id: 'u-stale-evidence' }),
      baseUser({ id: 'u-stale-null' }),
      baseUser({ id: 'u-fresh-evidence' }),
    ]);
    usersCount.mockResolvedValue(3);
    projectionsFindMany.mockResolvedValue([]);
    projectionsFindUnique.mockResolvedValue(null);
    projectionsUpsert.mockResolvedValue({});
    // generatedAt 三者相同且都是"刚刚"（模拟列表整批重建）：旧实现会把三人都判成最新。
    learnerSnapshotService.getSnapshot.mockImplementation(async (input: { userId: string }) => ({
      ...baseSnapshot,
      freshness: {
        ...baseSnapshot.freshness,
        generatedAt: new Date().toISOString(),
        basedOn: basedOnByUser[input.userId],
      },
    }));

    const data = await learnerSnapshotRefreshService.listForAdmin({
      limit: 50,
      includeTest: true,
      staleOnly: true,
    });

    const ids = data.items.map((item: { userId: string }) => item.userId);
    expect(ids).toContain('u-stale-evidence');
    // dataUpdatedAt 为 null 视为最陈旧，不能被当成最新
    expect(ids).toContain('u-stale-null');
    expect(ids).not.toContain('u-fresh-evidence');
  });

  /**
   * #176-2 复核：列表路径的 60 分钟保鲜窗是给「缓变趋势信号」的，但它同样能让
   * **失效前落地**的那行投影继续被展示——画像变更后 invalidate 只清了内存键，
   * 列表读到旧载荷又把它写回内存，失效等于空转。
   */
  it('invalidate 之后，列表不得再返回失效前落地的持久化投影（水位同样管住列表路径）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'u-wm-list' })]);
    usersCount.mockResolvedValue(1);
    stubFreshProjections();
    const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');

    // 无 active 路径 → global 口径的投影键（与 buildKey 一致）
    const key = ['learner-snapshot-v1', 'u-wm-list', 'global', 'global', 'none', 'none'].join(':');
    projectionsFindMany.mockResolvedValue([
      { projectionKey: key, payload: JSON.stringify(baseSnapshot), generatedAt: new Date(Date.now() - 30_000) },
    ]);

    learnerSnapshotRefreshService.invalidate('u-wm-list');
    await learnerSnapshotRefreshService.listForAdmin({ limit: 50, includeTest: true });

    // 该行被判失效 → 走重建，而不是把它读出来展示
    expect(learnerSnapshotService.getSnapshot).toHaveBeenCalled();

    // 对照组：没有失效的用户命中同一行，不重建
    (learnerSnapshotService.getSnapshot as jest.Mock).mockClear();
    usersFindMany.mockResolvedValue([baseUser({ id: 'u-no-wm-list' })]);
    const otherKey = ['learner-snapshot-v1', 'u-no-wm-list', 'global', 'global', 'none', 'none'].join(':');
    projectionsFindMany.mockResolvedValue([
      { projectionKey: otherKey, payload: JSON.stringify(baseSnapshot), generatedAt: new Date(Date.now() - 30_000) },
    ]);
    await learnerSnapshotRefreshService.listForAdmin({ limit: 50, includeTest: true });
    expect(learnerSnapshotService.getSnapshot).not.toHaveBeenCalled();
  });
});
