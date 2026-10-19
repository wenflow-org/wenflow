/**
 * 真实会话控制台同构端点测试（遗留项 1：SessionCockpit 适配真实教学会话）
 * - 未知 sessionId → 404
 * - teaching_sessions → 同构载荷（goal/path/teaching/runtime/stageResults/evidence/timeline）
 * - goal_conversations → 同构载荷（无 path / 无 teaching 的降级空态）
 * - buildTimeline 时间升序 + 类型齐全
 */

const mockPrisma = {
  teaching_sessions: { findUnique: jest.fn(), findMany: jest.fn() },
  // 消息子表（水合）：侧表无行 → 旧会话回退读列，测试用列数据不受影响
  teaching_session_messages: { findMany: jest.fn().mockResolvedValue([]) },
  goal_conversations: { findUnique: jest.fn(), findFirst: jest.fn() },
  learning_paths: { findUnique: jest.fn() },
  milestones: { findMany: jest.fn() },
  subtasks: { findUnique: jest.fn() },
  learner_evidence: { findMany: jest.fn() },
  // 本节课负荷聚合（session_load 行）；默认无行 → teaching.sessionLoad = null
  learning_metrics: { findUnique: jest.fn().mockResolvedValue(null) },
};

jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

// 资料仓库落盘在 data/uploads/materials/<userId>/（fs），测试按空仓对待，需要时逐例注入
const mockListMaterials = jest.fn().mockReturnValue([]);
const mockReadMaterial = jest.fn().mockReturnValue(null);
jest.mock('../../services/materials/material-store', () => ({
  __esModule: true,
  listMaterials: (...args: unknown[]) => mockListMaterials(...args),
  readMaterial: (...args: unknown[]) => mockReadMaterial(...args),
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
    // 学习者身份（2026-10-18）：页头据此显示「这是谁的会话」并给出去学习者详情的入口
    expect(data.learner).toEqual({ id: 'user_1', name: '陈晓', email: 'chenxiao@example.com' });

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
    expect(data.learner).toEqual({ id: 'user_1', name: '陈晓', email: 'chenxiao@example.com' });
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

  // 2026-10-11 走查回归：侧表权威的会话（全库 827/827 都有侧表行）课堂消息一度恒为 0 条
  // —— 水合把 messages 列覆写成数组后，teachingMessages 仍按 JSON 字符串解析，parse 抛错被兜底吞成 []。
  it('侧表有行（messages 列已置 null）→ 水合后的数组仍被读成课堂消息', async () => {
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(teachingSessionRow({ messages: null, status: 'discarded' }));
    mockPrisma.goal_conversations.findFirst.mockResolvedValue(goalConversationRow());
    mockPrisma.learning_paths.findUnique.mockResolvedValue(null);
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.subtasks.findUnique.mockResolvedValue(null);
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);
    mockPrisma.teaching_session_messages.findMany.mockResolvedValue([
      { id: 1, payload: JSON.stringify({ role: 'user', content: '产业园选址题怎么从材料里找点？', timestamp: '2026-08-12T14:00:00.000Z' }) },
      { id: 2, payload: JSON.stringify({ role: 'assistant', content: '先逐段圈依据，再按设问归类。', timestamp: '2026-08-12T14:00:05.000Z' }) },
      { id: 3, payload: JSON.stringify({ role: 'user', content: '图表里的信息也算依据吗？', timestamp: '2026-08-12T14:01:00.000Z' }) },
    ]);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1' } }, res);
    const data = res.json.mock.calls[0][0].data;

    expect(data.conversations.learning.messages).toHaveLength(3);
    expect(data.teaching.messageCount).toBe(2); // 侧表内 user 角色条数
    expect(data.teaching.messages[0].content).toContain('产业园选址');
    // 时间线：课堂消息按 teaching 源进入（修复前这一源断供）；末尾那条是 wrapup 的「会话总结已生成」
    const teachingEntries = data.timeline.filter((t: any) => t.kind === 'teaching');
    expect(teachingEntries).toHaveLength(4);
    expect(teachingEntries[0].detail).toContain('产业园选址');
    expect(teachingEntries[2].title).toBe('学习者消息');
  });

  // 2026-10-17：session_load 此前是「写了没人看」的死仓（全库 118 行、零运行时读取方）。
  // 控制台总结页成为它的第一个消费者；本用例钉住 API 侧的映射口径（无行 → null，不造 0）。
  it('本节课负荷聚合：有 session_load 行 → teaching.sessionLoad 带均值/峰值/依据分布/轮数', async () => {
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(teachingSessionRow({ status: 'completed' }));
    mockPrisma.goal_conversations.findFirst.mockResolvedValue(null);
    mockPrisma.learning_paths.findUnique.mockResolvedValue(null);
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.subtasks.findUnique.mockResolvedValue(null);
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);
    mockPrisma.learning_metrics.findUnique.mockResolvedValue({
      value: 0.264,
      metadata: JSON.stringify({ max: 0.4, basisDist: { semantic: 7 }, perTurnCount: 7, scale: '0-1' }),
    });

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1' } }, res);
    const data = res.json.mock.calls[0][0].data;

    expect(mockPrisma.learning_metrics.findUnique).toHaveBeenCalledWith({
      where: { sourceKey: 'session-load:ts_real_1' },
      select: { value: true, metadata: true },
    });
    expect(data.teaching.sessionLoad).toEqual({
      mean: 0.264,
      max: 0.4,
      basisDist: { semantic: 7 },
      perTurnCount: 7,
    });
  });

  it('本节课无负荷证据（旧会话 / 弃跑课）→ teaching.sessionLoad = null，不是 0', async () => {
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(teachingSessionRow({ status: 'completed' }));
    mockPrisma.goal_conversations.findFirst.mockResolvedValue(null);
    mockPrisma.learning_paths.findUnique.mockResolvedValue(null);
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.subtasks.findUnique.mockResolvedValue(null);
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);
    mockPrisma.learning_metrics.findUnique.mockResolvedValue(null);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1' } }, res);
    expect(res.json.mock.calls[0][0].data.teaching.sessionLoad).toBeNull();
  });

  // 2026-10-11 走查：goal 阶段会把学习者携带的资料与系统联网采集的资料纳入上下文，结果要在监控页可见
  it('目标对话控制台：学习者资料投影（上传 / 联网两类 + brief 理解摘要，正文不进载荷）', async () => {
    const conversation = goalConversationRow({ learningPathId: null });
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(conversation);
    mockListMaterials.mockReturnValue([
      {
        id: 'mat_1',
        userId: 'user_1',
        name: '指南-抽取.txt',
        charCount: 22284,
        structure: { headingCount: 3 },
        anchors: [{ heading: '健康', location: '1', preview: 'x' }],
        warnings: ['占位告警'],
        createdAt: '2026-09-22T14:44:00.648Z',
        origin: 'upload',
        brief: { docType: '指南', subject: '学习与发展指南', audience: '教师', overview: '本文件为指导纲要…', coreConcepts: ['五大领域'], naturalDivisions: ['按五大领域'], toc: [{ title: 'A', gist: 'a' }] },
      },
      {
        id: 'mat_2',
        userId: 'user_1',
        name: '如何阅读一本书',
        charCount: 100035,
        structure: { headingCount: 0 },
        anchors: [],
        warnings: [],
        createdAt: '2026-09-26T00:06:24.026Z',
        fetchedAt: '2026-09-26T00:06:24.026Z',
        origin: 'web',
        sourceUrl: 'https://example.org/books/how-to-read.pdf',
        brief: null,
      },
    ]);

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'gc_1' } }, res);
    const data = res.json.mock.calls[0][0].data;

    expect(mockListMaterials).toHaveBeenCalledWith('user_1');
    expect(data.kind).toBe('goal');
    expect(data.materials).toHaveLength(2);
    expect(data.materials[0]).toMatchObject({
      name: '指南-抽取.txt',
      origin: 'upload',
      charCount: 22284,
      headingCount: 3,
      anchorCount: 1,
      warningCount: 1,
      sourceUrl: null,
      brief: { docType: '指南', subject: '学习与发展指南', tocCount: 1 },
    });
    expect(data.materials[1]).toMatchObject({ origin: 'web', sourceUrl: 'https://example.org/books/how-to-read.pdf', brief: null });
    // 正文/大字段不进载荷（单份正文可达 100k 字符）
    expect(JSON.stringify(data.materials)).not.toContain('markdown');
  });

  it('资料读取失败不阻断控制台（fail-open 空列表）', async () => {
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(goalConversationRow({ learningPathId: null }));
    mockListMaterials.mockImplementation(() => { throw new Error('disk down'); });

    const handler = getRouteHandler('/:sessionId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'gc_1' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.materials).toEqual([]);
  });
});

describe('GET /api/admin/session-console/material/:sessionId/:materialId（资料全文，点开才取）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(null);
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(null);
    mockReadMaterial.mockReturnValue(null);
  });

  it('未知会话 → 404；资料读权限收在会话边界（不接 userId 入参）', async () => {
    const handler = getRouteHandler('/material/:sessionId/:materialId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'nope', materialId: 'mat_1' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockReadMaterial).not.toHaveBeenCalled();
  });

  it('goal 会话 → 按会话反查归属用户读盘返回全文；非该学习者资料 → 404', async () => {
    mockPrisma.goal_conversations.findUnique.mockResolvedValue(goalConversationRow());
    const handler = getRouteHandler('/material/:sessionId/:materialId', 'get');

    mockReadMaterial.mockReturnValue({
      record: { id: 'mat_1', userId: 'user_1', name: '指南-抽取.txt', origin: 'upload', charCount: 6, structure: {}, anchors: [], warnings: [], createdAt: '2026-09-22T14:44:00.648Z' },
      markdown: '正文全文内容',
    });
    const res = createResponse();
    await handler({ params: { sessionId: 'gc_1', materialId: 'mat_1' } }, res);

    expect(mockReadMaterial).toHaveBeenCalledWith('user_1', 'mat_1');
    const data = res.json.mock.calls[0][0].data;
    expect(data.name).toBe('指南-抽取.txt');
    expect(data.markdown).toBe('正文全文内容');
    expect(data.truncated).toBe(false);

    mockReadMaterial.mockReturnValue(null);
    const res2 = createResponse();
    await handler({ params: { sessionId: 'gc_1', materialId: 'mat_other' } }, res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });

  it('teaching 会话同样可取；超长正文截断并标记（20 万字封顶）', async () => {
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue(teachingSessionRow());
    const long = 'x'.repeat(200_001);
    mockReadMaterial.mockReturnValue({
      record: { id: 'mat_big', userId: 'user_1', name: '大书.md', origin: 'web', charCount: 200_001, structure: {}, anchors: [], warnings: [], createdAt: '2026-09-26T00:06:24.026Z' },
      markdown: long,
    });
    const handler = getRouteHandler('/material/:sessionId/:materialId', 'get');
    const res = createResponse();
    await handler({ params: { sessionId: 'ts_real_1', materialId: 'mat_big' } }, res);

    const data = res.json.mock.calls[0][0].data;
    expect(data.truncated).toBe(true);
    expect(data.markdown).toHaveLength(200_000);
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

  it('证据条目给人读 detail（不再把 payload JSON 前缀摆到主视觉位），整包仍留在 raw', () => {
    const timeline = buildTimeline({
      evidence: [
        {
          occurredAt: new Date('2026-10-01T14:12:26.000Z'),
          evidenceType: 'path:created',
          payload: JSON.stringify({ pathId: 'lp_1', title: 'Python 服务容器化部署到 K8s', subject: 'Python' }),
        },
        {
          occurredAt: new Date('2026-10-01T14:24:38.000Z'),
          evidenceType: 'path:generated',
          payload: JSON.stringify({ pathId: 'lp_1', taskCount: 33, milestoneCount: 3, sourceConversationId: 'gc_1' }),
        },
        {
          occurredAt: new Date('2026-10-01T14:30:00.000Z'),
          evidenceType: 'lesson:completed',
          payload: '{}',
        },
      ],
    });

    const [created, generated, lesson] = timeline;

    expect(created.title).toBe('path:created'); // 原枚举保留（前端过中文词表）
    expect(created.detail).toBe('路径「Python 服务容器化部署到 K8s」');
    expect(created.raw).toContain('"pathId":"lp_1"');
    expect(generated.detail).toBe('已生成 33 个任务 / 3 个里程碑');
    // 空 payload 不再产生「 · {}」这种噪音
    expect(lesson.detail).toBe('');
    // 主视觉位不出现 JSON 花括号
    for (const t of timeline) expect(t.detail).not.toContain('{');
  });

  it('其余生产事件类型也给读数（学习结果 / 检查点作答 / 难度调整 / 提炼与抽取）', () => {
    const timeline = buildTimeline({
      evidence: [
        { occurredAt: new Date('2026-10-02T08:49:57.000Z'), evidenceType: 'session:outcome', payload: JSON.stringify({ conceptKey: '区分已留痕与未留痕账目', status: 'mastered', progress: 95 }) },
        { occurredAt: new Date('2026-10-02T09:08:18.000Z'), evidenceType: 'checkpoint:attempt', payload: JSON.stringify({ checkpointId: 'cp_1', type: 'single_choice', title: '你刚把一行字敲进终端，下一步该看什么' }) },
        { occurredAt: new Date('2026-10-02T08:55:33.000Z'), evidenceType: 'task:difficulty:adjustment', payload: JSON.stringify({ baseline: 5, adjusted: 4, direction: 'decrease' }) },
        { occurredAt: new Date('2026-10-02T08:50:18.000Z'), evidenceType: 'session-knowledge-distilled', payload: JSON.stringify({ conceptLedger: [{ conceptKey: 'a' }, { conceptKey: 'b' }] }) },
        { occurredAt: new Date('2026-10-02T08:50:19.000Z'), evidenceType: 'dialogue-concepts-extracted', payload: JSON.stringify({ recurringConfusions: [{ x: 1 }], transferSignals: [{ y: 2 }, { z: 3 }] }) },
      ],
    });
    const details = timeline.map((t) => t.detail);
    expect(details).toContain('概念「区分已留痕与未留痕账目」· 已掌握');
    expect(details).toContain('题目：你刚把一行字敲进终端，下一步该看什么');
    expect(details).toContain('难度 5 → 4');
    expect(details).toContain('2 个概念入账');
    expect(details).toContain('困惑 1 · 迁移信号 2');
    for (const d of details) expect(d).not.toContain('{');
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
