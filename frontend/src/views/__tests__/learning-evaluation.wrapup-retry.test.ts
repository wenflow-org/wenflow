/**
 * 降级总结手动重试（2026-10-12）：总结页横幅在产物退化（summary-only/fallback/unavailable）时
 * 给「重新生成完整总结」入口；点击 → started 进入轮询态（按钮停用）、守卫拒绝透传原因、
 * regeneratedAt 更新后按产物质量收口（完整→toast+撤横幅 / 仍退化→提示可再试）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

const REGEN_POLL_INTERVAL_MS = 15000;

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());
const regenerateWrapupMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getSessionDetail: getSessionDetailMock,
    regenerateWrapup: regenerateWrapupMock,
  },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/utils/toast', () => ({ toast: toastMock }));

vi.mock('@/utils/api', () => ({
  default: { post: vi.fn(async () => ({ data: {} })) },
}));

vi.mock('@/utils/projection', () => ({
  isProjectionMode: vi.fn(() => false),
}));

vi.mock('@/views/admin-redesign/useConfirm', () => ({
  askConfirm: vi.fn(async () => true),
}));

vi.mock('@/components/CompletionCard.vue', () => ({
  default: {
    name: 'CompletionCard',
    props: ['topic', 'masteredCount', 'totalCount', 'duration', 'messageCount', 'wrapup', 'advisory', 'busy'],
    emits: ['action', 'advisory-action'],
    template: '<div class="stub-completion" />',
  },
}));
vi.mock('@/components/MarkdownRenderer.vue', () => ({ default: { template: '<div class="stub-md" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));

const degradedWrapup = {
  status: 'summary-only',
  sources: { summary: 'fallback', evaluation: 'unavailable' },
  summary: { topicSummary: '占位总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' },
  progress: { newlyMastered: [], movedToReview: [], stillLearning: [], unchangedMastered: [] },
  evidence: {
    turnCount: 0,
    avgUnderstanding: null,
    avgEngagement: null,
    dominantCognitiveLevel: null,
    lastCognitiveLevel: null,
    topConfusionPoints: [],
    emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
    completionCandidateSeen: false,
  },
};

const detailWith = (wrapup: Record<string, unknown>) => ({
  status: 'completed',
  topic: '一节课',
  duration: 12,
  revision: 1,
  knowledgePoints: [],
  messages: [{ role: 'user', content: '好', timestamp: '2026-10-12T02:00:00.000Z' }],
  wrapup,
});

const completeWrapup = {
  ...degradedWrapup,
  status: 'complete',
  sources: { summary: 'model', evaluation: 'model' },
  regeneratedAt: '2026-10-12T03:00:00.000Z',
};

async function mountReady() {
  const w = mount(LearningEvaluationPage);
  await flushPromises();
  return w;
}

describe('LearningEvaluationPage 降级总结重试', () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
    regenerateWrapupMock.mockReset();
    getSessionDetailMock.mockResolvedValue(detailWith(degradedWrapup));
    toastMock.success.mockClear();
  });

  it('降级横幅给出重试入口；started 后进入轮询态并停用按钮', async () => {
    regenerateWrapupMock.mockResolvedValue({ started: true });
    const w = await mountReady();

    const banner = w.find('.evaluation-degraded');
    expect(banner.exists()).toBe(true);
    const btn = w.find('.evaluation-degraded__retry');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('重新生成完整总结');

    await btn.trigger('click');
    await flushPromises();

    expect(regenerateWrapupMock).toHaveBeenCalledWith('s1');
    expect(w.find('.evaluation-degraded__retry').text()).toContain('正在重新生成');
    expect(w.find('.evaluation-degraded__retry').attributes('disabled')).toBeDefined();
  });

  it('守卫拒绝（冷却/未完结）时 409 原因透传到横幅，不进轮询', async () => {
    regenerateWrapupMock.mockRejectedValue({ status: 409, message: '仅完结会话可重生成（当前 active）' });
    const w = await mountReady();

    await w.find('.evaluation-degraded__retry').trigger('click');
    await flushPromises();

    expect(w.find('.evaluation-degraded__notice').text()).toContain('仅完结会话可重生成');
    expect(w.find('.evaluation-degraded__retry').attributes('disabled')).toBeUndefined();
  });

  it('skipped（冷却中）不算错误，原因直接展示', async () => {
    regenerateWrapupMock.mockResolvedValue({ started: false, skipped: '刚刚重试过，请稍候再试' });
    const w = await mountReady();

    await w.find('.evaluation-degraded__retry').trigger('click');
    await flushPromises();

    expect(w.find('.evaluation-degraded__notice').text()).toContain('刚刚重试过');
  });

  it('轮询发现 regeneratedAt 更新且产物完整 → toast 成功并撤掉降级横幅', async () => {
    // 轮询定时器是 15s 真间隔，fake timers 推进（不用 flushPromises——它在 fake timers 下会死锁）
    vi.useFakeTimers();
    try {
      regenerateWrapupMock.mockResolvedValue({ started: true });
      const w = mount(LearningEvaluationPage);
      await vi.advanceTimersByTimeAsync(0);

      expect(w.find('.evaluation-degraded').exists()).toBe(true);
      await w.find('.evaluation-degraded__retry').trigger('click');
      await vi.advanceTimersByTimeAsync(0);
      expect(w.find('.evaluation-degraded__retry').text()).toContain('正在重新生成');

      getSessionDetailMock.mockResolvedValue(detailWith(completeWrapup));
      await vi.advanceTimersByTimeAsync(REGEN_POLL_INTERVAL_MS);

      expect(toastMock.success).toHaveBeenCalledWith('学习总结已重新生成');
      expect(w.find('.evaluation-degraded').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('重生成落库但仍退化 → 提示可再试一次，横幅与按钮恢复', async () => {
    vi.useFakeTimers();
    try {
      regenerateWrapupMock.mockResolvedValue({ started: true });
      const w = mount(LearningEvaluationPage);
      await vi.advanceTimersByTimeAsync(0);

      await w.find('.evaluation-degraded__retry').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      getSessionDetailMock.mockResolvedValue(detailWith({
        ...degradedWrapup,
        regeneratedAt: '2026-10-12T03:00:00.000Z',
      }));
      await vi.advanceTimersByTimeAsync(REGEN_POLL_INTERVAL_MS);

      expect(toastMock.success).not.toHaveBeenCalled();
      expect(w.find('.evaluation-degraded').exists()).toBe(true);
      expect(w.find('.evaluation-degraded__notice').text()).toContain('可再试一次');
      // 轮询已收口：按钮恢复可点，允许下一轮重试
      expect(w.find('.evaluation-degraded__retry').attributes('disabled')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
