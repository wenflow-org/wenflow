/**
 * 虚拟学习者负荷画像接线：
 *   collectedData.learnerLoadProfile → GoalPathRequest.learnerLoadProfile → planningHints 收紧
 *
 * 覆盖 goal-conversation 的承载读取（纯函数 seam）与 path-planning-hints 的消费端，
 * 证明「默认缺失 = 真实用户零变化」「虚拟学习者写入 = 真正收紧」。
 */
import {
  normalizeLearnerLoadProfile,
  resolveLearnerLoadProfileFromCollectedData,
  CONVERSATION_LOAD_PROFILE_KEY,
} from '../learner-load-profile';
import { derivePlanningHints, type LearnerLoadProfile } from '../path-planning-hints';

/** 与真实链路同口径地调用（timeHorizon=三个月 / scope=medium / 3 个 keyStages）。 */
function computeHints(profile?: LearnerLoadProfile | null) {
  return derivePlanningHints(
    '三个月', null, null, null, ['S1', 'S2', 'S3'], null, 'medium', profile ?? null,
  );
}

describe('normalizeLearnerLoadProfile / resolveLearnerLoadProfileFromCollectedData', () => {
  it('缺失 / 非对象 / 空值 → null（真实用户零变化）', () => {
    expect(resolveLearnerLoadProfileFromCollectedData(undefined)).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData(null)).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData({})).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData({ other: 1 })).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData({ [CONVERSATION_LOAD_PROFILE_KEY]: null })).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData({ [CONVERSATION_LOAD_PROFILE_KEY]: 'minimal' })).toBeNull();
    expect(resolveLearnerLoadProfileFromCollectedData({
      [CONVERSATION_LOAD_PROFILE_KEY]: { availableTime: '   ', loadTolerance: '' },
    })).toBeNull();
  });

  it('会话承载的画像被归一化读回（保留非空字段、trim、其余置 null）', () => {
    expect(resolveLearnerLoadProfileFromCollectedData({
      [CONVERSATION_LOAD_PROFILE_KEY]: {
        availableTime: ' minimal ',
        loadTolerance: '信息一多就容易乱',
        ignored: 'x',
      },
    })).toEqual({ availableTime: 'minimal', loadTolerance: '信息一多就容易乱' });

    // 只有一个字段有效时，另一个补 null（不丢有效信号）
    expect(normalizeLearnerLoadProfile({ availableTime: 'minimal' }))
      .toEqual({ availableTime: 'minimal', loadTolerance: null });
  });

  it('端到端（纯函数口径）：collectedData 画像 → planningHints 收紧', () => {
    const collectedData = {
      messages: [],
      understanding: {},
      // 虚拟学习者创建 Goal 会话时写入的字段
      [CONVERSATION_LOAD_PROFILE_KEY]: {
        availableTime: 'minimal',
        loadTolerance: '信息一多就容易乱，三步以上就放弃',
      },
    };
    const profile = resolveLearnerLoadProfileFromCollectedData(collectedData);
    expect(profile).not.toBeNull();

    const tightened = computeHints(profile);
    expect(tightened.targetMilestones).toBeLessThanOrEqual(2);
    expect(tightened.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(tightened.maxWeeks).toBeLessThanOrEqual(2);
    expect(tightened.subtaskMinutesRange[1]).toBeLessThanOrEqual(45);

    const base = computeHints(null);
    // 收紧严格优于（或等于）未注入画像的基线
    expect(tightened.targetMilestones).toBeLessThanOrEqual(base.targetMilestones as number);
    expect(tightened.maxWeeks).toBeLessThanOrEqual(base.maxWeeks);
    expect(tightened.subtaskMinutesRange[1]).toBeLessThanOrEqual(base.subtaskMinutesRange[1]);
  });

  it('真实用户 collectedData 无该字段 → 与「不传画像」逐字段一致', () => {
    const realUserCollectedData = {
      messages: [{ role: 'user', content: 'hi' }],
      understanding: { surface_goal: '学点东西' },
      collected: { timePerDay: '1 小时' },
      stage: 'proposing',
    };
    const resolved = resolveLearnerLoadProfileFromCollectedData(realUserCollectedData);
    expect(resolved).toBeNull();

    const viaCollected = computeHints(resolved);
    const noProfile = computeHints(undefined);
    expect(viaCollected).toEqual(noProfile);
  });
});
