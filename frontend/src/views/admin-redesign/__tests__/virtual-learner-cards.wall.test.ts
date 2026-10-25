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

const { openSubPageMock, cardsIndexMock, liveCreateVirtualMock, draftStoriesMock, cardsTasksMock, cardsCloneMock } = vi.hoisted(() => ({
  openSubPageMock: vi.fn(),
  cardsIndexMock: vi.fn(),
  liveCreateVirtualMock: vi.fn(),
  draftStoriesMock: vi.fn(),
  cardsTasksMock: vi.fn(),
  cardsCloneMock: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
    /* 卡→虚拟学习者（身份池主操作） */
    cardsTasks: cardsTasksMock,
    cardsClone: cardsCloneMock,
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
    cardsTasksMock.mockReset();
    cardsTasksMock.mockImplementation(async () => ({
      data: {
        data: {
          groups: [
            { profileId: 'p1', name: '高一学生小陈', tasks: [{ id: 'story-1', title: '函数补差第一课', opening: '我这次月考函数只考了 58 分。' }] },
            { profileId: 'p2', name: '英语复读生', tasks: [{ id: 'story-2', title: '长难句拆解', opening: null }] },
          ],
        },
      },
    }));
    cardsCloneMock.mockReset();
    cardsCloneMock.mockImplementation(async (items: Array<{ profileId: string }>) => ({
      data: { data: { created: items.map((it) => ({ profileId: `new-${it.profileId}`, userId: 'u', name: 'n', cardKey: 'k', taskCount: 1 })), failed: [] } },
    }));
    (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('KPI 三卡（预置卡/自建卡/已派生实例；卡总数 2026-10-14 并入卡墙卡头）+ 卡墙渲染身份卡与来源徽章', async () => {
    const w = await mountPage();
    const labels = w.findAll('.mk-kpi .mk-kpi__label').map((x) => x.text());
    // 卡总数不再立卡：它恒等于下方卡墙行数，卡头「共 N 张」已自报（计数单源在列表）
    // 「已派生实例」2026-10-24 改名并转为入口：实例不在卡墙上，点它去虚拟学习者列表
    expect(labels).toEqual(['预置卡', '自建卡', '已派生实例']);
    expect(w.find('.mk-card__meta').text()).toContain('共 2 张');
    const wall = w.findAll('.vlc-card');
    expect(wall).toHaveLength(2);
    expect(wall[0].text()).toContain('高一学生小陈');
    expect(wall[0].text()).toContain('web');
    expect(wall[1].text()).toContain('预置');
  });

  it('派生实例不进卡墙（卡库＝身份池），只剩身份卡', async () => {
    cardsIndexMock.mockImplementation(async () => ({
      data: {
        data: {
          cards: [
            { profileId: 'p1', userId: 'u1', cardKey: 'w6-math-01', name: '高一学生小陈', goal: '函数补差', opening: null, knowledgeLevel: 'beginner', tags: [], preset: false, sourceKind: 'web', email: null, derivedFrom: null },
            { profileId: 'p2', userId: 'u2', cardKey: 'vl-abc', name: '高一学生小陈的实例', goal: '函数补差', opening: null, knowledgeLevel: 'beginner', tags: [], preset: false, sourceKind: 'web', email: null, derivedFrom: '高一学生小陈' },
          ],
          summary: { total: 1, builtin: 0, custom: 2, derived: 1 },
        },
      },
    }));
    const w = await mountPage();
    const wall = w.findAll('.vlc-card');
    expect(wall).toHaveLength(1);
    expect(wall[0].text()).toContain('高一学生小陈');
    expect(wall[0].text()).not.toContain('实例');
    expect(w.findAll('.mk-pill').some((p) => p.text().includes('只看身份池'))).toBe(false);
    w.unmount();
  });

  it('身份池已被派空：空态指向虚拟学习者，不说成卡库空', async () => {
    cardsIndexMock.mockImplementation(async () => ({
      data: {
        data: {
          cards: [],
          summary: { total: 0, builtin: 0, custom: 1, derived: 1 },
        },
      },
    }));
    const w = await mountPage();
    expect(w.findAll('.vlc-card')).toHaveLength(0);
    expect(w.text()).toContain('身份池已派空');
    expect(w.text()).toContain('去虚拟学习者');
    expect(w.text()).not.toContain('卡库还是空的');
    w.unmount();
  });

  /** 2026-10-18 用户走查「从卡库想创建一个虚拟学习者，为什么没有流程」：
   *  此前唯一入口是卡头那个无标签勾选框，运营读作没有流程——卡面补一枚动作（2026-10-19 文案统一为「创建学习者」）。 */
  it('卡面「创建学习者」：单卡一键进同一创建面板，且不误触进卡详情', async () => {
    const w = await mountPage();
    const derive = w.findAll('.vlc-card__derive');
    expect(derive, '卡面缺创建入口').toHaveLength(2);

    await derive[0].trigger('click');
    await flushPromises();
    // 只带这一张卡
    expect(cardsTasksMock).toHaveBeenCalledWith(['p1']);
    // 点它不进卡详情（卡整体是 role=button，必须 stop 冒泡）
    expect(openSubPageMock).not.toHaveBeenCalled();
    // 面板已开（Teleport 到 body）
    expect(document.body.querySelector('.cdd-task__pick')).toBeTruthy();
    w.unmount();
  });

  it('选角 → 勾任务 → 创建虚拟学习者（卡=身份模板，卡留在库里）', async () => {
    const w = await mountPage();
    const picks = w.findAll('.vlc-card__pick input');
    expect(picks, '卡面缺少选角勾选框').toHaveLength(2);
    await picks[0].setValue(true);
    await picks[1].setValue(true);
    await nextTick();

    const bar = w.find('.mk-batchbar');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain('已选 2 张身份卡');

    await bar.findAll('button').find((b) => b.text() === '创建虚拟学习者')!.trigger('click');
    await flushPromises();
    expect(cardsTasksMock).toHaveBeenCalledWith(['p1', 'p2']);
    // 面板 Teleport 到 body（与弹窗同族），任务勾选框要按 body 查
    const tasks = Array.from(document.body.querySelectorAll('.cdd-task__pick input')) as HTMLInputElement[];
    expect(tasks).toHaveLength(2);
    // 默认全选（一张卡的任务通常都要跑）
    expect(tasks.every((t) => t.checked)).toBe(true);

    // 取消 p2 的唯一任务 → 该卡不参与创建（面板里说清剩余数量）
    tasks[1].checked = false;
    tasks[1].dispatchEvent(new Event('change'));
    await nextTick();
    const submit = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('个虚拟学习者'))!;
    expect(submit.textContent).toContain('创建 1 个虚拟学习者');
    submit.dispatchEvent(new Event('click'));
    await flushPromises();

    expect(cardsCloneMock).toHaveBeenCalledWith([{ profileId: 'p1', storyIds: ['story-1'] }], undefined);
    expect(toast.success).toHaveBeenCalledWith('已创建 1 个虚拟学习者');
    // 创建出实例后清勾选并回刷卡墙
    expect(w.find('.mk-batchbar').exists()).toBe(false);
    expect(cardsIndexMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    w.unmount();
  });

  it('创建部分失败：逐卡点名原因留在面板内，成功的照常回刷卡墙', async () => {
    cardsCloneMock.mockImplementationOnce(async () => ({
      data: { data: { created: [{ profileId: 'new-p1', userId: 'u', name: '高一学生小陈', cardKey: 'k', taskCount: 1 }], failed: [{ profileId: 'p2', reason: '未勾选任何任务' }] } },
    }));
    const w = await mountPage();
    const picks = w.findAll('.vlc-card__pick input');
    await picks[0].setValue(true);
    await picks[1].setValue(true);
    await nextTick();
    await w.find('.mk-batchbar').findAll('button').find((b) => b.text() === '创建虚拟学习者')!.trigger('click');
    await flushPromises();
    const submit = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('个虚拟学习者'))!;
    submit.dispatchEvent(new Event('click'));
    await flushPromises();
    expect(toast.success).toHaveBeenCalledWith('已创建 1 个虚拟学习者');
    const failed = document.body.querySelector('.cdd-failed');
    expect(failed?.textContent).toContain('英语复读生');
    expect(failed?.textContent).toContain('未勾选任何任务');
    w.unmount();
  });

  it('卡面只留运营看得懂的「场景 / 目标」：preset:/hash:/版本等内部标记不上墙', async () => {
    const HASH = 'hash:f6c06c0a45c595c1572dc3106721f65b0593f16b8';
    cardsIndexMock.mockImplementation(async () => ({
      data: {
        data: {
          cards: [
            {
              profileId: 'p9', userId: 'u9', cardKey: 'builtin', name: '孙浩', goal: '理综提分',
              opening: null, knowledgeLevel: 'beginner',
              tags: ['preset:gaokao-science', 'v4', HASH, 'study', 'exam_prep', 'in_scope'],
              preset: true, sourceKind: null, email: null,
            },
          ],
          summary: { total: 1, builtin: 1, custom: 0 },
        },
      },
    }));
    const w = await mountPage();
    const chips = w.findAll('.vlc-card__tags .mk-badge');
    // 2026-10-24 用户「preset:… 是无意义信息，要加就换点数据」：枚举转中文，内部标记全部撤掉
    expect(chips.map((c) => c.text())).toEqual(['学习', '考试备战']);
    expect(chips[0].attributes('title')).toBe('场景类型：学习');
    expect(chips[1].attributes('title')).toBe('目标类型：考试备战');
    expect(w.find('.vlc-card__tags').text()).not.toContain('preset:');
    expect(w.find('.vlc-card__tags').text()).not.toContain('hash:');
    expect(w.find('.vlc-card__more').exists()).toBe(false);
    expect(w.find('.vlc-card__version').exists()).toBe(false);
    w.unmount();
  });

  it('自定义卡的未知标签按原样显示，最多两枚，不编造数据', async () => {
    cardsIndexMock.mockImplementation(async () => ({
      data: {
        data: {
          cards: [
            { profileId: 'p10', userId: 'u10', cardKey: 'w6-x', name: '小周', goal: '函数补差', opening: null, knowledgeLevel: 'beginner', tags: ['数学', '高一', '人教版'], preset: false, sourceKind: 'web', email: null },
          ],
          summary: { total: 1, builtin: 0, custom: 1 },
        },
      },
    }));
    const w = await mountPage();
    expect(w.findAll('.vlc-card__tags .mk-badge').map((c) => c.text())).toEqual(['数学', '高一']);
    w.unmount();
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
    // 2026-10-22 用户裁定：四步流程说明（逐条复述表单与按钮）整块撤除
    expect(body).not.toContain('生产入库（建卡 + 备好第一个故事）');
    expect(body).not.toContain('到虚拟学习者起跑');
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
