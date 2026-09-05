/**
 * GET /prompt-call-logs（runtime-definitions.ts）大文本列裁剪单测
 *
 * - 超大 userPayload/rawModelOutput/extractedJson/normalizedOutput 截断到
 *   PROMPT_CALL_LOG_TEXT_CAP（6000）字符（ADMIN_PERFORMANCE_AUDIT P7）
 * - 小文本 / 正常 JSON 列不变（normalizedOutput 完整时仍解析为对象）
 * - normalizedOutput 截断后 parseJson 失败 → 回退返回截断文本预览
 * - limit 参数透传与钳制（1..200）
 * - 过滤条件透传（agentId/status/traceId/pathId/pipelineRunId/parentExecutionId）
 * - attemptTrace → attempts 解析
 */
const mockPromptLogsFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: { findMany: (args: unknown) => mockPromptLogsFindMany(args) },
  },
}));

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findMany: jest.fn(async () => []) },
  },
}));

let router: any;

beforeAll(() => {
  jest.isolateModules(() => {
    router = require('../runtime-definitions').default;
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

function getRouteHandler(p: string, method = 'get') {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === p && item.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    agentId: 'skill:goal-conversation',
    systemPromptVersion: 3,
    systemPromptHash: 'hash-1',
    userPayload: '',
    rawModelOutput: null,
    extractedJson: null,
    normalizedOutput: null,
    success: true,
    errorCode: null,
    errorMessage: null,
    promptDrift: false,
    durationMs: 123,
    tokenUsage: null,
    pathId: null,
    userId: null,
    conversationId: null,
    pipelineRunId: null,
    pipelineStepIndex: null,
    traceId: 'trace-1',
    parentExecutionId: null,
    promptAttemptCount: 1,
    llmRequestCount: 1,
    finalLlmRequestId: null,
    failureStage: null,
    attemptTrace: null,
    providerId: null,
    model: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

const TEXT_CAP = 6000;

describe('GET /prompt-call-logs 大文本裁剪', () => {
  it('超大文本列截断到 6000 字符', async () => {
    mockPromptLogsFindMany.mockResolvedValue([
      makeRow({
        userPayload: 'u'.repeat(20000),
        rawModelOutput: 'r'.repeat(10000),
        extractedJson: 'e'.repeat(8000),
        normalizedOutput: JSON.stringify({ big: 'x'.repeat(20000) }),
      }),
    ]);
    const handler = getRouteHandler('/prompt-call-logs');
    const res = createResponse();
    await handler({ query: {} }, res);

    const row = res.json.mock.calls[0][0].data[0];
    expect(row.userPayload).toHaveLength(TEXT_CAP);
    expect(row.rawModelOutput).toHaveLength(TEXT_CAP);
    expect(row.extractedJson).toHaveLength(TEXT_CAP);
    // 截断后 parseJson 失败 → 回退返回截断文本预览
    expect(row.normalizedOutput).toHaveLength(TEXT_CAP);
    expect(typeof row.normalizedOutput).toBe('string');
  });

  it('小文本与完整 JSON 列保持不变（normalizedOutput 仍解析为对象）', async () => {
    mockPromptLogsFindMany.mockResolvedValue([
      makeRow({
        userPayload: 'hello',
        rawModelOutput: 'raw',
        extractedJson: '{"a":1}',
        normalizedOutput: JSON.stringify({ summary: 'ok' }),
      }),
    ]);
    const handler = getRouteHandler('/prompt-call-logs');
    const res = createResponse();
    await handler({ query: {} }, res);

    const row = res.json.mock.calls[0][0].data[0];
    expect(row.userPayload).toBe('hello');
    expect(row.rawModelOutput).toBe('raw');
    expect(row.extractedJson).toBe('{"a":1}');
    expect(row.normalizedOutput).toEqual({ summary: 'ok' });
  });

  it('limit 参数透传并钳制在 1..200', async () => {
    const handler = getRouteHandler('/prompt-call-logs');
    mockPromptLogsFindMany.mockResolvedValue([]);

    await handler({ query: { limit: '5' } }, createResponse());
    expect(mockPromptLogsFindMany.mock.calls[0][0].take).toBe(5);

    await handler({ query: { limit: '9999' } }, createResponse());
    expect(mockPromptLogsFindMany.mock.calls[1][0].take).toBe(200);

    await handler({ query: {} }, createResponse());
    expect(mockPromptLogsFindMany.mock.calls[2][0].take).toBe(30);
  });

  it('过滤条件透传：agentId/status/traceId/pathId/pipelineRunId/parentExecutionId', async () => {
    const handler = getRouteHandler('/prompt-call-logs');
    mockPromptLogsFindMany.mockResolvedValue([]);

    await handler(
      {
        query: {
          agentId: 'skill:goal-conversation',
          status: 'error',
          traceId: 't9',
          pathId: 'p9',
          pipelineRunId: 'pr9',
          parentExecutionId: 'pe9',
        },
      },
      createResponse(),
    );
    expect(mockPromptLogsFindMany.mock.calls[0][0].where).toEqual({
      agentId: 'skill:goal-conversation',
      traceId: 't9',
      pathId: 'p9',
      pipelineRunId: 'pr9',
      parentExecutionId: 'pe9',
      success: false,
    });
  });

  it('attemptTrace → attempts 数组解析；其余字段原样透传', async () => {
    mockPromptLogsFindMany.mockResolvedValue([
      makeRow({
        attemptTrace: JSON.stringify([{ attempt: 1, statusCode: 200 }]),
        tokenUsage: JSON.stringify({ prompt_tokens: 10, completion_tokens: 20 }),
        durationMs: 456,
        promptDrift: true,
        errorCode: 'LLM_TIMEOUT',
        errorMessage: 'timeout after 30s',
      }),
    ]);
    const handler = getRouteHandler('/prompt-call-logs');
    const res = createResponse();
    await handler({ query: {} }, res);

    const row = res.json.mock.calls[0][0].data[0];
    expect(row.attempts).toEqual([{ attempt: 1, statusCode: 200 }]);
    expect(row.tokenUsage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
    expect(row.durationMs).toBe(456);
    expect(row.promptDrift).toBe(true);
    expect(row.errorCode).toBe('LLM_TIMEOUT');
    expect(row.errorMessage).toBe('timeout after 30s');
  });
});
