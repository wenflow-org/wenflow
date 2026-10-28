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

/** 从「列」菜单把默认隐藏的列打开（2026-10-22 起完成方式/消息/知识点/关注默认收起） */
async function showColumn(wrapper: ReturnType<typeof mount>, label: string) {
  if (!wrapper.find('.mk-cols__menu').exists()) {
    const colsBtn = wrapper.find('.mk-cols__trigger');
    expect(colsBtn).toBeTruthy();
    await colsBtn!.trigger('click');
  }
  const item = wrapper.findAll('.mk-cols__item').find((l) => l.text().includes(label));
  expect(item, label).toBeTruthy();
  await item!.find('input').setValue(true);
  await nextTick();
}

beforeEach(() => {
  listMock.mockReset();
});

describe('教学会话完成方式列（#105，2026-10-21 只留通道）', () => {
  it('只有一列「完成方式」，不再有「完成来源」「完成归属」「轨道」三个说法（1440+ 档；jsdom matchMedia 恒 false → 非窄档）', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [makeItem('a')], total: 1 } } });
    const wrapper = await mountTs();

    // 2026-10-22 默认收起（噪点治理）：表头不占位，但列菜单里可随时打开
    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).not.toContain('完成方式');
    await showColumn(wrapper, '完成方式');
    expect(wrapper.findAll('thead th').map((th) => th.text())).toContain('完成方式');
    const all = wrapper.text();
    expect(all).not.toContain('完成来源');
    expect(all).not.toContain('完成归属');
    expect(all).not.toContain('轨道');
  });

  it('格内只出通道词；轨道（真实/虚拟/未标记）不再上屏，也不挂解释型悬停', async () => {
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
    await showColumn(wrapper, '完成方式');

    const tracks = wrapper.findAll('.ts-track');
    expect(tracks).toHaveLength(3);

    expect(tracks[0].find('.ts-track__mode').text()).toBe('课堂完成');
    expect(tracks[1].find('.ts-track__mode').text()).toBe('虚拟黑盒');
    expect(tracks[2].find('.ts-track__mode').text()).toBe('未记录');
    // 与右上角「真实 / 测试」视角重复的轨道徽章已撤
    expect(wrapper.find('.ts-track .mk-badge').exists()).toBe(false);
    // 2026-10-26 文案收口：解释型悬停说明（记在谁头上）已删，通道词本身自明
    tracks.forEach((t) => expect(t.attributes('title')).toBeUndefined());
  });

  it('无完成记录：整格给中性「—」，不用用户身份回填', async () => {
    listMock.mockResolvedValue({
      data: { data: { items: [makeItem('none', { isVirtualLearner: true, closure: null })], total: 1 } }
    });
    const wrapper = await mountTs();
    await showColumn(wrapper, '完成方式');

    const cell = wrapper.find('.ts-track');
    expect(cell.exists()).toBe(true);
    expect(cell.text()).toBe('—');
    expect(cell.find('.mk-badge').exists()).toBe(false); // 虚拟用户也不猜轨道
    expect(cell.find('.ts-track__mode').exists()).toBe(false);
    expect(cell.attributes('title')).toBeUndefined();
  });
});

describe('教学会话「互动」拆成时长 / 消息 / 知识点三列（2026-10-19 用户走查）', () => {
  it('默认只留「时长」；「消息」「知识点」进列菜单，没有叠词的「互动」', async () => {
    listMock.mockResolvedValue({ data: { data: { items: [makeItem('a')], total: 1 } } });
    const wrapper = await mountTs();

    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toContain('时长');
    expect(headers).not.toContain('消息');
    expect(headers).not.toContain('知识点');
    expect(headers).not.toContain('互动');
    await showColumn(wrapper, '消息');
    await showColumn(wrapper, '知识点');
    const after = wrapper.findAll('thead th').map((th) => th.text());
    expect(after).toContain('消息');
    expect(after).toContain('知识点');
    expect(after).not.toContain('互动');
  });

  it('三个读数各占一格：时长按分钟格式化、消息带「条」、知识点带「个」', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [makeItem('a', { duration: 25, messageCount: 4, knowledgePointCount: 2 })],
          total: 1
        }
      }
    });
    const wrapper = await mountTs();
    await showColumn(wrapper, '消息');
    await showColumn(wrapper, '知识点');

    const cells = wrapper.findAll('.ts-ia');
    expect(cells[0].text()).toBe('25 分钟');
    // 2026-10-27 用户「时长还有两种颜色，简化一下」：不再按长时阈值染琥珀
    expect(cells[0].find('.ts-ia__dur--long').exists()).toBe(false);
    expect(cells[1].text()).toBe('4 条');
    expect(cells[2].text()).toBe('2 个');
  });
});
