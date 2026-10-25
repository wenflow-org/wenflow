/**
 * 链路级回归：service 形状的入参（含 uploadedMaterials）经 executeSkill →
 * runGoalConversationAgent → goalConversationAgentHandler → buildGoalPromptSpec
 * 后，最终传给 callPrompt 的 payload 必须包含已上传资料清单。
 * callPrompt 被 mock（用 spec.buildUserPayload 重建 payload，不真调 LLM）。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../../../composers/prompt-composer', () => ({
  __esModule: true,
  callPrompt: jest.fn(async (spec: any, input: any) => ({
    success: true,
    output: {
      reply: 'ok',
      quickReplies: [],
      stage: 'understanding',
      confidence: 0.5,
      state: { stage: 'understanding', confidence: 0.5, understanding: {} },
      done: false,
    },
    runtimeEnvelope: { contract: { businessState: { defaultPhase: 'understanding', terminalPhases: [] } } },
    debug: { attempts: [], userPayload: spec.buildUserPayload(input) },
  })),
}));

import { executeSkill } from '../../../skills';
import { callPrompt } from '../../../composers/prompt-composer';
import { goalConversationAgentDefinition } from '../index';

const callPromptMock = callPrompt as jest.Mock;

const SERVICE_SHAPE_INPUT = {
  input: '我已经上传了一份资料文件，你收到了吗？',
  userId: 'user_probe',
  conversationHistory: [{ role: 'assistant', content: '先聊聊你的情况？' }],
  previousUnderstanding: { surface_goal: 'x' },
  previousStage: 'understanding',
  previousState: { stage: 'understanding', confidence: 0.4, understanding: { surface_goal: 'x' } },
  maxFormatRetries: 2,
  confirmProposal: false,
  uploadedMaterials: [
    {
      name: '《3-6岁儿童学习与发展指南》全文(1).docx',
      ext: '.docx',
      format: 'docx',
      charCount: 6250,
      headingCount: 0,
      headings: [],
    },
  ],
};

function lastPayload(): any {
  const calls = callPromptMock.mock.calls;
  const [spec, input] = calls[calls.length - 1];
  const payload: string = spec.buildUserPayload(input);
  return JSON.parse(payload.substring(payload.indexOf('{')));
}

describe('goal 链路：service 形状入参 → callPrompt payload 携带资料清单', () => {
  it('uploadedMaterials 穿透 executeSkill 全链，出现在最终 userPayload', async () => {
    await executeSkill(goalConversationAgentDefinition, SERVICE_SHAPE_INPUT as any).catch(() => undefined);
    expect(callPromptMock.mock.calls.length).toBeGreaterThan(0);
    const parsed = lastPayload();
    expect(parsed.uploadedMaterials).toHaveLength(1);
    expect(parsed.uploadedMaterials[0].name).toContain('3-6岁儿童学习与发展指南');
    expect(parsed.uploadedMaterialsNote).toContain('已收到');
  });

  it('无 uploadedMaterials 时 payload 不出现该键（零影响）', async () => {
    const without: Record<string, unknown> = { ...SERVICE_SHAPE_INPUT };
    delete without.uploadedMaterials;
    await executeSkill(goalConversationAgentDefinition, without as any).catch(() => undefined);
    const parsed = lastPayload();
    expect(parsed.uploadedMaterials).toBeUndefined();
    expect(parsed.uploadedMaterialsNote).toBeUndefined();
  });
});
