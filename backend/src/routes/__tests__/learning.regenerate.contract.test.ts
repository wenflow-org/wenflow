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

  it('有已完成任务 + fromStageNumber → 转调 requestPathReplan 多阶段重排', async () => {
    mockFindUnique.mockResolvedValue(basePath({
      milestones: [
        {
          id: 'm-1',
          stageNumber: 1,
          status: 'completed',
          subtasks: [{ id: 't-1', status: 'completed' }],
        },
        {
          id: 'm-2',
          stageNumber: 2,
          status: 'active',
          subtasks: [{ id: 't-2', status: 'todo' }],
        },
        {
          id: 'm-3',
          stageNumber: 3,
          status: 'active',
          subtasks: [{ id: 't-3', status: 'todo' }],
        },
      ],
    }));
    mockRequestPathReplan.mockResolvedValue({
      enabled: true,
      status: 'redesigned-stages',
      result: { redesignedStageNumbers: [2, 3] },
    });

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '从阶段 2 起，后面都侧重实操', fromStageNumber: 2 } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRequestPathReplan).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'overwrite',
      reason: '从阶段 2 起，后面都侧重实操',
      fromStageNumber: 2,
      requireConfirmation: false,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: '已按你的说明从该阶段起调整剩余部分',
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

  it('有已完成任务 + mode=rebuild-all → 显式整条重建（runAsync + forceReplace，不转 replan）', async () => {
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
    mockClaimPathCoreGeneration.mockResolvedValue('run-3');
    mockRunAsync.mockImplementation(() => {});

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '之前选错了方向，想整条重来', mode: 'rebuild-all' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    // 有进度 + rebuild-all → 整建优先，不转 replan
    expect(mockRequestPathReplan).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('path-1', null, { allowCompleted: true });
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const runInput = mockRunAsync.mock.calls[0][0];
    // forceReplace 放行标记透传（learning.service 侧据此允许 replace-path 覆盖已完成任务）
    expect(runInput.userProfile.replan).toEqual(expect.objectContaining({
      mode: 'overwrite',
      forceReplace: true,
      triggerSource: 'api',
      sourcePathId: 'path-1',
    }));
    // 补充说明拼入描述
    expect(runInput.description).toContain('整条重建');
    expect(runInput.description).toContain('之前选错了方向，想整条重来');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ runId: 'run-3', mode: 'rebuild-all' }),
    }));
  });

  it('rebuild-all 基底用原始 rawGoal，不随 path.description 累积污染', async () => {
    // path.description 已被历次重建污染（含前次「（整条重建）…」嵌套）
    mockFindUnique.mockResolvedValue(basePath({
      description: '（整条重建）（整条重建）原始目标。用户补充说明：旧说明。用户补充说明：更旧说明',
    }));
    mockClaimPathCoreGeneration.mockResolvedValue('run-4');
    mockRunAsync.mockImplementation(() => {});

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { adjustments: '新说明', mode: 'rebuild-all' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const runInput = mockRunAsync.mock.calls[0][0];
    // 基底是 aiPromptTemplate 里的原始 rawGoal（学会 TypeScript），不含污染
    expect(runInput.description).toContain('学会 TypeScript');
    expect(runInput.description).not.toContain('旧说明');
    expect(runInput.description).toContain('新说明');
    // 整条重建前缀只出现一次
    expect(runInput.description.match(/整条重建/g)?.length ?? 0).toBe(1);
  });

  it('有 in_progress 任务 + mode=rebuild-all → 仍拦截（进行中任务需先结束）', async () => {
    mockFindUnique.mockResolvedValue(basePath({
      milestones: [
        {
          id: 'm-1',
          stageNumber: 1,
          status: 'active',
          subtasks: [
            { id: 't-1', status: 'in_progress' },
          ],
        },
      ],
    }));
    mockClaimPathCoreGeneration.mockImplementation(() => {
      const err: any = new Error('学习路径已有学习进度，不能覆盖重新生成');
      err.status = 409;
      err.code = 'PATH_MUTATION_HAS_LEARNING_PROGRESS';
      return Promise.reject(err);
    });
    // sendPathMutationConflict 依赖 isPathMutationConflictError mock 返回 true 以转发 409
    (jest.requireMock('../../services/learning/path-mutation-safety') as any).isPathMutationConflictError
      .mockReturnValueOnce(true);

    const handler = getPostHandler('/paths/:pathId/regenerate');
    const req = createRequest({ body: { mode: 'rebuild-all' } });
    const res = createResponse();

    await handler(req, res, jest.fn());

    // 整建遇到进行中任务：不静默放行 —— 前端应提示先结束当前任务
    expect(res.status).toHaveBeenCalledWith(409);
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
