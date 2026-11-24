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

  /**
   * 2026-10-17：校内锚（教材册次 / 考试范围 / 学校进度）。
   * 定帧层早已产出 `schoolAnchor`（path-planning-hints:1036），但本投影是逐字段白名单重建，
   * 白名单里没有它 ⇒ path-planning 规则 37/47 静默拿不到数据（阶段设计层却能拿到）。
   */
  it('schoolAnchor 透传三个子键；缺失/空对象不出现该键', () => {
    const withAnchor = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({
        ...base,
        schoolAnchor: { textbook: '人教A版必修一', examScope: '期中：集合与函数', schoolPace: '已讲到单调性' },
      }),
    );
    expect(withAnchor.normalizedInput.schoolAnchor).toEqual({
      textbook: '人教A版必修一',
      examScope: '期中：集合与函数',
      schoolPace: '已讲到单调性',
    });

    const without = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base }));
    expect(Object.prototype.hasOwnProperty.call(without.normalizedInput, 'schoolAnchor')).toBe(false);

    const empty = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base, schoolAnchor: null }));
    expect(Object.prototype.hasOwnProperty.call(empty.normalizedInput, 'schoolAnchor')).toBe(false);
  });

  it('entryState / intentType 透传；缺失不出现键', () => {
    const built = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({
        ...base,
        learnerProfile: { surfaceGoal: '想系统了解王阳明心学', entryState: 'exploratory', intentType: 'interest' },
      }),
    );
    expect(built.normalizedInput.learnerProfile).toMatchObject({
      entryState: 'exploratory',
      intentType: 'interest',
    });

    const without = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base }));
    const profile = without.normalizedInput.learnerProfile as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(profile, 'entryState')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(profile, 'intentType')).toBe(false);
  });

  it('pathTopologyHint 透传；非法值不出现键', () => {
    // 2026-11-19 审计：定帧层写在 normalizedInput 顶层，投影白名单漏字段 ⇒
    // 规则「pathTopologyHint 存在时必须采纳」永远读不到 exam/exploratory 强信号。
    const exam = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base, pathTopologyHint: 'exam' }));
    expect(exam.normalizedInput.pathTopologyHint).toBe('exam');

    const exploratory = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base, pathTopologyHint: 'exploratory' }));
    expect(exploratory.normalizedInput.pathTopologyHint).toBe('exploratory');

    const invalid = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base, pathTopologyHint: 'builder' }));
    expect(Object.prototype.hasOwnProperty.call(invalid.normalizedInput, 'pathTopologyHint')).toBe(false);
  });

  it('clarification 必须真正进入提示词（rationale 的唯一引用来源）', () => {
    // 2026-11-24：投影白名单漏 clarification，模型被要求引用一份看不到的契约 ⇒
    // rationale 审计连续失败（Case 2 实测）。
    const built = asPromptFriendly(
      buildPromptFriendlyNormalizedInput({
        ...base,
        clarification: {
          core: { question: '诊断与讲解调节怎么串成一条链', evidence: ['想把诊断弄懂'] },
          baseline: { known: ['基础一般'], unknown: [], misconceptions: [], evidence: ['自评基础一般'] },
          stopping: {
            kind: 'do',
            scope: 'instance',
            evidence: 'platform',
            statement: '能对一条真实交互记录说出卡点来源并给出讲解改法',
          },
          constraints: { timePerSessionMin: 30 },
          assumptions: [],
          blockingNeed: 'none',
          unknowns: [],
        },
      }),
    );

    const clarification = built.normalizedInput.clarification as any;
    expect(clarification?.stopping?.statement).toBe('能对一条真实交互记录说出卡点来源并给出讲解改法');
    expect(clarification?.constraints?.timePerSessionMin).toBe(30);
    expect(clarification?.core?.evidence).toEqual(['想把诊断弄懂']);

    const without = asPromptFriendly(buildPromptFriendlyNormalizedInput({ ...base }));
    expect(Object.prototype.hasOwnProperty.call(without.normalizedInput, 'clarification')).toBe(false);
  });
});
