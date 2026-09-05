/**
 * LearnerSnapshotRefreshService.listForAdmin excludeTest 测试
 * （ADMIN_DEEP_LEARNER_AUDIT P1：风险队列剔除测试/虚拟账号，后端 where 排除）
 */
export {}

const usersFindMany = jest.fn();
const usersCount = jest.fn();
const projectionsFindMany = jest.fn();
const projectionsFindUnique = jest.fn();
const projectionsUpsert = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findMany: usersFindMany, count: usersCount },
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

describe('listForAdmin excludeTest（风险队列剔除测试账号）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludeTest=true：users.findMany/count where 含 isVirtualLearner:false 与 NOT 命名模式', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: true });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isVirtualLearner).toBe(false);
    expect(where.NOT).toEqual(expect.any(Array));
    expect(usersCount.mock.calls[0][0].where).toEqual(where);
  });

  it('未传参数：默认排除测试/虚拟账号（默认视图只给真实用户看）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    await learnerSnapshotRefreshService.listForAdmin({ limit: 50 });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isVirtualLearner).toBe(false);
    expect(where.NOT).toEqual(expect.any(Array));
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
    expect(where).not.toHaveProperty('NOT');
  });

  it('excludeTest=false：显式不过滤（向后兼容显式声明）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: false });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('isVirtualLearner');
    expect(where).not.toHaveProperty('NOT');
  });

  it('列表项带 isTestAccount 标记（真实用户 false）', async () => {
    usersFindMany.mockResolvedValue([baseUser({ id: 'real1' })]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: true });
    expect(data.total).toBe(1);
    expect(data.items[0].isTestAccount).toBe(false);
  });

  it('excludeTest=false 时测试账号按命名约定标记 isTestAccount=true（供前端灰标签）', async () => {
    usersFindMany.mockResolvedValue([
      baseUser({ id: 'virtual_abc', name: 'E2E_ms0fz3yx', email: 'virtual_93e4c032@test.local' }),
    ]);
    usersCount.mockResolvedValue(1);
    projectionsFindMany.mockResolvedValue([]);
    stubFreshProjections();

    const data = await learnerSnapshotRefreshService.listForAdmin({ limit: 50, excludeTest: false });
    expect(data.items[0].isTestAccount).toBe(true);
  });
});
