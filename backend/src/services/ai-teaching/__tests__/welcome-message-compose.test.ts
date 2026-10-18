/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 开场正文拼装（2026-10-11 走查）：`TeachingOpening.question` 是可选字段，与 quickReplies 互斥；
 * 确定性兜底 buildDeterministicOpening 只给 quickReplies，此时裸 `${message}\n\n${question}`
 * 会把字面量 "undefined" 写进落库消息——那是学习者看到的第一句话。
 * 全库实测 108/827 会话命中（108 行 teaching_session_messages 内容含 "undefined"）。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}));

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {},
}));

import { buildDeterministicOpening, composeWelcome } from '../teaching-session-views';

describe('composeWelcome（开场正文拼装）', () => {
  it('question 缺失时不写入字面量 undefined（确定性兜底路径）', () => {
    const opening = buildDeterministicOpening({ topic: '辨别材料依据与推得结论', taskTitle: '任务' } as any);
    // 契约：quickReplies 在场 ⇒ 不给 question
    expect(opening.question).toBeUndefined();

    const text = composeWelcome(opening);
    expect(text).not.toContain('undefined');
    expect(text).toBe('我们先从 **辨别材料依据与推得结论** 开始这节课。目标是把关键知识点讲清楚，并在过程中检查你的掌握情况。');
  });

  it('question 为空串/纯空白时同样只保留 message', () => {
    expect(composeWelcome({ message: '开场白', question: '', quickReplies: [], mode: 'example-first' })).toBe('开场白');
    expect(composeWelcome({ message: '开场白', question: '   ', quickReplies: [], mode: 'example-first' })).toBe('开场白');
  });

  it('question 有值时两段以空行拼接（LLM 开场保留软引导）', () => {
    expect(composeWelcome({ message: '开场白', question: '你觉得自己卡在哪一步？', quickReplies: [], mode: 'self-assess' }))
      .toBe('开场白\n\n你觉得自己卡在哪一步？');
  });
});
