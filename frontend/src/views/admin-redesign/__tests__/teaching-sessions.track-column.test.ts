/**
 * 教学会话「轨道」列（#105 读侧接入，2026-10-19）。
 *
 * 锁定两点：
 *  - 行级收束观测（后端 closure 字段）如实呈现：真实轨道 + 通道 / 虚拟 + 黑盒通道；
 *  - 历史（无 track）行显示中性「未标记」、无完成记录显示「—」，均不用身份字段回填。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import { clearPageCache } from '../live';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: {
    list: listMock,
    getStats: vi.fn(async () => ({ data: { data: {} } }))
  }
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
    status: 'completed',
    duration: 600,
    messageCount: 4,
    knowledgePointCount: 2,
    ...overrides
  };
}

async function mountTs() {
  clearPageCache('teaching-sessions');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/teaching-sessions');
  await router.isReady();
  const wrapper = mount(TeachingSessions, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  listMock.mockReset();
});

describe('教学会话轨道列（#105）', () => {
  it('表头常显「轨道」（1440+ 档；jsdom matchMedia 恒 false → 非窄档）', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [makeItem('a')], total: 1 } } });
    const wrapper = await mountTs();

    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toContain('轨道');
  });

  it('有收束记录：轨道徽章 + 通道副行；历史（legacy）行中性「未标记」', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [
            makeItem('human', { closure: { track: 'human', completionSource: 'teaching-finalize' } }),
            makeItem('vl', { closure: { track: 'virtual-learner', completionSource: 'vl-blackbox' } }),
            makeItem('legacy', { closure: { track: 'legacy', completionSource: 'unknown' } })
          ],
          total: 3
        }
      }
    });
    const wrapper = await mountTs();

    const cells = wrapper.findAll('.ts-track');
    expect(cells).toHaveLength(3);
    expect(cells[0].text()).toContain('真实');
    expect(cells[0].text()).toContain('课堂完成');
    expect(cells[1].text()).toContain('虚拟');
    expect(cells[1].text()).toContain('黑盒');
    expect(cells[2].text()).toContain('未标记');
    expect(cells[2].text()).toContain('未记录');
    // 未标记是中性档（muted），不是绿/红的状态色
    expect(cells[2].find('.mk-badge').classes()).toContain('mk-badge--muted');
  });

  it('无完成记录：中性「—」+ 悬停说明，不用用户身份回填', async () => {
    listMock.mockResolvedValue({
      data: { data: { items: [makeItem('none', { isVirtualLearner: true, closure: null })], total: 1 } }
    });
    const wrapper = await mountTs();

    const cell = wrapper.find('.ts-track');
    expect(cell.exists()).toBe(true);
    expect(cell.text()).toContain('—');
    expect(cell.find('.mk-badge').exists()).toBe(false); // 虚拟用户也不猜轨道
    expect(cell.attributes('title')).toContain('无完成记录');
  });
});
