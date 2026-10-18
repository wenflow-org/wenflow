/**
 * 教师回合请求组装 × 历史配图（#123）：捕捉真实发给网关的消息，
 * 断言「历史配图确实以 image_url 内容块附在本轮 user 消息上」——
 * 这是验收①的管道段回归（此前只有纯函数单测，覆盖不到 callPrompt 组装层）。
 */
const mockGatewayExecute = jest.fn();
const mockPromptCallCreate = jest.fn();

jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute }),
}));
jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: {
    getActivePrompt: async () => ({ systemPrompt: '你是老师。', version: 1, metadata: {} }),
  },
}));
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { prompt_call_logs: { create: mockPromptCallCreate } },
}));

import { teachingTurnAgentHandler } from '../index';
import { runWithContext } from '../../../gateway/api-gateway/context';
import type { ChatMessageContent } from '../../../gateway/api-gateway/types';

const png = (n: number) => `data:image/png;base64,${'G'.repeat(n)}`;

/** 锁定生效模型为声明了 vision 的模型（视觉组装路径需要它，避免被能力护栏降级为纯文本） */
function withVisionModel<T>(fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    { promptRuntimeOverride: { modelOverride: 'deepseek-v4.1-flash' } },
    fn
  ) as Promise<T>;
}

function baseInput(images?: Array<{ url: string; caption?: string | null }>) {
  return {
    messages: [
      { role: 'user' as const, content: '老师，我们看这个核对框架吧。' },
      {
        role: 'assistant' as const,
        content: '好，这张图就是我们的核对框架。',
        ...(images ? { images } : {}),
      },
      { role: 'user' as const, content: '图上哪个色块最宽？' },
    ],
    learner: {
      stableProfile: { thinkingStyle: '实例驱动', preferredStyle: '先例后理', theoryVsPractice: '实践优先', sessionLength: '40 分钟', confidenceLevel: '中等' },
      liveState: { lss: 4, ktl: 5, lf: 3, lsb: 2, recentTrend: '平稳', recommendedPacing: '标准' },
      pathContext: { pathTitle: 'P', currentMilestoneTitle: 'M', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 1, completedPrerequisiteTasks: [] },
      relevantKnowledge: { mastered: [], fragile: [], struggling: [] },
      backgroundKnowledge: { knownConcepts: [], limitations: [] },
    },
    scenario: { subject: '验收', topic: '核对框架', taskTitle: '核对框架', taskDescription: '核对图', taskType: 'concept' },
    knowledge: { points: [] },
    controls: { mode: 'tutor' as const },
  };
}

function capturedMessages(): Array<{ role: string; content: ChatMessageContent }> {
  return mockGatewayExecute.mock.calls[0]?.[0]?.messages || [];
}

function lastUserContent(): ChatMessageContent {
  const messages = capturedMessages();
  return messages.filter((message) => message.role === 'user').slice(-1)[0]?.content;
}

describe('teaching-turn 请求组装 × 历史配图（#123）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPromptCallCreate.mockResolvedValue({});
    mockGatewayExecute.mockResolvedValue({
      id: 'c1',
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ reply: '好', analysis: {}, knowledge: { points: [] }, pedagogy: {}, control: {} }) }, finish_reason: 'stop' }],
    });
  });

  it('历史带图：图片块随本轮 user 消息发出（内容块数组含 image_url）', async () => {
    await withVisionModel(() => teachingTurnAgentHandler(baseInput([{ url: png(20), caption: '核对框架' }]) as never).catch(() => undefined));
    const content = lastUserContent();
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    const imageParts = parts.filter((part) => part.type === 'image_url');
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0].image_url?.url).toBe(png(20));
    // 图片紧跟载荷（在输出契约尾之前），且标签说明图来自老师上一轮板书
    const labelIndex = parts.findIndex((part) => part.type === 'text' && (part.text || '').includes('课堂配图'));
    const imageIndex = parts.findIndex((part) => part.type === 'image_url');
    const tailIndex = parts.findIndex((part) => part.type === 'text' && (part.text || '').includes('输出契约'));
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeLessThan(imageIndex);
    expect(tailIndex).toBeGreaterThan(imageIndex);
  });

  it('历史无图：user 消息保持字符串（请求形态与改动前一致）', async () => {
    await withVisionModel(() => teachingTurnAgentHandler(baseInput() as never).catch(() => undefined));
    const content = lastUserContent();
    expect(typeof content).toBe('string');
    expect(content as string).toContain('输出契约');
    expect(JSON.stringify(content)).not.toContain('base64');
  });
});
