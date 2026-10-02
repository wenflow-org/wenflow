/**
 * A/B prompt 变体分流选择器单测（2026-10-01）
 *
 * 覆盖：旧行为零变化（无变体/无 key → 基线）、override 钉变体与诚实回退、
 * 权重分流命中率与稳定性、基线缺失兜底、分桶函数确定性。
 */
import { variantBucket, pickActivePromptRow, type ActivePromptRow } from '../agentConfig.service';

function row(partial: Partial<ActivePromptRow> & { id: string; version: number }): ActivePromptRow {
  return { variant: null, trafficWeight: null, ...partial } as ActivePromptRow;
}

const BASE = row({ id: 'base', version: 7 });
const VARIANT_B = row({ id: 'b', version: 8, variant: 'B', trafficWeight: 30 });
const VARIANT_C = row({ id: 'c', version: 9, variant: 'C', trafficWeight: 20 });

describe('prompt 变体分流选择器', () => {
  test('无变体时永远取基线（旧行为零变化）', () => {
    expect(pickActivePromptRow([BASE], 'skill:stage-designer', { selectionKey: 'u1' })?.id).toBe('base');
    expect(pickActivePromptRow([BASE], 'skill:stage-designer', {})?.id).toBe('base');
  });

  test('多行 ACTIVE 且无 selectionKey → 基线（不会意外进实验）', () => {
    const picked = pickActivePromptRow([BASE, VARIANT_B, VARIANT_C], 'skill:x', {});
    expect(picked?.id).toBe('base');
  });

  test('variantOverride 命中 → 钉住该变体（评测对照波次用）', () => {
    expect(pickActivePromptRow([BASE, VARIANT_B], 'skill:x', { variantOverride: 'B' })?.id).toBe('b');
  });

  test('variantOverride 指向不存在的变体 → 诚实回退基线，不换内容', () => {
    expect(pickActivePromptRow([BASE, VARIANT_B], 'skill:x', { variantOverride: 'Z' })?.id).toBe('base');
  });

  test('同 selectionKey 永远命中同一行（稳定性）', () => {
    for (let i = 0; i < 20; i++) {
      const k = `user_${i}`;
      const first = pickActivePromptRow([BASE, VARIANT_B, VARIANT_C], 'skill:x', { selectionKey: k });
      const again = pickActivePromptRow([BASE, VARIANT_B, VARIANT_C], 'skill:x', { selectionKey: k });
      expect(again?.id).toBe(first?.id);
    }
  });

  test('权重分流命中率贴近配置（±8pp，n=2000）', () => {
    let b = 0, c = 0, base = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const picked = pickActivePromptRow([BASE, VARIANT_B, VARIANT_C], 'skill:x', { selectionKey: `user_${i}` });
      if (picked!.id === 'b') b++;
      else if (picked!.id === 'c') c++;
      else base++;
    }
    expect(b / N).toBeGreaterThan(0.30 - 0.08);
    expect(b / N).toBeLessThan(0.30 + 0.08);
    expect(c / N).toBeGreaterThan(0.20 - 0.08);
    expect(c / N).toBeLessThan(0.20 + 0.08);
    expect(base / N).toBeGreaterThan(0.50 - 0.08);
  });

  test('weight=0 的变体不接流量', () => {
    const zero = row({ id: 'z', version: 10, variant: 'Z', trafficWeight: 0 });
    for (let i = 0; i < 200; i++) {
      expect(pickActivePromptRow([BASE, zero], 'skill:x', { selectionKey: `u${i}` })?.id).toBe('base');
    }
  });

  test('不同 agentId 的分桶相互独立（不串流量）', () => {
    const a = pickActivePromptRow([BASE, VARIANT_B], 'skill:goal-conversation', { selectionKey: 'u1' });
    const b = pickActivePromptRow([BASE, VARIANT_B], 'skill:stage-designer', { selectionKey: 'u1' });
    // 只要求“各自稳定”，不要求不同——但至少两者都返回合法行
    expect([BASE.id, VARIANT_B.id]).toContain(a?.id);
    expect([BASE.id, VARIANT_B.id]).toContain(b?.id);
  });

  test('基线缺失（异常数据）→ 兜底最高版本行，服务不裸奔', () => {
    expect(pickActivePromptRow([VARIANT_B, VARIANT_C], 'skill:x', {})?.id).toBe('c');
  });

  test('空集合 → null', () => {
    expect(pickActivePromptRow([], 'skill:x', { selectionKey: 'u1' })).toBeNull();
  });

  test('variantBucket 确定性且值域 [0,100)', () => {
    const v1 = variantBucket('skill:x', 'user_1');
    const v2 = variantBucket('skill:x', 'user_1');
    expect(v1).toBe(v2);
    for (let i = 0; i < 500; i++) {
      const v = variantBucket('skill:x', `u${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });
});
