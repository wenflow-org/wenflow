/**
 * 记忆与复习跨用户总览（MemoryReviewOverview.vue）——2026-10-12 用户拍板恢复独立页：
 * 列表态用例自原 MemoryReview（c28019d6 前版本）迁移，组件逻辑逐字找回：
 * - 到期时间轴 MkDistBand：六档图例（零值段不渲染分段）、分桶按 dueAt 日差
 * - 贴表到期带可点下钻：点「已逾期」→ 只剩窗口内该档有到期痕迹的学习者；再点取消
 * - 窗口口径：adminMemoryTracesApi.list 带 limit 200 与作用域开关；窗口为空整块隐藏
 * - 既有功能不丢：用户行点击仍跳学习者详情（open-learner 判例）
 * - KPI「当前到期」阈值化：占比 <20% 且人均 <5 保持中性；达阈值才抬琥珀且 title 披露阈值
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const overview = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());
const traceList = vi.hoisted(() => vi.fn());
const openSubPage = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminMemoryReviewApi: { overview, detail, recompute, apply, rollback },
  adminMemoryTracesApi: { list: traceList },
}));
vi.mock('../store', () => ({ openSubPage }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));
const routerReplace = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ get query() { return routeQuery.value }, path: '/admin/memory-review' }),
  useRouter: () => ({ replace: routerReplace }),
}));

import MemoryReviewOverview from '../MemoryReviewOverview.vue';

// 到期日以「测试运行当天 0 点」为锚：页面用真实 new Date() 分桶，同一运行日内口径一致
const midnight = (() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
})();
const at = (dayOffset: number) => {
  const d = new Date(midnight);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};
const row = (over: Partial<{ id: string; userId: string; extractionCount: number; dueAt: string | null; retrievability: number | null }>) => ({
  id: 't0',
  userId: 'u1',
  conceptKey: 'k0',
  label: null,
  extractionCount: 1,
  dueAt: null,
  retrievability: null,
  ...over,
});

// 覆盖六档边界：-1 已逾期 · 0 今天 ×2 · 1 明天 · 2 2天后 · 4 3天后档 · 从未提取（t7）不进队列
const ROWS = [
  row({ id: 't1', dueAt: at(-1), extractionCount: 2, retrievability: 0.19 }),
  row({ id: 't2', dueAt: at(0), retrievability: 0.2 }),
  row({ id: 't3', dueAt: at(0), retrievability: null }),                      // 无强度 → 不进分母
  row({ id: 't4', dueAt: at(1), retrievability: 0.5 }),
  row({ id: 't5', dueAt: at(2), retrievability: 0.8 }),
  row({ id: 't6', dueAt: at(4), retrievability: 0.9 }),
  row({ id: 't7', extractionCount: 0, dueAt: null, retrievability: null }),   // 从未提取 → 不进队列
];

async function mountWithRows(rows: unknown[], totalsOver: Record<string, unknown> = {}) {
  overview.mockResolvedValue({
    data: {
      data: {
        totals: { users: 1, traces: rows.length, due: 1, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0, ...totalsOver },
        users: [{ userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: rows.length, due: 1, audit: null, weak: 1, avgStrength: 0.52, lastReviewedAt: new Date().toISOString() }],
      },
    },
  });
  traceList.mockResolvedValue({ data: { data: { total: rows.length, rows } } });
  const w = mount(MemoryReviewOverview);
  await flushPromises();
  return w;
}

describe('MemoryReviewOverview：到期时间轴（2026-10-12 恢复跨用户总览）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('到期带：零值段跳过、图例恒六行（色块+名+数），分桶按 dueAt 日差', async () => {
    const w = await mountWithRows(ROWS);

    // 桶计数：已逾期 1 · 今天 2 · 明天 1 · 2天后 1 · 3天后(3–4 天) 1 · 5天后 0
    const legend = w.findAll('.stageband__legend .sbl');
    expect(legend.map((el) => el.find('.sbl__name').text())).toEqual(['已逾期', '今天', '明天', '2天后', '3天后', '5天后']);
    expect(legend.map((el) => el.find('.sbl__n').text())).toEqual(['1', '2', '1', '1', '1', '0']);

    // 5天后 = 0 → 段不渲染，其余 5 段渲染（原型 distBand 口径；组件 v-if，隐藏段不留 DOM）
    const segments = w.findAll('.mk-distband__seg');
    expect(segments).toHaveLength(5);
    expect(segments[0].attributes('title')).toBe('已逾期：1 个 · 点击只看');
  });

  it('贴表到期带可点下钻：点「已逾期」→ 只剩窗口内该档有到期痕迹的学习者；再点取消', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 2, traces: 2, due: 2, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0 },
        users: [
          { userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 1, due: 1, audit: null, weak: 1, avgStrength: 0.19, lastReviewedAt: new Date().toISOString() },
          { userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 1, due: 1, audit: null, weak: 0, avgStrength: 0.5, lastReviewedAt: new Date().toISOString() },
        ],
      } },
    });
    traceList.mockResolvedValue({
      data: { data: { total: 2, rows: [
        row({ id: 't1', userId: 'u1', dueAt: at(-1), extractionCount: 2, retrievability: 0.19 }),
        row({ id: 't8', userId: 'u2', dueAt: at(1), retrievability: 0.5 }),
      ] } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();
    expect(w.findAll('tbody tr')).toHaveLength(2);

    const overdueBtn = w.findAll('.stageband__legend .sbl').find((b) => b.text().includes('已逾期'))!;
    await overdueBtn.trigger('click');
    await flushPromises();
    const rowsText = w.findAll('tbody tr').map((r) => r.text());
    expect(rowsText).toHaveLength(1);
    expect(rowsText[0]).toContain('小明');
    expect(rowsText[0]).not.toContain('小红');
    expect(w.text()).toContain('已筛 1 位');

    await overdueBtn.trigger('click');
    await flushPromises();
    expect(w.findAll('tbody tr')).toHaveLength(2);
    w.unmount();
  });

  it('窗口口径：list 带 limit 200 与作用域开关；窗口为空时整块隐藏', async () => {
    const w = await mountWithRows(ROWS);
    expect(traceList).toHaveBeenCalledWith({ limit: 200, includeVirtual: false });

    // 切「含测试」→ 窗口随作用域重拉；还原共享口径（整组状态是模块级，别泄漏给后续用例）
    const scopePills = w.findAll('.ds-toggle .mk-pill');
    await scopePills.find((p) => p.text() === '测试')!.trigger('click');
    await flushPromises();
    expect(traceList).toHaveBeenLastCalledWith({ limit: 200, includeVirtual: true, testOnly: true });
    await scopePills.find((p) => p.text() === '真实')!.trigger('click');
    await flushPromises();

    const empty = await mountWithRows([]);
    expect(empty.find('.stageband').exists()).toBe(false);
  });

  it('既有功能不丢：用户行点击仍跳学习者详情（测试视角下透传 includeTest，真实口径第三参为 undefined）', async () => {
    const w = await mountWithRows(ROWS);
    await w.find('tbody tr').trigger('click');
    expect(openSubPage).toHaveBeenCalledWith('learner', 'u1', undefined);
  });

  /** P1#13：KPI「当前到期」阈值化（占痕迹 ≥20% 或人均 ≥5），阈值写进 title */
  it('KPI「当前到期」阈值化：占比 <20% 且人均 <5 保持中性；达阈值才抬琥珀且 title 披露阈值', async () => {
    // due 1 / traces 7 ≈ 14%，人均 1 → 常态积压，不着警示色
    const w = await mountWithRows(ROWS);
    const dueCard = w.findAll('.mk-kpi')[2];
    expect(dueCard.classes()).not.toContain('mk-kpi--warn');

    // due 2 / traces 7 ≈ 28.6% ≥ 20% → 抬琥珀，title 披露阈值
    const w2 = await mountWithRows(ROWS, { due: 2 });
    const dueCard2 = w2.findAll('.mk-kpi')[2];
    expect(dueCard2.classes()).toContain('mk-kpi--warn');
    expect(dueCard2.attributes('title')).toContain('标为需关注');
    expect(dueCard2.attributes('title')).toContain('达到 20%');
  });
});
