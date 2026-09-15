import {
  PAYLOAD_STABILITY,
  isFirstKeyStable,
  validateStabilityMap,
} from '../payload-stability';

describe('payload 稳定前缀 SSOT', () => {
  it('声明表自洽：每项 stable 非空且无重复键', () => {
    expect(validateStabilityMap()).toEqual([]);
  });

  it('已声明 skill：首键落稳定段内为真，易变键前置为假', () => {
    expect(isFirstKeyStable('teaching-turn', 'scenario')).toBe(true);
    expect(isFirstKeyStable('teaching-turn', 'classroomEventContext')).toBe(false);
    expect(isFirstKeyStable('stage-designer', 'cognitiveCore')).toBe(true);
    expect(isFirstKeyStable('stage-designer', 'milestone')).toBe(false);
  });

  it('未声明 skill 不参与护栏（恒为真）；空首键为假', () => {
    expect(isFirstKeyStable('some-unlisted-skill', 'anything')).toBe(true);
    expect(isFirstKeyStable('teaching-turn', undefined)).toBe(false);
  });

  it('声明覆盖本轮完成前缀改造的 skill', () => {
    for (const skillId of [
      'teaching-turn',
      'stage-designer',
      'path-reviewer',
      'adaptive-guidance-copy',
      'virtual-learner-learn-turn-simulator',
      'virtual-learner-goal-dialogue-simulator',
      'virtual-learner-path-evaluator',
      'virtual-learner-persona-designer',
      'teaching-opening-generator',
      'learner-progress-report',
      'learning-predictor',
    ]) {
      expect(PAYLOAD_STABILITY[skillId]).toBeDefined();
    }
  });
});
