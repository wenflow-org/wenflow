const mockCoordinator = {
  processStudentMessage: jest.fn(),
  submitCheckpoint: jest.fn(),
  processPeerMessage: jest.fn(),
  startSession: jest.fn(),
};

const mockSessionFinalizationService = {
  finalize: jest.fn(),
  getStatus: jest.fn(),
};

const mockTeachingSessionRepository = {
  assertOwnership: jest.fn(),
  findLatestSession: jest.fn(),
  findCompletionPendingSession: jest.fn(),
};

const mockLearningService = {
  assertTaskReadyForLearning: jest.fn(),
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
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: mockLearningService }));
jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

import router from '../ai-teaching.routes';
import { requestContextStorage, runWithContext } from '../../gateway/api-gateway/context';

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
      currentState: { lss: 8.2, ktl: 7.6, lf: 8.8, lsb: 7.9 },
      strategies: [{ type: 'worked-example', content: '从 T extends U 开始。' }],
      knowledgePoint: { id: 'kp-1', name: '条件类型' },
      knowledgePoints: [{ id: 'kp-1', name: '条件类型' }],
      isCompletion: true,
      shouldConfirmEnd: true,
      endReason: 'completion-candidate',
      recovered: true,
      advisory: { nextStep: '复习 infer' },
      peerTriggered: true,
      peerMessage: { content: '我也刚理解这一点。' },
      peerStrategy: 'feynman',
      peerFollowUpQuestions: ['你能用自己的话讲一遍吗？'],
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
        advisory: { nextStep: '复习 infer' },
        peerTriggered: true,
        peerMessage: { content: '我也刚理解这一点。' },
        peerStrategy: 'feynman',
        peerFollowUpQuestions: ['你能用自己的话讲一遍吗？'],
        checkpoint: { id: 'checkpoint-1', question: '何时使用 infer？' },
        // 教学配图（owner 口径：图片是一种特殊的文字）——字段恒在，本轮无图则为空数组
        images: [],
        // 教师补充材料卡片（批次 E）——字段恒在，本轮无补充则为 null
        supplementaryMaterial: null,
        // 提示词调试信封默认不下发（见 promptDebugEnabled）
        promptDebug: null,
        peerDebug: null,
        revision: 8,
      },
    });
  });

  it('promptDebug/peerDebug 默认不下发；PROMPT_DEBUG_ENVELOPE=1 时才带回（18 号报告衍生观察项）', async () => {
    mockCoordinator.processStudentMessage.mockResolvedValue({
      aiResponse: 'x',
      analysis: { cognitiveLevel: 'apply', levelScore: 4, understanding: 0.5, confusionPoints: [], engagement: 0.5, emotionalState: 'focused' },
      currentState: { lss: 5, ktl: 5, lf: 5, lsb: 0 },
      strategies: [], knowledgePoint: null, knowledgePoints: [],
      isCompletion: false, shouldConfirmEnd: false, endReason: null, recovered: false,
      advisory: null, peerTriggered: false, peerMessage: null, peerStrategy: null, peerFollowUpQuestions: [],
      checkpoint: null,
      promptDebug: { promptId: 'p1', systemPrompt: '完整提示词' },
      peerDebug: { traceId: 't1' },
      revision: 1,
    });
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const req = () => ({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: { message: 'x', revision: 0 } });

    const resDefault = createResponse();
    await handler(req(), resDefault);
    expect(resDefault.json.mock.calls[0][0].data.promptDebug).toBeNull();
    expect(resDefault.json.mock.calls[0][0].data.peerDebug).toBeNull();

    process.env.PROMPT_DEBUG_ENVELOPE = '1';
    try {
      const resDebug = createResponse();
      await handler(req(), resDebug);
      expect(resDebug.json.mock.calls[0][0].data.promptDebug).toEqual({ promptId: 'p1', systemPrompt: '完整提示词' });
    } finally {
      delete process.env.PROMPT_DEBUG_ENVELOPE;
    }
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

  it('「跳过检查点」放行并把 skip 透传给协调器（此前必然 400）', async () => {
    mockCoordinator.submitCheckpoint.mockResolvedValue({
      passed: false,
      feedback: '已跳过这个检查点，我们继续。',
      nextAction: 'continue',
    });

    const handler = getRouteHandler('/sessions/:sessionId/checkpoints/:checkpointId/submit');
    const res = createResponse();
    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1', checkpointId: 'checkpoint-1' },
      body: { skip: true, revision: 4 },
    }, res);

    expect(mockCoordinator.submitCheckpoint).toHaveBeenCalledWith('session-1', 'checkpoint-1', {
      selectedOptionIds: undefined,
      answerText: undefined,
      skip: true,
    }, 4);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { passed: false, feedback: '已跳过这个检查点，我们继续。', nextAction: 'continue' },
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

  it('SSE 流式：Accept text/event-stream 时输出 final/done 事件并关闭连接', async () => {
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
      isCompletion: false,
      shouldConfirmEnd: false,
      endReason: null,
      recovered: false,
      autoEnded: false,
      peerTriggered: false,
      checkpoint: null,
      revision: 4,
    });

    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const writes: string[] = [];
    const res: any = {
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => { writes.push(chunk); return true; }),
      end: jest.fn(),
      destroyed: false,
      writableEnded: false,
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { accept: 'text/event-stream' },
      body: { message: '我完成了', revision: 3 },
    }, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(mockCoordinator.processStudentMessage).toHaveBeenCalledWith(
      'session-1',
      '我完成了',
      { expectedRevision: 3 },
    );
    const joined = writes.join('');
    expect(joined).toContain('event: final\ndata: {"aiResponse":"继续",');
    expect(joined).toContain('event: done\ndata: {}');
    expect(res.end).toHaveBeenCalled();
  });

  it('SSE 流式：业务失败时以带内 error 事件返回并关闭连接', async () => {
    mockCoordinator.processStudentMessage.mockRejectedValue(
      Object.assign(new Error('无法处理'), { code: 'TEACHING_SESSION_STATE_CHANGED' })
    );

    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const writes: string[] = [];
    const res: any = {
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => { writes.push(chunk); return true; }),
      end: jest.fn(),
      destroyed: false,
      writableEnded: false,
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { accept: 'text/event-stream' },
      body: { message: '继续', revision: 3 },
    }, res);

    const joined = writes.join('');
    expect(joined).toContain('event: error\n');
    expect(joined).toContain('TEACHING_SESSION_STATE_CHANGED');
    expect(res.end).toHaveBeenCalled();
  });

  it('SSE 流式：注入业务 sessionId 到请求上下文（执行日志/瀑布归组链路）', async () => {
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
      isCompletion: false,
      shouldConfirmEnd: false,
      endReason: null,
      recovered: false,
      autoEnded: false,
      peerTriggered: false,
      checkpoint: null,
      revision: 4,
    });

    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res: any = {
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(() => true),
      end: jest.fn(),
      destroyed: false,
      writableEnded: false,
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    let observed: any = null;
    await runWithContext({ userId: 'user-1' }, async () => {
      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'sess-ctx-1' },
        headers: { accept: 'text/event-stream' },
        body: { message: '继续', revision: 1 },
      }, res);
      observed = requestContextStorage.getStore();
    });

    expect(observed?.sessionId).toBe('sess-ctx-1');
    expect(observed?.sourceEntry).toBe('platform');
    expect(observed?.streamRequest?.enabled).toBe(true);
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
      // 端到端断言（对应「新会话不先关课，直接 complete_task」）：结算结果为任务已完成
      taskCompletion: { status: 'completed', alreadyCompleted: false },
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
    expect((res.json as jest.Mock).mock.calls[0][0].data.taskCompletion)
      .toEqual({ status: 'completed', alreadyCompleted: false });
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

  it('将学习伙伴消息映射为含 peerResponse/peerStrategy/followUpQuestions 的公开 DTO', async () => {
    mockCoordinator.processPeerMessage.mockResolvedValue({
      peerResponse: '我会先把类型参数写出来。',
      strategy: 'feynman',
      followUpQuestions: ['如果类型参数不写，会发生什么？'],
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
      data: {
        peerResponse: '我会先把类型参数写出来。',
        peerStrategy: 'feynman',
        peerFollowUpQuestions: ['如果类型参数不写，会发生什么？'],
      },
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

  it('已完成任务直接拒绝开新课：返回 mode=completed 且不调用 startSession', async () => {
    mockLearningService.assertTaskReadyForLearning.mockRejectedValue(
      Object.assign(new Error('该任务已完成'), { code: 'TASK_ALREADY_COMPLETED', status: 409 })
    );
    mockTeachingSessionRepository.findLatestSession.mockResolvedValue({
      id: 'session-done',
      subject: '数学',
      topic: '分数',
      startTime: '2026-09-12T00:00:00.000Z',
      messages: [{ content: '欢迎' }],
      revision: 7
    });
    const handler = getRouteHandler('/tasks/:taskId/session');
    const res = createResponse();

    await handler({ user: { userId: 'user-1' }, params: { taskId: 'task-1' }, headers: {}, body: {} }, res);

    expect(mockCoordinator.startSession).not.toHaveBeenCalled();
    expect(mockTeachingSessionRepository.findLatestSession).toHaveBeenCalledWith('user-1', 'task-1', 'completed');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sessionId: 'session-done', mode: 'completed', revision: 7 })
    }));
  });

  it('任务可学时正常开会话（不触发已完成拒绝）', async () => {
    mockLearningService.assertTaskReadyForLearning.mockResolvedValue(undefined);
    mockTeachingSessionRepository.findCompletionPendingSession.mockResolvedValue(null);
    mockCoordinator.startSession.mockResolvedValue({
      sessionId: 'session-new',
      subject: '数学',
      topic: '分数',
      startTime: '2026-09-12T00:00:00.000Z',
      welcomeMessage: '你好',
      mode: 'new',
      revision: 1,
      knowledgePoints: [],
      scene: null
    });
    const handler = getRouteHandler('/tasks/:taskId/session');
    const res = createResponse();

    await handler({ user: { userId: 'user-1' }, params: { taskId: 'task-1' }, headers: {}, body: {} }, res);

    expect(mockCoordinator.startSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-1' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sessionId: 'session-new', mode: 'new' })
    }));
  });
});
