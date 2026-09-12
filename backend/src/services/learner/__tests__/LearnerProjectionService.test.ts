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
});
