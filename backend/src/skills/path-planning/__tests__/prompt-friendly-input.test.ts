import { buildPromptFriendlyNormalizedInput } from '../index';

/**
 * 回归（审计 §3.19 P0①）：`learnerLearningContext` 由 learning.service 在新建路径时赋值，
 * 但本 skill 的输入构造函数此前不包含它 → 规则 53「按已学证据校准首版难度」永不生效。
 * 这里把"必须真正进入提示词"钉住。
 */
type PromptFriendly = { normalizedInput: Record<string, unknown> };
type LearningContextShape = {
  hasLearningHistory: boolean;
  masteredConcepts: string[];
  fragileConcepts: string[];
  blockedFoundations: string[];
  recurringConfusions: Array<{ concept: string; note: string; count: number }>;
  conceptLedgerSize: number;
  challengeLevelCap: string;
  paceMode: string;
};

const asPromptFriendly = (value: unknown) => value as PromptFriendly;

describe('path-planning 输入构造：学习证据必须真正进入提示词', () => {
  const base = {
    version: '1.0',
    learnerProfile: { surfaceGoal: 'g' },
    problemSpace: {},
    resources: {},
    successCriteria: {},
    confirmedProposal: null,
    planningHints: null,
  };

  it('提供 learnerLearningContext → 收敛形状 + 上限，并出现在 normalizedInput 下', () => {
    const built = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({
        ...base,
        learnerLearningContext: {
          hasLearningHistory: true,
          masteredConcepts: Array.from({ length: 12 }, (_, index) => ({ label: `m${index}` })),
          fragileConcepts: [{ conceptKey: 'f1' }, 'f2'],
          strugglingConcepts: [],
          blockedFoundations: [{ label: 'b1' }],
          recurringConfusions: [{ concept: 'c1', note: 'n1', count: 2 }],
          conceptLedgerSize: 7,
          recommendedPacing: 'slow',
          recentTrend: 'declining',
          fatigueRisk: 'high',
          paceMode: 'recover',
          challengeLevelCap: 'low',
        },
      }),
    );

    const ctx = built.normalizedInput.learnerLearningContext as LearningContextShape;
    expect(ctx).toBeTruthy();
    expect(ctx.hasLearningHistory).toBe(true);
    expect(ctx.masteredConcepts).toHaveLength(8); // 上限保护（避免 token 膨胀）
    expect(ctx.fragileConcepts).toEqual(['f1', 'f2']); // 对象与字符串两种写法都能取到标签
    expect(ctx.blockedFoundations).toEqual(['b1']);
    expect(ctx.recurringConfusions).toEqual([{ concept: 'c1', note: 'n1', count: 2 }]);
    expect(ctx.conceptLedgerSize).toBe(7);
    expect(ctx.challengeLevelCap).toBe('low');
    expect(ctx.paceMode).toBe('recover');
  });

  it('无该字段（冷启动）→ 不出现该键，行为与原先完全一致', () => {
    const built = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base }));
    expect(Object.prototype.hasOwnProperty.call(built.normalizedInput, 'learnerLearningContext')).toBe(false);
    // 空值同样视为"无学习历史"（不注入）
    const built2 = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({ ...base, learnerLearningContext: null }),
    );
    expect(Object.prototype.hasOwnProperty.call(built2.normalizedInput, 'learnerLearningContext')).toBe(false);
  });

  /**
   * 审计 P1 §2.2c：本投影是逐字段白名单重建，`understanding` 被静默丢弃；
   * 而 core 规则要求消费 `normalizedInput.understanding.adjustments`（用户补充说明）⇒ 功能不可达。
   */
  it('understanding.adjustments 透传（只这一个键）；缺失/空值不出现该键', () => {
    const withAdjustments = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({
        ...base,
        understanding: { adjustments: '第二阶段太难了，想先补基础', realProblem: '不应透传的其他键' },
      }),
    );
    expect(withAdjustments.normalizedInput.understanding).toEqual({ adjustments: '第二阶段太难了，想先补基础' });

    const without = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base }));
    expect(Object.prototype.hasOwnProperty.call(without.normalizedInput, 'understanding')).toBe(false);

    const blank = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({ ...base, understanding: { adjustments: '   ' } }),
    );
    expect(Object.prototype.hasOwnProperty.call(blank.normalizedInput, 'understanding')).toBe(false);
  });
});
