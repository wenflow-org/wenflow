/**
 * SessionCockpit 双模式渲染测试（遗留项 1：真实教学会话进控制台）
 * - 真实模式（session-real）：同构数据渲染（阶段条/Path 里程碑/时间线日志/wrapup 字段卡），
 *   黑盒与仿真专属区隐藏（act() 按钮、对抗预算、删除会话、评审面板）
 * - 虚拟模式回归（session）：辅助控制按钮保留，三流统一时间线面板出现
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import SessionCockpit from '../SessionCockpit.vue';
import { subPage } from '../store';

/** 后端 /admin/session-console 同构载荷（teaching 会话，含 path/goal/wrapup/evidence/timeline）
 * 返回 any：用例中会按「无映射数据降级」场景就地置 null，结构随端点演化，不必强类型化 fixture */
function realTeachingPayload(): any {
  return {
    data: {
      kind: 'teaching',
      sessionId: 'ts_real_1',
      goal: { conversationId: 'gc_1', stage: 'completed', status: 'completed', ready: true, confidence: 0.85, messageCount: 2 },
      path: {
        id: 'lp_1',
        title: 'Python 入门学习路径',
        description: '从基础到自动化',
        difficulty: 'beginner',
        estimatedHours: 40,
        totalMilestones: 2,
        completedMilestones: 1,
        milestones: [
          {
            stageNumber: 1, title: '函数基础', description: '参数与返回值', status: 'completed',
            tasks: [
              { id: 'task_0', title: '函数定义', status: 'completed', completed: true },
              { id: 'task_1', title: '参数与返回值', status: 'completed', completed: true }
            ]
          },
          {
            stageNumber: 2, title: '作用域', description: '局部与全局', status: 'active',
            tasks: [
              { id: 'task_2', title: '作用域练习', status: 'in_progress', completed: false }
            ]
          }
        ]
      },
      teaching: {
        teachingSessionId: 'ts_real_1',
        taskId: 'task_2',
        taskTitle: '作用域练习',
        status: 'completed',
        topic: '函数练习 2/5：参数与返回值',
        subject: 'Python 入门',
        messageCount: 1,
        wrapup: {
          status: 'complete',
          summary: { topicSummary: '围绕函数作用域展开…', learningEvaluation: '通过但用时偏长。' },
          sources: { summary: 'model' },
          generatedAt: '2026-08-12T15:00:00.000Z'
        },
        messages: [
          { role: 'user', content: '我不理解作用域', time: '2026-08-12T14:00:00.000Z' },
          { role: 'assistant', content: '作用域是变量可见的范围…', time: '2026-08-12T14:00:05.000Z' }
        ]
      },
      evaluation: { total: 3, types: [{ type: 'lesson:completed', count: 3, avgConfidence: 0.9 }], avgConfidence: 0.8 },
      timeline: [
        { time: '2026-08-11T10:00:00.000Z', kind: 'goal', title: '学习者目标对话', detail: '我想学 Python' },
        { time: '2026-08-11T11:00:00.000Z', kind: 'path', title: '学习路径已生成', detail: 'Python 入门学习路径' },
        { time: '2026-08-12T14:00:00.000Z', kind: 'teaching', title: '学习者消息', detail: '我不理解作用域' },
        { time: '2026-08-12T14:20:00.000Z', kind: 'evidence', title: 'lesson:completed', detail: '{}' },
        { time: '2026-08-12T15:00:00.000Z', kind: 'teaching', title: '会话总结已生成', detail: '' }
      ],
      runtime: {
        status: 'completed',
        currentStage: 'wrapup',
        stageStatus: {
          goal: { conversationId: 'gc_1', stage: 'completed', ready: true, confidence: 0.85, messageCount: 2 },
          path: { learningPathId: 'lp_1', generated: true, totalMilestones: 2, completedMilestones: 1 },
          learning: { teachingSessionId: 'ts_real_1', currentTaskId: 'task_2', wrapup: { status: 'complete', sources: { summary: 'model' } }, status: 'completed', manualStop: false }
        },
        bindings: { goalConversationId: 'gc_1', learningPathId: 'lp_1', teachingSessionId: 'ts_real_1', currentTaskId: 'task_2' }
      },
      conversations: {
        goal: { messages: [{ role: 'user', content: '目标', time: '2026-08-11T10:00:00.000Z' }] },
        learning: { messages: [{ role: 'assistant', content: '作用域是变量可见的范围…', time: '2026-08-12T14:00:05.000Z' }] }
      },
      stageResults: {
        goal: { conversationId: 'gc_1', stage: 'completed', ready: true },
        path: { id: 'lp_1', totalMilestones: 2, completedMilestones: 1 },
        teaching: {
          teachingSessionId: 'ts_real_1',
          currentTaskId: 'task_2',
          wrapup: {
            status: 'complete',
            summary: { topicSummary: '围绕函数作用域展开…', learningEvaluation: '通过但用时偏长。' },
            sources: { summary: 'model' },
            generatedAt: '2026-08-12T15:00:00.000Z'
          }
        },
        blackbox: null
      }
    }
  };
}

/** 虚拟会话载荷（白盒进行中，仅日志；无 blackbox 键）；黑盒用例就地注入 blackbox */
function virtualSessionPayload(): any {
  return {
    data: {
      status: 'active',
      currentStage: 'goal',
      goalConversationId: 'gc_v1',
      learningPathId: null,
      logs: JSON.stringify([]),
      stageResults: {
        goal: { stage: 'understanding', learnerState: { emotion: 'curious' } },
        teaching: { teachingSessionId: null, currentTaskId: null }
      },
      runtime: {
        status: 'active',
        currentStage: 'goal',
        bindings: { goalConversationId: 'gc_v1', learningPathId: null, teachingSessionId: null, currentTaskId: null },
        stageStatus: {
          goal: { conversationId: 'gc_v1', stage: 'understanding', ready: false },
          path: { learningPathId: null, generated: false, totalMilestones: null },
          learning: { teachingSessionId: null, currentTaskId: null, manualStop: false }
        }
      },
      conversations: {
        goal: { messages: [{ role: 'user', content: '我想学 Python', time: '2026-08-12T10:00:00.000Z' }] },
        learning: { messages: [] }
      }
    }
  };
}

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

/* 组件可访问到的同一批 vi.fn（Proxy 模式每次 get 生成新函数，无法在用例中覆写实现） */
const { stableVirtualApi } = vi.hoisted(() => {
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
    generateBlackboxEvaluations: vi.fn(),
    rerunBlackboxVirtualSession: vi.fn()
  };
  return { stableVirtualApi };
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

const getRealSessionConsole = stableVirtualApi.getRealSessionConsole as ReturnType<typeof vi.fn>
const getVirtualSession = stableVirtualApi.getVirtualSession as ReturnType<typeof vi.fn>
const getVirtualSessionLogs = stableVirtualApi.getVirtualSessionLogs as ReturnType<typeof vi.fn>

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

describe('SessionCockpit 双模式', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subPage.value = null;
  });

  it('真实模式：同构数据渲染（阶段条/Path 里程碑/时间线日志/wrapup 字段卡 + 来源徽章）', async () => {
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());

    const wrapper = await mountCockpit('session-real', 'ts_real_1');

    // 顶栏 + 模式标识（标题已由「会话座舱」更名为「会话监控」）
    expect(wrapper.text()).toContain('会话监控');
    expect(wrapper.text()).toContain('真实教学会话');
    expect(wrapper.find('.cp-back').text()).toContain('会话列表');

    // 阶段条：4 段 + 进度副标（Path 1/2 里程碑、Goal 对话轮次）
    expect(wrapper.findAll('.cp-stage')).toHaveLength(4);
    expect(wrapper.text()).toContain('1/2 里程碑');
    expect(wrapper.text()).toContain('对话 1 轮');

    // Path 里程碑渲染（读 stageResults.path 兜底）
    expect(wrapper.text()).toContain('Python 入门学习路径');
    expect(wrapper.text()).toContain('函数基础');
    expect(wrapper.text()).toContain('参数与返回值');

    // 时间线日志卡（真实模式由 payload.timeline 承载，会话总结已生成在尾部）
    const logText = wrapper.find('.cp-logs').text();
    expect(logText).toContain('学习路径已生成');
    expect(logText).toContain('会话总结已生成');

    // wrapup 字段卡 + 来源徽章（模型生成）
    expect(wrapper.text()).toContain('主题摘要');
    expect(wrapper.text()).toContain('围绕函数作用域展开');
    expect(wrapper.text()).toContain('模型生成');

    // 黑盒/仿真专属区隐藏：无 act() 按钮、无对抗预算、无删除会话、无评审面板
    expect(wrapper.find('.cp-config').exists()).toBe(false);
    expect(wrapper.find('.cp-review-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('删除会话');
    expect(wrapper.text()).not.toContain('一键全流程');
    expect(wrapper.text()).not.toContain('单步推进');
    // 真实会话无黑盒数据 → 轨迹面板不出现
    expect(wrapper.text()).not.toContain('裁判旁路诊断');

    // 只读提示
    expect(wrapper.text()).toContain('真实会话 · 只读');

    wrapper.unmount();
  });

  it('真实模式：无映射数据时优雅降级（goal/path 空态明示数据边界）', async () => {
    const payload = realTeachingPayload();
    payload.data.goal = null;
    payload.data.path = null;
    payload.data.runtime.stageStatus.goal = null;
    payload.data.runtime.stageStatus.path = { learningPathId: null, generated: false, totalMilestones: null, completedMilestones: null };
    payload.data.runtime.stageStatus.learning.wrapup = null;
    payload.data.runtime.stageStatus.learning.teachingSessionId = null;
    payload.data.runtime.bindings = { goalConversationId: null, learningPathId: null, teachingSessionId: null, currentTaskId: null };
    payload.data.runtime.currentStage = 'teaching';
    payload.data.runtime.status = 'active';
    payload.data.stageResults.goal = null;
    payload.data.stageResults.path = null;
    payload.data.stageResults.teaching = { teachingSessionId: null, currentTaskId: null, wrapup: null };
    payload.data.conversations.learning.messages = [];
    payload.data.timeline = [];
    getRealSessionConsole.mockResolvedValue(payload);

    const wrapper = await mountCockpit('session-real', 'ts_real_1');

    // Path tab：真实模式空态明示数据边界
    const stages = wrapper.findAll('.cp-stage');
    await stages.find((s) => s.text().includes('Path 生成'))!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('该真实会话尚未生成 Path');

    // Learn tab：真实模式无教学记录空态
    await wrapper.findAll('.cp-stage').find((s) => s.text().includes('Learn 学习'))!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('该真实会话尚未开始学习');

    // 无轨迹面板（黑盒数据不存在）
    expect(wrapper.text()).not.toContain('裁判旁路诊断');
    expect(wrapper.text()).not.toContain('统一时间线');

    wrapper.unmount();
  });

  it('虚拟模式回归：辅助控制按钮保留（白盒无轨迹 → 无统一时间线面板）', async () => {
    getVirtualSession.mockResolvedValue(virtualSessionPayload());
    getVirtualSessionLogs.mockResolvedValue({
      data: {
        logs: [{ timestamp: '2026-08-12T10:02:00.000Z', phase: 'virtual-reply', durationMs: 500, details: { message: '学习者回复生成完成' } }]
      }
    });

    const wrapper = await mountCockpit('session', 'vs_1');

    expect(wrapper.find('.cp-back').text()).toContain('虚拟学习者');
    expect(wrapper.text()).toContain('辅助模式');
    // 虚拟行为 100% 保留：操作按钮 + 对抗预算 + 删除会话
    expect(wrapper.text()).toContain('一键全流程');
    expect(wrapper.find('.cp-config').exists()).toBe(true);
    expect(wrapper.text()).toContain('删除会话');
    // 白盒无裁判/私有轨迹 → 统一时间线面板不出现（不破坏原黑盒区）
    expect(wrapper.text()).not.toContain('统一时间线');

    wrapper.unmount();
  });

  it('虚拟模式：黑盒会话黑盒区保留（终局评估/轨迹/放弃实验）+ 三流统一时间线', async () => {
    const payload = virtualSessionPayload();
    payload.data.status = 'completed';
    payload.data.currentStage = 'teaching';
    payload.data.stageResults.blackbox = {
      refereeReports: [{
        evaluatedAt: '2026-08-12T10:05:00.000Z',
        report: { verdict: 'pass', scores: { overall: 0.85 }, findings: [], recommendations: [] }
      }],
      actorAuditReports: [],
      refereeTrace: [{ timestamp: '2026-08-12T10:00:00.000Z', traceId: 'trc_1', diagnostic: { verdict: 'pass', round: 3 } }],
      learnerPrivateStateTrace: [{ sequence: 1, stage: 'goal', generatedAt: '2026-08-12T10:01:00.000Z', emotion: 'curious', transition: 'explore' }]
    };
    getVirtualSession.mockResolvedValue(payload);
    getVirtualSessionLogs.mockResolvedValue({
      data: {
        logs: [{ timestamp: '2026-08-12T10:02:00.000Z', phase: 'virtual-reply', durationMs: 500, details: { message: '学习者回复生成完成' } }]
      }
    });

    const wrapper = await mountCockpit('session', 'vs_1');

    expect(wrapper.text()).toContain('黑盒模式');
    expect(wrapper.text()).toContain('终局评估');
    expect(wrapper.text()).toContain('裁判旁路诊断');
    expect(wrapper.text()).toContain('85%');

    // 三流统一时间线：裁判诊断 + 私有状态 + 会话日志合并单轴
    expect(wrapper.text()).toContain('统一时间线（三流合并）');
    const traceText = wrapper.find('.cp-timeline-panel').text();
    expect(traceText).toContain('裁判诊断');
    expect(traceText).toContain('curious');
    expect(traceText).toContain('virtual-reply');

    wrapper.unmount();
  });
});
