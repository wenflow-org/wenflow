/**
 * `summarizeCheckpointHistory` —— 检查点历史摘要（2026-09-17 起被消费）
 *
 * 背景（审计 §5.2 P2）：`checkpointHistory` 此前只写不读（`push + slice(-20)` 之后没有任何消费者）。
 * 现在注入 teaching-turn 的 `scenario.checkpointHistory`，让模型知道哪些点没通过、好换表征再确认。
 * 这里钉住摘要的**形状与边界**：无记录 → null（模型据此不改变默认行为）；有记录 → 计数 + 最近 5 条。
 */
import { summarizeCheckpointHistory } from '../AITeachingCoordinator';

describe('summarizeCheckpointHistory', () => {
  it('无记录 / 非数组 → null（模型不改默认行为）', () => {
    expect(summarizeCheckpointHistory(undefined)).toBeNull();
    expect(summarizeCheckpointHistory([])).toBeNull();
    expect(summarizeCheckpointHistory('nope')).toBeNull();
  });

  it('计数正确：通过 / 未通过 / 跳过三类互斥', () => {
    const summary = summarizeCheckpointHistory([
      { checkpointId: 'cp1', title: '哪句是直接证据？', passed: false, understanding: 0.2 },
      { checkpointId: 'cp2', title: '主张是什么？', passed: true, understanding: 0.8 },
      { checkpointId: 'cp3', title: '跳过的那题', passed: false, skipped: true },
    ]);
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it('recent 只带最近 5 条，且 title 缺失时回落到 checkpointId', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      checkpointId: `cp${i + 1}`,
      passed: i % 2 === 0,
    }));
    const summary = summarizeCheckpointHistory(rows)!;
    expect(summary.total).toBe(8);
    expect(summary.recent).toHaveLength(5);
    expect(summary.recent[0].title).toBe('cp4');
    expect(summary.recent[4].title).toBe('cp8');
  });

  it('skip 行同时带 skipped 标记（不与"答错"混为一谈）', () => {
    const summary = summarizeCheckpointHistory([
      { checkpointId: 'cp1', title: 'A', passed: false, skipped: true },
    ])!;
    expect(summary.recent[0]).toMatchObject({ passed: false, skipped: true });
  });
});