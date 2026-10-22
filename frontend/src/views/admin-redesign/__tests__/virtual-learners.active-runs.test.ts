/**
 * 虚拟学习者「进行中」列多活跃会话 + 独立任务列（2026-10-18 用户走查）：
 * - 一个学习者同时跑多条路径时逐条展示（不再只画第一条），运行在前暂停在后
 * - 任务数单列、逐行对齐；超过上限给「+N」
 * - 无活跃会话时显示最近一次会话并标「最近」
 * - 「无响应」表头点明阈值与「暂停不计入」
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals, liveVirtualRunStats } from '../live';
import { openSubPage } from '../store';
import type { VirtualLearnerRow } from '../virtualLearnersTypes';

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

const multiRow = baseRow({
  runningCount: 2,
  pausedCount: 1,
  stalledCount: 1,
  runningSessionIds: ['s-run-new', 's-run-old'],
  pausedSessionIds: ['s-paused'],
  activeRunTotal: 4,
  activeRuns: [
    { sessionId: 's-run-new', state: 'running', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25, stalled: false },
    { sessionId: 's-run-old', state: 'running', currentStage: 'path', goalReady: true, pathReady: false, learnStarted: false, taskDone: 0, taskTotal: 0, stalled: true },
    { sessionId: 's-paused', state: 'paused', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 8, stalled: false }
  ]
});

const historyRow = baseRow({
  id: 'p2',
  name: '徐国栋',
  runningCount: 0,
  pausedCount: 0,
  stageProgress: { goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25 }
});

function rowByName(wrapper: ReturnType<typeof mount>, name: string) {
  return wrapper.findAll('tbody tr').find((tr) => tr.text().includes(name))!;
}

beforeEach(() => {
  vi.mocked(openSubPage).mockClear();
  liveVirtuals.value = [multiRow, historyRow] as unknown as typeof liveVirtuals.value;
  liveVirtualRunStats.value = { ...liveVirtualRunStats.value, reclaimThresholdMs: 30 * 60 * 1000 };
});

describe('虚拟学习者：多活跃会话与任务列', () => {
  it('同一学习者三条活跃会话逐条渲染，超过上限给 +N', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '沈舟');
    expect(row.findAll('.vl-runline')).toHaveLength(3);
    // 顺序：两条运行在前、暂停在后（与后端 activeRuns 同序）
    const badges = row.findAll('.vl-runline .rs-badge');
    expect(badges[0].attributes('title')).toContain('正在运行');
    expect(badges[2].attributes('title')).toContain('已暂停');
    // 全量 4 条，列表逐条取 3 条 → +1 且与最后一条同行（不额外占行）
    expect(row.find('.vl-runmore').text()).toBe('+1');
    expect(row.findAll('.vl-runline')).toHaveLength(3);
    w.unmount();
  });

  it('任务数单列、按活跃会话逐行给出；没有任务维度给 —', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const heads = w.findAll('thead th').map((h) => h.text().trim());
    const taskIdx = heads.indexOf('任务');
    expect(taskIdx).toBeGreaterThan(-1);
    const row = rowByName(w, '沈舟');
    const nums = row.findAll('.vl-tasknum');
    expect(nums.map((n) => n.text())).toEqual(['2/25', '—', '1/8']);
    // 列头口径说清多会话对齐与历史回落
    expect(w.findAll('thead th')[taskIdx].attributes('title')).toContain('按行与「进行中」对齐');
    w.unmount();
  });

  it('点击哪条徽章就进哪条会话座舱（不再一律取第一条）', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '沈舟');
    await row.findAll('.vl-runline .rs-badge')[1].trigger('click');
    expect(openSubPage).toHaveBeenCalledWith('session', 's-run-old');
    w.unmount();
  });

  it('无活跃会话时显示最近一次并标「最近」，任务列同步弱化显示', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '徐国栋');
    expect(row.find('.vl-histmark').text()).toBe('最近');
    expect(row.find('.vl-runline--history .vl-stage').attributes('title')).toContain('当前没有活跃运行');
    const hist = row.find('.vl-tasknum--history');
    expect(hist.text()).toBe('2/25');
    expect(hist.attributes('title')).toContain('最近一次运行（已结束）');
    w.unmount();
  });

  it('聚合有活跃会话但样本窗口内拿不到详情：如实说「未展开」，不冒领「最近」或「空闲」', async () => {
    liveVirtuals.value = [baseRow({
      runningCount: 2,
      pausedCount: 0,
      runningSessionIds: [],
      stageProgress: { goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 25 },
    })] as unknown as typeof liveVirtuals.value;
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = w.find('tbody tr');
    expect(row.find('.vl-unlisted').text()).toBe('活跃 2 条 · 未展开');
    expect(row.find('.vl-unlisted').attributes('title')).toContain('不在本次载入的运行明细里');
    expect(row.find('.vl-histmark').exists()).toBe(false);
    expect(row.findAll('.vl-tasknum')).toHaveLength(0);
    w.unmount();
  });

  it('「无响应」表头写明阈值与「哪一种暂停不计入」（回收口径排除的是管理员暂停，不是自动驾驶已暂停）', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const th = w.findAll('thead th').find((t) => t.text().trim() === '无响应')!;
    const title = th.attributes('title')!;
    expect(title).toContain('30 分钟');
    expect(title).toContain('管理员在运行页手动暂停的运行不计入');
    expect(title).toContain('回收无响应');
    // 「已暂停的会话不计入」会与本页「已暂停」pill（自动驾驶已停）撞义：那类会话仍在回收候选里
    expect(title).not.toContain('已暂停的会话不计入');
    w.unmount();
  });

  it('≤1439 档：任务不成列回落到阶段条，列菜单里也不留「任务」这项死开关', async () => {
    const orig = window.matchMedia
    // useIsNarrow 走 matchMedia：让 ≤1439 的查询命中，模拟中窄屏档
    window.matchMedia = ((q: string) => ({
      matches: /max-width: (1439|1599|720)px/.test(q),
      media: q,
      onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia
    try {
      const w = mount(VirtualLearners)
      await flushPromises()
      await nextTick()
      // 任务列不成列
      expect(w.findAll('thead th').map((h) => h.text().trim())).not.toContain('任务')
      // 列菜单里也没有「任务」勾选项（勾了也不会显形 = 死开关）
      const colsBtn = w.findAll('button').find((b) => b.text().trim() === '列')!
      await colsBtn.trigger('click')
      expect(w.find('.mk-cols__menu').exists()).toBe(true)
      const labels = w.findAll('.mk-cols__item span').map((s) => s.text().trim())
      expect(labels).not.toContain('任务')
      expect(labels).toContain('无响应')
      w.unmount()
    } finally {
      window.matchMedia = orig
    }
  });
});
