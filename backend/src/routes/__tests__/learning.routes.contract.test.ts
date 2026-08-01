const mockLearningService = {
  getLearningPath: jest.fn(),
};

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: mockLearningService,
}));
jest.mock('../../services/ai/ai.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../coordinators/path.coordinator', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn(),
}));
jest.mock('../../services/learning/path-mutation-safety', () => ({
  isPathMutationConflictError: jest.fn(() => false),
}));

import router from '../learning';

function getRouteHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.get);
  if (!layer) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('learning path public route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps public path fields while stripping generation internals from GET /paths/:pathId', async () => {
    mockLearningService.getLearningPath.mockResolvedValue({
      id: 'path-1',
      userId: 'user-1',
      title: 'TypeScript 进阶',
      name: '类型系统学习路径',
      summary: '掌握泛型与条件类型',
      description: '从泛型开始的 TypeScript 学习计划',
      subject: 'TypeScript',
      difficulty: 'intermediate',
      estimatedHours: 24,
      status: 'active',
      canStartLearning: true,
      learningBlockedReason: null,
      milestones: [{ id: 'milestone-1', title: '泛型', stageNumber: 1 }],
      generationStatus: {
        core: { status: 'ready', progress: 100 },
        stageDesign: { status: 'completed', count: 3 },
        updatedAt: '2026-07-25T10:00:00.000Z',
        error: { message: 'private error object' },
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'private error message',
        lastError: { detail: 'private last error' },
        orchestrationTrace: { runId: 'internal-run-detail' },
      },
      aiPromptTemplate: '{"private":true}',
      processDetail: { traceId: 'process-1' },
      activeGenerationRun: { id: 'run-1' },
      activeGenerationRunId: 'run-1',
      generationRun: { id: 'run-0' },
    });
    const handler = getRouteHandler('/paths/:pathId');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'path-1' },
    }, res, next);

    expect(mockLearningService.getLearningPath).toHaveBeenCalledWith('path-1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: 'path-1',
        userId: 'user-1',
        title: 'TypeScript 进阶',
        name: '类型系统学习路径',
        summary: '掌握泛型与条件类型',
        description: '从泛型开始的 TypeScript 学习计划',
        subject: 'TypeScript',
        difficulty: 'intermediate',
        estimatedHours: 24,
        status: 'active',
        canStartLearning: true,
        learningBlockedReason: null,
        milestones: [{ id: 'milestone-1', title: '泛型', stageNumber: 1 }],
        generationStatus: {
          core: { status: 'ready', progress: 100 },
          stageDesign: { status: 'completed', count: 3 },
          updatedAt: '2026-07-25T10:00:00.000Z',
        },
      },
    });
    expect(next).not.toHaveBeenCalled();
  });
});
