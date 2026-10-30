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

    w.findComponent({ name: 'CompletionCard' }).vm.$emit('action', 'complete-task');
    await flushPromises();

    const block = w.find('.settle-block');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('还不能完成任务');
    expect(block.text()).toContain('回到课堂回答最后 1 个问题');
    expect(block.text()).toContain('暂不完成，返回学习路径');
    // 恢复卡是唯一出口：常规动作栏隐藏，也不再叠一条 Toast
    expect(w.find('.completion-actions').exists()).toBe(false);
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('点击恢复卡跳到本任务课堂并带路径 id', async () => {
    finalizeSessionReliablyMock.mockRejectedValue({
      response: { data: { error: { code: 'FINALIZATION_PENDING_CHECKPOINT', message: '先完成这道小测' } } },
    });
    const w = mount(LearningEvaluationPage);
    await flushPromises();
    w.findComponent({ name: 'CompletionCard' }).vm.$emit('action', 'complete-task');
    await flushPromises();

    await w.find('.settle-block .btn-primary').trigger('click');
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('/learn/t1'),
      query: expect.objectContaining({ pathId: 'p1' }),
    }));
  });
});
