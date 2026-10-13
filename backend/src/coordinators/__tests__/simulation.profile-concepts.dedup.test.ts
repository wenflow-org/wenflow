/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 画像概念字段回写去重（A/B 报告 D13，2026-10-13）。
 *
 * 背景：knownConcepts 是 union-only（永不移除），但 struggleConcepts 此前只按「本轮 mastered」
 * 过滤——于是已在 known 里的概念（历史掌握/人设种子）若本轮不是 mastered，会同时留在 struggle，
 * 画像对同一概念自相矛盾（实测：林然/周雅两份 profile 的"信度与效度""区分主要学习理论主张"等
 * 同时出现在 known 与 struggle）。
 *
 * 契约：struggle 按**完整 known 集合**过滤（不再只看本轮 mastered），顺带自愈存量脏数据。
 */
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../skills', () => ({
  __esModule: true,
  executeSkill: jest.fn(),
  virtualLearnerMemoryCuratorDefinition: {},
}));

import { persistProfileConcepts } from '../simulation.memory';

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('persistProfileConcepts 画像概念去重（A/B 报告 D13）', () => {
  it('已在 known 的概念不再留在 struggle（按完整 known 集合过滤，非只按本轮 mastered）', async () => {
    mockFindUnique.mockResolvedValue({
      profile: JSON.stringify({
        knownConcepts: ['信度与效度', '区分主要学习理论主张'],
        struggleConcepts: ['信度与效度', '能力推断'],
      }),
    });

    await persistProfileConcepts('sess-1', 'u-1', [
      { name: '新的掌握点', status: 'mastered' },
      { name: '能力推断', status: 'learning' },
    ]);

    const data = mockUpdate.mock.calls[0][0].data;
    const known = JSON.parse(data.knownConcepts);
    const struggle = JSON.parse(data.struggleConcepts);

    expect(known).toEqual(expect.arrayContaining(['信度与效度', '区分主要学习理论主张', '新的掌握点']));
    // 旧脏数据「信度与效度」同时出现在 known 与 struggle → struggle 侧被清掉
    expect(struggle).not.toContain('信度与效度');
    expect(struggle).toContain('能力推断');
    // known / struggle 无交集
    expect(known.filter((c: string) => struggle.includes(c))).toEqual([]);
  });

  it('本轮 mastered 的概念从 struggle 移除（既有行为保持）', async () => {
    mockFindUnique.mockResolvedValue({
      profile: JSON.stringify({ knownConcepts: [], struggleConcepts: ['闭包'] }),
    });

    await persistProfileConcepts('sess-1', 'u-1', [{ name: '闭包', status: 'mastered' }]);

    const data = mockUpdate.mock.calls[0][0].data;
    expect(JSON.parse(data.knownConcepts)).toContain('闭包');
    expect(JSON.parse(data.struggleConcepts)).not.toContain('闭包');
  });
});
