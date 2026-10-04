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
    liveLogsLoading: ref(false),
    liveLogsError: ref(''),
    liveLogStats: ref(null),
    livePromptIndex: ref({}),
    liveLoading: ref(false),
    reloadLiveSpans: h.reload,
    fetchLogDetail: vi.fn(async () => ({ attempts: [], attemptCount: 1, maxAttempts: 1 })),
    loadPromptIndex: vi.fn(async () => {}),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

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
      await findBtn(w, '高级').trigger('click');
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
    const input = w.find<HTMLInputElement>('input[placeholder="Trace ID（链路 ID）"]');
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
    expect(cell.attributes('title')).toContain('传输层统计');
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
    // 2026-10-04 状态条退役：筛选徽章随条删除，「仅看测试」态改由工具栏「测试」pill 激活态承载
    const testPill = w.findAll('.mk-pill').find((b) => b.text().startsWith('测试'))!;
    expect(testPill.classes()).toContain('mk-pill--active');
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({
      agentId: 'api-gateway',
      status: 'error',
      sourceEntry: 'system-canary'
    });
    // 深链参数不被筛选→URL 回写抹掉
    expect(router.currentRoute.value.query).toMatchObject({ agent: 'api-gateway', status: 'err', test: 'only' });
  });

  it('stats.canary > 0 → 「测试 N」入口出现；点击仅看测试（sourceEntry 上服务端），再点恢复默认', async () => {
    liveLogStats.value = { total: 200, success: 190, timeout: 4, error: 6, canary: 5 };
    // only 态下入口计数 = 该查询 total（liveLogsTotal），需 > 0 按钮才保持可见（可再次点击退出）
    liveLogsTotal.value = 5;
    const { w, router } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    const btn = findBtn(w, '测试');
    expect(btn.text()).toContain('5');
    await btn.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sourceEntry: 'system-canary' });
    expect(router.currentRoute.value.query.test).toBe('only');
    await findBtn(w, '测试').trigger('click');
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

/* ---------- P1#24（2026-10-02 人类可读性）：错误摘要条窗口联动 + Top 归因 chip；
   2026-10-04 外部评审拍板：撤「只看失败」次按钮（与失败 pill 同源），时间/节点筛选提上主行，
   时间档补 15m/1h 自定义窗 ---------- */
describe('P1#24：错误摘要条（窗口随 timeRange / Top chip 下钻 / 失败 pill 单源）', () => {
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

  it('stats error>0 → 摘要条出现；默认窗口文案「今天」（不再恒写「近 24h」）', async () => {
    liveLogStats.value = { total: 100, success: 90, timeout: 2, error: 8, canary: 0 };
    liveLogsTotal.value = 2;
    liveLogsFiltered.value = [
      errSpan(1, { errorCategory: 'provider_timeout', agent: 'skill:a' }),
      errSpan(2, { errorCategory: 'rate_limit', agent: 'skill:b' }),
    ];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.text()).toContain('今天捕获 8 条错误级日志');
    expect(w.text()).not.toContain('近 24h');
  });

  it('切「近 7 天」→ 摘要条文案随查询窗口联动（时间筛选已提上卡头主行，无需开高级）', async () => {
    liveLogStats.value = { total: 700, success: 690, timeout: 2, error: 8, canary: 0 };
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [errSpan(1)];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.find('select[aria-label="时间范围筛选"]').setValue('week');
    await flushPromises();
    expect(w.text()).toContain('近 7 天捕获 8 条错误级日志');
  });

  it('小时级自定义窗（15m/1h）：不传 timeRange（后端枚举会 400），换算 startTime 下发', async () => {
    liveLogStats.value = { total: 5, success: 4, timeout: 0, error: 1, canary: 0 };
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [errSpan(1)];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    await w.find('select[aria-label="时间范围筛选"]').setValue('1h');
    await flushPromises();
    const q = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.timeRange).toBeUndefined();
    expect(typeof q.startTime).toBe('string');
    expect(new Date(q.startTime as string).getTime()).toBeLessThan(Date.now());
    // 起点取整到分钟：同档重复触发签名稳定，不绕过 applyServerQuery 去重
    await w.find('select[aria-label="时间范围筛选"]').setValue('today');
    await flushPromises();
    await w.find('select[aria-label="时间范围筛选"]').setValue('1h');
    await flushPromises();
    const q2 = h.reload.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(q.startTime).toBe(q2.startTime);
  });

  it('Top 错误类别 chip：点击即设 errorCategory 服务端重查（title 披露口径），再点取消', async () => {
    liveLogStats.value = { total: 100, success: 90, timeout: 0, error: 10, canary: 0 };
    liveLogsTotal.value = 3;
    liveLogsFiltered.value = [
      errSpan(1, { errorCategory: 'provider_timeout', agent: 'skill:a' }),
      errSpan(2, { errorCategory: 'provider_timeout', agent: 'skill:b' }),
      errSpan(3, { errorCategory: 'auth', agent: 'skill:a' }),
    ];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    const chip = w.findAll('.exec-err-chip').find((c) => c.text().includes('provider_timeout'))!;
    expect(chip).toBeTruthy();
    expect(chip.attributes('title')).toContain('当前页失败行聚合');
    await chip.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ errorCategory: 'provider_timeout' });
    await w.findAll('.exec-err-chip').find((c) => c.text().includes('provider_timeout'))!.trigger('click');
    await flushPromises();
    expect((h.reload.mock.calls.at(-1)![0] as Record<string, unknown>).errorCategory).toBeUndefined();
  });

  it('Top Skill chip：点击设 agentFilter（服务端 agentId 参数，watch 触发重查）', async () => {
    liveLogStats.value = { total: 100, success: 90, timeout: 0, error: 10, canary: 0 };
    liveLogsTotal.value = 2;
    liveLogsFiltered.value = [
      errSpan(1, { errorCategory: 'provider_timeout', agent: 'skill:a' }),
      errSpan(2, { errorCategory: 'provider_timeout', agent: 'skill:a' }),
    ];
    const { w } = await mountExecAt('/admin/execution-logs');
    await nextTick();
    const chip = w.findAll('.exec-err-chip').find((c) => c.text().includes('skill:a'))!;
    expect(chip).toBeTruthy();
    await chip.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ agentId: 'skill:a' });
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
});

/* ---------- 2026-10-04 状态条退役：页头 .mk-status 整块下线，读数迁页首 KPI 卡带、
   「测试」入口迁日志卡头工具栏 pill（判例 buckets-band.test.ts 结构断言 + 护栏） ---------- */
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

  it('护栏：页头无 .mk-status；读数迁 KPI 卡带（成功率按数值着色 / P50 / P99），「测试」pill 迁工具栏可点', async () => {
    liveLogStats.value = { total: 200, success: 190, timeout: 4, error: 6, canary: 5 };
    liveLogsTotal.value = 378;
    liveLogsFiltered.value = [fakeSpan(1), fakeSpan(2)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    // 状态条整块下线
    expect(w.find('.mk-status').exists()).toBe(false);
    // KPI 卡带三张：成功率（95% ≥ 90 是健康读数，有失败也不标红——错误信号由告警条单源承载）
    const kpis = w.findAll('.mk-kpi');
    expect(kpis.length).toBe(3);
    expect(kpis[0].text()).toContain('成功率');
    expect(kpis[0].text()).toContain('95%');
    expect(kpis[0].classes()).not.toContain('mk-kpi--bad');
    expect(kpis[1].text()).toContain('P50');
    expect(kpis[2].text()).toContain('P99');
    // 「测试」入口迁日志卡头工具栏 pill：计数常驻（canary 5），点击仅看测试上服务端
    const testPill = w.findAll('.mk-pill').find((b) => b.text().startsWith('测试'))!;
    expect(testPill.text()).toContain('5');
    await testPill.trigger('click');
    await flushPromises();
    expect(h.reload.mock.calls.at(-1)![0]).toMatchObject({ sourceEntry: 'system-canary' });
  });

  it('成功率 KPI 着色只跟数值走：<90% 标红，与是否有失败日志无关（外部评审解耦拍板）', async () => {
    // 89% < 90 → 红（即使本样本无失败行）；90% → 不红
    liveLogStats.value = { total: 100, success: 89, timeout: 0, error: 11, canary: 0 };
    liveLogsTotal.value = 2;
    liveLogsFiltered.value = [fakeSpan(1), fakeSpan(2)];
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.findAll('.mk-kpi')[0].classes()).toContain('mk-kpi--bad');
  });

  it('无日志不显数值：KPI 带随 logs.length 隐藏（原状态条同语义）；「测试」pill 仍常驻', async () => {
    const w = await mountExecAt('/admin/execution-logs');
    await nextTick();
    expect(w.find('.mk-status').exists()).toBe(false);
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    // 测试入口常驻语义保留：计数为 0 也保持可点（否则切过去后失去切回入口）
    expect(w.findAll('.mk-pill').find((b) => b.text().startsWith('测试'))).toBeTruthy();
  });
});
