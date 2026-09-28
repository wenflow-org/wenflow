/**
 * 课时充实度诚实声明单测（2026-09-29 通宵 R3）：
 * buildStageFillNote 纯函数——欠 fill 追加容量说明、达标/无锚/重复声明均不追加。
 * 触发场景实证：school-12 请求 11-12 课/阶段只回 5-9 课（锚 6.3h → 实付 1.5-4h）。
 */
import { buildStageFillNote, STAGE_FILL_DECLARE_RATIO } from '../stage-fill-note';

describe('buildStageFillNote', () => {
  it('欠 fill（实付 < 70% 锚）追加容量说明', () => {
    const note = buildStageFillNote(6.3, 2.5, '认识函数三要素');
    expect(note).toContain('容量说明');
    expect(note).toContain('约 6 小时');
    expect(note).toContain('约 3 小时');
    expect(note).toContain('认识函数三要素'); // 原描述保留在前
  });

  it('达标（实付 ≥ 70% 锚）不声明', () => {
    expect(buildStageFillNote(10, 7.1)).toBeNull();
    expect(buildStageFillNote(6.3, 6.3)).toBeNull();
  });

  it('边界恰好在阈值上不声明', () => {
    expect(buildStageFillNote(10, 10 * STAGE_FILL_DECLARE_RATIO)).toBeNull();
  });

  it('锚缺失/非法或实付缺失时不声明（无锚不承诺）', () => {
    expect(buildStageFillNote(null, 2)).toBeNull();
    expect(buildStageFillNote(0, 2)).toBeNull();
    expect(buildStageFillNote(6, null)).toBeNull();
    expect(buildStageFillNote(6, 0)).toBeNull();
  });

  it('幂等：已有容量说明不重复追加', () => {
    const existing = '阶段描述\n\n容量说明：本阶段按你的时间预算约 6 小时……';
    expect(buildStageFillNote(6, 2, existing)).toBeNull();
  });

  it('无原描述时声明自包含（不被覆盖丢失）', () => {
    const note = buildStageFillNote(8, 3, null);
    expect(note).toContain('容量说明');
    expect(note).toContain('约 8 小时');
  });
});
