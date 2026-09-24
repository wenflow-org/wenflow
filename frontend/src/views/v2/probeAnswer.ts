/**
 * 快速自测（前置探测题）作答的消息格式 —— 发送方（useGoalLive.answerProbe）与
 * 渲染方（V2GoalConversation）共用这一处，避免两边各写一份前缀。
 *
 * 为什么走"对话消息"这条通道：goal-conversation 据此静默回填
 * prerequisiteCheckResults（{probeId, targetConcept, userAnswer, isCorrect}），
 * 服务端存的是消息原文，所以刷新后回填的消息只能靠前缀识别。
 *
 * 文案顺序有意为之：**先给答案**（用户扫一眼知道"我选了什么"），题目跟在后面作上下文
 * （模型据此判 targetConcept / isCorrect）。2026-09-24 反馈：此前把整道题放在句首，
 * 用户在对话里看到一条像自己发问的消息，不知道是什么意思。
 */
export const PROBE_ANSWER_PREFIX = '【快速自测作答】';

const QUESTION_SEP = '· 原题：';

/** 组装作答消息（answerProbe 与测试共用） */
export function buildProbeAnswerText(question: string, optionId: string, optionText: string): string {
  return `${PROBE_ANSWER_PREFIX}我选 ${optionId}（${optionText}）${QUESTION_SEP}${question}`;
}

/** 是否是自测作答消息（渲染分支用） */
export function isProbeAnswer(content: string): boolean {
  return content.startsWith(PROBE_ANSWER_PREFIX);
}

/** 拆成「答案」与「原题」两段；没有题目段时 question 为空串 */
export function probeAnswerParts(content: string): { answer: string; question: string } {
  const body = content.slice(PROBE_ANSWER_PREFIX.length);
  const i = body.indexOf(QUESTION_SEP);
  if (i === -1) return { answer: body.trim(), question: '' };
  return {
    answer: body.slice(0, i).trim(),
    question: body.slice(i + QUESTION_SEP.length).trim(),
  };
}
