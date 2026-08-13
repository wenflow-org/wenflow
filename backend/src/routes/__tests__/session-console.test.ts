/**
 * 真实会话控制台同构端点测试（遗留项 1：SessionCockpit 适配真实教学会话）
 * - 未知 sessionId → 404
 * - teaching_sessions → 同构载荷（goal/path/teaching/runtime/stageResults/evidence/timeline）
 * - goal_conversations → 同构载荷（无 path / 无 teaching 的降级空态）
 * - buildTimeline 时间升序 + 类型齐全
 */

const mockPrisma = {
  teaching_sessions: { findUnique: jest.fn(), findMany: jest.fn() },
  goal_conversations: { findUnique: jest.fn(), findFirst: jest.fn() },
  learning_paths: { findUnique: jest.fn() },
  milestones: { findMany: jest.fn() },
  subtasks: { findUnique: jest.fn() },
  learner_evidence: { findMany: jest.fn() },
};

jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

import router, { buildTimeline } from '../admin/session-console';

function getRouteHandler(path: string, method: 'get' | 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function teachingSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts_real_1',
    userId: 'user_1',
    taskId: 'task_1',
    learningPathId: 'lp_1',
    milestoneId: 'ms_1',
    subject: 'Python 入门',
    topic: '函数练习 2/5：参数与返回值',
    taskType: 'practice',
    mode: 'tutor',
    status: 'completed',
    messages: JSON.stringify([
      { role: 'user', content: '我不理解作用域', timestamp: '2026-08-12T14:00:00.000Z' },
      { role: 'assistant', content: '作用域是变量可见的范围…', timestamp: '2026-08-12T14:00:05.000Z' },
    ]),
    knowledgeState: JSON.stringify([
      { name: '作用域', status: 'learning', progress: 0.6 },
      { name: '默认参数', status: 'mastered', progress: 1 },
    ]),
    teachingState: null,
    wrapup: JSON.stringify({
      status: 'complete',
      summary: {
        topicSummary: '围绕函数作用域展开…',
        knowledgeSummary: '掌握默认参数…',
        practiceAdvice: '完成 3 道纯函数改写练习。',
        learningEvaluation: '通过但用时偏长。',
      },
      sources: { summary: 'model' },
      generatedAt: '2026-08-12T15:00:00.000Z',
    }),
    advisory: JSON.stringify({ shouldSuggest: true, priority: 'medium', rationale: '建议复习', ui: { title: '复习', body: '建议下课前插入图例复盘。' } }),
    startTime: new Date('2026-08-12T14:00:00.000Z'),
    endTime: new Date('2026-08-12T14:20:00.000Z'),
    duration: 1200,
    revision: 1,
    openKey: null,
    operationId: null,
    operationKind: null,
    operationLeaseExpiresAt: null,
    createdAt: new Date('2026-08-12T14:00:00.000Z'),
    updatedAt: new Date('2026-08-12T14:20:00.000Z'),
    users: { id: 'user_1', name: '陈晓', email: 'chenxiao@example.com' },
    ...overrides,
  };
}

function goalConversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gc_1',
    userId: 'user_1',
    status: 'completed',
    stage: 'completed',
    description: '学会用 Python 处理 Excel 报表',
    messages: JSON.stringify([
      { role: 'user', content: '我想学 Python 处理表格', time: '2026-08-11T10:00:00.000Z' },
      { role: 'ai', content: '好的，我们先明确你的真实问题…', time: '2026-08-11T10:00:10.000Z' },
    ]),
    collectedData: JSON.stringify({
      messages: [
        { role: 'user', content: '我想学 Python 处理表格', time: '2026-08-11T10:00:00.000Z' },
        { role: 'ai', content: '好的，我们先明确你的真实问题…', time: '2026-08-11T10:00:10.000Z' },
      ],
      confidence: 0.85,
      stage: 'completed',
      understanding: { real_problem: '手动汇总周报耗时' },
    }),
    learningPathId: 'lp_1',
    completedAt: new Date('2026-08-11T10:30:00.000Z'),
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:30:00.000Z'),
    users: { id: 'user_1', name: '陈晓', email: 'chenxiao@example.com' },
    ...overrides,
  };
}

function milestoneRows() {
  return [
    {
      id: 'ms_1',
      learningPathId: 'lp_1',
      stageNumber: 1,
      title: '函数基础',
      description: '参数与返回值',
      estimatedHours: 4,
      status: 'completed',
      startedAt: new Date('2026-08-11T11:00:00.000Z'),
      completedAt: new Date('2026-08-12T13:00:00.000Z'),
      subtasks: [
        { id: 'task_0', title: '函数定义', status: 'completed', order: 1, completedAt: new Date('2026-08-11T12:00:00.000Z') },
        { id: 'task_1', title: '参数与返回值', status: 'completed', order: 2, completedAt: new Date('2026-08-12T13:00:00.000Z') },
      ],
    },
    {
      id: 'ms_2',
      learningPathId: 'lp_1',
      stageNumber: 2,
      title: '作用域',
      description: '局部与全局',
      estimatedHours: 3,
      status: 'active',
      startedAt: new Date('2026-08-12T14:00:00.000Z'),
      completedAt: null,
      subtasks: [
        { id: 'task_2', title: '作用域练习', status: 'in_progress', order: 1, completedAt: null },
      ],
    },
  ];
}

describe('GET /api/admin/session-console/:sessionId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(null);
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(null);
  });

  it('未知 sessionId → 404（非教学会话/目标对话）', async () => {
    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'nope' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it('teaching_sessions：完整载荷映射（goal 经 path 反查 / path 里程碑 / teaching 当前任务 / evidence 摘要 / timeline）', async () => {
    const session = teachingSessionRow();
    const conversation = goalConversationRow();
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(session);
    mockPrisma.goal_conversations.findFirst.mockResolvedValue(conversation);
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      id: 'lp_1',
      title: 'Python 入门学习路径',
      name: 'Python 入门学习路径',
      description: '从基础到自动化',
      difficulty: 'beginner',
      estimatedHours: 40,
      status: 'active',
      totalMilestones: 2,
      completedMilestones: 1,
      createdAt: new Date('2026-08-11T11:00:00.000Z'),
    });
    mockPrisma.milestones.findMany.mockResolvedValue(milestoneRows());
    mockPrisma.subtasks.findUnique.mockResolvedValue({ id: 'task_1', title: '参数与返回值' });
    mockPrisma.learner_evidence.findMany.mockResolvedValue([
      { id: 'lev_1', evidenceType: 'lesson:completed', confidence: 0.9, occurredAt: new Date('2026-08-12T14:20:00.000Z'), payload: '{"performance":"ok"}' },
      { id: 'lev_2', evidenceType: 'lesson:completed', confidence: 0.8, occurredAt: new Date('2026-08-12T14:25:00.000Z'), payload: '{}' },
      { id: 'lev_3', evidenceType: 'learner:confusion:detected', confidence: 0.7, occurredAt: new Date('2026-08-12T14:10:00.000Z'), payload: '{}' },
    ]);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    const data = res.json.mock.calls[0][0].data;
    expect(data.kind).toBe('teaching');
    expect(data.sessionId).toBe('ts_real_1');

    // goal 经 learningPathId 反查
    expect(data.goal.conversationId).toBe('gc_1');
    expect(data.goal.ready).toBe(true);
    expect(data.goal.confidence).toBe(0.85);

    // path：里程碑 + 子任务 + 进度
    expect(data.path.id).toBe('lp_1');
    expect(data.path.totalMilestones).toBe(2);
    expect(data.path.milestones).toHaveLength(2);
    expect(data.path.milestones[0].tasks).toHaveLength(2);
    expect(data.path.milestones[0].tasks[1].completed).toBe(true);
    expect(data.runtime.stageStatus.path.generated).toBe(true);
    expect(data.runtime.bindings.learningPathId).toBe('lp_1');

    // teaching：当前任务/阶段/进度（teaching 阶段由 teaching_sessions.status + taskId/milestone 推导）
    expect(data.teaching.teachingSessionId).toBe('ts_real_1');
    expect(data.teaching.taskTitle).toBe('参数与返回值');
    expect(data.teaching.messageCount).toBe(1);
    expect(data.teaching.wrapup.summary.learningEvaluation).toContain('通过');
    expect(data.runtime.currentStage).toBe('wrapup');
    expect(data.runtime.bindings.currentTaskId).toBe('task_1');
    expect(data.runtime.stageStatus.learning.wrapup).toBeTruthy();

    // stageResults 契约对齐：blackbox=null（真实会话无黑盒数据）
    expect(data.stageResults.blackbox).toBeNull();
    expect(data.stageResults.goal.conversationId).toBe('gc_1');
    expect(data.stageResults.teaching.wrapup).toBeTruthy();

    // learner_evidence 摘要
    expect(data.evaluation.total).toBe(3);
    expect(data.evaluation.types).toHaveLength(2);
    expect(data.evaluation.avgConfidence).toBeCloseTo(0.8, 1);

    // 时间线：goal 消息 / path 里程碑 / teaching 消息 / evidence / wrapup 齐全且升序
    const timeline = data.timeline;
    expect(timeline.length).toBeGreaterThanOrEqual(5);
    const kinds = new Set(timeline.map((t: any) => t.kind));
    expect(kinds.has('goal')).toBe(true);
    expect(kinds.has('path')).toBe(true);
    expect(kinds.has('teaching')).toBe(true);
    expect(kinds.has('evidence')).toBe(true);
    const times = timeline.map((t: any) => t.time);
    expect([...times].sort()).toEqual(times);
  });

  it('teaching_sessions：无 goal/path 关联 → goal/path 空态降级（null），不为虚拟 API 报错', async () => {
    const session = teachingSessionRow({ learningPathId: null, milestoneId: null, taskId: 'task_orphan' });
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(session);
    mockPrisma.goal_conversations.findFirst.mockResolvedValue(null);
    mockPrisma.learning_paths.findUnique.mockResolvedValue(null);
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.subtasks.findUnique.mockResolvedValue(null);
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1' } }, res);

    const data = res.json.mock.calls[0][0].data;
    expect(data.goal).toBeNull();
    expect(data.path).toBeNull();
    expect(data.evaluation).toBeNull();
    expect(data.runtime.currentStage).toBe('wrapup');
    expect(data.runtime.stageStatus.goal).toBeNull();
    expect(data.conversations.goal.messages).toEqual([]);
    expect(data.timeline.length).toBeGreaterThanOrEqual(1);
  });

  it('goal_conversations：path 已生成 + teaching 历史 → currentStage=teaching；无 path → goal', async () => {
    const conversation = goalConversationRow();
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(conversation);
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      id: 'lp_1',
      title: 'Python 入门学习路径',
      status: 'active',
      totalMilestones: 2,
      completedMilestones: 0,
      createdAt: new Date('2026-08-11T11:00:00.000Z'),
    });
    mockPrisma.milestones.findMany.mockResolvedValue(milestoneRows());
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([
      teachingSessionRow({ status: 'active', wrapup: null }),
    ]);
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'gc_1' } }, res);

    const data = res.json.mock.calls[0][0].data;
    expect(data.kind).toBe('goal');
    expect(data.goal.conversationId).toBe('gc_1');
    expect(data.goal.ready).toBe(true);
    expect(data.runtime.currentStage).toBe('teaching');
    expect(data.runtime.bindings.teachingSessionId).toBe('ts_real_1');
    expect(data.conversations.goal.messages).toHaveLength(2);
    // role 'ai' 归一为 assistant
    expect(data.conversations.goal.messages[1].role).toBe('assistant');

    // 无 path 的 goal（降级）
    mockPrisma.learning_paths.findUnique.mockResolvedValue(null);
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([]);
    const res2 = createResponse();
    const conv2 = goalConversationRow({ learningPathId: null, status: 'active', stage: 'proposing' });
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(conv2);
    await handler({ params: { sessionId: 'gc_1' } }, res2);
    const data2 = res2.json.mock.calls[0][0].data;
    expect(data2.path).toBeNull();
    expect(data2.teaching).toBeNull();
    expect(data2.runtime.currentStage).toBe('goal');
    expect(data2.runtime.stageStatus.goal.ready).toBe(false);
  });
});

describe('buildTimeline（时间线合成）', () => {
  it('按时间升序，goal/path/teaching/evidence 各源合并', () => {
    const timeline = buildTimeline({
      goalConversation: {
        messages: JSON.stringify([{ role: 'user', content: '目标', time: '2026-08-11T10:00:00.000Z' }]),
        collectedData: '{}',
      },
      pathView: {
        id: 'lp_1',
        title: '路径',
        createdAt: '2026-08-11T11:00:00.000Z',
        milestones: [
          { stageNumber: 1, title: 'M1', startedAt: '2026-08-11T11:05:00.000Z', completedAt: '2026-08-12T13:00:00.000Z', tasks: [{ title: '任务A', completedAt: '2026-08-12T12:00:00.000Z' }] },
        ],
      },
      teachingMessages: [
        { role: 'user', content: '我不懂', time: '2026-08-12T14:00:00.000Z' },
        { role: 'assistant', content: '解释', time: '2026-08-12T14:00:05.000Z' },
      ],
      evidence: [
        { occurredAt: new Date('2026-08-12T14:20:00.000Z'), evidenceType: 'lesson:completed', payload: '{}' },
      ],
      wrapup: { generatedAt: '2026-08-12T15:00:00.000Z' },
    });

    expect(timeline).toHaveLength(9);
    const times = timeline.map((t) => t.time);
    expect([...times].sort()).toEqual(times);
    expect(timeline[0].kind).toBe('goal');
    expect(timeline[timeline.length - 1].title).toBe('会话总结已生成');
  });

  it('prisma Date 对象（路径 createdAt）归一为 ISO 后参与字典序，不破坏时间升序', () => {
    const timeline = buildTimeline({
      goalConversation: {
        messages: JSON.stringify([{ role: 'user', content: '目标', time: '2026-08-05T14:47:19.671Z' }]),
        collectedData: '{}',
      },
      pathView: {
        id: 'lp_1',
        title: '路径',
        // 真实 prisma 返回 Date 对象而非字符串
        createdAt: new Date('2026-08-05T14:47:19.629Z'),
        milestones: [
          { stageNumber: 1, title: 'M1', startedAt: new Date('2026-08-05T14:50:00.000Z'), completedAt: null, tasks: [] },
        ],
      },
      teachingMessages: [{ role: 'assistant', content: '解释', time: '2026-08-05T14:50:15.370Z' }],
      evidence: [{ occurredAt: new Date('2026-08-05T14:50:15.370Z'), evidenceType: 'lesson:completed', payload: '{}' }],
      wrapup: null,
    });

    const times = timeline.map((t) => t.time);
    expect([...times].sort()).toEqual(times);
    // 路径创建（Date 对象）应排在 teaching/evidence 之前，而不是被 String() 本地化文本甩到末尾
    expect(times[times.length - 1]).toBe('2026-08-05T14:50:15.370Z');
  });

  it('无时间字段条目被过滤，空输入 → []', () => {
    const timeline = buildTimeline({
      teachingMessages: [{ role: 'user', content: 'x', time: null }],
      pathView: null,
      goalConversation: null,
      evidence: [],
      wrapup: null,
    });
    expect(timeline).toEqual([]);
  });
});
