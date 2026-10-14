/**
 * Trace 链路视图三处读数纠偏（2026-10-14 用户评审「这什么东西设计的，trace 链路」）：
 *  1. 概要卡里 Token / 估算成本 / 模型三格只在链路真有 LLM 调用时出现——网关/模拟类链路
 *     （样本常态，代码注释记 26/30）此前恒显「Token 0 · 估算成本 — · 模型 —」三个空读数，
 *     按站内「缺字段省略、不硬造」整组省略 + 一句「无 LLM 调用」说明；
 *  2. 行尾「网关 x」在格式化后与总耗时同值时不显示（同值并列＝同一数字写两遍）；
 *  3. 概要卡的失败格带口径 title（全样本失败 span / 含失败链路数 / 所选链路失败 span 三层区分）。
 * 瀑布样本来自 ./live 的 waterfallSpans，故整体 mock ./live 与 ./store，只用真实 ref 驱动。
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { TraceSpan } from '../store';

const h = vi.hoisted(() => ({
  spans: { value: [] as unknown[] },
  total: { value: 0 },
  loading: { value: false }
}));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  h.spans = ref([]);
  h.total = ref(0);
  h.loading = ref(false);
  return {
    livePromptIndex: ref({}),
    loadPromptIndex: vi.fn(async () => {}),
    fetchLogDetail: vi.fn(async () => ({ attempts: [], attemptCount: 1, maxAttempts: 1 })),
    waterfallSpans: h.spans,
    waterfallTotal: h.total,
    waterfallLoading: h.loading,
    waterfallSyncFromBoot: vi.fn(() => {}),
    waterfallLoadMore: vi.fn(async () => {}),
    waterfallFetchTrace: vi.fn(async () => {}),
    waterfallFetchSession: vi.fn(async () => {}),
    WATERFALL_MAX_SPANS: 2000
  };
});

vi.mock('../store', async () => {
  const { computed, ref } = await import('vue');
  return {
    spans: computed(() => []),
    intent: { agentFilter: '', statusFilter: '' },
    openSkillDrawer: vi.fn(),
    dataSource: ref('live')
  };
});

import TraceWaterfall from '../TraceWaterfall.vue';

function span(over: Partial<TraceSpan>): TraceSpan {
  return {
    id: 's1',
    traceId: 'tr-1',
    kind: 'call',
    agent: 'virtual-learner-epistemic-grounding',
    stage: 'Simulation',
    title: '调用',
    startMs: 0,
    durationMs: 7700,
    status: 'ok',
    detail: '',
    ...over
  };
}

/** 网关/模拟类链路：有 span、无模型、无 token（样本常态） */
const GATEWAY_ONLY: TraceSpan[] = [
  span({ id: 'a', startMs: 0, durationMs: 7700, gatewayDurMs: 7700 }),
  span({ id: 'b', startMs: 7700, durationMs: 2000, gatewayDurMs: 1200 })
];

/** 有 LLM 调用的链路 */
const WITH_LLM: TraceSpan[] = [
  span({ id: 'a', durationMs: 3000, gatewayDurMs: 3000, model: 'deepseek-v4.1-flash', promptTokens: 1200, completionTokens: 300 })
];

function mountWith(spans: TraceSpan[]) {
  h.spans.value = spans;
  h.total.value = spans.length;
  return mount(TraceWaterfall, { props: { embedded: true } });
}

describe('Trace 链路概要卡（读数带）', () => {
  it('无 LLM 调用：省略 Token / 估算成本 / 模型三格，代之以一句说明', async () => {
    const w = mountWith(GATEWAY_ONLY);
    await w.vm.$nextTick();
    const strip = w.find('.wf-summary');
    expect(strip.exists()).toBe(true);
    const text = strip.text();
    expect(text).not.toContain('Token');
    expect(text).not.toContain('估算成本');
    expect(text).not.toContain('模型');
    expect(text).not.toContain('—');
    expect(strip.find('.wf-summary__note').text()).toBe('无 LLM 调用');
    // 真实存在的量照旧
    expect(text).toContain('总耗时');
    expect(text).toContain('延迟分位');
    w.unmount();
  });

  it('有 LLM 调用：三格照旧出现（不再有说明），数值来自 span 汇总', async () => {
    const w = mountWith(WITH_LLM);
    await w.vm.$nextTick();
    const strip = w.find('.wf-summary');
    const text = strip.text();
    expect(strip.find('.wf-summary__note').exists()).toBe(false);
    expect(text).toContain('Token');
    expect(text).toContain('估算成本');
    expect(text).toContain('模型');
    expect(text).toContain('deepseek-v4.1-flash');
    expect(text).toContain('¥');   // 1200 输入 + 300 输出 → 有成本读数
    w.unmount();
  });

  it('失败格带三层口径 title（全样本 span / 含失败链路 / 所选链路）', async () => {
    const w = mountWith(GATEWAY_ONLY);
    await w.vm.$nextTick();
    const cells = w.findAll('.wf-summary__item');
    const failCell = cells.find((c) => c.text().includes('失败'));
    expect(failCell).toBeTruthy();
    const t = failCell!.attributes('title') ?? '';
    expect(t).toContain('所选链路');
    expect(t).toContain('全部样本');
    expect(t).toContain('链路数');
    w.unmount();
  });
});

describe('瀑布行行尾耗时', () => {
  it('网关耗时与总耗时同值时不显示（避免同一数字写两遍）', async () => {
    const w = mountWith(GATEWAY_ONLY);
    await w.vm.$nextTick();
    const row = w.findAll('.wf-row').find((r) => r.text().includes('7.7s'));
    expect(row).toBeTruthy();
    expect(row!.find('.wf-row__gw').exists()).toBe(false);
    expect(row!.find('.wf-row__dur').exists()).toBe(true);
    w.unmount();
  });

  it('网关耗时与总耗时不同时照旧显示（差值＝平台侧开销）', async () => {
    const w = mountWith([span({ id: 'a', durationMs: 7700, gatewayDurMs: 1200 })]);
    await w.vm.$nextTick();
    const gw = w.find('.wf-row__gw');
    expect(gw.exists()).toBe(true);
    expect(gw.text()).toContain('网关 1.2s');
    expect(gw.attributes('title')).toContain('平台侧开销');
    w.unmount();
  });
});
