const mockCoordinator = {
  processStudentMessage: jest.fn(),
  submitCheckpoint: jest.fn(),
};

const mockTeachingSessionRepository = {
  assertOwnership: jest.fn(),
};

jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: mockCoordinator,
}));
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({
  teachingSessionRepository: mockTeachingSessionRepository,
}));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../services/learning/learning-state.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/ai/ai.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

import router from '../ai-teaching.routes';

function getRouteHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post);
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

describe('ai-teaching routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('透传消息结束确认与恢复状态', async () => {
    mockCoordinator.processStudentMessage.mockResolvedValue({
      aiResponse: '继续',
      analysis: {
        cognitiveLevel: 'understand',
        levelScore: 3,
        understanding: 0.8,
        confusionPoints: [],
        engagement: 0.9,
        emotionalState: 'positive',
      },
      currentState: { lss: 1, ktl: 2, lf: 3, lsb: 4 },
      strategies: [],
      knowledgePoint: null,
      knowledgePoints: [],
      isCompletion: true,
      shouldConfirmEnd: true,
      endReason: 'completion-candidate',
      recovered: true,
      autoEnded: false,
      peerTriggered: false,
      checkpoint: null,
    });

    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();
    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '我完成了' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        shouldConfirmEnd: true,
        endReason: 'completion-candidate',
        recovered: true,
        checkpoint: null,
      }),
    }));
  });

  it('校验归属并提交理解检查', async () => {
    mockCoordinator.submitCheckpoint.mockResolvedValue({
      passed: true,
      feedback: '回答正确',
      nextAction: 'continue',
    });

    const handler = getRouteHandler('/sessions/:sessionId/checkpoints/:checkpointId/submit');
    const res = createResponse();
    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1', checkpointId: 'checkpoint-1' },
      body: { selectedOptionIds: ['A'] },
    }, res);

    expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
    expect(mockCoordinator.submitCheckpoint).toHaveBeenCalledWith('session-1', 'checkpoint-1', {
      selectedOptionIds: ['A'],
      answerText: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { passed: true, feedback: '回答正确', nextAction: 'continue' },
    });
  });

  it('拒绝空的理解检查答案', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/checkpoints/:checkpointId/submit');
    const res = createResponse();
    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1', checkpointId: 'checkpoint-1' },
      body: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCoordinator.submitCheckpoint).not.toHaveBeenCalled();
  });
});
