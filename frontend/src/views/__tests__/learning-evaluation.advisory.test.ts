/**
 * #35 调整卡处置轻埋点回归：保留 / 稍后再看 / 预览三个动作必须上报服务端
 * （此前只弹 toast，服务端零记录，审计无法区分「没处置」与「点了保留」）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());
const recordAdvisoryResponseMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getSessionDetail: getSessionDetailMock,
    recordAdvisoryResponse: recordAdvisoryResponseMock,
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

const detail = {
  status: 'completed',
  topic: '拆解一页乱版汇报稿',
  duration: 12,
  revision: 3,
  knowledgePoints: [],
  messages: [
    { role: 'assistant', content: '开场', timestamp: '2026-10-05T02:00:00.000Z' },
    { role: 'user', content: '好', timestamp: '2026-10-05T02:01:00.000Z' },
  ],
  advisory: {
    shouldSuggest: true,
    recommendation: 'reinforce',
    priority: 'medium',
    rationale: '连续两次卡点',
    ui: {
      title: '调整建议',
      body: '先巩固再前进',
      options: [
        { key: 'keep', label: '保留' },
        { key: 'later', label: '稍后' },
        { key: 'preview', label: '预览' },
      ],
    },
  },
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' },
  },
};

async function mountReady() {
  const w = mount(LearningEvaluationPage);
  await flushPromises();
  return w;
}

function emitAdvisory(w: ReturnType<typeof mount>, action: string) {
  const cc = w.findComponent({ name: 'CompletionCard' });
  cc.vm.$emit('advisory-action', action);
}

describe('LearningEvaluationPage 调整卡处置埋点（#35）', () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
    recordAdvisoryResponseMock.mockReset();
    toastMock.success.mockReset();
    toastMock.info.mockReset();
    getSessionDetailMock.mockResolvedValue(detail);
    recordAdvisoryResponseMock.mockResolvedValue(undefined);
  });

  it('保留：上报 keep，且原有 toast 提示不变', async () => {
    const w = await mountReady();
    emitAdvisory(w, 'keep');
    await flushPromises();
    expect(recordAdvisoryResponseMock).toHaveBeenCalledWith('s1', 'keep');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('稍后再看：上报 later', async () => {
    const w = await mountReady();
    emitAdvisory(w, 'later');
    await flushPromises();
    expect(recordAdvisoryResponseMock).toHaveBeenCalledWith('s1', 'later');
  });

  it('预览：上报 preview', async () => {
    const w = await mountReady();
    emitAdvisory(w, 'preview');
    await flushPromises();
    expect(recordAdvisoryResponseMock).toHaveBeenCalledWith('s1', 'preview');
  });

  it('埋点失败静默降级：提示照常，页面不炸', async () => {
    recordAdvisoryResponseMock.mockRejectedValue(new Error('500'));
    const w = await mountReady();
    emitAdvisory(w, 'keep');
    await flushPromises();
    expect(toastMock.success).toHaveBeenCalled();
    expect(w.find('.stub-completion').exists()).toBe(true);
  });
});
