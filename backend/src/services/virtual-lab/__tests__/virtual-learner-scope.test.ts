/**
 * 虚拟学习者取数范围（2026-10-25 用户「不播种，都派生」）
 *
 * 身份池里的模板卡与派生实例同表（virtual_learner_profiles），唯一年龄可辨的标记是
 * 身份克隆时写进 profile JSON 的 derivedFrom。卡墙早已按它反向过滤（只列模板卡），
 * 本用例钉住另一半：
 *  - 虚拟学习者列表 / 分页总数只数派生实例；
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

/** 派生实例判据：profile JSON 里出现 derivedFrom 键（模板卡从不写这个键） */
const DERIVED_PROFILE = { contains: '"derivedFrom"' };

describe('虚拟学习者取数范围 = 派生实例', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfilesFindMany.mockResolvedValue([]);
    mockProfilesCount.mockResolvedValue(0);
    mockSessionsGroupBy.mockResolvedValue([]);
    mockSessionsFindMany.mockResolvedValue([]);
  });

  it('列表只取派生实例（模板卡不进虚拟学习者列表）', async () => {
    await listProfilesWithSessionSamples(0, 20);
    expect(mockProfilesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profile: DERIVED_PROFILE } }),
    );
  });

  it('分页总数与列表同范围（否则「共 N 位」对不上行数）', async () => {
    await countProfiles();
    expect(mockProfilesCount).toHaveBeenCalledWith({ where: { profile: DERIVED_PROFILE } });
  });

  it('状态聚合只算派生实例的会话（列表 0 人时不能有完成率）', async () => {
    await getSessionStatusAggregates();
    expect(mockSessionsGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { virtual_learner_profiles: { profile: DERIVED_PROFILE } },
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
          virtual_learner_profiles: { profile: DERIVED_PROFILE },
        }),
      }),
    );
  });
});
