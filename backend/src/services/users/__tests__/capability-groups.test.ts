/**
 * #218 回归护栏（#226 子项 3 口径下）：Profile 能力组不得为空。
 *
 * 病灶：能力筛选曾经 = 「监控组 ∩ userListed」，而 Profile 组十条 manifest 一条
 * userListed 都没有（学习模型 / 预测 / 状态复盘都是平台内部 skill），于是
 * `?capabilityType=profile` 恒空——用户选了「学习者模型」永远看到空列表，而后端确实
 * 有 skill:learning-predictor 等调用日志。
 *
 * 契约（见 capability-groups.ts 文件头）：显式 capabilityType = 监控组全量成员，
 * 刻意允许超出默认视图（userListed）。本文件直接锁住该口径的最小回归面。
 */
import { buildCapabilityAgentMap } from '../capability-groups';
import { listAgentManifest, listUserListedAgentIds } from '../../agent-manifest.service';

describe('#218 Profile 能力组非空（能力筛选刻意放宽到默认视图之外）', () => {
  it('buildCapabilityAgentMap().profile 非空且包含 skill:learning-predictor', () => {
    const map = buildCapabilityAgentMap();

    expect(Array.isArray(map.profile)).toBe(true);
    expect(map.profile.length).toBeGreaterThan(0);
    expect(map.profile).toContain('skill:learning-predictor');
  });

  it('profile 集合 = manifest Profile 组全量成员（kind !== alias），且确实超出 userListed 默认视图', () => {
    const map = buildCapabilityAgentMap();
    const expected = listAgentManifest()
      .filter((entry) => entry.monitoringGroup === 'Profile' && entry.kind !== 'alias')
      .map((entry) => entry.id);

    expect([...map.profile].sort()).toEqual([...expected].sort());

    // 被取代的旧不变式是「能力筛选 ⊆ 默认视图」：这里反向断言它被有意打破，
    // 否则 profile 又会被钉死成空数组（#218 回归）。
    const userListed = listUserListedAgentIds();
    expect(userListed).not.toContain('skill:learning-predictor');
    expect(map.profile.some((id) => !userListed.includes(id))).toBe(true);
  });

  it('其它三个能力组仍与 manifest 监控组一致（放宽口径不误伤）', () => {
    const map = buildCapabilityAgentMap();
    for (const [capability, group] of Object.entries({
      goal: 'Goal',
      path: 'Path',
      teaching: 'Teaching',
    })) {
      const expected = listAgentManifest()
        .filter((entry) => entry.monitoringGroup === group && entry.kind !== 'alias')
        .map((entry) => entry.id);
      expect([...map[capability]].sort()).toEqual([...expected].sort());
    }
  });
});
