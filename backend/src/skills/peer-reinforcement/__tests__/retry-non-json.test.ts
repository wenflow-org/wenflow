/**
 * peer 非 JSON 输出的纠偏重试（审计 P1 §2.4e）——**端到端**（真 callPrompt + 真 peer spec）。
 *
 * 现网头号失败源是 `response does not contain valid JSON object`（35 次 / 570 次调用），
 * 而 peer 此前没有 retryStrategy（maxAttempts=1）⇒ 一次输出散文就整条伴学消息丢失。
 * 这里用真实 prompt-composer + 打桩网关复现该失败形态：第一次返回散文、第二次返回合法 JSON，
 * 断言重试真的发生、纠偏话术进了第二次请求、且最终成功产出消息。
 */
const mockGetActivePrompt = jest.fn()
const mockGatewayExecute = jest.fn()
const mockPromptCallCreate = jest.fn()

jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: mockGetActivePrompt },
}))
jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute }),
}))
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { prompt_call_logs: { create: mockPromptCallCreate } },
}))

import { executePeerDiscussion } from '../index';

const gatewayReply = (content: string) => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

describe('peer 非 JSON → 纠偏重试（§2.4e）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActivePrompt.mockResolvedValue({ systemPrompt: 'active peer prompt', version: 1 });
    mockPromptCallCreate.mockResolvedValue({ id: 'log-1' });
  });

  it('第一次散文、第二次合法 JSON → 重试后成功，且纠偏话术进了第二次请求', async () => {
    mockGatewayExecute
      .mockResolvedValueOnce(gatewayReply('我觉得你刚才说的那个点挺有意思的，要不我们再聊聊？'))
      .mockResolvedValueOnce(gatewayReply('{"message":"那你能换个例子讲讲吗？","followUpQuestions":["如果条件变了呢？"]}'));

    const result = await executePeerDiscussion({
      topic: '牛顿第一定律',
      strategy: 'feynman',
      tutorContext: [],
      studentMessage: '懂了，就是动就一直动。',
    });

    expect(result.message).toBe('那你能换个例子讲讲吗？');
    expect(result.followUpQuestions).toEqual(['如果条件变了呢？']);
    expect(mockGatewayExecute).toHaveBeenCalledTimes(2);

    // 第二次请求必须带上纠偏话术（否则模型只会重复同样的散文）
    const secondCall = mockGatewayExecute.mock.calls[1][0];
    const secondUserContent = JSON.stringify(secondCall.messages);
    expect(secondUserContent).toContain('只输出一个 JSON 对象');
    expect(secondUserContent).toContain('response does not contain valid JSON object');
  });

  it('两次都非 JSON → 抛错冒泡（不产出模板话术降级）', async () => {
    mockGatewayExecute.mockResolvedValue(gatewayReply('还是散文，没有 JSON。'));

    await expect(executePeerDiscussion({
      topic: '牛顿第一定律',
      strategy: 'feynman',
      tutorContext: [],
    })).rejects.toThrow();

    expect(mockGatewayExecute).toHaveBeenCalledTimes(2);
  });
});
