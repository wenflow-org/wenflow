/**
 * 成本分析页走查护栏（2026-11-09 用户逐图走查图 7）。
 *
 * 锁四类容易被后人改回去的事：
 *  1) 金额精度统一（formatUsd）：不再 2/4/6 位小数混排、不再逐行重复 ≈ $ 前缀；
 *     币种与 ≈ 上提到表头（预估成本 (USD)），单元格只放纯数字。
 *  2) 按 Skill 成本明细默认按成本降序，且三个数值列表头可点切换（aria-sort 同步）。
 *  3) 趋势柱图补参考网格线（gridlines 兜底 Y 轴刻度感）。
 *  4) 占比条百分比槽固定宽度，上下行微型进度条垂直对齐。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import TokenCost from '../TokenCost.vue';
import TcRankTable from '../TcRankTable.vue';
import OvBars from '../OvBars.vue';
import { formatUsd } from '../costFormat';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, '..', name), 'utf8');

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

const bySkill = [
  { key: 'teaching-turn', display: 'teaching-turn', calls: 100, tokens: 10_000_000, promptTokens: 9_500_000, completionTokens: 500_000, failed: 1, usd: 1.5, pricingKnown: true, pricedCalls: 100, callsMissingPricing: 0 },
  { key: 'adaptive-guidance-copy', display: 'adaptive-guidance-copy', calls: 40, tokens: 2_000_000, promptTokens: 1_900_000, completionTokens: 100_000, failed: 0, usd: null, pricingKnown: false, pricedCalls: 0, callsMissingPricing: 40 }
];

vi.mock('@/api/adminApi', () => ({
  adminTokenCostApi: {
    getSummary: vi.fn(async () => ({
      data: {
        pricingStatus: { missingPricingModels: ['m-a', 'm-b'] },
        data: {
          days: 7,
          includeTest: false,
          totals: { tokens: 12_000_000, promptTokens: 11_400_000, completionTokens: 600_000, calls: 140, failed: 0, usd: null, pricingKnown: false, pricedCalls: 0, callsMissingPricing: 140 },
          trend: []
        }
      }
    })),
    getBySkill: vi.fn(async () => ({ data: { data: { items: bySkill } } })),
    getByUser: vi.fn(async () => ({ data: { data: { items: [] } } })),
    getByModel: vi.fn(async () => ({ data: { data: { items: [] } } }))
  },
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearningContentApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true)
}));

async function mountTokenCost() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/token-cost');
  await router.isReady();
  const w = mount(TokenCost, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  return w;
}

describe('成本页 · 金额精度统一（图 7）', () => {
  it('formatUsd 不再出现 6 位小数，固定 4 位、极小额显 <0.0001', () => {
    expect(formatUsd(2.59)).toBe('2.5900');
    expect(formatUsd(0.3692)).toBe('0.3692');
    expect(formatUsd(0.001965)).toBe('0.0020');
    expect(formatUsd(0.00003)).toBe('<0.0001');
    expect(formatUsd(null)).toBe('0.0000');
    expect(formatUsd(0)).toBe('0.0000');
    expect(formatUsd(0.5)).not.toMatch(/0\.00{3,}\d/); // 不会是 0.500000
  });

  it('按 Skill 成本明细：表头带 (USD)，单元格不再含 ≈ 或 $ 前缀', async () => {
    const w = await mountTokenCost();
    const costHead = w.findAll('.tc-skilltable__head > span').map((s) => s.text()).find((t) => t.includes('成本'))!;
    expect(costHead).toContain('预估成本 (USD)');
    const priced = w.findAll('.tc-skilltable__row')[0].find('.tc-st__cost');
    expect(priced.text()).toBe('1.5000');
    expect(priced.text()).not.toContain('$');
    expect(priced.text()).not.toContain('≈');
    w.unmount();
  });

  it('排行表：表头带 (USD)，定价行单元格只放纯数字', () => {
    const w = mount(TcRankTable, {
      props: {
        variant: 'user',
        totalTokens: 100,
        items: [
          { key: 'u1', display: 'u1', name: '甲', tokens: 60, calls: 3, failed: 0, usd: 2, pricedCalls: 3, callsMissingPricing: 0 },
          { key: 'u2', display: 'u2', name: '乙', tokens: 40, calls: 2, failed: 0, usd: null, pricedCalls: 0, callsMissingPricing: 2 }
        ]
      }
    });
    const costHead = w.find('.tc-table__head .tc-c--cost').text();
    expect(costHead).toContain('预估成本 (USD)');
    expect(w.findAll('.tc-table__row')[0].find('.tc-c--cost').text()).toBe('2.0000');
    w.unmount();
  });
});

describe('成本页 · 按 Skill 成本明细默认成本降序 + 表头可点（图 7）', () => {
  function costHeader(w: Awaited<ReturnType<typeof mountTokenCost>>) {
    return w.findAll('.tc-skilltable__head .tc-th--sortable').find((h) => h.text().includes('成本'))!;
  }
  it('默认按成本降序：预估金额行排在未定价行之前，成本表头 aria-sort=descending', async () => {
    const w = await mountTokenCost();
    expect(costHeader(w).attributes('aria-sort')).toBe('descending');
    const rows = w.findAll('.tc-skilltable__row');
    expect(rows[0].find('.tc-st__cost').text()).toBe('1.5000');
    expect(rows[1].find('.tc-st__cost').text()).toBe('—');
    w.unmount();
  });
  it('点成本表头切到升序；点调用次数列表头后成本表头 aria-sort 回到 none', async () => {
    const w = await mountTokenCost();
    await costHeader(w).trigger('click');
    await nextTick();
    expect(costHeader(w).attributes('aria-sort')).toBe('ascending');
    const callsHeader = w.findAll('.tc-skilltable__head .tc-th--sortable').find((h) => h.text().includes('调用次数'))!;
    await callsHeader.trigger('click');
    await nextTick();
    expect(callsHeader.attributes('aria-sort')).toBe('descending');
    expect(costHeader(w).attributes('aria-sort')).toBe('none');
    w.unmount();
  });
});

describe('成本页 · 趋势图参考网格线（图 7）', () => {
  it('gridlines>0 渲染对应数量的虚线；默认（无 prop）不渲染', () => {
    const cols = [
      { key: 'a', label: 'a', title: '', bars: [{ pct: '100%', tone: 'blue' as const }] },
      { key: 'b', label: 'b', title: '', bars: [{ pct: '40%', tone: 'blue' as const }] }
    ];
    const withLines = mount(OvBars, { props: { cols, gridlines: 4, barWidth: 20 } });
    expect(withLines.findAll('.ovbars__gridline')).toHaveLength(4);
    expect(withLines.find('.ovbars__grid').exists()).toBe(true);
    const without = mount(OvBars, { props: { cols, barWidth: 20 } });
    expect(without.find('.ovbars__grid').exists()).toBe(false);
    withLines.unmount();
    without.unmount();
  });
});

describe('成本页 · 底部呼吸位（图 7 最下方排行卡不被截断）', () => {
  it('页根在全站 48px 底留白之外再补 16px，最后一张卡不贴视口底边', () => {
    const src = read('TokenCost.vue');
    expect(src).toContain('class="mk-page tc-page"');
    expect(src).toMatch(/\.tc-page\s*\{[^}]*padding-bottom:\s*calc\(var\(--mk-page-pad-b\)\s*\+\s*16px\)/);
  });
});

describe('成本页 · 占比条百分比槽固定宽度（图 7）', () => {
  it('排行表占比列的数字槽为固定 44px，微型进度条上下对齐', () => {
    const w = mount(TcRankTable, {
      props: {
        variant: 'model',
        totalTokens: 100,
        items: [
          { key: 'm1', display: 'm1', tokens: 100, calls: 5, failed: 0, usd: 1, pricedCalls: 5, callsMissingPricing: 0 },
          { key: 'm2', display: 'm2', tokens: 1, calls: 1, failed: 0, usd: 0.5, pricedCalls: 1, callsMissingPricing: 0 }
        ]
      }
    });
    // 数字槽列宽写在 scoped CSS 里（非内联 style），按源码契约锁住固定 44px
    const css = read('TcRankTable.vue');
    expect(css).toMatch(/\.tc-c--share\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*44px/);
    expect(w.find('.tc-share__num').exists()).toBe(true);
    w.unmount();
  });
});
