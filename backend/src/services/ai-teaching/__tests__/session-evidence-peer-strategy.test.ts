import { computeSessionEvidence, pickPeerStrategy, shouldEmitCheckpoint } from '../AITeachingCoordinator';

/**
 * 回归（审计 §3.19）：
 * - P0③：`session-wrapup` 的规则声明了"loadIndex 均值与峰值"，但 `computeSessionEvidence` 此前不产出该字段。
 * - P0②：伴学策略此前两处硬编码 `'feynman'`，使 skill 规则 38 的按层级选手法永不触发。
 */
const asSession = (value: unknown) => value as Parameters<typeof computeSessionEvidence>[0];

describe('wrapup 会话证据：loadIndex 均值与峰值（P0③）', () => {
  it('从逐回合 analysis.loadIndex 聚合；检查点合成消息不计入', () => {
    const evidence = computeSessionEvidence(
      asSession({
        messages: [
          { role: 'user', analysis: { understanding: 0.5, loadIndex: 0.2 } },
          { role: 'assistant', analysis: { understanding: 0.6, loadIndex: 0.9 } },
          { role: 'user', checkpoint: true, analysis: { understanding: 0.1, loadIndex: 0.1 } },
          { role: 'user' }, // 无 analysis：不参与统计
        ],
      }),
    );
    expect(evidence.avgLoadIndex).toBeCloseTo(0.55, 3);
    expect(evidence.maxLoadIndex).toBe(0.9);
  });

  it('没有 loadIndex 数据时为 null（不编数）', () => {
    const evidence = computeSessionEvidence(asSession({ messages: [] }));
    expect(evidence.avgLoadIndex).toBeNull();
    expect(evidence.maxLoadIndex).toBeNull();
  });
});

describe('wrapup 会话证据：解法尝试台账 rsmAttempts（2026-09-17 起被消费）', () => {
  it('汇总逐回合的 rsmAttempts，最多最近 5 条，且过滤空 method', () => {
    const evidence = computeSessionEvidence(
      asSession({
        messages: [
          { role: 'assistant', analysis: { understanding: 0.5, rsmAttempts: [{ method: '顺推法', outcome: '失败', evidence: '3 天' }] } },
          { role: 'user', analysis: { understanding: 0.6, rsmAttempts: [{ method: '  ', outcome: 'x' }, { method: '逆推法', outcome: '成功', evidence: '5 天' }] } },
        ],
      }),
    );
    expect(evidence.rsmAttempts).toEqual([
      { method: '顺推法', outcome: '失败', evidence: '3 天' },
      { method: '逆推法', outcome: '成功', evidence: '5 天' },
    ]);
  });

  it('没有台账时字段缺失（wrapup 规则据此走常规总结，不编造尝试）', () => {
    const evidence = computeSessionEvidence(asSession({ messages: [{ role: 'user', analysis: { understanding: 0.5 } }] }));
    expect(evidence.rsmAttempts).toBeUndefined();
  });

  it('超过 5 条只保留最近 5 条', () => {
    const rsmAttempts = Array.from({ length: 8 }, (_, i) => ({ method: `方法${i + 1}`, outcome: 'x', evidence: 'y' }));
    const evidence = computeSessionEvidence(asSession({ messages: [{ role: 'assistant', analysis: { rsmAttempts } }] }));
    expect(evidence.rsmAttempts).toHaveLength(5);
    expect(evidence.rsmAttempts![0].method).toBe('方法4');
  });
});

describe('shouldEmitCheckpoint：出题触发由代码给（2026-09-17）', () => {
  const session = (understanding: number | null, messageCount = 10) => ({
    messages: [
      ...Array.from({ length: Math.max(0, messageCount - 1) }, () => ({ role: 'user' as const })),
      { role: 'assistant' as const, ...(understanding === null ? {} : { analysis: { understanding } }) },
    ],
  });

  it('无待处理题 + 有进展 + 不在收尾 → 出题', () => {
    expect(shouldEmitCheckpoint(session(0.8), {})).toBe(true);
  });

  it('已有待处理检查点 → 不出（不堆题）', () => {
    expect(shouldEmitCheckpoint(session(0.8), { pendingCheckpoint: { id: 'cp1' } })).toBe(false);
  });

  it('距上次检查点不足 4 条消息 → 不出（与事后门一致）', () => {
    expect(shouldEmitCheckpoint(session(0.8, 10), { lastCheckpointTurn: 8 })).toBe(false);
    expect(shouldEmitCheckpoint(session(0.8, 10), { lastCheckpointTurn: 5 })).toBe(true);
  });

  it('收尾阶段 → 不出', () => {
    expect(shouldEmitCheckpoint(session(0.8), { classroomContext: { stage: { current: 'ready_to_close' } } })).toBe(false);
    expect(shouldEmitCheckpoint(session(0.8), { classroomContext: { stage: { current: 'wrapup' } } })).toBe(false);
  });

  it('上一轮没有进展（understanding < 0.6 或缺失）→ 不出', () => {
    expect(shouldEmitCheckpoint(session(0.4), {})).toBe(false);
    expect(shouldEmitCheckpoint(session(null), {})).toBe(false);
  });
});

describe('伴学策略由认知层级决定（P0②）', () => {
  it('analyze/evaluate/create → debate；apply → counterexample；其余/未知 → analogy', () => {
    expect(pickPeerStrategy('analyze')).toBe('debate');
    expect(pickPeerStrategy('Evaluate')).toBe('debate');
    expect(pickPeerStrategy('create')).toBe('debate');
    expect(pickPeerStrategy('apply')).toBe('counterexample');
    expect(pickPeerStrategy('understand')).toBe('analogy');
    expect(pickPeerStrategy('remember')).toBe('analogy');
    expect(pickPeerStrategy(undefined)).toBe('analogy');
    expect(pickPeerStrategy('')).toBe('analogy');
  });
});
