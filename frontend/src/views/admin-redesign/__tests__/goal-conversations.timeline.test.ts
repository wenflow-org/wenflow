/**
 * GoalConversations 阶段时间线冒烟（遗留项「目标对话阶段时间线」）：
 * 1. 阶段徽章 + 四步过程点条（创建→澄清→方案→完成，statusText 单源）
 * 2. 轻量时间线文本「创建 08-12 → 澄清中 08-13」（goal_conversations 现表字段推导，无后端改动）
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
  dataSource.value = 'demo';
});

afterEach(() => {
  dataSource.value = 'demo';
});

describe('GoalConversations 阶段时间线（遗留项：目标对话阶段进度）', () => {
  it('live：阶段徽章 + 四步点条 + 时间线「创建 08-12 → 澄清中 08-13」', async () => {
    listMock.mockResolvedValue({
      data: { success: true, data: { conversations: [makeConv('a')] } }
    });
    const wrapper = await mountLive();
    const cell = wrapper.find('.gc-stage-cell');
    expect(cell.text()).toContain('澄清中');
    expect(cell.text()).toContain('创建 08-12 → 澄清中 08-13');
    const dots = cell.findAll('.gc-stage-cell__dot');
    expect(dots).toHaveLength(4);
    expect(dots.filter((d) => d.classes().includes('is-on'))).toHaveLength(2);
    expect(cell.find('.mk-badge').classes()).toContain('mk-badge--info');
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
    const cell = wrapper.find('.gc-stage-cell');
    expect(cell.text()).toContain('已完成');
    expect(cell.text()).toContain('创建 08-12 → 已完成 08-14');
    expect(cell.findAll('.gc-stage-cell__dot.is-on')).toHaveLength(4);
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
    const cell = wrapper.find('.gc-stage-cell');
    expect(cell.text()).toContain('已取消');
    expect(cell.text()).toContain('创建 08-12 → 已取消 08-13');
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
    const cell = wrapper.find('.gc-stage-cell');
    expect(cell.find('.mk-badge').exists()).toBe(true);
    expect(cell.find('.mk-na').exists()).toBe(true);
    wrapper.unmount();
  });

  it('live：任意状态都渲染 4 步点条（创建→澄清→方案→完成；进行中点亮当前步）', async () => {
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
    const cells = wrapper.findAll('.gc-stage-cell');
    expect(cells).toHaveLength(6);
    for (const cell of cells) {
      expect(cell.findAll('.gc-stage-cell__dot')).toHaveLength(4);
    }
    const onCounts = cells.map((c) => c.findAll('.gc-stage-cell__dot.is-on').length);
    expect(onCounts).toEqual([1, 2, 3, 4, 3, 2]);
    wrapper.unmount();
  });
});
