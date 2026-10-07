/**
 * R7 概念本体治理批 · adminui 域：MemoryReview 页出口 + 碎片率 KPI（任务书验收用例）
 * - 三组建议列表（归并 / 需人工看 / 散键清理）渲染：每条带 归并目标/证据/置信度，操作 = 确认 / 驳回
 * - 批量确认（破坏性操作）：二次确认弹层列明将迁移哪些表；apply 收到三组确认列表
 * - 碎片率 KPI 行：重复 label 比率 / 未挂靠散键 / 待审队列（MkKpi 家法 hint+title）；加载/空/缺失态显 '—'
 * - 驳回走 POST reject（三组各自的主键）
 * - 已执行历史（mode=apply 审计）一个入口可见：卡头开关 + alias 式归并凭据渲染
 *
 * 接口形状假设（outlet 路由并行开发未落地，见 adminApi.ts 注释）：本套测试 mock API 层，
 * 钉的是前端契约（调用参数与渲染），不依赖后端实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const overview = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());
const candidates = vi.hoisted(() => vi.fn());
const traceList = vi.hoisted(() => vi.fn());
const openSubPage = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminMemoryReviewApi: { overview, detail, recompute, apply, reject, rollback, candidates },
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

import MemoryReview from '../MemoryReview.vue';
import { askConfirm } from '../useConfirm';

const USER_ROW = {
  userId: 'u1', name: '小明', email: null, isVirtualLearner: false, traces: 6, due: 1,
  audit: { mode: 'observe', generatedAt: '2026-10-01T08:00:00.000Z', candidates: 5, proposed: 1, autoApplicable: 1, ambiguous: 1, drops: 1, applied: 0, deleted: 0 },
  weak: 0, avgStrength: 0.6, lastReviewedAt: '2026-10-01T08:00:00.000Z',
};

const overviewResponse = (totalsOver: Record<string, unknown> = {}) => ({
  data: {
    data: {
      totals: { users: 1, traces: 6, due: 1, usersWithAudit: 1, proposed: 1, autoApplicable: 1, ambiguous: 1, applied: 0, deleted: 0, ...totalsOver },
      users: [USER_ROW],
    },
  },
});

/** 三组建议齐全的明细夹具：1 归并建议（可自动）+ 1 需人工看对 + 1 散键清理 */
const DETAIL_FULL = () => ({
  user: { name: '小明' },
  summary: { traces: 6, due: 1, duplicatedFamilies: 0, duplicatedTraces: 0, neverExtracted: 0, withFsrsState: 4 },
  reviewPlan: null,
  appliedMerges: { rollbackable: [], rolledBack: [], legacyWindowOnly: [] },
  appliedAliasMerges: { rollbackable: [], rolledBack: [], legacyWindowOnly: [] },
  duplicatedFamilies: [],
  duePreview: [],
  audit: {
    mode: 'observe',
    generatedAt: '2026-10-01T08:00:00.000Z',
    stats: { candidates: 5, proposed: 1, autoApplicable: 1, ambiguous: 1, applied: 0, deleted: 0 },
    proposals: [
      { canonical: 'k-canonical', aliases: ['k-alias'], confidence: 0.92, lexicalSimilarity: 0.8, autoApplicable: true, rationale: '同一动作的不同说法' },
    ],
    ambiguous: [{ a: 'k-target', b: 'k-source', reason: '词面相似度低于阈值（语义远距）' }],
    dropCandidates: [{ conceptKey: 'k-stray', reason: '从未提取也从未被引用' }],
  },
});

async function mountPage(detailBody: Record<string, unknown> = DETAIL_FULL(), totalsOver: Record<string, unknown> = {}) {
  overview.mockResolvedValue(overviewResponse(totalsOver));
  detail.mockResolvedValue({ data: { data: detailBody } });
  traceList.mockResolvedValue({ data: { data: { total: 0, rows: [] } } });
  const w = mount(MemoryReview);
  await flushPromises();
  return w;
}

async function openDetailOf(w: ReturnType<typeof mount>) {
  await w.findAll('button').find((b) => b.text() === '明细')!.trigger('click');
  await flushPromises();
}

describe('MemoryReview R7 页出口：三组建议列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染三组建议：归并（目标/证据/置信度）、需人工看、散键清理，各带 确认/驳回 操作位', async () => {
    const w = await mountPage();
    await openDetailOf(w);
    const detailRoot = w.find('.mr__detail');
    const text = detailRoot.text();

    // 归并建议：目标 + 证据（别名 · 理由）+ 置信度
    expect(text).toContain('k-canonical');
    expect(text).toContain('k-alias');
    expect(text).toContain('同一动作的不同说法');
    expect(text).toContain('92%');
    // 需人工看对 + 散键清理两组都有行，且每组都有 确认/驳回 按钮
    expect(text).toContain('k-target');
    expect(text).toContain('k-source');
    expect(text).toContain('k-stray');
    const actionButtons = detailRoot.findAll('button').map((b) => b.text());
    expect(actionButtons.filter((t) => t === '确认').length).toBe(3);
    expect(actionButtons.filter((t) => t === '驳回').length).toBe(3);
    // 审计队列补「散键清理」格（CC-2：drops 计数此前从不渲染）
    expect(text).toContain('散键清理');
  });

  it('三组建议全空 → 各组空态文案，不留死表格', async () => {
    const w = await mountPage({
      ...DETAIL_FULL(),
      audit: { ...DETAIL_FULL().audit as Record<string, unknown>, proposals: [], ambiguous: [], dropCandidates: [] },
    });
    await openDetailOf(w);
    const text = w.find('.mr__detail').text();
    expect(text).toContain('本次没有达到把握度阈值的归并建议。');
    expect(text).toContain('没有待人工确认项。');
    expect(text).toContain('没有待清理的散键。');
  });

  it('驳回：三组各自的驳回都过确认弹层（非危险档）并按各自主键调用 POST reject', async () => {
    const w = await mountPage();
    await openDetailOf(w);
    const detailRoot = w.find('.mr__detail');

    // 归并建议驳回
    const mergeReject = detailRoot.findAll('button').find((b) => b.text() === '驳回')!;
    await mergeReject.trigger('click');
    await flushPromises();
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: '驳回建议', danger: false }));
    expect(reject).toHaveBeenCalledWith('u1', { canonicals: ['k-canonical'] });

    // 需人工看驳回（a/b 对）
    const ambiguousReject = detailRoot.findAll('button')
      .filter((b) => b.text() === '驳回')[1];
    await ambiguousReject.trigger('click');
    await flushPromises();
    expect(reject).toHaveBeenCalledWith('u1', { ambiguous: [{ a: 'k-target', b: 'k-source' }] });

    // 散键清理驳回
    const dropReject = detailRoot.findAll('button').filter((b) => b.text() === '驳回')[2];
    await dropReject.trigger('click');
    await flushPromises();
    expect(reject).toHaveBeenCalledWith('u1', { drops: ['k-stray'] });
  });

  it('单条确认（散键清理）：确认弹层列明迁移表并调用 apply', async () => {
    const w = await mountPage();
    await openDetailOf(w);
    const dropConfirm = w.find('.mr__detail').findAll('button').find((b) => b.text() === '确认' && b.attributes('title')?.includes('清理'))!;
    await dropConfirm.trigger('click');
    await flushPromises();
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '执行概念归并',
      danger: true,
      message: expect.stringContaining('将迁移以下按「用户 × 概念键」键控的表'),
    }));
    expect(apply).toHaveBeenCalledWith('u1', [], { includeNeedsReview: false, drops: ['k-stray'] });
  });
});

describe('MemoryReview R7：批量确认调用 API（任务书 D）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('跨三组勾选 → 执行选中：确认弹层列明迁移的表（memory_traces / learner_evidence / learner_projections / misconception_ledger）', async () => {
    const w = await mountPage();
    await openDetailOf(w);

    // 可自动归并默认勾选；再勾上 需人工看对 与 散键清理
    const boxes = w.findAll('.mr__detail input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true);
    await boxes[1].trigger('change');
    await boxes[2].trigger('change');
    await flushPromises();

    const bulkBtn = w.findAll('button').find((b) => b.text().startsWith('执行选中'))!;
    expect(bulkBtn.text()).toBe('执行选中（3）');
    await bulkBtn.trigger('click');
    await flushPromises();

    // 二次确认弹层（危险档）必须列明将迁移哪些表
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '执行概念归并',
      danger: true,
    }));
    const message = vi.mocked(askConfirm).mock.calls.at(-1)![0].message as string;
    for (const table of ['memory_traces', 'learner_evidence', 'learner_projections', 'misconception_ledger']) {
      expect(message).toContain(table);
    }
    expect(message).toContain('人工确认对 1 条');
    expect(message).toContain('散键清理 1 条');

    // apply 收到三组确认列表（含需人工看对与散键）
    expect(apply).toHaveBeenCalledWith('u1', ['k-canonical'], {
      includeNeedsReview: true,
      ambiguous: [{ a: 'k-target', b: 'k-source' }],
      drops: ['k-stray'],
    });
  });

  it('确认弹层取消 → 不调用 apply', async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    const w = await mountPage();
    await openDetailOf(w);
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('MemoryReview R7：碎片率 KPI 行', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染三卡读数（比率 / 散键数 / 队列深度），MkKpi 家法：hint 短句 + title 长释', async () => {
    const w = await mountPage(DETAIL_FULL(), { fragmentation: { duplicateLabelRatio: 0.32, unattachedKeys: 7, pendingReview: 5 } });
    const cards = w.findAll('.mk-kpi');
    const labels = cards.map((c) => c.find('.mk-kpi__label').text().trim());
    expect(labels.slice(-3)).toEqual(['重复 label 比率', '未挂靠散键', '待审队列']);
    const fragCards = cards.slice(-3);
    expect(fragCards[0].find('.mk-kpi__num').text()).toBe('32%');
    expect(fragCards[0].find('.mk-kpi__hint').text()).toContain('措辞重复的痕迹占比');
    expect(fragCards[0].attributes('title')).toContain('≥20%');
    expect(fragCards[1].find('.mk-kpi__num').text()).toBe('7');
    expect(fragCards[1].find('.mk-kpi__hint').text()).toContain('解析不到 KC 本体的键');
    expect(fragCards[2].find('.mk-kpi__num').text()).toBe('5');
    expect(fragCards[2].find('.mk-kpi__hint').text()).toContain('人审队列中的建议数');
    // 深口径进 title 悬停（家法第二段）
    expect(fragCards[2].attributes('title')).toContain('不会自动执行');
  });

  it('空态：后端未返回碎片率字段（outlet 未部署）→ 值显 — +「指标未取到」，不把缺失当 0', async () => {
    const w = await mountPage(DETAIL_FULL(), {});
    const fragCards = w.findAll('.mk-kpi').slice(-3);
    expect(fragCards.map((c) => c.find('.mk-kpi__num').text())).toEqual(['—', '—', '—']);
    expect(fragCards[0].find('.mk-kpi__hint').text()).toBe('指标未取到');
  });

  it('加载态：首屏取数未落定 → 值 — +「取数中…」，栅格挂 aria-busy', async () => {
    overview.mockReturnValue(new Promise(() => {})); // 挂起：模拟在途
    traceList.mockReturnValue(new Promise(() => {}));
    const w = mount(MemoryReview);
    const fragCards = w.findAll('.mk-kpi').slice(-3);
    expect(fragCards.map((c) => c.find('.mk-kpi__num').text())).toEqual(['—', '—', '—']);
    expect(fragCards[0].find('.mk-kpi__hint').text()).toBe('取数中…');
    expect(w.findAll('.mk-kpi-grid')[1].attributes('aria-busy')).toBe('true');
    await flushPromises();
    w.unmount();
  });
});

describe('MemoryReview R7：已执行历史入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mode=apply 凭据一个入口可见：卡头开关计数（含 alias 式归并），可收起再展开', async () => {
    const w = await mountPage({
      ...DETAIL_FULL(),
      appliedMerges: {
        rollbackable: [{ mergeId: 'm1', canonical: 'k-canonical', aliases: ['k-alias'], appliedAt: '2026-10-02T08:00:00.000Z', rolledBackAt: null, deletedRows: 2 }],
        rolledBack: [],
        legacyWindowOnly: [],
      },
      appliedAliasMerges: {
        rollbackable: [{ aliasMergeId: 'a1', canonical: 'k-target', aliases: ['k-source'], appliedAt: '2026-10-03T08:00:00.000Z', rolledBackAt: null, repointedRows: 3 }],
        rolledBack: [],
        legacyWindowOnly: [],
      },
    });
    await openDetailOf(w);
    const detailRoot = w.find('.mr__detail');

    // 默认展开（保持既有可达性）：破坏性凭据 + alias 凭据两族都渲染
    const toggle = detailRoot.findAll('button').find((b) => b.text().startsWith('已执行历史'))!;
    expect(toggle.text()).toBe('已执行历史（2）');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(detailRoot.text()).toContain('重指向行数');
    expect(detailRoot.text()).toContain('k-source');

    // 收起 → 历史区消失；再展开 → 恢复
    await toggle.trigger('click');
    await flushPromises();
    expect(detailRoot.text()).not.toContain('重指向行数');
    const toggle2 = detailRoot.findAll('button').find((b) => b.text().startsWith('已执行历史'))!;
    expect(toggle2.attributes('aria-expanded')).toBe('false');
    await toggle2.trigger('click');
    await flushPromises();
    expect(detailRoot.text()).toContain('重指向行数');
  });
});
