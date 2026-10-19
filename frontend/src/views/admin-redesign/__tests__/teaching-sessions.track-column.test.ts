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

describe('教学会话完成来源 / 完成方式两列（#105，2026-10-19 拆列）', () => {
  it('表头拆成「完成来源」「完成方式」两列，不再出现「轨道」这个内部词（1440+ 档；jsdom matchMedia 恒 false → 非窄档）', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [makeItem('a')], total: 1 } } });
    const wrapper = await mountTs();

    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toContain('完成来源');
    expect(headers).toContain('完成方式');
    expect(headers).not.toContain('轨道');
  });

  it('有收束记录：来源徽章与方式文案各占一列；历史（legacy）行中性「未标记」', async () => {
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

    const tracks = wrapper.findAll('.ts-track:not(.ts-track--mode)');
    const modes = wrapper.findAll('.ts-track--mode');
    expect(tracks).toHaveLength(3);
    expect(modes).toHaveLength(3);

    expect(tracks[0].text()).toBe('真实');
    expect(modes[0].text()).toBe('课堂完成');
    expect(tracks[1].text()).toBe('虚拟');
    expect(modes[1].text()).toBe('虚拟黑盒');
    expect(tracks[2].text()).toBe('未标记');
    expect(modes[2].text()).toBe('未记录');
    // 未标记是中性档（muted），不是绿/红的状态色
    expect(tracks[2].find('.mk-badge').classes()).toContain('mk-badge--muted');
    // 两列同源同一份收束记录，悬停说明一致
    expect(tracks[0].attributes('title')).toBe(modes[0].attributes('title'));
  });

  it('无完成记录：两列都给中性「—」+ 悬停说明，不用用户身份回填', async () => {
    listMock.mockResolvedValue({
      data: { data: { items: [makeItem('none', { isVirtualLearner: true, closure: null })], total: 1 } }
    });
    const wrapper = await mountTs();

    const cell = wrapper.find('.ts-track');
    expect(cell.exists()).toBe(true);
    expect(cell.text()).toContain('—');
    expect(cell.find('.mk-badge').exists()).toBe(false); // 虚拟用户也不猜轨道
    expect(cell.attributes('title')).toContain('无完成记录');
    expect(wrapper.find('.ts-track--mode').text()).toBe('—');
  });
});

describe('教学会话「互动」拆成时长 / 消息 / 知识点三列（2026-10-19 用户走查）', () => {
  it('表头是「时长」「消息」「知识点」，没有叠词的「互动」', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [makeItem('a')], total: 1 } } });
    const wrapper = await mountTs();

    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toContain('时长');
    expect(headers).toContain('消息');
    expect(headers).toContain('知识点');
    expect(headers).not.toContain('互动');
  });

  it('三个读数各占一格：时长按分钟格式化、消息带「条」、知识点带「个」', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [makeItem('a', { duration: 1500, messageCount: 4, knowledgePointCount: 2 })],
          total: 1
        }
      }
    });
    const wrapper = await mountTs();

    const cells = wrapper.findAll('.ts-ia');
    expect(cells[0].text()).toBe('25 分钟');
    expect(cells[0].find('.ts-ia__dur--long').exists()).toBe(true); // ≥25 分钟长时标琥珀
    expect(cells[1].text()).toBe('4 条');
    expect(cells[2].text()).toBe('2 个');
  });
});
