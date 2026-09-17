import {
  buildReviewPlan,
  computeLoadBudget,
  computeSuccessRate,
  consecutiveFailures,
  consecutiveSuccesses,
  estimateConceptLoad,
  loadRecentOutcomes,
  warmupStatusToGrade,
  BASE_LOAD_BUDGET,
  HIGH_LOAD_BUDGET,
  LOW_LOAD_BUDGET,
  type ReviewPlanDeps,
  type WarmupOutcome,
} from '../review-plan.service';
import { runWithSimulatedClock } from '../../virtual-lab/simulation-clock-context';

const trace = (over: Partial<{ conceptKey: string; label: string | null; masteryScore: number; retention: number; reason: string; extractionCount: number }> = {}) => ({
  conceptKey: 'CAP 定理',
  label: 'CAP 定理',
  masteryScore: 0.8,
  retention: 0.5,
  reason: 'below-threshold',
  extractionCount: 3,
  ...over,
});

const outcome = (conceptKey: string, rating: WarmupOutcome['rating'], daysAgo = 0): WarmupOutcome => ({
  conceptKey,
  rating,
  status: rating === 'again' ? 'review' : 'mastered',
  progress: rating === 'again' ? 20 : 90,
  occurredAt: new Date(Date.now() - daysAgo * 86400000),
});

function buildDeps(over: Partial<ReviewPlanDeps> = {}): ReviewPlanDeps {
  return {
    getDueTraces: jest.fn().mockResolvedValue([]),
    findEvidence: jest.fn().mockResolvedValue([]),
    findSessions: jest.fn().mockResolvedValue([]),
    findPaths: jest.fn().mockResolvedValue([]),
    // 关键路径只读缓存：默认给空 Map（等价于"还没预热"→ 走规则版）
    loadProfiles: jest.fn().mockResolvedValue(new Map()),
    // 当日额度：默认给"额度充足"（每天 6.0），单独测配额的用例再覆盖
    getDailyState: jest.fn().mockResolvedValue({
      date: '2026-09-15', limitLoad: 6, usedLoad: 0, usedCount: 0, remainingLoad: 6, reservedKeys: [],
    }),
    countDueBetween: jest.fn().mockResolvedValue(0),
    ...over,
  };
}

describe('estimateConceptLoad（单个知识点的认知负担）', () => {
  it('原子点（短、单一）负担为 1', () => {
    expect(estimateConceptLoad('CAP 定理')).toEqual({ load: 1, factors: [] });
  });

  it('并列/关系符 = 复合概念 → 1.5', () => {
    const result = estimateConceptLoad('顺推与倒推的区别');
    expect(result.load).toBe(1.5);
    expect(result.factors).toContain('granularity:compound');
  });

  it('超长名字（>24 字）= 技能簇 → 1.5', () => {
    const long = '把关切词转化为领导想拿走什么的句子的完整推理链条判断标准';
    const result = estimateConceptLoad(long);
    expect(result.load).toBe(1.5);
    expect(result.factors).toContain('granularity:long');
  });

  it('过程型（流程/步骤/先…再）→ 1.5', () => {
    expect(estimateConceptLoad('收尾流程')).toMatchObject({ load: 1.5 });
    expect(estimateConceptLoad('收尾流程').factors).toContain('type:process');
  });

  it('生疏（掌握弱）**不再加价**——它本来就是到期的原因，不是额外的负担（语义修复）', () => {
    expect(estimateConceptLoad('CAP 定理', { masteryScore: 0.3 }).load).toBe(1);
    expect(estimateConceptLoad('CAP 定理', { masteryScore: 0.3 }).factors).not.toContain('unfamiliar:mastery');
    expect(estimateConceptLoad('CAP 定理', { masteryScore: 0.85 }).load).toBe(1);
  });

  it('两个原子点正好吃满基准预算（这就是「2.0 ≈ 两个原子点」的可达性）', () => {
    expect(estimateConceptLoad('CAP 定理').load + estimateConceptLoad('幂等性').load).toBe(BASE_LOAD_BUDGET);
  });

  it('多因子连乘有上限（不会一个点吃掉整个预算）', () => {
    const result = estimateConceptLoad('第一步先把书翻到下一页并立好、再离开座位完成收尾流程', {
      masteryScore: 0.2,
    });
    expect(result.load).toBeLessThanOrEqual(3);
    expect(result.factors).toEqual(expect.arrayContaining(['granularity:long', 'type:process']));
  });

  it('空名字回退为 1', () => {
    expect(estimateConceptLoad('')).toEqual({ load: 1, factors: [] });
  });
});

describe('computeLoadBudget（动态预算：由检索成功率校准）', () => {
  it('无样本 → 基准预算', () => {
    expect(computeLoadBudget(null)).toBe(BASE_LOAD_BUDGET);
    expect(computeLoadBudget(undefined)).toBe(BASE_LOAD_BUDGET);
    expect(computeLoadBudget(NaN)).toBe(BASE_LOAD_BUDGET);
  });

  it('成功率偏低（<70%）→ 收缩预算', () => {
    expect(computeLoadBudget(0.5)).toBe(LOW_LOAD_BUDGET);
  });

  it('成功率偏高（>90%）→ 扩张预算', () => {
    expect(computeLoadBudget(0.95)).toBe(HIGH_LOAD_BUDGET);
  });

  it('有益困难区间（70%–90%）→ 基准预算', () => {
    expect(computeLoadBudget(0.7)).toBe(BASE_LOAD_BUDGET);
    expect(computeLoadBudget(0.85)).toBe(BASE_LOAD_BUDGET);
    expect(computeLoadBudget(0.9)).toBe(BASE_LOAD_BUDGET);
  });
});

describe('computeSuccessRate / 连续成功失败统计', () => {
  it('无样本为 null；good/easy 计成功', () => {
    expect(computeSuccessRate([])).toBeNull();
    expect(computeSuccessRate([outcome('a', 'good'), outcome('b', 'again')])).toBe(0.5);
    expect(computeSuccessRate([outcome('a', 'easy'), outcome('b', 'good')])).toBe(1);
  });

  it('连续失败：从最近一次往前数，遇到非 again 即封顶', () => {
    const streaks = consecutiveFailures([
      outcome('a', 'again', 0),
      outcome('a', 'again', 1),
      outcome('b', 'again', 2),
      outcome('a', 'good', 3),
      outcome('a', 'again', 4),
      outcome('b', 'good', 5),
    ]);
    expect(streaks.get('a')).toBe(2);
    expect(streaks.get('b')).toBe(1);
  });

  it('连续成功：同理', () => {
    const streaks = consecutiveSuccesses([
      outcome('a', 'good', 0),
      outcome('a', 'easy', 1),
      outcome('a', 'again', 2),
      outcome('b', 'hard', 3),
    ]);
    expect(streaks.get('a')).toBe(2);
    expect(streaks.has('b')).toBe(false);
  });
});

describe('warmupStatusToGrade（与复习课回写同口径）', () => {
  it('mastered 满进度 → easy；mastered → good；learning → hard；review → again', () => {
    expect(warmupStatusToGrade('mastered', 100).rating).toBe('easy');
    expect(warmupStatusToGrade('mastered', 60).rating).toBe('good');
    expect(warmupStatusToGrade('learning', 50).rating).toBe('hard');
    expect(warmupStatusToGrade('review', 30).rating).toBe('again');
  });
});

describe('loadRecentOutcomes（结果读回）', () => {
  it('解析 payload 并按归一化键聚合；脏数据跳过', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: '离开前翻页立好：靠物理状态生效', rating: 'good' }), occurredAt: new Date('2026-09-10') },
        { payload: 'not-json', occurredAt: new Date('2026-09-10') },
        { payload: JSON.stringify({ conceptKey: 'X', rating: 'unknown' }), occurredAt: new Date('2026-09-10') },
      ]),
    });
    const outcomes = await loadRecentOutcomes('u1', 40, deps);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].conceptKey).toBe('离开前翻页立好');
    expect(outcomes[0].rating).toBe('good');
  });

  it('查询异常降级为空（不拖垮开课）', async () => {
    const deps = buildDeps({ findEvidence: jest.fn().mockRejectedValue(new Error('db down')) });
    expect(await loadRecentOutcomes('u1', 40, deps)).toEqual([]);
  });
});

describe('buildReviewPlan（课内温故计划）', () => {
  it('读侧走模拟时钟：日期模拟下"到期"判定不会与写侧口径打架（回归）', async () => {
    const asOf = new Date('2026-11-05T08:00:00Z');
    const getDueTraces = jest.fn().mockResolvedValue([]);
    await runWithSimulatedClock(asOf, () =>
      buildReviewPlan('u-sim', { deps: buildDeps({ getDueTraces }) }),
    );
    // 传给到期查询的 now 必须是模拟时刻（否则模拟到未来时永远算不出到期）
    expect((getDueTraces.mock.calls[0][1] as { now: Date }).now.toISOString()).toBe(asOf.toISOString());
  });
  it('按负担预算裁剪：两个原子点用满 2.0 预算，第三个不再接', async () => {
    const deps = buildDeps({
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', label: 'A', retention: 0.3 }),
        trace({ conceptKey: 'B', label: 'B', retention: 0.5 }),
        trace({ conceptKey: 'C', label: 'C', retention: 0.6 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items.map((item) => item.conceptKey)).toEqual(['A', 'B']);
    expect(plan.usedLoad).toBe(2);
    expect(plan.budget).toBe(BASE_LOAD_BUDGET);
    expect(plan.backlogCount).toBe(1);
  });

  it('一个复合点吃掉预算 → 这节只带 1 个（不是硬凑 2 个）', async () => {
    const deps = buildDeps({
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '复合点', label: '翻页与立好的配合', retention: 0.2 }),
        trace({ conceptKey: 'B', label: 'B', retention: 0.5 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].load).toBe(1.5);
    expect(plan.usedLoad).toBe(1.5);
  });

  it('预算收缩到 1.0 时仍接住最急的那个点（这节课就是为它来的）', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: '复合点', rating: 'again' }), occurredAt: new Date() },
        { payload: JSON.stringify({ conceptKey: '其它', rating: 'again' }), occurredAt: new Date() },
      ]),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '复合点', label: '翻页与立好的配合', retention: 0.2 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.budget).toBe(LOW_LOAD_BUDGET);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].load).toBeGreaterThan(plan.budget);
  });

  it('同族（同一概念的多种说法）只占一个名额', async () => {
    const deps = buildDeps({
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '离开前翻页立好：靠物理状态生效', label: '离开前翻页立好：靠物理状态生效', retention: 0.4 }),
        trace({ conceptKey: '离开前翻页立好：动作先于评价', label: '离开前翻页立好：动作先于评价', retention: 0.5 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].conceptKey).toBe('离开前翻页立好：靠物理状态生效');
    // 积压按**概念族**计：两条说法是同一族，已被这一条覆盖 → 排队里没有别的概念
    expect(plan.backlogCount).toBe(0);
  });

  it('连续 3 次没接上 → 退出复习队列，转为「回路径重学」建议', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
      ]),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '老卡点', label: '老卡点', retention: 0.1 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(0);
    expect(plan.relearnSuggestions).toEqual([
      { conceptKey: '老卡点', label: '老卡点', consecutiveAgain: 3 },
    ]);
  });

  it('毕业：连续 5 次成功 → 不再按计划间隔回捞，但保留率跌破阈值时仍回捞', async () => {
    const outcomes = Array.from({ length: 5 }, () => ({
      payload: JSON.stringify({ conceptKey: '已稳', rating: 'good' }),
      occurredAt: new Date(),
    }));
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue(outcomes),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '已稳', label: '已稳', retention: 0.75, reason: 'interval-elapsed' }),
        trace({ conceptKey: '真跌了', label: '真跌了', retention: 0.4, reason: 'below-threshold' }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items.map((item) => item.conceptKey)).toEqual(['真跌了']);
  });

  it('从未真正提取过的点（extractionCount = 0）不进队列，也不计入积压', async () => {
    const deps = buildDeps({
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '孤儿', label: '孤儿', extractionCount: 0 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(0);
    expect(plan.backlogCount).toBe(0);
  });

  it('高成功率 → 预算扩张，能带 3 个原子点', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: 'X', rating: 'easy' }), occurredAt: new Date() },
      ]),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', retention: 0.3 }),
        trace({ conceptKey: 'B', retention: 0.4 }),
        trace({ conceptKey: 'C', retention: 0.5 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.budget).toBe(HIGH_LOAD_BUDGET);
    expect(plan.items).toHaveLength(3);
    expect(plan.successRate).toBe(1);
  });

  it('急迫度：保留率跌破阈值的排在「按计划到期」之前', async () => {
    const deps = buildDeps({
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: '按计划', retention: 0.66, reason: 'interval-elapsed' }),
        trace({ conceptKey: '真跌了', retention: 0.68, reason: 'below-threshold' }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, maxItems: 1, now: new Date('2026-09-15') });
    expect(plan.items[0].conceptKey).toBe('真跌了');
  });

  it('跨 path 来源：解析出所属路径标题；解析失败为 null', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockImplementation(async (args: any) => {
        if (args?.select?.evidenceKey) {
          return [{ evidenceKey: 'review:result:CAP 定理', sessionId: 's1' }];
        }
        return [];
      }),
      findSessions: jest.fn().mockResolvedValue([{ id: 's1', learningPathId: 'p1' }]),
      findPaths: jest.fn().mockResolvedValue([{ id: 'p1', title: '分布式系统入门' }]),
      getDueTraces: jest.fn().mockResolvedValue([trace({ conceptKey: 'CAP 定理', label: 'CAP 定理' })]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items[0].originPathTitle).toBe('分布式系统入门');
  });

  it('来源解析抛错不影响计划生成', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockImplementation(async (args: any) => {
        if (args?.select?.evidenceKey) throw new Error('boom');
        return [];
      }),
      getDueTraces: jest.fn().mockResolvedValue([trace({ conceptKey: 'CAP 定理' })]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].originPathTitle).toBeNull();
  });

  it('当日额度压缩本节预算（跨会话共享）', async () => {
    const deps = buildDeps({
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: 'X', rating: 'easy' }), occurredAt: new Date() },
      ]),
      getDailyState: jest.fn().mockResolvedValue({
        date: '2026-09-15', limitLoad: 6, usedLoad: 5, usedCount: 3, remainingLoad: 1, reservedKeys: [],
      }),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', label: 'A', retention: 0.3 }),
        trace({ conceptKey: 'B', label: 'B', retention: 0.4 }),
        trace({ conceptKey: 'C', label: 'C', retention: 0.5 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    // 会话预算本来是 3.0（高成功率），被当日剩余额度压到 1.0 → 只接 1 个原子点
    expect(plan.budget).toBe(1);
    expect(plan.items).toHaveLength(1);
    expect(plan.daily).toMatchObject({ limitLoad: 6, usedLoad: 5, remainingLoad: 1 });
    expect(plan.backlogCount).toBe(2);
  });

  it('当日额度用完 → 本节不温故（顺延到明天），但仍诚实报出积压与重学建议', async () => {
    const deps = buildDeps({
      getDailyState: jest.fn().mockResolvedValue({
        date: '2026-09-15', limitLoad: 6, usedLoad: 6, usedCount: 4, remainingLoad: 0, reservedKeys: [],
      }),
      findEvidence: jest.fn().mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
        { payload: JSON.stringify({ conceptKey: '老卡点', rating: 'again' }), occurredAt: new Date() },
      ]),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', label: 'A', retention: 0.2 }),
        trace({ conceptKey: '老卡点', label: '老卡点', retention: 0.1 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toEqual([]);
    expect(plan.daily.remainingLoad).toBe(0);
    expect(plan.backlogCount).toBe(1); // 老卡点 被 leech 剔除后不计入积压
    expect(plan.relearnSuggestions).toHaveLength(1);
  });

  it('今天已接过的概念顺延到明天（不在同一天重复占额度）', async () => {
    const deps = buildDeps({
      getDailyState: jest.fn().mockResolvedValue({
        date: '2026-09-15', limitLoad: 6, usedLoad: 1, usedCount: 1, remainingLoad: 5, reservedKeys: ['A'],
      }),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', label: 'A', retention: 0.1 }),
        trace({ conceptKey: 'B', label: 'B', retention: 0.4 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items.map((item) => item.conceptKey)).toEqual(['B']);
    expect(plan.backlogCount).toBe(1);
  });

  it('明日预告透传（不参与选点）', async () => {
    const deps = buildDeps({
      countDueBetween: jest.fn().mockResolvedValue(7),
      getDueTraces: jest.fn().mockResolvedValue([trace({ conceptKey: 'A', label: 'A' })]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15T10:00:00Z') });
    expect(plan.tomorrowCount).toBe(7);
    // 窗口：今天结束之后 ~ 明天结束之前
    const [userId, from, to] = (deps.countDueBetween as jest.Mock).mock.calls[0];
    expect(userId).toBe('u1');
    expect(from.toISOString()).toBe('2026-09-15T23:59:59.999Z');
    expect(to.toISOString()).toBe('2026-09-16T23:59:59.999Z');
  });

  it('额度读取失败 → 退回按会话预算走（不能让一次读失败把温故关掉）', async () => {
    const deps = buildDeps({
      getDailyState: jest.fn().mockRejectedValue(new Error('projection down')),
      getDueTraces: jest.fn().mockResolvedValue([
        trace({ conceptKey: 'A', label: 'A', retention: 0.3 }),
        trace({ conceptKey: 'B', label: 'B', retention: 0.4 }),
      ]),
    });
    const plan = await buildReviewPlan('u1', { deps, now: new Date('2026-09-15') });
    expect(plan.items).toHaveLength(2);
    expect(plan.budget).toBe(2);
  });
});
