/**
 * ExecLogs 传统分页（方案 A）交互测试：
 * 翻页请求参数（page+1 整页替换）/ 每页条数变更回第 1 页 / 筛选变更重置回第 1 页 /
 * 自动刷新保留当前页 / 总数展示
 * （./live 与 ./store 整体 mock；reloadLiveSpans 用真实 ref 驱动，DOM 断言页码状态）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ExecLogs from '../ExecLogs.vue';
import type { TraceSpan } from '../store';
import {
  liveLogsPage,
  liveLogsPageSize,
  liveLogsTotal,
  liveLogsFiltered,
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
  const { ref } = await import('vue');
  return {
    spans: ref([]),
    dataSource: ref('live'),
    isLive: ref(true),
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
  const w = mount(ExecLogs);
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
      await findBtn(w, '高级筛选').trigger('click');
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
    const input = w.find<HTMLInputElement>('.log-trace');
    await input.setValue('tr:abc');
    await input.trigger('keydown.enter');
    await flushPromises();
    const last = h.reload.mock.calls.at(-1)!;
    expect(last[0]).toMatchObject({ traceId: 'tr:abc' });
    expect(liveLogsPage.value).toBe(1);
  });
});
