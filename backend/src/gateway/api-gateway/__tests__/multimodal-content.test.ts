/**
 * 多模态输入链路的网关侧测试（#123）。
 *
 * 覆盖三件事：
 *  1. system 折叠对内容块数组安全（转成块数组时不能退化成 `[object Object]`，图片块不能丢）；
 *  2. 请求日志脱敏：base64 图片不进日志，只留类型与体积；
 *  3. 视觉硬闸门：带图请求打到未声明 vision 的模型 → 明确拒绝（MODEL_VISION_UNSUPPORTED），
 *     且**在发上游请求之前**就抛出（不是让上游 400）。
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters';

const safeHttpRequestMock = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { agent_call_logs: { create: jest.fn() }, llm_execution_attempts: { create: jest.fn() } },
}));

jest.mock('../../../services/agentRequestTimeout.service', () => ({
  getDefaultAIRequestTimeoutMs: () => 5000,
}));

jest.mock('../../../config/models.config', () => ({
  supportsThinkingMode: () => false,
  getModelDefinition: jest.fn(() => undefined),
  getModelFallbacks: jest.fn(() => []),
  getModelMaxParallelRequests: jest.fn(() => null),
  // 视觉闸门按注册表声明判定；测试里 model id 就是能力开关
  supportsVision: jest.fn((modelId: string) => modelId === 'vision-capable'),
}));

jest.mock('../../../utils/safe-http', () => ({
  safeHttpRequest: (...args: unknown[]) => safeHttpRequestMock(...args),
  safeHttpStreamRequest: jest.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
  SafeHttpBodyLimitError: class SafeHttpBodyLimitError extends Error {},
}));

import { APIExecutor, foldSystemMessagesIntoUser, summarizeContentForLog } from '../executor';
import type { ChatRequest, ResolvedRoute } from '../types';
import { messageHasImage, messagesHaveImages, type ChatContentPart } from '../types';
import { createRetryBudget } from '../retry-budget';
import { resetDeploymentHealth } from '../deployment-health';

const PNG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(2000);
// 单测占位符：真实凭据只在环境里；这里的调用全部被 safe-http mock 拦截，不出网
const ROUTE_API_KEY = process.env.TEST_GATEWAY_API_KEY || 'env-less-test-placeholder';

const baseRoute: ResolvedRoute = {
  providerType: 'openai-compatible',
  providerId: 'test-provider',
  endpoint: 'https://example.com',
  apiKey: ROUTE_API_KEY,
  model: 'vision-capable',
  temperature: 0.2,
  maxTokens: 128,
  privateNetworkPolicy: 'runtime',
  source: 'platform',
};

describe('foldSystemMessagesIntoUser（内容块数组兼容，#123）', () => {
  it('首条 user 是内容块数组时：system 文本插到首个文本块前，图片块原样保留', () => {
    const image: ChatContentPart = { type: 'image_url', image_url: { url: PNG_DATA_URL } };
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [{ type: 'text', text: '看这张图' }, image] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: 'text', text: 'SYS\n\n---' },
      { type: 'text', text: '看这张图' },
      image,
    ]);
  });

  it('首条 user 只有图片块时：system 文本块前置，图片块不丢', () => {
    const image: ChatContentPart = { type: 'image_url', image_url: { url: PNG_DATA_URL } };
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [image] },
    ]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'SYS\n\n---' }, image]);
  });

  it('内容块数组形态的 system 不参与折叠（只折叠纯文本 system）', () => {
    const input: ChatRequest['messages'] = [
      { role: 'system', content: [{ type: 'text', text: 'SYS-IN-ARRAY' }] },
      { role: 'user', content: 'U' },
    ];
    expect(foldSystemMessagesIntoUser(input)).toBe(input);
  });

  it('多模态消息存在时，纯文本 system 折叠结果里不出现 [object Object]', () => {
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: PNG_DATA_URL } }, { type: 'text', text: '呢' }] },
    ]);
    expect(JSON.stringify(out[0].content)).not.toContain('[object Object]');
  });
});

describe('summarizeContentForLog（base64 进日志防线，#123）', () => {
  it('字符串内容照旧截断到 500', () => {
    expect(summarizeContentForLog('x'.repeat(600))).toHaveLength(500);
  });

  it('图片块只留类型与体积，base64 明文不出现', () => {
    const summary = summarizeContentForLog([
      { type: 'text', text: '看这张图' },
      { type: 'image_url', image_url: { url: PNG_DATA_URL } },
    ]);
    expect(summary).toContain('看这张图');
    expect(summary).toContain('[image');
    expect(summary).toContain('chars]');
    expect(summary).not.toContain('AAAA');
    expect(summary.length).toBeLessThanOrEqual(500);
  });

  it('非字符串非数组内容安全返回空串', () => {
    expect(summarizeContentForLog(undefined)).toBe('');
    expect(summarizeContentForLog(null)).toBe('');
  });
});

describe('messageHasImage / messagesHaveImages', () => {
  it('识别图片块（含混合内容与空值）', () => {
    expect(messageHasImage('纯文本')).toBe(false);
    expect(messageHasImage([{ type: 'text', text: 'x' }])).toBe(false);
    expect(messageHasImage([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }])).toBe(true);
    expect(messagesHaveImages([{ content: 'x' }, { content: [{ type: 'text', text: 'y' }] }])).toBe(false);
    expect(messagesHaveImages([{ content: 'x' }, { content: [{ type: 'image_url', image_url: { url: 'u' } }] }])).toBe(true);
    expect(messagesHaveImages(null)).toBe(false);
  });
});

describe('视觉硬闸门（#123 验收③：未声明视觉的模型带图请求被拦下）', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    safeHttpRequestMock.mockReset();
    resetDeploymentHealth();
  });

  function imageRequest(model: string): ChatRequest {
    return {
      model,
      messages: [
        { role: 'user', content: [{ type: 'text', text: '看这张图' }, { type: 'image_url', image_url: { url: PNG_DATA_URL } }] },
      ],
    };
  }

  it('未声明 vision 的模型：请求在**发上游之前**被拒绝，带可执行的处置提示', async () => {
    const executor = new APIExecutor();
    const budget = createRetryBudget();
    await expect(
      executor.execute(baseRoute, imageRequest('no-vision-model'), { traceId: 't1', retryBudget: budget })
    ).rejects.toMatchObject({ code: 'MODEL_VISION_UNSUPPORTED', category: 'configuration', retryable: false });
    expect(safeHttpRequestMock).not.toHaveBeenCalled();
  });

  it('同一模型纯文本请求不受闸门影响（不误伤）', async () => {
    const executor = new APIExecutor();
    safeHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      url: 'https://example.com/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      statusText: 'OK',
      data: JSON.stringify({
        id: 'c1',
        model: 'no-vision-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    const budget = createRetryBudget();
    const response = await executor.execute(
      { ...baseRoute, model: 'no-vision-model' },
      { model: 'no-vision-model', messages: [{ role: 'user', content: '纯文本问题' }] },
      { traceId: 't2', retryBudget: budget }
    );
    expect(response.choices[0].message.content).toBe('ok');
    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('已声明 vision 的模型：带图请求放行且图片块原样到达上游请求体', async () => {
    const executor = new APIExecutor();
    safeHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      url: 'https://example.com/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      statusText: 'OK',
      data: JSON.stringify({
        id: 'c2',
        model: 'vision-capable',
        choices: [{ index: 0, message: { role: 'assistant', content: '我看到三个色块' }, finish_reason: 'stop' }],
      }),
    });
    const budget = createRetryBudget();
    const response = await executor.execute(baseRoute, imageRequest('vision-capable'), { traceId: 't3', retryBudget: budget });
    expect(response.choices[0].message.content).toContain('三个色块');
    const upstreamBody = safeHttpRequestMock.mock.calls[0][1].body as ChatRequest;
    const serialized = JSON.stringify(upstreamBody.messages);
    expect(serialized).toContain('image_url');
    expect(serialized).toContain(PNG_DATA_URL);
  });
});
