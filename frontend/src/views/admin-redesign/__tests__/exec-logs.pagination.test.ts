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
    clearInvestigation: vi.fn()
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
    localStorage.setItem('wf_exec_hidden_cols', '[]') // 开启全部列(含 tokens)
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [
      { ...fakeSpan(1), promptTokens: 860, completionTokens: 204 }
    ];
    const w = await mountExec();
    await nextTick();
    const cell = w.find('.exec-tokens');
    expect(cell.text()).toBe('输入 860 · 输出 204');
    expect(cell.attributes('title')).toContain('传输层统计');
    expect(cell.attributes('title')).not.toContain('agent_call_logs');
    expect(cell.text()).not.toBe('未统计');
  });

  it('P2 Tokens 列（列设置开启）：无 token 数据 → 「未统计」+ tooltip 说明（不再与 0 混淆）', async () => {
    localStorage.setItem('wf_exec_hidden_cols', '[]')
    liveLogsTotal.value = 1;
    liveLogsFiltered.value = [fakeSpan(1)];
    const w = await mountExec();
    await nextTick();
    const cell = w.find('.exec-tokens');
    expect(cell.text()).toBe('未统计');
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
    expect(w.text()).toContain('仅看测试');
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
