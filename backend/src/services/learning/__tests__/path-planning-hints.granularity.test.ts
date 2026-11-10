/**
 * 课题颗粒度硬上界（2026-11-09 外评建议二，结构手术第 3 刀）。
 * 锁三类事实：①前缀解析（[单点概念]/[技能模块]/[完整学科]，无前缀=行为不变）；
 * ②single_concept 的总学时/阶段/课数/分钟上界被钳（9.2h→≤1.2h 实证回归）；
 * ③只钳上界不抬下限，里程碑区间保持非单点且不越帽。
 */
import { applyGranularityBoundsToHints, buildFramedNormalizedInput, derivePlanningHints, parseTopicGranularity, derivePlannedOutline } from '../path-planning-hints';
import type { PlanningHints } from '../path-planning-hints';

describe('parseTopicGranularity', () => {
  it('识别三种前缀标签（容忍括号与空白）', () => {
    expect(parseTopicGranularity('[单点概念] 只涉及一个判别动作')).toBe('single_concept');
    expect(parseTopicGranularity('【技能模块】资产减值一章')).toBe('skill_module');
    expect(parseTopicGranularity('完整学科：中级会计实务全科')).toBe('full_subject');
    expect(parseTopicGranularity(' 单点概念测试')).toBe('single_concept');
  });

  it('无前缀/非字符串 → null（行为与引入前完全一致）', () => {
    expect(parseTopicGranularity('中等偏小：核心是记账习惯')).toBeNull();
    expect(parseTopicGranularity('small')).toBeNull();
    expect(parseTopicGranularity(null)).toBeNull();
    expect(parseTopicGranularity(undefined)).toBeNull();
  });
});

describe('derivePlanningHints × topic_granularity 硬上界', () => {
  it('single_concept：总学时锚被钳进 ≤1.2h，分钟钳 ≤25，阶段/课数上界收口', () => {
    const hints = derivePlanningHints(
      '考研复习中', null, null, null,
      ['判别标准建立', '混合分子连续判别'],
      { objectiveScopeHours: 9.2, timeModelVersion: 2 },
      '[单点概念] 只涉及一个判别动作，没有前置依赖',
    );
    expect(hints.targetTotalHours).not.toBeNull();
    expect(hints.targetTotalHours!).toBeLessThanOrEqual(1.2);
    expect(hints.subtaskMinutesRange[1]).toBeLessThanOrEqual(25);
    expect(hints.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(hints.milestoneRange[0]).toBeLessThan(hints.milestoneRange[1]); // 非单点
    expect(hints.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    if (hints.targetMilestones !== null) expect(hints.targetMilestones).toBeLessThanOrEqual(2);
  });

  it('skill_module：总学时钳 ≤6h，分钟 ≤35，阶段 ≤3', () => {
    const hints = derivePlanningHints(
      '一个月', null, null, null,
      ['概念建立', '变式练习', '综合实战'],
      { objectiveScopeHours: 14, timeModelVersion: 2 },
      '[技能模块] 一组相互依赖的技能，教材一章',
    );
    expect(hints.targetTotalHours).not.toBeNull();
    expect(hints.targetTotalHours!).toBeLessThanOrEqual(6);
    expect(hints.subtaskMinutesRange[1]).toBeLessThanOrEqual(35);
    expect(hints.milestoneRange[1]).toBeLessThanOrEqual(3);
  });

  it('full_subject / 无前缀：不钳（9.2h 锚原样通过）', () => {
    const open = derivePlanningHints(
      '考研复习中', null, null, null,
      ['判别标准建立', '混合分子连续判别'],
      { objectiveScopeHours: 9.2, timeModelVersion: 2 },
      null,
    );
    expect(open.targetTotalHours).toBe(9.2);
  });

  it('只钳上界不抬下限：锚本身 0.5h 的 single_concept 不被抬到更高', () => {
    const hints = derivePlanningHints(
      null, null, null, null,
      ['判别标准'],
      { objectiveScopeHours: 0.5, timeModelVersion: 2 },
      '[单点概念] 一个判别动作',
    );
    expect(hints.targetTotalHours).toBeLessThanOrEqual(1.2);
    expect(hints.targetTotalHours).toBeGreaterThanOrEqual(0.4);
  });
});

describe('derivePlannedOutline × 颗粒度同源（走查 P7：预览承诺=真实生成）', () => {
  it('[单点概念] + 3 段大纲 → 预览钳到 2 段（与生成同一硬上界）', () => {
    const result = derivePlannedOutline({
      key_stages: ['判断链建立', '连续变式判别', '真题实战校准'],
      scope_size: '[单点概念] 只涉及一个判别动作（共轭类型判定），无前置依赖',
    });
    expect(result.plannedMilestones).toBe(2);
    expect(result.milestoneRange).toEqual([1, 2]);
  });

  it('无前缀的自由文本：预览行为不变', () => {
    const result = derivePlannedOutline({
      key_stages: ['一', '二', '三'],
      scope_size: '中等偏小：核心是记账习惯',
    });
    expect(result.plannedMilestones).toBe(3);
  });
});

describe('applyGranularityBoundsToHints × enrichment 入口防御性再钳（装配缝隙修复）', () => {
  /** 构造一个「前缀链路落地前」的旧 hints：standard 档大区间 + 9.2h 锚 + 6 里程碑目标 */
  const staleHints = (overrides: Partial<PlanningHints> = {}): PlanningHints =>
    ({
      paceSignal: 'standard',
      milestoneRange: [3, 5],
      conceptRange: [3, 6],
      subtasksPerStageRange: [3, 6],
      subtaskMinutesRange: [30, 90],
      maxWeeks: 52,
      maxWeeksSource: 'hard_cap',
      scopeSize: null,
      targetMilestones: 5,
      targetSubtasksPerStage: null,
      targetSubtasksForStage: null,
      targetTotalHours: 9.2,
      targetHoursPerMilestone: 1.8,
      targetMinutesPerTask: 60,
      capacityDeficit: null,
      budgetDerivation: null,
      ...overrides,
    }) as PlanningHints;

  it('旧 hints（standard 档 9.2h/5 里程碑）按 [单点概念] 原文再钳进帽内，派生锚同步重算', () => {
    const next = applyGranularityBoundsToHints(
      staleHints(),
      '[单点概念] 只涉及一个判别动作，没有前置依赖',
    );
    expect(next).not.toBeNull();
    expect(next!.targetTotalHours!).toBeLessThanOrEqual(1.2);
    expect(next!.milestoneRange).toEqual([1, 2]);
    expect(next!.targetMilestones!).toBeLessThanOrEqual(2);
    expect(next!.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    expect(next!.subtaskMinutesRange[1]).toBeLessThanOrEqual(25);
    // 派生锚与 derivePlanningHints 同公式：1.2h/2 里程碑 → 每阶段 0.6h
    expect(next!.targetHoursPerMilestone!).toBeCloseTo(0.6, 5);
  });

  it('skill_module：6h 帽 + 3/3/35 上界', () => {
    const next = applyGranularityBoundsToHints(
      staleHints({ targetTotalHours: 14, subtaskMinutesRange: [30, 90] }),
      '【技能模块】资产减值一章',
    );
    expect(next!.targetTotalHours!).toBeLessThanOrEqual(6);
    expect(next!.milestoneRange).toEqual([2, 3]);
    expect(next!.subtaskMinutesRange[1]).toBeLessThanOrEqual(35);
  });

  it('无前缀原文 / full_subject：原对象原样返回（引用相等，enrichment 不触发日志）', () => {
    const h1 = staleHints();
    expect(applyGranularityBoundsToHints(h1, '中等偏小：核心是记账习惯')).toBe(h1);
    const h2 = staleHints();
    expect(applyGranularityBoundsToHints(h2, '完整学科：中级会计实务全科')).toBe(h2);
    expect(applyGranularityBoundsToHints(h2, null)).toBe(h2);
    expect(applyGranularityBoundsToHints(null, '[单点概念] x')).toBeNull();
  });

  it('钳后装得下 → 过期缺口报告作废；仍装不下 → 以新口径重报', () => {
    const clamped = applyGranularityBoundsToHints(
      staleHints({
        capacityDeficit: {
          requestedHours: 9.2,
          capacityHours: 4.5,
          deficitRatio: 0.511,
          limitingFactor: 'lesson_count',
          bounds: { subtasksPerStage: 3, subtaskMinutes: 90, milestones: 1 },
        },
      } as Partial<PlanningHints>),
      '[单点概念] 一个判别动作',
    );
    // 钳后容量 = 2 课 × 25min × 2 里程碑 = 100min ≈ 1.67h ≥ 1.2h 锚 → 装得下，报告作废
    expect(clamped!.capacityDeficit).toBeNull();

    const stillDeficit = applyGranularityBoundsToHints(
      staleHints({
        targetMilestones: 1,
        milestoneRange: [1, 2],
        capacityDeficit: {
          requestedHours: 9.2,
          capacityHours: 4.5,
          deficitRatio: 0.511,
          limitingFactor: 'lesson_count',
          bounds: { subtasksPerStage: 3, subtaskMinutes: 90, milestones: 1 },
        },
      } as Partial<PlanningHints>),
      '[单点概念] 一个判别动作',
    );
    // 钳后容量 = 2 课 × 25min × 1 里程碑 ≈ 0.83h < 1.2h → 仍缺口，但口径全部换成钳后值
    expect(stillDeficit!.capacityDeficit).not.toBeNull();
    expect(stillDeficit!.capacityDeficit!.requestedHours).toBeLessThanOrEqual(1.2);
    expect(stillDeficit!.capacityDeficit!.bounds.subtaskMinutes).toBeLessThanOrEqual(25);
    expect(stillDeficit!.capacityDeficit!.bounds.milestones).toBe(1);
  });
});

describe('buildFramedNormalizedInput × 双定帧前缀存活（2026-11-09 探针实锤的缝隙）', () => {
  const v1Input = {
    version: '1.0',
    learnerProfile: { surfaceGoal: '考研有机共轭类型看结构即判' },
    problemSpace: { realProblem: '苯乙烯判不出共轭类型' },
    resources: { timePerSession: '1小时' },
    confirmedProposal: {
      learningDirection: '考研有机共轭类型看结构即判',
      firstDeliverable: '10 位点连判 9 对',
      keyStages: ['建立判据起点', '连续变式判断'],
      outOfScope: [],
      scopeSize: '[单点概念] 只涉及一个判别动作，没有前置依赖',
    },
  };

  it('第一次定帧：原文进 scopeSizeRaw，区间被钳进帽', () => {
    const framed1 = buildFramedNormalizedInput(v1Input);
    expect(framed1!.confirmedProposal.scopeSizeRaw).toBe('[单点概念] 只涉及一个判别动作，没有前置依赖');
    expect(framed1!.planningHints.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(framed1!.planningHints.subtaskMinutesRange[1]).toBeLessThanOrEqual(25);
  });

  it('第二次定帧（path-generation.core 对 framed 结果再定帧）：scopeSizeRaw 存活、钳制不丢', () => {
    const framed1 = buildFramedNormalizedInput(v1Input);
    const framed2 = buildFramedNormalizedInput(framed1);
    expect(framed2!.confirmedProposal.scopeSizeRaw).toBe('[单点概念] 只涉及一个判别动作，没有前置依赖');
    expect(framed2!.planningHints.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(framed2!.planningHints.subtaskMinutesRange[1]).toBeLessThanOrEqual(25);
    // 守恒：两次定帧的 hints 关键字段一致（二次定帧是幂等透传，不是重算覆盖）
    expect(framed2!.planningHints.milestoneRange).toEqual(framed1!.planningHints.milestoneRange);
  });

  it('无前缀输入：双定帧后 scopeSizeRaw 键不出现（行为与引入前一致）', () => {
    const plain = {
      ...v1Input,
      confirmedProposal: { ...v1Input.confirmedProposal, scopeSize: '中等偏小：核心是记账习惯' },
    };
    const framed1 = buildFramedNormalizedInput(plain);
    expect(framed1!.confirmedProposal.scopeSizeRaw).toBeUndefined();
    const framed2 = buildFramedNormalizedInput(framed1);
    expect(framed2!.confirmedProposal.scopeSizeRaw).toBeUndefined();
  });
});
