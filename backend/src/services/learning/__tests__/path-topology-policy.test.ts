import { resolvePathTopologyPolicy } from '../path-topology-policy';

describe('拓扑策略单一来源', () => {
  it('subject：透镜互异、豁免 stopping、阶段锚只到单元', () => {
    const policy = resolvePathTopologyPolicy('subject');
    expect(policy.requiresUniqueStageLens).toBe(true);
    expect(policy.requiresStoppingRationale).toBe(false);
    expect(policy.requiresHubReuseInLaterStages).toBe(false);
    expect(policy.stageGoalUnitAnchorOnly).toBe(true);
    expect(policy.deliverableFromLastStage).toBe(false);
  });

  it('builder：单作品收口，允许 hub 回捞，交付物取末阶段', () => {
    const policy = resolvePathTopologyPolicy('builder');
    expect(policy.requiresUniqueStageLens).toBe(false);
    expect(policy.requiresHubReuseInLaterStages).toBe(true);
    expect(policy.deliverableFromLastStage).toBe(true);
    expect(policy.requiresStoppingRationale).toBe(true);
  });

  it('缺省/非法拓扑回退 diagnostic，不再散落默认值', () => {
    const fallback = resolvePathTopologyPolicy(undefined);
    expect(fallback).toEqual(resolvePathTopologyPolicy('diagnostic'));
    expect(resolvePathTopologyPolicy('whatever')).toEqual(resolvePathTopologyPolicy('diagnostic'));
  });
});
