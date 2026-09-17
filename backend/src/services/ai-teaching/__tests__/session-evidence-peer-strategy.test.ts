import { computeSessionEvidence, pickPeerStrategy } from '../AITeachingCoordinator';

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
