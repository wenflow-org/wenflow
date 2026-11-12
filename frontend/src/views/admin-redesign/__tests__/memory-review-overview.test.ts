/**
 * 记忆与复习跨用户总览（MemoryReviewOverview.vue）——2026-10-12 用户拍板恢复独立页：
 * 列表态用例自原 MemoryReview（c28019d6 前版本）迁移。
 * 2026-10-17 到期时间轴分布带退役（用户「记忆与复习也不要了」）：原六档分桶/下钻/窗口用例撤除，
 * 只保留 KPI、列集与行点击语义。
 * - 既有功能不丢：用户行点击仍跳学习者详情（open-learner 判例）
 * - KPI「当前到期」阈值化：占比 <20% 且人均 <5 保持中性；达阈值才抬琥珀且 title 披露阈值
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const overview = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());
const openSubPage = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminMemoryReviewApi: { overview, detail, recompute, apply, rollback },
}));
// 落点常量取真实 store（只替换 openSubPage）：断言里写死的 'memory' 才能钉住落点映射，
// 若映射被改成别的页签，这里会红。
vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  openSubPage,
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));
const routerReplace = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ get query() { return routeQuery.value }, path: '/admin/memory-review' }),
  useRouter: () => ({ replace: routerReplace }),
}));

import MemoryReviewOverview from '../MemoryReviewOverview.vue';
import { chooseFilter, filterOption } from './filter-controls';
import { mkSelectValue } from '@/components/mk/__tests__/mkSelect';

const ROWS = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, userId: 'u1' }));

async function mountWithRows(rows: unknown[], totalsOver: Record<string, unknown> = {}) {
  overview.mockResolvedValue({
    data: {
      data: {
        totals: { users: 1, traces: rows.length, due: 1, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0, ...totalsOver },
        users: [{ userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: rows.length, due: 1, audit: null, weak: 1, avgStrength: 0.52, lastReviewedAt: new Date().toISOString() }],
      },
    },
  });
  const w = mount(MemoryReviewOverview);
  await flushPromises();
  return w;
}

/** 以给定的多用户数组挂载（覆盖默认单用户），用于搜索 / 列显隐 / 色彩等回归用例。 */
async function mountWithUsers(users: unknown[], totalsOver: Record<string, unknown> = {}) {
  overview.mockResolvedValue({
    data: {
      data: {
        totals: { users: users.length, traces: 0, due: 0, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0, ...totalsOver },
        users,
      },
    },
  });
  const w = mount(MemoryReviewOverview);
  await flushPromises();
  return w;
}

describe('MemoryReviewOverview：跨用户总览（2026-10-12 恢复，2026-10-17 分布带退役）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('用户行点击跳到学习者详情并落在「记忆与复习」页签（不再一律落概览；2026-10-18 用户走查）', async () => {
    const w = await mountWithRows(ROWS);
    await w.find('tbody tr').trigger('click');
    expect(openSubPage).toHaveBeenCalledWith('learner', 'u1', { tab: 'memory' });
  });

  it('行内「详情」钮：明面上的二级页入口（2026-10-19 用户建议，让新人知道这里有二级页）', async () => {
    const w = await mountWithRows(ROWS);
    const detail = w.findAll('tbody .mk-actions button').find((b) => b.text() === '详情');
    expect(detail, '行内应有「详情」钮').toBeTruthy();
    // 与整行点击同一落点；@click.stop 保证不冒泡重复触发（只调一次）
    await detail!.trigger('click');
    expect(openSubPage).toHaveBeenCalledTimes(1);
    expect(openSubPage).toHaveBeenCalledWith('learner', 'u1', { tab: 'memory' });
    // 动作列次序对齐学习状态列表：详情在前、重算类动作在后
    const labels = w.findAll('tbody .mk-actions button').map((b) => b.text());
    expect(labels.indexOf('详情')).toBeLessThan(labels.indexOf('重新观察'));
  });

  /** 2026-10-26：行内三个待办数字（待确认 / 归并候选 / 散键）改成按钮——确认 / 驳回 / 回滚
   *  都在「记忆调度」页签，点行只落只读的 FSRS 普查面。 */
  it('行内待办数字可点，落「记忆调度」页签；整行点击仍落「记忆与复习」', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 1, traces: 10, due: 6, usersWithAudit: 1, proposed: 2, autoApplicable: 0, ambiguous: 2, applied: 0, deleted: 0 },
        users: [{
          userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 10, due: 6,
          audit: { mode: 'review', generatedAt: new Date().toISOString(), candidates: 4, proposed: 2, autoApplicable: 0, ambiguous: 2, drops: 0, applied: 0, deleted: 0 },
          weak: 3, avgStrength: 0.52, lastReviewedAt: new Date().toISOString(), unattachedScatterKeys: 3,
        }],
      } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();
    // 列序（2026-11-09 走查图 5）：用户 / 待复习 / 需关注 / 记忆痕迹 / 记忆强度 /
    // 待合并同义词 / 未归类记忆 / 最近复习 / 操作
    const tds = w.findAll('tbody tr')[0].findAll('td');
    const manual = tds[2].findAll('button').find((b) => b.text().includes('待确认'));
    expect(manual, '待确认应是按钮').toBeTruthy();
    await manual!.trigger('click');
    expect(openSubPage).toHaveBeenLastCalledWith('learner', 'u2', { tab: 'memory-ops' });
    // 归并候选 / 散键同理
    const proposed = tds[5].find('button');
    expect(proposed.text()).toBe('2');
    await proposed.trigger('click');
    expect(openSubPage).toHaveBeenLastCalledWith('learner', 'u2', { tab: 'memory-ops' });
    const scatter = tds[6].find('button');
    expect(scatter.text()).toBe('3');
    await scatter.trigger('click');
    expect(openSubPage).toHaveBeenLastCalledWith('learner', 'u2', { tab: 'memory-ops' });
    // 整行点击仍是「记忆与复习」（只读普查）
    await w.find('tbody tr').trigger('click');
    expect(openSubPage).toHaveBeenLastCalledWith('learner', 'u2', { tab: 'memory' });
    w.unmount();
  });

  /** 2026-10-26：「需人工确认」可点 → 落到需关注快筛（同一批人） */
  it('KPI「需人工确认」可点，点中落到「需关注」快筛', async () => {
    const w = await mountWithRows(ROWS, { usersWithAudit: 1, ambiguous: 1, fragmentation: { pendingReview: 3 } });
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '需人工确认')!;
    expect(card.classes()).toContain('mk-kpi--clickable');
    await card.trigger('click');
    await nextTick();
    expect(w.find('.mk-pill--active').text()).toContain('需关注');
    expect(card.classes()).toContain('mr-kpi--on');
    // 2026-10-26：卡头「仅当前页 · 共 N 位」文案撤除（用户「我非常讨厌这种文案」），
    // 范围说明单源留在分页器 note
    // 2026-11-09 走查：note 从「筛选范围：当前页」改成带本页命中数的实话——
    // 分页器的「共 N 位用户」是后端全量，与筛选后的行数不同口径，两个数要能各自对上
    expect(w.find('.pagination-note').text()).toContain('筛选只作用本页');
    expect(w.find('.pagination-note').text()).toContain('本页命中 1 位');
    expect(w.find('.mk-pagination__total').text()).toContain('共 1 位用户');
    w.unmount();
  });

  it('分页器单位是「位用户」，每页条数默认 15（与学习组其它列表对齐）', async () => {
    const w = await mountWithRows(ROWS, { users: 120 });
    expect(w.find('.mk-pagination').text()).toContain('共 120 位用户');
    expect(mkSelectValue(w as never, '每页条数')).toBe('15');
    w.unmount();
  });

  /** P1#13：KPI「当前到期」阈值化（占痕迹 ≥20% 或人均 ≥5），达阈值抬琥珀；title 只留读数本身 */
  it('KPI「当前到期」阈值化：占比 <20% 且人均 <5 保持中性；达阈值才抬琥珀', async () => {
    // due 1 / traces 7 ≈ 14%，人均 1 → 常态积压，不着警示色
    const w = await mountWithRows(ROWS);
    const dueCard = w.findAll('.mk-kpi')[2];
    expect(dueCard.classes()).not.toContain('mk-kpi--warn');

    // due 2 / traces 7 ≈ 28.6% ≥ 20% → 抬琥珀；title 只报读数（占比），不复述阈值规则
    const w2 = await mountWithRows(ROWS, { due: 2 });
    const dueCard2 = w2.findAll('.mk-kpi')[2];
    expect(dueCard2.classes()).toContain('mk-kpi--warn');
    expect(dueCard2.attributes('title')).toContain('占全部记忆痕迹 29%');
    expect(dueCard2.attributes('title')).not.toContain('标为需关注');
  });

  /** 2026-10-12 用户走查「怎么双 kpi」：量值五卡 + 碎片率三卡两段栅格并为一条单带 */
  it('页头 KPI 并为单带：7→5 卡（归并候选 / 散键下沉到列表列）', async () => {
    const w = await mountWithRows(ROWS);
    const grids = w.findAll('.mk-kpi-grid');
    expect(grids).toHaveLength(1);
    const labels = grids[0].findAll('.mk-kpi__label').map((x) => x.text());
    /* 2026-10-23 用户「列的信息就很少，但是 kpi 信息很多」：待归并建议 / 未挂靠散键
       都能落到具体学习者，改由列表「归并候选」「散键」两列承载；页头只留列表表达不了的读数 */
    expect(labels).toEqual(['有记忆痕迹的用户', '记忆痕迹', '当前到期', '需人工确认', '措辞重复率']);
  });

  /** 2026-10-22 用户「合并了」：待审队列 = 人审档归并建议 + ambiguous + 散键清理建议
   *  （后端 memory-review.ts:64-68），与「需人工确认」是同口径的加总+加数，并排两张卡
   *  会被读成两个矛盾读数 → 合并进「需人工确认」，值取 pendingReview。 */
  it('需人工确认 = 人审待办总数（含归并建议 + 模糊候选 + 散键清理），不再单列待审队列卡', async () => {
    const w = await mountWithRows(ROWS, {
      usersWithAudit: 2,
      ambiguous: 2,
      fragmentation: { duplicateLabelRatio: 0, unattachedKeys: 0, pendingReview: 5 },
    });
    const byLabel = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label);
    const card = byLabel('需人工确认')!;
    expect(card.find('.mk-kpi__num').text()).toBe('5');
    /* 2026-11-11 困惑测试 #37：卡值（全库条数）与「需关注」筛选（当前页人数）口径不同，
       title 补上两者关系（原为 undefined）。 */
    expect(card.attributes('title')).toContain('全库待人审条数');
    expect(byLabel('待审队列')).toBeUndefined();
  });

  /** 2026-10-17 重设计：19 位有痕迹的用户里 17 位从未复习，旧的四列（需人工确认/薄弱/强度/
   *  最近复习）成片「—」，0 到期还各画一条空轨。
   *  二次调整：相邻两列各画一条比例条会读成一排重叠的条——待复习只留数字，
   *  记忆强度单独一列带条，需关注与最近复习各自成列。 */
  it('全部用户都没跑过归并观察 → 需人工确认写「未观察」，不把没观察写成 0', async () => {
    // 2026-10-23 用户「为什么包括测试的也是很多0」：测试视角 26 位用户、55 条痕迹，
    // 但归并审计投影一条都没有——0 是「没算过」，不是「很干净」。
    // 2026-11-02 评审 R67：同排其它四张都是数字，独独一张「—」会被读成取数失败；
    // 改写成「未观察」，与列表同状态列的措辞一致。
    const w = await mountWithRows(ROWS, { usersWithAudit: 0, ambiguous: 0 });
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '需人工确认')!;
    expect(card.find('.mk-kpi__num').text()).toBe('未观察');
    expect(card.find('.mk-kpi__hint').exists()).toBe(false);
    expect(card.text()).not.toContain('尚未观察');
    expect(card.text()).not.toContain('已观察');
    // 2026-11-11 困惑测试 #37：口径说明进悬停（不再是 undefined）
    expect(card.attributes('title')).toContain('全库待人审条数');
    // 没观察过 → 没有可筛的对象，卡不可点
    expect(card.classes()).not.toContain('mk-kpi--clickable');
  });

  it('无痕迹时「当前到期」只留 0，不再挂「暂无痕迹」副行', async () => {
    const w = await mountWithRows(ROWS, { traces: 0, due: 0 });
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '当前到期')!;
    expect(card.find('.mk-kpi__num').text()).toBe('0');
    expect(card.find('.mk-kpi__hint').exists()).toBe(false);
    expect(card.text()).not.toContain('暂无痕迹');
  });

  it('后端没有 fragmentation.pendingReview 时，需人工确认退回 ambiguous，不归零', async () => {
    const w = await mountWithRows(ROWS, { usersWithAudit: 1, ambiguous: 4, fragmentation: null });
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '需人工确认')!;
    expect(card.find('.mk-kpi__num').text()).toBe('4');
  });

  it('列集九列：待复习只出数字、待合并同义词/未归类记忆落到行上、全表仅强度一条比例条', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 2, traces: 14, due: 6, usersWithAudit: 1, proposed: 2, autoApplicable: 0, ambiguous: 2, applied: 0, deleted: 0, fragmentation: { duplicateLabelRatio: 0.1, unattachedKeys: 3 } },
        users: [
          { userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 4, due: 0, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null, unattachedScatterKeys: 0 },
          {
            userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 10, due: 6,
            audit: { mode: 'review', generatedAt: new Date().toISOString(), candidates: 4, proposed: 2, autoApplicable: 0, ambiguous: 2, drops: 0, applied: 0, deleted: 0 },
            weak: 3, avgStrength: 0.52, lastReviewedAt: new Date().toISOString(), unattachedScatterKeys: 3,
          },
        ],
      } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();

    /* 2026-11-01 外部评审 P1：两列表头原为内部黑话（归并候选 / 散键），改成业务可读文案。
       2026-11-09 走查（图 5）：列序按运营处理优先级重排——待复习 → 需关注 → 记忆痕迹 →
       记忆强度 → 待合并同义词 → 未归类记忆 → 最近复习（原先痕迹/待复习在最前）。 */
    expect(w.findAll('thead th').map((t) => t.text())).toEqual(['用户', '待复习', '需关注', '记忆痕迹', '记忆强度', '待合并同义词', '未归类记忆', '最近复习', '操作']);

    const trs = w.findAll('tbody tr');
    expect(trs).toHaveLength(2);
    // 待复习列不再有比例条（避免与相邻的强度条并排）
    expect(trs[1].findAll('td')[1].findAll('.mk-minibar')).toHaveLength(0);
    expect(trs[1].findAll('td')[1].text()).toBe('6');
    // 全表只有记忆强度列那一条
    expect(trs[0].findAll('.mk-minibar')).toHaveLength(0);
    expect(trs[1].findAll('.mk-minibar')).toHaveLength(1);
    /* 2026-11-09：记忆强度收口到全站原语 .mk-meter（与「记忆调度」页同一读法），
       私有 .mr__strength-pct 退役。 */
    expect(trs[1].findAll('td')[4].find('.mk-meter .mk-meter__val').text()).toBe('52%');
    // 需关注列：无事项出「无」，有事项出薄弱徽章 + 待确认按钮
    expect(trs[0].findAll('td')[2].text()).toBe('无');
    expect(trs[1].findAll('td')[2].text()).toContain('薄弱 3');
    expect(trs[1].findAll('td')[2].text()).toContain('待确认 2');
    // 记忆痕迹（总量）在两列指标之后
    expect(trs[1].findAll('td')[3].text()).toBe('10');
    // 归并候选 / 散键：逐用户读数（原来只住在 KPI 的数字）
    // 没跑过归并观察 ≠ 0 候选：两者必须分开
    expect(trs[0].findAll('td')[5].text()).toBe('未观察');
    expect(trs[1].findAll('td')[5].text()).toBe('2');
    expect(trs[0].findAll('td')[6].text()).toBe('0');
    expect(trs[1].findAll('td')[6].text()).toBe('3');
    // 列头不再复述排序语义与口径（2026-10-26）
    const ths = w.findAll('thead th');
    for (const th of ths) expect(th.attributes('title')).toBeUndefined();
    // 最近复习列独立：从未复习只出状态词
    expect(trs[0].findAll('td')[7].text()).toBe('未复习');
    w.unmount();
  });

  /** 2026-10-17 用户「参考学习组做一些 pill」：分布带退役后左组补三枚复习状态快筛，
   *  计数按当前页（服务端分页只回 limit 条，用全库数字会与本页行对不上）。 */
  it('服务端排序：列头下发 sort/order 并按回显更新卡头口径（排序在切片前生效）', async () => {
    // 回显请求里的 sort/order（真实后端行为）：界面口径必须跟随回显，而不是本地猜
    overview.mockImplementation(async (params?: { sort?: string; order?: string }) => ({
      data: {
        data: {
          totals: { users: 1, traces: 7, due: 1 },
          sort: { key: params?.sort ?? 'due', order: params?.order ?? 'desc' },
          users: [{ userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 7, due: 1, audit: null, weak: 1, avgStrength: 0.52, lastReviewedAt: null }],
        },
      },
    }));
    const w = mount(MemoryReviewOverview);
    await flushPromises();
    // 2026-11-09 走查 P2：卡头右组补齐搜索 + 列设置（与学习组其它列表同形态），不再是空白
    expect(w.find('.mk-search').exists()).toBe(true);
    expect(w.find('.mk-cols').exists()).toBe(true);
    // 2026-10-23 用户「这种文案，不要」：卡头不再复述排序/分页机制，排序状态只由列头表达
    expect(w.find('.mk-card__meta').exists()).toBe(false);

    // 记忆痕迹：首击降序
    const tracesTh = w.findAll('thead th').find((t) => t.text() === '记忆痕迹')!;
    await tracesTh.find('.mk-th__btn').trigger('click');
    await flushPromises();
    const call = overview.mock.calls.at(-1)![0];
    expect(call).toMatchObject({ sort: 'traces', order: 'desc' });
    expect(tracesTh.attributes('aria-sort')).toBe('descending');

    // 记忆强度：首击升序（最弱的在前）
    const strengthTh = w.findAll('thead th').find((t) => t.text() === '记忆强度')!;
    await strengthTh.find('.mk-th__btn').trigger('click');
    await flushPromises();
    expect(overview.mock.calls.at(-1)![0]).toMatchObject({ sort: 'strength', order: 'asc' });
    expect(strengthTh.attributes('aria-sort')).toBe('ascending');

    // 最近复习：首击也升序——运营口径是「最久没复习的在前」（与待复习「最多的在前」同一条习惯：
    // 最该关注的排头），而不是「最近复习过的在前」
    const reviewedTh = w.findAll('thead th').find((t) => t.text() === '最近复习')!;
    await reviewedTh.find('.mk-th__btn').trigger('click');
    await flushPromises();
    expect(overview.mock.calls.at(-1)![0]).toMatchObject({ sort: 'lastReviewed', order: 'asc' });
    expect(reviewedTh.attributes('aria-sort')).toBe('ascending');
    // 列头本身可点（整格热区，与 .mk-th--sortable 的光标承诺一致）：点 padding 区域也生效
    await reviewedTh.trigger('click');
    await flushPromises();
    expect(overview.mock.calls.at(-1)![0]).toMatchObject({ sort: 'lastReviewed', order: 'desc' });
    expect(reviewedTh.attributes('aria-sort')).toBe('descending');
  });

  it('复习状态快筛：有待复习 / 未复习 / 需关注 计数按当前页，点击后行集收敛，可一键显示全部', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 3, traces: 12, due: 3, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 1, applied: 0, deleted: 0 },
        users: [
          { userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 4, due: 0, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null },
          { userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 5, due: 3, audit: null, weak: 0, avgStrength: 0.62, lastReviewedAt: new Date().toISOString() },
          {
            userId: 'u3', name: '小刚', email: null, isVirtualLearner: false, traces: 3, due: 0,
            audit: { mode: 'review', generatedAt: new Date().toISOString(), candidates: 2, proposed: 1, autoApplicable: 0, ambiguous: 1, drops: 0, applied: 0, deleted: 0 },
            weak: 2, avgStrength: 0.31, lastReviewedAt: new Date().toISOString(),
          },
        ],
      } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();

    const opt = (label: string) => filterOption(w as never, '状态', label).text();
    expect(opt('全部')).toBe('全部');
    expect(opt('有待复习')).toBe('有待复习（1）');   // 小红
    expect(opt('未复习')).toBe('未复习（1）');       // 小明
    expect(opt('需关注')).toBe('需关注（1）');       // 小刚（薄弱 + 待确认）

    await chooseFilter(w as never, '状态', '有待复习');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.find('tbody').text()).toContain('小红');

    await chooseFilter(w as never, '状态', '需关注');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.find('tbody').text()).toContain('小刚');

    await chooseFilter(w as never, '状态', '全部');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(3);
    w.unmount();

    // 筛空：计数为 0 的条件仍可点，空态给「显示全部」出口（筛选只作用于当前页）
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 2, traces: 4, due: 0, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0 },
        users: [
          { userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 2, due: 0, audit: null, weak: 0, avgStrength: 0.8, lastReviewedAt: new Date().toISOString() },
          { userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 2, due: 0, audit: null, weak: 0, avgStrength: 0.7, lastReviewedAt: new Date().toISOString() },
        ],
      } },
    });
    const w2 = mount(MemoryReviewOverview);
    await flushPromises();
    await chooseFilter(w2 as never, '状态', '有待复习');
    await nextTick();
    expect(w2.findAll('tbody tr')).toHaveLength(0);
    expect(w2.find('.mk-empty').text()).toContain('没有符合条件的用户');
    // 空态不再解释「筛选只作用于当前页」这类机制，只给出口
    expect(w2.find('.mk-empty').text()).not.toContain('快速筛选只作用于当前页');
    await w2.find('.mk-empty__action').trigger('click');
    await nextTick();
    expect(w2.findAll('tbody tr')).toHaveLength(2);
    w2.unmount();
  });

  /** 2026-10-24 用户「空数据的时候，页面很奇怪，没有统一设计」：
   *  0 行时不再挂「共 0 条 · 第 1 / 1 页」的翻页器（全站另外 20 处 Pagination 都有守卫），
   *  空态带 min 吃掉卡内剩余高度（不再贴顶 + 六百像素空白）。 */
  it('0 行：不渲染分页器，空态走 min（吃掉卡内剩余高度）；有行时仍渲染分页器', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 0, traces: 0, due: 0, usersWithAudit: 0, proposed: 0, autoApplicable: 0, ambiguous: 0, applied: 0, deleted: 0 },
        users: [],
      } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();
    expect(w.find('.mk-pagination').exists()).toBe(false);
    const empty = w.find('.mk-empty');
    expect(empty.classes()).toContain('mk-empty--min');
    expect(empty.text()).toContain('暂无记忆痕迹数据');
    w.unmount();

    // 有数据时守卫不误伤：分页器照常出现（7 行 > 15/页 的窗口下仍渲染，供切页大小与计数）
    const w2 = await mountWithRows(ROWS, { users: 1 });
    expect(w2.find('.mk-pagination').exists()).toBe(true);
    w2.unmount();
  });

  /** 2026-11-09 走查 P2：需关注 / 待合并同义词 是状态列（含「无」「未观察」单字），
   *  不再右对齐（无 mk-num / mk-th--right）。
   *  2026-11-09 走查（图 5）：「左空右撞」——短指标列右对齐时表头在左、数字在右各站一边，
   *  又与相邻左对齐列挤在一起，四个短指标列（待复习 / 记忆痕迹 / 记忆强度 / 未归类记忆）
   *  一并改左对齐；全表对齐语义因此只剩「文字列左、操作列右」。 */
  it('短指标列与状态列全部左对齐：表头与数据共用一条垂直基准线', async () => {
    const w = await mountWithRows(ROWS);
    const thByText = (t: string) => w.findAll('thead th').find((x) => x.text() === t)!;
    for (const label of ['待复习', '需关注', '记忆痕迹', '记忆强度', '待合并同义词', '未归类记忆', '最近复习']) {
      const th = thByText(label);
      expect(th.classes(), `${label} 列头仍右对齐`).not.toContain('mk-th--right');
      expect(th.classes(), `${label} 列头仍挂 mk-num`).not.toContain('mk-num');
    }
    // 单元格对齐与列头一致
    const tds = w.findAll('tbody tr')[0].findAll('td');
    // 列序：用户 / 待复习 / 需关注 / 记忆痕迹 / 记忆强度 / 待合并同义词 / 未归类记忆 / 最近复习 / 操作
    for (const idx of [1, 2, 3, 4, 5, 6, 7]) {
      expect(tds[idx].classes(), `第 ${idx} 列仍右对齐`).not.toContain('mk-num');
    }
    // 只有操作列保留右对齐（动作贴右缘是全站契约）
    expect(thByText('操作').classes()).toContain('mk-th--right');
    w.unmount();
  });

  /** 2026-11-09 走查 P2：卡头补齐搜索框 + 列设置；搜索按 姓名 / 邮箱 / 短 id 客户端过滤当前页行，
   *  无命中落到「没有符合条件的用户」（不是「暂无记忆痕迹数据」）。 */
  it('卡头搜索框 + 列设置存在；搜索按 姓名 / 邮箱 / 短 id 过滤当前页行', async () => {
    const users = [
      { userId: 'u_aaa', name: '小明', email: 'ming@wenflow.local', isVirtualLearner: false, traces: 3, due: 0, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null },
      { userId: 'u_bbb', name: '小红', email: 'red@wenflow.local', isVirtualLearner: false, traces: 3, due: 0, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null },
      { userId: 'u_ccc', name: '小刚', email: 'gang@wenflow.local', isVirtualLearner: false, traces: 3, due: 0, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null },
    ];
    const w = await mountWithUsers(users, { users: 3 });
    expect(w.find('.mk-search').exists()).toBe(true);
    expect(w.find('.mk-cols').exists()).toBe(true);

    const input = w.find('.mk-search input');
    await input.setValue('小红');
    await nextTick();
    let rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('小红');

    // 邮箱匹配（大小写不敏感）
    await input.setValue('GANG@WENFLOW.LOCAL');
    await nextTick();
    rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('小刚');

    // 短 id 匹配（userId 后几位）
    await input.setValue('ccc');
    await nextTick();
    rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('小刚');

    // 无命中 → 落到「没有符合条件的用户」空态（不是整页无数据的「暂无记忆痕迹数据」）
    await input.setValue('不存在的人');
    await nextTick();
    expect(w.find('tbody').exists()).toBe(false);
    expect(w.find('.mk-empty').text()).toContain('没有符合条件的用户');
    w.unmount();
  });

  /** 2026-11-09 走查 P3：待确认 N 改成琥珀警告徽章（带底色），不再是蓝色链接，仍点达「记忆调度」页签。 */
  it('待确认 N 渲染为琥珀警告徽章（非蓝色链接），仍可点达记忆调度', async () => {
    overview.mockResolvedValue({
      data: { data: {
        totals: { users: 1, traces: 10, due: 6, usersWithAudit: 1, proposed: 2, autoApplicable: 0, ambiguous: 2, applied: 0, deleted: 0 },
        users: [{
          userId: 'u2', name: '小红', email: null, isVirtualLearner: false, traces: 10, due: 6,
          audit: { mode: 'review', generatedAt: new Date().toISOString(), candidates: 4, proposed: 2, autoApplicable: 0, ambiguous: 2, drops: 0, applied: 0, deleted: 0 },
          weak: 0, avgStrength: 0.52, lastReviewedAt: null,
        }],
      } },
    });
    const w = mount(MemoryReviewOverview);
    await flushPromises();
    // 列序（2026-11-09 走查图 5）：待复习 → 需关注 → 记忆痕迹 → 记忆强度 → …，
    // 「待确认 N」在「需关注」格（第 2 个数据列）
    const manual = w.findAll('tbody tr')[0].findAll('td')[2].find('button')!;
    expect(manual.exists()).toBe(true);
    expect(manual.text()).toContain('待确认');
    expect(manual.classes()).toContain('mk-badge');
    expect(manual.classes()).toContain('mk-badge--warn');
    expect(manual.classes()).not.toContain('mk-link');
    await manual.trigger('click');
    expect(openSubPage).toHaveBeenLastCalledWith('learner', 'u2', { tab: 'memory-ops' });
    w.unmount();
  });

  /** 2026-11-09 走查 P3 色彩语义闭环：当前到期 KPI 与待复习单元格同为琥珀系，且不再用红色。 */
  it('色彩语义闭环：当前到期 KPI 与待复习单元格同为琥珀系，无红色', async () => {
    const w = await mountWithUsers([
      { userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 4, due: 3, audit: null, weak: 0, avgStrength: null, lastReviewedAt: null },
    ], { users: 1, traces: 4, due: 3 });
    // KPI「当前到期」占比超阈值 → 琥珀警示
    const dueKpi = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '当前到期')!;
    expect(dueKpi.classes()).toContain('mk-kpi--warn');
    // 行内待复习数字：高压力档走 amber 同族
    // 「待复习」是首个指标列（列序 2026-11-09 调整后）
    const dueCell = w.findAll('tbody tr')[0].findAll('td')[1].find('.mr__due-num')!;
    expect(dueCell.classes()).toContain('mr__due-num--high');
    // 组件 scoped 样式里，高压力档与提醒档都映射到 --mk-amber，且不再出现 --mk-red-strong
    const src = readFileSync(resolve(process.cwd(), 'src/views/admin-redesign/MemoryReviewOverview.vue'), 'utf-8');
    const highRule = src.match(/\.mr__due-num--high[^{]*\{[^}]*\}/)?.[0] ?? '';
    const warnRule = src.match(/\.mr__due-num--warn[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(highRule).toContain('--mk-amber');
    expect(highRule).not.toContain('--mk-red-strong');
    expect(warnRule).toContain('--mk-amber');
    w.unmount();
  });
});
