const mockRequirementOrchestrator = {
  start: jest.fn(),
  step: jest.fn(),
  regenerate: jest.fn(),
};

jest.mock('../../coordinators/requirement.coordinator', () => ({
  __esModule: true,
  default: mockRequirementOrchestrator,
}));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

import router from '../goal-conversation';

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

function goalResult(overrides: Record<string, any> = {}) {
  return {
    userVisible: '我会先了解你的学习背景。',
    internal: {
      core: {
        conversationId: 'conversation-created',
        stage: 'clarifying',
        confidence: 0.72,
        isCompleted: false,
        learningPath: null,
      },
      ext: {
        goalConversation: {
          understanding: { subject: 'TypeScript' },
          nextQuestions: ['你每周可以投入多少时间？'],
          quickReplies: ['每周五小时', '每周十小时'],
          structuredData: { level: 'beginner' },
          confirmedProposal: null,
          confidenceScores: { goal: 0.72 },
          collected: { goal: '学习 TypeScript' },
        },
      },
    },
    runtimeEnvelope: { traceId: 'runtime-1', outcome: { status: 'ok' } },
    ...overrides,
  };
}

function expectPublicGoalEnvelope(response: any, expected: {
  conversationId: string;
  runtimeEnvelope: any;
}) {
  expect(response).toEqual({
    success: true,
    data: {
      userVisible: '我会先了解你的学习背景。',
      internal: {
        core: {
          conversationId: expected.conversationId,
          stage: 'clarifying',
          confidence: 0.72,
          isCompleted: false,
          learningPath: null,
        },
        ext: {
          goalConversation: {
            understanding: { subject: 'TypeScript' },
            nextQuestions: ['你每周可以投入多少时间？'],
            quickReplies: ['每周五小时', '每周十小时'],
            structuredData: { level: 'beginner' },
            confirmedProposal: null,
            confidenceScores: { goal: 0.72 },
            collected: { goal: '学习 TypeScript' },
          },
        },
      },
      runtimeEnvelope: expected.runtimeEnvelope,
      renderHints: { quickReplies: ['每周五小时', '每周十小时'] },
      schemaVersion: 'agent-output-v1',
      meta: expect.objectContaining({ source: 'goal-conversation' }),
    },
  });
}

describe('goal-conversation public route contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects POST /start into the public agent-output-v1 DTO', async () => {
    const result = goalResult();
    mockRequirementOrchestrator.start.mockResolvedValue(result);
    const handler = getRouteHandler('/start');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      body: { input: { text: '  学习 TypeScript  ' }, contextMode: 'full' },
    }, res);

    expect(mockRequirementOrchestrator.start).toHaveBeenCalledWith('user-1', '学习 TypeScript', {
      contextMode: 'full',
    });
    expectPublicGoalEnvelope(res.json.mock.calls[0][0], {
      conversationId: 'conversation-created',
      runtimeEnvelope: result.runtimeEnvelope,
    });
  });

  it('uses the route conversation ID when POST /:conversationId/reply output omits it', async () => {
    const result = goalResult({
      internal: {
        ...goalResult().internal,
        core: {
          ...goalResult().internal.core,
          conversationId: undefined,
        },
      },
    });
    mockRequirementOrchestrator.step.mockResolvedValue(result);
    const handler = getRouteHandler('/:conversationId/reply');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { conversationId: 'conversation-route-reply' },
      body: {
        input: { text: '  我每周能学习十小时  ' },
        contextMode: 'full',
        confirmProposal: true,
      },
    }, res);

    expect(mockRequirementOrchestrator.step).toHaveBeenCalledWith(
      'conversation-route-reply',
      '我每周能学习十小时',
      'user-1',
      { contextMode: 'full', confirmProposal: true },
    );
    expectPublicGoalEnvelope(res.json.mock.calls[0][0], {
      conversationId: 'conversation-route-reply',
      runtimeEnvelope: result.runtimeEnvelope,
    });
  });

  it('uses the route conversation ID when POST /:conversationId/regenerate output omits it', async () => {
    const result = goalResult({
      internal: {
        ...goalResult().internal,
        core: {
          ...goalResult().internal.core,
          conversationId: undefined,
        },
      },
    });
    mockRequirementOrchestrator.regenerate.mockResolvedValue(result);
    const handler = getRouteHandler('/:conversationId/regenerate');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { conversationId: 'conversation-route-regenerate' },
      body: { adjustments: '  增加项目练习  ' },
    }, res);

    expect(mockRequirementOrchestrator.regenerate).toHaveBeenCalledWith(
      'conversation-route-regenerate',
      'user-1',
      '增加项目练习',
    );
    expectPublicGoalEnvelope(res.json.mock.calls[0][0], {
      conversationId: 'conversation-route-regenerate',
      runtimeEnvelope: result.runtimeEnvelope,
    });
  });

  it('projects synthetic POST /start requests into the synthetic-user-v1 DTO only', async () => {
    mockRequirementOrchestrator.start.mockResolvedValue(goalResult({
      internal: {
        ...goalResult().internal,
        core: {
          ...goalResult().internal.core,
          conversationId: undefined,
          isCompleted: true,
          learningPath: { id: 'path-1', status: 'ready', privateDetail: 'not public' },
        },
      },
    }));
    const handler = getRouteHandler('/start');
    const res = createResponse();

    await handler({
      user: { userId: 'synthetic-user-1', projection: { grantSource: 'synthetic' } },
      body: { input: { text: '学习 TypeScript' } },
    }, res);

    const response = res.json.mock.calls[0][0];
    expect(response).toEqual({
      success: true,
      data: {
        userVisible: '我会先了解你的学习背景。',
        control: {
          conversationId: null,
          stage: 'clarifying',
          isCompleted: true,
          learningPath: { id: 'path-1', status: 'ready' },
        },
        renderHints: { quickReplies: ['每周五小时', '每周十小时'] },
        schemaVersion: 'synthetic-user-v1',
      },
    });
    expect(response.data).not.toHaveProperty('internal');
    expect(response.data).not.toHaveProperty('runtimeEnvelope');
    expect(response.data).not.toHaveProperty('meta');
  });

  describe('SSE 流式', () => {
    function createSseResponse() {
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
      return { res, writes };
    }

    it('Accept text/event-stream 时输出 final/done 事件并转发 orchestrator', async () => {
      mockRequirementOrchestrator.start.mockResolvedValue(goalResult());
      const handler = getRouteHandler('/start');
      const { res, writes } = createSseResponse();

      await handler({
        user: { userId: 'user-1' },
        headers: { accept: 'text/event-stream' },
        body: { input: { text: '学习 TypeScript' } },
      }, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
      expect(res.flushHeaders).toHaveBeenCalled();
      expect(mockRequirementOrchestrator.start).toHaveBeenCalledWith('user-1', '学习 TypeScript', { contextMode: 'recent' });
      const joined = writes.join('');
      expect(joined).toContain('event: final\n');
      expect(joined).toContain('"userVisible":"我会先了解你的学习背景。"');
      expect(joined).toContain('event: done\ndata: {}');
      expect(res.end).toHaveBeenCalled();
    });

    it('SSE 失败时 error 事件携带 422 恢复信封', async () => {
      mockRequirementOrchestrator.start.mockRejectedValue(Object.assign(
        new Error('STRUCTURED_OUTPUT_INVALID'),
        { status: 422, code: 'STRUCTURED_OUTPUT_INVALID', result: goalResult({ userVisible: '部分产出可用' }) }
      ));
      const handler = getRouteHandler('/start');
      const { res, writes } = createSseResponse();

      await handler({
        user: { userId: 'user-1' },
        headers: { accept: 'text/event-stream' },
        body: { input: { text: '学习 TypeScript' } },
      }, res);

      const joined = writes.join('');
      expect(joined).toContain('event: error\n');
      expect(joined).toContain('STRUCTURED_OUTPUT_INVALID');
      expect(joined).toContain('"data":');
      expect(joined).toContain('"userVisible":"部分产出可用"');
      expect(res.end).toHaveBeenCalled();
    });

    it('reply 端点 SSE 同样生效（含 confirmProposal 透传）', async () => {
      mockRequirementOrchestrator.step.mockResolvedValue(goalResult());
      const handler = getRouteHandler('/:conversationId/reply');
      const { res, writes } = createSseResponse();

      await handler({
        user: { userId: 'user-1' },
        params: { conversationId: 'conversation-1' },
        headers: { accept: 'text/event-stream' },
        body: { input: { text: '每周五小时' }, confirmProposal: true },
      }, res);

      expect(mockRequirementOrchestrator.step).toHaveBeenCalledWith('conversation-1', '每周五小时', 'user-1', {
        contextMode: 'recent',
        confirmProposal: true,
      });
      const joined = writes.join('');
      expect(joined).toContain('event: final\n');
      expect(joined).toContain('event: done\ndata: {}');
      expect(res.end).toHaveBeenCalled();
    });
  });
});
