/**
 * 前置探测题判分接线（审计 P1 §2.1b）。
 *
 * 判分设计：用 confirmedProposal.prerequisiteDiagnostics[].correctOption 做确定性比对，
 * 覆盖 LLM 自己给的 isCorrect——防"自己出题自己判"的自洽偏差。
 * 缺陷：判分键只取**本轮** confirmedProposal；模型不重复输出（delta 缺席=不变，或只是没复述）
 * 时键就丢了，确定性判分静默失效。修复：回退上一轮 previousState.confirmedProposal。
 */
import { parseGoalConversationResponse, type GoalConversationAgentResult } from '../index';

interface ScoredProbe { probeId?: string; userAnswer?: string; isCorrect?: boolean }
interface ProbeHolder {
  internal: { ext: { goalConversation: { understanding: { prerequisiteCheckResults?: ScoredProbe[] } } } };
}

/** 测试用最小签名：避免在断言处散落 any。 */
type ParseFn = (
  content: string,
  previousUnderstanding?: unknown,
  stageControlOptions?: unknown,
  deltaOptions?: unknown,
) => GoalConversationAgentResult;
const parse = parseGoalConversationResponse as unknown as ParseFn;

function scored(result: GoalConversationAgentResult): ScoredProbe[] {
  const holder = result as unknown as ProbeHolder;
  return holder.internal.ext.goalConversation.understanding.prerequisiteCheckResults || [];
}

const PROPOSAL_B = {
  learningDirection: '汇报逻辑框架',
  prerequisiteDiagnostics: [{ probeId: 'probe-1', question: '哪项是结论先行？', correctOption: 'B' }],
};
const PROPOSAL_A = {
  learningDirection: '汇报逻辑框架',
  prerequisiteDiagnostics: [{ probeId: 'probe-1', question: '哪项是结论先行？', correctOption: 'A' }],
};

/** 模型输出：用户答 B，模型自称 isCorrect=modelSays。 */
function modelResponse(modelSays: boolean, withProposal?: unknown): string {
  return JSON.stringify({
    reply: '我先了解一下你的情况。',
    state: { stage: 'understanding', confidence: 0.5, done: false },
    understanding: {
      real_problem: '汇报被追问就乱，缺问题框架',
      prerequisiteCheckResults: [{ probeId: 'probe-1', targetConcept: '问题结构识别', userAnswer: 'B', isCorrect: modelSays }],
    },
    nextQuestions: ['最近一次汇报是什么场景？'],
    ...(withProposal ? { confirmedProposal: withProposal } : {}),
  });
}

describe('前置探测题确定性判分', () => {
  it('本轮无 confirmedProposal：回退上一轮，correctOption 覆盖模型判分', () => {
    // 模型说 false，但用户答 B = 上一轮 correctOption ⇒ 必须被判为 true
    const result = parse(modelResponse(false), {}, { previousState: { confirmedProposal: PROPOSAL_B } });
    expect(scored(result)[0].isCorrect).toBe(true);
  });

  it('本轮与上一轮都没有判分键：保留模型判分（不被 null 覆盖）', () => {
    const result = parse(modelResponse(false), {}, { previousState: { confirmedProposal: null } });
    expect(scored(result)[0].isCorrect).toBe(false);
  });

  it('本轮有 confirmedProposal 时以本轮为准（不串轮）', () => {
    // 本轮 correctOption=A，用户答 B ⇒ 确定性判为错，覆盖模型给的 true
    const result = parse(modelResponse(true, PROPOSAL_A), {}, { previousState: { confirmedProposal: PROPOSAL_B } });
    expect(scored(result)[0].isCorrect).toBe(false);
  });

  it('本轮 confirmedProposal 与用户答案一致：判为对', () => {
    const result = parse(modelResponse(false, PROPOSAL_B), {}, { previousState: { confirmedProposal: null } });
    expect(scored(result)[0].isCorrect).toBe(true);
  });
});
