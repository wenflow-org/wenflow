/**
 * #250 路由透传：POST /replan（及 /regenerate 的 replan 分支）收到
 * 「没有可重设计阶段」时必须回 409 + code，而不是落 next(error) → 500 INTERNAL_ERROR。
 *
 * 这里用**真实**的 path-mutation-safety 判别器（不打桩），只桩掉服务层与 DB 查询，
 * 验证服务层抛出的具名错误被 sendPathMutationConflict 正确认出。
 */
const mockRequestPathReplan = jest.fn();
const mockFindUnique = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: (...args: unknown[]) => mockFindUnique(...args), findFirst: jest.fn() },
    goal_conversations: { findFirst: jest.fn() },
    path_generation_runs: { count: jest.fn() },
  },
}));

jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {
    requestPathReplan: (...args: unknown[]) => mockRequestPathReplan(...args),
    claimPathCoreGeneration: jest.fn(),
    markActiveGenerationFailed: jest.fn(),
    getPathGenerationRetry: jest.fn(),
    retryPathEnrichment: jest.fn(),
    createLearningPath: jest.fn(),
  },
}));

jest.mock('../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: { runGoalAsync: jest.fn(), runAsync: jest.fn(), runRebuildFromGoalAsync: jest.fn() },
}));

jest.mock('../../services/learning/learning-routes.repo', () => ({
  __esModule: true,
  findLearningPathWithMilestones: (...args: unknown[]) => mockFindUnique(...args),
  findOwnedLearningPathById: (...args: unknown[]) => mockFindUnique(...args),
  findLearningPathById: (...args: unknown[]) => mockFindUnique(...args),
  findLearningPathOwner: async (...args: unknown[]) => {
    const path = await mockFindUnique(...args);
    return path ? { userId: path.userId } : null;
  },
  findGoalConversationForPathSummary: jest.fn(async () => null),
  listMilestonesWithTaskIds: async () => [],
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn((input: unknown) => input),
}));

import router from '../learning';
import { PathReplanNoTargetStageError } from '../../services/learning/replan/path-replan.service';

interface RouterLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => unknown }>;
  };
}

function getRouteHandler(method: 'post', path: string) {
  const layer = (router as unknown as { stack: RouterLayer[] }).stack.find(
    (item) => item.route?.path === path && item.route?.methods?.[method]
  );
  if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('POST /paths/:pathId/replan 的 409 透传（#250）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('服务层抛「没有可重设计阶段」→ 409 + PATH_REPLAN_NO_TARGET_STAGE（旧行为 500）', async () => {
    mockRequestPathReplan.mockRejectedValue(new PathReplanNoTargetStageError());
    const handler = getRouteHandler('post', '/paths/:pathId/replan');
    const res = createResponse();
    const next = jest.fn();

    await handler({ user: { userId: 'user-1' }, params: { pathId: 'lp-empty' }, body: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'PATH_REPLAN_NO_TARGET_STAGE',
        status: 409,
        message: expect.stringContaining('没有可重设计的阶段'),
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('防修过头：服务层正常返回时路由照常 200，不透出任何错误', async () => {
    mockRequestPathReplan.mockResolvedValue({ enabled: true, status: 'redesigned-stage' });
    const handler = getRouteHandler('post', '/paths/:pathId/replan');
    const res = createResponse();
    const next = jest.fn();

    await handler({ user: { userId: 'user-1' }, params: { pathId: 'lp-live' }, body: {} }, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ status: 'redesigned-stage' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
