/**
 * #7 窄屏检查点出现时把消息区重新钉到底（贴底跟随）。
 *
 * 检查点/快捷块是消息滚动区之后的 flex 兄弟，出现时压缩滚动区；本用例验证「恢复待处理
 * 检查点」这条无回合结果的路径会把滚动区重新滚到底（让被截断的代码块完整落入视野）。
 * jsdom 无布局，用 prototype 覆盖 scrollHeight 造出可观测的滚动量（仅限 .tutor__scroll）。
 * 真正的窄屏视觉（800px 视口下的截断）无法在单测里复现，见交付说明。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  requestGet: vi.fn(),
  startSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getLatestTaskEvaluation: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  default: { get: api.requestGet, post: vi.fn() },
  API_BASE_URL: '/api',
}));

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    startSession: api.startSession,
    startReviewSession: vi.fn(),
    getSessionDetail: api.getSessionDetail,
    getLatestTaskEvaluation: api.getLatestTaskEvaluation,
    streamSendMessage: vi.fn(),
    sendMessage: vi.fn(),
    streamContinueSession: vi.fn(),
    streamSubmitCheckpoint: vi.fn(),
    submitCheckpoint: vi.fn(),
    finalizeSessionReliably: vi.fn(),
    pauseSession: vi.fn().mockResolvedValue(1),
    resumeSession: vi.fn(),
    resetSession: vi.fn(),
    streamSendPeerMessage: vi.fn(),
    sendPeerMessage: vi.fn(),
  },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 'task_1' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import V2LearningPage from '../V2LearningPage.vue';

const PENDING_CP = {
  id: 'cp_7',
  type: 'single_choice',
  title: '作用域小测',
  question: '下面哪个说法正确？',
  options: [
    { id: 'opt_a', text: '函数内声明的变量只在函数内可见' },
    { id: 'opt_b', text: '全局变量在任何地方都不可见' },
  ],
};

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

async function mountPage() {
  const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return w;
}

describe('#7 检查点出现时消息区贴底跟随', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.requestGet.mockResolvedValue({ title: '作用域', pathTitle: '路径', learningPathId: 'lp_1' });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    // 造一个可观测的滚动量：.tutor__scroll 的 scrollHeight = 1000
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains('tutor__scroll') ? 1000 : 0;
      },
    });
  });

  afterEach(() => {
    if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
  });

  it('恢复待处理检查点时，滚动区被重新钉到底', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_cp7',
      revision: 3,
      mode: 'resumed',
      scene: { kind: 'resume', title: '接着上次' },
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 3,
      messages: [
        { role: 'user', content: '什么是作用域？' },
        { role: 'assistant', content: '作用域是变量的可见范围。' },
      ],
      pendingCheckpoint: PENDING_CP,
    });

    const w = await mountPage();

    // 检查点卡片已渲染（压缩了消息区）
    expect(w.find('.checkpoint').exists()).toBe(true);
    // 消息滚动区被顶到底（scrollTop === scrollHeight）
    const el = w.find('.tutor__scroll').element as HTMLElement;
    expect(el.scrollTop).toBe(1000);

    w.unmount();
  });
});
