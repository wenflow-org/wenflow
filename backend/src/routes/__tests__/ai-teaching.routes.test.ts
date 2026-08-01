const mockCoordinator = {
  processStudentMessage: jest.fn(),
  submitCheckpoint: jest.fn(),
  processPeerMessage: jest.fn(),
};

const mockSessionFinalizationService = {
  finalize: jest.fn(),
  getStatus: jest.fn(),
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
  isTeachingSessionConflictError: jest.fn(() => false),
}));
jest.mock('../../services/ai-teaching/SessionFinalizationService', () => ({
  sessionFinalizationService: mockSessionFinalizationService,
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

function getRouteHandler(path: string, method: 'get' | 'post' = 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
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
      body: { message: '我完成了', revision: 3 },
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

  it('稳定投影课堂消息公开扁平 DTO 并转发归属和 revision', async () => {
    mockCoordinator.processStudentMessage.mockResolvedValue({
      aiResponse: '我们继续练习泛型。',
      analysis: {
        cognitiveLevel: 'apply',
        levelScore: 4,
        understanding: 0.81,
        confusionPoints: ['条件类型'],
        engagement: 0.93,
        emotionalState: 'focused',
      },
      currentState: { lss: 82, ktl: 76, lf: 88, lsb: 79 },
      strategies: [{ type: 'worked-example', content: '从 T extends U 开始。' }],
      knowledgePoint: { id: 'kp-1', name: '条件类型' },
      knowledgePoints: [{ id: 'kp-1', name: '条件类型' }],
      isCompletion: true,
      shouldConfirmEnd: true,
      endReason: 'completion-candidate',
      recovered: true,
      autoEnded: true,
      wrapup: { summary: '完成条件类型练习' },
      advisory: { nextStep: '复习 infer' },
      peerTriggered: true,
      peerMessage: { content: '我也刚理解这一点。' },
      checkpoint: { id: 'checkpoint-1', question: '何时使用 infer？' },
      promptDebug: { promptId: 'prompt-1' },
      peerDebug: { traceId: 'peer-1' },
      revision: 8,
      internalOnly: { trace: 'must not be returned' },
    });
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '我明白了条件类型', revision: 7 },
    }, res);

    expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
    expect(mockCoordinator.processStudentMessage).toHaveBeenCalledWith(
      'session-1',
      '我明白了条件类型',
      { expectedRevision: 7 },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        aiResponse: '我们继续练习泛型。',
        analysis: {
          cognitiveLevel: 'apply',
          levelScore: 4,
          understanding: 0.81,
          confusionPoints: ['条件类型'],
          engagement: 0.93,
          emotionalState: 'focused',
        },
        state: { lss: 82, ktl: 76, lf: 88, lsb: 79 },
        strategies: [{ type: 'worked-example', content: '从 T extends U 开始。' }],
        knowledgePoint: { id: 'kp-1', name: '条件类型' },
        knowledgePoints: [{ id: 'kp-1', name: '条件类型' }],
        isCompletion: true,
        shouldConfirmEnd: true,
        endReason: 'completion-candidate',
        recovered: true,
        autoEnded: true,
        wrapup: { summary: '完成条件类型练习' },
        advisory: { nextStep: '复习 infer' },
        peerTriggered: true,
        peerMessage: { content: '我也刚理解这一点。' },
        checkpoint: { id: 'checkpoint-1', question: '何时使用 infer？' },
        promptDebug: { promptId: 'prompt-1' },
        peerDebug: { traceId: 'peer-1' },
        revision: 8,
      },
    });
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
      body: { selectedOptionIds: ['A'], revision: 4 },
    }, res);

    expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
    expect(mockCoordinator.submitCheckpoint).toHaveBeenCalledWith('session-1', 'checkpoint-1', {
      selectedOptionIds: ['A'],
      answerText: undefined,
    }, 4);
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

  it('拒绝缺少 revision 的课堂写入', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();
    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '继续' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
  });

  it('Finalization 正在执行时返回 202 和轮询信息', async () => {
    mockSessionFinalizationService.finalize.mockResolvedValue({
      operationId: 'finalize-1',
      status: 'processing',
      pollAfterMs: 1500,
      revision: 5,
    });
    const handler = getRouteHandler('/sessions/:sessionId/finalize');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { 'idempotency-key': 'finalize-1' },
      body: { action: 'end_only', revision: 5 },
    }, res);

    expect(mockSessionFinalizationService.finalize).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'end_only',
      operationId: 'finalize-1',
      revision: 5,
    }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ status: 'processing', pollAfterMs: 1500 })
    });
  });

  it('保留已完成 Finalization 服务结果作为 data', async () => {
    const result = {
      operationId: 'finalize-completed-1',
      status: 'completed',
      revision: 9,
      task: { id: 'task-1', status: 'completed' },
      wrapup: { summary: '本次学习已完成' },
    };
    mockSessionFinalizationService.finalize.mockResolvedValue(result);
    const handler = getRouteHandler('/sessions/:sessionId/finalize');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { 'idempotency-key': 'finalize-completed-1' },
      body: {
        action: 'complete_task',
        revision: 8,
        actualMinutes: 25,
        subjectiveDifficulty: 6,
        reason: 'task-completed',
      },
    }, res);

    expect(mockSessionFinalizationService.finalize).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'complete_task',
      operationId: 'finalize-completed-1',
      revision: 8,
      actualMinutes: 25,
      subjectiveDifficulty: 6,
      endReason: 'task-completed',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('Finalization 拒绝缺少 Idempotency-Key', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/finalize');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: {},
      body: { action: 'end_only', revision: 5 },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSessionFinalizationService.finalize).not.toHaveBeenCalled();
  });

  it('将学习伙伴消息映射为仅含 peerResponse 的公开 DTO', async () => {
    mockCoordinator.processPeerMessage.mockResolvedValue({
      peerResponse: '我会先把类型参数写出来。',
      debug: { traceId: 'internal-peer-trace' },
    });
    const handler = getRouteHandler('/sessions/:sessionId/peer/messages');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '条件类型该怎么开始？' },
    }, res);

    expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
    expect(mockCoordinator.processPeerMessage).toHaveBeenCalledWith('session-1', '条件类型该怎么开始？');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { peerResponse: '我会先把类型参数写出来。' },
    });
  });

  it('查询持久化 Finalization 状态', async () => {
    mockSessionFinalizationService.getStatus.mockResolvedValue({
      operationId: 'finalize-1',
      status: 'completed',
      revision: 6,
    });
    const handler = getRouteHandler('/sessions/:sessionId/finalization', 'get');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
    }, res);

    expect(mockSessionFinalizationService.getStatus).toHaveBeenCalledWith('session-1', 'user-1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { operationId: 'finalize-1', status: 'completed', revision: 6 }
    });
  });
});
