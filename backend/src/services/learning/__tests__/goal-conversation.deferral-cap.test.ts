/**
 * goal 延期门禁（2026-10-25 夜批 v11/v12 实证 14 步不收敛）：
 * 纯函数判据 —— 回合数达上限时，proposing 强制确认、understanding 先收敛为 proposing；
 * 已确认/未达上限/终态一律不介入。
 */
import {
  evaluateGoalDeferralCap,
  parseConversationMessageCount,
  GOAL_DEFERRAL_TURN_CAP,
} from '../goal-conversation.deferral-cap';

const CAP = GOAL_DEFERRAL_TURN_CAP;

describe('evaluateGoalDeferralCap', () => {
  it('未达上限不介入', () => {
    const d = evaluateGoalDeferralCap({ stage: 'proposing', messageCount: (CAP - 1) * 2, confirmAlready: false });
    expect(d).toEqual({ forceConfirm: false, forcePropose: false, turnCount: CAP - 1 });
  });

  it('proposing 达上限 → 本轮按事实确认', () => {
    const d = evaluateGoalDeferralCap({ stage: 'proposing', messageCount: CAP * 2, confirmAlready: false });
    expect(d.forceConfirm).toBe(true);
    expect(d.forcePropose).toBe(false);
    expect(d.turnCount).toBe(CAP);
  });

  it('understanding 达上限 → 本轮收敛为 proposing', () => {
    const d = evaluateGoalDeferralCap({ stage: 'understanding', messageCount: (CAP + 4) * 2, confirmAlready: false });
    expect(d.forceConfirm).toBe(false);
    expect(d.forcePropose).toBe(true);
  });

  it('已经确认（UI 标志/自然语言命中）时不重复介入', () => {
    const d = evaluateGoalDeferralCap({ stage: 'proposing', messageCount: CAP * 2 + 1, confirmAlready: true });
    expect(d.forceConfirm).toBe(false);
    expect(d.forcePropose).toBe(false);
  });

  it('ready/completed/未知 stage 不介入（ready 在服务层本就被回落为 proposing）', () => {
    for (const stage of ['ready', 'completed', '', null]) {
      const d = evaluateGoalDeferralCap({ stage, messageCount: CAP * 2, confirmAlready: false });
      expect(d.forceConfirm).toBe(false);
      expect(d.forcePropose).toBe(false);
    }
  });

  it('奇数条消息按 ⌊n/2⌋ 计回合', () => {
    const d = evaluateGoalDeferralCap({ stage: 'proposing', messageCount: CAP * 2 + 1, confirmAlready: false });
    expect(d.turnCount).toBe(CAP);
    expect(d.forceConfirm).toBe(true);
  });
});

describe('parseConversationMessageCount', () => {
  it('数组直接计长', () => {
    expect(parseConversationMessageCount([{ role: 'user' }, { role: 'ai' }, { role: 'user' }])).toBe(3);
  });

  it('JSON 字符串解析计长', () => {
    expect(parseConversationMessageCount('[{"role":"user"},{"role":"ai"}]')).toBe(2);
  });

  it('坏数据/空值按 0（门禁不误触发）', () => {
    expect(parseConversationMessageCount('not-json')).toBe(0);
    expect(parseConversationMessageCount(null)).toBe(0);
    expect(parseConversationMessageCount('{"a":1}')).toBe(0);
  });
});
