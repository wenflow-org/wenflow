/**
 * VirtualLearners P1 批量管理与生命周期视图（A1/A2）测试：
 * 分区筛选 chips（2026-10-04 自页头状态条迁入卡头）/ 活动会话 hint / 已截断提示 / 复选框批量条 /
 * 批量终止（profileIds → terminate 端点）/ 批量清理无响应与一键回收（reclaim-stale dryRun → 确认落地）/
 * 进行中列直达座舱 / 卡死·失败 bad 色标注 / 批量删除标记待 2B
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearners from '../VirtualLearners.vue';
import Confirm from '../Confirm.vue';
import { liveVirtuals, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveVirtualStatsLoading, liveVirtualStatsError, retryLiveVirtualStats, liveAutopilotConcurrency } from '../live';
import { settleConfirm, confirmState } from '../useConfirm';

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
      reclaimThresholdMs: 0
    }),
    /* P1#19 运行统计三态：本页消费 live 层 loading/error/retry 导出 */
    liveVirtualStatsLoading: ref(false),
    liveVirtualStatsError: ref(''),
    retryLiveVirtualStats: vi.fn(async () => {}),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
    /* VL 列表页使用共享 <Pagination> 页码器（依赖 live.totalPagesOf） */
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
    openSubPage: openSubPageMock
  };
});

const { terminateMock, reclaimMock, openSubPageMock } = vi.hoisted(() => ({
  terminateMock: vi.fn(async () => ({ data: { data: { dryRun: false, terminated: 2, skippedTerminal: 1 } } })),
  /* 干跑响应形状用 Record<string, unknown> 放宽：B8-F4-2 后新增 scanned/skippedSessions/batchLimit，
     逐字段标注会让「旧响应缺新字段」的既有用例无法复用同一 mock */
  reclaimMock: vi.fn(async (): Promise<{ data: { data: Record<string, unknown> } }> => ({
    data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [] as Array<Record<string, unknown>> } }
  })),
  openSubPageMock: vi.fn()
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    generatePersona: vi.fn(async () => ({ data: {} })),
    getVirtualLearnerStories: vi.fn(async () => ({ data: { data: { stories: [] } } })),
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    /* P1#20 速率卡：上限分母只认已保存值（getVirtualLabSettings 回执） */
    getVirtualLabSettings: vi.fn(async () => ({ data: { data: { settings: { virtualLearnerRpmLimit: 200 }, rpm: { rpm: 120, inFlight: 3, queued: 0 } } } })),
    updateVirtualLabSettings: vi.fn(async () => ({ data: { data: { rpm: { rpm: 200, inFlight: 3, queued: 0 } } } })),
    terminateVirtualSessions: terminateMock,
    reclaimStaleVirtualSessions: reclaimMock
  }
}));

function makeVirtual(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `vl-${i}`,
    name: `虚拟学习者${i}`,
    goal: '目标',
    level: 'L1',
    story: '背景',
    sessions: 2,
    storyCount: 1,
    pathCount: 1,
    runningCount: 0,
    pausedCount: 0,
    failedCount: 0,
    abandonedCount: 0,
    stalledCount: 0,
    runningSessionIds: [],
    pausedSessionIds: [],
    currentStage: null,
    createdAt: '2026-08-10T10:00:00',
    raw: {},
    ...overrides
  };
}

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text().includes(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

async function mountPage() {
  /* 2026-10-18：勾选列默认隐藏（与 People 同判例），本文件的批量条用例都依赖行内勾选框，
     先把已存隐藏集置空把所有列打开；默认隐藏本身另有专测。 */
  localStorage.setItem('wf_vl_hidden_cols_v2', JSON.stringify([]));
  const w = mount(VirtualLearners);
  await flushPromises();
  await nextTick();
  return w;
}

/** 默认隐藏专测用：清掉本地记录，走 MkCols 首访 defaultHidden 路径 */
async function mountPageFreshCols() {
  localStorage.removeItem('wf_vl_hidden_cols_v2');
  const w = mount(VirtualLearners);
  await flushPromises();
  await nextTick();
  return w;
}

describe('VirtualLearners 批量管理与生命周期视图', () => {
  beforeEach(() => {
    liveVirtuals.value = [];
    liveVirtualsTotal.value = 0;
    liveVirtualSessionStats.value = { created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 };
    liveVirtualStaleCount.value = 0;
    liveVirtualRunStats.value = {
      profileCount: 0,
      totalSessions: 0,
      created: 0,
      running: 0,
      failed: 0,
      abandoned: 0,
      completed: 0,
      completionRate: 0,
      failureRate: 0,
      systemFailureRate: 0,
      humanTerminatedRate: 0,
      staleCount: 0,
      maxStaleMins: 0,
      avgDurationMs: 0,
      reclaimThresholdMs: 0,
      todayCalls: 0
    };
    /* P1#19 三态复位：默认就绪态 */
    liveVirtualStatsLoading.value = false;
    liveVirtualStatsError.value = '';
    vi.mocked(retryLiveVirtualStats).mockClear();
    liveAutopilotConcurrency.value = { used: 0, limit: 10, queued: 0 };
    terminateMock.mockReset();
    terminateMock.mockImplementation(async () => ({ data: { data: { dryRun: false, terminated: 2, skippedTerminal: 1 } } }));
    reclaimMock.mockReset();
    reclaimMock.mockImplementation(async () => ({ data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [] } } }));
    openSubPageMock.mockClear();
  });

  it('状态条已退役：分区筛选计数迁卡头 chips + 活动会话进完成率 hint + 已截断提示保留', async () => {
    liveVirtualSessionStats.value = { created: 3, running: 2, failed: 1, abandoned: 1, completed: 0, total: 7 };
    // 2026-10-15：活动会话改与完成率卡同源（/stats 的 running/created，F20 已扣已暂停），
    // 不再读列表 sessionStats（未扣减，与逐画像「进行中」打架）。数值仍 running 2 + created 3 = 5。
    liveVirtualRunStats.value = { ...liveVirtualRunStats.value, running: 2, created: 3 };
    liveVirtualStaleCount.value = 2;
    liveVirtualsTotal.value = 80;
    liveVirtuals.value = [
      makeVirtual(1, { runningCount: 2 }),
      makeVirtual(2, { pausedCount: 1 }),
      makeVirtual(3, { failedCount: 1, stalledCount: 2 }),
    ];
    const w = await mountPage();
    // 2026-10-04 页头状态条整体退役（教学会话同款判例）：复读的「共 N 人」随条删除
    expect(w.find('.mk-status').exists()).toBe(false);
    // 会话口径：活动 = running 2 + created 3 → 完成率卡 hint（同一会话漏斗）
    expect(w.text()).toContain('活动会话 5');
    // 画像口径分区筛选计数（P2：「需关注」已正名「曾失败」，口径=累计失败）→ 卡头工具栏 chips
    // 按卡定位到列表卡（.mk-card--fill）：页内还有压测参数等其它卡头，取「第一个 .mk-card__head」会取错
    const head = w.find('.mk-card--fill .mk-card__head');
    const countOf = (label: string) =>
      head.findAll('.mk-pill').find((p) => p.text().replace(/\s/g, '').startsWith(label))?.find('.mk-pill__count').text();
    expect(countOf('进行中')).toBe('1');
    expect(countOf('已暂停')).toBe('1');
    expect(countOf('曾失败')).toBe('1');
    expect(w.text()).not.toContain('需关注');
    // 截断提示迁卡头 meta（与行数同格）
    expect(w.text()).toContain('共 80 人 · 当前显示前');
    expect(w.text()).toContain('回收无响应（2）');
  });

  it('P1#19 运行统计三态：stats 拉取失败 → KPI「不可用」弱红可点重试（不再 0% 假绿）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    liveVirtualStatsError.value = 'network down';
    const w = await mountPage();
    const kpiNum = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label)?.find('.mk-kpi__num').text();
    // 数字不渲染（防 0% 假绿），错误档显「不可用」+ hint 给动作出口
    expect(kpiNum('完成率')).toBe('不可用');
    expect(kpiNum('系统失败率')).toBe('不可用');
    expect(kpiNum('今日调用')).toBe('不可用');
    expect(w.text()).toContain('统计不可用 · 点击重试');
    expect(w.find('.mk-kpi--bad').exists()).toBe(true);
    // 点击 KPI 卡 → 调 live 层 retry
    await w.findAll('.mk-kpi')[0].trigger('click');
    expect(retryLiveVirtualStats).toHaveBeenCalledTimes(1);
  });

  it('P1#19 运行统计三态：加载中 → KPI「…」，不渲染 0% 假数字', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    liveVirtualStatsLoading.value = true;
    const w = await mountPage();
    const kpiNum = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label)?.find('.mk-kpi__num').text();
    expect(kpiNum('完成率')).toBe('…');
    expect(kpiNum('系统失败率')).toBe('…');
    expect(w.text()).toContain('统计加载中');
  });

  it('完成率非整数比取整（2026-10-11 走查：原样插值渲染出 3.8461538461538463%）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    liveVirtualRunStats.value = {
      ...liveVirtualRunStats.value,
      totalSessions: 26,
      completed: 1,
      failed: 5,
      abandoned: 13,
      systemFailureRate: 19,
      failureRate: 69
    };
    const w = await mountPage();
    const kpiNum = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label)?.find('.mk-kpi__num').text();
    // 1/26 = 3.846… → 4%；系统失败率 / 合计同为整数百分号
    expect(kpiNum('完成率')).toBe('4%');
    expect(kpiNum('系统失败率')).toBe('19%');
    expect(w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '系统失败率')?.attributes('title')).toContain('两类合计占 69%');
    expect(w.text()).not.toMatch(/3\.8461538/);
  });

  it('完成率 0<rate<1 仍显「<1%」（取整不得把 0.44% 压成 0% 假零）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    liveVirtualRunStats.value = { ...liveVirtualRunStats.value, totalSessions: 685, completed: 3 };
    const w = await mountPage();
    const kpiNum = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label)?.find('.mk-kpi__num').text();
    expect(kpiNum('完成率')).toBe('<1%');
  });

  it('P2 并发「已满」：琥珀（资源状态非故障），不再红档', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    liveAutopilotConcurrency.value = { used: 10, limit: 10, queued: 0 };
    const w = await mountPage();
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '并发')!;
    expect(card.text()).toContain('已满');
    expect(card.classes()).not.toContain('mk-kpi--bad');
    expect(card.classes()).toContain('mk-kpi--warn');
  });

  it('P1#20 速率卡：值「在途 / 上限」+ hint 口径，分母用已保存回执值（不吃输入框脏值）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '速率')!;
    // getVirtualLabSettings 回执：limit=200 / inFlight=3
    // 2026-10-03：值与口径分栏——整串「在途 3 · 上限 200/分」在卡宽内必换行，把整排 KPI 拉伸到 180px
    expect(card.find('.mk-kpi__num').text()).toBe('3 / 200/分');
    expect(card.find('.mk-kpi__hint').text()).toContain('每分钟上限');
  });

  it('P1#20 创建列：相对时间配绝对时间 title', async () => {
    liveVirtuals.value = [makeVirtual(1, { createdAt: '2026-08-10T10:00:00' })];
    const w = await mountPage();
    // 2026-10-03 方言收敛：title 随 mk-cell-sub 内层 span（时间列词汇），不再挂 td
    const sub = w.findAll('tbody .mk-cell-sub').find((c) => c.attributes('title')?.startsWith('创建于 '));
    expect(sub).toBeTruthy();
    expect(sub!.attributes('title')).toContain('2026-08-10 10:00');
  });

  it('运行统计展示（A5）：今日调用/完成率/系统失败率（状态条）', async () => {
    liveVirtualRunStats.value = {
      profileCount: 3,
      totalSessions: 10,
      created: 0,
      running: 0,
      failed: 3,
      abandoned: 1,
      completed: 6,
      completionRate: 60,
      failureRate: 40,
      systemFailureRate: 30,
      humanTerminatedRate: 10,
      staleCount: 2,
      maxStaleMins: 1450,
      avgDurationMs: 7200000,
      reclaimThresholdMs: 24 * 3600 * 1000,
      todayCalls: 200
    };
    liveVirtualSessionStats.value = { created: 0, running: 0, failed: 3, abandoned: 1, completed: 6, total: 10 };
    liveVirtualStaleCount.value = 2;
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    // KPI 卡为竖排布局：label 与数字分行（共享 MkKpi），文本无空格拼接；详情行保留空格
    expect(w.text()).toContain('今日调用');
    expect(w.text()).toContain('200');
    expect(w.text()).toContain('完成率');
    expect(w.text()).toContain('60%');
    // B8-F4-4：口径正名「系统失败率」（值与 systemFailureRate 一致，与总览页同标）
    expect(w.text()).toContain('系统失败率');
    expect(w.text()).toContain('30%');
    // hint 必须写明分母与「人为终止另计」，并给出合计失败率（40%），运营不再把 30% 读成全部失败占比
    // 2026-10-08 走查 #3：分母由裸「全部」改为「全部会话」——同一张卡上方是会话口径、
    // 下方表格是学习者口径（行数 = 虚拟学习者），裸「全部」会被读成同一个分母。
    expect(w.text()).toContain('系统失败 3');
    expect(w.text()).toContain('人为终止 1');
    expect(w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '系统失败率')?.attributes('title')).toContain('两类合计占 40%');
    expect(w.text()).toContain('已完成 6 / 全部会话 10');
    // 表格分页行必须声明自己数的是学习者，与上方会话口径区分
    expect(w.text()).toContain('行数为虚拟学习者数');
  });

  it('无会话数据时完成率/系统失败率显示 0%（共享 KPI 卡常驻）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    // 按卡片结构断言而非拼接文本（MkKpi 里 label 与数字是相邻元素，text() 无空格）
    const kpiNum = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label)?.find('.mk-kpi__num').text();
    expect(kpiNum('完成率')).toBe('0%');
    expect(kpiNum('系统失败率')).toBe('0%');
    // 防回归：这一页的运行指标必须挂在共享 .mk-kpi-grid 下（2026-09-29 归一，原 MkStatStrip 自由条）
    expect(w.find('.vl-kpi .mk-kpi-grid').exists()).toBe(true);
    expect(w.findAll('.mk-kpi')).toHaveLength(5);
  });

  it('压测参数卡已迁出（2026-10-13）：本页不再有写控件，只留只读读数', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    // 卡片连同写控件（速率/最高并发/日期模拟）整体迁往「模型与接入 → 虚拟学习者」页签，
    // 卡内结构回归见 virtual-lab-load-settings.test.ts
    expect(w.find('.vl-settings').exists()).toBe(false);
    expect(w.find('.vl-rpm__input').exists()).toBe(false);
    expect(w.find('.sd-settings').exists()).toBe(false);
    // 只读读数保留：并发 / 速率 仍在 KPI 带里（运营仍可任意启动，上限由设置页统一管控）
    const kpiText = w.find('.vl-kpi').text();
    expect(kpiText).toContain('并发');
    expect(kpiText).toContain('速率');
    expect(w.findAll('.vl-kpi .mk-kpi')).toHaveLength(5);
  });

  /* 2026-10-16 用户拍板「kpi 面板内部进度条不要出现」：完成率/并发两张卡原先各挂一根
     .mk-minibar 进度槽，读数已在数值位与 hint 说全，卡内再画轨道只是重复表达并撑高卡面。
     这里把方向反过来钉住：KPI 卡内不许出现进度条（表格列内的进度条不受影响）。 */
  it('KPI 卡内不出现进度条（读数类卡只有 label + 数值 + 一句口径）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    expect(w.findAll('.vl-kpi .mk-kpi').length).toBeGreaterThan(0);
    expect(w.findAll('.vl-kpi .mk-kpi .mk-minibar').length).toBe(0);
  });

  it('无卡死时不出现一键回收按钮；未截断时不出现截断提示', async () => {
    liveVirtualSessionStats.value = { created: 0, running: 0, failed: 0, abandoned: 0, completed: 5, total: 5 };
    liveVirtualStaleCount.value = 0;
    liveVirtualsTotal.value = 1;
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    expect(w.text()).not.toContain('回收无响应');
    expect(w.text()).not.toContain('已截断');
  });

  /** 2026-10-18 用户走查「多选还是不要先显示」：勾选列默认不出，
   *  批量入口保留在「列」菜单（选择框（批量操作）），需要时自己打开。 */
  it('选择框列默认隐藏：首访无全选、无行内勾选，列菜单仍可找回', async () => {
    liveVirtuals.value = [makeVirtual(1), makeVirtual(2)];
    const w = await mountPageFreshCols();
    expect(w.find('thead input[type="checkbox"][aria-label="全选当前页"]').exists()).toBe(false);
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(0);
    expect(w.text()).not.toContain('已选');

    await findBtn(w, '列').trigger('click');
    await nextTick();
    const labels = w.findAll('.mk-cols__item').map((x) => x.text());
    expect(labels.some((t) => t.includes('选择框'))).toBe(true);

    // 打开后可勾选并出批量条（入口是活的，不是只删了列）
    const item = w.findAll('.mk-cols__item').find((x) => x.text().includes('选择框'))!;
    await item.find('input[type="checkbox"]').setValue(true);
    await nextTick();
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(2);
    await w.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0].setValue(true);
    await nextTick();
    expect(w.text()).toContain('已选 1 人');
  });

  it('复选框勾选后出现批量条：已选数量 + 取消选择', async () => {
    liveVirtuals.value = [makeVirtual(1), makeVirtual(2)];
    const w = await mountPage();
    expect(w.text()).not.toContain('已选');
    const boxes = w.findAll<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    await boxes[0].setValue(true);
    await nextTick();
    expect(w.text()).toContain('已选 1 人');
    expect(w.text()).toContain('批量终止');
    expect(w.text()).toContain('批量清理无响应');
    const del = findBtn(w, '批量删除');
    // 批量删除已实装（2B 完成）：仅受 batchActionBusy 互斥，不再处于占位禁用态
    expect((del.element as HTMLButtonElement).disabled).toBe(false);
    await findBtn(w, '取消选择').trigger('click');
    await nextTick();
    expect(w.text()).not.toContain('已选');
  });

  it('批量终止：确认后调 terminate 端点（profileIds + dryRun:false），结果 toast', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 2 }), makeVirtual(2, { runningCount: 1 })];
    const w = await mountPage();
    const boxes = w.findAll<HTMLInputElement>('tbody input[type="checkbox"]');
    await boxes[0].setValue(true);
    await boxes[1].setValue(true);
    await nextTick();
    findBtn(w, '批量终止').trigger('click');
    await nextTick();
    settleConfirm(true);
    await flushPromises();
    expect(terminateMock).toHaveBeenCalledWith({ profileIds: ['vl-1', 'vl-2'], dryRun: false });
  });

  it('批量终止（busy 端到端）：真点弹窗确认 → 进入「处理中…」防重复提交 → 业务结束后弹窗自动关闭', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 2 })];
    const w = await mountPage();
    // 真实挂载确认框（页面只负责发起 askConfirm；弹窗由全局单例 Confirm 承载）
    const dialog = mount(Confirm, { attachTo: document.body });

    await w.find<HTMLInputElement>('tbody input[type="checkbox"]').setValue(true);
    await nextTick();
    findBtn(w, '批量终止').trigger('click');
    await nextTick();

    // 发起后：弹窗打开且处于 busy 模式，但尚未忙碌
    expect(confirmState.open).toBe(true);
    expect(confirmState.busyMode).toBe(true);
    expect(confirmState.busy).toBe(false);

    // 真点「确认」（Confirm Teleport 到 body，故从 document 取）
    const btns = [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')];
    expect(btns).toHaveLength(2); // [0] 取消 / [1] 确认
    btns[1].click();
    await nextTick();

    // 关键：已进入 busy（按钮禁用 = 防重复提交），且弹窗**仍开着**由业务收尾
    expect(confirmState.busy).toBe(true);
    expect(confirmState.open).toBe(true);
    expect(document.querySelector('.mk-confirm')?.textContent).toContain('处理中');
    expect(terminateMock).toHaveBeenCalledWith({ profileIds: ['vl-1'], dryRun: false });

    // 业务结束 → 弹窗自动关闭并回到空闲态
    await flushPromises();
    expect(confirmState.open).toBe(false);
    expect(confirmState.busy).toBe(false);

    dialog.unmount();
    w.unmount();
  });

  it('批量终止：确认取消时不调端点', async () => {    liveVirtuals.value = [makeVirtual(1, { runningCount: 1 })];
    const w = await mountPage();
    await w.find<HTMLInputElement>('tbody input[type="checkbox"]').setValue(true);
    await nextTick();
    findBtn(w, '批量终止').trigger('click');
    await nextTick();
    settleConfirm(false);
    await flushPromises();
    expect(terminateMock).not.toHaveBeenCalled();
  });

  it('批量清理无响应：dryRun 清单 → 确认 → dryRun:false 落地（均带选中 profileIds）', async () => {
    liveVirtuals.value = [makeVirtual(1, { stalledCount: 1 }), makeVirtual(2)];
    reclaimMock.mockResolvedValueOnce({
      data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [{ id: 'stale-1', status: 'running', currentStage: 'goal', staleMs: 3 * 3600 * 1000, updatedAt: 'x' }] } }
    });
    reclaimMock.mockResolvedValueOnce({
      data: { data: { dryRun: false, reclaimed: 1, skippedActiveLease: 0, sessions: [] as Array<Record<string, unknown>> } }
    });
    const w = await mountPage();
    const boxes = w.findAll<HTMLInputElement>('tbody input[type="checkbox"]');
    await boxes[0].setValue(true);
    await nextTick();
    findBtn(w, '批量清理无响应').trigger('click');
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(1, { dryRun: true, profileIds: ['vl-1'] });
    // Teleport 到 body 后，modal 内容在 document.body 而非 wrapper 内
    expect(document.body.textContent).toContain('批量清理无响应会话');
    expect(document.body.textContent).toContain('stale-1');
    expect(document.body.textContent).toContain('3.0 小时无写入');
    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('确认回收'));
    if (confirmBtn) await confirmBtn.dispatchEvent(new Event('click'));
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(2, { dryRun: false, profileIds: ['vl-1'] });
  });

  it('一键回收（全局）：dryRun 无 profileIds，确认后落地', async () => {
    liveVirtualSessionStats.value = { created: 0, running: 3, failed: 0, abandoned: 0, completed: 0, total: 3 };
    liveVirtualStaleCount.value = 3;
    liveVirtuals.value = [makeVirtual(1, { runningCount: 1, stalledCount: 1 })];
    reclaimMock.mockResolvedValueOnce({ data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [{ id: 'stale-9', status: 'running', currentStage: 'learn', staleMs: 7200000, updatedAt: 'x' }] } } });
    reclaimMock.mockResolvedValueOnce({ data: { data: { dryRun: false, reclaimed: 1, skippedActiveLease: 0, sessions: [] as Array<Record<string, unknown>> } } });
    const w = await mountPage();
    findBtn(w, '回收无响应（3）').trigger('click');
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(1, { dryRun: true });
    // Teleport 到 body 后，modal 内容在 document.body
    expect(document.body.textContent).toContain('一键回收无响应会话');
    const confirmBtn2 = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('确认回收'));
    if (confirmBtn2) await confirmBtn2.dispatchEvent(new Event('click'));
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(2, { dryRun: false });
  });

  it('「进行中」列点击直达会话座舱（openSubPage session）', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 1, runningSessionIds: ['run-1'], currentStage: 'goal' })];
    const w = await mountPage();
    await w.find('.rs-badge').trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('session', 'run-1');
  });

  it('B8-F4-2 干跑清单同源同数：候选数=角标口径，豁免项逐条列出（不再「按钮 35 / 弹窗 0」）', async () => {
    // 页头角标读 staleCount（= 超阈值卡死候选，排除暂停）；干跑返回同一批候选：可回收 0 + 豁免 2
    liveVirtualSessionStats.value = { created: 0, running: 2, failed: 0, abandoned: 0, completed: 0, total: 2 };
    liveVirtualStaleCount.value = 2;
    liveVirtuals.value = [makeVirtual(1, { runningCount: 2, stalledCount: 2 })];
    reclaimMock.mockResolvedValueOnce({
      data: {
        data: {
          dryRun: true, scanned: 2, reclaimed: 0, batchLimit: 50,
          sessions: [] as Array<Record<string, unknown>>,
          skippedSessions: [
            { id: 'held-1', status: 'running', currentStage: 'goal', staleMs: 3600000, updatedAt: 'x', skipReason: 'held' },
            { id: 'lease-1', status: 'running', currentStage: 'learn', staleMs: 7200000, updatedAt: 'x', skipReason: 'active-lease' }
          ]
        }
      }
    });
    const w = await mountPage();
    findBtn(w, '回收无响应（2）').trigger('click');
    await flushPromises();
    const body = document.body.textContent || '';
    // 弹窗候选数与按钮角标同数（2），并给出豁免分项
    expect(body).toContain('扫描到 2 个超过回收阈值的无响应候选会话（与「回收无响应」按钮同一口径）');
    expect(body).toContain('可回收 0 个');
    expect(body).toContain('豁免 2 个');
    // 豁免项逐条可见 + 原因标签
    expect(body).toContain('held-1');
    expect(body).toContain('lease-1');
    expect(body).toContain('外部 hold');
    expect(body).toContain('活跃租约');
    // 无可回收项 → 确认按钮禁用且文案为 0（数字与清单一致，不再是「35 暗示 / 0 实际」的错位）
    const confirm = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('确认回收')) as HTMLButtonElement | undefined;
    expect(confirm?.textContent).toContain('确认回收 0 个会话');
    expect(confirm?.disabled).toBe(true);
    // 关闭弹窗，避免污染后续用例的 document.body
    const cancel = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim() === '取消');
    cancel?.dispatchEvent(new Event('click'));
    await flushPromises();
    w.unmount();
  });

  it('卡死/失败会话分列标注（卡死/失败列红数字）', async () => {
    liveVirtuals.value = [makeVirtual(1, { stalledCount: 1, failedCount: 2 })];
    const w = await mountPage();
    // 卡死列：数字直出（2026-10-03 方言收敛，徽章「卡死 N」复读列头已退役），>0 标红
    const stalled = w.findAll('tbody .vl-num--bad').filter((el) => !el.classes().includes('vl-faillink'));
    expect(stalled.length).toBe(1);
    expect(stalled[0].text()).toBe('1');
    // 失败列：纯数字（可点击进画像页）
    const failCell = w.findAll('tbody tr td').find((td) => (td.text() || '').trim() === '2');
    expect(failCell).toBeTruthy();
    expect(w.find('.vl-faillink.vl-num--bad').exists()).toBe(true);
    // 进行中列只表达生命周期/阶段，不混入失败/卡死徽章
    expect(w.find('.vl-state-cell .mk-badge--bad').exists()).toBe(false);
  });

  it('「新建」触发新建弹窗（批量实验已下线，列表页「新建/批量新建」是唯一创建入口）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    const createBtn = w.findAll('button').find((b) => b.text() === '新建')!;
    await createBtn.trigger('click');
    await nextTick();
    await nextTick();
    expect(document.body.textContent).toContain('新建虚拟学习者');
    w.unmount();
  });

  it('「新建」仍是 learners 语境：提交后跳画像页（与卡库「平台生产」同表单、落点不同）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    await w.findAll('button').find((b) => b.text() === '新建')!.trigger('click');
    await nextTick();
    await nextTick();
    // 弹窗走 Teleport 到 body：字段与按钮都在 document.body 上操作
    const setField = (sel: string, value: string) => {
      const el = document.body.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
      el.value = value;
      el.dispatchEvent(new Event('input'));
    };
    expect(document.body.textContent).toContain('新建虚拟学习者');
    setField('.mk-modal__panel input.mk-field__input', '考研二战的小李');
    setField('.mk-modal__panel textarea.mk-field__textarea', '二战考研，逻辑还行但总在数学上丢分，晚上效率低。');
    await nextTick();
    const submit = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === '创建虚拟学习者') as HTMLButtonElement;
    submit.dispatchEvent(new Event('click'));
    await flushPromises();
    // learners 语境维护原行为：建完跳画像页去生成故事（库语境才留在卡库）
    expect(openSubPageMock).toHaveBeenCalledWith('virtual', 'vl-new');
    w.unmount();
  });

  it('行 ⋯ 菜单含「单步测试 / 查看来源卡」（低频操作收进菜单，行内只留主操作「运行」）', async () => {
    liveVirtuals.value = [makeVirtual(7)];
    const w = await mountPage();
    const row = w.find('.mk-card--fill tbody tr');
    expect(row.exists()).toBe(true);
    // 2026-10-12 外部批评采纳（操作密度）：行内 = 运行 / ⋯；测试（低频诊断）与跨页导航都进 ⋯ 菜单
    expect(row.findAll('.mk-actions > .mk-btn').map((b) => b.text())).toEqual(['运行']);
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const itemOf = (text: string) => row.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text() === text);
    expect(itemOf('单步测试'), '菜单缺少单步测试入口').toBeTruthy();
    expect(itemOf('查看来源卡'), '列表行缺少进卡库的入口').toBeTruthy();
    expect(itemOf('删除')).toBeTruthy();
    // 单步测试：点击后关菜单 + 弹出 Prompt 测试面板（Teleport 到 body）
    await itemOf('单步测试')!.trigger('click');
    await nextTick();
    const titles = [...document.body.querySelectorAll('.mk-modal__title')].map((el) => el.textContent || '');
    expect(titles.some((t) => t.includes('单步测试')), '单步测试未弹出面板').toBe(true);
    expect(row.find('.mk-menu__pop').exists()).toBe(false);
    // 查看来源卡仍走原行为（卡库 id 即本表行 id，同一条档案记录；列表是一级页 → 无需 from）
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    await row.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text() === '查看来源卡')!.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card', 'vl-7');
    w.unmount();
  });

  it('故事 / 路径列：两个数并置，多路径学习者的阶段条只交代最近一次会话', async () => {
    liveVirtuals.value = [
      makeVirtual(1, {
        storyCount: 2,
        pathCount: 5,
        stageProgress: { goalReady: true, pathReady: true, learnStarted: true, taskDone: 1, taskTotal: 25 }
      })
    ];
    const w = await mountPage();
    expect(w.findAll('thead th').map((th) => th.text())).toContain('故事 / 路径');
    const cell = w.find('tbody tr td[title^="故事池"]');
    expect(cell.exists(), '缺少故事 / 路径列').toBe(true);
    expect(cell.text().replace(/\s+/g, '')).toBe('2/5');
    // 一个故事可衍生多条路径：路径数大于故事数不是数据错，title 必须交代设计语义
    expect(cell.attributes('title')).toContain('已生成路径 5 条');
    expect(cell.attributes('title')).toContain('一个故事可衍生多条路径');
    // 阶段条只对应一条会话（多路径时点明总量），避免把「1 条路径在跑」读成「只有 1 条路径」
    expect(w.find('.vl-stage').attributes('title')).toContain('共 5 条路径');
    w.unmount();
  });
});
