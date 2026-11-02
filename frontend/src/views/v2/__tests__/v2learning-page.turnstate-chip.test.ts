/**
 * 2026-11-01 课堂走查「板书到达前无任何提示」回归：
 *
 * 板书（figures/board）只随 SSE final 一次下发（delta 只带正文，board 在回合后处理阶段
 * 才产出附件），流式中途前端无法区分「会有板书」与「没有板书」——不造假提示，只给
 * 必然为真的「本回合仍在生成」轻量 chip：讲解文本已开始上屏（流式气泡已建）但 final
 * 未到时显示；final 到达（typing 复位）即消失。首字节未到仍是既有三连点气泡，不叠加。
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

describe('本回合仍在生成 chip（板书到达前的诚实提示）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.requestGet.mockResolvedValue({
      title: '理解浮力',
      pathTitle: '物理入门路径',
      learningPathId: 'lp_1',
    });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    api.startSession.mockResolvedValue({
      sessionId: 's_chip',
      revision: 1,
      mode: 'new',
      opening: { message: '我们开始吧。' },
    });
  });

  it('正文已上屏、final 未到 → chip 显示；final 到达 → 消失', async () => {
    const w = await mountPage();

    let onDeltaRef: ((t: string) => void) | null = null;
    let resolveTurn!: (v: unknown) => void;
    api.streamSendMessage.mockImplementation((_sid: string, _text: string, _rev: number, handlers: { onDelta: (t: string) => void }) => {
      onDeltaRef = handlers.onDelta;
      return new Promise((resolve) => { resolveTurn = resolve; });
    });

    await w.find('.composer__textarea').setValue('讲讲浮力');
    await w.find('.composer__textarea').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    // 首字节未到：只有既有三连点气泡，不叠加 chip
    expect(w.find('.msg__bubble--typing').exists(), '等待首字节仍是三连点气泡').toBe(true);
    expect(w.find('.msg__turnstate').exists()).toBe(false);

    // 正文开始上屏（流式气泡已建）、final 未到：chip 显示，措辞必然为真（不承诺板书）
    onDeltaRef!('浮力是浸在液体里的物体受到的…');
    await flushPromises();
    expect(w.find('.msg__bubble--typing').exists()).toBe(false);
    const chip = w.find('.msg__turnstate');
    expect(chip.exists(), '正文上屏后、final 前应有「仍在生成」状态 chip').toBe(true);
    expect(chip.text()).toContain('本回合仍在生成');

    // final 到达（板书随 final 一并下发）：chip 消失
    resolveTurn({ aiResponse: '浮力是浸在液体里的物体受到的…', revision: 2, figures: [] });
    await flushPromises();
    await flushPromises();
    expect(w.find('.msg__turnstate').exists(), 'final 到达后 chip 应消失').toBe(false);

    w.unmount();
  });

  it('回合失败 → chip 一并消失，不残留常驻转圈', async () => {
    const w = await mountPage();

    let onDeltaRef: ((t: string) => void) | null = null;
    let rejectTurn!: (e: unknown) => void;
    api.streamSendMessage.mockImplementation((_sid: string, _text: string, _rev: number, handlers: { onDelta: (t: string) => void }) => {
      onDeltaRef = handlers.onDelta;
      return new Promise((_resolve, reject) => { rejectTurn = reject; });
    });

    await w.find('.composer__textarea').setValue('再讲一点');
    await w.find('.composer__textarea').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    onDeltaRef!('部分内容');
    await flushPromises();
    expect(w.find('.msg__turnstate').exists()).toBe(true);

    rejectTurn(Object.assign(new Error('网络错误'), { serverError: true }));
    await flushPromises();
    await flushPromises();
    expect(w.find('.msg__turnstate').exists(), '失败后 chip 不得残留').toBe(false);

    w.unmount();
  });
});
