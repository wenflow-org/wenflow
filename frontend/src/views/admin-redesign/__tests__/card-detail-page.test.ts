/**
 * 卡详情二级页（2026-10-06 抽屉退役）：?view=card&id=<profileId> 标准二级页，
 * 全字段可视（概览事实/人设/故事池/资料/标签备注），「到虚拟学习者」切画像二级页。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { openSubPageMock, setSubPageLabelMock } = vi.hoisted(() => ({
  openSubPageMock: vi.fn(),
  setSubPageLabelMock: vi.fn()
}));

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    subPage: ref({ view: 'card', id: 'p1' }),
    openSubPage: openSubPageMock,
    setSubPageLabel: setSubPageLabelMock,
    closeSubPage: vi.fn(),
  };
});

const { cardsTasksMock, cardsCloneMock } = vi.hoisted(() => ({ cardsTasksMock: vi.fn(), cardsCloneMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    /* 创建面板（CardDeriveDialog）走这两个端点 */
    cardsTasks: cardsTasksMock,
    cardsClone: cardsCloneMock,
    cardsDetail: vi.fn(async () => ({
      data: {
        data: {
          profileId: 'p1', userId: 'u1', cardKey: 'w6-math-01', name: '高一学生小陈', goal: '高中数学·函数补差',
          knowledgeLevel: 'beginner', tags: ['数学'], preset: false, sourceKind: 'web',
          sourceRef: 'https://example.com/note', email: 'c1@vl.local', notes: 'E2E 素材', createdAt: '2026-10-05T00:00:00Z',
          personaFacts: [{ label: '可用时间', value: '每天 60 分钟' }],
          nickname: null, nameHint: '高一学生', background: '县城重点高中高一在读，函数基础薄弱',
          stories: [{ title: '函数补差', opening: '我这次月考函数只考了 58 分。', followUps: ['平时函数作业完成情况如何？'], domain: '高中数学·函数', intentType: null, schoolAnchor: null, budget: { dailyMinutes: 60 } }],
          materials: [{ kind: 'book', title: '人教版必修一' }],
        },
      },
    })),
  },
}));

vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return { liveRefreshSeq: ref(0), errMsg: (e: unknown) => String(e) };
});

import CardDetailPage from '../CardDetailPage.vue';

describe('CardDetailPage（卡详情二级页）', () => {
  it('全字段可视：概览事实/人设/故事池（开场白+追问+预算）/资料/标签备注', async () => {
    const w = mount(CardDetailPage);
    await flushPromises();
    const t = w.text();
    expect(t).toContain('高一学生小陈');
    expect(t).toContain('高中数学·函数补差');
    expect(t).toContain('县城重点高中高一在读');
    expect(t).toContain('每天 60 分钟');
    expect(t).toContain('我这次月考函数只考了 58 分');
    expect(t).toContain('平时函数作业完成情况如何');
    expect(t).toContain('人教版必修一');
    expect(t).toContain('c1@vl.local');
    expect(t).toContain('E2E 素材');
    // 面包屑回填：深链/从卡墙进入时 subPage 只有 id，加载出名字后写回（否则面包屑是裸 UUID）
    expect(setSubPageLabelMock).toHaveBeenCalledWith('高一学生小陈');
  });

  /** 2026-10-18 用户走查：卡库侧此前只有卡头勾选框能到创建面板，读作没有流程。
   *  卡详情页是「我想从这张卡造一个」最自然的落点，hero 加主操作。 */
  it('hero 主操作「创建虚拟学习者」：就地开创建面板（单卡），不到别的页面', async () => {
    cardsTasksMock.mockResolvedValueOnce({
      data: { data: { groups: [{ profileId: 'p1', name: '高一学生小陈', tasks: [{ id: 'story-1', title: '函数补差', opening: null }] }] } },
    } as never);
    const w = mount(CardDetailPage);
    await flushPromises();

    const act = w.findAll('button').find((b) => b.text().includes('创建虚拟学习者'))!;
    expect(act, 'hero 缺创建主操作').toBeTruthy();
    // 主操作是它，切画像降为次按钮
    expect(act.classes()).toContain('mk-btn--primary');
    expect(w.findAll('button').find((b) => b.text().includes('到虚拟学习者'))!.classes()).not.toContain('mk-btn--primary');

    await act.trigger('click');
    await flushPromises();
    expect(cardsTasksMock).toHaveBeenCalledWith(['p1']);
    expect(openSubPageMock).not.toHaveBeenCalled();
    expect(document.body.querySelector('.cdd-task__pick')).toBeTruthy();
    w.unmount();
  });

  it('「到虚拟学习者」= openSubPage virtual + profileId 且带 from=本卡（双向互链，返回落回卡详情）', async () => {
    const w = mount(CardDetailPage);
    await flushPromises();
    const go = w.findAll('button').find((b) => b.text().includes('到虚拟学习者'))!;
    await go.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('virtual', 'p1', {
      // from.label 用视图名：卡与画像同一实体同名，用卡名会拼出「郑凯 / 郑凯」
      from: { view: 'card', id: 'p1', label: '学习者卡' }
    });
  });

  it('#16：hero 的 hash: 标签走 shortHashTag 截断、完整值进 title（不再整串溢出被裁）', async () => {
    const HASH = 'hash:f6c06c0a45c595c1572dc3106721f65b0593f16b8';
    const { adminVirtualLearnersApi } = await import('@/api/adminApi');
    vi.mocked(adminVirtualLearnersApi.cardsDetail).mockResolvedValueOnce({
      data: {
        data: {
          profileId: 'p1', userId: 'u1', cardKey: 'k1', name: '高一学生小陈', goal: '函数补差',
          knowledgeLevel: 'beginner', tags: [HASH, '数学'], preset: false, sourceKind: 'web',
          sourceRef: null, email: null, notes: null, createdAt: '2026-10-05T00:00:00Z',
          personaFacts: [], nickname: null, nameHint: null, background: null, stories: [], materials: [],
        },
      },
    } as never);
    const w = mount(CardDetailPage);
    await flushPromises();
    const chip = w.findAll('.mk-hero__pills .mk-badge').find((c) => c.text().startsWith('hash:'))!;
    expect(chip).toBeTruthy();
    expect(chip.text()).toBe('hash:f6c06c0a…');
    expect(chip.attributes('title')).toBe(HASH);
    // 短标签原样
    expect(w.findAll('.mk-hero__pills .mk-badge').some((c) => c.text() === '数学')).toBe(true);
  });
});
