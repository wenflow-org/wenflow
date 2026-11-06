/**
 * 「待答小测被越过」提示的护栏（2026-11-06 走查）
 *
 * 后端出题闸门是硬拦：会话里只要还挂着 pendingCheckpoint，本回合及后续回合都不会再出题
 * （teaching-checkpoint.ts checkCheckpointEmission）。于是「第一道题不答、直接继续聊」
 * 的真实后果是——本节后面再没有小测，而界面原先零提示，用户只会觉得「怎么不考了」。
 *
 * 本护栏锁三件事：
 *  1) 有待答小测时用户又发了一条消息 → 卡片底部出现一行后果说明；
 *  2) 新回合下发同一道题（服务端不会清 pending，仍是同一 id）→ 说明继续保留；
 *  3) 收起（答完/跳过/已处理）或换成另一道题 → 说明复位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  requestGet: vi.fn(),
  startSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getLatestTaskEvaluation: vi.fn(),
  streamSendMessage: vi.fn(),
  sendMessage: vi.fn(),
  streamSubmitCheckpoint: vi.fn(),
  submitCheckpoint: vi.fn(),
  finalizeSessionReliably: vi.fn(),
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
    streamSubmitCheckpoint: api.streamSubmitCheckpoint,
    submitCheckpoint: api.submitCheckpoint,
    finalizeSessionReliably: api.finalizeSessionReliably,
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

const PENDING_CP = {
  id: 'cp_1',
  type: 'single_choice',
  title: '作用域小测',
  question: '下面哪个说法正确？',
  options: [
    { id: 'opt_a', text: '函数内声明的变量只在函数内可见' },
    { id: 'opt_b', text: '全局变量在任何地方都不可见' },
  ],
};

async function mountPage() {
  const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return w;
}

async function sendText(w: Awaited<ReturnType<typeof mountPage>>, text: string) {
  await w.find('.composer__textarea').setValue(text);
  await w.find('.composer__textarea').trigger('keydown', { key: 'Enter' });
  await flushPromises();
  await flushPromises();
}

describe('待答小测被越过：说明后果，而不是让用户以为小测坏了', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.requestGet.mockResolvedValue({ title: '作用域', pathTitle: '路径', learningPathId: 'lp_1' });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    api.startSession.mockResolvedValue({
      sessionId: 's_quiz',
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
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('不答直接继续聊 → 卡片出现「本节不再出新小测」的说明', async () => {
    /* 服务端在有待答检查点时不会再出题：同一道题原样随回合下发（同一 id） */
    api.streamSendMessage.mockResolvedValue({
      revision: 4,
      aiResponse: '那我们继续下一个话题。',
      checkpoint: PENDING_CP,
    });

    const w = await mountPage();
    expect(w.find('.checkpoint').exists(), '恢复待答小测应有卡片').toBe(true);
    expect(w.find('.checkpoint__aside').exists(), '刚打开就提示会太吵').toBe(false);

    await sendText(w, '先跳过这题，我想问个别的');

    expect(w.find('.checkpoint__aside').exists(), '越过小测后必须说明后果').toBe(true);
    expect(w.find('.checkpoint__aside').text()).toContain('本节才会出新的小测');

    w.unmount();
  });

  it('新回合又下发同一道题 → 说明继续保留（不是一闪而过）', async () => {
    api.streamSendMessage.mockResolvedValue({
      revision: 4,
      aiResponse: '继续。',
      checkpoint: PENDING_CP,
    });

    const w = await mountPage();
    await sendText(w, '再说说闭包');
    expect(w.find('.checkpoint__aside').exists()).toBe(true);

    await sendText(w, '还有呢');
    expect(w.find('.checkpoint__aside').exists(), '同一道题挂着，提示不该消失').toBe(true);

    w.unmount();
  });

  it('跳过 → 卡片与说明一起收起', async () => {
    api.streamSendMessage.mockResolvedValue({
      revision: 4,
      aiResponse: '继续。',
      checkpoint: PENDING_CP,
    });
    api.submitCheckpoint.mockResolvedValue({ revision: 5 });

    const w = await mountPage();
    await sendText(w, '先跳过');
    expect(w.find('.checkpoint__aside').exists()).toBe(true);

    await w.find('.checkpoint__skip').trigger('click');
    await flushPromises();

    expect(api.submitCheckpoint).toHaveBeenCalled();
    expect(w.find('.checkpoint').exists(), '跳过后卡片收起').toBe(false);
    expect(w.find('.checkpoint__aside').exists()).toBe(false);

    w.unmount();
  });

  it('换成另一道题 → 说明复位（新题还没被越过）', async () => {
    api.streamSendMessage.mockResolvedValueOnce({
      revision: 4,
      aiResponse: '继续。',
      checkpoint: PENDING_CP,
    });

    const w = await mountPage();
    await sendText(w, '先跳过');
    expect(w.find('.checkpoint__aside').exists()).toBe(true);

    api.streamSendMessage.mockResolvedValueOnce({
      revision: 5,
      aiResponse: '再来一道。',
      checkpoint: { ...PENDING_CP, id: 'cp_2', question: '闭包捕获的是什么？' },
    });
    await sendText(w, '出个新题');

    expect(w.find('.checkpoint').exists(), '新题卡片应渲染').toBe(true);
    expect(w.find('.checkpoint__aside').exists(), '新题还没被越过，不该带旧提示').toBe(false);

    w.unmount();
  });
});
