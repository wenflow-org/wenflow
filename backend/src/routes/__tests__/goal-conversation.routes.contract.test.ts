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
});
