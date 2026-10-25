/**
 * GoalConversations 状态列 + 阶段时间线冒烟：
 * 1. 状态列只回答完成没有（进行中 / 已完成 / 已取消 / 失败 / 已放弃）——
 *    2026-10-22 用户「目标对话怎么会有阶段这一说？不应是完成未完成吗」，
 *    四步过程点条退役，阶段动作词只进悬停说明；
 * 2. 轻量时间线文本「创建 08-12 → 澄清中 08-13」（goal_conversations 现表字段推导，无后端改动）；
 *    日期拆「阶段日期」独立列且写成「M月D日」（裸 'MM-DD' 单看像数字区间，2026-10-13 走查 F2；
 *    2026-10-15 用户拍板自阶段格副行拆列）
 * 3. 已完成会话：创建 → 完成（completedAt）；取消：终态标签
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import GoalConversations from '../GoalConversations.vue';

const mockRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
import { dataSource } from '../store';

const { listMock, statsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  statsMock: vi.fn()
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

vi.mock('@/api/adminApi', () => ({
  adminGoalConversationsApi: apiObject({ list: listMock, getStats: statsMock })
}));

function makeConv(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: 'u-' + id,
    description: '目标 ' + id,
    stage: 'understanding',
    status: 'active',
    createdAt: '2026-08-12T02:00:00.000Z',
    updatedAt: '2026-08-13T04:00:00.000Z',
    completedAt: null,
    learningPathId: null,
    collectedData: '{}',
    ...overrides
  };
}

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(GoalConversations, { global: { plugins: [mockRouter()] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  listMock.mockReset();
  statsMock.mockReset();
  statsMock.mockResolvedValue({
    data: { success: true, data: { total: 2, active: 1, completed: 1, completionRate: '50' } }
  });
  dataSource.value = 'live';
});

afterEach(() => {
  dataSource.value = 'live';
});

describe('GoalConversations 阶段时间线（遗留项：目标对话阶段进度）', () => {
  /** 2026-10-15 起日期拆「阶段日期」独立列：日期格 = title 以「阶段时间线」开头的 span */
  function stageDateEl(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('span[title^="阶段时间线"]');
  }

  it('live：进行中只出「进行中」徽章，阶段动作进 title；时间线仍「创建 08-12 → 澄清中 08-13」', async () => {
    listMock.mockResolvedValue({
      data: { success: true, data: { conversations: [makeConv('a')] } }
    });
    const wrapper = await mountLive();
    const cell = wrapper.findAll('tbody tr')[0].findAll('td')[2];
    const badge = cell.find('.mk-badge');
    expect(badge.text()).toBe('进行中');
    expect(badge.classes()).toContain('mk-badge--info');
    expect(badge.attributes('title')).toContain('正在了解你的情况');
    expect(badge.attributes('title')).toContain('第 2/4 步');
    // 阶段词不再作为徽章文本上屏
    expect(cell.text()).not.toContain('澄清中');
    const dateEl = stageDateEl(wrapper);
    expect(dateEl.text()).toBe('8月13日');
    expect(dateEl.attributes('title')).toContain('创建 08-12 → 澄清中 08-13');
    /* 教学组列序统一（2026-10-16）：身份 → 用户 → 状态 → 过程 → 时间 → 操作。
       原先把「最近活动」紧跟状态列（当状态伴侣），与同组其它页「时间列在过程之后」不一致；
       现移到路径列之后、创建时间之前，两列时间收在表尾。约束条件默认隐藏（MkCols），不进可见表头。 */
    const ths = wrapper.findAll('thead th').map((t) => t.text());
    expect(ths.slice(0, 6)).toEqual(['目标摘要', '用户', '状态', '澄清轮次', '路径', '最近活动']);
    expect(ths.at(-1)).toBe('操作');
    // 2026-10-22 默认收起创建时间与约束条件（列菜单仍可开）
    expect(ths).not.toContain('创建时间');
    const colsBtn = wrapper.findAll('button').find((b) => b.text() === '列')!;
    await colsBtn.trigger('click');
    const menu = wrapper.findAll('.mk-cols__item').map((x) => x.text());
    expect(menu).toContain('创建时间');
    expect(menu).toContain('约束条件');
    // 四步过程点条退役（2026-10-22）
    expect(wrapper.find('.gc-stage-cell__dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('live：已完成会话 → 时间线用 completedAt（创建 → 已完成），点条 4 步全亮', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv('a', {
              stage: 'completed',
              status: 'completed',
              completedAt: '2026-08-14T06:00:00.000Z'
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const cell = wrapper.findAll('tbody tr')[0].findAll('td')[2];
    expect(cell.text()).toBe('已完成');
    const dateEl = stageDateEl(wrapper);
    expect(dateEl.text()).toBe('8月14日');
    expect(dateEl.attributes('title')).toContain('创建 08-12 → 已完成 08-14');
    expect(wrapper.find('.gc-stage-cell__dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('live：取消会话 → 终态「已取消」（用最近更新时间）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv('a', {
              stage: 'proposal',
              status: 'cancelled',
              completedAt: null
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    // 阶段格通道：阶段词=徽章、进度=点条；日期在独立列（2026-10-15 拆列）；
    // 「已取消」语义由独立的「状态」列徽章承载（旧实现时间线复读，同词出现两遍）
    const row = wrapper.find('tbody tr');
    expect(row.find('td .mk-badge').text()).toBe('已取消');
    const dateEl = stageDateEl(wrapper);
    expect(dateEl.text()).toBe('8月13日');
    expect(dateEl.attributes('title')).toContain('创建 08-12 → 已取消 08-13');
    wrapper.unmount();
  });

  it('live：无时间戳老数据 → 时间线显示 —（徽章保留）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv('a', { createdAt: null, updatedAt: null, completedAt: null })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const cell = wrapper.findAll('tbody tr')[0].findAll('td')[2];
    expect(cell.find('.mk-badge').exists()).toBe(true);
    // 日期列无时间线可显 → —（且没有可悬停的时间线标题）
    expect(stageDateEl(wrapper).exists()).toBe(false);
    expect(wrapper.find('.mk-na').exists()).toBe(true);
    wrapper.unmount();
  });

  it('live：任意状态都只出一枚状态徽章（进行中/已完成/失败/已取消），不再渲染过程点条', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv('init', { stage: 'initial', status: 'active' }),
            makeConv('und', { stage: 'understanding', status: 'active' }),
            makeConv('prop', { stage: 'proposal', status: 'active' }),
            makeConv('done', { stage: 'completed', status: 'completed', completedAt: '2026-08-14T06:00:00.000Z' }),
            makeConv('fail', { stage: 'proposal', status: 'failed', completedAt: null }),
            makeConv('cancel', { stage: 'understanding', status: 'cancelled', completedAt: null })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const cells = wrapper.findAll('tbody tr').map((tr) => tr.findAll('td')[2]);
    expect(cells).toHaveLength(6);
    const texts = cells.map((c) => c.find('.mk-badge').text());
    expect(texts).toEqual(['进行中', '进行中', '进行中', '已完成', '失败', '已取消']);
    expect(wrapper.find('.gc-stage-cell__dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('live：进行中一律「进行中」，终态/异常出结果词（2026-10-22 简化）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv('act', { stage: 'understanding', status: 'active' }),
            makeConv('done', { stage: 'completed', status: 'completed', completedAt: '2026-08-14T06:00:00.000Z' }),
            makeConv('fail', { stage: 'proposal', status: 'failed', completedAt: null }),
            makeConv('cancel', { stage: 'understanding', status: 'cancelled', completedAt: null })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const cells = wrapper.findAll('tbody tr').map((tr) => tr.findAll('td')[2]);
    // 进行中行：只出「进行中」，阶段词（澄清中）退到 title
    expect(cells[0].text()).toBe('进行中');
    expect(cells[0].text()).not.toContain('澄清中');
    expect(cells[0].find('.mk-badge').attributes('title')).toContain('正在了解你的情况');
    // 终态/异常行：结果词
    expect(cells[1].text()).toBe('已完成');
    expect(cells[2].text()).toBe('失败');
    expect(cells[3].text()).toBe('已取消');
    wrapper.unmount();
  });
});
