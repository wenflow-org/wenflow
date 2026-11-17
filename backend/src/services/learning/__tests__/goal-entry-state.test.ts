/**
 * entry_state / intent_type 透传（2026-11-17 进入态改造）。
 *
 * goal 层把「这次进入的确定度」写进 understanding.entry_state；path 层必须能拿到，
 * 否则 path-planning / path-reviewer / path-task-design 无法区分起步路径与完整路径
 * （此前 intent_type 就漏在 visibleSummary → normalizedInput 这一步）。
 */
import { buildGoalPathVisibleSummary } from '../goal-path-visible-summary';

describe('buildGoalPathVisibleSummary：entry_state / intent_type 透传', () => {
  it('exploratory 与 intent_type 原样带出', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: {
        surface_goal: '想系统了解王阳明心学，不为了考试',
        entry_state: 'exploratory',
        intent_type: 'mastery',
      },
    });
    expect(visible.entryState).toBe('exploratory');
    expect(visible.intentType).toBe('mastery');
  });

  it('focused 原样带出', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { surface_goal: '审查劳动合同', entry_state: 'focused', intent_type: 'problem-fix' },
    });
    expect(visible.entryState).toBe('focused');
    expect(visible.intentType).toBe('problem-fix');
  });

  it('非法/缺失 entry_state → null（下游按现有行为处理）', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { surface_goal: 'x', entry_state: 'unknown', intent_type: undefined },
    });
    expect(visible.entryState).toBeNull();
    expect(visible.intentType).toBeNull();
  });
});
