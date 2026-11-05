const mockCoordinator = {
  processStudentMessage: jest.fn(),
  submitCheckpoint: jest.fn(),
  processPeerMessage: jest.fn(),
  startSession: jest.fn(),
  // GET /sessions/active 的读数来源（2026-11-03 起要带 lastActiveAt / activity 分档）
  getSessionHistory: jest.fn(),
};

const mockSessionFinalizationService = {
  finalize: jest.fn(),
  getStatus: jest.fn(),
};

const mockTeachingSessionRepository = {
  assertOwnership: jest.fn(),
  findLatestSession: jest.fn(),
  // #124：延伸课准入查「本课是否已有完结常规课堂」+ 完成态重定向排除延伸课
  findLatestCompletedLessonSession: jest.fn(),
  countCompletedLessonSessions: jest.fn(),
  findCompletionPendingSession: jest.fn(),
  // 路由 2026-10-02 起在开课前先做「完课死锁自愈」探测（findStuckFinalizingSession）；
  // 默认 null = 无卡住会话，测试沿用正常开课路径。
  findStuckFinalizingSession: jest.fn(),
  // #35 调整建议处置埋点（保留/稍后/预览）
  recordAdvisoryResponse: jest.fn(),
};

const mockLearningService = {
  assertTaskReadyForLearning: jest.fn(),
};

const mockWrapupRegen = {
  startWrapupRegeneration: jest.fn(),
};

const mockReserveTeachingOperation = jest.fn();
const mockListSessionEvents = jest.fn();

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
jest.mock('../../services/ai-teaching/teaching-wrapup-regen', () => ({
  __esModule: true,
  startWrapupRegeneration: mockWrapupRegen.startWrapupRegeneration,
}));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../services/learning/learning-state.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: mockLearningService }));
jest.mock('../../services/ai-teaching/TeachingMessageIdempotencyService', () => ({
  reserveTeachingOperation: (...args: unknown[]) => mockReserveTeachingOperation(...args),
  completeTeachingOperation: jest.fn(),
  failTeachingOperation: jest.fn(),
  teachingOperationRequestHash: jest.fn(() => 'test-request-hash'),
}));
jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/ai-teaching/session-events.service', () => ({
  listSessionEvents: (...args: unknown[]) => mockListSessionEvents(...args),
  recordSessionEvent: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

import router from '../ai-teaching.routes';
import { requestContextStorage, runWithContext } from '../../gateway/api-gateway/context';

function getRouteHandler(path: string, method: 'get' | 'post' = 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${path}`);
  const handle = layer.route.stack[layer.route.stack.length - 1].handle;
  // 2026-10-20 起 /messages、/continue、checkpoint 提交要求 Idempotency-Key：
  // 测试统一补默认值（个案可覆盖），断言仍按原 req 业务字段。
  return (req: any, res: any, next?: any) => {
    const headers = { ...(req?.headers || {}) };
    // 缺 key 的 400 用例只在 finalize 上验证；其余写路由统一补默认 key。
    if (!headers['idempotency-key'] && path !== '/sessions/:sessionId/finalize') {
      headers['idempotency-key'] = 'test-idem-key';
    }
    return handle({ ...req, headers }, res, next);
  };
}

function createResponse() {
  const res: any = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    end: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('ai-teaching routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReserveTeachingOperation.mockResolvedValue({ kind: 'reserved' });
  });

  it('同 key 已完成 → 重放结果，不再跑模型（消息写入幂等）', async () => {
    mockReserveTeachingOperation.mockResolvedValue({
      kind: 'replay',
      result: { aiResponse: '已提交过的那一轮', revision: 9 },
      revision: 9,
    });
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '再发一次', revision: 8 },
      headers: { 'idempotency-key': 'same-key' },
    }, res);

    expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    // 重放载荷经一次对外白名单投影（旧账本行缺 analysis 时按 null/[] 补齐）
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ aiResponse: '已提交过的那一轮', revision: 9 }),
    });
  });

  it('流式请求命中已完成 key → 只重放 final/done，不再跑模型', async () => {
    mockReserveTeachingOperation.mockResolvedValue({
      kind: 'replay',
      result: { aiResponse: '流式重放内容', revision: 9 },
      revision: 9,
    });
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const writes: string[] = [];
    const res: any = {
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => { writes.push(String(chunk)); return true; }),
      end: jest.fn(),
      destroyed: false,
      writableEnded: false,
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '再发一次', revision: 8 },
      headers: { accept: 'text/event-stream', 'idempotency-key': 'stream-key' },
    }, res);

    expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
    const payload = writes.join('');
    expect(payload).toContain('event: final');
    expect(payload).toContain('流式重放内容');
    expect(payload).toContain('event: done');
    expect(res.end).toHaveBeenCalled();
  });

  it('同 key 仍在途 → 409 TEACHING_MESSAGE_IN_FLIGHT，不再跑模型', async () => {
    mockReserveTeachingOperation.mockResolvedValue({ kind: 'in_flight', startedAt: new Date('2026-10-20T01:02:03.000Z') });
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      body: { message: '重复点击', revision: 8 },
      headers: { 'idempotency-key': 'busy-key' },
    }, res);

    expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'TEACHING_MESSAGE_IN_FLIGHT', startedAt: '2026-10-20T01:02:03.000Z' }),
    }));
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
      { expectedRevision: 7, interactionMeta: undefined, idempotencyKey: 'test-idem-key' },
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
          // 软通道有困惑点、但台账里没有原话证据 → 学生可见 chip 不显示（2026-11-01 硬口径）
          confusionEvidenced: false,
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
        // 位置线图（Scope B）——字段恒在，本轮无图则为空数组
        figures: [],
        // 课堂结构图（2026-09-27 双通道重构）——字段恒在，本轮无图则为空数组
        diagrams: [],
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
    }, 4, 'test-idem-key');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { passed: true, feedback: '回答正确' },
    });
  });

  it('「跳过检查点」放行并把 skip 透传给协调器（此前必然 400）', async () => {
    mockCoordinator.submitCheckpoint.mockResolvedValue({
      passed: false,
      feedback: '已跳过这个检查点，我们继续。',
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
    }, 4, 'test-idem-key');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { passed: false, feedback: '已跳过这个检查点，我们继续。' },
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

  it('#209 真值但非字符串的 message → 400 校验错误（此前穿透成 500）', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    for (const badMessage of [123, { a: 1 }, ['x'], true]) {
      const res = createResponse();
      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'session-1' },
        headers: { 'idempotency-key': 'bad-type-key' },
        body: { message: badMessage, revision: 1 },
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      });
      expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    }
  });

  it('#210 纯空白 message（空格/换行/制表）→ 400 校验错误，不落库不跑模型', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    for (const blankMessage of ['', '   ', '\n\n', '\t', ' \n\t ']) {
      const res = createResponse();
      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'session-1' },
        headers: { 'idempotency-key': 'blank-key' },
        body: { message: blankMessage, revision: 1 },
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', message: '缺少消息内容' }),
      });
      // 关键：空白输入必须在受理、落库、付费模型调用之前被拒
      expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    }
  });

  it('#224 恰好 800 字符（与前端 maxlength 同口径）→ 通过校验并受理', async () => {
    mockCoordinator.processStudentMessage.mockResolvedValue({
      aiResponse: '收到',
      analysis: {
        cognitiveLevel: 'understand',
        levelScore: 3,
        understanding: 0.5,
        confusionPoints: [],
        engagement: 0.5,
        emotionalState: 'neutral',
      },
      currentState: { lss: 1, ktl: 1, lf: 1, lsb: 1 },
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
    });
    const boundaryMessage = 'A'.repeat(800);
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { 'idempotency-key': 'boundary-key' },
      body: { message: boundaryMessage, revision: 1 },
    }, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(mockCoordinator.processStudentMessage).toHaveBeenCalledWith(
      'session-1',
      boundaryMessage,
      expect.objectContaining({ expectedRevision: 1 }),
    );
  });

  it('#224 超过 800 字符 → 400 校验错误，不落库不跑模型', async () => {
    const handler = getRouteHandler('/sessions/:sessionId/messages');
    for (const longMessage of ['A'.repeat(801), 'A'.repeat(1_000_000)]) {
      const res = createResponse();
      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'session-1' },
        headers: { 'idempotency-key': 'too-long-key' },
        body: { message: longMessage, revision: 1 },
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: '消息内容不能超过 800 字符',
        }),
      });
      // 关键：超长输入必须在幂等受理（落库）、付费模型调用之前被拒
      expect(mockReserveTeachingOperation).not.toHaveBeenCalled();
      expect(mockCoordinator.processStudentMessage).not.toHaveBeenCalled();
    }
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
      { expectedRevision: 3, interactionMeta: undefined, idempotencyKey: 'test-idem-key' },
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

  /**
   * 2026-11-03 真人走查：老师每轮都以提问收尾时，学员连答 4 轮才等到一次不问的回应——
   * 门禁卡给了「仍然完成结算」这颗明确确认 → 路由必须把这个意图透传给服务层（只放行末问）。
   */
  it('学员明确确认末问未答 → confirmOpenQuestion 透传给 Finalization 服务', async () => {
    mockSessionFinalizationService.finalize.mockResolvedValue({ status: 'completed', revision: 9 });
    const handler = getRouteHandler('/sessions/:sessionId/finalize');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { 'idempotency-key': 'finalize-confirm-open-1' },
      body: { action: 'complete_task', revision: 8, reason: 'manual-end', confirmOpenQuestion: true },
    }, res);

    expect(mockSessionFinalizationService.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ confirmOpenQuestion: true, action: 'complete_task' }),
    );
  });

  it('未确认时入参形状不变（不带 confirmOpenQuestion 字段）', async () => {
    mockSessionFinalizationService.finalize.mockResolvedValue({ status: 'completed', revision: 9 });
    const handler = getRouteHandler('/sessions/:sessionId/finalize');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { sessionId: 'session-1' },
      headers: { 'idempotency-key': 'finalize-plain-1' },
      body: { action: 'complete_task', revision: 8, reason: 'manual-end' },
    }, res);

    const payload = (mockSessionFinalizationService.finalize as jest.Mock).mock.calls.at(-1)[0];
    expect('confirmOpenQuestion' in payload).toBe(false);
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
    mockTeachingSessionRepository.findLatestCompletedLessonSession.mockResolvedValue({
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
    expect(mockTeachingSessionRepository.findLatestCompletedLessonSession).toHaveBeenCalledWith('user-1', 'task-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sessionId: 'session-done', mode: 'completed', revision: 7 })
    }));
  });

  it('延伸课（#124）：本课已有完结课堂 → mode=extension 开课，路径结业也放行', async () => {
    mockTeachingSessionRepository.countCompletedLessonSessions.mockResolvedValue(1);
    mockLearningService.assertTaskReadyForLearning.mockResolvedValue(undefined);
    mockCoordinator.startSession.mockResolvedValue({
      sessionId: 'session-ext',
      subject: '数学',
      topic: '分数',
      startTime: '2026-09-12T00:00:00.000Z',
      welcomeMessage: '继续深入',
      mode: 'new',
      revision: 1,
      knowledgePoints: [],
      scene: null
    });
    const handler = getRouteHandler('/tasks/:taskId/extension-session');
    const res = createResponse();

    await handler({ user: { userId: 'user-1' }, params: { taskId: 'task-1' }, body: {} }, res);

    expect(mockLearningService.assertTaskReadyForLearning).toHaveBeenCalledWith('task-1', 'user-1', { allowCompletedPath: true });
    expect(mockCoordinator.startSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-1', mode: 'extension' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sessionId: 'session-ext', mode: 'extension' })
    }));
  });

  it('延伸课（#124）：本课没有完结课堂 → 400 拒绝且不开课', async () => {
    mockTeachingSessionRepository.countCompletedLessonSessions.mockResolvedValue(0);
    const handler = getRouteHandler('/tasks/:taskId/extension-session');
    const res = createResponse();

    await handler({ user: { userId: 'user-1' }, params: { taskId: 'task-1' }, body: {} }, res);

    expect(mockCoordinator.startSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' })
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

  describe('调整建议处置埋点（#35：保留/稍后再看/预览/已采用）', () => {
    it('keep/later/preview/adopt 透传落库并回写 learnerResponse', async () => {
      mockTeachingSessionRepository.recordAdvisoryResponse.mockResolvedValue({
        status: 'ok',
        advisory: {
          shouldSuggest: true,
          recommendation: 'reinforce',
          learnerResponse: { action: 'keep', at: '2026-10-05T00:00:00.000Z' },
        },
      });
      const handler = getRouteHandler('/sessions/:sessionId/advisory-response');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: { action: 'keep' } }, res);

      expect(mockTeachingSessionRepository.recordAdvisoryResponse).toHaveBeenCalledWith('session-1', 'user-1', 'keep');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          sessionId: 'session-1',
          action: 'keep',
          advisory: expect.objectContaining({
            learnerResponse: expect.objectContaining({ action: 'keep' }),
          }),
        }),
      }));
    });

    it('adopt（真执行）也允许落库，供 P1-7 漏斗统计执行档', async () => {
      mockTeachingSessionRepository.recordAdvisoryResponse.mockResolvedValue({
        status: 'ok',
        advisory: {
          shouldSuggest: true,
          recommendation: 'reinforce',
          learnerResponse: { action: 'adopt', at: '2026-10-22T00:00:00.000Z' },
        },
      });
      const handler = getRouteHandler('/sessions/:sessionId/advisory-response');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: { action: 'adopt' } }, res);

      expect(mockTeachingSessionRepository.recordAdvisoryResponse).toHaveBeenCalledWith('session-1', 'user-1', 'adopt');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ action: 'adopt' }),
      }));
    });

    it('非法动作（如未经执行链的 confirm）→ 400 且不触达 repository', async () => {
      const handler = getRouteHandler('/sessions/:sessionId/advisory-response');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: { action: 'confirm' } }, res);

      expect(mockTeachingSessionRepository.recordAdvisoryResponse).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('无待处置建议的会话 → 409 ADVISORY_NOT_FOUND', async () => {
      mockTeachingSessionRepository.recordAdvisoryResponse.mockResolvedValue({ status: 'no_advisory' });
      const handler = getRouteHandler('/sessions/:sessionId/advisory-response');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: { action: 'later' } }, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('非本人会话 → 404', async () => {
      mockTeachingSessionRepository.recordAdvisoryResponse.mockResolvedValue({ status: 'not_found' });
      const handler = getRouteHandler('/sessions/:sessionId/advisory-response');
      const res = createResponse();

      await handler({ user: { userId: 'user-2' }, params: { sessionId: 'session-1' }, body: { action: 'preview' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('降级总结手动重生成（学习者侧 2026-10-12）', () => {
    it('校验归属并透传 started，操作者标记为 learner:<id>', async () => {
      mockWrapupRegen.startWrapupRegeneration.mockResolvedValue({ started: true });
      const handler = getRouteHandler('/sessions/:sessionId/wrapup/regenerate');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: {} }, res);

      expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
      expect(mockWrapupRegen.startWrapupRegeneration).toHaveBeenCalledWith('session-1', {
        adminId: null,
        adminName: 'learner:user-1',
      });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { started: true } });
    });

    it('守卫拒绝（非完结/未退化/冷却中）→ 409 与中文原因', async () => {
      mockWrapupRegen.startWrapupRegeneration.mockResolvedValue({ started: false, error: '仅完结会话可重生成（当前 active）' });
      const handler = getRouteHandler('/sessions/:sessionId/wrapup/regenerate');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: {} }, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: '仅完结会话可重生成（当前 active）' });
    });

    it('冷却中 skipped 不算错误，200 透传给前端展示', async () => {
      mockWrapupRegen.startWrapupRegeneration.mockResolvedValue({ started: false, skipped: '刚刚重试过，请稍候再试' });
      const handler = getRouteHandler('/sessions/:sessionId/wrapup/regenerate');
      const res = createResponse();

      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, body: {} }, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { started: false, skipped: '刚刚重试过，请稍候再试' } });
    });
  });

  describe('会话事件时间线（GET /sessions/:sessionId/events）', () => {
    it('校验归属、解析 payload、给出增量游标', async () => {
      mockListSessionEvents.mockResolvedValue([
        { id: 1, kind: 'session.initialized', actor: 'system', status: 'ok', revision: 1, payload: '{"openingMessages":1}', occurredAt: new Date('2026-10-21T01:00:00Z') },
        { id: 2, kind: 'turn.committed', actor: 'system', status: 'ok', revision: 2, payload: null, occurredAt: new Date('2026-10-21T01:01:00Z') },
      ]);
      const handler = getRouteHandler('/sessions/:sessionId/events', 'get');
      const res = createResponse();

      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'session-1' },
        query: { limit: '50' },
      }, res);

      expect(mockTeachingSessionRepository.assertOwnership).toHaveBeenCalledWith('session-1', 'user-1');
      expect(mockListSessionEvents).toHaveBeenCalledWith('session-1', { limit: 50, sinceId: undefined, kinds: undefined });
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.data.events[0]).toEqual(expect.objectContaining({ kind: 'session.initialized', payload: { openingMessages: 1 } }));
      expect(payload.data.nextSinceId).toBe(2);
    });

    it('支持 sinceId 与 kinds 过滤', async () => {
      mockListSessionEvents.mockResolvedValue([]);
      const handler = getRouteHandler('/sessions/:sessionId/events', 'get');
      const res = createResponse();

      await handler({
        user: { userId: 'user-1' },
        params: { sessionId: 'session-1' },
        query: { sinceId: '7', kinds: 'turn.committed,session.completed' },
      }, res);

      expect(mockListSessionEvents).toHaveBeenCalledWith('session-1', {
        limit: undefined,
        sinceId: 7,
        kinds: ['turn.committed', 'session.completed'],
      });
      expect(res.json.mock.calls[0][0].data.nextSinceId).toBeNull();
    });

    it('坏 payload 不拖垮整个响应（原样返回文本）', async () => {
      mockListSessionEvents.mockResolvedValue([
        { id: 3, kind: 'error', actor: null, status: 'failed', revision: null, payload: 'not-json{', occurredAt: new Date() },
      ]);
      const handler = getRouteHandler('/sessions/:sessionId/events', 'get');
      const res = createResponse();
      await handler({ user: { userId: 'user-1' }, params: { sessionId: 'session-1' }, query: {} }, res);
      expect(res.json.mock.calls[0][0].data.events[0].payload).toBe('not-json{');
    });
  });

  /**
   * 2026-11-03：通知面板把「可继续的课堂」拆成进行中 / 空闲中两档，
   * 依据是服务端给的 lastActiveAt（每会话最近一条消息时间）与 activity。
   * 分档阈值与断线恢复窗口同源（RECOVERY_WINDOW_MS = 48h），前端不自己造阈值。
   */
  describe('活跃会话读数（GET /sessions/active）', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

    it('带上 lastActiveAt，并按恢复窗口判出 activity 两档', async () => {
      mockCoordinator.getSessionHistory.mockResolvedValue([
        {
          id: 's_live', subject: '英语', topic: '时态', taskId: 't1', startTime: hoursAgo(1),
          endTime: null, duration: null, status: 'active', messageCount: 5, lastActiveAt: hoursAgo(0.2),
        },
        {
          id: 's_idle', subject: '心理学', topic: '流派', taskId: 't2', startTime: hoursAgo(200),
          endTime: null, duration: null, status: 'active', messageCount: 9, lastActiveAt: hoursAgo(199),
        },
        {
          // 2026-11-04：暂停（离开课堂即 paused）与超时待恢复（timeout）同样是可继续的课堂，
          // 不能被滤掉——通知面板「进行中 / 空闲中」两档靠这个端点出数。
          id: 's_paused', subject: '化学', topic: '元素周期', taskId: 't4', startTime: hoursAgo(3),
          endTime: null, duration: null, status: 'paused', messageCount: 6, lastActiveAt: hoursAgo(2.5),
        },
        {
          id: 's_timeout', subject: '物理', topic: '受力分析', taskId: 't5', startTime: hoursAgo(3),
          // 2026-11-04：超时结束的课带 endTime；lastActiveAt 仍在 48h 窗口内，旧口径会误标「进行中」
          endTime: hoursAgo(1), duration: null, status: 'timeout', messageCount: 8, lastActiveAt: hoursAgo(2),
        },
        {
          // 已结束的课不出现在这个端点（completed 是终态）
          id: 's_done', subject: '历史', topic: '旧课', taskId: 't3', startTime: hoursAgo(300),
          endTime: hoursAgo(299), duration: 60, status: 'completed', messageCount: 4, lastActiveAt: hoursAgo(299),
        },
      ]);
      const handler = getRouteHandler('/sessions/active', 'get');
      const res = createResponse();
      await handler({ user: { userId: 'user-1' }, query: {} }, res);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toHaveLength(4);
      const live = data.find((s: any) => s.sessionId === 's_live');
      const idle = data.find((s: any) => s.sessionId === 's_idle');
      expect(live.activity).toBe('active');
      expect(idle.activity).toBe('idle');
      // paused / timeout 不得缺席（缺陷修复回归）
      expect(data.map((s: any) => s.sessionId)).toEqual(expect.arrayContaining(['s_paused', 's_timeout']));
      // 2026-11-04：已超时结束（endTime 非空）的课即便在恢复窗口内也归「空闲中」，不冒充进行中
      expect(data.find((s: any) => s.sessionId === 's_timeout').activity).toBe('idle');
      expect(data.find((s: any) => s.sessionId === 's_paused').activity).toBe('active');
      // lastActiveAt 必须原样透出（面板空闲档要显示「最近活跃多久前」）
      expect(new Date(live.lastActiveAt).getTime()).toBeCloseTo(hoursAgo(0.2).getTime(), -3);
      expect(new Date(idle.lastActiveAt).getTime()).toBeCloseTo(hoursAgo(199).getTime(), -3);
    });

    it('缺 lastActiveAt 时按 idle 处理（不让无读数的会话冒充进行中）', async () => {
      mockCoordinator.getSessionHistory.mockResolvedValue([
        {
          id: 's_unknown', subject: '数学', topic: '无读数的课', taskId: 't9', startTime: hoursAgo(2),
          endTime: null, duration: null, status: 'active', messageCount: 0, lastActiveAt: null,
        },
      ]);
      const handler = getRouteHandler('/sessions/active', 'get');
      const res = createResponse();
      await handler({ user: { userId: 'user-1' }, query: {} }, res);
      expect(res.json.mock.calls[0][0].data[0].activity).toBe('idle');
    });

    it('按 taskId 过滤时同样带上 lastActiveAt / activity', async () => {
      mockCoordinator.getSessionHistory.mockResolvedValue([
        {
          id: 's_a', subject: '英语', topic: 'A', taskId: 't1', startTime: hoursAgo(1),
          endTime: null, duration: null, status: 'active', messageCount: 2, lastActiveAt: hoursAgo(0.5),
        },
        {
          id: 's_b', subject: '英语', topic: 'B', taskId: 't2', startTime: hoursAgo(1),
          endTime: null, duration: null, status: 'active', messageCount: 2, lastActiveAt: hoursAgo(0.5),
        },
      ]);
      const handler = getRouteHandler('/sessions/active', 'get');
      const res = createResponse();
      await handler({ user: { userId: 'user-1' }, query: { taskId: 't2' } }, res);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0].sessionId).toBe('s_b');
      expect(data[0].activity).toBe('active');
      expect(data[0].lastActiveAt).toBeTruthy();
    });
  });
});
