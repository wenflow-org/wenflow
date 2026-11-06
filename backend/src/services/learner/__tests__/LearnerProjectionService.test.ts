import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { learnerProjectionService } from '../LearnerProjectionService';
function heavySnapshot() {
  return {
    snapshotVersion: 'learner-snapshot-v1',
    scope: { userId: 'u1', mode: 'path' },
    freshness: { generatedAt: '2026-09-12T00:00:00.000Z', confidence: 0.8, basedOn: {} },
    profile: { userId: 'u1', cognitive: { thinkingStyle: 'logical' }, preferences: {}, emotional: {} },
    dynamicState: { metrics: { lss: 4, ktl: 5, lf: 3, lsb: 1 }, recentTrend: 'stable', fatigueRisk: 'low', recommendedPacing: 'moderate' },
    learningControlState: { paceMode: 'steady' },
    replanSignal: { shouldSuggest: false, recommendation: 'keep' },
    teachingHints: { promptEnhancement: 'p', recommendedApproach: 'a', emphasize: [], avoid: [], riskFactors: [] },
    knowledgeMemory: {
      globalSignals: { masteredConcepts: ['m1'], fragileConcepts: ['f1'], strugglingConcepts: ['s1'] },
      globalBackground: {
        reusableFoundations: ['r1'],
        blockedFoundations: ['b1'],
        conceptLedger: Array.from({ length: 60 }, (_, i) => ({ conceptKey: `c${i}`, label: `c${i}`, evidenceCount: i })),
        recurringConfusions: Array.from({ length: 40 }, (_, i) => ({ conceptKey: `x${i}`, pattern: 'p' })),
        transferSignals: [{ conceptKey: 't1' }],
      },
      currentPath: {
        learningPathId: 'lp1',
        pathTitle: 'T',
        progress: { totalTasks: 10, completedTasks: 2 },
        currentPosition: { milestoneTitle: 'm', taskTitle: 'task' },
        prerequisiteGaps: [{ conceptKey: 'g1', label: 'g', reason: 'r', severity: 'high' }],
        milestoneProgress: Array.from({ length: 20 }, (_, i) => ({ milestoneId: `m${i}` })),
        taskMastery: Array.from({ length: 50 }, (_, i) => ({ taskId: `t${i}`, title: `task${i}` })),
        conceptStates: Array.from({ length: 80 }, (_, i) => ({ conceptKey: `cs${i}` })),
        recentEvidence: Array.from({ length: 80 }, (_, i) => ({ type: 'task-completed', conceptKeys: [`e${i}`] })),
      },
    },
  } as any;
}

const heavyPath = {
  id: 'lp1',
  userId: 'u1',
  title: 'T',
  description: 'd',
  subject: 's',
  status: 'active',
  totalMilestones: 1,
  completedMilestones: 0,
  aiPromptTemplate: 'X'.repeat(120000),
  milestones: [{ id: 'm1', title: 'M1', stageNumber: 1, status: 'active', subtasks: [{ id: 't1', title: 'task1' }] }],
};

describe('LearnerProjectionService.toGuidanceProjection', () => {
  it('裁剪掉 path.aiPromptTemplate（上下文膨胀主因）', () => {
    const { path } = learnerProjectionService.toGuidanceProjection(heavySnapshot(), heavyPath);
    expect(path).not.toHaveProperty('aiPromptTemplate');
    expect((path as any).title).toBe('T');
    expect((path as any).milestones).toEqual([{ id: 'm1', title: 'M1', stageNumber: 1, status: 'active' }]);
  });

  it('裁剪掉 knowledgeMemory 明细，只保留 globalSignals 与顶部台账', () => {
    const { learnerSnapshot } = learnerProjectionService.toGuidanceProjection(heavySnapshot(), heavyPath);
    const km: any = learnerSnapshot.knowledgeMemory;
    expect(km.globalSignals).toEqual({ masteredConcepts: ['m1'], fragileConcepts: ['f1'], strugglingConcepts: ['s1'] });
    expect(km.globalBackground.conceptLedger.length).toBeLessThanOrEqual(8);
    expect(km.globalBackground.recurringConfusions.length).toBeLessThanOrEqual(5);
    expect(km.currentPath.taskMastery).toEqual([]);
    expect(km.currentPath.conceptStates).toEqual([]);
    expect(km.currentPath.recentEvidence).toEqual([]);
    // 保留文案需要的定位信息
    expect(km.currentPath.learningPathId).toBe('lp1');
    expect(km.currentPath.prerequisiteGaps.length).toBe(1);
  });

  it('对最小快照（缺 knowledgeMemory）保持健壮', () => {
    const { learnerSnapshot, path } = learnerProjectionService.toGuidanceProjection({ freshness: { basedOn: {} } } as any, null);
    expect(path).toBeNull();
    expect((learnerSnapshot as any).knowledgeMemory.globalSignals).toBeDefined();
    expect((learnerSnapshot as any).knowledgeMemory.currentPath).toBeUndefined();
  });

  it('投影后体积远小于原始（数量级下降）', () => {
    const original = JSON.stringify({ learner: heavySnapshot(), path: heavyPath });
    const { learnerSnapshot, path } = learnerProjectionService.toGuidanceProjection(heavySnapshot(), heavyPath);
    const projected = JSON.stringify({ learner: learnerSnapshot, path });
    expect(original.length).toBeGreaterThan(120000);
    expect(projected.length).toBeLessThan(20000);
    expect(projected.length).toBeLessThan(original.length / 5);
  });

  it('toReviewProjection 只保留状态摘要与知识线索', () => {
    const review = learnerProjectionService.toReviewProjection(heavySnapshot());
    expect(review.learnerDigest.metrics).toEqual({ lss: 4, ktl: 5, lf: 3, lsb: 1 });
    expect(review.learnerDigest.trend).toBe('stable');
    expect(review.knowledgeDigest.mastered).toEqual(['m1']);
    expect(review.knowledgeDigest.prerequisiteGaps).toEqual([{ label: 'g', reason: 'r', severity: 'high' }]);
    expect(review.knowledgeDigest.currentPath?.learningPathId).toBe('lp1');
    // 逐任务/逐证据明细不进入诊断投影
    expect(JSON.stringify(review)).not.toContain('taskMastery');
    expect(JSON.stringify(review).length).toBeLessThan(3000);
  });

  // issue #196：transferSignals 此前被硬置空，成为「产出后无人消费」的字段。
  it('transferSignals 与其余台账项同口径透传（有界截断，不再硬置空）', () => {
    const snapshot = heavySnapshot();
    snapshot.knowledgeMemory.globalBackground.transferSignals = Array.from({ length: 6 }, (_, i) => ({
      conceptKey: `t${i}`, label: `T${i}`, readiness: 'high', confidence: 0.8,
    }));
    const { learnerSnapshot } = learnerProjectionService.toGuidanceProjection(snapshot, null);
    const signals = (learnerSnapshot as any).knowledgeMemory.globalBackground.transferSignals;
    expect(signals).toHaveLength(3);
    expect(signals[0].conceptKey).toBe('t0');
  });

  it('globalBackground.transferSignals 缺失时投影回落空数组（不抛错）', () => {
    const snapshot = heavySnapshot() as any;
    delete snapshot.knowledgeMemory.globalBackground.transferSignals;
    const { learnerSnapshot } = learnerProjectionService.toGuidanceProjection(snapshot, null);
    expect((learnerSnapshot as any).knowledgeMemory.globalBackground.transferSignals).toEqual([]);
  });
});

describe('toPlanningProjection（新建路径时的难度校准证据）', () => {
  it('冷启动（无任何学习证据）→ null（不注入噪声，行为与原先一致）', () => {
    const empty = {
      ...heavySnapshot(),
      knowledgeMemory: {
        globalSignals: { masteredConcepts: [], fragileConcepts: [], strugglingConcepts: [] },
        globalBackground: { reusableFoundations: [], blockedFoundations: [], conceptLedger: [], recurringConfusions: [], transferSignals: [] },
      },
    };
    expect(learnerProjectionService.toPlanningProjection(empty as any)).toBeNull();
  });

  it('有学习历史 → 带上证据与节奏，且各项截断（有界）', () => {
    const snapshot = heavySnapshot();
    // 造足量概念，验证截断
    snapshot.knowledgeMemory.globalSignals.fragileConcepts = Array.from({ length: 30 }, (_, i) => `f${i}`);
    snapshot.knowledgeMemory.globalSignals.strugglingConcepts = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const projection = learnerProjectionService.toPlanningProjection(snapshot as any)!;
    expect(projection.hasLearningHistory).toBe(true);
    expect(projection.metrics).toEqual({ lss: 4, ktl: 5, lf: 3, lsb: 1 });
    expect(projection.recommendedPacing).toBe('moderate');
    expect(projection.blockedFoundations).toEqual(['b1']);
    expect(projection.fragileConcepts).toHaveLength(8);
    expect(projection.strugglingConcepts).toHaveLength(8);
    expect(projection.recurringConfusions).toHaveLength(5);
    expect(projection.recurringConfusions[0]).toMatchObject({ concept: 'x0', note: 'p' });
    expect(projection.conceptLedgerSize).toBe(60);
    // 有界：不含逐任务/逐证据明细，体积可控（prompt 预算）
    expect(JSON.stringify(projection)).not.toContain('taskMastery');
    expect(JSON.stringify(projection).length).toBeLessThan(2000);
  });

  it('只有 conceptLedger 也算有历史（上过课但还没沉淀概念信号）', () => {
    const snapshot = heavySnapshot();
    snapshot.knowledgeMemory.globalSignals = { masteredConcepts: [], fragileConcepts: [], strugglingConcepts: [] };
    snapshot.knowledgeMemory.globalBackground.blockedFoundations = [];
    snapshot.knowledgeMemory.globalBackground.recurringConfusions = [];
    expect(learnerProjectionService.toPlanningProjection(snapshot as any)?.conceptLedgerSize).toBe(60);
  });
});

describe('toTeachingProjection · 概念身份接口（kcid 读取侧契约）', () => {
  /**
   * 上游（LearnerKnowledgeMemoryService 台账聚合）已按 conceptId 优先归并：
   * 投影层对台账行 **1:1 透传**（仅 slice 截断）——不再按名字拆分/合并，
   * 保证「上游归并结果 = 课堂 prompt 看到的结果」。
   */
  const mergedLedger = [
    { conceptKey: '判断两个元素间的对齐关系', label: '判断两个元素间的对齐关系', familiarity: 'practiced', transferReadiness: 'medium', misconceptionRisk: 'low', sourcePaths: ['p1'], sourceTasks: ['t1'], evidenceCount: 2 },
    { conceptKey: '独立概念', label: '独立概念', familiarity: 'seen', transferReadiness: 'low', misconceptionRisk: 'low', sourcePaths: ['p1'], sourceTasks: [], evidenceCount: 1 },
  ];
  const snapshot = {
    ...heavySnapshot(),
    knowledgeMemory: {
      ...heavySnapshot().knowledgeMemory,
      globalBackground: { ...heavySnapshot().knowledgeMemory.globalBackground, conceptLedger: mergedLedger },
    },
  } as any;

  it('台账行 1:1 透传（上游 conceptId 归并结果不被投影层再拆分/再合并）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshot);
    expect(projection.backgroundKnowledge.recentConceptLedger).toEqual(mergedLedger);
    expect(projection.backgroundKnowledge.recentConceptLedger).toHaveLength(2);
  });

  it('名字作展示接口：mastered/fragile/struggling 与台账 label 原样输出（不按 conceptKey 改写）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshot);
    expect(projection.relevantKnowledge.mastered).toEqual(heavySnapshot().knowledgeMemory.globalSignals.masteredConcepts);
    expect(projection.backgroundKnowledge.recentConceptLedger[0].label).toBe('判断两个元素间的对齐关系');
  });

  // issue #196：transferSignals 此前不进任何投影响应（无确定性消费方），现送达课堂投影并被 teaching-turn 规则读取。
  it('backgroundKnowledge 透传 transferSignals（有界截断，供课堂读取）', () => {
    const withSignals = {
      ...heavySnapshot(),
      knowledgeMemory: {
        ...heavySnapshot().knowledgeMemory,
        globalBackground: {
          ...heavySnapshot().knowledgeMemory.globalBackground,
          transferSignals: Array.from({ length: 12 }, (_, i) => ({
            conceptKey: `ts${i}`, label: `TS${i}`, readiness: 'high', confidence: 0.8,
          })),
        },
      },
    } as any;
    const projection = learnerProjectionService.toTeachingProjection(withSignals);
    expect(projection.backgroundKnowledge.transferSignals).toHaveLength(8);
    expect(projection.backgroundKnowledge.transferSignals[0].conceptKey).toBe('ts0');
  });

  // issue #196 守卫：写入快照台账（globalBackground，来源 learner_evidence 蒸馏）的每一项，
  // 都必须被至少一个消费侧投影承载——这正是原先 transferSignals 缺失的那一环。
  it('globalBackground 台账项被消费侧投影逐一承载（防「产出后无人消费」）', () => {
    const withAll = {
      ...heavySnapshot(),
      knowledgeMemory: {
        ...heavySnapshot().knowledgeMemory,
        globalBackground: {
          reusableFoundations: ['R1'],
          blockedFoundations: ['B1'],
          conceptLedger: [{ conceptKey: 'c1', label: 'C1' }],
          recurringConfusions: [{ conceptKey: 'x1', label: 'X1', pattern: 'p', confidence: 0.5, count: 1 }],
          transferSignals: [{ conceptKey: 't1', label: 'T1', readiness: 'high', confidence: 0.8 }],
        },
      },
    } as any;
    const bk = learnerProjectionService.toTeachingProjection(withAll).backgroundKnowledge;
    expect(bk.reusableFoundations.length).toBeGreaterThan(0);
    expect(bk.blockedFoundations.length).toBeGreaterThan(0);
    expect(bk.recurringConfusions.length).toBeGreaterThan(0);
    expect(bk.transferSignals.length).toBeGreaterThan(0);
    // conceptLedger 在课堂投影里以 recentConceptLedger 承载
    expect(bk.recentConceptLedger.length).toBeGreaterThan(0);
  });
});

/**
 * #183：教学投影曾把「该减速 / 该重排 / 疲劳风险」三类跨课结论主动裁掉——
 * liveState 无 fatigueRisk、teachingHints 只留 4 个键、整份投影没有 replanSignal。
 * 结果：预测器与编排算出的结论永远到不了下一课（只进 dashboard 文案与路径重排）。
 */
describe('toTeachingProjection · 跨课结论送达（#183）', () => {
  const replanSignal = {
    shouldSuggest: true,
    priority: 'high' as const,
    recommendation: 'slow_down' as const,
    scope: 'next_milestone' as const,
    rationale: '连续两课疲劳度高于健康度',
    reasonCodes: ['fatigue_high', 'lesson_imbalance'],
  };

  function snapshotWithConsequences() {
    const snapshot = heavySnapshot();
    snapshot.dynamicState.fatigueRisk = 'high';
    snapshot.dynamicState.recommendedPacing = 'slow';
    snapshot.teachingHints.riskFactors = ['连续高强度', '卡点未解'];
    snapshot.replanSignal = replanSignal;
    return snapshot;
  }

  it('fatigueRisk 随 liveState 送达（减速结论不再被裁）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshotWithConsequences());
    expect(projection.liveState.fatigueRisk).toBe('high');
    // 同一份 liveState 的节奏结论保持一致（两者同源，不应一有一无）
    expect(projection.liveState.recommendedPacing).toBe('slow');
  });

  it('teachingHints.riskFactors 随投影送达（不再只保留 4 个键）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshotWithConsequences());
    expect(projection.teachingHints.riskFactors).toEqual(['连续高强度', '卡点未解']);
    // 原有 4 个键不因补齐而丢失
    expect(projection.teachingHints).toEqual(expect.objectContaining({
      promptEnhancement: 'p',
      recommendedApproach: 'a',
      emphasize: [],
      avoid: [],
    }));
  });

  it('replanSignal 随投影送达（重排结论不再是 dashboard 专属）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshotWithConsequences());
    expect(projection.replanSignal).toEqual(replanSignal);
    // 与重排投影同源同值：两处给下游的必须是同一个信号，不是各算一份
    expect(learnerProjectionService.toReplanProjection(snapshotWithConsequences())?.signal).toEqual(projection.replanSignal);
  });

  it('投影键集 ⊇ 课堂提示词实际引用的 learner.<key>（防再次一处声明一处裁掉）', () => {
    const projection = learnerProjectionService.toTeachingProjection(snapshotWithConsequences()) as unknown as Record<string, unknown>;
    const promptPath = path.resolve(__dirname, '../../../../../prompts/core/teaching-turn.yaml');
    const doc = yaml.load(fs.readFileSync(promptPath, 'utf8')) as { rules?: unknown[] };
    const ruleText = (doc.rules || []).filter((rule): rule is string => typeof rule === 'string').join('\n');
    const referenced = [...new Set([...ruleText.matchAll(/\blearner\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]))];

    expect(referenced.length).toBeGreaterThan(0);
    for (const key of referenced) {
      expect(Object.keys(projection)).toContain(key);
    }
    // 提示词里疲劳/重排相关字段（#183 病灶）必须真的存在于投影里
    expect(projection).toHaveProperty('liveState.fatigueRisk');
    expect(projection).toHaveProperty('teachingHints.riskFactors');
    expect(projection).toHaveProperty('replanSignal.recommendation');
  });
});
