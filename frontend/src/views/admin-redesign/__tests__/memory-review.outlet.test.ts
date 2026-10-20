/**
 * R7 概念本体治理批 · adminui 域：记忆与复习面板（原独立页，2026-10-12 并入学习者详情页签）
 * - 三组建议列表（归并 / 需人工看 / 散键清理）渲染：每条带 归并目标/证据/置信度，操作 = 确认 / 驳回
 * - 批量确认（破坏性操作）：二次确认弹层列明将迁移哪些表；apply 收到三组确认列表
 * - 驳回走 POST reject（三组各自的主键）
 * - 已执行历史（mode=apply 审计）一个入口可见：卡头开关 + alias 式归并凭据渲染
 * （原「碎片率 KPI 行」随独立页列表态退役——碎片率是跨用户口径，页签内无承载）
 *
 * 接口形状假设（outlet 路由并行开发未落地，见 adminApi.ts 注释）：本套测试 mock API 层，
 * 钉的是前端契约（调用参数与渲染），不依赖后端实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());
const candidates = vi.hoisted(() => vi.fn());
const openSubPage = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminMemoryReviewApi: { detail, recompute, apply, reject, rollback, candidates },
}));
vi.mock('../store', () => ({ openSubPage, subPage: { value: null } }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));

import MemoryReview from '../MemoryReview.vue';
import { askConfirm } from '../useConfirm';

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

async function mountPanels(detailBody: Record<string, unknown> = DETAIL_FULL()) {
  detail.mockResolvedValue({ data: { data: detailBody } });
  const w = mount(MemoryReview, { props: { userId: 'u1' } });
  await flushPromises();
  return w;
}

describe('MemoryReview R7 页出口：三组建议列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染三组建议：归并（目标/证据/置信度）、需人工看、散键清理，各带 确认/驳回 操作位', async () => {
    const w = await mountPanels();
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
    const w = await mountPanels({
      ...DETAIL_FULL(),
      audit: { ...DETAIL_FULL().audit as Record<string, unknown>, proposals: [], ambiguous: [], dropCandidates: [] },
    });
    const text = w.find('.mr__detail').text();
    expect(text).toContain('本次没有达到置信度阈值的归并建议。');
    expect(text).toContain('没有待人工确认项。');
    expect(text).toContain('没有待清理的散键。');
  });

  it('驳回：三组各自的驳回都过确认弹层（非危险档）并按各自主键调用 POST reject', async () => {
    const w = await mountPanels();
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

  it('单条确认（散键清理）：确认弹层列明将整理的内容并调用 apply', async () => {
    const w = await mountPanels();
    const dropConfirm = w.find('.mr__detail').findAll('button').find((b) => b.text() === '确认' && b.attributes('title')?.includes('清理'))!;
    await dropConfirm.trigger('click');
    await flushPromises();
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '执行概念归并',
      danger: true,
      message: expect.stringContaining('会同时整理该用户的'),
    }));
    expect(apply).toHaveBeenCalledWith('u1', [], { includeNeedsReview: false, drops: ['k-stray'] });
  });
});

describe('MemoryReview R7：批量确认调用 API（任务书 D）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('跨三组勾选 → 执行选中：确认弹层列明将整理的内容（记忆记录 / 学习证据 / 概念掌握情况 / 误解记录）', async () => {
    const w = await mountPanels();

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

    // 二次确认弹层（危险档）必须列明将整理的内容
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '执行概念归并',
      danger: true,
    }));
    const message = vi.mocked(askConfirm).mock.calls.at(-1)![0].message as string;
    for (const item of ['记忆记录', '学习证据', '概念掌握情况', '误解记录']) {
      expect(message).toContain(item);
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
    const w = await mountPanels();
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('MemoryReview 归并处理条（2026-10-19 重设计）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0 选中：只说明怎么开始，不摆一枚永远点不动的禁用按钮', async () => {
    const body = DETAIL_FULL();
    body.audit.proposals[0].autoApplicable = false;
    body.audit.stats.autoApplicable = 0;
    const w = await mountPanels(body);

    const bar = w.find('.mr-bulk');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain('批量处理');
    expect(bar.text()).toContain('本次没有可自动执行的建议');
    expect(bar.findAll('button')).toHaveLength(0);
  });

  it('勾选后：读数写清选了几项与构成，警告独立一行常显', async () => {
    const w = await mountPanels();
    // 默认勾选可自动执行的归并建议
    expect(w.find('.mr-bulk').text()).toContain('已选 1 项');
    expect(w.find('.mr-bulk').text()).toContain('归并 1');

    const boxes = w.findAll('.mr__detail input[type="checkbox"]');
    await boxes[1].trigger('change');
    await boxes[2].trigger('change');
    await flushPromises();

    const bar = w.find('.mr-bulk');
    expect(bar.text()).toContain('已选 3 项');
    expect(bar.text()).toContain('归并 1');
    expect(bar.text()).toContain('人工确认对 1');
    expect(bar.text()).toContain('散键 1');
    expect(bar.text()).toContain('清空');
    expect(bar.text()).toContain('执行选中（3）');
    const warn = bar.find('.mr-bulk__warn');
    expect(warn.exists()).toBe(true);
    expect(warn.text()).toContain('1 条「需人工看」对');
  });
});

describe('MemoryReview R7：已执行历史入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mode=apply 凭据一个入口可见：卡头开关计数（含 alias 式归并），可收起再展开', async () => {
    const w = await mountPanels({
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
    const detailRoot = w.find('.mr__detail');

    // 默认展开（保持既有可达性）：破坏性凭据 + alias 凭据两族都渲染
    const toggle = detailRoot.findAll('button').find((b) => b.text().startsWith('已执行历史'))!;
    expect(toggle.text()).toBe('已执行历史（2）');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(detailRoot.text()).toContain('改指向记录数');
    expect(detailRoot.text()).toContain('k-source');

    // 收起 → 历史区消失；再展开 → 恢复
    await toggle.trigger('click');
    await flushPromises();
    expect(detailRoot.text()).not.toContain('改指向记录数');
    const toggle2 = detailRoot.findAll('button').find((b) => b.text().startsWith('已执行历史'))!;
    expect(toggle2.attributes('aria-expanded')).toBe('false');
    await toggle2.trigger('click');
    await flushPromises();
    expect(detailRoot.text()).toContain('改指向记录数');
  });
});
