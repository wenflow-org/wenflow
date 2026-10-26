/**
 * ExecLogs 传统分页（方案 A）交互测试：
 * 翻页请求参数（page+1 整页替换）/ 每页条数变更回第 1 页 / 筛选变更重置回第 1 页 /
 * 自动刷新保留当前页 / 总数展示
 * （./live 与 ./store 整体 mock；reloadLiveSpans 用真实 ref 驱动，DOM 断言页码状态）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import ExecLogs from '../ExecLogs.vue';
import type { TraceSpan } from '../store';
import {
  liveLogsPage,
  liveLogsPageSize,
  liveLogsTotal,
  liveLogsFiltered,
  liveLogStats,
  liveLogsRowsMerged,
  liveLogsLoading,
} from '../live';

const h = vi.hoisted(() => ({
  reload: vi.fn()
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
    reloadLiveSpans: h.reload,
    fetchLogDetail: vi.fn(async () => ({ attempts: [], attemptCount: 1, maxAttempts: 1 })),
    loadPromptIndex: vi.fn(async () => {}),
    // Trace 页签（TraceWaterfall）数据源：失败状态跨页签同源用例需要它挂载
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
    // 成本页共享筛选(金额条依赖;plain reactive 对象即可)
    tokenCostFilters: reactive({ days: 7, includeTest: false }),
    intent: { agentFilter: '', statusFilter: '' },
    openTrace: vi.fn(),
    openSession: vi.fn(),
    openSkillDrawer: vi.fn(),
    clearInvestigation: vi.fn(),
    // 节点筛选下拉数据源（2026-09-27 扩为注册表全集）：本测试不关注，给空映射
    liveSkillStatsMap: ref({}),
  };
});

function fakeSpan(i: number): TraceSpan {
  return { id: `s${i}`, traceId: `tr:${i}`, agent: 'a1', stage: 'a1', ts: Date.now(), title: 't', status: 'ok', kind: 'call', startMs: 0, durationMs: 10, detail: '' };
}

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text().includes(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

/** 「按 ID 定位」钮（2026-10-26：弹层只剩 Trace ID / 会话 ID 两个精确定位项，
    节点与时间档已提上主行）：按文本开头精确认这颗 */
function findFilterBtn(wrapper: ReturnType<typeof mount>) {
  const b = wrapper.findAll('button').find((x) => x.text().trim().startsWith('按 ID 定位'));
  if (!b) throw new Error('button not found: 按 ID 定位');
  return b;
}

async function mountExec() {
  // 合并页统一约定：?tab= 深链（可寻址），测试与真实应用一致提供 router
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

describe('ExecLogs 传统分页（方案 A）', () => {
  beforeEach(() => {
    h.reload.mockClear();
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    window.scrollTo = vi.fn();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首屏查询 page=1（reloadLiveSpans 缺省页码）', async () => {
    await mountExec();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(liveLogsPage.value).toBe(1);
  });

  it('总数展示 + 页码显示：筛选口径 total 378 → 「共 378 条」+「第 X / 13 页」', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1), fakeSpan(2)];
    const w = await mountExec();
    await nextTick();
    expect(w.text()).toContain('共 378 条');
    expect(w.text()).toContain('第 1 / 13 页');
  });

  it('翻页：请求 page+1（整页替换而非追加）', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)?.[1]).toBe(2);
    expect(liveLogsPage.value).toBe(2);
    await nextTick();
    expect(w.text()).toContain('第 2 / 13 页');
  });

  it('翻页后滚动回顶部（window.scrollTo 被调用）', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('每页条数变更：liveLogsPageSize 更新 + 回第 1 页重查', async () => {
    liveLogsPage.value = 2;
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    await w.find('.mk-pagination__size').setValue('50');
    expect(liveLogsPageSize.value).toBe(50);
    expect(liveLogsPage.value).toBe(1);
    expect(h.reload).toHaveBeenCalledTimes(2);
  });

  it('筛选（状态 pill）变更：服务端 status 参数 + 重置回第 1 页', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    expect(liveLogsPage.value).toBe(2);
    await w.findAll('.mk-pill').find((x) => x.text() === '失败')!.trigger('click');
    await flushPromises();
    const last = h.reload.mock.calls.at(-1)!;
    expect(last[0]).toMatchObject({ status: 'error' });
    expect(last[1]).toBeUndefined();
    expect(liveLogsPage.value).toBe(1);
  });

  it('自动刷新保留当前页：第 2 页上等 10s → 重查参数 page=2（不再重置回第 1 页）', async () => {
    vi.useFakeTimers();
    try {
      liveLogsTotal.value = 378;
      liveLogsFiltered.value = [fakeSpan(1)];
      const w = await mountExec();
      await nextTick();
      await findBtn(w, '下一页').trigger('click');
      await flushPromises();
      expect(liveLogsPage.value).toBe(2);
      await findFilterBtn(w).trigger('click');
      await w.find('input[type="checkbox"]').setValue(true);
      await vi.advanceTimersByTime(10000);
      await flushPromises();
      expect(h.reload.mock.calls.at(-1)?.[1]).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('traceId 直达（回车）触发重查且回第 1 页', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    // Trace ID 收进「按 ID 定位」弹层（v-show 常驻 DOM，jsdom 直接可寻址）
    const input = w.find<HTMLInputElement>('input[aria-label="链路 ID"]');
    await input.setValue('tr:abc');
    await input.trigger('keydown.enter');
    await flushPromises();
    const last = h.reload.mock.calls.at(-1)!;
    expect(last[0]).toMatchObject({ traceId: 'tr:abc' });
    expect(liveLogsPage.value).toBe(1);
  });

  it('P2 Tokens 列（列设置开启）：有传输层统计 → 展示「输入 x / 输出 y」实际值（tooltip 不暴露表名）', async () => {
    localStorage.setItem('wf_exec_hidden_cols_v2', '[]') // 开启全部列(含 tokens)
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [
      { ...fakeSpan(1), promptTokens: 860, completionTokens: 204 }
    ];
    const w = await mountExec();
    await nextTick();
    const cell = w.find('.exec-tok');
    expect(cell.find('.exec-tok__num').text()).toBe('1,064');
    expect(cell.find('.mk-cell-sub').text()).toBe('输入 860 · 输出 204');
    expect(cell.attributes('title')).toContain('网关记录');
    expect(cell.attributes('title')).not.toContain('agent_call_logs');
  });

  it('P2 Tokens 列（列设置开启）：无 token 数据 → 「未统计」+ tooltip 说明（不再与 0 混淆）', async () => {
    localStorage.setItem('wf_exec_hidden_cols_v2', '[]')
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    const cell = w.find('.exec-tok');
    expect(cell.find('.mk-na').text()).toBe('未统计');
    expect(cell.attributes('title')).toContain('未记录 token 用量');
  });

  it('服务端排序：点「耗时」表头 → 按 durationMs 重查并回第 1 页；再点切升序', async () => {
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    liveLogsPage.value = 3;
    h.reload.mockClear();
    const th = w.findAll('th.mk-th--sortable').find((t) => t.text().includes('耗时'))!;
    expect(th.attributes('aria-sort')).toBe('none'); // 默认按时间排序
    await th.find('button').trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sort: 'durationMs', order: 'desc' });
    expect(liveLogsPage.value).toBe(1); // 排序变更回第 1 页
    expect(th.attributes('aria-sort')).toBe('descending');
    await th.find('button').trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sort: 'durationMs', order: 'asc' });
    expect(th.attributes('aria-sort')).toBe('ascending');
  });
});

/* ---------- P0 回归：测试日志筛选上移服务端 + 筛选↔URL 双向同步 ---------- */
describe('P0：testFilter 服务端化（修「只滤当前页」）与 URL 同步', () => {
  beforeEach(() => {
    h.reload.mockClear();
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    liveLogStats.value = null;
    window.scrollTo = vi.fn();
    localStorage.clear();
  });

  async function mountExecAt(url: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push(url);
    await router.isReady();
    const w = mount(ExecLogs, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it('深链 ?agent=&status=err&test=only → 服务端查询带 agentId/status/sourceEntry（页码与筛选口径一致）', async () => {
    liveLogsTotal.value = 5;
    const { w, router } = await mountExecAt('/admin/execution-logs?agent=api-gateway&status=err&test=only');
    await nextTick();
    // 「仅看测试」态由工具栏 pill 激活态承载
    const testPill = w.findAll('.mk-pill').find((b) => b.text().startsWith('仅看测试'))!;
    expect(testPill.classes()).toContain('mk-pill--active');
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({
      agentId: 'api-gateway',
      status: 'error',
      sourceEntry: 'system-canary'
    });
    // 深链参数不被筛选→URL 回写抹掉
    expect(router.currentRoute.value.query).toMatchObject({ agent: 'api-gateway', status: 'err', test: 'only' });
  });

  it('stats.canary > 0 → 「仅看测试 N」入口出现；点击仅看测试（sourceEntry 上服务端），再点恢复默认', async () => {
    liveLogStats.value = { total: 200, success: 190, timeout: 4, error: 6, canary: 5 };
    // only 态下入口计数 = 该查询 total（liveLogsTotal），需 > 0 按钮才保持可见（可再次点击退出）
    liveLogsTotal.value = 5;
    const { w, router } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    const btn = findBtn(w, '仅看测试');
    expect(btn.text()).toContain('5');
    await btn.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sourceEntry: 'system-canary' });
    expect(router.currentRoute.value.query.test).toBe('only');
    await findBtn(w, '仅看测试').trigger('click');
    await flushPromises();
    expect((h.reload.mock.calls.at(-1)![0] as Record<string, unknown>).sourceEntry).toBeUndefined();
    expect(router.currentRoute.value.query.test).toBeUndefined();
  });

  it('状态筛选进 URL：点「失败」pill → ?status=err（刷新/分享可还原的故障视图）', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const { w, router } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.findAll('.mk-pill').find((x) => x.text() === '失败')!.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ status: 'error' });
    expect(router.currentRoute.value.query.status).toBe('err');
  });
});

/* ---------- P1#24（2026-10-02 人类可读性）：时间/节点筛选提上主行，时间档补 15m/1h 自定义窗；
   2026-10-04 外部评审拍板：撤「只看失败」次按钮（与失败 pill 同源）；
   2026-10-11 用户拍板：错误摘要条（红条 + Top 归因 chip）整体退役，失败分布走健康中心 ---------- */
describe('P1#24：执行日志筛选（15m/1h 自定义窗 / 失败 pill 单源 / 摘要条已退役）', () => {
  beforeEach(() => {
    h.reload.mockClear();
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    liveLogStats.value = null;
    window.scrollTo = vi.fn();
    localStorage.clear();
  });

  function errSpan(i: number, over: Partial<TraceSpan> = {}): TraceSpan {
    return { ...fakeSpan(i), status: 'err', title: `boom ${i}`, ...over };
  }

  async function mountExecAt(url: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push(url);
    await router.isReady();
    const w = mount(ExecLogs, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it('错误摘要条已退役：有失败也不渲染红条与归因 chip', async () => {
    liveLogStats.value = { total: 100, success: 90, timeout: 2, error: 8, canary: 0 };
    liveLogsTotal.value = 2;
    liveLogsFiltered.value = [
      errSpan(1, { errorCategory: 'provider_timeout', agent: 'skill:a' }),
      errSpan(2, { errorCategory: 'rate_limit', agent: 'skill:b' }),
    ];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.find('.exec-alert').exists()).toBe(false);
    expect(w.findAll('.exec-err-chip').length).toBe(0);
  });

  it('小时级自定义窗（15m/1h）：不传 timeRange（后端枚举会 400），换算 startTime 下发', async () => {
    liveLogStats.value = { total: 5, success: 4, timeout: 0, error: 1, canary: 0 };
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [errSpan(1)];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.find('select[aria-label="时间范围"]').setValue('1h');
    await flushPromises();
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.timeRange).toBeUndefined();
    expect(typeof q.startTime).toBe('string');
    expect(new Date(q.startTime as string).getTime()).toBeLessThan(Date.now());
    // 起点取整到分钟：同档重复触发签名稳定，不绕过 applyServerQuery 去重
    await w.find('select[aria-label="时间范围"]').setValue('today');
    await flushPromises();
    await w.find('select[aria-label="时间范围"]').setValue('1h');
    await flushPromises();
    const q2 = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.startTime).toBe(q2.startTime);
  });

  it('「只看失败」次按钮已撤（与失败 pill 同源重复）：失败 pill 承担 status=err 过滤，再点恢复', async () => {
    liveLogStats.value = { total: 100, success: 90, timeout: 0, error: 10, canary: 0 };
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [errSpan(1)];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.findAll('button').some((b) => b.text().includes('只看失败'))).toBe(false);
    const failPill = w.findAll('.mk-pills .mk-pill').find((p) => p.text().startsWith('失败'))!;
    expect(failPill).toBeTruthy();
    await failPill.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ status: 'error' });
    await w.findAll('.mk-pills .mk-pill').find((p) => p.text().startsWith('失败'))!.trigger('click');
    await flushPromises();
    expect((h.reload.mock.calls.at(-1)![0] as Record<string, unknown>).status).toBeUndefined();
  });

  it('自定义时间段：始末换算 startTime/endTime 下发（不传 timeRange，后端枚举会 400）', async () => {
    liveLogsTotal.value = 1;
    const { w, router } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.find('select[aria-label="时间范围"]').setValue('custom');
    await flushPromises();
    // 切入自定义：按上一档（默认 today）回填开始输入，结束留空
    const start = w.find('input[aria-label="开始时间"]');
    const end = w.find('input[aria-label="结束时间"]');
    expect(start.exists()).toBe(true);
    expect(end.exists()).toBe(true);
    await start.setValue('2026-10-01T09:00');
    await end.setValue('2026-10-02T18:30');
    await end.trigger('change');
    await flushPromises();
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.timeRange).toBeUndefined();
    expect(typeof q.startTime).toBe('string');
    expect(typeof q.endTime).toBe('string');
    // 本地 09:00 → ISO 无时区漂移（parse 后回到同一本地时刻）
    const back = new Date(q.startTime as string);
    expect(back.getHours()).toBe(9);
    expect(back.getDate()).toBe(1);
    // URL 同步：range=custom + from/to
    expect(router.currentRoute.value.query.range).toBe('custom');
    expect(router.currentRoute.value.query.from).toBe('2026-10-01T09:00');
    expect(router.currentRoute.value.query.to).toBe('2026-10-02T18:30');
    w.unmount();
  });

  it('自定义时间段：开始晚于结束 = 矛盾区间，行内报错且不下发查询', async () => {
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.find('select[aria-label="时间范围"]').setValue('custom');
    await flushPromises();
    const start = w.find('input[aria-label="开始时间"]');
    const end = w.find('input[aria-label="结束时间"]');
    await start.setValue('2026-10-05T10:00');
    await end.setValue('2026-10-01T10:00');
    await end.trigger('change');
    await flushPromises();
    expect(w.text()).toContain('开始时间需早于结束时间');
    // 矛盾区间不应把「开始晚于结束」这一对下发：沿用上一次已生效查询（只有开始、无结束）
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.endTime).toBeUndefined();
    expect(q.startTime).toBe(new Date('2026-10-05T10:00').toISOString());
    w.unmount();
  });

  it('深链 ?range=custom&from&to 落位（刷新 / 分享可还原始末）', async () => {
    const { w } = await mountExecAt('/admin/execution-logs?range=custom&from=2026-10-01T09:00&to=2026-10-02T18:30');
    await flushPromises();
    expect((w.find('input[aria-label="开始时间"]').element as HTMLInputElement).value).toBe('2026-10-01T09:00');
    expect((w.find('input[aria-label="结束时间"]').element as HTMLInputElement).value).toBe('2026-10-02T18:30');
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.timeRange).toBeUndefined();
    expect(typeof q.startTime).toBe('string');
    expect(typeof q.endTime).toBe('string');
    w.unmount();
  });
});

/* ---------- 页首读数带（2026-10-26 由 4 张 KPI 卡改为 MkStatStrip 一行三格；
   失败数只在卡头「失败」pill 角标报一次） ---------- */
describe('2026-10-04 状态条退役（ExecLogs）', () => {
  beforeEach(() => {
    h.reload.mockClear();
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    liveLogStats.value = null;
    window.scrollTo = vi.fn();
    localStorage.clear();
  });

  async function mountExecAt(url: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push(url);
    await router.isReady();
    const w = mount(ExecLogs, { global: { plugins: [router] } });
    await flushPromises();
    return w;
  }

  it('护栏：页头无 .mk-status；读数带一行三格（成功率 / P50 / P99），「仅看测试」pill 在工具栏', async () => {
    liveLogStats.value = { total: 200, success: 190, timeout: 4, error: 6, canary: 5 };
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1), fakeSpan(2)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.find('.mk-status').exists()).toBe(false);
    // 读数带：失败数不占格子（卡头「失败」pill 角标单源）
    const stats = w.findAll('.mk-stat');
    expect(stats.map((s) => s.find('.mk-stat__label').text())).toEqual(['成功率', '耗时 P50', '耗时 P99']);
    expect(stats[0].text()).toContain('95%');
    expect(stats[0].classes()).not.toContain('mk-stat--bad');
    const testPill = w.findAll('.mk-pill').find((b) => b.text().startsWith('仅看测试'))!;
    expect(testPill.text()).toContain('5');
    await testPill.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sourceEntry: 'system-canary' });
  });

  it('成功率着色只跟数值走：<90% 标红，与是否有失败日志无关', async () => {
    liveLogStats.value = { total: 100, success: 89, timeout: 0, error: 11, canary: 0 };
    liveLogsTotal.value = 2;
    liveLogsFiltered.value = [fakeSpan(1), fakeSpan(2)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.findAll('.mk-stat')[0].classes()).toContain('mk-stat--bad');
  });

  it('无日志不显数值：读数带随 logs.length 隐藏；「仅看测试」pill 仍常驻', async () => {
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.find('.mk-status').exists()).toBe(false);
    expect(w.find('.mk-stat-strip').exists()).toBe(false);
    expect(w.findAll('.mk-pill').find((b) => b.text().startsWith('仅看测试'))).toBeTruthy();
  });
});

/* ---------- 批次 1 修复合集（EG7 加载反馈 / EG17 高级计数 / D19 合并口径） ---------- */
describe('批次 1：EG7 / EG17 / D19', () => {
  beforeEach(() => {
    h.reload.mockClear();
    liveLogsPage.value = 1;
    liveLogsPageSize.value = 30;
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    liveLogsRowsMerged.value = 0;
    liveLogStats.value = null;
    window.scrollTo = vi.fn();
    localStorage.clear();
  });

  async function mountExecAt(url: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push(url);
    await router.isReady();
    const w = mount(ExecLogs, { global: { plugins: [router] } });
    await flushPromises();
    return w;
  }

  it('EG7：有数据时重查（loading）→ 「更新中」角标 + 表格降透明；无数据首载不显示', async () => {
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.find('.exec-updating').exists()).toBe(false);
    liveLogsLoading.value = true;
    await nextTick();
    expect(w.find('.exec-updating').text()).toContain('更新中');
    expect(w.find('.exec-table-refreshing').exists()).toBe(true);
    liveLogsLoading.value = false;
    await nextTick();
    expect(w.find('.exec-updating').exists()).toBe(false);
  });

  it('EG17：sessionId 生效时「筛选」钮带计数徽章（收起也不丢状态）', async () => {
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExecAt('/admin/execution-logs?session=sess-xyz');
    await nextTick();
    const adv = findFilterBtn(w);
    expect(adv.find('.mk-pill__count').text()).toBe('1');
  });

  it('页码器只报记录数（单位「条记录」），表头与列菜单不再挂合并口径说明', async () => {
    liveLogsTotal.value = 30;
    liveLogsFiltered.value = [fakeSpan(1)];
    liveLogsRowsMerged.value = 2;
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    // 页码器旁边不再出现讲系统怎么拼数据的句子；单位自身说清数的是记录
    expect(w.find('.pagination-note').exists()).toBe(false);
    expect(w.find('.mk-pagination__total').text()).toContain('共 30 条记录');
    const traceTh = w.findAll('th').find((th) => th.text().trim() === 'Trace')!;
    expect(traceTh.attributes('title')).toBeUndefined();
    await findBtn(w, '列').trigger('click');
    await nextTick();
    const item = w.findAll('.mk-cols__item').find((x) => x.text().includes('Trace'))!;
    expect(item.attributes('title')).toBeUndefined();
  });

  it('空态只给一个出口：窄时间窗 → 「查看全部时间」（只动时间范围，不清筛选）', async () => {
    liveLogsTotal.value = 0;
    liveLogsFiltered.value = [];
    const w = await mountExecAt('/admin/execution-logs?range=today&agent=a1');
    await nextTick();
    const btn = w.find('.mk-empty__action');
    expect(btn.text()).toBe('查看全部时间');
    await btn.trigger('click');
    await flushPromises();
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.timeRange).toBe('all');
    // 筛选（节点）不被这个动作清掉
    expect(q.agentId).toBe('a1');
  });

  it('首载骨架：无行时占满卡片剩余高度，并留出分页位（避免卡底大片空白）', async () => {
    liveLogsLoading.value = true;
    liveLogsFiltered.value = [];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    const skel = w.find('.exec-skel');
    expect(skel.exists()).toBe(true);
    expect(skel.find('.skl-card').exists()).toBe(true);
    expect(skel.find('.exec-skel__foot').exists()).toBe(true);
    // 骨架期分页器不渲染真实页码（占位由 .exec-skel__foot 承担）
    expect(w.find('.mk-pagination').exists()).toBe(false);
    liveLogsLoading.value = false;
  });

  it('失败状态跨页签同源：日志页签的「失败」= Trace 页签的「仅失败」，切页签不丢也不各持一套', async () => {
    liveLogsTotal.value = 10;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExecAt('/admin/execution-logs?status=err');
    await nextTick();
    await w.findAll('.tab').find((t) => t.text() === 'Trace 链路')!.trigger('click');
    await flushPromises();
    const traceFailPill = w.findAll('.mk-pill').find((b) => b.text().startsWith('仅失败'))!;
    expect(traceFailPill.classes()).toContain('mk-pill--active');
    // 在 Trace 侧关掉「仅失败」→ 日志页签的 status 筛选一并清掉
    await traceFailPill.trigger('click');
    await flushPromises();
    await w.findAll('.tab').find((t) => t.text() === '日志')!.trigger('click');
    await flushPromises();
    expect((h.reload.mock.calls.at(-1)![0] as Record<string, unknown>).status).toBeUndefined();
  });

  it('列菜单不再逐条给字段解释；类型列默认可见（合并行的来源线索）', async () => {
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await findBtn(w, '列').trigger('click');
    await nextTick();
    const items = w.findAll('.mk-cols__item');
    expect(items.map((i) => i.attributes('title'))).toEqual(items.map(() => undefined));
    // 类型列默认显示；模型 / 输入输出仍默认隐藏
    const kindItem = items.find((i) => i.text() === '类型')!;
    expect((kindItem.find('input').element as HTMLInputElement).checked).toBe(true);
    expect((items.find((i) => i.text() === '模型')!.find('input').element as HTMLInputElement).checked).toBe(false);
  });
});
