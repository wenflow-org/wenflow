/**
 * 独立锚题探针（Q13 / B4）：纯决策层。这里只测**确定性**——
 * 选择排序/上限/去重、排期闸门（检查点优先、间隔/轮次/退避）、结果归因与确定性。
 */
import {
  ANCHOR_PROBE_DEFAULT_DELAYED_DAYS,
  ANCHOR_PROBE_DEFAULT_LIMIT,
  ANCHOR_PROBE_INTERVAL_MS,
  ANCHOR_PROBE_MAX_PROBES_SINCE_FLAG,
  ANCHOR_PROBE_MIN_TURNS_BETWEEN,
  evaluateAnchorProbeOutcome,
  partitionDelayedAnchorCandidates,
  selectAnchorCandidates,
  selectDelayedAnchorCandidates,
  shouldRunAnchorProbe,
  utcNaturalDayDiff,
  type AnchorCompletedCandidate,
  type AnchorConceptCandidate,
} from '../anchor-probe';

const cand = (
  conceptKey: string,
  belief: AnchorConceptCandidate['belief'],
  masteryScore: number,
  over: Partial<AnchorConceptCandidate> = {},
): AnchorConceptCandidate => ({ conceptKey, belief, masteryScore, ...over });

describe('selectAnchorCandidates（目标选择：确定排序 + 上限 + 去重）', () => {
  it('空输入 / 非数组 → 空结果', () => {
    expect(selectAnchorCandidates([])).toEqual([]);
    expect(selectAnchorCandidates(undefined as unknown as AnchorConceptCandidate[])).toEqual([]);
  });

  it('排序：mastered 高分在前，再 struggling 低分在前，learning 被排除', () => {
    const plans = selectAnchorCandidates([
      cand('s-high', 'struggling', 0.8),
      cand('m-low', 'mastered', 0.6),
      cand('learning-x', 'learning', 0.5),
      cand('m-high', 'mastered', 0.95),
      cand('s-low', 'struggling', 0.1),
    ]);
    // 默认上限 3，故只能看到前三个；s-low 先于 s-high 说明 struggling 组内是低分优先
    expect(plans.map((p) => p.conceptKey)).toEqual(['m-high', 'm-low', 's-low']);
    expect(plans.map((p) => p.expected)).toEqual(['mastered', 'mastered', 'struggling']);
  });

  it('struggling 组内严格低分优先（masteryScore 升序）', () => {
    const plans = selectAnchorCandidates([
      cand('s-high', 'struggling', 0.8),
      cand('s-low', 'struggling', 0.1),
      cand('s-mid', 'struggling', 0.5),
    ]);
    expect(plans.map((p) => p.conceptKey)).toEqual(['s-low', 's-mid', 's-high']);
  });

  it('同分/同信念时用 conceptKey 字典序兜底（确定性）', () => {
    const plans = selectAnchorCandidates([
      cand('b', 'mastered', 0.8),
      cand('a', 'mastered', 0.8),
      cand('c', 'mastered', 0.8),
    ]);
    expect(plans.map((p) => p.conceptKey)).toEqual(['a', 'b', 'c']);
  });

  it('limit：默认 3、可覆盖、且钳制到 [1,3]', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((k) => cand(k, 'mastered', 0.9));
    expect(selectAnchorCandidates(many)).toHaveLength(ANCHOR_PROBE_DEFAULT_LIMIT);
    expect(selectAnchorCandidates(many, { limit: 2 })).toHaveLength(2);
    expect(selectAnchorCandidates(many, { limit: 99 })).toHaveLength(3); // 硬上限
    expect(selectAnchorCandidates(many, { limit: 0 })).toHaveLength(1); // 下限
    expect(selectAnchorCandidates(many, { limit: Number.NaN })).toHaveLength(ANCHOR_PROBE_DEFAULT_LIMIT);
  });

  it('去重：同一 conceptKey 只保留最可疑的一条', () => {
    const plans = selectAnchorCandidates([
      cand('dup', 'mastered', 0.7),
      cand('dup', 'mastered', 0.99),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].reason).toContain('0.99');
  });

  it('过滤空 conceptKey；非法 masteryScore 归零；reason 含方向', () => {
    const plans = selectAnchorCandidates([
      cand('   ', 'mastered', 0.9),
      cand('bad-score', 'struggling', Number.NaN),
      cand('ok', 'mastered', 0.5),
    ]);
    expect(plans.map((p) => p.conceptKey)).toEqual(['ok', 'bad-score']);
    expect(plans[0].reason).toContain('假阳性');
    expect(plans[1].reason).toContain('假阴性');
    expect(plans[1].reason).toContain('0');
  });

  it('确定性：输入顺序打乱，结果不变', () => {
    const input = [
      cand('m1', 'mastered', 0.9),
      cand('s1', 'struggling', 0.2),
      cand('m2', 'mastered', 0.9),
      cand('s2', 'struggling', 0.7),
    ];
    const forward = selectAnchorCandidates(input).map((p) => p.conceptKey);
    const reversed = selectAnchorCandidates([...input].reverse()).map((p) => p.conceptKey);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['m1', 'm2', 's1']);
  });
});

describe('shouldRunAnchorProbe（排期闸门）', () => {
  const NOW = Date.parse('2026-09-19T12:00:00.000Z');

  it('从未投放（lastProbeAt 缺失）→ 可投放', () => {
    const decision = shouldRunAnchorProbe({ now: NOW });
    expect(decision.shouldRun).toBe(true);
  });

  it('存在未完成检查点 → 一律不投放（优先于其他条件）', () => {
    const decision = shouldRunAnchorProbe({
      now: NOW,
      hasPendingCheckpoint: true,
      lastProbeAt: null,
      turnsSinceLastProbe: 999,
    });
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toContain('检查点');
  });

  it('间隔：未到最小间隔不投放，到点后投放', () => {
    const tooSoon = shouldRunAnchorProbe({
      now: NOW,
      lastProbeAt: NOW - ANCHOR_PROBE_INTERVAL_MS + 60_000,
      turnsSinceLastProbe: ANCHOR_PROBE_MIN_TURNS_BETWEEN,
    });
    expect(tooSoon.shouldRun).toBe(false);
    expect(tooSoon.reason).toContain('最小间隔');

    const due = shouldRunAnchorProbe({
      now: NOW,
      lastProbeAt: NOW - ANCHOR_PROBE_INTERVAL_MS - 60_000,
      turnsSinceLastProbe: ANCHOR_PROBE_MIN_TURNS_BETWEEN,
    });
    expect(due.shouldRun).toBe(true);
  });

  it('轮次：低于最小轮数不投放，达标后投放', () => {
    const tooFew = shouldRunAnchorProbe({
      now: NOW,
      lastProbeAt: NOW - ANCHOR_PROBE_INTERVAL_MS - 60_000,
      turnsSinceLastProbe: ANCHOR_PROBE_MIN_TURNS_BETWEEN - 1,
    });
    expect(tooFew.shouldRun).toBe(false);
    expect(tooFew.reason).toContain('轮');

    const enough = shouldRunAnchorProbe({
      now: NOW,
      lastProbeAt: NOW - ANCHOR_PROBE_INTERVAL_MS - 60_000,
      turnsSinceLastProbe: ANCHOR_PROBE_MIN_TURNS_BETWEEN,
    });
    expect(enough.shouldRun).toBe(true);
  });

  it('退避：自上次证伪连续投放达上限 → 不投放', () => {
    const decision = shouldRunAnchorProbe({
      now: NOW,
      probesSinceLastFlag: ANCHOR_PROBE_MAX_PROBES_SINCE_FLAG,
      turnsSinceLastProbe: 999,
    });
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toContain('退避');
  });

  it('选项覆盖默认阈值（放宽轮次后重新可投放）', () => {
    const baseline = {
      now: NOW,
      lastProbeAt: NOW - ANCHOR_PROBE_INTERVAL_MS - 60_000,
      turnsSinceLastProbe: 2,
    };
    expect(shouldRunAnchorProbe(baseline).shouldRun).toBe(false);
    expect(shouldRunAnchorProbe(baseline, { minTurnsBetweenProbes: 1 }).shouldRun).toBe(true);
  });

  it('now 非法 → 不投放（不依赖系统时钟）', () => {
    expect(shouldRunAnchorProbe({ now: 'not-a-date' }).shouldRun).toBe(false);
    expect(shouldRunAnchorProbe({ now: Number.NaN }).shouldRun).toBe(false);
  });
});

describe('evaluateAnchorProbeOutcome（结果归因）', () => {
  it('期望掌握却未通过 → false_mastery（证伪）', () => {
    expect(evaluateAnchorProbeOutcome({ expected: 'mastered', passed: false })).toEqual({
      falsified: true,
      signal: 'false_mastery',
    });
  });

  it('期望挣扎却通过 → false_struggle（证伪）', () => {
    expect(evaluateAnchorProbeOutcome({ expected: 'struggling', passed: true })).toEqual({
      falsified: true,
      signal: 'false_struggle',
    });
  });

  it('期望与结果相符 → consistent（未证伪）', () => {
    expect(evaluateAnchorProbeOutcome({ expected: 'mastered', passed: true })).toEqual({
      falsified: false,
      signal: 'consistent',
    });
    expect(evaluateAnchorProbeOutcome({ expected: 'struggling', passed: false })).toEqual({
      falsified: false,
      signal: 'consistent',
    });
  });

  it('passed 为 null/undefined（判分缺失）→ inconclusive（不计证伪也不计一致）', () => {
    expect(evaluateAnchorProbeOutcome({ expected: 'mastered', passed: null })).toEqual({
      falsified: false,
      signal: 'inconclusive',
    });
    expect(evaluateAnchorProbeOutcome({ expected: 'struggling', passed: undefined })).toEqual({
      falsified: false,
      signal: 'inconclusive',
    });
  });
});

describe('utcNaturalDayDiff（UTC 自然日差）', () => {
  it('按 UTC 日界取整：跨小时但同日为 0，跨到次日为 1', () => {
    expect(utcNaturalDayDiff('2026-09-01T23:00:00.000Z', '2026-09-01T23:59:00.000Z')).toBe(0);
    expect(utcNaturalDayDiff('2026-09-01T23:00:00.000Z', '2026-09-02T00:10:00.000Z')).toBe(1);
    expect(utcNaturalDayDiff('2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z')).toBe(7);
  });

  it('夏令时/本地时区不参与：恒为 UTC 日差；未来时间为 0（不清负）', () => {
    // 本地（运行环境）时区无关：同一时刻不同写法结果一致
    expect(utcNaturalDayDiff(new Date('2026-09-01T12:00:00Z'), Date.parse('2026-09-10T00:00:00Z'))).toBe(9);
    expect(utcNaturalDayDiff('2026-09-10T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe(0);
  });

  it('任一输入非法/缺失 → null（无信息，不误判到点）', () => {
    expect(utcNaturalDayDiff(null, Date.now())).toBeNull();
    expect(utcNaturalDayDiff('not-a-date', Date.now())).toBeNull();
    expect(utcNaturalDayDiff(Date.now(), Number.NaN)).toBeNull();
  });
});

describe('selectDelayedAnchorCandidates（Q8 延迟锚题：自然日间隔门 + 目标选择）', () => {
  const NOW = '2026-09-19T12:00:00.000Z';
  const completed = (
    conceptKey: string,
    completedAt: string,
    over: Partial<AnchorCompletedCandidate> = {},
  ): AnchorCompletedCandidate => ({ conceptKey, completedAt, ...over });

  it('间隔门：不足 N 天不选，达到/超过 N 天选中并带 intervalDays', () => {
    const candidates = [
      completed('too-soon', '2026-09-13T12:00:00.000Z'), // 6 天
      completed('just-due', '2026-09-12T12:00:00.000Z'), // 7 天
      completed('overdue', '2026-09-01T12:00:00.000Z'), // 18 天
    ];
    const plans = selectDelayedAnchorCandidates(candidates, { now: NOW, minIntervalDays: 7, limit: 3 });
    expect(plans.map((p) => p.conceptKey)).toEqual(['overdue', 'just-due']);
    expect(plans[0]).toMatchObject({ expected: 'mastered', kind: 'delayed', intervalDays: 18 });
    expect(plans[1].intervalDays).toBe(7);
  });

  it('默认间隔为 7 天；最久未接触者优先，同间隔用 conceptKey 字典序兜底（确定性）', () => {
    const candidates = [
      completed('b', '2026-09-05T00:00:00.000Z'), // 14 天
      completed('a', '2026-09-05T00:00:00.000Z'), // 14 天
      completed('c', '2026-09-18T00:00:00.000Z'), // 1 天 → 排除
      completed('old', '2026-08-20T00:00:00.000Z'), // 30 天
    ];
    const plans = selectDelayedAnchorCandidates(candidates, { now: NOW, limit: 3 });
    expect(ANCHOR_PROBE_DEFAULT_DELAYED_DAYS).toBe(7);
    expect(plans.map((p) => p.conceptKey)).toEqual(['old', 'a', 'b']);
    // 输入顺序无关
    const reversed = selectDelayedAnchorCandidates([...candidates].reverse(), { now: NOW, limit: 3 });
    expect(reversed.map((p) => p.conceptKey)).toEqual(plans.map((p) => p.conceptKey));
  });

  it('无目标：空输入 / 非法 completedAt / 全部未到间隔 → 空数组', () => {
    expect(selectDelayedAnchorCandidates([], { now: NOW })).toEqual([]);
    expect(selectDelayedAnchorCandidates([
      completed('bad-time', 'not-a-date'),
      completed('  ', '2026-09-01T00:00:00.000Z'),
      completed('fresh', '2026-09-19T00:00:00.000Z'),
    ], { now: NOW })).toEqual([]);
  });

  it('now 非法 → 空数组（不依赖系统时钟）', () => {
    expect(selectDelayedAnchorCandidates([completed('x', '2026-01-01T00:00:00.000Z')], { now: 'nope' })).toEqual([]);
    expect(selectDelayedAnchorCandidates([completed('x', '2026-01-01T00:00:00.000Z')], { now: Number.NaN })).toEqual([]);
  });

  it('全局冷却：最近一次锚题距今不足最小间隔 → 不投放（避免同窗口重复）', () => {
    const candidates = [completed('stale', '2026-08-01T00:00:00.000Z')];
    // lastProbeAt 3 天前（< 7）→ 冷却
    expect(selectDelayedAnchorCandidates(candidates, {
      now: NOW,
      lastProbeAt: '2026-09-16T12:00:00.000Z',
    })).toEqual([]);
    // lastProbeAt 8 天前（≥ 7）→ 可投放
    expect(selectDelayedAnchorCandidates(candidates, {
      now: NOW,
      lastProbeAt: '2026-09-11T12:00:00.000Z',
    })).toHaveLength(1);
    // 从未投放 → 可投放
    expect(selectDelayedAnchorCandidates(candidates, { now: NOW, lastProbeAt: null })).toHaveLength(1);
  });

  it('limit 钳制：默认 1，下限 1、硬上限 3', () => {
    const many = ['a', 'b', 'c', 'd'].map((k) => completed(k, '2026-08-01T00:00:00.000Z'));
    expect(selectDelayedAnchorCandidates(many, { now: NOW })).toHaveLength(1);
    expect(selectDelayedAnchorCandidates(many, { now: NOW, limit: 0 })).toHaveLength(1);
    expect(selectDelayedAnchorCandidates(many, { now: NOW, limit: 99 })).toHaveLength(3);
    expect(selectDelayedAnchorCandidates(many, { now: NOW, limit: Number.NaN })).toHaveLength(1);
  });
});

describe('partitionDelayedAnchorCandidates（C：跨时钟域防御，跳过即留痕）', () => {
  const NOW = '2026-09-08T23:59:59.999Z'; // 模拟日 now；真墙钟时间戳（09-19）会晚于它
  const completed = (
    conceptKey: string,
    completedAt: string,
    over: Partial<AnchorCompletedCandidate> = {},
  ): AnchorCompletedCandidate => ({ conceptKey, completedAt, ...over });

  it('候选时间晚于 now（真墙钟混入模拟时钟）→ 跳过并带 future-timestamp 标签，不产出计划', () => {
    const selection = partitionDelayedAnchorCandidates(
      [completed('真钟点', '2026-09-19T05:00:00.000Z')],
      { now: NOW, minIntervalDays: 7 },
    );
    expect(selection.plans).toEqual([]);
    expect(selection.cooldown).toBe(false);
    expect(selection.skipped).toEqual([
      {
        conceptKey: '真钟点',
        completedAt: '2026-09-19T05:00:00.000Z',
        intervalDays: null,
        reason: 'future-timestamp',
      },
    ]);
    // 旧路径（selectDelayedAnchorCandidates）语义不变：同样不投放（但不再能区分原因）
    expect(selectDelayedAnchorCandidates([completed('真钟点', '2026-09-19T05:00:00.000Z')], {
      now: NOW,
      minIntervalDays: 7,
    })).toEqual([]);
  });

  it('非法时间 → invalid-time；未到间隔 → below-min-days；达到间隔 → plans', () => {
    const selection = partitionDelayedAnchorCandidates(
      [
        completed('坏时间', 'not-a-date'),
        completed('新点', '2026-09-08T00:00:00.000Z'),
        completed('老点', '2026-09-01T00:00:00.000Z'),
      ],
      { now: NOW, minIntervalDays: 7, limit: 3 },
    );
    expect(selection.plans.map((p) => p.conceptKey)).toEqual(['老点']);
    expect(selection.plans[0]).toMatchObject({ kind: 'delayed', intervalDays: 7, expected: 'mastered' });
    const byKey = Object.fromEntries(selection.skipped.map((item) => [item.conceptKey, item.reason]));
    expect(byKey).toEqual({ 坏时间: 'invalid-time', 新点: 'below-min-days' });
  });

  it('全局冷却时 cooldown=true 且不产出候选诊断（与旧语义一致：整体不投放）', () => {
    const selection = partitionDelayedAnchorCandidates(
      [completed('老点', '2026-09-01T00:00:00.000Z')],
      { now: NOW, minIntervalDays: 7, lastProbeAt: '2026-09-07T00:00:00.000Z' },
    );
    expect(selection).toEqual({ plans: [], skipped: [], cooldown: true });
  });
});
