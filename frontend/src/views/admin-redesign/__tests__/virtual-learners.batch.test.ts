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
    refreshLiveVirtuals: vi.fn(async () => {}),
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

/* 页头「从卡库派生」走 vue-router（本页不再自己建号，见 2026-10-25 口径） */
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));

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
  localStorage.setItem('wf_vl_hidden_cols_v3', JSON.stringify([]));
  const w = mount(VirtualLearners);
  await flushPromises();
  await nextTick();
  return w;
}

/** 默认隐藏专测用：清掉本地记录，走 MkCols 首访 defaultHidden 路径 */
async function mountPageFreshCols() {
  localStorage.removeItem('wf_vl_hidden_cols_v2');
  localStorage.removeItem('wf_vl_hidden_cols_v3');
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
    pushMock.mockClear();
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
    /* 会话口径：活动 = running 2 + created 3 → 完成率卡。2026-10-19 用户走查「KPI hint
       在报读数」后读数下沉：副行只留口径短语，活动会话数住 title 长释（同一会话漏斗） */
    const completion = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '完成率');
    expect(completion!.find('.mk-kpi__hint').exists()).toBe(false);
    expect(completion!.attributes('title')).toContain('活动会话 5');
    // 筛选 chips 与「运行状态」列同源（runPhaseOf 三档），「曾失败」已迁到异常列表头
    // 按卡定位到列表卡（.mk-card--fill）：页内还有压测参数等其它卡头，取「第一个 .mk-card__head」会取错
    const head = w.find('.mk-card--fill .mk-card__head');
    const countOf = (label: string) =>
      head.findAll('.mk-pill').find((p) => p.text().replace(/\s/g, '').startsWith(label))?.find('.mk-pill__count').text();
    expect(countOf('运行中')).toBe('1');
    expect(countOf('停滞')).toBe('2');
    expect(countOf('已停止')).toBe('0');
    expect(w.text()).not.toContain('需关注');
    // 截断提示迁卡头 meta（与行数同格）；单位与分页器同词（位学习者），并说明「本次载入」而非再报一个「共」
    expect(w.text()).toContain('共 80 位学习者 · 本次载入');
    // 回收无响应收进「维护」菜单，信号改挂在触发钮的角标上
    expect(w.find('.vl-headmenu__badge').text()).toBe('2');
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
    expect(card.find('.mk-kpi__hint').exists()).toBe(false);
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
    /* 副行必须写明分母与「人为终止另计」，读数（三项分解）与合计失败率（40%）随长释进 title——
       运营不再把 30% 读成全部失败占比。
       2026-10-08 走查 #3：分母由裸「全部」改为「全部会话」——同一张卡上方是会话口径、
       下方表格是学习者口径（行数 = 虚拟学习者），裸「全部」会被读成同一个分母。 */
    const failure = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '系统失败率');
    expect(failure!.find('.mk-kpi__hint').exists()).toBe(false);
    const failureTitle = failure!.attributes('title') || '';
    expect(failureTitle).toContain('系统失败 3');
    expect(failureTitle).toContain('人为终止 1');
    expect(failureTitle).toContain('两类合计占 40%');
    expect(failureTitle).toContain('已完成 6 · 共 10 场');
    // 表格分页的计数单位直接写「位学习者」，不再用一句「行数=学习者数」解释口径
    expect(w.find('.mk-pagination__total').text()).toContain('位学习者');
    expect(w.text()).not.toContain('行数为虚拟学习者数');
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
    expect(w.findAll('.mk-kpi')).toHaveLength(6);
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
    expect(w.findAll('.vl-kpi .mk-kpi')).toHaveLength(6);
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

  /** 2026-10-19 运营走查「批量能力默认不存在」：默认隐藏保留（2026-10-18 拍板不动），
   *  但页头补一枚直接入口 —— 两个默认叠加（列隐藏 + 批量条要选中才出）后，首访看不到
   *  任何批量动作，运营会以为只能一个个点。 */
  it('页头不再放「批量操作」：勾选列的入口只有列菜单一处', async () => {
    liveVirtuals.value = [makeVirtual(1), makeVirtual(2)];
    const w = await mountPageFreshCols();
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(0);
    // 2026-10-21 逻辑重整：页头只留新建与维护；「打开勾选列」是列设置，回到列菜单
    const header = w.find('.mk-pagehead__actions');
    expect(header.text()).not.toContain('批量操作');
    await findBtn(w, '列').trigger('click');
    await nextTick();
    const item = w.findAll('.mk-cols__item').find((x) => x.text().includes('选择框'))!;
    await item.find('input[type="checkbox"]').setValue(true);
    await nextTick();
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(2);
    // 写的是 MkCols 同一个存储键：算用户的持久列偏好，不是临时态
    expect(JSON.parse(localStorage.getItem('wf_vl_hidden_cols_v3') || '[]')).not.toContain('check');
  });

  it('并发/速率 KPI 可点直达容量设置，指引不再指向已撤的页签名', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    const kpi = (label: string) => w.findAll('.mk-kpi').find((k) => k.find('.mk-kpi__label').text().trim() === label)!;
    const concurrency = kpi('并发');
    const rate = kpi('速率');
    // 渲染成真 button（MkKpi clickable）→ 键盘可达
    expect(concurrency.element.tagName).toBe('BUTTON');
    expect(rate.element.tagName).toBe('BUTTON');
    expect(concurrency.classes()).toContain('mk-kpi--clickable');
    expect(rate.classes()).toContain('mk-kpi--clickable');
    // 去向：容量治理 2026-10-21 迁到「模型与接入 · 虚拟学习者」页签（2026-10-24 修死链）
    expect(concurrency.attributes('title')).toContain('虚拟学习者');
    expect(rate.attributes('title')).toContain('虚拟学习者');
    expect(rate.attributes('title')).not.toContain('调用与健康');
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
    await findBtn(w, '维护').trigger('click');
    await nextTick();
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
    await findBtn(w, '维护').trigger('click');
    await nextTick();
    findBtn(w, '回收无响应（2）').trigger('click');
    await flushPromises();
    const body = document.body.textContent || '';
    // 弹窗候选数与按钮角标同数（2），并给出豁免分项
    expect(body).toContain('扫描到 2 个超过回收阈值的无响应候选会话（与「回收无响应」按钮同一统计方式）');
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

  it('异常列：失败与无响应合并成一格，各自带词、零值不出声', async () => {
    liveVirtuals.value = [makeVirtual(1, { stalledCount: 1, failedCount: 2 })];
    const w = await mountPage();
    // 两类信号在同一格，但各自带词（不再靠列头猜哪个数字是什么）
    const cell = w.find('tbody .vl-abnormal');
    expect(cell.exists()).toBe(true);
    expect(cell.find('.vl-abn--fail').text()).toBe('失败 2');
    expect(cell.find('.vl-abn--stall').text()).toBe('无响应 1');
    // 排序/口径进 title：失败含已终止，无响应按当前阈值
    expect(cell.find('.vl-abn--stall').attributes('title')).toContain('仍没有新写入');
    // 进行中列只表达生命周期/阶段，不混入失败/卡死徽章
    expect(w.find('.vl-state-cell .mk-badge--bad').exists()).toBe(false);

    // 都为零：整格一个「—」，不再是一排 0
    liveVirtuals.value = [makeVirtual(2, { stalledCount: 0, failedCount: 0 })];
    const w2 = await mountPage();
    expect(w2.find('tbody .vl-abnormal .mk-na').text()).toBe('—');
    expect(w2.findAll('tbody .vl-abn')).toHaveLength(0);
  });

  it('页头主操作是「从卡库派生」：本页不再有建号入口（2026-10-25「不播种、都派生」）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    // 建号只在卡库：列表页没有「新建 / 批量新建」菜单，也没有新建弹窗
    expect(w.findAll('button').map((b) => b.text())).not.toContain('新建');
    expect(w.text()).not.toContain('新建一个人');
    expect(w.text()).not.toContain('批量新建');
    const deriveBtn = w.findAll('button').find((b) => b.text() === '从卡库派生')!;
    expect(deriveBtn, '页头缺少派生入口').toBeTruthy();
    await deriveBtn.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/admin/virtual-learner-cards');
    w.unmount();
  });

  it('空态：没有派生实例时指向卡库（不再说「新建后生成故事」）', async () => {
    liveVirtuals.value = [];
    const w = await mountPage();
    const empty = w.find('.mk-empty');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('还没有派生过虚拟学习者');
    expect(empty.text()).toContain('卡库');
    expect(empty.text()).not.toContain('新建虚拟学习者');
    w.unmount();
  });

  it('行 ⋯ 菜单按性质分组：调试 / 导航 / 危险（行内只留状态驱动的下一步）', async () => {
    liveVirtuals.value = [makeVirtual(7)];
    const w = await mountPage();
    const row = w.find('.mk-card--fill tbody tr');
    expect(row.exists()).toBe(true);
    // 2026-10-12 外部批评采纳（操作密度）：行内 = 运行 / ⋯；测试（低频诊断）与跨页导航都进 ⋯ 菜单
    expect(row.findAll('.mk-actions > .mk-btn').map((b) => b.text())).toEqual(['运行']);
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const itemOf = (text: string) => row.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text() === text);
    expect(itemOf('提示词试跑'), '菜单缺少提示词试跑入口').toBeTruthy();
    expect(itemOf('查看来源卡'), '列表行缺少进卡库的入口').toBeTruthy();
    expect(itemOf('删除')).toBeTruthy();
    // 主按钮就是「运行」时，菜单里不再重复一条「再跑一次」
    expect(itemOf('再跑一次')).toBeFalsy();
    // 提示词试跑：点击后关菜单 + 弹出 Prompt 试跑面板（Teleport 到 body）
    await itemOf('提示词试跑')!.trigger('click');
    await nextTick();
    const titles = [...document.body.querySelectorAll('.mk-modal__title')].map((el) => el.textContent || '');
    expect(titles.some((t) => t.includes('提示词试跑')), '提示词试跑未弹出面板').toBe(true);
    expect(row.find('.mk-menu__pop').exists()).toBe(false);
    // 查看来源卡仍走原行为（卡库 id 即本表行 id，同一条档案记录；列表是一级页 → 无需 from）
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    await row.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text() === '查看来源卡')!.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card', 'vl-7');
    w.unmount();
  });

  it('正在跑的行：主按钮是暂停，菜单里保留「再跑一次」的入口', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 1, runningSessionIds: ['r-1'] })];
    const w = await mountPage();
    const row = w.find('.mk-card--fill tbody tr');
    expect(row.find('.mk-actions > .mk-btn').text()).toBe('暂停');
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const items = row.findAll('.mk-menu__pop .mk-menu__item').map((b) => b.text());
    // 暂停过的学习者如果没有这个入口，就再也开不了新运行
    expect(items).toContain('再跑一次');
    expect(items).toContain('提示词试跑');
    expect(items).toContain('删除');
    w.unmount();
  });

  it('故事 / 路径列：两个数并置，状态列只回答在不在跑（明细不进列表）', async () => {
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
    // 2026-10-21 晚：状态列不再逐条展开运行，只出「运行中 / 停滞 / 已停止」
    expect(w.find('.vl-histline').exists()).toBe(false);
    expect(w.find('.vl-state-cell').text()).toBe('已停止');
    w.unmount();
  });
});
