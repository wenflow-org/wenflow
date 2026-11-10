/**
 * #35 调整卡处置轻埋点回归：保留 / 稍后再看 / 预览三个动作必须上报服务端
 * （此前只弹 toast，服务端零记录，审计无法区分「没处置」与「点了保留」）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' }, query: { pathId: 'p1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());
const recordAdvisoryResponseMock = vi.hoisted(() => vi.fn());
// 2026-11-04：显式声明参数元组，否则 vi.fn 推断为无参，mock.calls[0][0] 触发 TS2493/TS2352
const askConfirmMock = vi.hoisted(() => vi.fn<(_opts: { message: string }) => Promise<boolean>>(async () => true));

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
  askConfirm: askConfirmMock,
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

  // 2026-11-04：旧存库建议正文末尾带「不会覆盖/影响你已完成的内容」安抚句，弹窗须与 CompletionCard 同口径剥离
  it('预览：弹窗正文剥离已存库安抚句', async () => {
    getSessionDetailMock.mockResolvedValue({
      ...detail,
      advisory: {
        ...detail.advisory,
        ui: { ...detail.advisory.ui, body: '系统检测到 定位判别断点 这些点仍会影响后续推进。该调整只会调整后续阶段的课程安排，不会覆盖你已完成的内容。' },
      },
    });
    askConfirmMock.mockClear();
    const w = await mountReady();
    emitAdvisory(w, 'preview');
    await flushPromises();
    const arg = askConfirmMock.mock.calls[0][0] as { message: string };
    expect(arg.message).not.toContain('不会覆盖你已完成的内容');
    expect(arg.message).toContain('这些点仍会影响后续推进');
  });

  it('确认调整且 replan 成功后：上报 adopt（P1-7 漏斗执行档）', async () => {
    const w = await mountReady();
    emitAdvisory(w, 'confirm');
    await flushPromises();
    expect(recordAdvisoryResponseMock).toHaveBeenCalledWith('s1', 'adopt');
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
