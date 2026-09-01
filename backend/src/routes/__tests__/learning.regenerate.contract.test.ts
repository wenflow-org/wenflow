/**
 * POST /paths/:pathId/regenerate —— 补充说明重新生成的契约测试
 *
 * 覆盖：
 * 1. 无学习进度（全 todo）→ 整路径重建，adjustments 透传给 buildStoredGoalPathRequest → runGoalAsync
 * 2. 有已完成任务（completed，无 in_progress）→ 转调 requestPathReplan（overwrite，reason=adjustments）
 * 3. 有 in_progress 任务 → 转调 requestPathReplan（replan-stage 语义，保留已完成）
 */
const mockFindUnique = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockRequestPathReplan = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockRunAsync = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {
    claimPathCoreGeneration: (...args: unknown[]) => mockClaimPathCoreGeneration(...args),
    requestPathReplan: (...args: unknown[]) => mockRequestPathReplan(...args),
    markActiveGenerationFailed: (...args: unknown[]) => mockMarkActiveGenerationFailed(...args),
  },
}));

jest.mock('../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: {
    runGoalAsync: (...args: unknown[]) => mockRunGoalAsync(...args),
    runAsync: (...args: unknown[]) => mockRunAsync(...args),
  },
}));

jest.mock('../../services/ai/ai.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn(),
}));
jest.mock('../../services/learning/path-mutation-safety', () => ({
  isPathMutationConflictError: jest.fn(() => false),
}));

import router from '../learning';

function getPostHandler(path: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.post
  );
  if (!layer) throw new Error(`POST route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(overrides: Record<string, any> = {}) {
  return {
    user: { userId: 'user-1' },
    params: { pathId: 'path-1' },
    body: {},
    ...overrides,
  };
}

function basePath(overrides: Record<string, any> = {}) {
  return {
    id: 'path-1',
    userId: 'user-1',
    title: 'TypeScript 学习',
    name: 'TypeScript 学习路径',
    description: 'TypeScript 学习',
    subject: 'TypeScript',
    status: 'active',
    activeGenerationRunId: null,
    aiPromptTemplate: JSON.stringify({
      goalFinalPayload: {
        rawGoal: '学会 TypeScript',
        sourceConversationId: 'conv-1',
        visibleSummary: { realProblem: '写前端越来越吃力' },
        conversationHistory: [],
      },
    }),
    milestones: [],
    ...overrides,
  };
}

describe('POST /paths/:pathId/regenerate（补充说明重新生成）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('无学习进度 + 补充说明 → 整路径重建，adjustments 透传 runGoalAsync', async () => {
    mockFindUnique.mockResolvedValue(basePath());
    mockClaimPathCoreGeneration.mockResolvedValue('run-1');
    mockRunGoalAsync.mockImplementation(() => {});

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '第二阶段太难，放慢节奏' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(mockFindUnique).toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('path-1', null);
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    // adjustments 应透传进 goal 请求（runGoalAsync 的第一个参数）
    const goalRequest = mockRunGoalAsync.mock.calls[0][0];
    expect(goalRequest.adjustments).toBe('第二阶段太难，放慢节奏');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ runId: 'run-1', adjustments: '第二阶段太难，放慢节奏' }),
    }));
    // 无进度不应走 replan 分支
    expect(mockRequestPathReplan).not.toHaveBeenCalled();
  });

  it('有已完成任务（无 in_progress）→ 转调 requestPathReplan（overwrite，reason=补充说明）', async () => {
    mockFindUnique.mockResolvedValue(basePath({
      milestones: [
        {
          id: 'm-1',
          stageNumber: 1,
          status: 'active',
          subtasks: [
            { id: 't-1', status: 'completed' },
            { id: 't-2', status: 'todo' },
          ],
        },
      ],
    }));
    mockRequestPathReplan.mockResolvedValue({
      enabled: true,
      status: 'redesigned-stage',
      result: { redesignedStageNumber: 1, preservedCompletedTaskCount: 1 },
    });

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '第三阶段太难' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    // 有进度 → 不重建，转 replan
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRequestPathReplan).toHaveBeenCalledWith(expect.objectContaining({
      pathId: 'path-1',
      userId: 'user-1',
      mode: 'overwrite',
      reason: '第三阶段太难',
      requireConfirmation: false,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: '已按你的补充说明调整后续阶段',
    }));
  });

  it('有 in_progress 任务 → 转调 requestPathReplan（保留已完成，重设计后续）', async () => {
    mockFindUnique.mockResolvedValue(basePath({
      milestones: [
        {
          id: 'm-1',
          stageNumber: 1,
          status: 'active',
          subtasks: [
            { id: 't-1', status: 'completed' },
            { id: 't-2', status: 'in_progress' },
          ],
        },
      ],
    }));
    mockRequestPathReplan.mockResolvedValue({ enabled: true, status: 'redesigned-stage' });

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '整体节奏太快' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRequestPathReplan).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'overwrite',
      reason: '整体节奏太快',
    }));
  });

  it('无进度且无 adjustments → 整路径重建（不传 adjustments）', async () => {
    mockFindUnique.mockResolvedValue(basePath());
    mockClaimPathCoreGeneration.mockResolvedValue('run-2');
    mockRunGoalAsync.mockImplementation(() => {});

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: {} });
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    const goalRequest = mockRunGoalAsync.mock.calls[0][0];
    expect(goalRequest.adjustments).toBeNull();
    expect(mockRequestPathReplan).not.toHaveBeenCalled();
  });

  it('路径不存在 → 404', async () => {
    mockFindUnique.mockResolvedValue(null);

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest();
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
