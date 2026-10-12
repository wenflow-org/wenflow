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
    rerunBlackboxVirtualSession: vi.fn()
  };
  return { stableVirtualApi };
});

/* 路径内容面板（PathJourneyPanel）的取数：Path 页签 2026-10-12 起内嵌完整路径内容 */
const { stableContentApi } = vi.hoisted(() => {
  const stableContentApi = { getPathDetail: vi.fn() };
  return { stableContentApi };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: stableVirtualApi,
  adminLearningContentApi: stableContentApi,
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
const getPathDetailMock = stableContentApi.getPathDetail as ReturnType<typeof vi.fn>

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

    // 顶栏不渲染（2026-10-11 走查：真实会话的顶栏 ID/刷新与壳层+hero 重复）；
    // 只读声明与出口迁进 hero（模式 badge + 动作区「← 会话列表」）
    expect(wrapper.find('.cp-topbar').exists()).toBe(false);
    expect(wrapper.text()).toContain('真实会话 · 只读监控');
    const heroActions = wrapper.find('.mk-hero__actions');
    expect(heroActions.text()).toContain('会话列表');
    expect(heroActions.text()).toContain('刷新');

    // 阶段推进 stepper：4 步 + meta 副标。本夹具 stageResults.path 只给里程碑计数（无任务明细）
    // → 走后端计数兜底「1/2 里程碑」；有任务明细时 Path 步点走子任务动态读数（见 Path 页签用例：
    // 2026-10-12 走查判死「整阶段收齐才动」的口径，明明完成了 2/13 任务却恒显 0/4）
    expect(wrapper.findAll('.cp-stp')).toHaveLength(4);
    expect(wrapper.text()).toContain('1/2 里程碑');
    expect(wrapper.text()).toContain('学习者发言 1');

    // 时间线日志卡（真实模式由 payload.timeline 承载，会话总结已生成在尾部）
    const logText = wrapper.find('.cp-logs').text();
    expect(logText).toContain('学习路径已生成');
    expect(logText).toContain('会话总结已生成');

    // wrapup 字段卡 + 来源徽章（模型生成）
    expect(wrapper.text()).toContain('主题摘要');
    expect(wrapper.text()).toContain('围绕函数作用域展开');
    expect(wrapper.text()).toContain('模型生成');

    // 原始 JSON（rawJson 惰性计算：展开 details 才序列化，2026-09-27 性能整改）
    const rawDetails = wrapper.find('details.cp-raw');
    (rawDetails.element as HTMLDetailsElement).open = true;
    await rawDetails.trigger('toggle');
    await nextTick();
    // Path 里程碑渲染（读 stageResults.path 兜底）：里程碑名出现在原始 JSON 中
    expect(wrapper.text()).toContain('Python 入门学习路径');
    expect(wrapper.text()).toContain('函数基础');
    expect(wrapper.text()).toContain('参数与返回值');

    // 黑盒/仿真专属区隐藏：无 act() 按钮、无对抗预算、无删除会话、无评审面板
    expect(wrapper.find('.cp-config').exists()).toBe(false);
    expect(wrapper.find('.cp-review-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('删除会话');
    expect(wrapper.text()).not.toContain('一键全流程');
    expect(wrapper.text()).not.toContain('单步推进');
    // 真实会话无黑盒数据 → 轨迹面板不出现
    expect(wrapper.text()).not.toContain('裁判旁路诊断');

    // 只读提示（2026-10-04 批次五 P3#13：「只读监控」声明并入顶栏模式 chip 单源，
    // 控制台条不再对真实会话复读——断言同步新契约：全角间隔号形态）
    expect(wrapper.text()).toContain('真实会话 · 只读监控');

    wrapper.unmount();
  });

  it('目标对话控制台：默认落 Goal 页签，不跟随下游流水线的 wrapup（2026-10-11 走查）', async () => {
    // 该学习者末课已完成且有总结 ⇒ 后端 goal 控制台 currentStage 报 'wrapup'（buildGoalConsole 按路径流水线算）；
    // 但本页主语是这条 Goal 对话，页签默认值必须按「本页对象自己的通道」取，否则点进来先看到那节课的终局总结。
    const payload = realTeachingPayload();
    payload.data.kind = 'goal';
    payload.data.runtime.currentStage = 'wrapup';
    getRealSessionConsole.mockResolvedValue(payload);

    const wrapper = await mountCockpit('session-real', 'gc_1');

    expect(wrapper.find('#cp-tabpanel-goal').exists()).toBe(true);
    expect(wrapper.find('#cp-tabpanel-wrapup').exists()).toBe(false);
    const selected = wrapper.find('.cp-stp[aria-selected="true"]');
    expect(selected.attributes('id')).toBe('cp-tab-goal');

    wrapper.unmount();
  });

  it('课堂会话控制台：仍跟随 currentStage（课已结束 → 落总结页签）', async () => {
    getRealSessionConsole.mockResolvedValue(realTeachingPayload()); // kind=teaching + currentStage=wrapup

    const wrapper = await mountCockpit('session-real', 'ts_real_1');

    expect(wrapper.find('#cp-tabpanel-wrapup').exists()).toBe(true);
    expect(wrapper.find('.cp-stp[aria-selected="true"]').attributes('id')).toBe('cp-tab-wrapup');

    wrapper.unmount();
  });

  it('阶段推进卡：下游直达入口（2026-10-12 收敛——Path 出口撤，stepper 步点即唯一入口；课堂会话不给自指）', async () => {
    const goalPayload = realTeachingPayload();
    goalPayload.data.kind = 'goal';
    getRealSessionConsole.mockResolvedValue(goalPayload);
    const goalConsole = await mountCockpit('session-real', 'gc_1');
    // Path 页签自 2026-10-12 起就是路径内容本体：「查看学习路径」按钮与 Path 步点同目标，已撤；
    // 只保留课堂会话出口（那是另一个对象）
    expect(goalConsole.findAll('.cp-stepjumps button').map((b) => b.text())).toEqual(['查看课堂会话']);
    expect(goalConsole.find('.cp-stepjumps button').attributes('title')).toContain('课堂');

    goalConsole.unmount();

    // 课堂会话控制台的对象就是那一课：再给「查看课堂会话」是自指 → 一条直达都不给
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const teachingConsole = await mountCockpit('session-real', 'ts_real_1');
    expect(teachingConsole.find('.cp-stepjumps').exists()).toBe(false);

    teachingConsole.unmount();
  });

  it('落点页签：subPage.stage 显式提示优先（2026-10-12——从学习路径进来落 Path，深链 ?stage= 同源）', async () => {
    const goalPayload = realTeachingPayload();
    goalPayload.data.kind = 'goal';
    getRealSessionConsole.mockResolvedValue(goalPayload);
    // 默认落点：目标对话控制台落 goal（2026-10-11 走查）
    const goalConsole = await mountCockpit('session-real', 'gc_1');
    expect(goalConsole.find('.cp-stp[aria-selected="true"]').attributes('id')).toBe('cp-tab-goal');
    goalConsole.unmount();

    // 带 stage 提示（学习路径列表/深链进来）→ 落 Path，即使该会话 currentStage 报别的
    subPage.value = { view: 'session-real', id: 'gc_1', stage: 'path' };
    getRealSessionConsole.mockResolvedValue(goalPayload);
    const pathLanding = mount(SessionCockpit, { attachTo: document.body });
    await settle();
    expect(pathLanding.find('.cp-stp[aria-selected="true"]').attributes('id')).toBe('cp-tab-path');
    pathLanding.unmount();
  });

  it('学习者资料卡：上传 / 联网两类来源 + 理解摘要（brief）呈现，无资料不渲染', async () => {
    const payload = realTeachingPayload();
    payload.data.kind = 'goal';
    payload.data.materials = [
      {
        id: 'mat-1',
        name: '指南-抽取.txt',
        origin: 'upload',
        charCount: 22284,
        headingCount: 0,
        anchorCount: 0,
        warningCount: 0,
        createdAt: '2026-09-22T14:44:00.648Z',
        fetchedAt: null,
        sourceUrl: null,
        brief: { docType: '指南', subject: '3-6岁儿童学习与发展指南', audience: '教师', overview: '本文件为《3-6岁儿童学习与发展指南》，指导幼儿园与家庭实施科学保育教育。', coreConcepts: ['五大领域', '学习品质'], naturalDivisions: ['按五大领域'], tocCount: 18 }
      },
      {
        id: 'mat-2',
        name: '如何阅读一本书',
        origin: 'web',
        charCount: 100035,
        headingCount: 0,
        anchorCount: 0,
        warningCount: 1,
        createdAt: '2026-09-26T00:06:24.026Z',
        fetchedAt: '2026-09-26T00:06:24.026Z',
        sourceUrl: 'https://example.org/books/how-to-read.pdf',
        brief: null
      }
    ];
    getRealSessionConsole.mockResolvedValue(payload);

    const w = await mountCockpit('session-real', 'gc_1');

    const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '学习者资料');
    expect(card).toBeTruthy();
    expect(card!.find('.mk-card__meta').text()).toContain('2 份');
    expect(card!.find('.mk-card__meta').text()).toContain('上传 1');
    expect(card!.find('.mk-card__meta').text()).toContain('联网 1');
    expect(card!.find('.mk-card__meta').text()).toContain('含理解摘要 1');

    const rows = card!.findAll('.cp-mat');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('.mk-badge').text()).toBe('学习者上传');
    expect(rows[0].find('.cp-mat__name').text()).toBe('指南-抽取.txt');
    expect(rows[0].find('.cp-mat__subject').text()).toContain('学习与发展指南');
    expect(rows[0].find('.cp-mat__overview').text()).toContain('科学保育教育');
    expect(rows[0].find('.cp-mat__chips').text()).toContain('五大领域');
    // 联网资料：来源链接 + 未生成摘要时明示（不伪造摘要）
    expect(rows[1].find('.mk-badge').text()).toBe('联网采集');
    const link = rows[1].find('.cp-mat__src');
    expect(link.attributes('href')).toBe('https://example.org/books/how-to-read.pdf');
    expect(link.attributes('rel')).toContain('noopener');
    expect(rows[1].find('.cp-mat__none').text()).toContain('尚未生成资料理解摘要');
    expect(rows[1].find('.cp-mat__foot').text()).toContain('example.org');

    w.unmount();

    // 无资料 → 整卡不渲染（与知识状态更新同口径）
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const empty = await mountCockpit('session-real', 'ts_real_1');
    expect(empty.text()).not.toContain('学习者资料');
    empty.unmount();
  });

  it('Path 页签 = 路径内容本体（2026-10-12 拍板）：内嵌 PathJourneyPanel，不再有「打开路径详情页」出口', async () => {
    const payload = realTeachingPayload(); // path: M1 全完成 / M2 有未完任务，当前任务 task_2
    // 真实载荷里 stageResults.path 与 path 同构（都含 milestones）；fixture 按同构补齐，供里程碑视图取任务态
    payload.data.stageResults.path = payload.data.path;
    getRealSessionConsole.mockResolvedValue(payload);
    // 面板自取 getPathDetail 全量行（与退役的路径详情页同一接口、同一内容面）
    getPathDetailMock.mockResolvedValue({
      data: {
        data: {
          title: 'Python 入门学习路径',
          status: 'active',
          updatedAt: '2026-08-12T12:00:00.000Z',
          milestones: [
            {
              id: 'm1', stageNumber: 1, title: '函数基础', status: 'completed', description: '参数与返回值',
              subtasks: [
                { id: 't1', title: '函数定义', status: 'completed', taskType: 'acquire', estimatedMinutes: 15 },
                { id: 't2', title: '参数与返回值', status: 'completed', taskType: 'practice', estimatedMinutes: 20 }
              ]
            },
            {
              id: 'm2', stageNumber: 2, title: '作用域', status: 'in_progress', description: '局部与全局',
              goal: '掌握词法作用域', coreConceptName: '作用域', estimatedHours: 6,
              subtasks: [
                { id: 't3', title: '作用域练习', status: 'in_progress', taskType: 'practice', estimatedMinutes: 25 }
              ]
            }
          ]
        }
      }
    });
    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    await wrapper.findAll('.cp-stp')[1].trigger('click'); // Path 页签
    await settle();
    expect(getPathDetailMock).toHaveBeenCalledWith('lp_1');
    // 步点副标走子任务动态读数（M1 2 任务完成 + M2 1 任务进行中 = 2/3），
    // 不再是「整阶段收齐才 +1」的里程碑口径（2026-10-12 走查：恒 0 读作没进展）
    expect(wrapper.find('#cp-tab-path .cp-stp__meta').text()).toBe('任务 2/3');

    const pane = wrapper.find('#cp-tabpanel-path');
    expect(pane.exists()).toBe(true);
    expect(pane.find('.mk-card__title').text()).toBe('关联学习路径');
    // 面板内容体 = 阶段手风琴（默认展开当前阶段「作用域」，含阶段目标/核心概念）+ 治理动作；
    // 「总体进度」与「技术细节」2026-10-12 用户拍板撤（各阶段头自带 N / M 任务，工程标识不进运营页面）
    expect(pane.text()).not.toContain('总体进度');
    expect(pane.text()).not.toContain('技术细节');
    const stageTitles = pane.findAll('.pd-stage__title').map((s) => s.text());
    expect(stageTitles).toEqual(['函数基础', '作用域']);
    expect(pane.text()).toContain('目标掌握词法作用域');
    expect(pane.text()).toContain('核心概念：作用域');
    expect(pane.text()).toContain('2 / 2 任务'); // 阶段头自带完成数
    // 旧出口退役：stepper 的 Path 步点即唯一入口，不再有「打开路径详情页」按钮
    expect(pane.text()).not.toContain('打开路径详情页');
    // 治理动作保留（真实能力：下线路径）
    expect(pane.text()).toContain('下线路径');

    wrapper.unmount();
  });

  it('Learn 课表：真实会话下「从该课开始学习」是虚拟专属 → 只读行，不给假入口', async () => {
    const payload = realTeachingPayload();
    payload.data.stageResults.path = payload.data.path; // 同构补齐（里程碑视图取任务态）
    // 追加一节未开始的课，覆盖「未开始」分支（fixture 原本只有已完成 + 当前课）
    payload.data.stageResults.path.milestones[1].tasks.push({ id: 'task_9', title: '未开始的课', status: 'pending', completed: false });
    getRealSessionConsole.mockResolvedValue(payload);
    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    await wrapper.findAll('.cp-stp')[2].trigger('click'); // Learn 页签
    await settle();

    const rows = wrapper.findAll('.cp-learn-tree__lesson');
    expect(rows.length).toBeGreaterThan(0);
    // 实测（2026-10-11）：点未开始的课 → 确认框 → 「启动失败：模拟会话不存在」（该接口只认 virtual_sessions）
    // 故真实会话下不给这个动作，按总结页既有先例渲染只读行（FN4 同款）；有课堂会话的课仍可点开对话。
    const titles = rows.map((r) => r.attributes('title') || '');
    expect(titles.some((t) => t.includes('点击可从该课开始学习'))).toBe(false);
    const enabled = rows.filter((r) => r.attributes('disabled') === undefined);
    expect(enabled.every((r) => r.attributes('title') === '查看课堂对话')).toBe(true);
    const readonly = rows.filter((r) => r.attributes('disabled') !== undefined);
    expect(readonly.length).toBeGreaterThan(0);
    expect(readonly.map((r) => r.attributes('title') || '')).toContain('真实会话不可从后台启动学习；仅在虚拟学习者会话下可从该课开始');

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

    // Path tab（stepper 步点即页签）：真实模式空态明示数据边界
    const stages = wrapper.findAll('.cp-stp');
    await stages.find((s) => s.text().includes('Path'))!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('该真实会话尚未生成 Path');

    // Learn tab：真实模式无教学记录空态
    await wrapper.findAll('.cp-stp').find((s) => s.text().includes('Learn'))!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('尚未生成课程');

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

    expect(wrapper.find('.mk-back').text()).toContain('虚拟学习者');
    expect(wrapper.text()).toContain('辅助模式');
    // 虚拟行为 100% 保留：操作按钮 + 对抗预算 + 删除会话（一键全流程已收敛到「自动驾驶」）
    expect(wrapper.text()).not.toContain('一键全流程');
    expect(wrapper.text()).toContain('自动驾驶');
    expect(wrapper.find('.cp-run__budget').exists()).toBe(true);
    // 删除仅终态出现：进行中的会话不显示删除
    expect(wrapper.text()).not.toContain('删除会话');
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
    // 终局评估面板已随裁判独立面移除（2026-09-27）：不再渲染裁判/保真报告
    expect(wrapper.text()).not.toContain('终局评估');
    expect(wrapper.text()).not.toContain('85%');

    // Trace 诊断侧栏默认折叠：展开后可见三流统一时间线 + 裁判旁路诊断
    const traceToggle = wrapper.findAll('button').find((b) => b.text().includes('Trace 诊断'));
    expect(traceToggle).toBeTruthy();
    await traceToggle!.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('裁判旁路诊断');
    expect(wrapper.text()).toContain('统一时间线');
    const traceText = wrapper.find('.cp-trace-panel').text();
    expect(traceText).toContain('curious');
    expect(traceText).toContain('virtual-reply');

    wrapper.unmount();
  });
});
