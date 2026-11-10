/**
 * GET /prompt-call-logs（runtime-definitions.ts）大文本列裁剪单测
 *
 * - 超大 userPayload/rawModelOutput/extractedJson/normalizedOutput 截断到
 *   PROMPT_CALL_LOG_TEXT_CAP（6000）字符（ADMIN_PERFORMANCE_AUDIT P7）
 * - 小文本 / 正常 JSON 列不变（normalizedOutput 完整时仍解析为对象）
 * - normalizedOutput 截断后 parseJson 失败 → 回退返回截断文本预览
 * - limit 参数透传与钳制（1..200）
 * - 过滤条件透传（agentId/status/traceId/pathId/parentExecutionId）
 * - #251①：已删除的「管道」维度（pipelineRunId/pipelineStepIndex）不再出现在筛选与响应里
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

  it('过滤条件透传：agentId/status/traceId/pathId/parentExecutionId', async () => {
    const handler = getRouteHandler('/prompt-call-logs');
    mockPromptLogsFindMany.mockResolvedValue([]);

    await handler(
      {
        query: {
          agentId: 'skill:goal-conversation',
          status: 'error',
          traceId: 't9',
          pathId: 'p9',
          parentExecutionId: 'pe9',
        },
      },
      createResponse(),
    );
    expect(mockPromptLogsFindMany.mock.calls[0][0].where).toEqual({
      agentId: 'skill:goal-conversation',
      traceId: 't9',
      pathId: 'p9',
      parentExecutionId: 'pe9',
      success: false,
    });
  });

  // #251①：pipelineRunId / pipelineStepIndex 自建表起就没有写入方（RequestContext 无该字段、
  // composer 恒写 null），管理台却一直暴露这个永远匹配不到行的筛选维度、响应里也永远回 null。
  // 现在整个维度已删除（schema + 迁移 + 路由 + 前端 API），这里锁住「不再暴露」。
  it('#251① 已删除的 pipeline 维度不再接受筛选、也不再出现在响应里', async () => {
    const handler = getRouteHandler('/prompt-call-logs');
    mockPromptLogsFindMany.mockResolvedValue([makeRow()]);

    const res = createResponse();
    await handler(
      {
        query: {
          traceId: 't9',
          pipelineRunId: 'pr9',
          pipelineStepIndex: '3',
        },
      },
      res,
    );

    // 不再把它当作筛选条件（否则用户会以为该维度可用）
    const where = mockPromptLogsFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('pipelineRunId');
    expect(where).not.toHaveProperty('pipelineStepIndex');
    expect(where).toEqual({ traceId: 't9' });

    // 响应体也不再回该字段（此前恒为 null，前端下拉/表格据此渲染出一个假维度）
    const row = res.json.mock.calls[0][0].data[0];
    expect(row).not.toHaveProperty('pipelineRunId');
    expect(row).not.toHaveProperty('pipelineStepIndex');
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

  it('DB 读取抛错（如脏数据 P2023）不再冒泡成未捕获拒绝，降级为 500', async () => {
    // 2026-11-09 全站巡检实测：prompt_call_logs 曾把 'v1' 写进 Int 列，Prisma 读时抛 P2023；
    // 当时本路由是裸 async，Express 4 不接异步拒绝 → unhandledRejection 直接把整个后端关停。
    const boom = Object.assign(new Error('Could not convert value "v1"'), { code: 'P2023' });
    mockPromptLogsFindMany.mockRejectedValue(boom);
    const handler = getRouteHandler('/prompt-call-logs');
    const res = createResponse();
    // 若没有 try/catch，这里会 reject（等价于生产里的进程关停）
    await expect(handler({ query: {} }, res)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false });
  });
});
