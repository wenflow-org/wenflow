/**
 * 学习者级（全局）状态 = 按路径保守聚合 + 当日课量疲劳加成
 *
 * 背景（"单课判断 vs 总学习负担"）：此前全局状态 = **最近一条状态行**，即"最后写的那条路径"，
 * 于是 (a) 一节难课会被当成"这周很累"，(b) 全局值随哪条路径最后写而跳变。
 * 现口径：
 *   - 全局管"总负担/节奏"：各路径最新状态取 max（保守）+ 当日课量疲劳加成；
 *   - 单课难易管"课内"：LSS 不再决定全局节奏，只影响课内控制状态。
 */
import prisma from '../../../config/database';
import learningStateService, { computeDayLoadFatigueBonus } from '../../learning/learning-state.service';
import { derivePacing, deriveLearningControlState, deriveReplanSignal } from '../LearnerSnapshotService';

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    subtasks: { count: jest.fn() },
    teaching_sessions: { aggregate: jest.fn() },
    learning_metrics: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    users: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

describe('computeDayLoadFatigueBonus（当日课量 → 疲劳加成）', () => {
  it('第 1 节课不额外加成', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 1, minutes: 60 })).toBe(0);
  });

  it('多一节课 +0.5，且有上限', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 3, minutes: 0 })).toBe(1);
    expect(computeDayLoadFatigueBonus({ lessons: 100, minutes: 0 })).toBe(2);
  });

  it('时长超过 90 分钟后每 30 分钟 +0.25，且有上限', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 0, minutes: 120 })).toBe(0.25);
    expect(computeDayLoadFatigueBonus({ lessons: 0, minutes: 1000 })).toBe(1.5);
  });

  it('课时与时长叠加', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 3, minutes: 150 })).toBe(1.5);
  });

  it('负值/缺省不产生负加成', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 0, minutes: 0 })).toBe(0);
  });
});

describe('getAggregatedState（按路径 max 聚合 + 当日课量）', () => {
  const snapshot = (pathId: string, iso: string, lss: number, ktl: number, lf: number) => ({
    pathId,
    metrics: { lss, ktl, lf, lsb: ktl - lf, timestamp: new Date(iso) },
    calculatedAt: new Date(iso),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('每条路径取最新，再对负荷取 max；疲劳叠加当日课量加成', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([
      snapshot('lp-A', '2026-09-16T01:00:00Z', 1, 2, 1),
      snapshot('lp-B', '2026-09-16T02:00:00Z', 8, 3, 2),   // lss 高（单课压力），不该决定全局节奏
      snapshot('lp-A', '2026-09-16T03:00:00Z', 2, 6, 4),   // lp-A 的最新：覆盖 01:00 那条
    ]);
    (prisma.subtasks.count as jest.Mock).mockResolvedValue(3);          // 今天 3 节课
    (prisma.teaching_sessions.aggregate as jest.Mock).mockResolvedValue({ _sum: { duration: 150 } });

    const aggregated = await learningStateService.getAggregatedState('u1', {
      asOf: new Date('2026-09-16T04:00:00Z'),
    });

    expect(aggregated).not.toBeNull();
    // 每条路径只保留最新一行
    expect(aggregated!.perPath.map((entry) => entry.pathId).sort()).toEqual(['lp-A', 'lp-B']);
    expect(aggregated!.perPath.find((entry) => entry.pathId === 'lp-A')!.metrics.ktl).toBe(6);
    // 保守聚合：负荷取各路径最大值
    expect(aggregated!.metrics.ktl).toBe(6);
    expect(aggregated!.metrics.lss).toBe(8);
    // 疲劳 = max(lf) + 当日课量加成(3 节→1.0, 150 分钟→0.5)
    expect(aggregated!.dayLoad).toEqual({ lessons: 3, minutes: 150, fatigueBonus: 1.5 });
    expect(aggregated!.metrics.lf).toBe(5.5);
    expect(aggregated!.metrics.lsb).toBe(0.5);
  });

  it('疲劳加成不会把 lf 顶过 10', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([
      snapshot('lp-A', '2026-09-16T03:00:00Z', 2, 6, 9.5),
    ]);
    (prisma.subtasks.count as jest.Mock).mockResolvedValue(10);
    (prisma.teaching_sessions.aggregate as jest.Mock).mockResolvedValue({ _sum: { duration: 0 } });

    // 必须锚定 asOf：不传就会用真实墙钟，而快照时间戳是固定的 → 每过一天这条会被自然衰减掉
    // （2026-09-17 实测：ld 衰减后 9.5→7.342，+2.0 加成 = 9.342，断言假失败）
    const aggregated = await learningStateService.getAggregatedState('u1', {
      asOf: new Date('2026-09-16T04:00:00Z'),
    });
    expect(aggregated!.metrics.lf).toBe(10);
  });

  it('超过活跃窗口的路径不参与投票（陈年峰值不污染"当前总负担"）', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([
      snapshot('lp-stale', '2026-07-20T14:02:00Z', 9, 9, 9),   // 两个月没动：峰值不该算进今天
      snapshot('lp-active', '2026-09-16T03:00:00Z', 2, 3, 1),
    ]);
    (prisma.subtasks.count as jest.Mock).mockResolvedValue(1);
    (prisma.teaching_sessions.aggregate as jest.Mock).mockResolvedValue({ _sum: { duration: 30 } });

    const aggregated = await learningStateService.getAggregatedState('u1', {
      asOf: new Date('2026-09-16T04:00:00Z'),
    });
    expect(aggregated!.activePathIds).toEqual(['lp-active']);
    expect(aggregated!.metrics.ktl).toBe(3);
    // perPath 仍完整返回（可观测/可审计），只是不参与投票
    expect(aggregated!.perPath.map((entry) => entry.pathId)).toEqual(['lp-stale', 'lp-active']);
  });

  it('没有状态行 → null（调用方自行回退）', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([]);
    expect(await learningStateService.getAggregatedState('u1')).toBeNull();
  });
});

describe('getCurrentState 支持 asOf（历史重放：行过滤与自然衰减都按 asOf，而不是"现在"）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asOf = 该行时间 → 不衰减；缺省 asOf → 按"现在"衰减', async () => {
    const at = new Date('2026-07-01T09:00:00Z');
    const listSpy = jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([
      { metrics: { lss: 5, ktl: 4, lf: 3, lsb: 1, timestamp: at }, calculatedAt: at, pathId: 'lp-A' },
    ]);

    const atThatTime = await learningStateService.getCurrentState('u1', { pathId: 'lp-A', asOf: at });
    expect(atThatTime!.lss).toBeCloseTo(5, 6);
    expect(listSpy).toHaveBeenCalledWith('u1', undefined, undefined, at, 'lp-A');

    const atNow = await learningStateService.getCurrentState('u1', { pathId: 'lp-A' });
    // 行是过去的：按"现在"折算会明显衰减（LSS 日因子 0.82）
    expect(atNow!.lss).toBeLessThan(5);
    expect(listSpy).toHaveBeenLastCalledWith('u1', undefined, undefined, undefined, 'lp-A');
  });
});

describe('deriveReplanSignal（层级对齐：加速资格不看"任一路径最近一课最难"）', () => {
  const knowledgeMemory = {
    globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
    globalBackground: { blockedFoundations: [] },
  } as any;

  it('全局 lss 很高（别的路径的难课）但本路径不在 recover → 仍可判"可以加速"', () => {
    const signal = deriveReplanSignal({
      dynamicState: {
        metrics: { lss: 9, ktl: 7, lf: 2, lsb: 5 },   // 全局 lss 9 来自"任一路径最近一课最难"
        recentTrend: 'stable', fatigueRisk: 'low',
      } as any,
      learningControlState: { paceMode: 'push' } as any,
      knowledgeMemory,
    });
    expect(signal.recommendation).toBe('accelerate');
  });

  it('本路径处于 recover（路径级证据）→ 不再判"可以加速"', () => {
    const signal = deriveReplanSignal({
      dynamicState: {
        metrics: { lss: 2, ktl: 7, lf: 2, lsb: 5 },
        recentTrend: 'stable', fatigueRisk: 'low',
      } as any,
      learningControlState: { paceMode: 'recover' } as any,
      knowledgeMemory,
    });
    expect(signal.recommendation).not.toBe('accelerate');
  });

  it('总负荷失衡（全局 lsb<0）的消费去处：重排信号给 lsb_negative（而节奏不重复消费）', () => {
    const signal = deriveReplanSignal({
      dynamicState: {
        metrics: { lss: 2, ktl: 4, lf: 5, lsb: -1 },
        recentTrend: 'stable', fatigueRisk: 'medium',
      } as any,
      learningControlState: { paceMode: 'steady', reviewPriority: 'medium' } as any,
      knowledgeMemory,
    });
    expect(signal.reasonCodes).toContain('lsb_negative');
    expect(derivePacing(5, 4)).toBe('moderate'); // 节奏只看累积负荷/疲劳，不重复消费失衡
  });
});

describe('derivePacing（全局节奏只看总负担，不再由单课 LSS 决定）', () => {  it('LSS 已不在入参里：高 ktl + 低疲劳 → fast，疲劳高 → slow', () => {
    expect(derivePacing(2, 5)).toBe('fast');
    expect(derivePacing(6, 5)).toBe('slow');
    expect(derivePacing(3, 4)).toBe('moderate');
  });
});

describe('deriveReplanSignal · 完成度归一（I-11：已完成路径不再报"建议重排后续"）', () => {
  const km = (over: Record<string, unknown> = {}) => ({
    globalSignals: { fragileConcepts: ['c1'], strugglingConcepts: ['c2'], masteredConcepts: [] },
    globalBackground: { blockedFoundations: ['b1'] },
    currentPath: { prerequisiteGaps: [{ severity: 'high' }], progress: { totalTasks: 18, completedTasks: 18 } },
    ...over,
  }) as any;
  const dyn = (over: Record<string, unknown> = {}) => ({
    metrics: { lss: 4, ktl: 6, lf: 5, lsb: 1 },
    recentTrend: 'stable', fatigueRisk: 'medium',
    ...over,
  }) as any;

  it('路径全部完成（18/18）+ 存在脆弱/阻塞信号 → 不再报 high/resequence', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(), learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km(),
    });
    expect(signal.shouldSuggest).toBe(false);
    expect(signal.priority).toBe('none');
    expect(signal.reasonCodes).toContain('path_completed'); // 保留观测
  });

  it('路径未完成（10/18）+ 结构性风险（前置缺口）→ 仍报 high/resequence（正当重排）', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(),
      learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km({ currentPath: { prerequisiteGaps: [{ severity: 'high' }], progress: { totalTasks: 18, completedTasks: 10 } } }),
    });
    expect(signal.shouldSuggest).toBe(true);
    expect(signal.priority).toBe('high');
    expect(signal.recommendation).toBe('resequence');
  });

  it('接近完成（17/18）且无结构性风险 → 不再报 high（不打断收尾）', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(),
      learningControlState: { paceMode: 'steady', reviewPriority: 'medium' } as any,
      knowledgeMemory: km({
        globalBackground: { blockedFoundations: [] },
        globalSignals: { fragileConcepts: ['c1'], strugglingConcepts: [], masteredConcepts: [] },
        currentPath: { prerequisiteGaps: [], progress: { totalTasks: 18, completedTasks: 17 } },
      }),
    });
    expect(signal.priority).toBe('none');
    expect(signal.shouldSuggest).toBe(false);
  });

  it('无 currentPath（无进度信息）时保持原行为：结构性风险仍报 high（不误杀）', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(),
      learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km({ currentPath: undefined }),
    });
    expect(signal.shouldSuggest).toBe(true);
    expect(signal.priority).toBe('high');
  });
});

describe('deriveLearningControlState（单课压力起作用的地方 = 课内）', () => {
  const dynamicState = (overrides: Partial<any> = {}) => ({
    metrics: { lss: 2, ktl: 3, lf: 1, lsb: 2 },
    recentTrend: 'stable',
    fatigueRisk: 'low',
    confidenceTrend: 'stable',
    recentSessionQuality: 'mixed',
    recommendedPacing: 'moderate',
    recommendedInteraction: { hintTiming: 'delayed', encouragement: 'medium', challenge: 'medium' },
    srlPhase: 'performance',
    ...overrides,
  });
  const knowledgeMemory = (overrides: Partial<any> = {}) => ({
    globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
    globalBackground: { blockedFoundations: [] },
    ...overrides,
  }) as any;

  it('本节课所在路径压力大（lss≥6）→ 课内降档，但不影响全局节奏', () => {
    const control = deriveLearningControlState({
      dynamicState: dynamicState() as any,
      knowledgeMemory: knowledgeMemory(),
      lessonMetrics: { lss: 7, ktl: 3, lf: 1, lsb: 2 },
    });
    expect(control.paceMode).toBe('recover');
    expect(control.challengeLevelCap).toBe('low');
    expect(control.conceptLoad).toBe('low');
  });

  it('课内状态正常时用课内基线判断（不被别的路径的高负荷拖降档）', () => {
    const control = deriveLearningControlState({
      dynamicState: dynamicState({ metrics: { lss: 7, ktl: 6, lf: 7, lsb: -1 } }) as any,
      knowledgeMemory: knowledgeMemory(),
      lessonMetrics: { lss: 2, ktl: 4, lf: 2, lsb: 2 },
    });
    expect(control.paceMode).toBe('steady');
    expect(control.conceptLoad).toBe('medium');
  });

  it('全局疲劳高时仍然建议休息（疲劳是学习者级信号，不能被路径级掩盖）', () => {
    const control = deriveLearningControlState({
      dynamicState: dynamicState({ metrics: { lss: 2, ktl: 3, lf: 7, lsb: -4 }, fatigueRisk: 'high' }) as any,
      knowledgeMemory: knowledgeMemory(),
      lessonMetrics: { lss: 2, ktl: 4, lf: 1, lsb: 3 },
    });
    expect(control.shouldOfferBreak).toBe(true);
  });

  it('无课内状态（本路径还没历史）→ 不借用别的路径的单课压力降档；疲劳信号仍生效', () => {
    const stressOnly = deriveLearningControlState({
      dynamicState: dynamicState({ metrics: { lss: 7, ktl: 3, lf: 1, lsb: 2 } }) as any,
      knowledgeMemory: knowledgeMemory(),
    });
    // LSS 是会话级量：没有"本路径"上下文时不能拿全局（可能是别的路径的难课）来降档
    expect(stressOnly.paceMode).toBe('steady');

    const fatigued = deriveLearningControlState({
      dynamicState: dynamicState({ metrics: { lss: 7, ktl: 3, lf: 7, lsb: -4 }, fatigueRisk: 'high' }) as any,
      knowledgeMemory: knowledgeMemory(),
    });
    expect(fatigued.paceMode).toBe('recover'); // 疲劳是学习者级信号，不受路径上下文限制
  });
});
