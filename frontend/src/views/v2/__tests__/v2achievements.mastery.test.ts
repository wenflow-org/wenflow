/**
 * V2Achievements 掌握类成就口径回归测试：
 * 条件描述直接展示已掌握知识点数，不再把 KTL（训练负荷）包装成掌握水平。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import V2Achievements from '../V2Achievements.vue';
import { useUserStore } from '@/stores/user';

const getMock = vi.hoisted(() => vi.fn());

// 组件经 userStore 间接引用 api 模块的命名导出（会话键/会话判断），mock 需齐备
vi.mock('@/utils/api', () => ({
  default: { get: getMock },
  USER_SESSION_KEY: 'wenflow_session',
  hasUserSession: () => false
}));

// 页面已收进个人中心壳：壳负责导航/页头/页脚，测试只关心页面内容，用透传 slot 的桩替掉
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div><slot /></div>' } }));

function achievement(description: string) {
  return {
    id: 'a1',
    name: '成就一',
    description,
    xpReward: 100,
    type: 'mastery',
    unlocked: false,
    progress: { current: 5, total: 9, percentage: 55 }
  };
}

async function mountAch(descriptions: string[]) {
  // 后端统一响应体 { success, data }（axios 拦截器解包后的形态）
  getMock.mockResolvedValue({ success: true, data: descriptions.map(achievement) });
  const w = mount(V2Achievements);
  await flushPromises();
  return w;
}

describe('V2Achievements 掌握类成就口径', () => {
  beforeEach(() => {
    // 组件 setup 读 userStore（XP 口径），裸驱动需 active pinia
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it('直接展示已掌握知识点数，不再出现 KTL', async () => {
    const w = await mountAch(['掌握 3 个知识点', '掌握 5 个知识点', '掌握 10 个知识点']);
    const texts = w.findAll('.ach-card__desc').map((n) => n.text());
    expect(texts).toEqual([
      '掌握 3 个知识点',
      '掌握 5 个知识点',
      '掌握 10 个知识点'
    ]);
    expect(w.text()).not.toContain('KTL');
  });

  it('非掌握类描述原样展示', async () => {
    const w = await mountAch(['连续学习 7 天']);
    expect(w.text()).toContain('连续学习 7 天');
  });
});

describe('V2Achievements 经验值口径（与账号页同源）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it('已获得经验值显示账号权威 user.xp，成就贡献以「成就贡献 N XP · 总计 M XP」标明归属（P3-46，设计评审 4.3-46：原「其中成就 N」归属含糊）', async () => {
    // 一条已解锁成就（+10）；账号另有任务完成奖励 50 → user.xp = 60
    getMock.mockResolvedValue({
      success: true,
      data: [{ ...achievement('掌握 3 个知识点'), unlocked: true, xpReward: 10 }]
    });
    const w = mount(V2Achievements);
    await flushPromises();
    useUserStore().user = { id: 'u1', name: 't', xp: 60, level: 1 } as never;
    await flushPromises();

    const kpi = w.find('.ov-line');
    expect(kpi.text()).toContain('60');
    expect(kpi.text()).toContain('成就贡献 10 XP · 总计 60 XP');
  });
});
