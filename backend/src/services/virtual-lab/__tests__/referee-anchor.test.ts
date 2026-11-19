import { selectRefereeAnchorSample, summarizeRefereeAnchorAgreement, type RefereeAnchorSample } from '../referee-anchor';

const sample = (id: string, verdict: string, overall: number | null): RefereeAnchorSample => ({
  sessionId: id,
  runId: 'run',
  reportId: `vref_${id}`,
  verdict,
  overall,
  scores: {},
  findings: [],
});

describe('referee 人工锚点抽样', () => {
  it('确定性均匀抽样：同输入同输出、等距覆盖', () => {
    const all = Array.from({ length: 10 }, (_, i) => sample(`s${i}`, 'pass', 80));
    const a = selectRefereeAnchorSample(all, 3);
    const b = selectRefereeAnchorSample([...all].reverse(), 3);
    expect(a.map((x) => x.sessionId)).toEqual(b.map((x) => x.sessionId));
    expect(a).toHaveLength(3);
    expect(a[0].sessionId).toBe('s0');
    expect(a[2].sessionId).toBe('s9');
  });

  it('不足 limit → 全量；非法 limit 回落到 1', () => {
    expect(selectRefereeAnchorSample([sample('s1', 'pass', 1)], 5)).toHaveLength(1);
    expect(selectRefereeAnchorSample([sample('s1', 'pass', 1), sample('s2', 'fail', 2)], 0)).toHaveLength(1);
  });

  it('人工标签：verdict 一致率 + overall MAE，无标签跳过', () => {
    const samples = [
      { ...sample('s1', 'pass', 80), human: { verdict: 'pass', overall: 70 } },
      { ...sample('s2', 'fail', 40), human: { verdict: 'pass', overall: 50 } },
      sample('s3', 'pass', 90),
    ];
    expect(summarizeRefereeAnchorAgreement(samples)).toEqual({
      labeled: 2,
      verdictCompared: 2,
      verdictAgreement: 0.5,
      overallCompared: 2,
      meanAbsOverallError: 10,
    });
    expect(summarizeRefereeAnchorAgreement([sample('s1', 'pass', 80)])).toEqual({
      labeled: 0,
      verdictCompared: 0,
      verdictAgreement: null,
      overallCompared: 0,
      meanAbsOverallError: null,
    });
  });
});
