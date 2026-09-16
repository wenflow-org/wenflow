import {
  extractWarmupOutcomes,
  mergeWarmupOutcomes,
  pendingWarmupForModel,
  resolveTurnMemoryWarmup,
  stripWarmupPoints,
} from '../AITeachingCoordinator';
import type { ReviewPlan } from '../../memory/review-plan.service';

const plan = (items: ReviewPlan['items']): ReviewPlan => ({
  items,
  budget: 2,
  usedLoad: 1,
  backlogCount: 3,
  successRate: null,
  relearnSuggestions: [],
  daily: { date: '2026-09-15', limitLoad: 6, usedLoad: 1, remainingLoad: 5 },
  tomorrowCount: 0,
});

const item = (label: string, conceptKey = label): ReviewPlan['items'][number] => ({
  conceptKey,
  label,
  retention: 0.4,
  reason: 'below-threshold',
  masteryScore: 0.6,
  load: 1,
  loadFactors: [],
  originPathTitle: null,
});

describe('课内温故：到期旧知与本节知识点看板物理分离（回归 2e3ca16）', () => {
  const warmup = plan([
    item('离开前把书翻到下一页并立好', '离开前把书翻到下一页并立好'),
    item('短离开是收尾的一部分', '短离开是收尾的一部分：非收工'),
  ]);

  it('extractWarmupOutcomes：只摘出温故点，且按归一化名字匹配（模型换写法也能对上）', () => {
    const outcomes = extractWarmupOutcomes(warmup, [
      { name: '本节新知 A', status: 'learning', progress: 40 },
      { name: '离开前把书翻到下一页并立好', status: 'mastered', progress: 90 },
      // 冒号后缀不同 → 归一化后仍属同一概念
      { name: '短离开是收尾的一部分：靠物理路径接管', status: 'learning', progress: 50 },
    ]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({
      conceptKey: '离开前把书翻到下一页并立好',
      status: 'mastered',
      progress: 90,
    });
    expect(outcomes[1].status).toBe('learning');
  });

  it('extractWarmupOutcomes：温故点排在本节点之后也不丢（截断前摘取，回归 slice(0,5) 丢结果）', () => {
    const outcomes = extractWarmupOutcomes(warmup, [
      { name: '本节点 1', status: 'learning', progress: 30 },
      { name: '本节点 2', status: 'learning', progress: 30 },
      { name: '本节点 3', status: 'learning', progress: 30 },
      { name: '本节点 4', status: 'learning', progress: 30 },
      { name: '本节点 5', status: 'learning', progress: 30 },
      { name: '离开前把书翻到下一页并立好', status: 'mastered', progress: 90 },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].conceptKey).toBe('离开前把书翻到下一页并立好');
  });

  it('extractWarmupOutcomes：计划为空时一律不摘（不误伤本节知识点）', () => {
    expect(extractWarmupOutcomes(null, [{ name: 'x', status: 'mastered', progress: 100 }])).toEqual([]);
    expect(extractWarmupOutcomes(plan([]), [{ name: 'x', status: 'mastered', progress: 100 }])).toEqual([]);
  });

  it('extractWarmupOutcomes：仅"已提问"的状态不算结果（回归：review/pending 被当again 落库）', () => {
    const points = [
      { name: '离开前把书翻到下一页并立好', status: 'review', progress: 0 },
      { name: '短离开是收尾的一部分：非收工', status: 'pending', progress: 0 },
    ];
    expect(extractWarmupOutcomes(warmup, points)).toEqual([]);
    // 真出了结果才收录
    const answered = extractWarmupOutcomes(warmup, [
      { name: '离开前把书翻到下一页并立好', status: 'mastered', progress: 90 },
    ]);
    expect(answered).toHaveLength(1);
    expect(answered[0].status).toBe('mastered');
  });

  it('stripWarmupPoints：温故点绝不进本节看板（跨 path 到期点串进看板是历史事故的根因）', () => {
    const board = [
      { name: '本节新知 A', status: 'learning', progress: 40 },
      { name: '离开前把书翻到下一页并立好', status: 'mastered', progress: 90 },
      { name: '本节新知 B', status: 'pending', progress: 0 },
    ];
    const next = stripWarmupPoints(warmup, board);
    expect(next.map((point) => point.name)).toEqual(['本节新知 A', '本节新知 B']);
  });

  it('mergeWarmupOutcomes：结果并进持久化计划项，未温故的点原样保留', () => {
    const merged = mergeWarmupOutcomes(
      warmup,
      [{ conceptKey: '离开前把书翻到下一页并立好', status: 'mastered', progress: 90 }],
      '2026-09-15T10:00:00.000Z',
    );
    expect(merged?.items[0].outcome).toEqual({
      status: 'mastered',
      progress: 90,
      reviewedAt: '2026-09-15T10:00:00.000Z',
    });
    expect(merged?.items[1].outcome).toBeUndefined();
    // 计划其余字段（负担预算/积压计数）保持不变
    expect(merged?.budget).toBe(2);
    expect(merged?.backlogCount).toBe(3);
  });

  it('mergeWarmupOutcomes：无结果 / 无计划时安全返回', () => {
    expect(mergeWarmupOutcomes(null, [], 'now')).toBeNull();
    expect(mergeWarmupOutcomes(warmup, [], 'now')).toEqual(warmup);
  });
});

describe('课内温故：每回合都必须拿到计划（回归「环断电」2026-09-16）', () => {
  const warmup = plan([item('A'), item('B')]);
  const done = (label: string) => ({
    ...item(label),
    outcome: { status: 'mastered', progress: 90, reviewedAt: '2026-09-16T10:00:00.000Z' },
  });

  it('resolveTurnMemoryWarmup：开课持久化的计划在回合侧必须能还原（断点回归）', () => {
    // 开课 completeInitialization 写入的 sessionArtifacts（此前不保留 memoryWarmup → 恒 null）
    const sessionArtifacts = {
      memoryWarmup: warmup,
      initialKnowledgeState: [],
      pathBackgroundContext: null,
      endReason: null,
    };
    expect(resolveTurnMemoryWarmup(sessionArtifacts)).toEqual(warmup);
  });

  it('resolveTurnMemoryWarmup：缺失 / 空 / 畸形一律 null（不误伤本节内容）', () => {
    expect(resolveTurnMemoryWarmup({})).toBeNull();
    expect(resolveTurnMemoryWarmup(null)).toBeNull();
    expect(resolveTurnMemoryWarmup({ memoryWarmup: null })).toBeNull();
    expect(resolveTurnMemoryWarmup({ memoryWarmup: plan([]) })).toBeNull();
    expect(resolveTurnMemoryWarmup({ memoryWarmup: { items: 'oops' } })).toBeNull();
  });

  it('pendingWarmupForModel：已回捞的点不再交给模型，usedLoad 同步收缩', () => {
    const reviewed = { ...warmup, items: [done('A'), item('B')] };
    const forModel = pendingWarmupForModel(reviewed);
    expect(forModel?.items.map((entry) => entry.label)).toEqual(['B']);
    expect(forModel?.usedLoad).toBe(1);
    // 计划其余字段照旧透传
    expect(forModel?.budget).toBe(2);
  });

  it('pendingWarmupForModel：全部回捞完 → null（提示词走"本节不温故"）', () => {
    expect(pendingWarmupForModel({ ...warmup, items: [done('A'), done('B')] })).toBeNull();
    expect(pendingWarmupForModel(null)).toBeNull();
    expect(pendingWarmupForModel(undefined)).toBeNull();
  });
});
