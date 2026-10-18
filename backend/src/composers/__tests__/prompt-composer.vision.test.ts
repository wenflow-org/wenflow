/**
 * prompt-composer 视觉能力护栏（#123 验收③的降级面）。
 *
 * 策略：图片是**可选上下文**（课堂配图随历史回流）。生效模型声明了 vision → 原样发送；
 * 未声明 → 摘掉图片块、保留文本（纯文本回退）+ 告警，让课堂降级为"无图但仍能上"，
 * 而不是把整条教学链路打挂。硬闸门在网关（带图请求打到未声明模型直接拒绝）。
 */
const mockGetActivePrompt = jest.fn();
const mockGatewayExecute = jest.fn();
const mockPromptCallCreate = jest.fn();

jest.mock('../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: mockGetActivePrompt },
}));
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute }),
}));
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { prompt_call_logs: { create: mockPromptCallCreate } },
}));

import { callPrompt } from '../prompt-composer';
import { runWithContext } from '../../gateway/api-gateway/context';

interface CapturedMessage { role: string; content: unknown }

const IMAGE_DATA_URL = 'data:image/png;base64,' + 'F'.repeat(64);
const IMAGE_PART = { type: 'image_url' as const, image_url: { url: IMAGE_DATA_URL } };

function lastGatewayMessages(): CapturedMessage[] {
  return (mockGatewayExecute.mock.calls.at(-1)?.[0]?.messages || []) as CapturedMessage[];
}

async function invoke(spec: Parameters<typeof callPrompt>[0], promptContext?: Record<string, unknown>, modelOverride?: string) {
  return runWithContext(
    {
      promptRuntimeOverride: {
        ...(modelOverride ? { modelOverride } : {}),
      },
    },
    () => callPrompt(spec, { q: 1 }, promptContext)
  );
}

const baseSpec: Parameters<typeof callPrompt>[0] = {
  agentId: 'skill:vision-test',
  defaultSystemPrompt: 'default prompt',
  requireActivePrompt: false,
  caller: { skillId: 'vision-test' },
  buildUserPayload: () => ({ q: 1 }),
  normalizeOutput: (parsed: unknown) => parsed,
};

describe('callPrompt × 视觉能力（#123）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPromptCallCreate.mockResolvedValue({});
    mockGetActivePrompt.mockResolvedValue({ systemPrompt: 'active prompt', version: 1, metadata: {} });
    mockGatewayExecute.mockResolvedValue({
      id: 'completion-1',
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
    });
  });

  it('生效模型未声明 vision：buildMessages 的图片块被摘掉（文本保留）', async () => {
    const spec: Parameters<typeof callPrompt>[0] = {
      ...baseSpec,
      buildMessages: () => [
        { role: 'system' as const, content: 'sys' },
        { role: 'user' as const, content: [{ type: 'text' as const, text: '看这张图' }, IMAGE_PART] },
      ],
    };
    const result = await invoke(spec, undefined, 'deepseek-v4-pro');
    expect(result.success).toBe(true);
    expect(lastGatewayMessages()).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '看这张图' },
    ]);
  });

  it('生效模型已声明 vision：图片块原样进请求', async () => {
    const spec: Parameters<typeof callPrompt>[0] = {
      ...baseSpec,
      buildMessages: () => [
        { role: 'system' as const, content: 'sys' },
        { role: 'user' as const, content: [{ type: 'text' as const, text: '看这张图' }, IMAGE_PART] },
      ],
    };
    const result = await invoke(spec, undefined, 'deepseek-v4.1-flash');
    expect(result.success).toBe(true);
    expect(lastGatewayMessages()).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: '看这张图' }, IMAGE_PART] },
    ]);
  });

  it('context.images 显式输入：声明 vision 的模型收到文本+图片内容块', async () => {
    const result = await invoke(baseSpec, { images: [{ url: IMAGE_DATA_URL }] }, 'deepseek-v4.1-flash');
    expect(result.success).toBe(true);
    const userMessage = lastGatewayMessages().at(-1);
    expect(userMessage.role).toBe('user');
    const parts = userMessage.content as Array<{ type: string }>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0].type).toBe('text');
    expect(parts.at(-1)).toEqual(IMAGE_PART);
  });

  it('context.images 显式输入：未声明 vision 的模型回退纯文本（不丢正文）', async () => {
    const result = await invoke(baseSpec, { images: [{ url: IMAGE_DATA_URL }] }, 'deepseek-v4-pro');
    expect(result.success).toBe(true);
    const userMessage = lastGatewayMessages().at(-1);
    expect(typeof userMessage.content).toBe('string');
    expect(userMessage.content).toContain('"q":1');
    expect(userMessage.content).not.toContain('base64');
  });

  it('非法图片 URL 不进请求（正文照常发送）', async () => {
    const result = await invoke(baseSpec, { images: [{ url: 'javascript:alert(1)' }] }, 'deepseek-v4.1-flash');
    expect(result.success).toBe(true);
    const userMessage = lastGatewayMessages().at(-1);
    expect(typeof userMessage.content).toBe('string');
    expect(JSON.stringify(userMessage.content)).not.toContain('javascript');
  });
});
