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
    learner_projections: { findMany: projectionsFindMany, findUnique: projectionsFindUnique, upsert: projectionsUpsert },
  },
}));

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
