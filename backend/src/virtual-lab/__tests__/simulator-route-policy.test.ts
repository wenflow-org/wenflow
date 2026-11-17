import { shouldFreezeSimulatorRoute } from '../simulator-route-policy';

describe('simulator-route-policy', () => {
  it('goal 阶段只冻结 goal-dialogue 模拟器', () => {
    expect(shouldFreezeSimulatorRoute('simulation-goal-dialogue', 'goal')).toBe(true);
    expect(shouldFreezeSimulatorRoute('simulation-learn-turn', 'goal')).toBe(false);
    expect(shouldFreezeSimulatorRoute('simulation-epistemic-grounding', 'goal')).toBe(false);
  });

  it('teaching 阶段只冻结 learn-turn 模拟器', () => {
    expect(shouldFreezeSimulatorRoute('simulation-learn-turn', 'teaching')).toBe(true);
    expect(shouldFreezeSimulatorRoute('simulation-goal-dialogue', 'teaching')).toBe(false);
  });

  it('旁路认知判决不得套用主模拟器的冻结路由（2026-11-13 7/7 降级回归）', () => {
    expect(shouldFreezeSimulatorRoute('simulation-epistemic-grounding', 'teaching')).toBe(false);
  });

  it('空名称/未知技能不冻结（走平台正常路由）', () => {
    expect(shouldFreezeSimulatorRoute('', 'teaching')).toBe(false);
    expect(shouldFreezeSimulatorRoute('skill:simulation-referee', 'teaching')).toBe(false);
  });
});
