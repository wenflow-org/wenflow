/**
 * SessionCockpit 会话监控页骨架对齐原型 renderSessionDetail（2026-10-01 重排）。
 *
 * 断言 = 原型版式的每一块 + 数据诚实性：
 *  - hero（头像「S」/ 会话 id / 学习者·科目·开始于副文 / 状态 + 阶段 + 回合 pills / 真实能力动作）
 *  - 教学闭环定位（.loop 五环：目标对话→…→记忆复习；教学回合 active，其余 done）
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

/** 真实教学会话载荷：含 subject/startTime/knowledgeState/advisory/goal+课堂消息（进行中） */
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
  it('hero：头像 S + 会话 id + 科目/开始于副文 + 状态/阶段/回合 pills；真实能力动作，不搬原型假钮', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    expect(w.find('.mk-hero__avatar').text()).toBe('S');
    expect(w.find('.mk-hero__title').text()).toBe('ts_re_1');
    const sub = w.find('.mk-hero__sub').text();
    expect(sub).toContain('Python 入门');
    expect(sub).toContain('开始于');

    const pills = w.findAll('.mk-hero__pills .mk-badge').map((b) => b.text());
    expect(pills[0]).toBe('进行中');
    expect(pills[1]).toBe('Learn');
    expect(pills[2]).toBe('回合 2'); // Goal 1 条学习者发言 + 课堂 1 条学习者发言（真实计数）

    // 真实会话只读：hero 动作区无按钮；原型假钮（导出日志）与危险动作（中断会话）不出现
    expect(w.findAll('.mk-hero__actions button')).toHaveLength(0);
    expect(w.text()).not.toContain('导出日志');
    expect(w.text()).not.toContain('中断会话');

    w.unmount();
  });

  it('教学闭环定位：.loop 五环同构，教学回合 active「本会话进行中」，其余 done「已完成」', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    const steps = w.findAll('.cp-loop__step');
    expect(steps.map((s) => s.find('.cp-loop__name').text())).toEqual(
      ['目标对话', '路径规划', '教学回合', '课后评估', '记忆复习']
    );
    expect(w.findAll('.cp-loop__arrow')).toHaveLength(4);

    const active = steps.filter((s) => s.classes().includes('cp-loop__step--active'));
    expect(active).toHaveLength(1);
    expect(active[0].find('.cp-loop__name').text()).toBe('教学回合');
    expect(active[0].find('.cp-loop__meta').text()).toBe('本会话进行中');
    const done = steps.filter((s) => s.classes().includes('cp-loop__step--done'));
    expect(done).toHaveLength(4);
    expect(done.every((s) => s.find('.cp-loop__meta').text() === '已完成')).toBe(true);

    w.unmount();
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
    // done 步点 = ✓ 字标 + 真实 meta（Goal 对话轮次）；无真实数字的阶段不硬造
    expect(steps[0].find('.cp-stp__dot').text()).toBe('✓');
    expect(steps[0].find('.cp-stp__meta').text()).toBe('对话 1 轮');
    expect(steps[1].find('.cp-stp__meta').text()).toBe('已完成');

    // 卡头右侧完成计数
    expect(w.find('.cp-stepcard').text()).toContain('已完成');
    expect(w.find('.cp-stepcard').text()).toContain('/ 4 阶段');

    // statstrip 三格：当前阶段 / 已用回合 / 下一阶段（真实派生）
    const labels = w.findAll('.statstrip__label').map((e) => e.text());
    const values = w.findAll('.statstrip__value').map((e) => e.text());
    expect(labels).toEqual(['当前阶段', '已用回合', '下一阶段']);
    expect(values).toEqual(['Learn', '2', '总结']);

    // stepper 步点即阶段页签（原 cp-stage tab 导航收敛至此）：点击 Goal → Goal 对话卡出现
    await steps[0].trigger('click');
    await settle();
    expect(w.find('[role="tabpanel"][aria-labelledby="cp-tab-goal"]').exists()).toBe(true);
    expect(w.text()).toContain('Goal 对话');

    w.unmount();
  });

  it('回合记录：列序对齐原型（#/类型/内容），无真数据的 Token/耗时/解答分不硬造；Goal+课堂按序合并', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    const headTexts = w.findAll('.cp-turns thead th').map((th) => th.text());
    expect(headTexts).toEqual(['#', '类型', '内容', '时间']);
    expect(w.text()).not.toContain('Token');
    expect(w.text()).not.toContain('耗时');
    expect(w.text()).not.toContain('解答分');

    const rows = w.findAll('.cp-turns tbody tr');
    expect(rows).toHaveLength(4);
    expect(rows[0].find('.cp-turns__num').text()).toBe('1');
    expect(rows[0].find('.mk-badge').text()).toBe('学习者');
    expect(rows[0].find('.cp-turns__wrap').text()).toBe('我想学 Python');
    expect(rows[1].find('.mk-badge').text()).toBe('平台 Goal');
    expect(rows[2].find('.mk-badge').text()).toBe('学习者');
    expect(rows[3].find('.mk-badge').text()).toBe('教师');
    // 时间列 = 消息真实 timestamp
    expect(rows[0].find('.cp-turns__time').text()).not.toBe('—');

    w.unmount();
  });

  it('知识状态更新：真实 knowledgeState 渲染 ranklist（progress 缺失回退状态词，不硬造 ±Δ）', async () => {
    stableVirtualApi.getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const w = await mountCockpit('session-real', 'ts_re_1');

    const rows = w.findAll('.cp-ranklist__row');
    expect(rows.map((r) => r.find('.cp-ranklist__name').text())).toEqual(['变量与赋值', '函数参数', '作用域']);
    expect(rows.map((r) => r.find('.cp-ranklist__val').text())).toEqual(['92%', '46%', '待复习']);
    // 原型的 ±百分比增量为假数据：后端无增量字段，页面不得出现 ± 值
    expect(w.find('.cp-ranklist').text()).not.toMatch(/[+-]\d+%/);

    w.unmount();
  });

  it('无知识数据整卡不渲染（双栏收单栏）；虚拟会话 hero 副文带学习者名；advisory 条保留', async () => {
    const payload = virtualLearningPayload();
    payload.data.advisory = { priority: 'low', title: '节奏偏慢', text: '可适当加快' };
    stableVirtualApi.getVirtualSession.mockResolvedValue(payload);
    const w = await mountCockpit('session', 'vs_1');

    expect(w.text()).not.toContain('知识状态更新');
    expect(w.find('.cp-detail-grid--single').exists()).toBe(true);

    expect(w.find('.mk-hero__sub').text()).toContain('学习者 王小明');

    // advisory 条（真实会话/虚拟会话通用）迁移后仍在
    expect(w.find('.cp-advisory').exists()).toBe(true);
    expect(w.find('.cp-advisory').text()).toContain('节奏偏慢');

    w.unmount();
  });
});
