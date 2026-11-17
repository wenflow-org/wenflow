/**
 * 首轮状态机守卫（2026-11-17 真机 gc_1794926822072_rpp3pu7）：
 * exploratory 首轮只做「用途 + 基础」校准，不得 early proposing / 提前给方案。
 */
import {
  countGoalUserMessages,
  forceExploratoryFirstTurnClarification,
  type GoalResponseLike,
} from '../goal-first-turn-guard';

function response(patch: Partial<GoalResponseLike> & {
  entry?: string;
  stage?: string;
  proposal?: unknown;
} = {}): GoalResponseLike {
  return {
    internal: {
      core: { stage: patch.stage || 'proposing' },
      ext: {
        goalConversation: {
          understanding: { entry_state: patch.entry ?? 'exploratory' },
          confirmedProposal: patch.proposal === undefined ? { key_stages: ['a', 'b'] } : patch.proposal,
        },
      },
    },
    runtimeEnvelope: {
      businessState: { phase: patch.stage || 'proposing' },
      contextUpdate: { nextState: { stage: patch.stage || 'proposing' } },
    },
  };
}

describe('forceExploratoryFirstTurnClarification', () => {
  it('exploratory 首轮已 proposing + 有方案 → 压回 understanding 并丢弃方案', () => {
    const ai = response();
    expect(forceExploratoryFirstTurnClarification(ai)).toBe(true);
    expect(ai.internal?.core?.stage).toBe('understanding');
    expect(ai.runtimeEnvelope?.businessState?.phase).toBe('understanding');
    expect(ai.runtimeEnvelope?.contextUpdate?.nextState?.stage).toBe('understanding');
    expect(ai.runtimeEnvelope?.contextUpdate?.nextState?.confirmedProposal).toBeNull();
    expect(ai.internal?.ext?.goalConversation?.confirmedProposal).toBeNull();
  });

  it('exploratory 首轮正常澄清（understanding、无方案）→ 不动', () => {
    const ai = response({ stage: 'understanding', proposal: null });
    expect(forceExploratoryFirstTurnClarification(ai)).toBe(false);
    expect(ai.internal?.core?.stage).toBe('understanding');
    expect(ai.internal?.ext?.goalConversation?.confirmedProposal).toBeNull();
  });

  it('focused 首轮出方案 → 不拦（明确任务允许直接提案）', () => {
    const ai = response({ entry: 'focused' });
    expect(forceExploratoryFirstTurnClarification(ai)).toBe(false);
    expect(ai.internal?.core?.stage).toBe('proposing');
  });

  it('answer-only 终局（completed、无方案）→ 不拦', () => {
    const ai = response({ stage: 'completed', proposal: null });
    expect(forceExploratoryFirstTurnClarification(ai)).toBe(false);
    expect(ai.internal?.core?.stage).toBe('completed');
  });
});

describe('countGoalUserMessages', () => {
  it('只数 user 消息，包含本轮', () => {
    expect(countGoalUserMessages({ messages: [
      { role: 'user' }, { role: 'ai' }, { role: 'user' },
    ] })).toBe(2);
    expect(countGoalUserMessages({})).toBe(0);
  });
});
