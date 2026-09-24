/**
 * 快速自测作答的消息格式（probeAnswer.ts）：
 * 发送方（useGoalLive.answerProbe）与渲染方（V2GoalConversation 的紧凑记录卡）共用同一套
 * 前缀与拆解规则——2026-09-24 用户反馈「点完快速自测，对话框里那条消息是什么意思」，
 * 根因是整道题被放在句首，读起来像用户自己发的问句。
 */
import { describe, expect, it } from 'vitest';
import { PROBE_ANSWER_PREFIX, buildProbeAnswerText, isProbeAnswer, probeAnswerParts } from '../probeAnswer';

const QUESTION = '孩子经常把别人玩具抢过来（3-4岁），按指南最可能涉及哪个领域？';

describe('快速自测作答消息', () => {
  it('文案：先给答案，题目跟在「原题：」之后（模型仍需题目判 targetConcept / isCorrect）', () => {
    const text = buildProbeAnswerText(QUESTION, 'A', '健康领域（动作发展）');
    expect(text).toBe(`${PROBE_ANSWER_PREFIX}我选 A（健康领域（动作发展））· 原题：${QUESTION}`);
  });

  it('拆解：答案段不含题目，题目段完整保留', () => {
    const { answer, question } = probeAnswerParts(buildProbeAnswerText(QUESTION, 'B', '社会领域（人际交往与规则意识）'));
    expect(answer).toBe('我选 B（社会领域（人际交往与规则意识））');
    expect(question).toBe(QUESTION);
  });

  it('识别：只有带前缀的用户消息算自测作答', () => {
    expect(isProbeAnswer(buildProbeAnswerText(QUESTION, 'A', 'x'))).toBe(true);
    expect(isProbeAnswer('我想学 Excel')).toBe(false);
    expect(isProbeAnswer('【前置自测】旧格式的问题 我选 A（x）')).toBe(false);
  });

  it('兼容没有题目段的文本（拆解不抛错，question 为空）', () => {
    expect(probeAnswerParts(`${PROBE_ANSWER_PREFIX}我选 A（x）`)).toEqual({ answer: '我选 A（x）', question: '' });
  });
});
