import {
  PAYLOAD_STABILITY,
  isFirstKeyStable,
  isStablePrefix,
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

  it('迁移窗口：存量遥测的旧键序判合规，真回归仍被拦（teaching-turn retiredStable）', () => {
    // 旧键序（promptDirectives 尚在载荷里）→ 命中 retiredStable，不误报
    expect(isStablePrefix('teaching-turn', ['scenario', 'promptDirectives', 'learner', 'controls'])).toBe(true);
    // 新键序 → 命中 stable
    expect(isStablePrefix('teaching-turn', ['scenario', 'learner', 'controls'])).toBe(true);
    // 两段都不匹配的真回归（易变键前置）→ 仍为假，护栏没被削弱
    expect(isStablePrefix('teaching-turn', ['scenario', 'controls', 'learner'])).toBe(false);
    expect(isStablePrefix('teaching-turn', ['controls', 'scenario', 'learner'])).toBe(false);
    // 旧键序里把稳定键挪走 → 仍拦
    expect(isStablePrefix('teaching-turn', ['scenario', 'promptDirectives', 'controls', 'learner'])).toBe(false);
  });

  it('完整稳定段：声明的 stable 必须按序出现在最前面', () => {
    // teaching-turn 声明 ['scenario','learner']（promptDirectives 已于 2026-11-08 作为零引用键删除）
    expect(isStablePrefix('teaching-turn', ['scenario', 'learner', 'controls'])).toBe(true);
    // 第二个稳定键被挪走 → 首键检查会漏，完整段检查必须拦住
    expect(isStablePrefix('teaching-turn', ['scenario', 'controls', 'learner'])).toBe(false);
    // 键数不足声明长度 → 无法确认，判假
    expect(isStablePrefix('teaching-turn', ['scenario'])).toBe(false);
    // 未声明的 skill 不参与护栏
    expect(isStablePrefix('some-unlisted-skill', ['anything'])).toBe(true);
    // 声明长度不同：stage-designer = cognitiveCore → normalizedInput → materials
    expect(isStablePrefix('stage-designer', ['cognitiveCore', 'normalizedInput', 'materials', 'milestone'])).toBe(true);
    expect(isStablePrefix('stage-designer', ['cognitiveCore', 'materials', 'normalizedInput'])).toBe(false);
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
