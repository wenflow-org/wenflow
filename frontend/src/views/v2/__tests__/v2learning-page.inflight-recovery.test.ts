/**
 * #6 流式中途刷新静默丢失 —— 前端在途消息留痕（sessionStorage）恢复回归。
 *
 * 机制：教学回合把「用户消息 + 导师回复」一次性原子落库；请求级 abortSignal 绑在
 * res.close 上（acp-context.middleware），流式中途刷新会 abort 底层 LLM 调用 → 回合在
 * 落库前被取消 → 服务端历史里既没有用户消息也没有回复。
 *
 * 此处只验证前端一侧的可测行为（真正的「响应头之前刷新」无法在单测里复现，见交付说明）：
 * 1) doSend 发送即写入留痕；收到 final（送达确认）即清除留痕；
 * 2) 重进会话时，若服务端历史不含留痕里的那条用户消息 → 恢复用户气泡 + 失败提示（可重发）；
 * 3) 若服务端历史已含该条 → 清除留痕，不重复渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  requestGet: vi.fn(),
  startSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getLatestTaskEvaluation: vi.fn(),
  streamSendMessage: vi.fn(),
  sendMessage: vi.fn(),
  pauseSession: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/utils/api', () => ({
  default: { get: api.requestGet, post: vi.fn() },
  API_BASE_URL: '/api',
}));

vi.mock('@/api/aiTeaching', () => ({
  createTeachingIdempotencyKey: (scope: string) => `${scope}:test-key`,
  aiTeachingAPI: {
    startSession: api.startSession,
    startReviewSession: vi.fn(),
    getSessionDetail: api.getSessionDetail,
    getLatestTaskEvaluation: api.getLatestTaskEvaluation,
    streamSendMessage: api.streamSendMessage,
    sendMessage: api.sendMessage,
    streamContinueSession: vi.fn(),
    streamSubmitCheckpoint: vi.fn(),
    submitCheckpoint: vi.fn(),
    finalizeSessionReliably: vi.fn(),
    pauseSession: api.pauseSession,
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

const INFLIGHT_KEY = 'wf.learn.inflight.';

function mockTaskInfo() {
  api.requestGet.mockResolvedValue({
    title: '理解函数作用域',
    pathTitle: 'Python 入门路径',
    learningPathId: 'lp_1',
  });
}

async function mountPage() {
  const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return w;
}

describe('#6 在途消息留痕恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockTaskInfo();
    api.getLatestTaskEvaluation.mockResolvedValue({});
  });

  it('发送即留痕；未确认送达前不被清除', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_inflight',
      revision: 1,
      mode: 'new',
      opening: { message: '我们开始吧。', question: '准备好了吗？', quickReplies: [{ text: '开始' }] },
    });
    // 流式请求悬而未决 = 刷新落在响应头之前（回合未送达）
    api.streamSendMessage.mockReturnValue(new Promise(() => {}));

    const w = await mountPage();
    await w.find('.composer__textarea').setValue('我的问题');
    await w.find('.composer__textarea').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    const raw = window.sessionStorage.getItem(INFLIGHT_KEY + 's_inflight');
    expect(raw, '发送后应写入在途留痕').toBeTruthy();
    expect(JSON.parse(raw as string).text).toBe('我的问题');
    // 用户气泡乐观渲染
    expect(w.find('.msg--user').text()).toContain('我的问题');

    w.unmount();
  });

  it('重进时服务端历史不含该消息 → 恢复用户气泡 + 失败提示（不再静默丢失）', async () => {
    // 模拟刷新前留下的在途痕迹
    window.sessionStorage.setItem(
      INFLIGHT_KEY + 's_inflight_resume',
      JSON.stringify({ text: '刚发出的问题', revision: 1, ts: Date.now() })
    );
    api.startSession.mockResolvedValue({
      sessionId: 's_inflight_resume',
      revision: 1,
      mode: 'resumed',
      scene: { kind: 'resume', title: '接着上次的作用域' },
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 1,
      // 服务端历史里没有「刚发出的问题」——回合在落库前被 abort
      messages: [],
    });

    const w = await mountPage();

    const userMsgs = w.findAll('.msg--user');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].text()).toContain('刚发出的问题');
    // 失败提示 + 重试入口可见（不能无声消失）
    const failedAi = w.findAll('.msg--ai').filter((m) => m.text().includes('没有送达'));
    expect(failedAi).toHaveLength(1);
    expect(failedAi[0].find('.msg__retry').exists()).toBe(true);

    w.unmount();
  });

  it('重进时服务端历史已含该消息 → 清除留痕、不重复渲染', async () => {
    window.sessionStorage.setItem(
      INFLIGHT_KEY + 's_landed',
      JSON.stringify({ text: '已经送达的问题', revision: 2, ts: Date.now() })
    );
    api.startSession.mockResolvedValue({
      sessionId: 's_landed',
      revision: 2,
      mode: 'resumed',
      scene: { kind: 'resume', title: '接着上次' },
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 2,
      messages: [
        { role: 'user', content: '已经送达的问题' },
        { role: 'assistant', content: '好的，我们来看。' },
      ],
    });

    const w = await mountPage();

    // 历史里那条用户消息只渲染一次（不是留痕再补一条）
    const userMsgs = w.findAll('.msg--user').filter((m) => m.text().includes('已经送达的问题'));
    expect(userMsgs).toHaveLength(1);
    // 没有「未送达」失败气泡
    expect(w.findAll('.msg--ai').some((m) => m.text().includes('没有送达'))).toBe(false);
    // 留痕被清除
    expect(window.sessionStorage.getItem(INFLIGHT_KEY + 's_landed')).toBeNull();

    w.unmount();
  });
});
