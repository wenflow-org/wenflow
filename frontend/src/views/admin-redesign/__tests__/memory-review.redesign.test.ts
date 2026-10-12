/**
 * 记忆与复习面板 redesign 契约（原独立页 2026-10-12 用户拍板并入学习者详情页签；
 * 列表态——到期时间轴 MkDistBand / 用户列表 / 跨用户 KPI——随页退役，相关用例一并撤除）：
 * - 挂载即按 userId 取明细；明细缺失给「暂无可复盘」兜底
 * - 到期清单预览：到期列「已逾期 N 天 / N 天后」相对表达，逾期着色，绝对时刻进 title
 * - P1#12：apply / rollback / recompute 失败不再静默——toast + 明细区 error 双出口
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
vi.mock('../store', () => ({ openSubPage: vi.fn(), subPage: { value: null } }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// P1#12：明细态动作失败测试需要 askConfirm 直接放行（真实实现要人工点确认）
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));

import MemoryReview from '../MemoryReview.vue';
import { toast } from '@/utils/toast';

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

/** 明细响应夹具：audit 带 1 条可自动 proposal（默认勾选）+ 1 条可回滚归并 */
const makeDetail = (over: Record<string, unknown> = {}) => ({
  user: { name: '小明' },
  summary: { traces: 7, due: 2, duplicatedFamilies: 0, duplicatedTraces: 0, neverExtracted: 0, withFsrsState: 5 },
  reviewPlan: null,
  audit: {
    mode: 'observe',
    generatedAt: new Date().toISOString(),
    stats: { candidates: 2, proposed: 1, autoApplicable: 1, ambiguous: 0, applied: 0, deleted: 0 },
    proposals: [{ canonical: 'k1', aliases: ['k1a'], confidence: 0.9, lexicalSimilarity: 0.9, autoApplicable: true, rationale: '同义' }],
    ambiguous: [],
  },
  appliedMerges: {
    rollbackable: [{ mergeId: 'm1', canonical: 'k1', aliases: ['k1a'], appliedAt: new Date().toISOString(), rolledBackAt: null, deletedRows: 1 }],
    rolledBack: [],
    legacyWindowOnly: [],
  },
  duplicatedFamilies: [],
  duePreview: [],
  ...over,
});

async function mountPanels(detailBody: Record<string, unknown>) {
  detail.mockResolvedValue({ data: { data: detailBody } });
  const w = mount(MemoryReview, { props: { userId: 'u1' } });
  await flushPromises();
  return w;
}

describe('MemoryReview 面板（学习者详情页签内）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('挂载即按 userId 拉明细；取数失败在面板顶层亮错误条（不冒充「暂无数据」）', async () => {
    const w = await mountPanels(makeDetail());
    expect(detail).toHaveBeenCalledWith('u1');
    expect(w.find('.mr__detail').exists()).toBe(true);

    detail.mockRejectedValueOnce(new Error('学习者不存在'));
    const failed = mount(MemoryReview, { props: { userId: 'u2' } });
    await flushPromises();
    expect(failed.find('.mr__detail').exists()).toBe(false);
    expect(failed.find('.mr__detail-error').exists()).toBe(true);
    expect(failed.find('.mr__detail-error').text()).toContain('学习者不存在');
    failed.unmount();
  });

  /** P1#13：到期清单预览的到期列改相对表达 + 逾期着色（绝对时刻进 title） */
  it('到期清单预览：到期列「已逾期 N 天 / N 天后」相对表达，逾期着色，绝对时刻进 title', async () => {
    const w = await mountPanels(makeDetail({
      duePreview: [
        { conceptKey: 'k1', label: '逾期点', retention: 0.5, masteryScore: 0.6, extractionCount: 2, source: null, dueAt: at(-3) },
        { conceptKey: 'k2', label: '未来点', retention: 0.5, masteryScore: 0.6, extractionCount: 2, source: null, dueAt: at(4) },
        { conceptKey: 'k3', label: '无到期', retention: 0.5, masteryScore: 0.6, extractionCount: 2, source: null, dueAt: null },
      ],
    }));

    const detailRoot = w.find('.mr__detail');
    expect(detailRoot.text()).toContain('已逾期 3 天');
    expect(detailRoot.text()).toContain('4 天后');
    const overdue = w.find('.mr__overdue');
    expect(overdue.exists()).toBe(true);
    expect(overdue.text()).toBe('已逾期 3 天');
    expect(overdue.attributes('title')).toContain('到期时刻');
  });

  /** P1#12：明细态 apply / rollback / recompute 失败不再静默——toast + 明细区 error 双出口 */
  it('明细态动作失败：apply / rollback / recompute 失败弹 toast 且 error 渲染到明细区', async () => {
    const w = await mountPanels(makeDetail());
    expect(w.find('.mr__detail').exists()).toBe(true);

    // apply 失败（proposal 默认勾选，直接点「执行选中」）
    apply.mockRejectedValueOnce(new Error('归并冲突'));
    await w.findAll('button').find((b) => b.text().startsWith('执行选中'))!.trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('执行归并失败：归并冲突');
    // 2026-10-06 审核 #40：明细态错误条形态收敛共享 .mk-alert（页私有 .mr__error 已撤）
    expect(w.find('.mr__detail-error').exists()).toBe(true);
    expect(w.find('.mr__detail-error').text()).toContain('归并冲突');

    // rollback 失败
    rollback.mockRejectedValueOnce(new Error('快照缺失'));
    await w.findAll('button').find((b) => b.text() === '回滚')!.trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('回滚失败：快照缺失');

    // recompute 失败（面板栏「重新观察」）
    recompute.mockRejectedValueOnce(new Error('复盘引擎超时'));
    await w.findAll('button').find((b) => b.text() === '重新观察')!.trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('重新观察失败：复盘引擎超时');
  });

  /** 2026-10-12 用户走查「这个地方再优化一下」：两族全空时两个幽灵标题（h4+「没有可回滚的…」×2）
      收成一行留痕；任一族有记录（默认夹具）则两段式保留，单族空态承担对照语义 */
  it('已执行历史两族全空：收成一行；任一族有记录：两段式与单族空态保留', async () => {
    const empty = await mountPanels(makeDetail({
      appliedMerges: { rollbackable: [], rolledBack: [], legacyWindowOnly: [] },
      appliedAliasMerges: { rollbackable: [], rolledBack: [], legacyWindowOnly: [] },
    }));
    const et = empty.find('.mr__detail').text();
    expect(et).toContain('已执行的归并 / 别名归并：暂无记录');
    expect(et).not.toContain('没有可回滚的归并。');
    expect(et).not.toContain('没有可回滚的别名归并。');
    empty.unmount();

    const filled = await mountPanels(makeDetail());
    const ft = filled.find('.mr__detail').text();
    expect(ft).toContain('已执行归并（可回滚 · 按次留档）');
    // 别名族空但主族有记录：别名标题与其空态保留（对照语义）
    expect(ft).toContain('别名归并（不删除记录：登记别名并改指向）');
    expect(ft).toContain('没有可回滚的别名归并。');
    filled.unmount();
  });
});
