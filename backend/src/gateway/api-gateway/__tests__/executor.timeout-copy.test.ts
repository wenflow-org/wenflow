/**
 * 超时错误文案护栏（2026-10-15，评审 F21 / issue #24）
 *
 * 病根：`classifyTransportError` 曾把文案拼成 `API request timed out after ${effectiveTimeoutMs}ms`
 * ——报的是**配置上限**而不是本次实际发生了什么。流式路径有三个限流器（空闲 60s / 总时长 / 单次
 * 上限 600s），先触发的往往不是上限：库里留下过 `errorMessage=…after 600000ms` 而
 * `durationMs=165325` 的自相矛盾行，运维按文案会去调大 600s 上限，排查方向被直接带偏。
 *
 * 契约（本护栏锁的正是文案本身，因为它是这条缺陷唯一的可见面）：
 *  1) 流式看门狗触发 → 报 `after {实测}ms (stream watchdog: idle 60000ms / total {阈值}ms)`；
 *  2) 缓冲路径触发 → 报 `after {实测}ms (per-attempt cap {上限}ms)`；
 *  3) 两者都**不得**把配置上限当成实测耗时（老形态的判据：文案里出现 600000 而实际只跑了几百毫秒）。
 *
 * 手法：真实 HTTP 传输（本地 server 立即回响应头、永不写数据、不结束），只 mock 遥测与数据库；
 * 流式看门狗的 total 阈值由 env `LLM_STREAM_TOTAL_TIMEOUT_MS` 注入（模块装载时读取，故用
 * jest.resetModules() + require 在设值之后装载），否则 5 分钟的默认值没法在单测里等。
 */
import { createServer, Server } from 'http';

const telemetryWriterMock = {
  createLlmAttempt: jest.fn().mockResolvedValue(true),
  createAgentCall: jest.fn().mockResolvedValue(true),
  createPromptCall: jest.fn().mockResolvedValue(true)
};

jest.mock('../../../services/telemetry-writer.service', () => ({
  telemetryWriter: telemetryWriterMock
}));
jest.mock('../../../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../../config/system-database', () => ({ __esModule: true, default: {} }));

/** 与 executor.stream-integration.test.ts 同一形状的路由字面量，外加本文件要用的 timeoutMs */
const routeOf = (endpoint: string, timeoutMs: number) => ({
  providerType: 'openai-compatible' as const,
  providerId: 'timeout-copy',
  endpoint,
  apiKey: 'test-key',
  model: 'm1',
  temperature: 0,
  maxTokens: 16,
  privateNetworkPolicy: 'runtime' as const,
  source: 'platform' as const,
  timeoutMs
});

async function catchError(run: () => Promise<unknown>): Promise<Error | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe('超时错误文案（#24：报实测耗时与真正生效的限流器，不报配置上限）', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {});
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // 立即把响应头送出（只 writeHead 会被 Node 缓冲到首次 write 才刷出，
      // 那样「流总时长看门狗」的计时起点永远等不到，测试会一路挂到首字节超时）
      res.flushHeaders();
      // 之后永不 write / 永不 end：
      //   缓冲路径靠 axios 自身 timeout 中断；流式路径靠 safe-http 的总时长看门狗中断。
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    telemetryWriterMock.createLlmAttempt.mockClear();
    telemetryWriterMock.createAgentCall.mockClear();
    telemetryWriterMock.createPromptCall.mockClear();
    delete process.env.LLM_STREAM_TOTAL_TIMEOUT_MS;
  });

  /** 装载执行器：先写 env 再 require（限流器阈值是模块级常量） */
  function loadExecutor() {
    jest.resetModules();
    process.env.LLM_STREAM_TOTAL_TIMEOUT_MS = '400';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const executorModule = require('../executor');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const budgetModule = require('../retry-budget');
    return {
      APIExecutor: executorModule.APIExecutor as typeof import('../executor').APIExecutor,
      createRetryBudget: budgetModule.createRetryBudget as typeof import('../retry-budget').createRetryBudget
    };
  }

  /* 单次上游尝试：maxTransportRetries=0 → transportMaxAttempts=1 → maxAttempts=1。
     注意 executor 在「可重试但预算已到顶」时会把末次错误换成统一的 RETRY_BUDGET_EXHAUSTED
     （`Provider request retry budget exhausted`），所以**断言要看落库的尝试记录**——
     issue #24 引用的正是那一行（lla.errorCode / lla.errorMessage），调用方拿到的那句
     本来就不带细节。 */
  const singleAttempt = () => ({ maxTransportRetries: 0, maxUpstreamAttempts: 5 });

  /** 落库的尝试记录（issue 引用的字段：lla.errorMessage） */
  const lastAttemptRecord = () => {
    const calls = telemetryWriterMock.createLlmAttempt.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : null;
  };

  it('流式看门狗触发：落库文案报实测耗时 + idle/total 阈值，且不出现配置上限 600000', async () => {
    const { APIExecutor, createRetryBudget } = loadExecutor();
    const error = await catchError(() =>
      new APIExecutor().execute(
        routeOf(baseUrl, 600_000),
        { messages: [{ role: 'user', content: 'hi' }], stream: true },
        {
          traceId: 'timeout-copy-stream',
          onStreamChunk: () => {},
          retryBudget: createRetryBudget(singleAttempt())
        }
      )
    );
    expect(error).toBeTruthy();

    const record = lastAttemptRecord();
    expect(record?.errorCode).toBe('ATTEMPT_TIMEOUT');
    const message = String(record?.errorMessage);
    expect(message).toContain('stream watchdog: idle 60000ms / total 400ms');
    const elapsed = Number((message.match(/after (\d+)ms/) || [])[1]);
    expect(Number.isFinite(elapsed)).toBe(true);
    expect(elapsed).toBeLessThan(5_000); // 实测耗时，不是 600000 上限

    // 老形态的判据：文案里不得把 600000 当成「跑了多久」
    expect(message).not.toContain('600000');
    expect(String(error?.message)).not.toContain('after 600000ms');
  }, 20_000);

  it('缓冲路径超时：落库文案报 per-attempt cap 与实测耗时，不把上限当耗时', async () => {
    const { APIExecutor, createRetryBudget } = loadExecutor();
    const error = await catchError(() =>
      new APIExecutor().execute(
        routeOf(baseUrl, 300),
        { messages: [{ role: 'user', content: 'hi' }] },
        {
          traceId: 'timeout-copy-buffered',
          retryBudget: createRetryBudget(singleAttempt())
        }
      )
    );
    expect(error).toBeTruthy();

    const record = lastAttemptRecord();
    expect(record?.errorCode).toBe('ATTEMPT_TIMEOUT');
    const message = String(record?.errorMessage);
    expect(message).toContain('per-attempt cap 300ms');
    const elapsed = Number((message.match(/after (\d+)ms/) || [])[1]);
    expect(Number.isFinite(elapsed)).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
  }, 20_000);
});
