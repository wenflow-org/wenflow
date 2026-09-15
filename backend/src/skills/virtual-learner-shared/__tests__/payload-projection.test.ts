import { projectSimulatorPayload, projectStoryPoolToHistory } from '..';

describe('virtual-learner 模拟器 payload 发送前投影', () => {
  it('storyPool → storyHistory：只保留标题与一句话概述（截断），剔除私有字段', () => {
    const payload = {
      learner: {
        profile: {
          nameHint: '林慧敏',
          storyPool: [
            {
              id: 'story_1',
              title: '盘不清的账',
              storyOutline: '月底盘货又对不上，她怀疑店员，也怕是自己记错。',
              hiddenDetails: ['其实是她自己漏记了一笔'],
              disclosurePlan: { opening: '先自嘲' },
              goalSeed: { surfaceGoal: '查出差额来源' },
            },
          ],
        },
      },
    };

    const out: any = projectSimulatorPayload(payload);
    const profile = out.learner.profile;

    expect(profile.storyPool).toBeUndefined();
    expect(profile.nameHint).toBe('林慧敏');
    expect(profile.storyHistory).toEqual([
      { title: '盘不清的账', summary: '月底盘货又对不上，她怀疑店员，也怕是自己记错。' },
    ]);
    // 私有底牌不得泄漏
    expect(JSON.stringify(out)).not.toContain('hiddenDetails');
    expect(JSON.stringify(out)).not.toContain('漏记');
    expect(JSON.stringify(out)).not.toContain('disclosurePlan');
    expect(JSON.stringify(out)).not.toContain('goalSeed');
  });

  it('deep 投影：任意父键/深度（persona.storyPool、existingPersonaSeed.storyPool）都被收敛', () => {
    const out: any = projectSimulatorPayload({
      persona: { storyPool: [{ title: 'A', storyOutline: 'a' }] },
      existingPersonaSeed: { storyPool: [{ title: 'B', storyOutline: 'b' }] },
    });
    expect(out.persona.storyHistory).toEqual([{ title: 'A', summary: 'a' }]);
    expect(out.existingPersonaSeed.storyHistory).toEqual([{ title: 'B', summary: 'b' }]);
    expect(out.persona.storyPool).toBeUndefined();
    expect(out.existingPersonaSeed.storyPool).toBeUndefined();
  });

  it('无 storyPool / 非对象：原样返回', () => {
    expect(projectSimulatorPayload({ a: 1, b: [1, 2] })).toEqual({ a: 1, b: [1, 2] });
    expect(projectSimulatorPayload(null)).toBeNull();
    expect(projectSimulatorPayload('x')).toBe('x');
  });

  it('projectStoryPoolToHistory：概述截断到 160 字，空条目丢弃，上限 12 条', () => {
    const history = projectStoryPoolToHistory([
      { title: 'T', storyOutline: 'x'.repeat(500) },
      { title: '', storyOutline: '' },
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].summary).toHaveLength(160);
    expect(projectStoryPoolToHistory(Array.from({ length: 20 }, (_, i) => ({ title: `T${i}` })))).toHaveLength(12);
  });
});
