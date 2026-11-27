/**
 * 课堂生命周期状态与回归测试（V2LearningPage）：
 * 1. restart() 彻底清理上一局 lessonReport / knowledgePoints / lessonPhase / settleBlock，不亮出虚假「完成本节」
 * 2. mode === 'resumed' 恢复历史消息中持久化的 supplementaryMaterial 补充资料卡及 branchState
 * 3. finalizing 结算进行中禁用底部输入框与选图按钮，禁止并发提交
 * 4. 网络断开/恢复时显隐 .tutor__offline 提示条
 * 5. ⋯ 菜单里的闭卷/联网补充开关明确标示「下节生效」
 * 6. 同路由切课（route.params.taskId 变化）自动重新执行 boot() 初始化新课堂
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockStartSession = vi.hoisted(() => vi.fn());
const mockGetSessionDetail = vi.hoisted(() => vi.fn());
const mockResetSession = vi.hoisted(() => vi.fn());
const mockFinalizeSessionReliably = vi.hoisted(() => vi.fn());
const mockPauseSession = vi.hoisted(() => vi.fn());
const mockAskConfirm = vi.hoisted(() => vi.fn(async () => true));
const mockRoute = reactive({ params: { taskId: 'task-a' }, query: {} as Record<string, string> });

vi.mock('@/utils/api', () => ({
  default: { get: mockGet, post: mockPost },
  API_BASE_URL: '/api',
}));
vi.mock('@/api/aiTeaching', () => ({
  createTeachingIdempotencyKey: (prefix = 'k') => `${prefix}_1`,
  aiTeachingAPI: {
    startSession: mockStartSession,
    startReviewSession: vi.fn(),
    startExtensionSession: vi.fn(),
    getSessionDetail: mockGetSessionDetail,
    getLatestTaskEvaluation: vi.fn().mockResolvedValue(null),
    resetSession: mockResetSession,
    finalizeSessionReliably: mockFinalizeSessionReliably,
    pauseSession: mockPauseSession.mockResolvedValue(2),
    resumeSession: vi.fn().mockResolvedValue(3),
    streamSendMessage: vi.fn(),
    sendMessage: vi.fn(),
    streamContinueSession: vi.fn(),
    streamSubmitCheckpoint: vi.fn(),
    submitCheckpoint: vi.fn(),
    streamSendPeerMessage: vi.fn(),
    sendPeerMessage: vi.fn(),
  },
}));
vi.mock('@/api/materials', () => ({ readMaterialSection: vi.fn() }));
vi.mock('@/api/learning', () => ({ learningAPI: { getConceptGraph: vi.fn() } }));
vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm: mockAskConfirm }));
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/TeachingDiagram.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/TeachingFigure.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/mk/MkGraph.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/mk/MkLoading.vue', () => ({ default: { template: '<div />' } }));

import V2LearningPage from '../V2LearningPage.vue';

function stubTaskGet() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/learning/tasks/')) {
      return Promise.resolve({ data: { title: '测试课程', learningPathId: 'lp-1' } });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('V2LearningPage 课堂生命周期状态回归', () => {
  let activeWrapper: VueWrapper | null = null;

  function mountPage() {
    activeWrapper = mount(V2LearningPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    return activeWrapper;
  }

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  beforeEach(() => {
    mockRoute.params.taskId = 'task-a';
    mockRoute.query = {};
    localStorage.clear();
    sessionStorage.clear();
    mockGet.mockReset();
    mockPost.mockReset();
    mockStartSession.mockReset();
    mockGetSessionDetail.mockReset();
    mockResetSession.mockReset();
    mockFinalizeSessionReliably.mockReset();
    mockAskConfirm.mockReset().mockResolvedValue(true);
    stubTaskGet();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('1. 重新开始本节时清干净上一局的契约达标态与阶段条，不漏出虚假「完成本节」', async () => {
    mockStartSession
      .mockResolvedValueOnce({
        sessionId: 's-1',
        revision: 1,
        mode: 'resumed',
        knowledgePoints: [{ name: '核心点A', status: 'mastered', progress: 100 }],
      })
      .mockResolvedValueOnce({
        sessionId: 's-2',
        revision: 0,
        mode: 'new',
        opening: { message: '全新开始这一节', question: '', quickReplies: [] },
        knowledgePoints: [{ name: '核心点A', status: 'pending', progress: 0 }],
      });
    mockGetSessionDetail.mockResolvedValue({
      id: 's-1',
      revision: 2,
      messages: [
        { role: 'assistant', content: '上一局已达标', timestamp: new Date().toISOString() },
        { role: 'user', content: '明白了', timestamp: new Date().toISOString() },
      ],
      state: {
        lessonPhase: { phase: 'close', segments: [{ title: 's1' }], passedPhases: ['orient', 'build'] },
        sessionArtifacts: {
          lessonReport: { met: true, coveredKcs: ['核心点A'], missingKcs: [], independentKcs: ['核心点A'], independentCount: 1, requiredIndependent: 1, reasons: [], generatedAt: '', teachingTurns: 2, evidence: [], branch: { active: null, patchesUsed: 0, offTopicTurns: 0, examplesUsed: 0 }, parkingLot: [] },
        },
      },
    });
    mockResetSession.mockResolvedValue(3);

    const w = mountPage();
    await flushPromises();
    expect(w.find('.learn__finishbtn').exists()).toBe(true);
    expect(w.find('.lessonbar').exists()).toBe(true);

    // 点击恢复条上的「重新开始」
    const restartBtn = w.find('.tutor__resume-restart');
    await restartBtn.trigger('click');
    await flushPromises();

    expect(mockResetSession).toHaveBeenCalledWith('s-1', 2);
    // 新开局不能保留上一局的完成按钮与完成阶段条
    expect(w.find('.learn__finishbtn').exists()).toBe(false);
    expect(w.find('.ready').exists()).toBe(false);
    expect(w.find('.lessonbar').exists()).toBe(false);
  });

  it('2. mode=resumed 恢复历史消息中持久化的补充资料卡（supplementaryMaterial）', async () => {
    mockStartSession.mockResolvedValue({
      sessionId: 's-resumed',
      revision: 1,
      mode: 'resumed',
      knowledgePoints: [{ name: '公司法五年期限', status: 'learning', progress: 50 }],
    });
    mockGetSessionDetail.mockResolvedValue({
      id: 's-resumed',
      revision: 4,
      messages: [
        { role: 'assistant', content: '我先核对一下规定。', timestamp: new Date().toISOString() },
        { role: 'user', content: '查到了吗？', timestamp: new Date().toISOString() },
        {
          role: 'assistant',
          content: '查到了，按司法部公布的规定……',
          timestamp: new Date().toISOString(),
          supplementaryMaterial: {
            materialId: 'mat-moj-1',
            title: '中华人民共和国司法部 · 登记管理规定',
            topic: '存量公司五年过渡期',
            sourceUrl: 'https://www.moj.gov.cn/example.html',
            publishedAt: '2024-07-01',
            excerpt: '2024年6月30日前登记设立的公司……',
          },
        },
      ],
      state: { sessionArtifacts: {} },
    });

    const w = mountPage();
    await flushPromises();

    const supCard = w.find('.msg__supplement');
    expect(supCard.exists()).toBe(true);
    expect(supCard.text()).toContain('中华人民共和国司法部 · 登记管理规定');
    expect(supCard.text()).toContain('存量公司五年过渡期');
  });

  it('3. 结算中（finalizing）禁用输入区与选图按钮', async () => {
    let resolveFinalize!: (v: Record<string, unknown>) => void;
    mockFinalizeSessionReliably.mockImplementation(
      () => new Promise((resolve) => { resolveFinalize = resolve; })
    );
    mockStartSession.mockResolvedValue({
      sessionId: 's-fin',
      revision: 1,
      mode: 'new',
      opening: { message: '开始上课', question: '', quickReplies: [] },
      knowledgePoints: [{ name: '单点', status: 'mastered', progress: 100 }],
    });

    const w = mountPage();
    await flushPromises();

    await w.find('.learn__finishbtn').trigger('click');
    await flushPromises();

    expect(w.find('.settle').exists()).toBe(true);
    expect((w.find('.composer__textarea').element as HTMLTextAreaElement).disabled).toBe(true);
    expect((w.find('.composer__img-btn').element as HTMLButtonElement).disabled).toBe(true);

    resolveFinalize({ wrapup: { summary: { topicSummary: '已完成' } } });
    await flushPromises();
    expect(w.find('.finish').exists()).toBe(true);
  });

  it('4. 断网与联网切换时显隐离线提示条，且闭卷模式文案明示「下节生效」', async () => {
    mockStartSession.mockResolvedValue({
      sessionId: 's-net',
      revision: 1,
      mode: 'new',
      opening: { message: '欢迎来到课堂', question: '', quickReplies: [] },
      knowledgePoints: [],
    });
    const w = mountPage();
    await flushPromises();

    expect(w.find('.tutor__offline').exists()).toBe(false);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
    await nextTick();
    expect(w.find('.tutor__offline').exists()).toBe(true);
    expect(w.find('.tutor__offline').text()).toContain('当前网络已断开');

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
    await nextTick();
    expect(w.find('.tutor__offline').exists()).toBe(false);

    await w.find('.imm-menu__btn').trigger('click');
    await nextTick();
    expect(w.text()).toContain('下节生效');
  });

  it('5. 同路由切换 taskId 时重新调用 boot() 为新课开课', async () => {
    mockStartSession.mockImplementation(async (tid: string) => ({
      sessionId: tid === 'task-b' ? 's-task-b' : 's-task-a',
      revision: 0,
      mode: 'new',
      opening: { message: tid === 'task-b' ? '课程 B' : '课程 A', question: '', quickReplies: [] },
      knowledgePoints: [],
    }));

    const w = mountPage();
    await flushPromises();
    expect(mockStartSession).toHaveBeenCalledWith('task-a', undefined, { allowWebSupplement: true });

    mockRoute.params.taskId = 'task-b';
    await flushPromises();
    expect(mockStartSession).toHaveBeenCalledWith('task-b', undefined, { allowWebSupplement: true });
    expect(w.text()).toContain('课程 B');
    expect(w.text()).not.toContain('课程 A');
  });
});
