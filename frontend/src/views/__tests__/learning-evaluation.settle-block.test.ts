/**
 * 结算门禁回归：服务端 409 FINALIZATION_OPEN_QUESTION 被 axios 包在
 * response.data.error 里，前端必须读出 code 并展示恢复卡，而不是只弹一条错误 toast。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' }, query: { pathId: 'p1' } }),
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());
const finalizeSessionReliablyMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getSessionDetail: getSessionDetailMock,
    finalizeSessionReliably: finalizeSessionReliablyMock,
  },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(),
}));
vi.mock('@/utils/toast', () => ({ toast: toastMock }));
vi.mock('@/utils/api', () => ({ default: { post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('@/utils/projection', () => ({ isProjectionMode: vi.fn(() => false) }));
vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock('@/components/MarkdownRenderer.vue', () => ({ default: { template: '<div class="stub-md" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));
vi.mock('@/components/CompletionCard.vue', () => ({
  default: {
    name: 'CompletionCard',
    props: ['topic', 'masteredCount', 'totalCount', 'duration', 'messageCount', 'wrapup', 'advisory', 'busy'],
    emits: ['action', 'advisory-action'],
    template: '<div class="stub-completion" />',
  },
}));

const detail = {
  status: 'completed',
  topic: '核对源表列名',
  duration: 12,
  revision: 7,
  knowledgePoints: [],
  messages: [
    { role: 'assistant', content: '先看表头', timestamp: '2026-10-29T02:00:00.000Z' },
    { role: 'user', content: '好', timestamp: '2026-10-29T02:01:00.000Z' },
  ],
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' },
  },
};

describe('LearningEvaluationPage 结算门禁恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionDetailMock.mockResolvedValue(detail);
  });

  it('409 FINALIZATION_OPEN_QUESTION 显示回课堂恢复卡', async () => {
    finalizeSessionReliablyMock.mockRejectedValue({
      response: { data: { error: { code: 'FINALIZATION_OPEN_QUESTION', message: '老师刚提了一个问题' } } },
    });
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    await w.find('.evaluation-head__complete').trigger('click');
    await flushPromises();

    const block = w.find('.settle-block');
    expect(block.exists()).toBe(true);
    // 与课堂页共用同一份门禁文案（closureGate.ts），不再各写一套
    expect(block.text()).toContain('先回答老师的问题');
    expect(block.text()).toContain('去回答');
    expect(block.text()).toContain('提前结束（不计完成）');
    expect(block.text()).toContain('暂不完成，返回学习路径');
    // 恢复卡是唯一出口：常规动作栏隐藏，也不再叠一条 Toast
    expect(w.find('.completion-actions').exists()).toBe(false);
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('契约门 409 也走同一恢复卡，且所有门禁都给同一持久出口「结束学习（不计入完成）」', async () => {
    finalizeSessionReliablyMock
      .mockRejectedValueOnce({
        response: { data: { error: { code: 'LESSON_CONTRACT_NOT_MET', message: '本课还有契约目标未达成：独立证据不足' } } },
      })
      .mockResolvedValueOnce({
        status: 'completed',
        revision: 8,
        session: { status: 'completed', mode: 'tutor' },
        finalization: { sessionClosure: 'completed', taskCompletion: 'skipped' },
      });

    const w = mount(LearningEvaluationPage);
    await flushPromises();
    await w.find('.evaluation-head__complete').trigger('click');
    await flushPromises();

    const block = w.find('.settle-block');
    expect(block.exists(), '契约门此前会落到通用失败 toast，现在必须常驻恢复卡').toBe(true);
    expect(block.text()).toContain('还差几步才能完成本节课');
    expect(block.text()).toContain('独立证据不足');

    const endOnly = block.findAll('button').find((b) => b.text().includes('提前结束（不计完成）'));
    expect(endOnly, '每条门禁都应给同一颗持久出口').toBeTruthy();
    await endOnly!.trigger('click');
    await flushPromises();

    expect(finalizeSessionReliablyMock.mock.calls.at(-1)?.[1]).toMatchObject({
      action: 'end_only',
      reason: 'manual-end',
    });
  });

  it('点击恢复卡跳到本任务课堂并带路径 id', async () => {
    finalizeSessionReliablyMock.mockRejectedValue({
      response: { data: { error: { code: 'FINALIZATION_PENDING_CHECKPOINT', message: '先完成这道小测' } } },
    });
    const w = mount(LearningEvaluationPage);
    await flushPromises();
    await w.find('.evaluation-head__complete').trigger('click');
    await flushPromises();

    await w.find('.settle-block .btn-primary').trigger('click');
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('/learn/t1'),
      query: expect.objectContaining({ pathId: 'p1' }),
    }));
  });
});
