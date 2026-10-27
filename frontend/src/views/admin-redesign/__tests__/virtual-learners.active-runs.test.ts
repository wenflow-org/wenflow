/**
 * 虚拟学习者「运行状态」列（2026-10-21 晚定稿，2026-10-26 拆四档）：
 * - 一格里只有一个点 + 一个词，回答「这个人在跑还是不在跑」
 * - 阶段、路径、任务数、终态一律不进列表（要看细节进画像页）
 * - 判定：有在推进的会话=运行中；超阈值无写入=停滞（琥珀）；运营主动停=已暂停（中性灰）；其余=已停止
 * - 暂停与停滞分开：前者是主动操作、后者是故障，同词同色会让黄灯失去区分度
 * - 失败与无响应仍合并成一列「异常」，两枚标签各自带词、零值整格「—」
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals, liveVirtualRunStats } from '../live';
import { openSubPage } from '../store';
import type { VirtualLearnerRow } from '../virtualLearnersTypes';
import { adminVirtualLearnersApi } from '@/api/adminApi';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveVirtuals: ref([]),
    liveVirtualsTotal: ref(0),
    liveVirtualSessionStats: ref({ created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 }),
    liveVirtualStaleCount: ref(0),
    liveVirtualRunStats: ref({
      profileCount: 0,
      totalSessions: 0,
      created: 0,
      running: 0,
      failed: 0,
      abandoned: 0,
      completed: 0,
      completionRate: 0,
      failureRate: 0,
      staleCount: 0,
      maxStaleMins: 0,
      avgDurationMs: 0,
      reclaimThresholdMs: 30 * 60 * 1000
    }),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveVirtualStatsLoading: ref(false),
    liveVirtualStatsError: ref(''),
    retryLiveVirtualStats: vi.fn(async () => {}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    refreshLiveVirtuals: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
    openSubPage: vi.fn()
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    generatePersona: vi.fn(async () => ({ data: {} })),
    getVirtualLearnerStories: vi.fn(async () => ({ data: { data: { stories: [] } } })),
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    terminateVirtualSessions: vi.fn(async () => ({ data: {} })),
    autopilotStart: vi.fn(async () => ({ data: {} })),
    autopilotStop: vi.fn(async () => ({ data: {} })),
    reclaimStaleVirtualSessions: vi.fn(async () => ({ data: {} }))
  }
}));

function baseRow(overrides: Partial<VirtualLearnerRow>): VirtualLearnerRow {
  return {
    id: 'p1',
    name: '沈舟',
    goal: '吃透分布式一致性',
    storyCount: 2,
    pathCount: 2,
    sessions: 5,
    runningCount: 0,
    pausedCount: 0,
    failedCount: 0,
    abandonedCount: 0,
    stalledCount: 0,
    runningSessionIds: [],
    pausedSessionIds: [],
    currentStage: 'learn',
    stageProgress: null,
    createdAt: '2026-10-01T00:00:00Z',
    created: '18 天前',
    tags: [],
    ...overrides
  } as VirtualLearnerRow;
}

/** 两条在跑，其中一条超时无写入：部分卡住仍算「运行中」 */
const runningRow = baseRow({
  id: 'p-run',
  name: '在跑的人',
  /* 2026-10-21 口径统一：runningCount 只含在推进的会话，卡住的单独进 stalledCount */
  runningCount: 1,
  stalledCount: 1,
  runningSessionIds: ['s-new', 's-old'],
  activeRuns: [
    { sessionId: 's-new', pathId: 'p1', pathTitle: '函数与导数', state: 'running', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25, stalled: false },
    { sessionId: 's-old', pathId: 'p2', pathTitle: '立体几何', state: 'running', currentStage: 'path', goalReady: true, pathReady: false, learnStarted: false, taskDone: 0, taskTotal: 0, stalled: true }
  ]
});

/** 只有一条在跑且它超时无写入：没在推进 = 停滞 */
const stalledRow = baseRow({
  id: 'p-stall',
  name: '停滞的人',
  runningCount: 0,
  stalledCount: 1,
  runningSessionIds: [],
  activeRuns: [
    { sessionId: 's-stall', pathId: 'p1', pathTitle: '函数与导数', state: 'running', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 8, stalled: true }
  ]
});

/** 自动驾驶被停：会话还在，但没在跑 */
const pausedRow = baseRow({ id: 'p-pause', name: '暂停的人', runningCount: 0, pausedCount: 1, pausedSessionIds: ['s-pause'] });

/** 跑过、已结束 */
const stoppedRow = baseRow({
  id: 'p-stop',
  name: '停过的人',
  sessions: 5,
  stageProgress: { goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25 }
});

/** 从没跑过 */
const neverRow = baseRow({ id: 'p-never', name: '没跑过的人', sessions: 0 });

function rowByName(wrapper: ReturnType<typeof mount>, name: string) {
  return wrapper.findAll('tbody tr').find((tr) => tr.text().includes(name))!;
}

function stateOf(wrapper: ReturnType<typeof mount>, name: string) {
  return rowByName(wrapper, name).find('.vl-runstate');
}

beforeEach(() => {
  vi.mocked(openSubPage).mockClear();
  liveVirtuals.value = [runningRow, stalledRow, pausedRow, stoppedRow, neverRow] as unknown as typeof liveVirtuals.value;
  liveVirtualRunStats.value = { ...liveVirtualRunStats.value, reclaimThresholdMs: 30 * 60 * 1000 };
});

describe('虚拟学习者：运行状态列只回答在不在跑', () => {
  it('列名与口径：叫「运行状态」，title 只回答在不在跑，不再提阶段', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const heads = w.findAll('thead th').map((h) => h.text().trim());
    expect(heads).toContain('运行状态');
    expect(heads).not.toContain('进行中');
    const th = w.findAll('thead th').find((t) => t.text().trim() === '运行状态')!;
    const title = th.attributes('title')!;
    expect(title).toContain('在跑还是不在跑');
    expect(title).not.toContain('阶段');
    w.unmount();
  });

  it('四档状态：后端计数即真值——有在推进=运行中，超阈值无写入=停滞，主动暂停=已暂停', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const cases: Array<[string, string, string]> = [
      ['在跑的人', '运行中', 'vl-runstate--running'],
      ['停滞的人', '停滞', 'vl-runstate--stalled'],
      ['暂停的人', '已暂停', 'vl-runstate--paused'],
      ['停过的人', '已停止', 'vl-runstate--stopped'],
      ['没跑过的人', '已停止', 'vl-runstate--stopped']
    ];
    for (const [name, label, cls] of cases) {
      const cell = stateOf(w, name);
      expect(cell.text(), name).toBe(label);
      expect(cell.classes(), name).toContain(cls);
      expect(cell.find('.vl-runstate__dot').exists(), name).toBe(true);
    }
    w.unmount();
  });

  it('这一档的读数写进 title（条数 + 阈值），不写「去哪看」', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    expect(stateOf(w, '在跑的人').attributes('title')).toContain('1 条会话正在运行');
    const stall = stateOf(w, '停滞的人').attributes('title')!;
    expect(stall).toContain('超过回收阈值');
    expect(stateOf(w, '暂停的人').attributes('title')).toContain('已暂停');
    expect(stateOf(w, '停过的人').attributes('title')).toContain('没有运行中的会话');
    expect(stateOf(w, '没跑过的人').attributes('title')).toBe('没有运行过');
    w.unmount();
  });

  it('明细不进列表：阶段 / 路径 / 任务 / 终态都不出现在这一列', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '在跑的人');
    expect(row.find('.vl-state-cell').text()).toBe('运行中');
    // 路径名、阶段词、任务数、终态词都不该出现
    for (const word of ['函数与导数', '立体几何', '任务', '学习', '已放弃', '已完成']) {
      expect(row.text()).not.toContain(word);
    }
    // 旧的逐条运行/历史行结构整体退役
    expect(row.find('.vl-runline').exists()).toBe(false);
    expect(row.find('.vl-histline').exists()).toBe(false);
    expect(row.find('.rs-bar').exists()).toBe(false);
    w.unmount();
  });

  it('行主操作随状态走：运行中→暂停、已暂停/停滞→继续、已停止→运行；终止不占行主位', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const actionOf = (name: string) => rowByName(w, name).find('.mk-actions > .mk-link');
    expect(actionOf('在跑的人').text()).toBe('暂停');
    expect(actionOf('暂停的人').text()).toBe('继续');
    // 2026-10-26：停滞也给「继续」（此前只剩终止，想恢复被暂停的会话只能进画像页）
    expect(actionOf('停滞的人').text()).toBe('继续');
    expect(actionOf('停过的人').text()).toBe('运行');
    // 图标也要能区分：「运行」是裸三角（新开一条），「继续」是带圈播放（接着跑）
    expect(actionOf('停过的人').find('svg').classes()).toContain('lucide-play');
    expect(actionOf('暂停的人').find('svg').classes()).toContain('lucide-circle-play');
    expect(actionOf('在跑的人').find('svg').classes()).toContain('lucide-pause');
    // 终止不可逆：只在 ⋯ 菜单里，不占行主位
    await rowByName(w, '停滞的人').find('.mk-menu__btn').trigger('click');
    await nextTick();
    const items = rowByName(w, '停滞的人').findAll('.mk-menu__pop .mk-menu__item').map((b) => b.text());
    expect(items).toContain('终止');
    expect(actionOf('停滞的人').classes()).not.toContain('mk-btn--danger-ghost');
    w.unmount();
  });

  it('暂停与停滞同时存在：给「继续」（先恢复被暂停的会话）', async () => {
    liveVirtuals.value = [
      baseRow({ id: 'p-mixed', name: '混合的人', runningCount: 0, pausedCount: 1, stalledCount: 1 })
    ] as unknown as typeof liveVirtuals.value;
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '混合的人');
    expect(row.find('.vl-runstate').text()).toBe('停滞');
    expect(row.find('.mk-actions > .mk-link').text()).toBe('继续');
    w.unmount();
  });

  it('没有故事时「运行」真禁用，不再改字冒充可点', async () => {
    liveVirtuals.value = [baseRow({ id: 'p-nostory', name: '没故事的人', storyCount: 0, sessions: 0 })] as unknown as typeof liveVirtuals.value;
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const btn = rowByName(w, '没故事的人').find('.mk-actions > .mk-link');
    expect(btn.text()).toBe('运行');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.attributes('title')).toContain('还没有故事');
    w.unmount();
  });

  it('暂停走自动驾驶开关：只停最新会话，不终止会话', async () => {
    vi.mocked(adminVirtualLearnersApi.getVirtualLearnerStories).mockResolvedValueOnce({
      data: { data: { stories: [{ id: 'st-1', title: '故事一', latestRun: { sessionId: 'sess-9', status: 'running' } }] } }
    } as never);
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    await rowByName(w, '在跑的人').find('.mk-actions > .mk-link').trigger('click');
    await flushPromises();
    expect(adminVirtualLearnersApi.autopilotStop).toHaveBeenCalledWith('sess-9');
    expect(adminVirtualLearnersApi.terminateVirtualSessions).not.toHaveBeenCalled();
    w.unmount();
  });

  it('异常列把两种问题信号分开说：系统失败数与无响应数（带阈值）', async () => {
    liveVirtuals.value = [baseRow({ name: '沈舟', failedCount: 2, stalledCount: 1 })] as unknown as typeof liveVirtuals.value;
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const th = w.findAll('thead th').find((t) => t.text().trim() === '异常')!;
    expect(th.attributes('title')).toContain('系统失败的运行数');
    expect(th.attributes('title')).toContain('人为终止不计入');
    expect(th.attributes('title')).toContain('无响应');

    const stall = rowByName(w, '沈舟').find('.vl-abn--stall');
    expect(stall.attributes('title')).toContain('30 分钟');
    expect(stall.attributes('title')).not.toContain('已暂停的会话不计入');
    w.unmount();
  });

  it('列收敛：任务不再成列，累计运行默认隐藏但可在列菜单打开，异常列可开关', async () => {
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const heads = w.findAll('thead th').map((h) => h.text().trim())
    expect(heads).not.toContain('任务')
    expect(heads).not.toContain('累计运行')
    expect(heads).not.toContain('失败')
    expect(heads).not.toContain('无响应')
    expect(heads).toContain('异常')
    const colsBtn = w.find('.mk-cols__trigger')
    await colsBtn.trigger('click')
    const labels = w.findAll('.mk-cols__item span').map((s2) => s2.text().trim())
    expect(labels).not.toContain('任务')
    expect(labels).not.toContain('失败')
    expect(labels).not.toContain('无响应')
    expect(labels).toContain('累计运行')
    expect(labels).toContain('异常')
    w.unmount()
  });
});
