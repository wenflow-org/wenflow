/**
 * 记忆与复习面板（原独立页 2026-10-12 并入学习者详情页签）：归并「勾选 → 执行 → 回滚」契约
 * - 组件以 userId prop 驱动，挂载即取明细（不再有列表态「明细」按钮）
 * - 默认只勾选「可自动执行」的建议（需人工确认的默认不勾）
 * - 执行参数必须带上勾选的规范键；勾了需确认项才带 includeNeedsReview
 * - 回滚按规范键调用
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminMemoryReviewApi: { detail, recompute, apply, rollback, reject },
}));
const askConfirm = vi.hoisted(() => vi.fn());
vi.mock('../useConfirm', () => ({ askConfirm }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../store', () => ({ openSubPage: vi.fn(), subPage: { value: null } }));

import MemoryReview from '../MemoryReview.vue';

const AUDIT = {
  mode: 'observe',
  generatedAt: '2026-09-15T10:00:00.000Z',
  projectionFingerprint: 'fp',
  candidateCount: 3,
  proposals: [
    {
      canonical: '离开前翻页立好',
      aliases: ['离开前翻页立好：动作先于评价'],
      confidence: 0.92,
      rationale: '同一动作的完整说法',
      lexicalSimilarity: 0.78,
      autoApplicable: true,
    },
    {
      canonical: '回来后的第一眼第一手交给已翻开的书',
      aliases: ['回来后第一手落到哪里'],
      confidence: 0.9,
      rationale: '同一动作的不同说法',
      lexicalSimilarity: 0.2,
      autoApplicable: false,
    },
  ],
  ambiguous: [],
  dropCandidates: [],
  appliedMerges: [],
  stats: { candidates: 3, proposed: 2, autoApplicable: 1, applied: 0, deleted: 0 },
};

const DETAIL = {
  user: { id: 'u1', name: '小明' },
  summary: { traces: 4, due: 2, duplicatedFamilies: 1, duplicatedTraces: 2, neverExtracted: 0, withFsrsState: 0 },
  // 按次留档的归并凭据视图（界面据此判断"还能不能回滚"，与审计滚动窗口无关）
  appliedMerges: {
    rollbackable: [{
      mergeId: 'mrg_1', canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'],
      appliedAt: '2026-09-15T11:00:00.000Z', rolledBackAt: null, deletedRows: 1,
    }],
    rolledBack: [],
    legacyWindowOnly: [],
  },
  reviewPlan: { items: [], budget: 2, usedLoad: 0, backlogCount: 5, successRate: 0.8, relearnSuggestions: [] },
  duePreview: [],
  duplicatedFamilies: [],
  audit: AUDIT,
};

async function mountPanels() {
  detail.mockResolvedValue({ data: { data: DETAIL } });
  const w = mount(MemoryReview, { props: { userId: 'u1' } });
  await flushPromises();
  return w;
}

describe('MemoryReview 归并执行交互（页签内面板）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askConfirm.mockResolvedValue(true);
  });

  it('挂载即按 userId 取明细', async () => {
    await mountPanels();
    expect(detail).toHaveBeenCalledWith('u1');
  });

  it('默认只勾选「可自动执行」的建议', async () => {
    const w = await mountPanels();
    const boxes = w.findAll('.mk-table input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true);
    expect((boxes[1].element as HTMLInputElement).checked).toBe(false);
    expect(w.text()).toContain('执行选中（1）');
  });

  it('执行只传勾选的规范键；勾了需人工确认项才带 includeNeedsReview', async () => {
    const w = await mountPanels();

    apply.mockResolvedValue({ data: { data: { applied: 1, skipped: [], audit: AUDIT } } });
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(apply).toHaveBeenCalledWith('u1', ['离开前翻页立好'], { includeNeedsReview: false });

    // 勾上「需人工确认」那条 → 传给服务端 includeNeedsReview=true
    apply.mockClear();
    await w.findAll('.mk-table input[type="checkbox"]')[1].trigger('change');
    await flushPromises();
    expect(w.text()).toContain('1 条属于「需人工确认」');
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(apply).toHaveBeenCalledWith('u1', expect.arrayContaining(['回来后的第一眼第一手交给已翻开的书']), { includeNeedsReview: true });
  });

  it('取消确认则不调用接口', async () => {
    askConfirm.mockResolvedValue(false);
    const w = await mountPanels();
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(apply).not.toHaveBeenCalled();
  });

  it('回滚按规范键调用', async () => {
    rollback.mockResolvedValue({ data: { data: { rolledBack: 1, skipped: [], audit: AUDIT } } });
    // 审计滚动窗口里**已经没有**这条归并（被挤掉了），但按次留档仍有凭据 → 界面必须还能回滚
    detail.mockResolvedValue({
      data: {
        data: {
          ...DETAIL,
          audit: { ...AUDIT, mode: 'apply', proposals: [], appliedMerges: [] },
        },
      },
    });
    const w = mount(MemoryReview, { props: { userId: 'u1' } });
    await flushPromises();

    const rollbackBtn = w.findAll('button').find((b) => b.text() === '回滚');
    expect(rollbackBtn, '窗口外的旧归并也要给出回滚入口').toBeTruthy();
    await rollbackBtn!.trigger('click');
    await flushPromises();
    expect(rollback).toHaveBeenCalledWith('u1', ['离开前翻页立好']);
  });
});
