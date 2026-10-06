/**
 * 卡详情二级页（2026-10-06 抽屉退役）：?view=card&id=<profileId> 标准二级页，
 * 全字段可视（概览事实/人设/故事池/资料/标签备注），「到虚拟学习者」切画像二级页。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { openSubPageMock } = vi.hoisted(() => ({ openSubPageMock: vi.fn() }));

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    subPage: ref({ view: 'card', id: 'p1' }),
    openSubPage: openSubPageMock,
    closeSubPage: vi.fn(),
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
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
vi.mock('../live', () => ({ errMsg: (e: unknown) => String(e) }));

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
  });

  it('「到虚拟学习者」= openSubPage virtual + profileId（切画像二级页）', async () => {
    const w = mount(CardDetailPage);
    await flushPromises();
    const go = w.findAll('button').find((b) => b.text().includes('到虚拟学习者'))!;
    await go.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('virtual', 'p1');
  });
});
