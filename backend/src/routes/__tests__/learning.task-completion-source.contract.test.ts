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

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: mockLearningService,
}));
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({
  teachingSessionRepository: {
    recordDirectTaskCompletion: (...args: unknown[]) => mockRecordDirectTaskCompletion(...args),
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
  });
});
