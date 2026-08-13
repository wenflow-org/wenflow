/**
 * TeachingSessions 进度列冒烟（遗留项「教学会话进度列」）：
 * 1. live 模式：后端补字段 progress → 任务 x/y + mk-minibar 迷你条（档位色：完成 ok / 失败 bad）
 * 2. 中断态：失败/超时显示「中断于 任务 x/y」
 * 3. 无进度数据（老数据）→ —
 * 4. demo 模式：演示行带进度
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import TeachingSessions from '../TeachingSessions.vue';
import { dataSource } from '../store';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

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
  adminTeachingSessionsApi: apiObject({ list: listMock })
}));

function makeItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: 'u-' + id,
    userName: '用户' + id,
    email: id + '@example.com',
    topic: '主题 ' + id,
    subject: '学科',
    taskType: 'practice',
    status: 'active',
    duration: 600,
    messageCount: 4,
    knowledgePointCount: 2,
    startTime: '2026-08-12T02:00:00.000Z',
    wrapup: null,
    advisory: null,
    progress: null,
    ...overrides
  };
}

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(TeachingSessions);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  listMock.mockReset();
  dataSource.value = 'demo';
});

afterEach(() => {
  dataSource.value = 'demo';
});

describe('TeachingSessions 进度列（遗留项：后端补 progress 字段）', () => {
  it('live：任务 x/y + 迷你条渲染；完成态条档 ok', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'completed',
              progress: { taskIndex: 2, totalTasks: 5, milestoneIndex: 2, totalMilestones: 4 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const headers = wrapper.findAll('th').map((th) => th.text());
    expect(headers).toContain('进度');
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('任务 2/5');
    const fill = row.find('.ts-prog .mk-minibar__fill');
    expect(fill.attributes('data-tone')).toBe('ok');
    expect(fill.attributes('style')).toContain('width: 40%');
    expect(row.find('.ts-prog').attributes('title')).toContain('阶段 2/4 · 任务 2/5');
    wrapper.unmount();
  });

  it('live：失败/超时中断态 → 「中断于 任务 x/y」+ 条档 bad', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'failed',
              progress: { taskIndex: 3, totalTasks: 4, milestoneIndex: 3, totalMilestones: 4 }
            }),
            makeItem('b', {
              status: 'timeout',
              progress: { taskIndex: 1, totalTasks: 2, milestoneIndex: 1, totalMilestones: 5 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].text()).toContain('中断于 任务 3/4');
    expect(rows[0].find('.mk-minibar__fill').attributes('data-tone')).toBe('bad');
    expect(rows[1].text()).toContain('中断于 任务 1/2');
    wrapper.unmount();
  });

  it('live：老数据无 progress → 进度列显示 —', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { progress: null })] }
      }
    });
    const wrapper = await mountLive();
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('—');
    expect(row.find('.ts-prog').exists()).toBe(false);
    wrapper.unmount();
  });

  it('demo 模式：演示行带进度渲染', async () => {
    dataSource.value = 'demo';
    const wrapper = mount(TeachingSessions);
    await flushPromises();
    expect(listMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('任务 2/3');
    expect(wrapper.text()).toContain('中断于 任务 3/4');
    wrapper.unmount();
  });
});
