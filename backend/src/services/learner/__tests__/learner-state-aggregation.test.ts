/**
 * 学习者级（全局）状态 = **PMC 日负荷模型**（2026-10-15 改造）
 *
 * 背景：旧口径是「各路径最新取 max + 外挂当日课量疲劳加成」，两个毛病：
 *   (a) max 聚合让"任一路径的单课峰值"污染全局；
 *   (b) 当日课量是事后外挂常数，与 KTL/LF 的演进脱钩。
 * PMC 口径：**负荷就是负荷、与路径无关**，KTL/LF/LSB 由「逐日负荷之和 + 按天 EWMA」派生，
 * 同日多课已由日负荷求和自然进入 KTL/LF —— 不再需要 max，也不再需要外挂加成。
 */
import prisma from '../../../config/database';
import learningStateService, { computeDayLoadFatigueBonus } from '../../learning/learning-state.service';
import { derivePacing, deriveLearningControlState, deriveReplanSignal } from '../LearnerSnapshotService';
import { replayDailyPmc } from '../../learning/learning-load-pmc.service';

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    subtasks: { count: jest.fn() },
    teaching_sessions: { aggregate: jest.fn() },
    learning_metrics: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    users: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

// computeDayLoadFatigueBonus 已不再进入聚合 lf（PMC 把同日负荷求和进 KTL/LF）——保留为历史函数，
// 供"原始课量观测"与其他脚本使用；这里只验证它自身仍成立（未删除）。
describe('computeDayLoadFatigueBonus（当日课量 → 疲劳加成，历史函数）', () => {
  it('第 1 节课不额外加成', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 1, minutes: 60 })).toBe(0);
  });

  it('多一节课 +0.5，且有上限', () => {
    expect(computeDayLoadFatigueBonus({ lessons: 3, minutes: 0 })).toBe(1);
    expect(computeDayLoadFatigueBonus({ lessons: 100, minutes: 0 })).toBe(2);
  });
});

describe('PMC 逐日重放（同日多课累加 + 空闲日回落）', () => {
  it('同一天多节课 → 日负荷求和 → KTL/LF 高于单课', () => {
    const one = replayDailyPmc([
      { calculatedAt: new Date('2026-09-16T01:00:00Z'), lss: 5, ktl: 0, lf: 0 },
    ]);
    const three = replayDailyPmc([
      { calculatedAt: new Date('2026-09-16T01:00:00Z'), lss: 5, ktl: 0, lf: 0 },
      { calculatedAt: new Date('2026-09-16T02:00:00Z'), lss: 5, ktl: 0, lf: 0 },
      { calculatedAt: new Date('2026-09-16T03:00:00Z'), lss: 5, ktl: 0, lf: 0 },
    ]);
    expect(three.latest!.lf).toBeGreaterThan(one.latest!.lf);
    expect(three.latest!.ktl).toBeGreaterThan(one.latest!.ktl);
  });
});

describe('getAggregatedState（PMC 日负荷模型）', () => {
  const snapshot = (pathId: string, iso: string, lss: number, ktl: number, lf: number) => ({
    pathId,
    metrics: { lss, ktl, lf, lsb: ktl - lf, timestamp: new Date(iso) },
    calculatedAt: new Date(iso),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('全局 = 跨路径 PMC（同日多课求和），perPath 给各路径分解，dayLoad 只作观测不再加成', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([
      snapshot('lp-A', '2026-09-16T01:00:00Z', 2, 2, 2),
      snapshot('lp-B', '2026-09-16T02:00:00Z', 4, 4, 4),
    ]);
    // 同日两节课（lp-A + lp-B）→ 日负荷求和；findMany 按 where.pathId 分流
    (prisma.learning_metrics.findMany as jest.Mock).mockImplementation(({ where }: any) => {
      const rows = [
        { lss: 2, ktl: 1, lf: 1, calculatedAt: new Date('2026-09-16T01:00:00Z'), metadata: '{"committed":true}', pathId: 'lp-A' },
        { lss: 4, ktl: 2, lf: 2, calculatedAt: new Date('2026-09-16T02:00:00Z'), metadata: '{"committed":true}', pathId: 'lp-B' },
      ];
      if (where?.pathId) return Promise.resolve(rows.filter((r) => r.pathId === where.pathId));
      return Promise.resolve(rows);
    });
    (prisma.subtasks.count as jest.Mock).mockResolvedValue(2);
    (prisma.teaching_sessions.aggregate as jest.Mock).mockResolvedValue({ _sum: { duration: 100 } });

    const aggregated = await learningStateService.getAggregatedState('u1', {
      asOf: new Date('2026-09-16T04:00:00Z'),
    });

    expect(aggregated).not.toBeNull();
    // perPath 给两条路径的 PMC 分解
    expect(aggregated!.perPath.map((entry) => entry.pathId).sort()).toEqual(['lp-A', 'lp-B']);
    // 全局 = 跨路径逐日负荷（2+4=6）→ 高于任一单条路径；不再是 max 聚合（max 会等于 lp-B）
    const globalKtl = aggregated!.metrics.ktl;
    const pathBKtl = aggregated!.perPath.find((e) => e.pathId === 'lp-B')!.metrics.ktl;
    expect(globalKtl).toBeGreaterThan(pathBKtl);
    // 冷启动按 PMC 从 0 生长：1 天负荷 6 → ktl=0.05×6=0.3、lf=0.30×6=1.8
    expect(globalKtl).toBeCloseTo(0.3, 6);
    expect(aggregated!.metrics.lf).toBeCloseTo(1.8, 6);
    // dayLoad 保留原始观测，但 fatigueBonus 归零（PMC 已把同日课量求和进 KTL/LF，不重复加成）
    expect(aggregated!.dayLoad).toEqual({ lessons: 2, minutes: 100, fatigueBonus: 0 });
    // lsb = ktl − lf（form）
    expect(aggregated!.metrics.lsb).toBeCloseTo(globalKtl - aggregated!.metrics.lf, 6);
  });

  it('没有状态行 → null（调用方自行回退）', async () => {
    jest.spyOn(learningStateService as any, 'listCommittedSnapshots').mockResolvedValue([]);
    (prisma.learning_metrics.findMany as jest.Mock).mockResolvedValue([]);
    expect(await learningStateService.getAggregatedState('u1')).toBeNull();
  });
});

describe('getCurrentState 支持 asOf（PMC 读侧：行过滤按 asOf）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asOf = 该行时刻 → 只读该时刻之前的行；晚于该时刻的行被过滤', async () => {
    const at = new Date('2026-07-01T09:00:00Z');
    const findSpy = (prisma.learning_metrics.findMany as jest.Mock).mockImplementation(({ where }: any) => {
      const rows = [
        { lss: 5, ktl: 1, lf: 1, calculatedAt: new Date('2026-07-01T09:00:00Z'), metadata: '{"committed":true}' },
        { lss: 9, ktl: 9, lf: 9, calculatedAt: new Date('2026-07-05T09:00:00Z'), metadata: '{"committed":true}' },
      ];
      const cutoff = where?.calculatedAt?.lte;
      return Promise.resolve(cutoff ? rows.filter((r) => r.calculatedAt <= cutoff) : rows);
    });

    const atThatTime = await learningStateService.getCurrentState('u1', { pathId: 'lp-A', asOf: at });
    // 只有第一行（lss=5）参与 → PMC 的 ktl/lf 由单课负荷推出；晚于 asOf 的 9 不参与
    expect(atThatTime!.lss).toBeCloseTo(5, 6);
    expect(atThatTime!.ktl).toBeLessThan(5); // 单课 lss=5 → ktl = 0.05×5 = 0.25
    expect(findSpy).toHaveBeenCalled();
  });
});

describe('deriveReplanSignal（层级对齐：加速资格不看"任一路径最近一课最难"）', () => {
  const knowledgeMemory = {
    globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: ['概念A', '概念B'] },
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

describe('derivePacing（相对量判据：ACWR 甜区不减速，超载才减速）', () => {
  it('明显欠载（acwr≤0.6）→ fast；明显超载（acwr≥1.5）→ slow；甜区 → moderate', () => {
    expect(derivePacing(2, 5)).toBe('fast');     // acwr=0.4 ≤ 0.6
    expect(derivePacing(9, 5)).toBe('slow');     // acwr=1.8 ≥ 1.5（真超载）
    expect(derivePacing(5, 5)).toBe('moderate'); // acwr=1.0 甜区，不减速
    expect(derivePacing(3, 4)).toBe('moderate'); // acwr=0.75
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

  // 2026-09-29 修正：原先这里用 `currentPath: undefined` + `blockedFoundations: ['b1']` 触发 high。
  // 但 blockedFoundations 由 `stability==='fragile'` 的概念聚合而来，与 globalSignals.fragileConcepts
  // 同源，拿它当结构性风险等于让 highRisk 恒真——全库实测 242 条带 advisory 的会话 242 条
  // shouldSuggest=true / priority=high / recommendation=resequence / 同一条 rationale。
  // 「不误杀」的本意保留，换成两条真·依据：学习者级疲劳/失衡、一跳前置缺口。
  it('无 currentPath 但学习者级疲劳/失衡 → 仍报 high（不因缺进度信息而漏报）', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn({ metrics: { lss: 4, ktl: 6, lf: 7, lsb: -1 } }),
      learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km({ currentPath: undefined }),
    });
    expect(signal.shouldSuggest).toBe(true);
    expect(signal.priority).toBe('high');
  });

  it('F3：只有脆弱点（无结构性证据）→ 不虚报 high，也不再凭 reviewPriority 派生发 medium（发补强需卡点达量/趋势下滑）', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(),
      learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km({ currentPath: { prerequisiteGaps: [], progress: { totalTasks: 18, completedTasks: 2 } } }),
    });
    // reviewPriority='high' 是 fragile>0 的派生（饱和通道），不再是 medium 的触发源：
    // 单处卡点 + fragile 常态 → keep（观测 reasonCodes 保留）
    expect(signal.shouldSuggest).toBe(false);
    expect(signal.priority).not.toBe('high');
    expect(signal.reasonCodes).toContain('fragile_concepts');
  });

  it('无 currentPath + 一跳前置缺口（真结构性风险）→ high/resequence', () => {
    const signal = deriveReplanSignal({
      dynamicState: dyn(),
      learningControlState: { paceMode: 'steady', reviewPriority: 'high' } as any,
      knowledgeMemory: km({
        currentPath: { prerequisiteGaps: [{ severity: 'high' }], progress: { totalTasks: 18, completedTasks: 2 } },
      }),
    });
    expect(signal.priority).toBe('high');
    expect(signal.recommendation).toBe('resequence');
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

describe('deriveLearningControlState · 严重度判据（#59/#60 第 5 条）', () => {
  const dyn = (overrides: Partial<any> = {}) => ({
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
  const memory = (signals: Record<string, unknown>) => ({
    globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [], severeStrugglingConcepts: [], ...signals },
    globalBackground: { blockedFoundations: [] },
    currentPath: { prerequisiteGaps: [] },
  }) as any;

  it('只有 fragile（非高危）→ reviewPriority 不升到 high、checkpointNeed 不升到 high', () => {
    const control = deriveLearningControlState({
      dynamicState: dyn() as any,
      knowledgeMemory: memory({ fragileConcepts: ['刚学一半的概念'] }) as any,
    });
    expect(control.reviewPriority).toBe('low');
    expect(control.checkpointNeed).toBe('medium');
  });

  it('高危卡点（severeStruggling>0）→ reviewPriority/checkpointNeed 都 high', () => {
    const control = deriveLearningControlState({
      dynamicState: dyn() as any,
      knowledgeMemory: memory({ severeStrugglingConcepts: ['真没学会'] }) as any,
    });
    expect(control.reviewPriority).toBe('high');
    expect(control.checkpointNeed).toBe('high');
  });

  it('普通卡点（struggling=1）→ reviewPriority medium，不误报 high', () => {
    const control = deriveLearningControlState({
      dynamicState: dyn() as any,
      knowledgeMemory: memory({ strugglingConcepts: ['一节课没跟上'] }) as any,
    });
    expect(control.reviewPriority).toBe('medium');
  });
});
