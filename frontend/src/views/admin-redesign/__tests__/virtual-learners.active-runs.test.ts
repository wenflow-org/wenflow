/**
 * 虚拟学习者「进行中」列多活跃会话（2026-10-18 用户走查；2026-10-21 列收敛）：
 * - 一个学习者同时跑多条路径时逐条展示（不再只画第一条），运行在前暂停在后；超过上限给「+N」
 * - 任务进度贴在阶段条尾部（不再单开「任务」列）
 * - 无活跃会话时显示最近一次会话并标「最近」
 * - 失败与无响应合并成一列「异常」，两枚标签各自带词、零值整格「—」
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
    { sessionId: 's-run-new', pathId: 'p1', pathTitle: '函数与导数', state: 'running', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25, stalled: false },
    { sessionId: 's-run-old', pathId: 'p2', pathTitle: '立体几何', state: 'running', currentStage: 'path', goalReady: true, pathReady: false, learnStarted: false, taskDone: 0, taskTotal: 0, stalled: true },
    { sessionId: 's-paused', pathId: 'p1', pathTitle: '函数与导数', state: 'paused', currentStage: 'learn', goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 8, stalled: false }
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
  it('列头口径=「现在在做什么、做到哪一步」：活跃则逐条，空闲则按路径给最近一次', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const th = w.findAll('thead th').find((t) => t.text().trim() === '进行中')!;
    const title = th.attributes('title')!;
    // 口径必须跟着 2026-10-21 的按路径归并更新：旧文案只说「无活跃时显示最近一次」，已不成立
    expect(title).toContain('现在在做什么');
    expect(title).toContain('按学习路径');
    expect(title).not.toContain('无活跃运行时显示最近一次');
    w.unmount();
  });

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
    // 同一学习者多条路径：每条运行带路径名，否则两行长得一样分不出在跑哪条
    expect(row.findAll('.vl-runline .vl-runtitle').map((t) => t.text())).toEqual(['函数与导数', '立体几何', '函数与导数']);
    // 全量 4 条，列表逐条取 3 条 → +1 且与最后一条同行（不额外占行）
    expect(row.find('.vl-runmore').text()).toBe('+1');
    expect(row.findAll('.vl-runline')).toHaveLength(3);
    w.unmount();
  });

  it('任务进度贴在每条阶段条尾部（不再单开「任务」列）', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const heads = w.findAll('thead th').map((h) => h.text().trim());
    expect(heads).not.toContain('任务');
    const row = rowByName(w, '沈舟');
    // 每条活跃会话的任务数跟着自己的阶段条，顺序与徽章一致；没有任务维度的那条不出文本
    const texts = row.findAll('.vl-runline .rs-bar__task').map((t) => t.text());
    expect(texts).toEqual(['任务 2/25', '任务 1/8']);
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

  it('无活跃会话时显示「最近」并按路径给历史行：用词说清到哪一步 + 任务数', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '徐国栋');
    expect(row.find('.vl-histmark').text()).toBe('最近');
    // 旧缓存没有 recentRuns 时用单条 stageProgress 合成一行（路径名缺省写「目标阶段」）
    const lines = row.findAll('.vl-histline');
    expect(lines).toHaveLength(1);
    expect(lines[0].find('.vl-histtitle').text()).toBe('目标阶段');
    expect(lines[0].find('.vl-histmeta').text()).toContain('学习 2/25');
    // 已结束的运行不再画阶段条（那是「进行中」的语汇）
    expect(row.find('.vl-stage').exists()).toBe(false);
    w.unmount();
  });

  it('多目标/多路径：每条路径一行显示最近一次运行，终态写成词，多出的用「+N 条路径」披露', async () => {
    liveVirtuals.value = [baseRow({
      name: '多路径',
      pathCount: 3,
      recentRunTotal: 3,
      recentRuns: [
        { sessionId: 'r-a', pathId: 'path-A', pathTitle: '函数与导数', status: 'completed', currentStage: 'learn', updatedAt: '2026-10-20T00:00:00Z', goalReady: true, pathReady: true, learnStarted: true, taskDone: 20, taskTotal: 20 },
        { sessionId: 'r-b', pathId: 'path-B', pathTitle: '立体几何', status: 'abandoned', currentStage: 'teaching', updatedAt: '2026-10-19T00:00:00Z', goalReady: true, pathReady: true, learnStarted: true, taskDone: 3, taskTotal: 18 },
      ],
    })] as unknown as typeof liveVirtuals.value;
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const row = rowByName(w, '多路径');
    const lines = row.findAll('.vl-histline');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.find('.vl-histtitle').text())).toEqual(['函数与导数', '立体几何']);
    // 终态是彩色徽章（不是埋在灰字里的词）：已完成=绿、已放弃=警示
    const badges = lines.map((l) => l.find('.mk-badge'))
    expect(badges[0].text()).toBe('已完成')
    expect(badges[0].classes()).toContain('mk-badge--ok')
    expect(badges[1].text()).toBe('已放弃')
    expect(badges[1].classes()).toContain('mk-badge--warn')
    // 元信息只留阶段与任务数，不再复述终态
    expect(lines[1].find('.vl-histmeta').text()).not.toContain('已放弃')
    // 3 条路径只展开 2 条 → 余量明说
    expect(row.find('.vl-histmore').text()).toBe('+1 条路径');
    // 点路径名进该条运行的座舱（不是一律第一条）
    await lines[1].find('.vl-histtitle').trigger('click');
    expect(openSubPage).toHaveBeenCalledWith('session', 'r-b');
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
    expect(row.findAll('.rs-bar__task')).toHaveLength(0);
    w.unmount();
  });

  it('异常列把两种问题信号分开说：系统失败数与无响应数（带阈值与暂停口径）', async () => {
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const th = w.findAll('thead th').find((t) => t.text().trim() === '异常')!;
    expect(th.attributes('title')).toContain('系统失败的运行数');
    // 人为终止不等于故障：列头写明不进此列，分项留在失败标签的悬停说明里
    expect(th.attributes('title')).toContain('人为终止不计入');
    expect(th.attributes('title')).toContain('无响应');

    // 无响应的阈值与「哪一种暂停不计入」落在标签 title 上（回收口径排除的是管理员暂停）
    const stall = rowByName(w, '沈舟').find('.vl-abn--stall');
    expect(stall.attributes('title')).toContain('30 分钟');
    expect(stall.attributes('title')).toContain('管理员在运行页手动暂停的运行不计入');
    expect(stall.attributes('title')).toContain('回收无响应');
    // 「已暂停的会话不计入」会与本页「已暂停」pill（自动驾驶已停）撞义：那类会话仍在回收候选里
    expect(stall.attributes('title')).not.toContain('已暂停的会话不计入');
    w.unmount();
  });

  it('列收敛：任务不再成列，累计运行默认隐藏但可在列菜单打开，异常列可开关', async () => {
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const heads = w.findAll('thead th').map((h) => h.text().trim())
    // 默认视图：任务 / 累计运行 / 旧的失败·无响应两列都不在
    expect(heads).not.toContain('任务')
    expect(heads).not.toContain('累计运行')
    expect(heads).not.toContain('失败')
    expect(heads).not.toContain('无响应')
    expect(heads).toContain('异常')
    // 列菜单里没有「任务」（任务进度恒在阶段条尾部），历史量「累计运行」可以再打开
    const colsBtn = w.findAll('button').find((b) => b.text().trim() === '列')!
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

/**
 * 2026-10-21 外部评审（信息密度 / 对齐 / 状态标识 / 看板分层）的可见契约。
 * 评审点的是「看得见的行为」，所以这里断言的是 DOM 语义，不是 CSS 数值；
 * 行高与灰度在浏览器实测（1440 / 1080），不把像素写进单测。
 */
describe('虚拟学习者：评审后的密度与状态标识', () => {
  const idleRow = baseRow({
    id: 'p3-idle-uuid-0001',
    name: '空闲者',
    sessions: 0,
    runningCount: 0,
    pausedCount: 0,
    stageProgress: null,
    recentRuns: [],
    recentRunTotal: 0
  })

  beforeEach(() => {
    liveVirtuals.value = [multiRow, historyRow, idleRow] as unknown as typeof liveVirtuals.value
  })

  it('首列同行：头像 + 姓名 + 短 ID 在一个 .mk-cell-main 里，完整 UUID 只在悬停气泡', async () => {
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const row = rowByName(w, '徐国栋')
    const cell = row.find('.vl-cell')
    expect(cell.find('.mk-ava').exists()).toBe(true)
    const main = cell.find('.mk-cell-main')
    expect(main.find('strong').text()).toBe('徐国栋')
    const sub = main.find('.mk-cell-sub')
    // 可见文本是截断后的短 ID，完整 UUID 走 title（评审要求「长 ID 弱化为悬浮气泡」）
    expect(sub.text()).toBe('p2')
    expect(sub.attributes('title')).toContain('p2')
    // 姓名与短 ID 都在同一个容器里（不是上下两行），这是「紧凑同行」的结构前提
    expect(main.element.children).toHaveLength(2)
    w.unmount()
  })

  it('没跑过的学习者：状态是灰徽章「未运行」，不是裸文字', async () => {
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const row = rowByName(w, '空闲者')
    const badge = row.findAll('.mk-badge').find((b) => b.text() === '未运行')!
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('未运行')
    expect(badge.classes()).toContain('mk-badge--muted')
    expect(badge.attributes('title')).toBeTruthy()
    w.unmount()
  })

  it('终态徽章的色阶：已完成=ok、已放弃=warn、失败=bad', async () => {
    liveVirtuals.value = [baseRow({
      name: '三态',
      recentRunTotal: 3,
      recentRuns: [
        { sessionId: 'r1', pathId: 'a', pathTitle: 'A', status: 'completed', currentStage: 'learn', updatedAt: '2026-10-20T00:00:00Z', goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 1 },
        { sessionId: 'r2', pathId: 'b', pathTitle: 'B', status: 'abandoned', currentStage: 'learn', updatedAt: '2026-10-19T00:00:00Z', goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 9 },
        { sessionId: 'r3', pathId: 'c', pathTitle: 'C', status: 'failed', currentStage: 'learn', updatedAt: '2026-10-18T00:00:00Z', goalReady: true, pathReady: true, learnStarted: false, taskDone: 0, taskTotal: 0 }
      ]
    })] as unknown as typeof liveVirtuals.value
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const badges = rowByName(w, '三态').findAll('.vl-histline .mk-badge')
    expect(badges.map((b) => b.text())).toEqual(['已完成', '已放弃', '失败'])
    expect(badges.map((b) => b.classes().find((c) => c.startsWith('mk-badge--') && c !== 'mk-badge--sm'))).toEqual([
      'mk-badge--ok', 'mk-badge--warn', 'mk-badge--bad'
    ])
    w.unmount()
  })

  it('页头动作区：新建仍是唯一主按钮，且排在最后（评审「维持高亮主导地位」）', async () => {
    const w = mount(VirtualLearners)
    await flushPromises()
    await nextTick()
    const actions = w.find('.mk-pagehead__actions')
    const buttons = actions.findAll('button').map((b) => ({ text: b.text().trim(), primary: b.classes().includes('mk-btn--primary') }))
    const primaries = buttons.filter((b) => b.primary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].text).toBe('新建')
    // 主按钮压在同组末尾：右缘是动作区的落点，「清理旧账号」这类次级动作在它左侧
    expect(buttons[buttons.length - 1].text).toBe('新建')
    w.unmount()
  })
})
