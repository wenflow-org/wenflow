/**
 * 学习者卡库卡墙（2026-10-05 卡库改版，用户「有卡啊得，导入是功能，卡展示也是，
 * 方便从卡库选人到虚拟学习者」）：页面主体=卡墙（全部卡可视清单），导入收进抽屉；
 * 卡=账号拍板不变，「选人」= 点卡 openSubPage('virtual', userId) 直达画像。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    cardsIndex: vi.fn(async () => ({
      data: {
        data: {
          cards: [
            { profileId: 'p1', userId: 'u1', cardKey: 'w6-math-01', name: '高一学生小陈', goal: '高中数学·函数补差', opening: '我这次月考函数只考了 58 分。', knowledgeLevel: 'beginner', tags: ['数学'], preset: false, sourceKind: 'web', email: 'c1@vl.local' },
            { profileId: 'p2', userId: 'u2', cardKey: 'preset-eng-01', name: '英语复读生', goal: '英语阅读', opening: null, knowledgeLevel: 'intermediate', tags: [], preset: true, sourceKind: null, email: 'p2@vl.local' },
          ],
          summary: { total: 2, builtin: 1, custom: 1 },
        },
      },
    })),
    cardsDetail: vi.fn(async () => ({
      data: {
        data: {
          profileId: 'p1', userId: 'u1', cardKey: 'w6-math-01', name: '高一学生小陈', goal: '高中数学·函数补差',
          knowledgeLevel: 'beginner', tags: ['数学'], preset: false, sourceKind: 'web',
          sourceRef: 'https://example.com/note', email: 'c1@vl.local', notes: null, createdAt: '2026-10-05T00:00:00Z',
          personaFacts: [{ label: '可用时间', value: '每天 60 分钟' }],
          nickname: null, nameHint: '高一学生', background: '县城重点高中高一在读，函数基础薄弱',
          stories: [{ title: '函数补差', opening: '我这次月考函数只考了 58 分。', followUps: ['平时函数作业完成情况如何？'], domain: '高中数学·函数', intentType: null, schoolAnchor: null, budget: { dailyMinutes: 60 } }],
          materials: [{ kind: 'book', title: '人教版必修一' }],
        },
      },
    })),
    cardsExport: vi.fn(async () => ({ data: { data: { count: 1, content: 'cards: []' } } })),
    cardsValidate: vi.fn(),
    cardsImport: vi.fn(),
  },
}));

vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../live', () => ({ errMsg: (e: unknown) => String(e) }));

import VirtualLearnerCards from '../VirtualLearnerCards.vue';

const mountPage = async () => {
  const w = mount(VirtualLearnerCards, {
    global: {
      // Teleport 内容（导入抽屉）VTU 默认不渲染进组件树，stub 成透传才能断言
      stubs: { Teleport: true },
    },
  });
  await flushPromises();
  return w;
};

describe('学习者卡库卡墙（2026-10-05 卡库改版）', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('KPI 三卡（卡总数/预置卡/自建卡）+ 卡墙渲染全部卡与来源徽章', async () => {
    const w = await mountPage();
    const labels = w.findAll('.mk-kpi .mk-kpi__label').map((x) => x.text());
    expect(labels).toEqual(['卡总数', '预置卡', '自建卡']);
    const wall = w.findAll('.vlc-card');
    expect(wall).toHaveLength(2);
    expect(wall[0].text()).toContain('高一学生小陈');
    expect(wall[0].text()).toContain('web');
    expect(wall[1].text()).toContain('预置');
  });

  it('「从卡库选人」改版二：点卡开详情抽屉（全字段可视），抽屉「到虚拟学习者」直达画像', async () => {
    const w = await mountPage();
    // 点卡不再裸跳（此前 openSubPage 只改 URL，卡库 scene 下什么都不渲染）
    await w.findAll('.vlc-card')[0].trigger('click');
    await flushPromises();
    const drawer = w.find('.mk-drawer__panel');
    expect(drawer.exists()).toBe(true);
    // 全字段可视：人设背景 / 故事池（开场白+追问+预算）/ 资料 / 来源 / 账号
    expect(drawer.text()).toContain('县城重点高中高一在读');
    expect(drawer.text()).toContain('我这次月考函数只考了 58 分');
    expect(drawer.text()).toContain('平时函数作业完成情况如何');
    expect(drawer.text()).toContain('人教版必修一');
    expect(drawer.text()).toContain('每天 60 分钟');
    expect(drawer.text()).toContain('c1@vl.local');
    // 抽屉动作：到虚拟学习者（跨 scene router.push，openSubPage 在卡库 scene 不渲染）
    const go = drawer.findAll('button').find((b) => b.text().includes('到虚拟学习者'))!;
    await go.trigger('click');
    expect(pushMock).toHaveBeenCalledWith({ path: '/admin/virtual-learners', query: { view: 'virtual', id: 'p1' } });
  });

  it('搜索过滤（名称/Key/目标/标签任一命中）', async () => {
    const w = await mountPage();
    await w.find('input').setValue('函数');
    expect(w.findAll('.vlc-card')).toHaveLength(1);
  });

  it('导入收进抽屉：页头「导入卡」开抽屉，表单/拖拽区在抽屉内', async () => {
    const w = await mountPage();
    expect(w.find('.mk-drawer').exists()).toBe(false);
    const btn = w.findAll('button').find((b) => b.text() === '导入卡')!;
    await btn.trigger('click');
    expect(w.find('.mk-drawer').exists()).toBe(true);
    expect(w.find('.vlc-drop').exists()).toBe(true);
    expect(w.find('.vlc-text').exists()).toBe(true);
  });
});
