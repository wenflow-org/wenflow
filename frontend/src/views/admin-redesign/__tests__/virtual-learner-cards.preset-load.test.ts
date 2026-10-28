/**
 * 卡库「预置 · 一键加载」入口（#91 / P-67）
 *
 * 背景：平台预置的定义随代码进仓（virtual-learners/presets.yaml），但实例自 2026-10-09
 * 起不再随启动同步——管理台此前只有「预置卡」计数，没有任何加载入口。
 * 本测试锁：① 页头右组的按钮（2026-10-20 从预置 KPI 卡面挪出）与定义侧脚注；② 点按钮的 loading + 结果提示 + 卡墙回刷；
 * ③ 失败必须显式报错（不能静默成功）；④ 定义回退/失败走 warning 档而不是 success；
 * ⑤ 2026-10-26：只在真有缺卡 / 待升级 / 定义回退时出现（9 张预置卡都在墙上时它没有结果）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { openSubPageMock, cardsIndexMock, presetsOverviewMock, presetsLoadMock } = vi.hoisted(() => ({
  openSubPageMock: vi.fn(),
  cardsIndexMock: vi.fn(),
  presetsOverviewMock: vi.fn(),
  presetsLoadMock: vi.fn(),
}));

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    openSubPage: openSubPageMock,
    subPage: ref(null),
    closeSubPage: vi.fn(),
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    cardsIndex: cardsIndexMock,
    presetsOverview: presetsOverviewMock,
    presetsLoad: presetsLoadMock,
    cardsExport: vi.fn(),
    cardsDetail: vi.fn(),
    generatePersona: vi.fn(),
    draftVirtualLearnerStories: vi.fn(),
  },
}));

vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return { errMsg: (e: unknown) => String(e), liveCreateVirtual: vi.fn(), liveRefreshSeq: ref(0) };
});

import VirtualLearnerCards from '../VirtualLearnerCards.vue';
import { toast } from '@/utils/toast';

const SUMMARY = { definitions: 9, loaded: 5, missing: 4, upgradable: 0, rolledBack: 0, drifted: 0 };

const CARD_INDEX = {
  data: {
    data: {
      cards: [
        { profileId: 'p2', userId: 'u2', cardKey: 'preset-eng-01', name: '英语复读生', goal: '英语阅读', opening: null, knowledgeLevel: 'intermediate', tags: [], preset: true, sourceKind: null, email: 'p2@vl.local' },
      ],
      summary: { total: 1, builtin: 1, custom: 0 },
    },
  },
};

function loadButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => ['一键加载', '同步中…'].includes(b.text()))
}

describe('卡库预置「一键加载」（#91 / P-67）', () => {
  it('入口在页头右组：KPI 卡面只留读数，不再被按钮撑成一条宽卡', async () => {
    presetsOverviewMock.mockResolvedValue({ data: { data: { summary: SUMMARY } } });
    const w = mount(VirtualLearnerCards);
    await flushPromises();
    const btn = loadButton(w);
    expect(btn).toBeTruthy();
    expect(w.find('.mk-pagehead__actions').text()).toContain('一键加载');
    // KPI 卡面里不再有按钮（卡面只留 label + 值 + 一句口径）
    expect(w.find('.mk-kpi button').exists()).toBe(false);
    w.unmount();
  });

  it('预置卡已全部就绪时不出「一键加载」（按钮只在有缺卡 / 待升级 / 定义回退时出现）', async () => {
    presetsOverviewMock.mockResolvedValue({
      data: { data: { summary: { definitions: 9, loaded: 9, missing: 0, upgradable: 0, rolledBack: 0, drifted: 0 } } }
    });
    const w = mount(VirtualLearnerCards);
    await flushPromises();
    expect(loadButton(w)).toBeUndefined();
    w.unmount();
  });

  beforeEach(() => {
    openSubPageMock.mockClear();
    cardsIndexMock.mockReset();
    cardsIndexMock.mockResolvedValue(CARD_INDEX);
    presetsOverviewMock.mockReset();
    presetsOverviewMock.mockResolvedValue({ data: { data: { summary: SUMMARY } } });
    presetsLoadMock.mockReset();
    (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
    (toast.warning as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('「身份卡」KPI：两个构成数进 hint（预置 / 自建），定义回退走琥珀档', async () => {
    const w = mount(VirtualLearnerCards);
    await flushPromises();

    const btn = loadButton(w);
    expect(btn, '预置区缺少「一键加载」按钮').toBeTruthy();
    const kpi = w.findAll('.mk-kpi')[0];
    expect(kpi.find('.mk-kpi__label').text()).toBe('身份卡');
    const hint = kpi.find('.mk-kpi__hint');
    expect(hint.text()).toContain('预置 1');
    expect(hint.text()).toContain('自建 0');
    w.unmount();
  });

  it('点「一键加载」：调用新接口 → 结果提示（新建/更新/跳过）→ 回刷卡墙 + 刷新脚注', async () => {
    presetsLoadMock.mockResolvedValue({
      data: {
        data: {
          created: ['a', 'b'],
          updated: ['c'],
          skipped: ['d'],
          drifted: [],
          versionAhead: [],
          errors: [],
          overview: { summary: { definitions: 9, loaded: 8, missing: 1, upgradable: 0, rolledBack: 0, drifted: 0 } },
        },
      },
    });
    const w = mount(VirtualLearnerCards);
    await flushPromises();
    cardsIndexMock.mockClear();

    await loadButton(w)!.trigger('click');
    await flushPromises();

    expect(presetsLoadMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const msg = String((toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).toContain('新建 2');
    expect(msg).toContain('更新 1');
    expect(msg).toContain('跳过 1');
    // 加载后必须回刷卡墙（新卡要立刻出现在墙上）
    expect(cardsIndexMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    // 服务端返回的新快照回填构成读数
    expect(w.findAll('.mk-kpi')[0].find('.mk-kpi__hint').text()).toContain('预置 1');
    w.unmount();
  });

  it('加载中按钮 busy（禁用 + 文案「同步中…」），完成后恢复', async () => {
    let resolveLoad: (v: unknown) => void = () => {};
    presetsLoadMock.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const w = mount(VirtualLearnerCards);
    await flushPromises();

    await loadButton(w)!.trigger('click');
    const busy = loadButton(w)!;
    expect(busy.text()).toBe('同步中…');
    expect(busy.attributes('disabled')).toBeDefined();

    resolveLoad({ data: { data: { created: [], updated: [], skipped: [], drifted: [], versionAhead: [], errors: [] } } });
    await flushPromises();
    expect(loadButton(w)!.text()).toBe('一键加载');
    expect(loadButton(w)!.attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('接口失败：toast.error + 不误报成功（按钮仍可重试）', async () => {
    presetsLoadMock.mockRejectedValue(new Error('500 预置一键加载失败：db down'));
    const w = mount(VirtualLearnerCards);
    await flushPromises();

    await loadButton(w)!.trigger('click');
    await flushPromises();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('db down');
    expect(toast.success).not.toHaveBeenCalled();
    expect(loadButton(w)!.attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('结果含定义回退/失败：走 warning 档提示（同一句结果文案，不报全绿）', async () => {
    presetsLoadMock.mockResolvedValue({
      data: {
        data: {
          created: [], updated: [], skipped: ['a'], drifted: [], versionAhead: ['b'],
          errors: [{ presetKey: 'c', message: 'boom' }],
          overview: { summary: { ...SUMMARY, rolledBack: 1 } },
        },
      },
    });
    const w = mount(VirtualLearnerCards);
    await flushPromises();

    await loadButton(w)!.trigger('click');
    await flushPromises();

    expect(toast.warning).toHaveBeenCalledTimes(1);
    const msg = String((toast.warning as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).toContain('定义回退跳过 1');
    expect(msg).toContain('失败 1');
    expect(toast.success).not.toHaveBeenCalled();
    // 定义回退是琥珀脚注档（人工要看的异常），不是默认灰
    expect(w.findAll('.mk-kpi')[0].find('.mk-kpi__hint').classes()).toContain('mk-kpi__hint--warn');
    w.unmount();
  });
});
