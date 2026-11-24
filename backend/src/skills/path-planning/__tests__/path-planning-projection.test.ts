import { buildPromptFriendlyNormalizedInput } from '../index';

/**
 * 2026-11-24 时间降维：path-planning 的提示词投影只保留两条物理边界
 * （sessionsLengthMin / deadlineDate），不再把总学时、周数、阶段锚、任务分钟配额送进模型。
 */
describe('时间降维 · path-planning 提示词只带单次坐姿与截止日', () => {
  const base = {
    version: '1.0',
    learnerProfile: { surfaceGoal: 'g' },
    problemSpace: {},
    resources: {},
    successCriteria: {},
    confirmedProposal: null,
    planningHints: null,
  };

  it('timeDimensions 只保留 sessionsLengthMin / deadlineDate / timeModelVersion', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      timeDimensions: {
        timeModelVersion: 2,
        sessionsLengthMin: 60,
        objectiveScopeHours: 18,
        deadlineDate: '2027-01-05',
        scopeAnchorHours: 18,
        calendarCapacityHours: 120,
        totalSessions: 30,
      },
    } as any);
    const td = built.normalizedInput.timeDimensions as Record<string, unknown>;
    expect(td.sessionsLengthMin).toBe(60);
    expect(td.deadlineDate).toBe('2027-01-05');
    expect(td.timeModelVersion).toBe(2);
    expect(td).not.toHaveProperty('objectiveScopeHours');
    expect(td).not.toHaveProperty('scopeAnchorHours');
    expect(td).not.toHaveProperty('calendarCapacityHours');
    expect(td).not.toHaveProperty('totalSessions');
  });

  it('resources.deadlineDate 也进入提示词（与 timeDimensions 同源）', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      resources: { deadlineDate: '2027-01-05' },
      timeDimensions: { timeModelVersion: 2, deadlineDate: '2027-01-05' },
    });
    expect(built!.normalizedInput.resources.deadlineDate).toBe('2027-01-05');
  });

  it('planningHints 只给内容边界与单次分钟盒，不带学时/任务数配额', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      planningHints: {
        paceSignal: 'standard',
        scopeSize: 'medium',
        milestoneRange: [3, 5],
        conceptRange: [2, 4],
        subtasksPerStageRange: [2, 4],
        subtaskMinutesRange: [30, 60],
        maxWeeks: 52,
        maxWeeksSource: 'hard_cap',
        targetMilestones: 3,
        targetSubtasksPerStage: 4,
        targetTotalHours: 27,
        targetHoursPerMilestone: 9,
        targetMinutesPerTask: 45,
      },
    } as any);
    const hints = built!.normalizedInput.planningHints as Record<string, unknown>;
    expect(hints.scopeSize).toBe('medium');
    expect(hints.milestoneRange).toEqual([3, 5]);
    expect(hints.conceptRange).toEqual([2, 4]);
    expect(hints.subtaskMinutesRange).toEqual([30, 60]);
    expect(hints).not.toHaveProperty('targetTotalHours');
    expect(hints).not.toHaveProperty('targetHoursPerMilestone');
    expect(hints).not.toHaveProperty('targetMinutesPerTask');
    expect(hints).not.toHaveProperty('targetMilestones');
    expect(hints).not.toHaveProperty('targetSubtasksPerStage');
    expect(hints).not.toHaveProperty('maxWeeks');
    expect(hints).not.toHaveProperty('maxWeeksSource');
    expect(hints).not.toHaveProperty('paceSignal');
  });
});
