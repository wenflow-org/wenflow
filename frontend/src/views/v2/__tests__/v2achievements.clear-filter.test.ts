/**
 * 成就页筛选退路与卡片信息护栏（2026-11-11 用户侧走查）
 *
 * ① 状态 + 类型两组筛选可叠加，回到「全部」原先要分别点两组——补一条「清除筛选」，
 *    并且只在确实有筛选时出现（默认不占位）。
 * ② 长成就名/描述：名一行封顶、描述两行封顶，各自挂 :title 兜底。
 * ③ 日期可见口径保持 M月D日，title 给 YYYY-MM-DD HH:mm（与列表页的日期规则对齐）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import V2Achievements from '../V2Achievements.vue';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({
  default: { get: getMock },
  USER_SESSION_KEY: 'wenflow_session',
  hasUserSession: () => false
}));
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const ITEMS = [
  {
    id: 'a1',
    name: '一个名字特别长、长到会压住卡角分享按钮的成就',
    description: '描述也足够长，用来验证两行封顶后不会把状态行挤出卡片',
    xpReward: 10,
    type: 'milestone',
    unlocked: true,
    earnedAt: '2026-11-11T09:30:00'
  },
  {
    id: 'a2',
    name: '未解锁成就',
    description: '完成 10 个任务',
    xpReward: 50,
    type: 'completion',
    unlocked: false,
    progress: { current: 2, total: 10, percentage: 20 }
  }
];

async function mountAch() {
  getMock.mockResolvedValue({ success: true, data: ITEMS });
  const w = mount(V2Achievements);
  await flushPromises();
  return w;
}

describe('成就页：清除筛选', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it('默认无筛选时不占位；选中任一筛选后出现并能一键还原', async () => {
    const w = await mountAch();
    expect(w.find('.filters__clear').exists()).toBe(false);

    const lockedBtn = w.findAll('.filter').find((b) => b.text() === '未解锁');
    expect(lockedBtn, '状态组缺「未解锁」').toBeTruthy();
    await lockedBtn!.trigger('click');
    expect(w.find('.filters__clear').exists()).toBe(true);
    expect(w.findAll('.ach-card').length).toBe(1);

    await w.find('.filters__clear').trigger('click');
    expect(w.find('.filters__clear').exists()).toBe(false);
    expect(w.findAll('.ach-card').length).toBe(2);
  });

  it('清除按钮不属于两组筛选（role=group 仍是 2 个）', async () => {
    const w = await mountAch();
    await w.findAll('.filter').find((b) => b.text() === '已解锁')!.trigger('click');
    expect(w.findAll('.filter-group').length).toBe(2);
    expect(w.find('.filters > .filters__clear').exists()).toBe(true);
  });
});

describe('成就页：长文本与日期口径', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it('成就名与描述都挂完整文本 title', async () => {
    const w = await mountAch();
    expect(w.find('.ach-card__name').attributes('title')).toBe(ITEMS[0].name);
    expect(w.find('.ach-card__desc').attributes('title')).toBe(ITEMS[0].description);
  });

  it('已解锁日期可见 M月D日，title 是绝对时间 YYYY-MM-DD HH:mm', async () => {
    const w = await mountAch();
    const date = w.find('.ach-card__date');
    expect(date.text()).toContain('11月11日');
    expect(date.attributes('title')).toBe('2026-11-11 09:30');
  });

  it('未解锁卡有锁形角标（状态不只靠绿/灰文字）', async () => {
    const w = await mountAch();
    expect(w.findAll('.ach-card--locked .ach-card__lock').length).toBe(1);
    expect(w.findAll('.ach-card--unlocked .ach-card__lock').length).toBe(0);
  });
});
