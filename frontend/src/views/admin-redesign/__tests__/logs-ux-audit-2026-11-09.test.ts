/**
 * 日志两页 UI/UX 审计回归（2026-11-09，图 4 / 图 5 / 图 6）
 *
 * A. ExecLogs 调用总数卡：主值（总数）走正常墨色，失败数拆到 valueNote 单独染红——
 *    此前整串「2225（失败 135）」都染红，读起来像全部失败。
 * B. AuditLogs 记录总数卡：统计请求失败时与其余三卡一样读「—」（不是 0）；
 *    失败统计只有一个重试入口（错误条内），不再同时出现中间那枚蓝「重试」。
 * C. AuditLogs 筛选栏：默认只有「状态 + 动作」两枚下拉；状态切到「仅失败」后
 *    「动作」让位给「失败动作」（条件联动，不再两枚同默认值并列）。
 * D. AuditLogs 末列 = 带「详情」表头的操作列 + 行内按钮；ExecLogs 末列 = 「操作」列，
 *    行内「详情」与行点击同一落点。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import AuditLogs from '../AuditLogs.vue';
import ExecLogs from '../ExecLogs.vue';
import {
  liveLogsPage,
  liveLogsPageSize,
  liveLogsTotal,
  liveLogsFiltered,
  liveLogStats,
  liveLogsLoading,
  liveLogsError
} from '../live';
import { chooseFilter, filterOptions } from './filter-controls';
import type { TraceSpan } from '../store';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIT_SRC = readFileSync(resolve(here, '..', 'AuditLogs.vue'), 'utf8');
const EXEC_SRC = readFileSync(resolve(here, '..', 'ExecLogs.vue'), 'utf8');

/* ======================= 共享 mock（两页各取所需） ======================= */

const h = vi.hoisted(() => ({
  reload: vi.fn(),
  getLogs: vi.fn(),
  getStats: vi.fn(),
  fetchLogDetail: vi.fn()
}));

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAuditApi: { getAuditLogs: h.getLogs, getAuditStats: h.getStats },
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject()
}));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  const liveLogsPage = ref(1);
  h.reload.mockImplementation((_query: unknown, page = 1) => {
    liveLogsPage.value = page;
    return Promise.resolve();
  });
  return {
    liveLogsFiltered: ref([]),
    liveLogsTotal: ref(0),
    liveLogsPage,
    liveLogsPageSize: ref(30),
    liveLogsRowsMerged: ref(0),
    liveLogsLoading: ref(false),
    liveLogsError: ref(''),
    liveLogStats: ref(null),
    livePromptIndex: ref({}),
    liveLoading: ref(false),
    /* 顶栏刷新序号（AuditLogs 的 watch 读它；本组用例不触发刷新，给个稳定 ref 即可） */
    liveRefreshSeq: ref(0),
    errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    shortId: (s: string) => s,
    reloadLiveSpans: h.reload,
    fetchLogDetail: h.fetchLogDetail,
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
    intent: { agentFilter: '', statusFilter: '', errorCategory: '', timeRange: '', traceFocus: false, sessionId: '', traceId: '' },
    openTrace: vi.fn(),
    openSession: vi.fn(),
    openSkillDrawer: vi.fn(),
    clearInvestigation: vi.fn(),
    liveSkillStatsMap: ref({})
  };
});

/* ======================= 挂载助手 ======================= */

async function mountAudit() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/audit-logs');
  await router.isReady();
  const w = mount(AuditLogs, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return w;
}

async function mountExec() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/execution-logs');
  await router.isReady();
  const w = mount(ExecLogs, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return w;
}

function fakeSpan(i: number, over: Partial<TraceSpan> = {}): TraceSpan {
  return {
    id: `s${i}`,
    traceId: `tr:${i}`,
    agent: 'a1',
    stage: 'a1',
    ts: Date.now(),
    title: 't',
    status: 'ok',
    kind: 'call',
    startMs: 0,
    durationMs: 10,
    detail: '',
    ...over
  };
}

const AUDIT_ROW = {
  id: 'a1',
  adminName: 'admin@wenflow.local',
  action: 'user.update',
  targetType: 'user',
  targetId: 'u-1',
  method: 'POST',
  path: '/api/admin/users/u-1',
  statusCode: 200,
  durationMs: 18,
  success: true,
  createdAt: '2026-11-09T10:00:00'
};

/* ======================= A. ExecLogs KPI 主/次层级 ======================= */

describe('A. ExecLogs 调用总数卡：主值不染红，失败数走 valueNote', () => {
  beforeEach(() => {
    h.reload.mockClear();
    h.fetchLogDetail.mockReset();
    h.fetchLogDetail.mockResolvedValue({ attempts: [], attemptCount: 1, maxAttempts: 1 });
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    liveLogStats.value = null;
    liveLogsLoading.value = false;
    liveLogsError.value = '';
    localStorage.clear();
    window.scrollTo = vi.fn();
  });

  it('有失败时：主值只放总数，失败数在 valueNote 里；卡片不带 tone（tone 会连主值一起染色）', async () => {
    liveLogStats.value = { total: 2225, success: 2090, timeout: 40, error: 95, canary: 0 };
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();

    const total = w.findAll('.mk-kpi')[0];
    expect(total.find('.mk-kpi__label').text().trim()).toBe('调用总数');
    // 主值：只有总数（.mk-kpi__num 的 text() 含注记，故按「去掉注记后的文本」判）
    const num = total.find('.mk-kpi__num');
    const noteEl = num.find('.mk-kpi__num-note');
    expect(noteEl.exists()).toBe(true);
    expect(num.element.textContent!.replace(noteEl.element.textContent!, '')).toBe('2,225');
    // 失败数：行内注记（更小字号），且不含括号——层级由字号/颜色表达，不用括号
    const note = total.find('.mk-kpi__num-note');
    expect(note.exists()).toBe(true);
    expect(note.text()).toBe('失败 135');
    // 关键回归：整卡不得带 mk-kpi--bad（.mk-kpi--bad .mk-kpi__num 会把主值也染红）
    expect(total.classes()).not.toContain('mk-kpi--bad');
    w.unmount();
  });

  it('无失败时：不渲染 valueNote（主值就是全部读数）', async () => {
    liveLogStats.value = { total: 120, success: 120, timeout: 0, error: 0, canary: 0 };
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    const total = w.findAll('.mk-kpi')[0];
    expect(total.find('.mk-kpi__num').text()).toBe('120');
    expect(total.find('.mk-kpi__num-note').exists()).toBe(false);
    w.unmount();
  });

  it('样式白盒：只有注记染红（--mk-red），主值沿用 .mk-kpi__num 的 --mk-ink', () => {
    // 页面 scoped 只给注记上色，且用的是 token 不是硬编码色
    expect(EXEC_SRC).toMatch(/\.exec-kpi-total\s*:deep\(\.mk-kpi__num-note\)\s*\{[^}]*color:\s*var\(--mk-red\)/);
    // 模板不再给调用总数卡传 tone（只看 MkKpi 标签本身，注释里的说明不算）
    const totalCard = EXEC_SRC.match(/<MkKpi\b[^>]*label="调用总数"[\s\S]*?\/>/)?.[0] ?? '';
    expect(totalCard).toContain(':value-note="callsTotalNote"');
    expect(totalCard).not.toContain(':tone=');
    // 旧的整串拼接已退役
    expect(EXEC_SRC).not.toContain('（失败 ${failed}）');
  });
});

/* ======================= B. AuditLogs 失败态 ======================= */

describe('B. AuditLogs 统计失败：记录总数读「—」，且只有一个重试入口', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    h.getLogs.mockResolvedValue({
      data: { data: { logs: [AUDIT_ROW], attempts: [], pagination: { total: 1, page: 1, limit: 30 } } }
    });
    window.scrollTo = vi.fn();
  });

  it('统计请求失败：记录总数与其余三卡同为「—」，不把失败读成 0 条', async () => {
    h.getStats.mockRejectedValue(new Error('stats down'));
    const w = await mountAudit();
    await flushPromises();
    await nextTick();

    const kpis = w.findAll('.mk-kpi');
    const byLabel = (label: string) => kpis.find((k) => k.find('.mk-kpi__label').text() === label)!;
    expect(byLabel('记录总数').find('.mk-kpi__num').text()).toBe('—');
    expect(byLabel('失败记录').find('.mk-kpi__num').text()).toBe('—');
    expect(byLabel('失败率').find('.mk-kpi__num').text()).toBe('—');
    expect(byLabel('失败动作').find('.mk-kpi__num').text()).toBe('—');
    // 记录总数卡不得出现 0
    expect(byLabel('记录总数').find('.mk-kpi__num').text()).not.toBe('0');
    w.unmount();
  });

  it('统计失败时只有一个重试入口：错误条内那枚，筛选栏不再有第二枚蓝「重试」', async () => {
    h.getStats.mockRejectedValue(new Error('stats down'));
    const w = await mountAudit();
    await flushPromises();
    await nextTick();

    // 错误条存在，且带 role=alert
    const strip = w.find('.mk-alert--row');
    expect(strip.exists()).toBe(true);
    expect(strip.attributes('role')).toBe('alert');
    // 全页只有一枚「重试」按钮，且就是错误条里那一枚（不再有第二枚蓝「重试」并排）
    const retryBtns = w.findAll('button').filter((b) => b.text().replace(/\s/g, '') === '重试');
    expect(retryBtns).toHaveLength(1);
    expect(strip.find('button').exists()).toBe(true);
    expect(strip.find('button').element).toBe(retryBtns[0].element);
    // 全页「重试」类按钮计数（含重试中…）也只有这一枚
    expect(w.findAll('button').filter((b) => /重试/.test(b.text()))).toHaveLength(1);
    w.unmount();
  });

  it('统计失败后点错误条重试：重新请求统计', async () => {
    h.getStats.mockRejectedValueOnce(new Error('stats down'));
    h.getStats.mockResolvedValue({
      data: { data: { stats: { total: 378, failed: 7 }, failureByAction: [{ action: 'user.delete', count: 5 }] } }
    });
    const w = await mountAudit();
    await flushPromises();
    await nextTick();
    const before = h.getStats.mock.calls.length;
    await w.find('.mk-alert--row button').trigger('click');
    await flushPromises();
    await nextTick();
    expect(h.getStats.mock.calls.length).toBeGreaterThan(before);
    expect(w.find('.mk-alert--row').exists()).toBe(false);
    w.unmount();
  });

  it('列表与统计同时失败：全页仍只有一个重试入口（列表失败态的居中重试），筛选栏红条让位', async () => {
    h.getLogs.mockRejectedValue(new Error('list down'));
    h.getStats.mockRejectedValue(new Error('stats down'));
    const w = await mountAudit();
    await flushPromises();
    await nextTick();

    // 列表失败：卡片内错误态（MkEmptyState tone=error）出现
    const empty = w.find('.mk-empty');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('审计日志加载失败');
    // 筛选栏里的红「失败统计不可用」条让位（否则同屏两个重试）
    expect(w.findAll('.mk-alert--row')).toHaveLength(0);
    // 全页「重试」类按钮只有一枚
    expect(w.findAll('button').filter((b) => /重试/.test(b.text()))).toHaveLength(1);
    w.unmount();
  });
});

/* ======================= C. AuditLogs 筛选栏条件联动 ======================= */

describe('C. AuditLogs 筛选栏：动作 / 失败动作 条件联动', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    h.getLogs.mockResolvedValue({
      data: { data: { logs: [AUDIT_ROW], attempts: [], pagination: { total: 1, page: 1, limit: 30 } } }
    });
    h.getStats.mockResolvedValue({
      data: { data: { stats: { total: 378, failed: 7 }, failureByAction: [{ action: 'user.delete', count: 5 }] } }
    });
    window.scrollTo = vi.fn();
  });

  const dims = (w: Awaited<ReturnType<typeof mountAudit>>) =>
    w.findAll('.mk-pillselect__k').map((x) => x.text());

  it('默认态只有一枚「动作」下拉，无「失败动作」', async () => {
    const w = await mountAudit();
    await nextTick();
    expect(dims(w)).toEqual(['时间范围', '状态', '动作']);
    expect(w.findAll('.mk-pillselect__k').filter((x) => x.text() === '失败动作')).toHaveLength(0);
    // 两枚同默认值的下拉不再并列：全页只有一枚「全部动作」选项源
    expect(filterOptions(w as never, '动作')[0]).toBe('全部动作');
    w.unmount();
  });

  it('状态切到「仅失败」：「动作」让位，「失败动作」出现（默认「全部失败动作」）', async () => {
    const w = await mountAudit();
    await nextTick();
    await chooseFilter(w as never, '状态', '仅失败');
    await flushPromises();
    await nextTick();
    expect(dims(w)).toEqual(['时间范围', '状态', '失败动作']);
    expect(filterOptions(w as never, '失败动作')[0]).toBe('全部失败动作');
    w.unmount();
  });

  it('状态从「仅失败」切回「全部」：失败动作下拉消失，动作下拉回归', async () => {
    const w = await mountAudit();
    await nextTick();
    await chooseFilter(w as never, '状态', '仅失败');
    await flushPromises();
    await chooseFilter(w as never, '状态', '全部');
    await flushPromises();
    await nextTick();
    expect(dims(w)).toEqual(['时间范围', '状态', '动作']);
    w.unmount();
  });

  it('aria-label 与可见维度名对应（失败动作的可访问名点明只在仅失败时可用）', () => {
    expect(AUDIT_SRC).toContain('aria-label="按动作筛选"');
    expect(AUDIT_SRC).toContain('aria-label="按失败动作筛选（状态为仅失败时可用）"');
    // 条件联动挂在状态值上（failedOnly），不是只看 failureByAction 有没有数据
    // 统计失败时下拉退化为不可用，不展示旧计数
    expect(AUDIT_SRC).toMatch(/v-if="tab === 'operation' && failedOnly && !statsError && failureByAction\.length"/);
    expect(AUDIT_SRC).toMatch(/v-if="tab === 'operation' && !failedOnly"/);
  });
});

/* ======================= D. 详情入口一致 ======================= */

describe('D. 详情入口：AuditLogs 带「详情」表头 + 行内按钮；ExecLogs 有「操作」列', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    h.getLogs.mockResolvedValue({
      data: { data: { logs: [AUDIT_ROW], attempts: [], pagination: { total: 1, page: 1, limit: 30 } } }
    });
    h.getStats.mockResolvedValue({
      data: { data: { stats: { total: 1, failed: 0 }, failureByAction: [] } }
    });
    h.reload.mockClear();
    h.fetchLogDetail.mockReset();
    h.fetchLogDetail.mockResolvedValue({ attempts: [], attemptCount: 1, maxAttempts: 1 });
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    liveLogStats.value = { total: 1, success: 1, timeout: 0, error: 0, canary: 0 };
    liveLogsLoading.value = false;
    liveLogsError.value = '';
    localStorage.clear();
    window.scrollTo = vi.fn();
  });

  it('AuditLogs：末列表头是可读的「详情」，行内按钮可展开/收起同一详情区', async () => {
    const w = await mountAudit();
    await nextTick();
    const headers = w.findAll('thead th').map((th) => th.text().trim());
    expect(headers.at(-1)).toBe('详情');
    // 表头不再是 aria-hidden 的空列
    const lastTh = w.findAll('thead th').at(-1)!;
    expect(lastTh.attributes('aria-hidden')).toBeUndefined();

    // 详情按钮在操作审计表的末列（.al-table 的 .mk-actions 里）；MkCols 的「列」触发器也是 .mk-link，故限定作用域
    const btn = w.find('.al-table .mk-actions button.mk-link');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('详情');
    expect(btn.attributes('aria-expanded')).toBe('false');
    await btn.trigger('click');
    await nextTick();
    expect(w.find(`#audit-payload-${AUDIT_ROW.id}`).exists()).toBe(true);
    expect(w.find('.al-table .mk-actions button.mk-link').text()).toBe('收起');
    expect(w.find('.al-table .mk-actions button.mk-link').attributes('aria-expanded')).toBe('true');
    w.unmount();
  });

  it('AuditLogs：行点击仍可展开（按钮只是把同一能力写出来）', async () => {
    const w = await mountAudit();
    await nextTick();
    await w.find('tr.log-tr').trigger('click');
    await nextTick();
    expect(w.find(`#audit-payload-${AUDIT_ROW.id}`).exists()).toBe(true);
    w.unmount();
  });

  it('ExecLogs：末列是「操作」表头，行内「详情」与行点击打开同一详情', async () => {
    const w = await mountExec();
    await nextTick();
    const headers = w.findAll('thead th').map((th) => th.text().trim());
    expect(headers.at(-1)).toBe('操作');

    const detailBtn = w.findAll('button.mk-link').find((b) => b.text() === '详情');
    expect(detailBtn?.exists()).toBe(true);
    expect(detailBtn!.attributes('aria-expanded')).toBe('false');

    // 点「详情」= 展开该行详情（与行点击同一落点）
    await detailBtn!.trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.find('tr.exec-detail').exists()).toBe(true);
    expect(h.fetchLogDetail).toHaveBeenCalledWith('s1');
    expect(w.findAll('button.mk-link').find((b) => b.text() === '详情')!.attributes('aria-expanded')).toBe('true');

    // 再点收起
    await w.findAll('button.mk-link').find((b) => b.text() === '详情')!.trigger('click');
    await nextTick();
    expect(w.find('tr.exec-detail').exists()).toBe(false);
    w.unmount();
  });

  it('ExecLogs：行点击仍可展开（详情列是补充入口，不替换行点击）', async () => {
    const w = await mountExec();
    await nextTick();
    await w.find('tr.exec-row').trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.find('tr.exec-detail').exists()).toBe(true);
    w.unmount();
  });

  it('详情行的 colspan 与可见列数同源（新增操作列后不串列）', () => {
    // visibleColCount = 可隐藏列中可见数 + 1（恒在的操作列）
    expect(EXEC_SRC).toMatch(/const visibleColCount = computed\(\(\) => colDefs\.length - hiddenCols\.value\.size \+ 1\)/);
    // 骨架列数与详情行 colspan 共用同一读数
    expect(EXEC_SRC).toContain(':cols="visibleColCount"');
    expect(EXEC_SRC).toContain(':colspan="visibleColCount"');
  });
});
