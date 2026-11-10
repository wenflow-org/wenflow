/**
 * 虚拟学习者取数范围（2026-10-25 用户「不播种，都派生」；2026-11-09 补第二来源标记）
 *
 * 身份池里的模板卡与实例同表（virtual_learner_profiles），判据是 profile JSON 里的来源标记：
 * 身份克隆写 `derivedFrom`，批量实验建号写 `origin`（2026-11-09 补：此前不写标记，
 * 它建的实例不进列表/统计/清理，成为孤儿数据）。卡墙按 `derivedFrom` 反向过滤（只列模板卡），
 * 本用例钉住另一半：
 *  - 虚拟学习者列表 / 分页总数只数实例（两个标记任一即可，模板卡两个都不写）；
 *  - 全量会话聚合（状态条 / 仿真看板 / 卡死候选 / 平均时长）同范围，
 *    否则会出现「列表 0 人、完成率却有数」。
 *
 * 判据落在 SQL where 上（profile JSON 子串），不依赖 Prisma 客户端是否有新列。
 */
const mockProfilesFindMany = jest.fn()
const mockProfilesCount = jest.fn()
const mockSessionsGroupBy = jest.fn()
const mockSessionsFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: {
      findMany: mockProfilesFindMany,
      count: mockProfilesCount,
    },
    virtual_sessions: {
      groupBy: mockSessionsGroupBy,
      findMany: mockSessionsFindMany,
    },
  },
}))

import {
  listProfilesWithSessionSamples,
  countProfiles,
} from '../virtual-learner-profile.repo';
import {
  getSessionStatusAggregates,
  findStaleSessionCandidates,
  findStaleSessionsForStats,
  findLiveSessionsAll,
  findTerminalSessions,
  findRunningSessionsForStats,
} from '../virtual-session.repo';

/** 实例判据：profile JSON 里出现任一来源标记键（模板卡两个都不写） */
const INSTANCE_WHERE = {
  OR: [{ profile: { contains: '"derivedFrom"' } }, { profile: { contains: '"origin"' } }],
};

describe('虚拟学习者取数范围 = 实例', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfilesFindMany.mockResolvedValue([]);
    mockProfilesCount.mockResolvedValue(0);
    mockSessionsGroupBy.mockResolvedValue([]);
    mockSessionsFindMany.mockResolvedValue([]);
  });

  it('列表只取实例（模板卡不进虚拟学习者列表）', async () => {
    await listProfilesWithSessionSamples(0, 20);
    expect(mockProfilesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: INSTANCE_WHERE }),
    );
  });

  it('批量实验建的实例也算实例（origin 标记，不再成为孤儿数据）', () => {
    /* 判据必须同时认两个标记键：只认 derivedFrom 的话，批量实验建的账号既不在列表、
       不进统计，也进不了清理向导（2026-11-09 运营核查发现的孤儿数据） */
    const keys = (INSTANCE_WHERE.OR as Array<{ profile: { contains: string } }>)
      .map((clause) => clause.profile.contains);
    expect(keys).toContain('"derivedFrom"');
    expect(keys).toContain('"origin"');
  });

  it('分页总数与列表同范围（否则「共 N 位」对不上行数）', async () => {
    await countProfiles();
    expect(mockProfilesCount).toHaveBeenCalledWith({ where: INSTANCE_WHERE });
  });

  it('状态聚合只算实例的会话（列表 0 人时不能有完成率）', async () => {
    await getSessionStatusAggregates();
    expect(mockSessionsGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { virtual_learner_profiles: INSTANCE_WHERE },
      }),
    );
  });

  it.each([
    ['卡死候选（列表 staleCount）', () => findStaleSessionCandidates(new Date())],
    ['卡死候选（仿真看板）', () => findStaleSessionsForStats(new Date())],
    ['非终态会话（running/paused 推导）', () => findLiveSessionsAll()],
    ['终态会话（平均时长）', () => findTerminalSessions()],
    ['全局运行中会话', () => findRunningSessionsForStats()],
  ])('%s 与列表同范围', async (_label, call) => {
    await call();
    expect(mockSessionsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          virtual_learner_profiles: INSTANCE_WHERE,
        }),
      }),
    );
  });
});
