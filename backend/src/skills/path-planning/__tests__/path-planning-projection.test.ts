import { buildPromptFriendlyNormalizedInput } from '../index';

/**
 * R8（2026-10-27）：path-planning 的提示词投影是逐字段白名单重建。
 * 既有实现只透传 totalWeeks/estimatedHours/sessionsPerWeek/sessionsLengthMin，
 * 把 objectiveScopeHours / deadlineDate / scopeAnchorHours 全丢掉 ⇒
 * `prompts/core/path-planning.yaml` 里的新锚规则是死引用。
 */
describe('R8 · path-planning 提示词投影必须带内容体量锚 / 截止日', () => {
  const base = {
    version: '1.0',
    learnerProfile: { surfaceGoal: 'g' },
    problemSpace: {},
    resources: {},
    successCriteria: {},
    confirmedProposal: null,
    planningHints: null,
  };

  it('timeDimensions 的 R8 权威字段进入提示词', () => {
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
    });
    const td = built.normalizedInput.timeDimensions;
    expect(td.objectiveScopeHours).toBe(18);
    expect(td.deadlineDate).toBe('2027-01-05');
    expect(td.timeModelVersion).toBe(2);
    expect(td.scopeAnchorHours).toBe(18);
    expect(td.calendarCapacityHours).toBe(120);
    expect(td.totalSessions).toBe(30);
    expect(td.sessionsLengthMin).toBe(60);
  });

  it('resources.deadlineDate 也进入提示词（与 timeDimensions 同源）', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      resources: { deadlineDate: '2027-01-05' },
      timeDimensions: { timeModelVersion: 2, deadlineDate: '2027-01-05' },
    });
    expect(built.normalizedInput.resources.deadlineDate).toBe('2027-01-05');
  });

  it('planningHints 的预算锚与 maxWeeksSource 进入提示词', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      planningHints: {
        paceSignal: 'standard',
        scopeSize: null,
        milestoneRange: [2, 4],
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
    });
    const hints = built.normalizedInput.planningHints;
    expect(hints.targetTotalHours).toBe(27);
    expect(hints.targetHoursPerMilestone).toBe(9);
    expect(hints.targetMinutesPerTask).toBe(45);
    expect(hints.maxWeeksSource).toBe('hard_cap');
  });
});
