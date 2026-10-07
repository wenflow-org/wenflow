/**
 * VirtualLearners P1 批量管理与生命周期视图（A1/A2）测试：
 * 分区筛选 chips（2026-10-04 自页头状态条迁入卡头）/ 活动会话 hint / 已截断提示 / 复选框批量条 /
 * 批量终止（profileIds → terminate 端点）/ 批量清理卡死与一键回收（reclaim-stale dryRun → 确认落地）/
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
    runningCount: 0,
    pausedCount: 0,
    failedCount: 0,
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
    const head = w.find('.mk-card__head');
    const countOf = (label: string) =>
      head.findAll('.mk-pill').find((p) => p.text().replace(/\s/g, '').startsWith(label))?.find('.mk-pill__count').text();
    expect(countOf('进行中')).toBe('1');
    expect(countOf('已暂停')).toBe('1');
    expect(countOf('曾失败')).toBe('1');
    expect(w.text()).not.toContain('需关注');
    // 截断提示迁卡头 meta（与行数同格）
    expect(w.text()).toContain('已截断 · 共 80 人');
    expect(w.text()).toContain('回收卡死（2）');
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
    expect(card.find('.mk-kpi__hint').text()).toContain('在途 / 上限');
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
    expect(w.text()).toContain('系统失败 3 / 全部 10');
    expect(w.text()).toContain('人为终止 1 另计');
    expect(w.text()).toContain('合计 40%');
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

  it('压测参数卡（2026-10-05 tab 化）：速率上限/日期模拟两页签，写控制不进 KPI 数字栅格', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    const card = w.find('.vl-settings');
    expect(card.exists()).toBe(true);
    const tabs = card.findAll('.tab');
    expect(tabs.map((t) => t.text().trim())).toEqual(['速率上限', '日期模拟']);
    // 默认速率页签：输入框+保存可见；页签 aria-selected 契约（平台 .tabs 语言）
    expect(tabs[0].attributes('aria-selected')).toBe('true');
    expect(card.find('.vl-rpm__input').exists()).toBe(true);
    expect(card.text()).toContain('保存');
    // 日期页签体隐藏（v-show 落在 pane 元素上），切换后可见
    const panes = card.findAll('.vl-settings__pane');
    expect((panes[1].element as HTMLElement).style.display).toBe('none');
    await tabs[1].trigger('click');
    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect((panes[1].element as HTMLElement).style.display).not.toBe('none');
    expect(card.find('.sd-settings').exists()).toBe(true);
    // 读/写分块判例：写控制不进 KPI 数字栅格
    expect(w.find('.vl-kpi .vl-settings').exists()).toBe(false);
    expect(w.findAll('.vl-kpi .mk-kpi')).toHaveLength(5);
  });

  it('KPI 卡内附挂 .mk-minibar 进度槽（完成率/并发），家族原语不私造', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    const bars = w.findAll('.vl-kpi .mk-kpi .mk-minibar');
    expect(bars.length).toBe(2);
  });

  it('无卡死时不出现一键回收按钮；未截断时不出现截断提示', async () => {
    liveVirtualSessionStats.value = { created: 0, running: 0, failed: 0, abandoned: 0, completed: 5, total: 5 };
    liveVirtualStaleCount.value = 0;
    liveVirtualsTotal.value = 1;
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    expect(w.text()).not.toContain('回收卡死');
    expect(w.text()).not.toContain('已截断');
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
    expect(w.text()).toContain('批量清理卡死');
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

  it('批量清理卡死：dryRun 清单 → 确认 → dryRun:false 落地（均带选中 profileIds）', async () => {
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
    findBtn(w, '批量清理卡死').trigger('click');
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(1, { dryRun: true, profileIds: ['vl-1'] });
    // Teleport 到 body 后，modal 内容在 document.body 而非 wrapper 内
    expect(document.body.textContent).toContain('批量清理卡死会话');
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
    findBtn(w, '回收卡死（3）').trigger('click');
    await flushPromises();
    expect(reclaimMock).toHaveBeenNthCalledWith(1, { dryRun: true });
    // Teleport 到 body 后，modal 内容在 document.body
    expect(document.body.textContent).toContain('一键回收卡死会话');
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
    findBtn(w, '回收卡死（2）').trigger('click');
    await flushPromises();
    const body = document.body.textContent || '';
    // 弹窗候选数与按钮角标同数（2），并给出豁免分项
    expect(body).toContain('扫描到 2 个超阈值卡死候选会话（与页头角标同源）');
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
});
