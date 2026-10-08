/**
 * 批量创建路径的 cardKey（2026-10-08）。
 *
 * `provisionVirtualProfile` 是「批量新建」与批次实验共用的创建工厂；从这里建出的自建卡
 * 若没有 cardKey，会被「导出卡库」静默跳过（端到端验证实测过：自建 N 张、导出 0 张）。
 * 单建路由那条路已实机验证；这里把批量这条路钉住。
 */

const mockUserCreate = jest.fn(async (_args?: unknown) => ({ id: 'u-1' }));
const mockProfileCreate = jest.fn(async (args: { data: { id: string; profile: string } }) => ({
  id: args.data.id,
}));

jest.mock('../../config/database', () => ({
  prisma: {
    users: { create: (args: unknown) => mockUserCreate(args) },
    virtual_learner_profiles: {
      create: (args: { data: { id: string; profile: string } }) => mockProfileCreate(args),
    },
  },
}));
jest.mock('../../skills', () => ({ executeSkill: jest.fn() }));
jest.mock('../../skills/virtual-learner-persona-designer', () => ({ virtualLearnerPersonaDesignerDefinition: {} }));
jest.mock('../../skills/virtual-learner-scenario-designer', () => ({ virtualLearnerScenarioDesignerDefinition: {} }));

import { provisionVirtualProfile } from '../learner-provisioning';

const profileArgOf = (call: number): { id: string; profile: string } => {
  const args = mockProfileCreate.mock.calls[call][0] as unknown as { data: { id: string; profile: string } };
  return args.data;
};

describe('provisionVirtualProfile：批量创建的自建卡也要带 cardKey', () => {
  beforeEach(() => {
    mockUserCreate.mockClear();
    mockProfileCreate.mockClear();
  });

  it('输入没有 cardKey 时，写库带上 vl-<profileId 前 8 位>', async () => {
    const r = await provisionVirtualProfile({ name: '批量临时卡', profile: {} });
    const data = profileArgOf(0);
    expect(data.id).toBe(r.profileId);
    expect(JSON.parse(data.profile).cardKey).toBe(`vl-${r.profileId.slice(0, 8)}`);
  });

  it('输入已带 cardKey（导入式调用）时原样保留，不覆盖', async () => {
    await provisionVirtualProfile({ name: '导入式卡', profile: { cardKey: 'w6-math-01' } });
    expect(JSON.parse(profileArgOf(0).profile).cardKey).toBe('w6-math-01');
  });

  it('tags 里带卡 key（历史批量导入形态）时也不覆盖', async () => {
    await provisionVirtualProfile({ name: '历史形态', profile: {}, tags: ['w6', 'rw-school-26'] });
    const stored = JSON.parse(profileArgOf(0).profile);
    expect(stored.cardKey).toBeUndefined();
  });
});
