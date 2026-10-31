/**
 * #111 空 delta 击穿停滞看门狗回归（2026-10-20）：
 *
 * 看门狗口径是「90s 无**可见**进展即中止」。旧实现把任意 delta（含空文本）都当进展——
 * 网关吐一个空 chunk 心跳就能永久喂住看门狗：AI 气泡是空的、无失败提示、发送键一直
 * 卡「停止生成」，用户只能刷新（刷新后服务端已完成的回复才出现）。
 *
 * 钉住：空 delta 不建气泡、不喂狗；90s 到点真正 abort，落「回复超时」失败气泡并复位发送键。
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
  createTeachingIdempotencyKey: (scope: string) => `test-${scope}`,
  aiTeachingAPI: {
    startSession: api.startSession,
    startReviewSession: vi.fn(),
    startExtensionSession: vi.fn(),
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

async function mountPage() {
  const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return w;
}

describe('#111 空 delta 不喂停滞看门狗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.requestGet.mockResolvedValue({
      title: '理解函数作用域',
      pathTitle: 'Python 入门路径',
      learningPathId: 'lp_1',
    });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    api.startSession.mockResolvedValue({
      sessionId: 's_stall',
      revision: 1,
      mode: 'new',
      opening: { message: '我们开始吧。' },
    });
  });

  it('空文本 delta 不建气泡也不重置看门狗；90s 到点中止并落「回复超时」', async () => {
    const w = await mountPage();

    let onDeltaRef: ((t: string) => void) | null = null;
    let streamSignal: AbortSignal | null = null;
    api.streamSendMessage.mockImplementation((_sid: string, _text: string, _rev: number, handlers: { onDelta: (t: string) => void; signal?: AbortSignal }) => {
      onDeltaRef = handlers.onDelta;
      streamSignal = handlers.signal ?? null;
      // 模拟真实 fetch：signal 中止即 reject（AbortError），不 abort 就永远挂起
      return new Promise((_resolve, reject) => {
        handlers.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    });

    await w.find('.composer__textarea').setValue('第五条消息');
    // 看门狗在 doSend 里同步创建：fake timers 必须先于发送启用
    vi.useFakeTimers();
    await w.find('.composer__textarea').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(onDeltaRef).toBeTruthy();
    expect(w.find('.composer__send--stop').exists(), '发送中显示停止键').toBe(true);

    try {
      // t=89s：网关吐空 chunk（旧实现此刻会建出空气泡并把看门狗续到 179s）
      await vi.advanceTimersByTimeAsync(89_000);
      onDeltaRef!('');
      await flushPromises();
      // 未建内容气泡：typing 指示器仍在（若建了气泡，指示器会被 v-if 撤掉）
      expect(w.find('.msg__bubble--typing').exists(), '空 delta 不得建空气泡').toBe(true);

      // t=91s：看门狗到点（从发送起算 90s，未被空 delta 续命）
      await vi.advanceTimersByTimeAsync(2_000);
      expect(streamSignal!.aborted, '看门狗应真正中止流式请求').toBe(true);
      await flushPromises();
      await flushPromises();

      const failed = w.findAll('.msg--ai').filter((m) => m.text().includes('回复超时'));
      expect(failed, '应落可见的超时失败气泡').toHaveLength(1);
      expect(w.find('.composer__send--stop').exists(), '发送键必须复位，不再卡「停止生成」').toBe(false);
    } finally {
      vi.useRealTimers();
    }

    w.unmount();
  });
});
