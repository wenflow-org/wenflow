/**
 * R5-1 结构容量自适应单测（2026-09-29 凌晨）：
 * 大预算（长周期 × 每日时长）时 subtasksPerStageRange 上界必须按需抬升，
 * 且区间不得倒挂（旧代码 Math.min(14, needed) 夹回 14 + 下限公式产出 [18,14]）。
 * 根因案例：school-16（650h / 8 阶段 = 81h 每阶段，needed=54）。
 */
import { derivePlanningHints } from '../path-planning-hints';

function hintsFor(totalHours: number, stages: number, sessionMinutes = 90) {
  return derivePlanningHints(
    '到高考', `每天${sessionMinutes}分钟`, null, null,
    Array.from({ length: stages }, (_, i) => `S${i + 1}`),
    { estimatedHours: totalHours, totalWeeks: 36, sessionsLengthMin: sessionMinutes },
    'large', null, null,
  );
}

describe('derivePlanningHints 结构容量自适应（R5-1）', () => {
  it('school-16 型（650h/8 阶段）→ 课数上界抬过 14 且区间不倒挂', () => {
    const h = hintsFor(650, 8);
    expect(h.subtasksPerStageRange[0]).toBeLessThanOrEqual(h.subtasksPerStageRange[1]);
    expect(h.subtasksPerStageRange[1]).toBeGreaterThan(14);
    expect(h.subtasksPerStageRange[1]).toBeLessThanOrEqual(30);
    // 总容量应显著大于旧硬帽容量（8×14×90min=168h）的六成以上
    const capacityHours = 8 * h.subtasksPerStageRange[1] * h.subtaskMinutesRange[1] / 60;
    expect(capacityHours).toBeGreaterThan(168 * 0.6);
  });

  it('needed 超过 30 时封顶 30（防 filler 副作用），不倒挂', () => {
    const h = hintsFor(2000, 6, 90); // 2000h/6=333h/阶段 → needed=222
    expect(h.subtasksPerStageRange[1]).toBe(30);
    expect(h.subtasksPerStageRange[0]).toBeLessThanOrEqual(30);
    expect(h.subtasksPerStageRange[0]).toBeLessThanOrEqual(h.subtasksPerStageRange[1]);
  });

  it('小预算路径不受影响（不触发容量赤字，区间保持 scope 默认）', () => {
    const h = hintsFor(20, 3, 30);
    expect(h.subtasksPerStageRange[1]).toBeLessThanOrEqual(14);
    expect(h.subtasksPerStageRange[0]).toBeLessThanOrEqual(h.subtasksPerStageRange[1]);
  });

  it('保守档（micro/small）即使大预算也不被抬爆（scope 硬约束优先）', () => {
    const h = derivePlanningHints(
      '两个月', '每天90分钟', null, null, ['S1', 'S2'],
      { estimatedHours: 300 }, 'micro', null, null,
    );
    expect(h.subtasksPerStageRange[0]).toBeLessThanOrEqual(h.subtasksPerStageRange[1]);
  });
});
