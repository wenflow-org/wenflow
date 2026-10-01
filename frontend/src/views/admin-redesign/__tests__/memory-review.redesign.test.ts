/**
 * 记忆与复习页 redesign 结构契约（newui 原型 renderMemory 1963-2045 移植）：
 * - 到期时间轴：.stageband 六档（零值段跳过、图例恒六行）+ .sbl 色块/名/数
 * - 记忆强度分布：.histo 五桶（hval/hbar/hcap），高度按最大桶比例、零桶 6px 起步；
 *   无 retrievability（FSRS 状态缺失）的条目不进分母
 * - 窗口口径：adminMemoryTracesApi.list（limit 200、includeVirtual 随作用域开关）
 * - 既有功能不丢：用户行点击 → openSubPage('learner', userId)
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
const routerReplace = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ get query() { return routeQuery.value }, path: '/admin/memory-review' }),
  useRouter: () => ({ replace: routerReplace }),
}));

import MemoryReview from '../MemoryReview.vue';

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
const row = (over: Partial<{ id: string; extractionCount: number; dueAt: string | null; retrievability: number | null }>) => ({
  id: 't0',
  userId: 'u1',
  conceptKey: 'k0',
  label: null,
  extractionCount: 1,
  dueAt: null,
  retrievability: null,
  ...over,
});

// 覆盖六档边界与强度桶边界：0.2 归 20–39%、0.8 归 80–99%；+4 天归「3天后」档；从未提取（t7）不进队列
const ROWS = [
  row({ id: 't1', dueAt: at(-1), extractionCount: 2, retrievability: 0.19 }), // 已逾期 · 0–19%
  row({ id: 't2', dueAt: at(0), retrievability: 0.2 }),                       // 今天 · 20–39%
  row({ id: 't3', dueAt: at(0), retrievability: null }),                      // 今天 · 无强度 → 不进分母
  row({ id: 't4', dueAt: at(1), retrievability: 0.5 }),                       // 明天 · 40–59%
  row({ id: 't5', dueAt: at(2), retrievability: 0.8 }),                       // 2天后 · 80–99%
  row({ id: 't6', dueAt: at(4), retrievability: 0.9 }),                       // 3–4 天后档 · 80–99%
  row({ id: 't7', extractionCount: 0, dueAt: null, retrievability: null }),   // 从未提取 → 不进队列
];

async function mountWithRows(rows: unknown[]) {
  overview.mockResolvedValue({
    data: {
      data: {
        totals: { users: 1, traces: rows.length, due: 1, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0 },
        users: [{ userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: rows.length, due: 1, audit: null }],
      },
    },
  });
  traceList.mockResolvedValue({ data: { data: { total: rows.length, rows } } });
  const w = mount(MemoryReview);
  await flushPromises();
  return w;
}

describe('MemoryReview redesign：到期时间轴 + 记忆强度分布', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('到期带：零值段跳过、图例恒六行（色块+名+数），分桶按 dueAt 日差', async () => {
    const w = await mountWithRows(ROWS);

    // 桶计数：已逾期 1 · 今天 2 · 明天 1 · 2天后 1 · 3天后(3–4 天) 1 · 5天后 0
    const legend = w.findAll('.stageband__legend .sbl');
    expect(legend.map((el) => el.find('.sbl__name').text())).toEqual(['已逾期', '今天', '明天', '2天后', '3天后', '5天后']);
    expect(legend.map((el) => el.find('.sbl__n').text())).toEqual(['1', '2', '1', '1', '1', '0']);

    // 5天后 = 0 → 段跳过，其余 5 段渲染（原型 distBand 口径）
    const segments = w.findAll('.stageband > span');
    expect(segments).toHaveLength(5);
    expect(segments[0].attributes('title')).toBe('已逾期 · 1');
  });

  it('强度直方图：五桶、无强度条目不进分母、高度按最大桶比例（零桶 6px）', async () => {
    const w = await mountWithRows(ROWS);

    const cols = w.findAll('.histo .hcol');
    expect(cols).toHaveLength(5);
    expect(cols.map((el) => el.find('.hval').text())).toEqual(['1', '1', '1', '0', '2']);
    expect(cols.map((el) => el.find('.hcap').text())).toEqual(['0–19%', '20–39%', '40–59%', '60–79%', '80–99%']);

    // maxB = 2 → 高度 50/50/50/6(零桶起步)/100
    const bars = cols.map((el) => el.find('.hbar').element as HTMLElement);
    expect(bars.map((el) => el.style.height)).toEqual(['50px', '50px', '50px', '6px', '100px']);

    // 平均 = (0.19+0.2+0.5+0.8+0.9)/5 = 52%；有强度 5 / 队列 6（t3 无强度、t7 未进队列）
    expect(w.text()).toContain('平均 52%');
    expect(w.text()).toContain('有强度 5/6');
  });

  it('窗口口径：list 带 limit 200 与作用域开关；窗口为空时整块隐藏', async () => {
    const w = await mountWithRows(ROWS);
    expect(traceList).toHaveBeenCalledWith({ limit: 200, includeVirtual: false });

    // 切「包含虚拟学习者」→ 窗口随作用域重拉
    await w.find('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect(traceList).toHaveBeenLastCalledWith({ limit: 200, includeVirtual: true });

    // 空窗口 → 到期带/直方图整块隐藏，不留空卡
    const empty = await mountWithRows([]);
    expect(empty.find('.stageband').exists()).toBe(false);
    expect(empty.find('.histo').exists()).toBe(false);
  });

  it('既有功能不丢：用户行点击仍跳学习者页（open-learner 判例）', async () => {
    const w = await mountWithRows(ROWS);
    await w.find('tbody tr').trigger('click');
    expect(openSubPage).toHaveBeenCalledWith('learner', 'u1');
  });
});
