/**
 * 已结算任务的「完成任务」入口回归（2026-11-03 走查 S4-5）。
 *
 * 评估页顶部写「本次学习已结束」，底部却仍递一颗「完成任务」并注明会推进路径进度，
 * 而路径页早已把这节计入完成（阶段 1 = 1/2）。修法是按课次状态（task.status）探测并撤掉该入口。
 *
 * 这里锁的是**首屏漏斗**：已结束的会话不会再进轮询，只有 fetchEvaluation 那一跳会跑；
 * 探针若只挂在 pollEvaluation 上，则线上表现就是「按钮照旧在」——正是本次实测踩到的坑。
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
const regenerateWrapupMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getSessionDetail: getSessionDetailMock,
    finalizeSessionReliably: finalizeSessionReliablyMock,
    regenerateWrapup: regenerateWrapupMock,
  },
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

// api.get 是探测课次状态的通道；拦截器已剥掉 axios 自己的层，留给 unwrap 的是 {success,data} 信封
const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/api', () => ({
  default: { get: apiGetMock, post: vi.fn(async () => ({ data: {} })) },
}));

vi.mock('@/utils/projection', () => ({ isProjectionMode: vi.fn(() => false) }));
vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock('@/components/MarkdownRenderer.vue', () => ({ default: { template: '<div class="stub-md" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));

// 桩件保留 taskCompleted 声明，才能读回页面传下去的口径
vi.mock('@/components/CompletionCard.vue', () => ({
  default: {
    name: 'CompletionCard',
    props: ['topic', 'masteredCount', 'totalCount', 'duration', 'messageCount', 'wrapup', 'advisory', 'busy', 'taskCompleted'],
    emits: ['action', 'advisory-action'],
    template: '<div class="stub-completion" />',
  },
}));

const finishedDetail = {
  status: 'completed',
  topic: '核对源表列名',
  duration: 12,
  revision: 7,
  knowledgePoints: [],
  messages: [{ role: 'assistant', content: '先看表头', timestamp: '2026-10-29T02:00:00.000Z' }],
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' },
  },
};

function cardOf(w: ReturnType<typeof mount>) {
  return w.findComponent({ name: 'CompletionCard' });
}

describe('LearningEvaluationPage 已结算任务的入口口径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionDetailMock.mockResolvedValue(finishedDetail);
  });

  it('首屏加载即探测，课次已完成 → CompletionCard 收到 taskCompleted=true', async () => {
    apiGetMock.mockResolvedValue({ data: { status: 'completed' } });
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    expect(apiGetMock).toHaveBeenCalledWith('/learning/tasks/t1');
    expect(cardOf(w).props('taskCompleted')).toBe(true);
    // 移动吸底条须与桌面卡口径一致：已结算即收起「完成任务」（2026-11-04）
    const barBtns = w.findAll('.evaluation-ctabar button').map((b) => b.text());
    expect(barBtns).not.toContain('完成任务');
    expect(barBtns).toEqual(['继续练习', '返回']);
  });

  it('课次未完成 → taskCompleted=false（照旧递「完成任务」）', async () => {
    apiGetMock.mockResolvedValue({ data: { status: 'in_progress' } });
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    expect(cardOf(w).props('taskCompleted')).toBe(false);
    // 未结算时吸底条仍递三键（含「完成任务」）
    const barBtns = w.findAll('.evaluation-ctabar button').map((b) => b.text());
    expect(barBtns).toEqual(['继续练习', '返回', '完成任务']);
  });

  it('探测失败按未结算处理，不改变既有入口', async () => {
    apiGetMock.mockRejectedValue(new Error('boom'));
    const w = mount(LearningEvaluationPage);
    await flushPromises();

    expect(cardOf(w).props('taskCompleted')).toBe(false);
  });
});
