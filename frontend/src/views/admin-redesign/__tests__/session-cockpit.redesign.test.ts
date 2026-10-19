/**
 * SessionCockpit 会话监控页骨架对齐原型 renderSessionDetail（2026-10-01 重排）。
 *
 * 断言 = 原型版式的每一块 + 数据诚实性：
 *  - hero（头像「S」/ 会话主题主标题 + 会话 ID 副行 meta（2026-10-04 批次五 P2-7）/ 学习者·科目·开始于副文 /
 *    状态 + 阶段 pills——回合 pill 已撤（P3#13：回合数单源=阶段推进卡）/ 真实能力动作）
 *  - 教学闭环定位（原型 .loop 五环）2026-10-19 拍板下线：与下方 stepper 同源同态、属纯重复，
 *    本文件只保留「不得回归」的断言
 *  - 阶段推进（.stepper done/active/idle 三态 + 卡头「已完成 N / 4 阶段」+ statstrip 三读数）
 *  - 双栏 grid(1.5fr/1fr)：回合记录表（# / 类型 / 内容 / 时间；原型 Token/耗时/解答分无真数据不硬造）
 *    + 知识状态更新 ranklist（真实掌握度；无数据整卡不渲染）
 *  - 保留功能：advisory 条、stepper 步点即阶段页签导航
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import SessionCockpit from '../SessionCockpit.vue';
import { subPage } from '../store';
import { confirmState, settleConfirm } from '../useConfirm';

const { stableVirtualApi, apiObject } = vi.hoisted(() => {
  const stableVirtualApi = {
    getVirtualSession: vi.fn(),
    getVirtualSessionLogs: vi.fn(),
    getVirtualSessionPathStatus: vi.fn(),
    getVirtualSessionTeachingDetail: vi.fn(),
    getRealSessionConsole: vi.fn(),
    updateSessionSimulationConfig: vi.fn(),
    deleteVirtualSession: vi.fn(),
    virtualSessionStep: vi.fn(),
    virtualSessionAuto: vi.fn(),
    virtualSessionRunFull: vi.fn(),
    virtualSessionAdvancePath: vi.fn(),
    reviewVirtualSessionPath: vi.fn(),
    acceptVirtualSessionPath: vi.fn(),
    replanVirtualSessionPath: vi.fn(),
    startVirtualLearning: vi.fn(),
    virtualSessionLearningStep: vi.fn(),
    virtualSessionAutoLearning: vi.fn(),
    virtualSessionWrapup: vi.fn(),
    stopVirtualLearning: vi.fn(),
    restartVirtualSessionPath: vi.fn(),
    restartVirtualLearning: vi.fn(),
    executeBlackboxVirtualAction: vi.fn(),
    rerunBlackboxVirtualSession: vi.fn(),
    getVirtualSessionSimulationClock: vi.fn()
  };
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  return { stableVirtualApi, apiObject };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: stableVirtualApi,
  adminAuthApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true)
}));

/** 真实教学会话载荷：含 subject/startTime/knowledgeState/advisory/goal+课堂消息（进行中）
 * 返回 any：结构随端点演化、用例中就地置 null 降级，不必强类型化（同 sessionCockpit.real.test.ts 口径；
 * 该文件在 .eslintrc allowlist，本文件不在——就地 disable，2026-10-04 批次五顺手补漏） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function realTeachingPayload(): any {
  const learningMessages = [
    { role: 'user', content: '我不理解函数参数', time: '2026-09-30T09:01:00.000Z' },
    { role: 'assistant', content: '参数是函数定义里的占位变量…', time: '2026-09-30T09:01:10.000Z' }
  ];
  return {
    data: {
      kind: 'teaching',
      sessionId: 'ts_re_1',
      goal: { conversationId: 'gc_1', stage: 'completed', status: 'completed', ready: true, confidence: 0.8, messageCount: 1 },
      path: null,
      teaching: {
        teachingSessionId: 'ts_re_1',
        taskId: 'task_1',
        taskTitle: '函数练习',
        subject: 'Python 入门',
        topic: '函数',
        status: 'running',
        startTime: '2026-09-30T09:00:00.000Z',
        messageCount: 2,
        knowledgeState: [
          { name: '变量与赋值', status: 'mastered', progress: 92 },
          { name: '函数参数', status: 'learning', progress: 46 },
          { name: '作用域', status: 'review', progress: null }
        ],
        wrapup: null,
        advisory: { priority: 'high', title: '学习者连续两次卡在参数概念', text: '建议下轮降低抽象度' },
        messages: learningMessages
      },
      evaluation: { total: 0, types: [] },
      timeline: [],
      runtime: {
        status: 'running',
        currentStage: 'teaching',
        stageStatus: {
          goal: { conversationId: 'gc_1', ready: true },
          path: { learningPathId: 'lp_1', generated: true },
          learning: { teachingSessionId: 'ts_re_1', currentTaskId: 'task_1', manualStop: false }
        },
        bindings: { goalConversationId: 'gc_1', learningPathId: 'lp_1', teachingSessionId: 'ts_re_1', currentTaskId: 'task_1' }
      },
      conversations: {
        goal: {
          messages: [
            { role: 'user', content: '我想学 Python', time: '2026-09-30T08:30:00.000Z' },
            { role: 'assistant', content: '好的，先聊聊你的基础…', time: '2026-09-30T08:30:10.000Z' }
          ]
        },
        learning: { messages: learningMessages }
      },
      stageResults: {
        goal: { ready: true },
        path: { id: 'lp_1' },
        teaching: { teachingSessionId: 'ts_re_1', wrapup: null },
        blackbox: null
      },
      advisory: { priority: 'high', title: '学习者连续两次卡在参数概念', text: '建议下轮降低抽象度' }
    }
  };
}

/** 虚拟会话载荷：Learn 进行中（goal/path 已过、learning 当前、wrapup 未进），无任何知识数据 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function virtualLearningPayload(): any {
  return {
    data: {
      status: 'active',
      currentStage: 'teaching',
      stageResults: {
        goal: { stage: 'completed', ready: true },
        path: { id: 'lp_v1' },
        teaching: { teachingSessionId: null, currentTaskId: null, wrapup: null }
      },
      runtime: {
        status: 'active',
        currentStage: 'teaching',
        stageStatus: {
          goal: { conversationId: 'gc_v1', ready: true },
          path: { learningPathId: 'lp_v1', generated: true },
          learning: { teachingSessionId: null, currentTaskId: null, manualStop: false }
        },
        bindings: { goalConversationId: 'gc_v1', learningPathId: 'lp_v1', teachingSessionId: null, currentTaskId: null }
      },
      conversations: {
        goal: { messages: [{ role: 'user', content: '我想学 Python', time: '2026-09-30T08:30:00.000Z' }] },
        learning: {
          messages: [
            { role: 'user', content: '开始上课吧', timestamp: '2026-09-30T10:00:00.000Z' },
            { role: 'assistant', content: '好的，我们从一个例子开始…', timestamp: '2026-09-30T10:00:05.000Z' }
          ]
        }
      },
      profile: { userName: '王小明' }
    }
  };
}

/** 黑盒会话载荷（报告 #37）：experiment+blackbox 双键触发 isBlackbox，status 由用例给定 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blackboxPayload(status: string): any {
  return {
    data: {
      id: 'vs_bb_1',
      status,
      currentStage: 'teaching',
      stageResults: {
        experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
        blackbox: { publicTrace: [{ timestamp: '2026-10-04T10:00:00.000Z', observation: { stage: 'goal' } }] },
        goal: {}, path: {}, teaching: {}
      },
      runtime: { status, currentStage: 'teaching', stageStatus: {}, bindings: {} },
      conversations: { goal: { messages: [] }, learning: { messages: [] } },
      profile: { userName: '黑盒员' }
    }
  };
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
}

async function mountCockpit(view: 'session' | 'session-real', id: string) {
  subPage.value = { view, id };
  const wrapper = mount(SessionCockpit, { attachTo: document.body });
  await settle();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  subPage.value = null;
  stableVirtualApi.getVirtualSessionLogs.mockResolvedValue({ data: { logs: [] } });
  stableVirtualApi.getVirtualSessionPathStatus.mockResolvedValue({ data: {} });
  stableVirtualApi.getVirtualSessionTeachingDetail.mockResolvedValue({ data: {} });
  stableVirtualApi.getVirtualSessionSimulationClock.mockResolvedValue({ data: null });
});

describe('SessionCockpit 会话监控页（renderSessionDetail 骨架落点）', () => {
  it('hero：头像 S + 会话主题主标题 + ID 副行 meta + 科目/开始于副文 + 状态/阶段 pills；真实能力动作，不搬原型假钮', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    expect(w.find('.mk-hero__avatar').text()).toBe('S');
    // 主标题 = 会话主题（teaching.topic）：截断裸 ID 不再做 24px/700 主标题（2026-10-04 全站评审 P2-7）
    expect(w.find('.mk-hero__title').text()).toBe('函数');
    // 会话 ID 降为 pills 行 meta（mono 小字，title 带全量 ID）
    const idMeta = w.find('.cp-hero__id');
    expect(idMeta.text()).toBe('ts_re_1');
    expect(idMeta.attributes('title')).toBe('会话 ID：ts_re_1');
    const sub = w.find('.mk-hero__sub').text();
    expect(sub).toContain('Python 入门');
    expect(sub).toContain('开始于');

    // 回合 pill 撤（2026-10-04 批次五 P3#13）：回合数单源=「阶段推进」卡 statstrip「已用回合」格
    const pills = w.findAll('.mk-hero__pills .mk-badge').map((b) => b.text());
    expect(pills[0]).toBe('进行中');
    expect(pills[1]).toBe('学习');
    // 只读声明（原顶栏 meta 迁入，2026-10-11 走查：真实会话不再渲染 .cp-topbar）
    expect(pills[2]).toBe('真实会话 · 只读监控');
    expect(pills).toHaveLength(3);

    // 真实会话只读：hero 动作区只有本页动作（刷新 + 返回），无生命周期控制、
    // 原型假钮（导出日志）与危险动作（中断会话）不出现
    const acts = w.findAll('.mk-hero__actions button').map((b) => b.text());
    expect(acts).toEqual(['刷新', '← 会话列表']);
    expect(w.text()).not.toContain('导出日志');
    expect(w.text()).not.toContain('中断会话');

    w.unmount();
  });

  it('黑盒人工入口（报告 #37）：终止实验 + 按原输入重跑（仅终态可跑）；辅助模式不出现', async () => {
    // 进行中黑盒：终止可用、重跑禁用（后端契约：只有终态实验可按原输入重跑）
    stableVirtualApi.getVirtualSession.mockResolvedValue(blackboxPayload('active'));
    const running = await mountCockpit('session', 'vs_bb_1');
    const runningBtns = running.findAll('.cp-console__actions button');
    expect(runningBtns.map((b) => b.text())).toEqual(['终止实验', '按原输入重跑']);
    expect(runningBtns.find((b) => b.text() === '终止实验')!.attributes('disabled')).toBeUndefined();
    expect(runningBtns.find((b) => b.text() === '按原输入重跑')!.attributes('disabled')).toBeDefined();
    running.unmount();

    // 终态黑盒：重跑可点 —— 会新建会话 + 重新消耗 AI 调用，故先二次确认（2026-10-19 运营走查）
    stableVirtualApi.getVirtualSession.mockResolvedValue(blackboxPayload('completed'));
    stableVirtualApi.rerunBlackboxVirtualSession.mockResolvedValue({ data: { data: { id: 'vs_bb_new' } } });
    const done = await mountCockpit('session', 'vs_bb_1');
    const doneRerun = done.findAll('.cp-console__actions button').find((b) => b.text() === '按原输入重跑')!;
    expect(doneRerun.attributes('disabled')).toBeUndefined();
    await doneRerun.trigger('click');
    await settle();
    // 弹确认框、且此刻还没打扰后端
    expect(confirmState.open).toBe(true);
    expect(confirmState.title).toBe('按原输入重跑');
    expect(confirmState.message).toContain('消耗新的 AI 调用');
    expect(stableVirtualApi.rerunBlackboxVirtualSession).not.toHaveBeenCalled();
    // 取消 → 不发请求（原实现直接重跑，无任何确认）
    settleConfirm(false);
    await settle();
    expect(stableVirtualApi.rerunBlackboxVirtualSession).not.toHaveBeenCalled();
    // 二次点击并确认 → 才发请求
    await doneRerun.trigger('click');
    await settle();
    settleConfirm(true);
    await settle();
    expect(stableVirtualApi.rerunBlackboxVirtualSession).toHaveBeenCalledWith('vs_bb_1');
    done.unmount();

    // 辅助模式：黑盒人工入口不出现
    stableVirtualApi.getVirtualSession.mockResolvedValue(virtualLearningPayload());
    const assisted = await mountCockpit('session', 'vs_1');
    expect(assisted.findAll('.cp-console__actions button').map((b) => b.text())).not.toContain('终止实验');
    assisted.unmount();
  });

  it('「每课回合上限」写明是本屏临时覆盖（2026-10-19 运营走查：title 原写「按 1 或 100 保存」，实际刷新即回到画像默认值）', async () => {
    stableVirtualApi.getVirtualSession.mockResolvedValue(virtualLearningPayload());
    const w = await mountCockpit('session', 'vs_1');
    await w.findAll('.cp-stp')[2].trigger('click'); // Learn 页签（回合上限只在这一页出现）
    await settle();
    const cap = w.find('.cp-turn-cap');
    expect(cap.exists()).toBe(true);
    // 输入框：不许再出现「保存」；必须说明是临时值 + 长期值在哪
    expect(cap.attributes('title')).not.toContain('保存');
    expect(cap.attributes('title')).toContain('本屏是临时值');
    expect(cap.attributes('title')).toContain('运行预算');
    expect(w.find('.cp-turn-cap-label').attributes('title')).toContain('画像「运行预算 · 每课回合上限」');
    w.unmount();
  });

  it('「教学闭环定位」卡已下线（2026-10-19 用户走查「这不重复吗」→ 拍板删卡）：五环与 stepper 同源同态，属纯重复', async () => {
    // 原卡：前四环由 stageDone/stageActive 派生（与下方 stepper 同一对判据）、第五环「记忆复习」
    // 无对应阶段恒「未进入」，即不含 stepper 之外的任何会话状态，只多出一套更长的阶段名。
    // 负信息修正（2026-10-06 审核 #46）随之失去载体——阶段状态唯一落点是 stepper 瓦片。
    stableVirtualApi.getVirtualSession.mockResolvedValue(virtualLearningPayload());
    const w = await mountCockpit('session', 'vs_1');
    expect(w.findAll('.cp-loop__step')).toHaveLength(0);
    expect(w.findAll('.cp-loop__arrow')).toHaveLength(0);
    expect(w.text()).not.toContain('教学闭环定位');
    // 阶段状态仍完整可读（迁移目标在位）：四枚瓦片 + done/active/idle
    const steps = w.findAll('.cp-stp');
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.classes().find((c) => c.startsWith('cp-stp--')))).toEqual([
      'cp-stp--done', 'cp-stp--done', 'cp-stp--active', 'cp-stp--idle'
    ]);
    w.unmount();

    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const real = await mountCockpit('session-real', 'ts_re_1');
    expect(real.text()).not.toContain('教学闭环定位');
    real.unmount();
  });

  it('阶段推进：stepper done/active/idle 三态 + 卡头 N/4 + statstrip 三读数；步点点击切换阶段页签', async () => {
    stableVirtualApi.getVirtualSession.mockResolvedValue(virtualLearningPayload());
    const w = await mountCockpit('session', 'vs_1');

    const steps = w.findAll('.cp-stp');
    expect(steps).toHaveLength(4);
    expect(steps[0].classes()).toContain('cp-stp--done');
    expect(steps[1].classes()).toContain('cp-stp--done');
    expect(steps[2].classes()).toContain('cp-stp--active');
    expect(steps[2].find('.cp-stp__meta').text()).toBe('进行中');
    expect(steps[3].classes()).toContain('cp-stp--idle');
    expect(steps[3].find('.cp-stp__meta').text()).toBe('待进入');
    // done 步点 = ✓ 字标 + 真实 meta（Goal 学习者发言数）；无真实数字的阶段不硬造。
    // 口径 2026-10-06 审核 §主题 4：原「对话 N 轮」数的是含平台回复的全量消息，
    // 与同卡 statstrip「已用回合」（只数 user）打架；现统一为只数学习者发言。
    expect(steps[0].find('.cp-stp__dot').text()).toBe('✓');
    expect(steps[0].find('.cp-stp__meta').text()).toBe('学习者发言 1');
    expect(steps[1].find('.cp-stp__meta').text()).toBe('已完成');

    // 卡头右侧完成计数
    expect(w.find('.cp-stepcard').text()).toContain('已完成');
    expect(w.find('.cp-stepcard').text()).toContain('/ 4 阶段');

    // 2026-10-12 重设计：卡下方的 MkStatStrip 三读数（当前阶段/已用回合/下一阶段）撤——
    // 前两者步点阵自身已表达，「已用回合」与 Goal 步点「学习者发言 N」近重复且两次被误读
    expect(w.find('.cp-stepstrip').exists()).toBe(false);
    expect(w.findAll('.cp-stepcard .mk-stat')).toHaveLength(0);

    // stepper 步点即阶段页签（原 cp-stage tab 导航收敛至此）：点击 Goal → Goal 对话卡出现
    await steps[0].trigger('click');
    await settle();
    expect(w.find('[role="tabpanel"][aria-labelledby="cp-tab-goal"]').exists()).toBe(true);
    expect(w.text()).toContain('目标对话');

    w.unmount();
  });

  it('回合记录：真实会话不渲染（阶段面板已承载同一份转录，同屏再列一张是重复）', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    // 2026-10-11 走查「goal 阶段对话记录会和记录会不会重复了」：真实控制台的阶段面板就是转录本体，
    // 回合记录曾是它的表格翻版（也曾把 Goal 段错拼进来），故真实模式整卡不渲染。
    expect(w.find('.cp-turns').exists()).toBe(false);
    expect(w.text()).not.toContain('回合记录');
    // 2026-10-18 用户走查「这类文案」：装配自述句（按序合并）从可见 meta 撤下，
    // 范围事实留「目标与课堂两段」，合并规则进卡头 title
    expect(w.text()).not.toContain('按序合并');

    w.unmount();
  });

  it('回合记录：虚拟会话两段合并且按序（一个会话就是完整旅程；卡归位 Goal 页）', async () => {
    stableVirtualApi.getVirtualSession.mockResolvedValue(virtualLearningPayload());
    const w = await mountCockpit('session', 'vs_1');
    await w.findAll('.cp-stp')[0].trigger('click'); // Goal 页签（2026-10-12 四页拆分：回合记录归位 Goal 页）
    await settle();

    const rows = w.findAll('.cp-turns tbody tr');
    expect(rows).toHaveLength(3); // 1 条 Goal + 2 条课堂
    expect(rows[0].find('.mk-badge').text()).toBe('虚拟学习者');
    expect(rows[1].find('.mk-badge').text()).toBe('虚拟学习者');
    expect(rows[2].find('.mk-badge').text()).toBe('教师');
    expect(w.text()).toContain('3 条对话 · 目标与课堂两段');
    // 合并规则 hover 可得（卡头 title），不再占读数行
    const meta = w.findAll('.mk-card__meta').find((m) => m.text().includes('目标与课堂两段'))!;
    expect(meta.attributes('title')).toContain('按发生顺序合并展示');

    w.unmount();
  });

  it('知识状态更新：真实 knowledgeState 渲染 ranklist（progress 缺失回退状态词，不硬造 ±Δ）', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');
    await w.findAll('.cp-stp')[2].trigger('click'); // Learn 页签（2026-10-12 四页拆分：卡归位 Learn 页）
    await settle();

    const rows = w.findAll('.cp-ranklist__row');
    expect(rows.map((r) => r.find('.cp-ranklist__name').text())).toEqual(['变量与赋值', '函数参数', '作用域']);
    expect(rows.map((r) => r.find('.cp-ranklist__val').text())).toEqual(['92%', '46%', '待复习']);
    // 原型的 ±百分比增量为假数据：后端无增量字段，页面不得出现 ± 值
    expect(w.find('.cp-ranklist').text()).not.toMatch(/[+-]\d+%/);

    w.unmount();
  });

  it('知识状态更新：只渲染在 Learn 页（2026-10-12 四页拆分：课堂数据不进别的阶段页）+ 进度与状态两维并列', async () => {
    const payload = realTeachingPayload(); // kind=teaching + currentStage=wrapup ⇒ 默认落总结页签
    payload.data.teaching.knowledgeState = [
      { name: '定位与列式环节', status: 'learning', progress: 100 },
      { name: '估算耗时判断', status: 'mastered', progress: 100 }
    ];
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(payload);
    const w = await mountCockpit('session-real', 'ts_re_1');

    // Goal 页不渲染
    await w.findAll('.cp-stp')[0].trigger('click');
    await settle();
    expect(w.text()).not.toContain('知识状态更新');

    await w.findAll('.cp-stp')[2].trigger('click'); // Learn 页签
    await settle();
    const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '知识状态更新');
    expect(card).toBeTruthy();
    const rows = card!.findAll('.cp-ranklist__row');
    // 2026-10-11 走查：进度与状态是两维，原先只显进度，100% + status=learning 被读成「已掌握」
    expect(rows[0].find('.cp-ranklist__val').text()).toBe('100%');
    expect(rows[0].find('.cp-ranklist__state').text()).toBe('学习中');
    expect(rows[0].find('.cp-ranklist__state').attributes('data-tone')).toBe('info');
    expect(rows[1].find('.cp-ranklist__state').text()).toBe('已掌握');
    // 卡头点名来源课（原「会话知识状态」里的"会话"指课堂会话，摆在目标对话控制台上易误读）
    expect(card!.find('.mk-card__meta').text()).toContain('最近一节课堂');

    // 切到 总结 页 → 整卡退场（课堂数据不进总结页）
    await w.findAll('.cp-stp')[3].trigger('click');
    await settle();
    expect(w.text()).not.toContain('知识状态更新');

    w.unmount();
  });

  it('无知识数据整卡不渲染（双栏收单栏）；虚拟会话 hero 副文带学习者名；advisory 条保留', async () => {
    const payload = virtualLearningPayload();
    payload.data.advisory = { priority: 'low', title: '节奏偏慢', text: '可适当加快' };
    stableVirtualApi.getVirtualSession.mockResolvedValue(payload);
    const w = await mountCockpit('session', 'vs_1');

    expect(w.text()).not.toContain('知识状态更新');
    // 2026-10-12 四页拆分：共享 .cp-detail-grid 退役（会话级卡片归位各阶段页）
    expect(w.find('.cp-detail-grid').exists()).toBe(false);

    expect(w.find('.mk-hero__sub').text()).toContain('学习者 王小明');

    // advisory 条（真实会话/虚拟会话通用）迁移后仍在
    expect(w.find('.cp-advisory').exists()).toBe(true);
    expect(w.find('.cp-advisory').text()).toContain('节奏偏慢');

    w.unmount();
  });
});
