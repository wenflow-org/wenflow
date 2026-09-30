/**
 * 日槽位钳制（2026-09-30 广度跑批 + 校内维度 G 评审实证）。
 *
 * rw-school5-06：学习者自述每天 30 分钟，但自由文本 timePerSession 是「周末能到两小时」，
 * 分钟档被推成 [36,120]，阶段 3 出现 90 分钟单课——家长按半小时排时间，打开课不可执行，
 * 直接违反提示词「单课必须能在用户一次学习坐姿里上完」的硬规则。
 *
 * 规则：结构化日槽位（timeDimensions.sessionsLengthMin）存在时，课分钟档上界不得越过它。
 * 周末长块是学习者自己的选择，不是默认课长；无结构化字段时行为与原先完全一致。
 */
import { derivePlanningHints } from '../path-planning-hints';

function hints(timePerSession: string | null, timeDimensions: Record<string, number> | null) {
  return derivePlanningHints(
    null, timePerSession, null, null, [],
    timeDimensions ? { ...timeDimensions } : null, null, null, null,
  );
}

describe('课分钟档上界钳制到结构化日槽位', () => {
  it('自由文本「周末能到两小时」+ 日槽 30 分钟 → 上界 30（不可执行单课不再出现）', () => {
    const h = hints('周末能到两小时', { totalWeeks: 9, sessionsPerWeek: 5, sessionsLengthMin: 30 });
    expect(h.subtaskMinutesRange[1]).toBe(30);
    expect(h.subtaskMinutesRange[0]).toBeLessThanOrEqual(30);
  });

  it('自由文本与日槽一致时不变（每天1小时 + 60 → 60）', () => {
    const h = hints('每天1小时', { totalWeeks: 12, sessionsPerWeek: 5, sessionsLengthMin: 60 });
    expect(h.subtaskMinutesRange[1]).toBe(60);
  });

  it('无结构化字段时照旧认自由文本（行为不变）', () => {
    const h = hints('每次2小时', null);
    expect(h.subtaskMinutesRange[1]).toBe(120);
  });

  it('20 分钟早读槽位不被抬升（下限随上界收）', () => {
    const h = hints('周末能到一小时', { totalWeeks: 8, sessionsPerWeek: 5, sessionsLengthMin: 20 });
    expect(h.subtaskMinutesRange[1]).toBe(20);
    expect(h.subtaskMinutesRange[0]).toBeLessThanOrEqual(20);
  });

  it('CPA 型：日槽 120 分钟不变（不误伤大块学习者）', () => {
    const h = hints('每次2小时', { totalWeeks: 52, estimatedHours: 416, sessionsPerWeek: 4, sessionsLengthMin: 120 });
    expect(h.subtaskMinutesRange[1]).toBe(120);
  });
});
