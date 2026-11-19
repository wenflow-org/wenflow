/**
 * #105 观测统一：任务结算通道分流的路由契约。
 *
 * 锁定 `POST /api/learning/tasks/:taskId/complete` 写入 `learningService.completeTask` 的
 * `completionSource` 三个取值：human-ui（真人 UI）/ learning-api（程序化学习 API 调用方）/
 * vl-blackbox（blackbox VL 投影通道，优先于调用方标记）。
 */
const mockLearningService = {
  getLearningPath: jest.fn(),
  completeTask: jest.fn(),
};
const mockRecordDirectTaskCompletion = jest.fn();
const mockGetTeachingSessionById = jest.fn();
const mockFindLatestTutorSession = jest.fn();

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: mockLearningService,
}));
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({
  teachingSessionRepository: {
    recordDirectTaskCompletion: (...args: unknown[]) => mockRecordDirectTaskCompletion(...args),
    getById: (...args: unknown[]) => mockGetTeachingSessionById(...args),
    findLatestTutorSession: (...args: unknown[]) => mockFindLatestTutorSession(...args),
  },
}));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../coordinators/path.coordinator', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn(),
}));
jest.mock('../../services/learning/path-mutation-safety', () => ({
  isPathMutationConflictError: jest.fn(() => false),
}));

import router from '../learning';

type RouteHandler = (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>;

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle: RouteHandler }>;
  };
};

function getPostHandler(path: string): RouteHandler {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((item) => item.route?.path === path && item.route?.methods?.post);
  const routeStack = layer?.route?.stack;
  if (!routeStack || routeStack.length === 0) throw new Error(`Route not found: ${path}`);
  return routeStack[routeStack.length - 1].handle;
}

function createResponse() {
  const json = jest.fn();
  const status = jest.fn();
  const res = { status, json };
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  return res;
}

type CompletionSourcePayload = { taskId: string; userId: string; completionSource: string };

describe('#105 任务结算通道按调用方身份分流（completionSource）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLearningService.completeTask.mockResolvedValue({
      task: { id: 'task-1', status: 'completed', completedAt: null },
      alreadyCompleted: false,
    });
    // 默认：任务没有课堂（纯路径任务）→ 契约门不介入，保持 #105 既有语义。
    mockGetTeachingSessionById.mockResolvedValue(null);
    mockFindLatestTutorSession.mockResolvedValue(null);
  });

  it('locks human-ui / learning-api / vl-blackbox for the three caller identities', async () => {
    const handler = getPostHandler('/tasks/:taskId/complete');

    const cases: Array<{
      label: string;
      expected: string;
      request: () => Record<string, unknown>;
      userId: string;
      taskId: string;
    }> = [
      {
        // 真人 UI：浏览器 HttpOnly Cookie 会话，不注入 Authorization / X-Caller-Agent
        label: '真人 UI（Cookie 会话）→ human-ui',
        expected: 'human-ui',
        userId: 'user-human',
        taskId: 'task-human',
        request: () => ({
          headers: {},
          user: { userId: 'user-human', sessionType: 'user' },
          params: { taskId: 'task-human' },
          body: { actualMinutes: 30 },
        }),
      },
      {
        label: '学习 API 调用方（Authorization: Bearer）→ learning-api',
        expected: 'learning-api',
        userId: 'user-api',
        taskId: 'task-api',
        request: () => ({
          headers: { authorization: 'Bearer api-access-token' },
          user: { userId: 'user-api', sessionType: 'user' },
          params: { taskId: 'task-api' },
          body: {},
        }),
      },
      {
        label: '学习 API 调用方（X-Caller-Agent 标记）→ learning-api',
        expected: 'learning-api',
        userId: 'user-api-2',
        taskId: 'task-api-2',
        request: () => ({
          headers: { 'x-caller-agent': 'virtual-learner-lab' },
          user: { userId: 'user-api-2', sessionType: 'user' },
          params: { taskId: 'task-api-2' },
          body: {},
        }),
      },
      {
        // 黑盒 VL 投影通道：synthetic 投影优先级高于调用方标记（黑盒适配器同时带 X-Caller-Agent）
        label: 'blackbox VL 投影（synthetic + X-Caller-Agent）→ vl-blackbox',
        expected: 'vl-blackbox',
        userId: 'user-vl',
        taskId: 'task-vl',
        request: () => ({
          headers: { 'x-caller-agent': 'virtual-learner-lab' },
          user: {
            userId: 'user-vl',
            projection: { grantSource: 'synthetic', capabilities: ['task:write'], virtualSessionId: 'vs-1' },
          },
          params: { taskId: 'task-vl' },
          body: {},
        }),
      },
    ];

    for (const item of cases) {
      mockLearningService.completeTask.mockClear();
      const res = createResponse();
      const next = jest.fn();

      await handler(item.request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();

      const calls = mockLearningService.completeTask.mock.calls;
      expect(`${item.label} 调用次数=${calls.length}`).toBe(`${item.label} 调用次数=1`);
      const payload = calls[0][0] as CompletionSourcePayload;
      expect(payload.taskId).toBe(item.taskId);
      expect(payload.userId).toBe(item.userId);
      expect(`${item.label} 实际=${payload.completionSource}`).toBe(`${item.label} 实际=${item.expected}`);
    }
  });

  it('带 teachingSessionId 时补记 VL 课堂 finalization 台账（P1-3）', async () => {
    mockRecordDirectTaskCompletion.mockResolvedValue('completed');
    const handler = getPostHandler('/tasks/:taskId/complete');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      headers: { 'x-caller-agent': 'virtual-learner-lab' },
      user: {
        userId: 'user-vl',
        projection: { grantSource: 'synthetic', capabilities: ['task:write'], virtualSessionId: 'vs-1' },
      },
      params: { taskId: 'task-vl' },
      body: { teachingSessionId: 'teaching-vl', teachingRevision: 12 },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockRecordDirectTaskCompletion).toHaveBeenCalledWith(
      'teaching-vl',
      'user-vl',
      'vl-blackbox',
      12
    );
    // #204：VL 直调路径在 endTeaching(end_only) 之后结算 → 声明会话已闭合：事件消费者据此按
    // sessionId 跳过重复刷新，completeTask 据此补做一次 eager 刷新（否则该投影键双刷 / 0 刷）。
    expect(mockLearningService.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-vl',
      userId: 'user-vl',
      sessionId: 'teaching-vl',
      sessionClosedBeforeCompletion: true,
    }));
  });

  it('#204：不带 teachingSessionId 的结算不声明「会话已闭合」，避免误抑制消费者刷新', async () => {
    const handler = getPostHandler('/tasks/:taskId/complete');
    const res = createResponse();

    await handler({
      headers: {},
      user: { userId: 'user-human' },
      params: { taskId: 'task-human' },
      body: { actualMinutes: 30 },
    }, res, jest.fn());

    const payload = mockLearningService.completeTask.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('sessionClosedBeforeCompletion');
  });
});

describe('课堂契约门：任务结算与课堂 finalize 同源（2026-11-19）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLearningService.completeTask.mockResolvedValue({
      task: { id: 'task-1', status: 'completed', completedAt: null },
      alreadyCompleted: false,
    });
    mockGetTeachingSessionById.mockResolvedValue(null);
    mockFindLatestTutorSession.mockResolvedValue(null);
  });

  const contractSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'teaching-1',
    userId: 'user-human',
    taskId: 'task-human',
    mode: 'tutor',
    status: 'completed',
    teachingState: {
      sessionArtifacts: {
        lessonContract: {
          version: 1,
          coreKcs: [{ kcId: 'kc-1', name: '识别工具返回' }],
          minIndependentEvidence: 1,
          minTurns: 3,
          timeBudgetMin: 20,
          branchBudgets: { examplePerKc: 1, deeperTurns: 3, prerequisitePatches: 1, offTopicInClassTurns: 1 },
        },
        lessonReport: {
          met: false,
          reasons: ['独立证据不足：1/2（支线/提示证据不计入）'],
        },
      },
    },
    ...overrides,
  });

  const invoke = async (request: Record<string, unknown>) => {
    const handler = getPostHandler('/tasks/:taskId/complete');
    const res = createResponse();
    const next = jest.fn();
    await handler(request, res, next);
    return { res, next };
  };

  const baseRequest = () => ({
    headers: {},
    user: { userId: 'user-human' },
    params: { taskId: 'task-human' },
    body: { actualMinutes: 30 },
  });

  it('最近一节正课契约未达成 → 409 LESSON_CONTRACT_NOT_MET，且不进入结算', async () => {
    mockFindLatestTutorSession.mockResolvedValue(contractSession());
    const { res, next } = await invoke(baseRequest());

    expect(mockLearningService.completeTask).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({ code: 'LESSON_CONTRACT_NOT_MET', status: 409 }),
    });
  });

  it('契约已达成 → 正常结算', async () => {
    mockFindLatestTutorSession.mockResolvedValue(contractSession({
      teachingState: {
        sessionArtifacts: {
          lessonContract: { coreKcs: [{ kcId: 'kc-1', name: '识别工具返回' }] },
          lessonReport: { met: true, reasons: [] },
        },
      },
    }));
    const { res } = await invoke(baseRequest());

    expect(mockLearningService.completeTask).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('无课堂（纯路径任务）→ 不阻断', async () => {
    mockFindLatestTutorSession.mockResolvedValue(null);
    const { res } = await invoke(baseRequest());
    expect(mockLearningService.completeTask).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('带 teachingSessionId（blackbox 补记通道）→ 按该课堂判定，未达成同样 409', async () => {
    mockGetTeachingSessionById.mockResolvedValue(contractSession({
      id: 'teaching-vl',
      userId: 'user-vl',
      taskId: 'task-vl',
    }));
    const { res, next } = await invoke({
      headers: { 'x-caller-agent': 'virtual-learner-lab' },
      user: { userId: 'user-vl' },
      params: { taskId: 'task-vl' },
      body: { teachingSessionId: 'teaching-vl', teachingRevision: 12 },
    });
    expect(mockGetTeachingSessionById).toHaveBeenCalledWith('teaching-vl');
    expect(mockLearningService.completeTask).not.toHaveBeenCalled();
    expect(mockRecordDirectTaskCompletion).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('复习/延伸课不参与任务完成契约门（与 finalize 豁免同口径）', async () => {
    mockFindLatestTutorSession.mockResolvedValue(contractSession({ mode: 'review' }));
    const { res } = await invoke(baseRequest());
    expect(mockLearningService.completeTask).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('teachingSessionId 不属于该用户 → 不做归属外判定，交给结算侧鉴权', async () => {
    mockGetTeachingSessionById.mockResolvedValue(contractSession({ userId: 'someone-else' }));
    const { res } = await invoke({
      headers: {},
      user: { userId: 'user-human' },
      params: { taskId: 'task-human' },
      body: { teachingSessionId: 'teaching-1' },
    });
    expect(mockLearningService.completeTask).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});
