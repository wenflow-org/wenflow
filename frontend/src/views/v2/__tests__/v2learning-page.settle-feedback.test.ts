/**
 * #115「完成并结算」反馈断点（2026-10-20 复测）：
 *
 * 现象：两道收束门禁都满足后，任务约 60s 才变成 completed。这 60s 里没有 loading、
 * 没有阶段提示；结算成功后也不会自动进评估页；两条拦截提示只是 4s toast，一闪而过，
 * 用户很容易判成「点了没反应」。
 *
 * 钉住：结算期间出现带阶段与计时的浮层、服务端轮询能把阶段推进到「结算任务」；
 * 成功后可见倒计时并自动进入学习反馈（可取消）；门禁 409 落常驻页内提示而不是 toast。
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
  finalizeSessionReliably: vi.fn(),
  pauseSession: vi.fn().mockResolvedValue(1),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const askConfirm = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/utils/api', () => ({
  default: { get: api.requestGet, post: vi.fn() },
  API_BASE_URL: '/api',
}));

vi.mock('@/api/aiTeaching', () => ({
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
  useRouter: () => router,
}));

vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm }));

import V2LearningPage from '../V2LearningPage.vue';

async function mountPage() {
  const w = mount(V2LearningPage, {
    global: { stubs: { 'router-link': true } },
    attachTo: document.body,
  });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return w;
}

/** 打开 ⋯ 菜单并点「完成并结算任务」 */
async function clickCompleteAndSettle(w: Awaited<ReturnType<typeof mountPage>>) {
  await w.find('.imm-menu__btn').trigger('click');
  const item = w.findAll('.learn__menu-item').find((b) => b.text().includes('完成并结算任务'));
  expect(item, '菜单里应有「完成并结算任务」').toBeTruthy();
  await item!.trigger('click');
  await flushPromises();
}

describe('#115 结算进度与成功后的反馈入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.requestGet.mockResolvedValue({ title: '理解函数作用域', pathTitle: 'Python 入门路径', learningPathId: 'lp_1' });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    api.getSessionDetail.mockResolvedValue({ revision: 1, messages: [] });
    api.startSession.mockResolvedValue({
      sessionId: 's_settle',
      revision: 1,
      mode: 'new',
      opening: { message: '我们开始吧。' },
    });
    askConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('结算期间展示阶段与计时，轮询推进到结算任务；成功后倒计时自动进入学习反馈', async () => {
    let resolveFinalize!: (v: unknown) => void;
    let onProgress: ((state: unknown) => void) | null = null;
    api.finalizeSessionReliably.mockImplementation(
      (_sid: string, _payload: unknown, cb: (state: unknown) => void) => {
        onProgress = cb;
        return new Promise((resolve) => { resolveFinalize = resolve; });
      },
    );

    vi.useFakeTimers();
    const w = await mountPage();
    await clickCompleteAndSettle(w);

    // 浮层出现：第一步进行中，已开始计时
    expect(w.find('.settle').exists(), '结算期间必须有可见进度浮层').toBe(true);
    expect(w.find('.settle__card').text()).toContain('正在完成课堂结算');
    expect(w.find('.settle__card').text()).toContain('关闭课堂并生成本次总结');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.find('.settle__meta').text()).toContain('已等待 2 秒');

    // 服务端轮询：任务结算步进入 processing → 阶段推进到第二步
    onProgress!({ session: { status: 'completed' }, finalization: { taskCompletion: 'processing' } });
    await flushPromises();
    expect(w.find('.settle__step--active').text()).toContain('结算任务与更新路径进度');

    resolveFinalize({
      status: 'completed',
      revision: 2,
      session: { status: 'completed' },
      finalization: { taskCompletion: 'completed' },
      wrapup: { summary: { topicSummary: '这节课你理解了作用域。' } },
    });
    await flushPromises();
    await flushPromises();

    // 完成浮层 + 可见倒计时
    expect(w.find('.settle').exists()).toBe(false);
    expect(w.find('.finish').exists()).toBe(true);
    expect(w.find('.finish__auto').text()).toContain('秒后自动进入学习反馈');

    // 倒计时结束：自动进入学习反馈（replace，避免回退回到已终态的课堂）
    await vi.advanceTimersByTimeAsync(6_000);
    await flushPromises();
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('/learn/task_1/evaluation/s_settle'));

    w.unmount();
  });

  it('门禁 409 落常驻页内提示（不随 4s toast 消失），「去回答」把焦点交回输入区', async () => {
    api.finalizeSessionReliably.mockRejectedValue({
      message: '老师刚提了一个问题，先回答再结束课堂',
      status: 409,
      code: 'FINALIZATION_OPEN_QUESTION',
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_OPEN_QUESTION', message: '老师刚提了一个问题，先回答再结束课堂' } },
      },
    });

    const w = await mountPage();
    await clickCompleteAndSettle(w);

    // 不是一闪而过的 toast：提示留在页内，且结算浮层已收起
    expect(w.find('.settle').exists()).toBe(false);
    const gate = w.find('.gate');
    expect(gate.exists(), '收束门禁应有常驻页内提示').toBe(true);
    expect(gate.text()).toContain('先回答老师的问题');
    expect(gate.text()).toContain('老师刚提了一个问题，先回答再结束课堂');

    // 时间过去很久提示仍在
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.find('.gate').exists()).toBe(true);

    // 去向动作：焦点回到输入区
    await w.find('.gate__go').trigger('click');
    expect(document.activeElement).toBe(w.find('.composer__textarea').element);

    w.unmount();
  });

  it('结束学习（不计入完成）不展示「结算任务」阶段，也不承诺自动进反馈', async () => {
    let resolveFinalize!: (v: unknown) => void;
    api.finalizeSessionReliably.mockImplementation(() => new Promise((resolve) => { resolveFinalize = resolve; }));

    const w = await mountPage();
    await w.find('.imm-menu__btn').trigger('click');
    const item = w.findAll('.learn__menu-item').find((b) => b.text().includes('结束学习（不计入完成）'));
    expect(item).toBeTruthy();
    await item!.trigger('click');
    await flushPromises();

    const card = w.find('.settle__card');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('关闭课堂并生成本次总结');
    expect(card.text()).not.toContain('结算任务与更新路径进度');
    expect(card.text()).toContain('完成后会显示本次学习总结');

    resolveFinalize({ status: 'completed', revision: 2, session: { status: 'completed' }, finalization: { taskCompletion: 'skipped' } });
    await flushPromises();
    await flushPromises();
    expect(w.find('.finish__auto').exists()).toBe(false);

    w.unmount();
  });

  it('「留在此页」取消自动进入反馈', async () => {
    let resolveFinalize!: (v: unknown) => void;
    api.finalizeSessionReliably.mockImplementation(() => new Promise((resolve) => { resolveFinalize = resolve; }));

    vi.useFakeTimers();
    const w = await mountPage();
    await clickCompleteAndSettle(w);
    resolveFinalize({ status: 'completed', revision: 2, session: { status: 'completed' }, finalization: { taskCompletion: 'completed' } });
    await flushPromises();
    await flushPromises();

    await w.find('.finish__stay').trigger('click');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(router.replace).not.toHaveBeenCalled();

    w.unmount();
  });
});
