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
import { liveRefreshSeq } from '../live';

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
        ],
        checkpoints: [
          { checkpointId: 'cp_1', type: 'short_answer', question: '针对「完成5道错题重做」这条建议，它预设的动机状态是什么？', passed: false, judgedBy: 'code', understanding: 0.75, conceptName: '识别隐含动机假设' }
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
    getRealSessionMaterial: vi.fn(),
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

  it('顶栏刷新（liveRefreshSeq 广播）重拉本页会话载荷——终端会话轮询已停，这是唯一重读入口', async () => {
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    await mountCockpit('session-real', 'ts_real_1');
    const callsAfterMount = getRealSessionConsole.mock.calls.length;

    liveRefreshSeq.value += 1;
    await settle();

    expect(getRealSessionConsole.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('真实模式：同构数据渲染（阶段条/Path 里程碑/时间线日志/wrapup 字段卡 + 来源徽章）', async () => {
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());

    const wrapper = await mountCockpit('session-real', 'ts_real_1');

    // 顶栏不渲染（2026-10-11 走查：真实会话的顶栏 ID/刷新与壳层+hero 重复）；
    // 只读声明与出口迁进 hero（模式 badge + 动作区「← 会话列表」）
    expect(wrapper.find('.cp-topbar').exists()).toBe(false);
    expect(wrapper.text()).toContain('真实会话 · 只读监控');
    // 2026-10-19 用户走查「刷新重复了吧」：hero 刷新钮撤，改由顶栏一颗驱动（watch liveRefreshSeq）
    const heroActions = wrapper.find('.mk-hero__actions');
    expect(heroActions.text()).toContain('会话列表');
    expect(heroActions.text()).not.toContain('刷新');

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

    // 会话数据包（2026-10-18）：主列只留一行读数，整包 JSON 收进弹层（点开才序列化）
    const pkg = wrapper.find('.cp-raw');
    expect(pkg.exists()).toBe(true);
    expect(pkg.text()).toContain('会话数据包');
    expect(pkg.text()).toContain('教学会话');
    expect(pkg.text()).toContain('Python 入门学习路径');
    expect(pkg.find('pre').exists()).toBe(false);
    const openRawBtn = pkg.findAll('button').find((b) => b.text() === '查看原始数据')!;
    await openRawBtn.trigger('click');
    await flushPromises();
    // Path 里程碑渲染（读 stageResults.path 兜底）：里程碑名出现在弹层原始 JSON 中（Teleport 到 body）
    const rawView = document.body.querySelector('.cp-rawview') as HTMLElement | null;
    expect(rawView).not.toBeNull();
    expect(rawView!.textContent).toContain('Python 入门学习路径');
    expect(rawView!.textContent).toContain('函数基础');
    expect(rawView!.textContent).toContain('参数与返回值');
    ;[...rawView!.querySelectorAll('button')].find((b) => b.textContent === '关闭')?.click();
    await flushPromises();

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

  // 2026-10-17：session_load 此前零运行时读取方（写了没人看的死仓）。总结页是它第一个消费点，
  // 这里钉住渲染口径与「无数据不渲染」——后端没行时不能凭空显示 0。
  it('总结页呈现本轮负荷聚合（均值/峰值/轮数 + 依据分布 tooltip）；无数据整项不渲染', async () => {
    const payload = realTeachingPayload();
    payload.data.teaching.sessionLoad = { mean: 0.264, max: 0.4, basisDist: { semantic: 7 }, perTurnCount: 7 };
    getRealSessionConsole.mockResolvedValue(payload);

    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    const stats = wrapper.find('.cp-wrapup-stats');
    expect(stats.text()).toContain('本轮负荷 均值 26% · 峰值 40% · 7 轮');
    const item = stats.findAll('.cp-wrapup-stats__item').find((n) => n.text().includes('本轮负荷'));
    expect(item?.attributes('title')).toContain('semantic 7');
    wrapper.unmount();

    const noLoad = realTeachingPayload();
    delete noLoad.data.teaching.sessionLoad;
    getRealSessionConsole.mockResolvedValue(noLoad);
    const empty = await mountCockpit('session-real', 'ts_real_1');
    expect(empty.text()).not.toContain('本轮负荷');
    empty.unmount();
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
    // 2026-10-18 用户走查「这类文案」：卡头只报份数与有摘要份数；
    // 上传 / 联网的来源构成改由每行行首徽章承担（下方 rows[*].mk-badge 断言）。
    expect(card!.find('.mk-card__meta').text()).toContain('2 份资料');
    expect(card!.find('.mk-card__meta').text()).toContain('1 份有理解摘要');
    expect(card!.find('.mk-card__meta').text()).not.toContain('上传');

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

    // 跨页指引（2026-10-12 走查「为啥资料看不到」）：总结页不留资料正文，卡头给切回 Goal 页的出口
    await w.findAll('.cp-stp')[3].trigger('click'); // 总结页
    await settle();
    const pointer = w.findAll('button').find((b) => (b.text() || '').includes('学习者资料在目标页'));
    expect(pointer, '总结页应给资料所在页的指引').toBeTruthy();
    await pointer!.trigger('click');
    await settle();
    expect(w.find('#cp-tabpanel-goal').exists()).toBe(true);
    expect(w.text()).toContain('学习者资料');

    w.unmount();

    // 无资料 → 整卡不渲染（与知识状态更新同口径）
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const empty = await mountCockpit('session-real', 'ts_real_1');
    expect(empty.text()).not.toContain('学习者资料');
    empty.unmount();
  });

  it('资料全文弹层（2026-10-12 走查「只能看到简介吗」）：查看全文懒加载存档正文，Esc 关闭', async () => {
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
        brief: null
      }
    ];
    getRealSessionConsole.mockResolvedValue(payload);
    stableVirtualApi.getRealSessionMaterial.mockResolvedValue({
      data: {
        success: true,
        data: { id: 'mat-1', name: '指南-抽取.txt', origin: 'upload', charCount: 22284, markdown: '第一部分　健康\n（存档正文）', truncated: false }
      }
    });

    const w = await mountCockpit('session-real', 'gc_1');

    const row = w.findAll('.cp-mat')[0];
    const btn = row.findAll('button').find((b) => b.text() === '查看全文');
    expect(btn, '资料卡应有查看全文入口').toBeTruthy();
    await btn!.trigger('click');
    await flushPromises();
    expect(stableVirtualApi.getRealSessionMaterial).toHaveBeenCalledWith('gc_1', 'mat-1');

    // 弹层 Teleport 到 body：正文直读存档 markdown（不是 brief 摘要）
    const dialog = document.body.querySelector('.cp-matview');
    expect(dialog, '全文弹层应挂在 body').toBeTruthy();
    expect(dialog!.textContent).toContain('指南-抽取.txt');
    expect(dialog!.textContent).toContain('存档正文');
    expect(dialog!.textContent).not.toContain('仅展示前 20 万字');

    // Esc 关闭（useEscape 走 window 全局监听）
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.body.querySelector('.cp-matview')).toBeNull();

    w.unmount();
  });

  it('Path 页签 = 路径内容本体（2026-10-12 拍板）：内嵌 PathJourneyPanel，不再有「打开路径详情页」出口', async () => {
    const payload = realTeachingPayload(); // path: M1 全完成 / M2 有未完任务，当前任务 task_2
    // 真实载荷里 stageResults.path 与 path 同构（都含 milestones）；fixture 按同构补齐，供里程碑视图取任务态
    payload.data.stageResults.path = payload.data.path;
    // 未解锁阶段两处载荷同补（stepper 读数与面板手风琴吃同一条 path，fixture 保持同构）：
    // 里程碑状态枚举三值之一（后端 task-completion.service.ts：locked → active → completed）。
    // 此前 fixture 的里程碑一律写 in_progress —— 生产从不发这个值，接口词与用例词错配，
    // 于是「active 漏译 + 被判成 idle」在测试里永不显形（2026-10-14 实修）。
    payload.data.path.milestones.push({
      stageNumber: 3, title: '闭包', status: 'locked',
      tasks: [{ id: 'task_3', title: '闭包练习', status: 'todo', completed: false }]
    });
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
              id: 'm2', stageNumber: 2, title: '作用域', status: 'active', description: '局部与全局',
              goal: '掌握词法作用域', coreConceptName: '作用域', estimatedHours: 6,
              subtasks: [
                { id: 't3', title: '作用域练习', status: 'in_progress', taskType: 'practice', estimatedMinutes: 25 }
              ]
            },
            {
              // 里程碑状态枚举三值之一（后端 task-completion.service.ts：locked → active → completed）；
              // M3 留未解锁，覆盖 .pd-stage--idle 分支（此前 fixture 全用 in_progress，正是漏测原因）
              id: 'm3', stageNumber: 3, title: '闭包', status: 'locked', description: '捕获与内存',
              subtasks: [
                { id: 't4', title: '闭包练习', status: 'todo', taskType: 'practice', estimatedMinutes: 30 }
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
    // 步点副标走子任务动态读数（M1 2 任务完成 + M2 1 任务进行中 + M3 1 未开始 = 2/4），
    // 不再是「整阶段收齐才 +1」的里程碑口径（2026-10-12 走查：恒 0 读作没进展）
    expect(wrapper.find('#cp-tab-path .cp-stp__meta').text()).toBe('任务 2/4');

    const pane = wrapper.find('#cp-tabpanel-path');
    expect(pane.exists()).toBe(true);
    expect(pane.find('.mk-card__title').text()).toBe('关联学习路径');
    // 面板内容体 = 阶段全展开（2026-10-18 用户走查：运营要一眼看到信息，不接受点开一个
    // 就把别的阶段收起）+ 治理动作；「总体进度」与「技术细节」2026-10-12 用户拍板撤
    // （各阶段头自带 N / M 任务，工程标识不进运营页面）
    expect(pane.text()).not.toContain('总体进度');
    expect(pane.text()).not.toContain('技术细节');
    const stageTitles = pane.findAll('.pd-stage__title').map((s) => s.text());
    expect(stageTitles).toEqual(['函数基础', '作用域', '闭包']);
    // 里程碑状态词汇（2026-10-14 修）：生产真值 'active' 必须翻译且给 info 档——
    // 此前只认 in_progress，active 裸出英文徽章、且被判成 idle，当前阶段与未解锁阶段视觉全同
    const stageCards = pane.findAll('.pd-stage');
    expect(stageCards.map((s) => s.find('.pd-stage__head .mk-badge').text())).toEqual(['已完成', '进行中', '未解锁']);
    expect(pane.text()).not.toContain('active');
    // --idle（压淡编号）只给未解锁：当前阶段与已完成阶段都不压
    expect(stageCards.map((s) => s.classes().includes('pd-stage--idle'))).toEqual([false, false, true]);
    // 全展开（2026-10-18）：三段的说明与任务行同时在场，不需要点开任何阶段
    expect(pane.findAll('.pd-stage__body')).toHaveLength(3);
    expect(pane.findAll('.pd-task').map((t) => t.find('.pd-task__title').text()))
      .toEqual(['函数定义', '参数与返回值', '作用域练习', '闭包练习']);
    expect(pane.text()).toContain('参数与返回值'); // M1 说明
    expect(pane.text()).toContain('目标掌握词法作用域'); // M2 目标
    expect(pane.text()).toContain('捕获与内存'); // M3 说明
    expect(pane.text()).toContain('核心概念：作用域');
    expect(pane.text()).toContain('2 / 2 任务'); // 阶段头自带完成数
    // 手风琴已退役：阶段头是分区标题（div），没有 aria-expanded / 折叠箭头
    expect(pane.find('.pd-stage__head').element.tagName).toBe('DIV');
    expect(pane.find('.pd-stage__head').attributes('aria-expanded')).toBeUndefined();
    expect(pane.find('.pd-stage__caret').exists()).toBe(false);
    // 旧出口退役：stepper 的 Path 步点即唯一入口，不再有「打开路径详情页」按钮
    expect(pane.text()).not.toContain('打开路径详情页');
    // 治理动作保留（真实能力：下线路径）
    expect(pane.text()).toContain('下线路径');

    wrapper.unmount();
  });

  it('页头显示会话所属学习者，并给出「查看学习者」入口（返回落回同一页签）', async () => {
    const payload = realTeachingPayload();
    payload.data.learner = { id: 'user_7', name: '陈晓', email: 'chenxiao@example.com' };
    payload.data.stageResults.path = payload.data.path;
    getRealSessionConsole.mockResolvedValue(payload);

    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    // 身份信息进身份区（名字常显，邮箱/id 进 title）
    const pill = wrapper.find('.cp-hero__learner');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('陈晓');
    expect(pill.attributes('title')).toContain('chenxiao@example.com');

    // 切到 Path 页签再跳：返回时要回到 Path，而不是会话默认页签
    await wrapper.findAll('.cp-stp')[1].trigger('click');
    await settle();
    const entry = wrapper.findAll('.mk-hero__actions button').find((b) => b.text() === '查看学习者');
    expect(entry).toBeTruthy();
    expect(entry!.attributes('title')).toContain('陈晓');
    await entry!.trigger('click');
    await settle();
    expect(subPage.value).toMatchObject({
      view: 'learner',
      id: 'user_7',
      from: { view: 'session-real', id: 'ts_real_1', label: '会话监控', stage: 'path' },
    });

    wrapper.unmount();
    subPage.value = null;
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
    expect(readonly.map((r) => r.attributes('title') || '')).toContain('真实会话不可从后台启动学习。仅在虚拟学习者会话下可从该课开始');

    wrapper.unmount();
  });

  it('Learn 就地切换课堂（2026-10-12 走查）：点已完成课 → 按其课堂会话取转录与单课总结，不再只能看一节课', async () => {
    const payload = realTeachingPayload();
    payload.data.stageResults.path = payload.data.path;
    // 课历史：task_1（已完成）→ ts_arch_1；当前课 task_2 → ts_real_1（同 bindings）
    payload.data.stageResults.teaching.teachingSessionHistory = [
      { teachingSessionId: 'ts_real_1', taskId: 'task_2', taskTitle: null, status: 'completed' },
      { teachingSessionId: 'ts_arch_1', taskId: 'task_1', taskTitle: null, status: 'completed' }
    ];
    getRealSessionConsole.mockImplementation(async (id: string) => {
      if (id === 'ts_arch_1') {
        return { data: { data: {
          kind: 'teaching',
          sessionId: 'ts_arch_1',
          teaching: {
            teachingSessionId: 'ts_arch_1',
            status: 'completed',
            messages: [{ role: 'assistant', content: '第二课的课堂记录标记' }],
            wrapup: { status: 'complete', summary: { topicSummary: '第二课小结' } }
          }
        } } };
      }
      return payload;
    });
    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    await wrapper.findAll('.cp-stp')[2].trigger('click'); // Learn 页签
    await settle();

    // 点第 2 课（task_1 → ts_arch_1）
    const row = wrapper.findAll('.cp-learn-tree__lesson').find((r) => (r.text() || '').includes('参数与返回值'));
    expect(row, '第 2 课行应存在').toBeTruthy();
    await row!.trigger('click');
    await settle();
    expect(getRealSessionConsole).toHaveBeenCalledWith('ts_arch_1');
    // 转录就地切换（不跳页）；单课总结不在此渲染（2026-10-12 二次拍板「总结就单独总结」——总结只住总结页签）
    expect(wrapper.find('.cp-lesson-head').text()).toContain('参数与返回值');
    expect(wrapper.text()).toContain('第二课的课堂记录标记');
    expect(wrapper.text()).not.toContain('第二课小结');

    // 总结页签：单课总结列表就地展开（不再跳 Learn；2026-10-12 二次拍板）
    await wrapper.findAll('.cp-stp')[3].trigger('click'); // 总结页签
    await settle();
    const summaryBtn = wrapper.findAll('.cp-wrapup-sum__row').find((b) => (b.text() || '').includes('参数与返回值'));
    expect(summaryBtn, '总结页签应有第 2 课的单课总结行').toBeTruthy();
    await summaryBtn!.trigger('click');
    await settle();
    expect(wrapper.find('#cp-tabpanel-wrapup').exists()).toBe(true);
    expect(getRealSessionConsole).toHaveBeenCalledWith('ts_arch_1');
    expect(wrapper.find('.cp-wrapup-sum__body').text()).toContain('第二课小结');

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
    //（用 .cp-stp__name 精确取阶段名：步点 meta 会带「学习者发言」等词，includes 会误中 Goal 步点）
    const stages = wrapper.findAll('.cp-stp');
    await stages.find((s) => s.find('.cp-stp__name').text() === '路径')!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('该真实会话尚未生成路径');

    // Learn tab：真实模式无教学记录空态
    await wrapper.findAll('.cp-stp').find((s) => s.find('.cp-stp__name').text() === '学习')!.trigger('click');
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

    // 诊断轨迹侧栏默认折叠：展开后可见三流时间线 + 裁判诊断
    const traceToggle = wrapper.findAll('button').find((b) => b.text().includes('诊断轨迹'));
    expect(traceToggle).toBeTruthy();
    await traceToggle!.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('裁判诊断');
    expect(wrapper.text()).toContain('时间线');
    const traceText = wrapper.find('.cp-trace-panel').text();
    expect(traceText).toContain('curious');
    expect(traceText).toContain('virtual-reply');

    wrapper.unmount();
  });

  it('检查点题目可查（2026-10-13 走查「教学会话看不到检查点题目」：检查点走结构化通道不进聊天逐字稿）', async () => {
    getRealSessionConsole.mockResolvedValue(realTeachingPayload());
    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    // 切到存课堂转录的 Learn 页签（默认落 wrapup）
    const learnTab = wrapper.findAll('.cp-stp').find((el) => el.find('.cp-stp__name').text() === '学习');
    await learnTab!.trigger('click');
    await nextTick();

    // 聊天逐字稿消息里没有题干（检查点单独渲染，不混进对话气泡）
    const q = '针对「完成5道错题重做」这条建议，它预设的动机状态是什么？';
    expect(wrapper.findAll('.cp-transcript__message').some((m) => m.text().includes(q))).toBe(false);
    // 2026-10-19 用户走查「检查点怎么在下方，不符合课堂阅读顺序」：不再有末尾的汇总块，
    // 改为按 submittedAt 内联在课堂列里（与消息同级）
    expect(wrapper.find('.cp-checkpoints').exists()).toBe(false);
    const block = wrapper.find('.cp-checkpoint--inline');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('检查点');
    expect(block.text()).toContain(q);
    expect(block.text()).toContain('未通过');
    expect(block.text()).toContain('理解度 75%');
    expect(block.text()).toContain('识别隐含动机假设');

    wrapper.unmount();
  });

  /** 2026-10-18 用户走查「原始会话数据偏源码开发」：主列不再内联整包 JSON，
   *  改为一行数据包读数；完整载荷点「查看原始数据」进弹层，复制拿到的必须是完整串。 */
  it('会话数据包：主列只出读数，原始 JSON 进弹层且复制为完整载荷', async () => {
    const payload = realTeachingPayload();
    // 造一个超长字段（真实会话的 path 树/消息远超此量级）
    payload.data.path.milestones[0].description = '长'.repeat(5000);
    getRealSessionConsole.mockResolvedValue(payload);

    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const wrapper = await mountCockpit('session-real', 'ts_real_1');
    const pkg = wrapper.find('.cp-raw');
    // 折叠态：页面上没有 JSON 直排（pre），只有一行读数与两个动作
    expect(pkg.find('pre').exists()).toBe(false);
    expect(pkg.text()).toContain('教学会话');
    expect(pkg.text()).toContain('条消息');
    expect(pkg.findAll('button').map((b) => b.text())).toEqual(['查看原始数据', '复制 JSON']);

    // 打开弹层：完整载荷（无 4000 截断）+ 字符总数
    await pkg.findAll('button').find((b) => b.text() === '查看原始数据')!.trigger('click');
    await flushPromises();
    const view = document.body.querySelector('.cp-rawview') as HTMLElement | null;
    expect(view).not.toBeNull();
    expect(view!.querySelector('.cp-rawview__meta')!.textContent).toMatch(/\d{1,3}(,\d{3})* 字符/);
    expect(view!.querySelector('pre')!.textContent!.length).toBeGreaterThan(5000);
    expect(view!.querySelector('pre')!.textContent).toContain('"kind": "teaching"');

    // 复制：拿到的必须是完整串（弹层展示与复制同源）
    const copyBtn = [...view!.querySelectorAll('button')].find((b) => b.textContent === '复制完整 JSON') as HTMLButtonElement;
    copyBtn.click();
    await flushPromises();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.length).toBeGreaterThan(5000);
    expect(copied).toContain('"kind": "teaching"');

    wrapper.unmount();
  });
});
