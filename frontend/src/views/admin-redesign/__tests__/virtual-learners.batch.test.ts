/**
 * VirtualLearners P1 批量管理与生命周期视图（A1/A2）测试：
 * 分区计数状态条（全量口径）/ 已截断提示 / 复选框批量条 /
 * 批量终止（profileIds → terminate 端点）/ 批量清理卡死与一键回收（reclaim-stale dryRun → 确认落地）/
 * 运行中列直达座舱 / 卡死·失败 bad 色标注 / 批量删除标记待 2B
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats } from '../live';
import { settleConfirm } from '../useConfirm';

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
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
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
  reclaimMock: vi.fn(async () => ({ data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [] as Array<Record<string, unknown>> } } })),
  openSubPageMock: vi.fn()
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    generatePersona: vi.fn(async () => ({ data: {} })),
    getVirtualLearnerStories: vi.fn(async () => ({ data: { data: { stories: [] } } })),
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
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
    failedCount: 0,
    stalledCount: 0,
    runningSessionIds: [],
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
    terminateMock.mockReset();
    terminateMock.mockImplementation(async () => ({ data: { data: { dryRun: false, terminated: 2, skippedTerminal: 1 } } }));
    reclaimMock.mockReset();
    reclaimMock.mockImplementation(async () => ({ data: { data: { dryRun: true, reclaimed: 0, skippedActiveLease: 0, sessions: [] } } }));
    openSubPageMock.mockClear();
  });

  it('状态条分区计数：全量口径（创建中/运行中/已失败/卡死）+ 已截断提示', async () => {
    liveVirtualSessionStats.value = { created: 3, running: 2, failed: 1, abandoned: 1, completed: 0, total: 7 };
    liveVirtualStaleCount.value = 2;
    liveVirtualsTotal.value = 80;
    liveVirtuals.value = [makeVirtual(1), makeVirtual(2), makeVirtual(3)];
    const w = await mountPage();
    expect(w.text()).toContain('创建中 3');
    expect(w.text()).toContain('运行中 2');
    expect(w.text()).toContain('已失败 2');
    expect(w.text()).toContain('卡死 2');
    expect(w.text()).toContain('已截断 · 共 80 人');
    expect(w.text()).toContain('回收卡死（2）');
  });

  it('运行统计展示（A5）：完成率/失败率/终止率/均耗/卡死最长分钟（状态条）', async () => {
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
    expect(w.text()).toContain('失败率');
    expect(w.text()).toContain('30%');
    expect(w.text()).toContain('终止率 10%');
    expect(w.text()).toContain('均耗 2 小时');
    expect(w.text()).toContain('卡死 2（最长 24.2 小时）');
  });

  it('无会话数据时统计段不出现（完成率/平均时长等）', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = await mountPage();
    expect(w.text()).not.toContain('完成率');
    expect(w.text()).not.toContain('平均时长');
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

  it('批量终止：确认取消时不调端点', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 1 })];
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

  it('「运行中」列点击直达会话座舱（openSubPage session）', async () => {
    liveVirtuals.value = [makeVirtual(1, { runningCount: 1, runningSessionIds: ['run-1'], currentStage: 'goal' })];
    const w = await mountPage();
    await w.find('.vl-run--live').trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('session', 'run-1');
  });

  it('卡死/失败会话分列标注（卡死 N 徽章 / 失败列数字）', async () => {
    liveVirtuals.value = [makeVirtual(1, { stalledCount: 1, failedCount: 2 })];
    const w = await mountPage();
    // 卡死列：徽章文案
    expect(w.text()).toContain('卡死 1');
    // 失败列：纯数字（新列布局）
    const failCell = w.findAll('tbody tr td').find((td) => (td.text() || '').trim() === '2');
    expect(failCell).toBeTruthy();
    expect(w.find('.vl-stall').exists()).toBe(true);
    expect(w.find('.vl-num--bad').exists()).toBe(true);
    // 运行中列不再混入失败/卡死徽章
    expect(w.findAll('.vl-badge--bad')).toHaveLength(0);
  });
});
