/**
 * 学习者卡库卡墙（2026-10-05 卡库改版，用户「有卡啊得，导入是功能，卡展示也是，
 * 方便从卡库选人到虚拟学习者」；2026-10-06 二级页化——用户不喜欢抽屉设计：
 * 点卡=卡详情二级页（?view=card&id=）、导入=卡导入二级页（?view=card-import），
 * 两个 mk-drawer 退役，走 SkillDetail/PathDetail 家族标准二级页机制）。
 * 2026-10-08 平台生产（用户「卡库用来选角色……卡库可以外部导入，可以平台生产」）：
 * 卡库的第二个入卡口 = 同一份新建表单的 library 语境（建卡入库 + 备好第一个故事，留库不跳画像）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const { openSubPageMock, cardsIndexMock, liveCreateVirtualMock, draftStoriesMock } = vi.hoisted(() => ({
  openSubPageMock: vi.fn(),
  cardsIndexMock: vi.fn(),
  liveCreateVirtualMock: vi.fn(),
  draftStoriesMock: vi.fn(),
}));

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    openSubPage: openSubPageMock,
    subPage: ref(null),
    closeSubPage: vi.fn(),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    cardsIndex: cardsIndexMock,
    cardsExport: vi.fn(async () => ({ data: { data: { count: 1, content: 'cards: []' } } })),
    cardsDetail: vi.fn(),
    cardsValidate: vi.fn(),
    cardsImport: vi.fn(),
    /* 平台生产：人设生成（可选）+ 备好第一个故事 */
    generatePersona: vi.fn(async () => ({ data: { data: { personaSeed: { name: '开面馆的老周' } } } })),
    draftVirtualLearnerStories: draftStoriesMock,
  },
}));

vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../live', () => ({
  errMsg: (e: unknown) => String(e),
  liveCreateVirtual: liveCreateVirtualMock,
}));

import VirtualLearnerCards from '../VirtualLearnerCards.vue';
import { toast } from '@/utils/toast';

const mountPage = async () => {
  const w = mount(VirtualLearnerCards);
  await flushPromises();
  return w;
};

/* 弹窗走 Teleport 到 body（confirm/新建同族），断言与操作都落在 document.body 上 */
function bodyButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}
function setField(selector: string, value: string) {
  const el = document.body.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`field not found: ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

describe('学习者卡库卡墙（2026-10-05 卡库改版 / 2026-10-06 二级页化）', () => {
  beforeEach(() => {
    openSubPageMock.mockClear();
    cardsIndexMock.mockReset();
    cardsIndexMock.mockImplementation(async () => ({
      data: {
        data: {
          cards: [
            { profileId: 'p1', userId: 'u1', cardKey: 'w6-math-01', name: '高一学生小陈', goal: '高中数学·函数补差', opening: '我这次月考函数只考了 58 分。', knowledgeLevel: 'beginner', tags: ['数学'], preset: false, sourceKind: 'web', email: 'c1@vl.local' },
            { profileId: 'p2', userId: 'u2', cardKey: 'preset-eng-01', name: '英语复读生', goal: '英语阅读', opening: null, knowledgeLevel: 'intermediate', tags: [], preset: true, sourceKind: null, email: 'p2@vl.local' },
          ],
          summary: { total: 2, builtin: 1, custom: 1 },
        },
      },
    }));
    liveCreateVirtualMock.mockReset();
    liveCreateVirtualMock.mockImplementation(async () => 'p-new');
    draftStoriesMock.mockReset();
    draftStoriesMock.mockImplementation(async () => ({ data: {} }));
    (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
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

  it('点卡 → 卡详情二级页（openSubPage card + profileId，抽屉退役）', async () => {
    const w = await mountPage();
    expect(w.find('.mk-drawer').exists()).toBe(false);
    await w.findAll('.vlc-card')[0].trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card', 'p1');
  });

  it('搜索过滤（名称/Key/目标/标签任一命中）', async () => {
    const w = await mountPage();
    await w.find('input').setValue('函数');
    expect(w.findAll('.vlc-card')).toHaveLength(1);
  });

  it('导入卡 → 卡导入二级页（openSubPage card-import，抽屉退役）', async () => {
    const w = await mountPage();
    const btn = w.findAll('button').find((b) => b.text() === '导入卡')!;
    await btn.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card-import', 'new');
    expect(w.find('.mk-drawer').exists()).toBe(false);
  });

  it('平台生产：工具条入口打开库语境的同一份表单（标题/步骤/主钮都换成生产口径）', async () => {
    const w = await mountPage();
    const btn = w.findAll('button').find((b) => b.text() === '平台生产');
    expect(btn, '卡库缺少「平台生产」入口').toBeTruthy();
    await btn!.trigger('click');
    await nextTick();
    const body = document.body.textContent || '';
    expect(body).toContain('平台生产 · 角色卡');
    expect(body).toContain('生产入库');
    // 库语境的步骤说清「建卡 + 备好第一个故事」，且落点是到虚拟学习者起跑（不再推去画像页生成故事）
    expect(body).toContain('生产入库（建卡 + 备好第一个故事）');
    expect(body).toContain('到虚拟学习者起跑');
    bodyButton('取消')?.dispatchEvent(new Event('click'));
    await flushPromises();
    w.unmount();
  });

  it('提交生产：建卡 → 备好第一个故事 → 回刷卡墙两次，且不跳画像页', async () => {
    const w = await mountPage();
    await w.findAll('button').find((b) => b.text() === '平台生产')!.trigger('click');
    await nextTick();
    setField('.mk-modal__panel input.mk-field__input', '开面馆的老周');
    setField('.mk-modal__panel textarea.mk-field__textarea', '四十五岁，开了家小面馆，想学会记线上账，性子慢但认死理，怕麻烦。');
    await nextTick();
    cardsIndexMock.mockClear();
    bodyButton('生产入库')!.dispatchEvent(new Event('click'));
    await flushPromises();
    expect(liveCreateVirtualMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: '开面馆的老周', story: expect.stringContaining('开了家小面馆') })
    );
    // 建卡后与故事落库后各刷一次（卡墙开场白取自故事，必须拿新数据）
    expect(draftStoriesMock).toHaveBeenCalledWith('p-new', undefined);
    expect(cardsIndexMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('第一个故事已备好'));
    // 关键差异：生产留在卡库（learners 语境才跳画像页）
    expect(openSubPageMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('故事生成失败：卡已入库照样回刷卡墙，报错口径说明卡在库里而非整单失败', async () => {
    draftStoriesMock.mockImplementationOnce(async () => {
      throw new Error('skill 超时');
    });
    const w = await mountPage();
    await w.findAll('button').find((b) => b.text() === '平台生产')!.trigger('click');
    await nextTick();
    setField('.mk-modal__panel input.mk-field__input', '开面馆的老周');
    setField('.mk-modal__panel textarea.mk-field__textarea', '四十五岁，开了家小面馆，想学会记线上账，性子慢但认死理，怕麻烦。');
    await nextTick();
    cardsIndexMock.mockClear();
    bodyButton('生产入库')!.dispatchEvent(new Event('click'));
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('已入库'));
    expect(cardsIndexMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(openSubPageMock).not.toHaveBeenCalled();
    w.unmount();
  });
});
