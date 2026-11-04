/* eslint-disable @typescript-eslint/no-explicit-any -- 挂载实例内部状态注入（w.vm as any），仓库测试桩同惯例 */
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

  it('P25 回归：服务端 409 门禁不随检查点收卡消失，改述为可再次结算', async () => {
    // 小测提交内含一次教学回合（数十秒）：回合落库前点结算必吃 PENDING_CHECKPOINT 409（横幅刚亮），
    // 回合落库后卡片按通过态自动收起——旧实现把刚亮的横幅一并抹掉，用户再点还是 409、全程零反馈
    // （2026-11-01 走查实测：后端日志 3×409、第 3 次无横幅截图）。
    api.startSession.mockResolvedValue({
      sessionId: 's_cp409',
      revision: 3,
      mode: 'resumed',
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 3,
      messages: [
        { role: 'user', content: '什么是线性一致？' },
        { role: 'assistant', content: '先看这张时序图。' },
      ],
      pendingCheckpoint: {
        id: 'cp_p25',
        type: 'single_choice',
        question: '下面哪个说法正确？',
        options: [
          { id: 'opt_a', text: '写后读总能看到新值' },
          { id: 'opt_b', text: '读到旧值不一定违反线性一致' },
        ],
      },
    });

    const w = await mountPage();
    expect(w.find('.checkpoint').exists(), '恢复的待处理检查点应挂卡').toBe(true);

    // 本地预检放行（判定已出、卡片仍在收尾窗口）后点结算：服务端仍拒绝（作答回合尚未落库）
    (w.vm as any).checkpointPassed = true;
    api.finalizeSessionReliably.mockRejectedValue({
      message: '还有一道题没有作答，先完成这道题再结束课堂',
      status: 409,
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_PENDING_CHECKPOINT', message: '还有一道题没有作答，先完成这道题再结束课堂' } },
      },
    });
    await clickCompleteAndSettle(w);
    expect(w.find('.gate').exists(), '服务端 409 应亮常驻门禁').toBe(true);
    expect(w.find('.gate').text()).toContain('先完成这道小测');

    // 卡片随后收起（提交回合落库后自动收卡 / 用户处理完收卡）：横幅不得被顺手清掉
    (w.vm as any).checkpoint = null;
    await flushPromises();
    const gate = w.find('.gate');
    expect(gate.exists(), 'P25：服务端亲口拒绝的门禁不能被收卡抹掉').toBe(true);
    expect(gate.text()).toContain('可再次结算');

    // 「知道了」仍是显式出口
    await gate.find('.gate__go').trigger('click');
    expect(w.find('.gate').exists()).toBe(false);

    w.unmount();
  });

  it('门禁按 409 原因细分引导：答了又被拦时说明「先回答 / 等这一轮讲完再结算」', async () => {
    // 2026-11-01 课堂走查：补答一次文字问题后导师紧接新问题 / 新小测，再点结算又吃 409——
    // 「答了又被拦」的循环缺少「先把这一轮讲完再结算」的引导。服务端 409 响应体带 error.code，
    // 横幅按原因各补一句「为什么被拦 + 现在该做什么」。
    // 2026-11-03 真人走查修正文案：原话「老师回应完这一轮，再来结算课堂」是空头支票（这位老师每轮
    // 都以提问收尾，实测连答 4 轮），改成如实说明「还可能再拦」+ 指出随时可用的出口。
    api.finalizeSessionReliably.mockRejectedValueOnce({
      message: '老师刚提了一个问题或请学员提交结果，先完成再结束课堂',
      status: 409,
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_OPEN_QUESTION', message: '老师刚提了一个问题或请学员提交结果，先完成再结束课堂' } },
      },
    });
    const w = await mountPage();
    await clickCompleteAndSettle(w);
    let gate = w.find('.gate');
    expect(gate.exists(), 'OPEN_QUESTION 409 应亮常驻门禁').toBe(true);
    expect(gate.text()).toContain('老师刚提了一个问题或请学员提交结果，先完成再结束课堂');
    const openGuide = gate.find('.gate__guide').text();
    expect(openGuide, 'OPEN_QUESTION 应引导先回答').toContain('回答它之后就能结算');
    expect(openGuide, '不得再承诺「老师回应完这一轮就能结算」这个可能不来的状态').not.toContain('再来结算课堂');
    expect(openGuide, '应如实说明可能被再拦一次').toContain('这里会再拦一次');
    expect(openGuide, '应指出随时可用的出口（结束学习不计入完成）').toContain('结束学习');
    // 再次结算、换一种原因：引导随原因切换
    api.finalizeSessionReliably.mockRejectedValueOnce({
      message: '还有一道题没有作答，先完成这道题再结束课堂',
      status: 409,
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_PENDING_CHECKPOINT', message: '还有一道题没有作答，先完成这道题再结束课堂' } },
      },
    });
    await clickCompleteAndSettle(w);
    gate = w.find('.gate');
    expect(gate.exists(), 'PENDING_CHECKPOINT 409 应亮常驻门禁').toBe(true);
    expect(gate.find('.gate__guide').text(), 'PENDING_CHECKPOINT 应引导答完小测、等老师讲完这轮').toContain('先答完这道小测');
    expect(gate.find('.gate__guide').text()).toContain('再来结算课堂');

    w.unmount();
  });

  /**
   * 活力兜底（2026-11-03 真人走查）：这位老师每轮都以提问收尾，「末问未答」无法被学员的动作满足
   * （实测连答 4 轮才等到一次不问的回应）。门禁卡给一颗明确确认按钮 → 照常结算，服务端只放行末问。
   */
  it('末问门禁可被学员明确确认放行：点「仍然完成结算」带 confirmOpenQuestion 重试', async () => {
    api.finalizeSessionReliably.mockRejectedValueOnce({
      message: '老师刚提了一个问题或请学员提交结果，先完成再结束课堂',
      status: 409,
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_OPEN_QUESTION', message: '老师刚提了一个问题或请学员提交结果，先完成再结束课堂' } },
      },
    });
    const w = await mountPage();
    await clickCompleteAndSettle(w);

    const gate = w.find('.gate');
    const still = gate.find('.gate__still');
    expect(still.exists(), '末问门禁应给「仍然完成结算」这颗明确确认').toBe(true);
    expect(gate.find('.gate__guide').text(), '文案要说明那一问会记进待验证').toContain('待验证');

    // 第二次结算：带上 confirmOpenQuestion，且门禁卡先收起
    api.finalizeSessionReliably.mockResolvedValueOnce({
      status: 'completed',
      revision: 3,
      session: { status: 'completed' },
      finalization: { taskCompletion: 'completed' },
      wrapup: { summary: { topicSummary: '这节课你理解了作用域。' } },
    });
    await still.trigger('click');
    await flushPromises();
    await flushPromises();

    const lastPayload = api.finalizeSessionReliably.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(lastPayload, '确认后的结算必须带 confirmOpenQuestion').toMatchObject({
      action: 'complete_task',
      confirmOpenQuestion: true,
    });
    expect(w.find('.gate').exists(), '确认后门禁卡应收起').toBe(false);
    expect(w.find('.finish').exists(), '确认后应正常进入结算完成态').toBe(true);

    w.unmount();
  });

  it('未答小测的门禁不给「仍然完成结算」（那是学员自己能解决的状态，仍硬拦）', async () => {
    api.finalizeSessionReliably.mockRejectedValueOnce({
      message: '还有一道题没有作答，先完成这道题再结束课堂',
      status: 409,
      response: {
        status: 409,
        data: { error: { code: 'FINALIZATION_PENDING_CHECKPOINT', message: '还有一道题没有作答，先完成这道题再结束课堂' } },
      },
    });
    const w = await mountPage();
    await clickCompleteAndSettle(w);
    expect(w.find('.gate').exists()).toBe(true);
    expect(w.find('.gate__still').exists(), '未答小测不应给放行按钮').toBe(false);

    w.unmount();
  });

  /**
   * 教室 ⋯「完成并结算任务」在本节已结算后仍然可点、点完毫无变化（2026-11-03 走查实锤）。
   * 那一刻 finish() 因 completed 直接 return，而确认框照常弹——用户得到的是一个会骗人的按钮。
   * 口径与解锁页、评估页一致：已结算就整组收起，换成一句状态说明。
   */
  it('本节已结算后，⋯ 菜单不再摆「完成并结算任务 / 结束学习」，改为一句话', async () => {
    api.finalizeSessionReliably.mockResolvedValue({
      status: 'completed',
      revision: 2,
      session: { status: 'completed' },
      finalization: { taskCompletion: 'completed' },
      wrapup: { summary: { topicSummary: '这节课你理解了作用域。' } },
    });

    const w = await mountPage();
    await clickCompleteAndSettle(w);
    await flushPromises();
    expect(w.find('.finish').exists(), '结算成功后应出结算浮层').toBe(true);

    // 再开 ⋯ 菜单：结算/结束两个入口都必须消失，换成「查看本次学习反馈」这个真动作
    await w.find('.imm-menu__btn').trigger('click');
    const labels = w.findAll('.learn__menu-item').map((b) => b.text());
    expect(labels.some((t) => t.includes('完成并结算任务')), '已结算不应再摆「完成并结算任务」').toBe(false);
    expect(labels.some((t) => t.includes('结束学习')), '已结算不应再摆「结束学习」').toBe(false);
    expect(labels.some((t) => t.includes('查看本次学习反馈')), '已结算应给反馈入口').toBe(true);
    // 「返回路径详情」仍在：已结算也要有离开课堂的出口
    expect(labels.some((t) => t.includes('返回路径详情'))).toBe(true);

    // 反馈入口：replace 到本会话的评估页（回退不该再回到终态教室）
    const feedback = w.findAll('.learn__menu-item').find((b) => b.text().includes('查看本次学习反馈'));
    await feedback!.trigger('click');
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('/learn/task_1/evaluation/s_settle'));

    w.unmount();
  });
});
