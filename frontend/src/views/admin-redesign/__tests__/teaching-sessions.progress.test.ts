/**
 * TeachingSessions 进度列冒烟（遗留项「教学会话进度列」）：
 * 1. live 模式：后端补字段 progress → 任务 x/y + mk-minibar 迷你条（档位色：完成 ok / 失败 bad）
 * 2. 中断态：失败/超时显示「中断于 任务 x/y」
 * 3. 无进度数据（老数据）→ —
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import { dataSource } from '../store';
import { clearPageCache } from '../live';

const mockRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });

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
  const wrapper = mount(TeachingSessions, { global: { plugins: [mockRouter()] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  listMock.mockReset();
  dataSource.value = 'live';
  clearPageCache();
});

afterEach(() => {
  dataSource.value = 'live';
});

describe('TeachingSessions 进度列（遗留项：后端补 progress 字段）', () => {
  it('live：已完成会话 → 进度列只显「已完成」（不渲染任务 x/y 与进度条，语义一致），title 保留历史进度', async () => {
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
    const prog = row.find('.ts-prog--done');
    expect(prog.exists()).toBe(true);
    expect(prog.text()).toBe('已完成');
    expect(row.find('.mk-minibar').exists()).toBe(false);
    expect(row.text()).not.toContain('任务 2/5');
    expect(prog.attributes('title')).toContain('阶段 2/4 · 任务 2/5');
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

  it('live：P2 中断进度条颜色统一——「已被替代」与失败/超时同为 bad 红条（此前为蓝条）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'superseded',
              progress: { taskIndex: 2, totalTasks: 4, milestoneIndex: 2, totalMilestones: 4 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('中断于 任务 2/4');
    expect(row.find('.mk-minibar__fill').attributes('data-tone')).toBe('bad');
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
});

describe('TeachingSessions 页层次（newui renderSessions / openTurnDetail 对照）', () => {
  it('状态条：粗体结论 + 缺总结 meta + 「只看需关注」快捷钮（点选接既有待关注筛选）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    const status = wrapper.find('.mk-status');
    expect(status.find('.mk-status__title').text()).toBe('1 个会话需关注');
    expect(status.text()).toContain('缺总结 1');
    const quick = status.find('.mk-status__actions button');
    expect(quick.text()).toBe('只看需关注');
    expect(quick.attributes('aria-pressed')).toBe('false');
    await quick.trigger('click');
    expect(quick.attributes('aria-pressed')).toBe('true');
    // 快捷钮 = 既有「待关注」筛选口径（attention !== low）：只剩失败行
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
    wrapper.unmount();
  });

  it('筛选：状态 select 退役，改工具条右组 chips（aria-pressed）；左组为既有焦点 chips', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    expect(wrapper.find('select[aria-label="按状态筛选"]').exists()).toBe(false);
    const groups = wrapper.findAll('.ts-toolbar .mk-pills');
    expect(groups).toHaveLength(2);
    expect(groups[0].findAll('.mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '全部', '进行中', '待关注', '缺总结'
    ]);
    // 右组枚举严格取现有 statusOptions（全部状态 + 10 档）
    const statusChips = groups[1].findAll('.mk-pill');
    expect(statusChips).toHaveLength(11);
    const failedChip = statusChips.find((c) => c.text() === '失败');
    expect(failedChip?.attributes('aria-pressed')).toBe('false');
    await failedChip?.trigger('click');
    expect(failedChip?.attributes('aria-pressed')).toBe('true');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
    wrapper.unmount();
  });

  it('抽屉三段式：首段徽章行 + field 式分区（事实栅格不再重复状态/时长/消息）+ foot 动作条在滚动区外', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed', duration: 600, messageCount: 4 })] }
      }
    });
    const wrapper = await mountLive();
    await wrapper.find('tbody tr').trigger('click');
    await nextTick();
    const drawer = document.body.querySelector('.mk-drawer');
    expect(drawer).toBeTruthy();
    // 首段 pills：状态 / 关注 / 时长 / 消息（均为行上已有字段）
    const pills = drawer!.querySelector('.ts-detail__pills');
    expect(pills?.textContent).toContain('失败');
    expect(pills?.textContent).toContain('高关注');
    expect(pills?.textContent).toContain('时长 10 分钟');
    expect(pills?.textContent).toContain('消息 4');
    // 事实栅格只留身份/时间事实，不再复读首段四项
    const facts = drawer!.querySelector('.mk-facts');
    expect(facts?.textContent).toContain('用户');
    expect(facts?.textContent).not.toContain('状态');
    // 末段提示条（.note 语气）
    expect(drawer!.querySelector('.ts-note')?.textContent).toContain('关注度为派生档位');
    // foot 动作条：上边框右对齐、位于滚动区外
    const foot = drawer!.querySelector('.ts-detail__foot');
    expect(foot?.textContent).toContain('Trace 链路');
    expect(drawer!.querySelector('.mk-drawer__body .ts-detail__foot')).toBeNull();
    wrapper.unmount();
  });
});
