/**
 * 成本页评审护栏（2026-10-14 用户逐条评审 /admin/token-cost）
 *
 * 四组发现，锁三件容易被后人改回去的事：
 *  1) 「单价未配置」不得再上行内——三个表（Skill 明细 / 用户榜 / 模型榜）的成本列
 *     在未定价时一律暗灰占位「—」，原因走行 title 与页顶「调用成本」卡 hint。
 *     改前实测：KPI 主数值位被状态词占用，行内 7 处亮白「单价未配置」把占比条挤在 140px 列里。
 *  2) 趋势柱数值必须贴柱顶——改前 7 列数值全部落在列首同一水平线（实测 y 恒 364，
 *     柱高 9~149 不等），数值与柱高脱钩。现数值层覆在柱高基线上，bottom = 柱高 + 4px。
 *  3) 金额列与占比条的分隔 = 列间距 10 + 14 = 24px（改前 10px，用户读成「贴在一起」）。
 *
 * 另锁两条数值契约（无测试会红的隐性契约）：
 *  - 今日列不再整列染底（暗色下 131×194 浅蓝矩形被读成「卡住的选中态」）；
 *  - 两列排行卡的断点必须 ≥ 排行表最小内容宽（700）+ 卡内边距（28）推出的内容宽门槛，
 *    否则 1600~1753 视口会静默裁掉最右「占比」列。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import TokenCost from '../TokenCost.vue';
import { liveRefreshSeq } from '../live';
import TcRankTable from '../TcRankTable.vue';
import OvBars from '../OvBars.vue';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, '..', name), 'utf8');

/** 取某条规则块的声明体（同 card-head-grouping.test.ts 手法）；找不到返回空串 */
function block(css: string, selector: string): string {
  const pattern = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return css.match(pattern)?.[1] ?? '';
}

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

/* 一行已定价 + 一行未定价：同时覆盖「有金额」与「占位」两档 */
const skillRows = [
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
    getBySkill: vi.fn(async () => ({ data: { data: { items: skillRows } } })),
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

describe('成本页 · 未定价占位（状态词不进行内）', () => {
  it('KPI 主数值位不被「单价未配置」占用：显暗灰 — 并走 muted 档', async () => {
    const w = await mountTokenCost();
    const kpi = w.findAll('.mk-kpi').find((k) => k.find('.mk-kpi__label').text().includes('调用成本'))!;
    expect(kpi.exists()).toBe(true);
    expect(kpi.find('.mk-kpi__num').text()).toBe('—');
    expect(kpi.classes()).toContain('mk-kpi--muted');
    // 原因与动作仍在（页顶那一行轻量提示 + 可点直达）
    expect(kpi.find('.mk-kpi__hint').text()).toContain('待补 2 个模型单价');
    expect(kpi.classes()).toContain('mk-kpi--clickable');
    // 状态词不得回到数值位
    expect(kpi.find('.mk-kpi__num').text()).not.toContain('未配置');
    w.unmount();
  });

  it('Skill 明细：已定价行显金额、未定价行显暗灰 —（不再逐行复读状态词）', async () => {
    const w = await mountTokenCost();
    const heads = w.findAll('.tc-skilltable__head > span').map((s) => s.text());
    // 输入/输出（原 Prompt/Completion，2026-10-16 用户：「那就输入输出就行了，不要搞那么多」）
    expect(heads).toEqual(['Skill', '调用', 'Token 用量', '输入', '输出', '均次 Token', '成本', '占比']);
    const rows = w.findAll('.tc-skilltable__row');
    expect(rows).toHaveLength(2);
    const priced = rows[0].find('.tc-st__cost');
    expect(priced.text()).toContain('$1.50');
    expect(priced.classes()).not.toContain('tc-st__cost--none');
    const unpriced = rows[1].find('.tc-st__cost');
    expect(unpriced.text()).toBe('—');
    expect(unpriced.classes()).toContain('tc-st__cost--none');
    // 原因改由行 title 承担（占位符自身不带原因，若 title 也不说就是净丢信息）
    expect(rows[1].attributes('title')).toContain('单价未配置');
    // 拆分与派生列真的算出来了（不是空列占位）
    expect(rows[0].findAll('.tc-st__num--dim').map((c) => c.text())).toEqual(['9.5M', '500.0K', '100.0K']);
    w.unmount();
  });

  it('成本口径不占卡面，标题也不再挂公式与原因', async () => {
    const w = await mountTokenCost();
    expect(w.find('.tc-card--skill .tc-card__note').exists()).toBe(false);
    const title = w.find('.tc-card--skill .mk-card__title');
    expect(title.attributes('title')).toBeUndefined();
    // 卡头徽章仍承担可见的「未定价」状态
    expect(w.find('.tc-card--skill .mk-badge').attributes('title')).toContain('未配置单价');
    w.unmount();
  });

  it('排行表：未定价行的成本列显 — 并带暗灰档，原因在行 title', () => {
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
    const bodyRows = w.findAll('.tc-table__row');
    expect(bodyRows).toHaveLength(2);
    const priced = bodyRows[0].find('.tc-c--cost');
    expect(priced.text()).toContain('$2.00');
    expect(priced.classes()).not.toContain('tc-cost--none');
    const unpriced = bodyRows[1].find('.tc-c--cost');
    expect(unpriced.text()).toBe('—');
    expect(unpriced.classes()).toContain('tc-cost--none');
    // 原因改由行 title 承担（占位符自身不带原因，若 title 也不说就是净丢信息）
    expect(bodyRows[1].attributes('title')).toContain('单价未配置');
    // 行内文本不再出现状态词（表头「成本」之外没有任何一处）
    expect(w.find('.tc-table').text().split('单价未配置')).toHaveLength(1);
    w.unmount();
  });
});

describe('成本页 · 布局数值契约', () => {
  it('金额列与占比条的分隔 = 列间距 10 + 14 = 24px（两处同名规则）', () => {
    for (const [file, shareSel, rowSel] of [
      ['TokenCost.vue', '.tc-st__share', '.tc-skilltable__row'],
      ['TcRankTable.vue', '.tc-c--share', '.tc-table__row']
    ]) {
      const css = read(file);
      expect(block(css, shareSel), `${file} ${shareSel} 缺 14px 内衬`).toContain('padding-left: 14px');
      expect(block(css, rowSel), `${file} ${rowSel} 缺 10px 列间距`).toContain('gap: 10px');
    }
  });

  it('两列排行卡断点 ≥ 排行表最小内容宽 + 卡内边距推出的门槛（否则静默裁掉占比列）', () => {
    // 列模板在 TcRankTable，断点（.tc-ranks）在 TokenCost——两个文件各锁一半，缺一不成契约
    const tmpl = read('TcRankTable.vue')
      .match(/\.tc-table--user \.tc-table__row,[\s\S]{0,120}?grid-template-columns:\s*([^;]+);/)?.[1];
    expect(tmpl, '找不到排行表列模板（双列档）').toBeTruthy();
    // 26+140+52+46+180+96+100 = 640，+6 个 10px 间隙 = 700
    const tokens = tmpl!.replace(/,\s+/g, ',').trim().split(/\s+/);
    const need = tokens.reduce((sum, tk) => sum + Number(tk.match(/^(?:minmax\()?(\d+)px/)?.[1] ?? 0), 0)
      + (tokens.length - 1) * 10;
    expect(need).toBe(700);
    // 每卡需要 need + 表左右内衬 28 = 728 → 内容列 ≥ 1470 → 视口 ≥ 1754（内容列 = 视口 − 284）
    const vpFloor = (need + 28) * 2 + 14 + 284;
    const mq = read('TokenCost.vue').match(/@media \(max-width: (\d+)px\) \{\s*\.tc-ranks/);
    expect(mq, '找不到 .tc-ranks 单列回落断点').toBeTruthy();
    expect(Number(mq![1]) + 1).toBeGreaterThanOrEqual(vpFloor);
  });

  it('今日列不再整列染底（暗色下读成卡住的选中态）', () => {
    const css = read('OvBars.vue');
    // 语义钩子仍在（label/title 走 c.today），但不得有整列 background 规则
    expect(css).toContain("'ovbars__col--today': c.today");
    expect(css).not.toMatch(/\.ovbars__col--today[^{]*\{[^}]*background/);
  });
});

describe('OvBars · 数值贴柱顶', () => {
  it('数值层覆在柱高基线上：bottom = 该列首柱高 + 4px，且不再占列首（列首一行是缺陷本身）', () => {
    const w = mount(OvBars, {
      props: {
        cols: [
          { key: 'd1', label: '1/1', num: '10', bars: [{ pct: '100%', tone: 'blue' as const }] },
          { key: 'd2', label: '1/2', num: '2', bars: [{ pct: '20%', tone: 'blue' as const }] },
          { key: 'd3', label: '1/3', num: '0', bars: [{ pct: '3%', tone: 'blue' as const }] }
        ]
      }
    });
    const cols = w.findAll('.ovbars__col');
    const nums = cols.map((c) => c.find('.ovbars__num'));
    expect(nums[0].attributes('style')).toContain('calc(100% + 4px)');
    expect(nums[1].attributes('style')).toContain('calc(20% + 4px)');
    // 零值仍是「·」（字符串 "0" 顶掉兜底点号是历史坑）
    expect(nums[2].text()).toBe('·');
    // 结构：数值必须在柱区内的数值层里，不是列的直接子节点（后者=数值回到同一水平线）
    for (const c of cols) {
      const num = c.find('.ovbars__num');
      expect(num.element.parentElement?.classList.contains('ovbars__marker')).toBe(true);
      expect(num.element.parentElement?.parentElement?.classList.contains('ovbars__bars')).toBe(true);
    }
    w.unmount();
  });

  it('showNums=false（90 天窗）不渲染数值层，也不占顶部预留带', () => {
    const w = mount(OvBars, {
      props: {
        showNums: false,
        cols: [{ key: 'd1', label: '1/1', num: '10', bars: [{ pct: '100%', tone: 'blue' as const }] }]
      }
    });
    expect(w.find('.ovbars__num').exists()).toBe(false);
    expect(w.find('.ovbars__marker').exists()).toBe(false);
    expect(w.classes()).not.toContain('ovbars--nums');
    w.unmount();
  });
});

describe('成本页 · 失败三态（#72 P-47）', () => {
  it('刷新失败保留旧数时：显式提示「以下为上次结果」，失败数与总 Token 不落成 0', async () => {
    const { adminTokenCostApi } = await import('@/api/adminApi');
    const w = await mountTokenCost();
    expect(w.find('.tc-error').exists()).toBe(false);

    vi.mocked(adminTokenCostApi.getSummary).mockRejectedValueOnce(new Error('network down'));
    // 2026-10-23 页头刷新钮撤除：顶栏刷新经 liveRefreshSeq 广播到本页（同一入口）
    liveRefreshSeq.value += 1;
    await flushPromises();
    await nextTick();

    expect(w.find('.tc-error').exists()).toBe(true);
    expect(w.find('.tc-error').text()).toContain('上次加载结果');
    const failed = w.findAll('.mk-kpi').find((k) => k.find('.mk-kpi__label').text() === '失败调用')!;
    const tokens = w.findAll('.mk-kpi').find((k) => k.find('.mk-kpi__label').text() === '总 Token')!;
    // 旧 summary 里 failed=0，刷新失败后必须显示「—」而不是沿用 0 冒充健康
    expect(failed.find('.mk-kpi__num').text()).toBe('—');
    expect(tokens.find('.mk-kpi__num').text()).toBe('—');
    w.unmount();
  });
});
