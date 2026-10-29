/**
 * 执行日志 P50/P99 读数口径（M-3，2026-10-29 夜审）：
 * - stats 带 latencyPercentiles（全窗聚合、毫秒）→ 优先服务端值，与全窗口成功率同窗；
 * - stats 未带该字段（旧后端）→ 回退当前页样本估算，且 KPI title 必须注明「按当前页样本估算」；
 * - 读数作废在途（重查中）→ 显「—」，不用上一窗口的表格样本冒充当前窗口读数。
 * （./live 与 ./store 整体 mock，与 exec-logs.pagination.test.ts 同一套马具。）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import ExecLogs from '../ExecLogs.vue';
import { liveLogsFiltered, liveLogStats, liveLogsLoading } from '../live';
import type { TraceSpan } from '../store';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveLogsFiltered: ref([]),
    liveLogsTotal: ref(0),
    liveLogsPage: ref(1),
    liveLogsPageSize: ref(30),
    liveLogsRowsMerged: ref(0),
    liveLogsLoading: ref(false),
    liveLogsError: ref(''),
    liveLogStats: ref(null),
    livePromptIndex: ref({}),
    liveLoading: ref(false),
    reloadLiveSpans: vi.fn(async () => {}),
    fetchLogDetail: vi.fn(async () => ({ attempts: [], attemptCount: 1, maxAttempts: 1 })),
    loadPromptIndex: vi.fn(async () => {}),
    waterfallSpans: ref([]),
    waterfallTotal: ref(0),
    waterfallLoading: ref(false),
    waterfallSyncFromBoot: vi.fn(() => {}),
    waterfallLoadMore: vi.fn(async () => {}),
    waterfallFetchTrace: vi.fn(async () => {}),
    waterfallFetchSession: vi.fn(async () => {}),
    WATERFALL_MAX_SPANS: 2000,
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../traceCost', () => ({
  loadModelPrices: vi.fn(async () => null),
  estimateTraceCostUsd: vi.fn(() => ({ usd: null, priced: 0, unpriced: 0, pricedModels: [], unpricedModels: [] }))
}));

vi.mock('../store', async () => {
  const { ref, reactive } = await import('vue');
  return {
    spans: ref([]),
    dataSource: ref('live'),
    isLive: ref(true),
    tokenCostFilters: reactive({ days: 7, includeTest: false }),
    intent: { agentFilter: '', statusFilter: '' },
    openTrace: vi.fn(),
    openSession: vi.fn(),
    openSkillDrawer: vi.fn(),
    clearInvestigation: vi.fn(),
    liveSkillStatsMap: ref({}),
  };
});

function fakeSpan(i: number, durationMs: number): TraceSpan {
  return { id: `s${i}`, traceId: `tr:${i}`, agent: 'a1', stage: 'a1', ts: Date.now(), title: 't', status: 'ok', kind: 'call', startMs: 0, durationMs, detail: '' };
}

function kpiByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const el = wrapper.findAll('.mk-kpi').find((x) => x.find('.mk-kpi__label').text() === label);
  if (!el) throw new Error(`kpi not found: ${label}`);
  return el;
}

async function mountExec() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/execution-logs');
  await router.isReady();
  const w = mount(ExecLogs, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  liveLogsFiltered.value = [];
  liveLogStats.value = null;
  liveLogsLoading.value = false;
});

describe('ExecLogs 耗时 P50/P99 口径（M-3）', () => {
  it('stats 带 latencyPercentiles → 优先服务端值（与全窗口成功率同窗），title 不写样本估算', async () => {
    liveLogStats.value = {
      total: 3257,
      success: 3208,
      timeout: 0,
      error: 49,
      latencyPercentiles: { p50: 7400, p99: 61000 },
    };
    liveLogsFiltered.value = [fakeSpan(0, 1000)];
    const w = await mountExec();
    expect(kpiByLabel(w, '耗时 P50').find('.mk-kpi__num').text()).toContain('7.4s');
    expect(kpiByLabel(w, '耗时 P99').find('.mk-kpi__num').text()).toContain('61.0s');
    expect(kpiByLabel(w, '耗时 P50').attributes('title')).toContain('同一窗口');
    expect(kpiByLabel(w, '耗时 P50').attributes('title')).not.toContain('按当前页样本估算');
    w.unmount();
  });

  it('stats 未带该字段 → 回退当前页样本估算，title 注明「按当前页样本估算」', async () => {
    // 后端字段暂不存在的形态（M-3 期间的后端）：stats 里没有 latencyPercentiles 键
    liveLogStats.value = { total: 15, success: 15, timeout: 0, error: 0 };
    liveLogsFiltered.value = [fakeSpan(0, 2500), fakeSpan(1, 7400), fakeSpan(2, 35400)];
    const w = await mountExec();
    expect(kpiByLabel(w, '耗时 P50').find('.mk-kpi__num').text()).toContain('7.4s');
    expect(kpiByLabel(w, '耗时 P99').find('.mk-kpi__num').text()).toContain('35.4s');
    const title = kpiByLabel(w, '耗时 P50').attributes('title') || '';
    expect(title).toContain('按当前页样本估算');
    w.unmount();
  });

  it('stats 带字段但为 null（空窗）→ 不冒充读数，走样本估算披露', async () => {
    liveLogStats.value = {
      total: 0,
      success: 0,
      timeout: 0,
      error: 0,
      latencyPercentiles: { p50: null, p99: null },
    };
    liveLogsFiltered.value = [fakeSpan(0, 1200)];
    const w = await mountExec();
    expect(kpiByLabel(w, '耗时 P50').find('.mk-kpi__num').text()).toContain('1.2s');
    expect(kpiByLabel(w, '耗时 P50').attributes('title')).toContain('按当前页样本估算');
    w.unmount();
  });

  it('读数作废在途（重查中）→ 显「—」，不用上一窗口样本冒充当前窗口', async () => {
    liveLogsLoading.value = true;
    liveLogsFiltered.value = [fakeSpan(0, 7400)];
    const w = await mountExec();
    expect(kpiByLabel(w, '耗时 P50').find('.mk-kpi__num').text()).toContain('—');
    expect(kpiByLabel(w, '成功率').find('.mk-kpi__num').text()).toContain('—');
    w.unmount();
  });
});
