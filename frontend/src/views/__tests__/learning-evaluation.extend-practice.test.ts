/**
 * P27 回归（2026-11-01 走查实锤）：任务已结算后点「继续练习」直进课堂，会被课堂 boot() 的
 * mode:'completed' 守卫原路 replace 回评估页（后端拒绝为已完成任务开新课），一来一回表现为
 * 「点了没反应」，延伸学习入口不可用（实测 JS click×2、URL 与页面均无变化）。
 *
 * 现约定：点击时先探任务态——已完成 → 带 ?mode=extension 进延伸课（课堂页既有通道，#124，
 * 基于本课加练、不结算任务）；未完成或探测失败 → 维持原语义回课堂继续本任务。
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
const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getSessionDetail: getSessionDetailMock,
  },
}));

vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/api', () => ({ default: { get: apiGetMock, post: vi.fn(async () => ({ data: {} })) } }));
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
  topic: '分布式一致性',
  duration: 39,
  revision: 7,
  knowledgePoints: [],
  messages: [],
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' },
  },
};

describe('LearningEvaluationPage「继续练习」入口（P27）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionDetailMock.mockResolvedValue(detail);
  });

  it('任务已完成：带 ?mode=extension 进延伸课，不再直进课堂被弹回', async () => {
    apiGetMock.mockResolvedValue({ success: true, data: { id: 't1', status: 'completed' } });
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    w.findComponent({ name: 'CompletionCard' }).vm.$emit('action', 'continue-task');
    await flushPromises();

    expect(apiGetMock).toHaveBeenCalledWith('/learning/tasks/t1');
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith({
      path: '/learn/t1',
      query: { mode: 'extension', pathId: 'p1' },
    });
    w.unmount();
  });

  it('任务未完成或探测失败：维持原语义回课堂', async () => {
    apiGetMock.mockResolvedValue({ success: true, data: { id: 't1', status: 'in_progress' } });
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    w.findComponent({ name: 'CompletionCard' }).vm.$emit('action', 'continue-task');
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/learn/t1');
    w.unmount();

    pushMock.mockClear();
    apiGetMock.mockRejectedValue(new Error('网络错误'));
    const w2 = mount(LearningEvaluationPage);
    await flushPromises();
    w2.findComponent({ name: 'CompletionCard' }).vm.$emit('action', 'continue-task');
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/learn/t1');
    w2.unmount();
  });
});
