/**
 * 独立锚题探针（Q13 / B4）：纯决策层。这里只测**确定性**——
 * 选择排序/上限/去重、排期闸门（检查点优先、间隔/轮次/退避）、结果归因与确定性。
 */
import {
  ANCHOR_PROBE_DEFAULT_LIMIT,
  ANCHOR_PROBE_INTERVAL_MS,
  ANCHOR_PROBE_MAX_PROBES_SINCE_FLAG,
  ANCHOR_PROBE_MIN_TURNS_BETWEEN,
  evaluateAnchorProbeOutcome,
  selectAnchorCandidates,
  shouldRunAnchorProbe,
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
