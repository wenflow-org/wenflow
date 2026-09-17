import {
  extractWarmupOutcomes,
  matchWarmupItem,
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

  it('extractWarmupOutcomes（结构化通道，2026-09-17）：control.warmupOutcomes 直接落结果，不依赖名字回写', () => {
    // 关键回归：模型只报了结构化结果、**没有**把温故点写进 knowledge.points（本轮从零回归的失败场景）
    const outcomes = extractWarmupOutcomes(warmup, [
      { name: '本节新知 A', status: 'learning', progress: 40 },
    ], [
      { conceptKey: '离开前把书翻到下一页并立好', recall: 'unaided', evidence: '学生自己说出来了' },
      { conceptKey: '短离开是收尾的一部分', recall: 'failed' },
    ]);
    expect(outcomes).toEqual([
      { conceptKey: '离开前把书翻到下一页并立好', status: 'mastered', progress: 100 },
      // 用**计划项**的规范键回报（模型可只给近义说法）
      { conceptKey: '短离开是收尾的一部分：非收工', status: 'not-recalled', progress: 0 },
    ]);
  });

  it('extractWarmupOutcomes：itemIndex 按"模型看到的待回捞视图"解析（不是完整计划下标）', () => {
    const withOutcome = plan([
      item('已回捞过的点', '已回捞过的点'),
      item('待回捞 A', '待回捞 A'),
      item('待回捞 B', '待回捞 B'),
    ]);
    withOutcome.items[0] = { ...withOutcome.items[0], outcome: { status: 'mastered', progress: 100, reviewedAt: 'x' } };
    // 模型看到的是 pending 视图（[待回捞 A, 待回捞 B]）→ itemIndex 1 应为「待回捞 B」
    const outcomes = extractWarmupOutcomes(withOutcome, null, [{ itemIndex: 1, recall: 'with-hint' }]);
    expect(outcomes).toEqual([{ conceptKey: '待回捞 B', status: 'learning', progress: 50 }]);
  });

  it('extractWarmupOutcomes：结构化优先于名字匹配（同一点只落一次，以结构化等级为准）', () => {
    const outcomes = extractWarmupOutcomes(warmup, [
      { name: '离开前把书翻到下一页并立好', status: 'learning', progress: 30 },
    ], [
      { conceptKey: '离开前把书翻到下一页并立好', recall: 'unaided' },
    ]);
    expect(outcomes).toEqual([
      { conceptKey: '离开前把书翻到下一页并立好', status: 'mastered', progress: 100 },
    ]);
  });

  it('extractWarmupOutcomes：结构化条目定位不到计划项 / 等级非法 → 丢弃（不猜等级）', () => {
    const outcomes = extractWarmupOutcomes(warmup, null, [
      { conceptKey: '完全不相关的点', recall: 'unaided' },
      { itemIndex: 99, recall: 'unaided' },
      { conceptKey: '离开前把书翻到下一页并立好', recall: 'unknown' as any },
    ]);
    expect(outcomes).toEqual([]);
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

  it('matchWarmupItem：模型用近义/截断写法回写也能对上，且 conceptKey 归到计划项', () => {
    const planWithLongLabel = plan([item('离开前把书翻到下一页并立好', 'leave-book-open')]);
    // 精确（含归一化：冒号后缀差异）
    expect(matchWarmupItem(planWithLongLabel, '离开前把书翻到下一页并立好')?.conceptKey).toBe('leave-book-open');
    // 截断写法（包含关系 + 长度足够 + 唯一命中）
    const truncated = matchWarmupItem(planWithLongLabel, '离开前把书翻到下一页');
    expect(truncated?.conceptKey).toBe('leave-book-open');
    // 结果摘取时 conceptKey 用计划项的规范键（记忆引擎按它定位 memory_traces）
    const outcomes = extractWarmupOutcomes(planWithLongLabel, [
      { name: '离开前把书翻到下一页', status: 'mastered', progress: 90 },
    ]);
    expect(outcomes).toEqual([{ conceptKey: 'leave-book-open', status: 'mastered', progress: 90 }]);
  });

  it('matchWarmupItem：保守边界——短名/歧义/无关一律不匹配（误判会摘掉本节知识点）', () => {
    // 短于门槛（8 字）时不做包含匹配，避免"数据流"这类短名误伤
    const shortPlan = plan([item('触发条件', 'k1')]);
    expect(matchWarmupItem(shortPlan, '触发')).toBeNull();
    // 歧义：两个计划项都能包含该写法 → 放弃（宁缺勿错）
    const ambiguous = plan([
      item('判断流程中数据流的按需触发条件与验证参数', 'k1'),
      item('判断流程中数据流的按需触发时机与顺序', 'k2'),
    ]);
    expect(matchWarmupItem(ambiguous, '判断流程中数据流的按需触发')).toBeNull();
    // 无关点：不匹配（这条不能被当作温故结果）
    expect(matchWarmupItem(warmup, '本节一个完全无关的新知识点')).toBeNull();
    // 精确命中即使短名也认（主路径不受门槛限制）
    expect(matchWarmupItem(shortPlan, '触发条件')?.conceptKey).toBe('k1');
  });

  it('matchWarmupItem：调序+截断也认（实测模型把"整合输出8月龄食物质地安全判据"写成"食物质地安全判据整合"）', () => {
    const reordered = plan([item('整合输出8月龄食物质地安全判据', 'k-texture')]);
    expect(matchWarmupItem(reordered, '食物质地安全判据整合')?.conceptKey).toBe('k-texture');
    expect(matchWarmupItem(reordered, '食物质地安全判据')?.conceptKey).toBe('k-texture');
    // 差异更大的写法不认（不能放宽成"看起来像"）
    expect(matchWarmupItem(reordered, '食物硬度与易碎度的安全边界')).toBeNull();
    expect(matchWarmupItem(reordered, '食物质地与呛咳风险的对照表')).toBeNull();
    // 但"计划名被包住"的更长写法仍认（同一概念的补充说法）
    expect(matchWarmupItem(reordered, '整合输出8月龄食物质地安全判据与验证参数')?.conceptKey).toBe('k-texture');
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
