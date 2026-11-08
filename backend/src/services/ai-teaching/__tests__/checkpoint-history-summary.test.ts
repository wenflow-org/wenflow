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

  // 2026-11-07 独立复核发现：作废行（control.voidCheckpoint）此前无 skipped 标记 → 被计成
  // failed 且落进 recent 的 passed:false，下一轮模型会被提示词指使「对 recent 里 passed=false
  // 的点换表征再确认」——把刚作废的题换个说法重问，正是作废通道要消除的形态。
  it('作废行（voided）不计入未通过、也不进 recent（不作再确认候选）', () => {
    const summary = summarizeCheckpointHistory([
      { checkpointId: 'cp1', title: '被作废的题', passed: false, voided: true },
      { checkpointId: 'cp2', title: '真没过的题', passed: false },
    ])!;
    expect(summary).toMatchObject({ total: 2, passed: 0, failed: 1, skipped: 0, voided: 1 });
    expect(summary.recent.map((r) => r.title)).toEqual(['真没过的题']);
    expect(summary.recent.some((r) => r.title === '被作废的题')).toBe(false);
  });

  it('只有作废行时 failed=0、recent 为空（模型没有被指使重问）', () => {
    const summary = summarizeCheckpointHistory([
      { checkpointId: 'cp1', title: 't', passed: false, voided: true },
    ])!;
    expect(summary).toMatchObject({ total: 1, passed: 0, failed: 0, skipped: 0, voided: 1 });
    expect(summary.recent).toEqual([]);
  });

  it('作废行不得让 failed 变成负数：四类互斥、total 恒等于四者之和', () => {
    // 脏行同时带 skipped+voided（过渡期/手工数据）也不得双扣到负
    const summary = summarizeCheckpointHistory([
      { checkpointId: 'cp1', title: '通过', passed: true },
      { checkpointId: 'cp2', title: '跳过', passed: false, skipped: true },
      { checkpointId: 'cp3', title: '作废', passed: false, voided: true },
      { checkpointId: 'cp4', title: '脏行', passed: false, skipped: true, voided: true },
    ])!;
    expect(summary.failed).toBeGreaterThanOrEqual(0);
    expect(summary.failed).toBe(0);
    expect(summary.passed + summary.failed + summary.skipped + summary.voided).toBe(summary.total);
  });
});