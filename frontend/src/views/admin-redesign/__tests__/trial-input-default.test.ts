/**
 * #15：Skill 设计页「运行预览」默认载荷按 Skill 输入契约（core.yaml inputs）生成。
 * 此前硬编码 {"input": "用一句话介绍你自己"}，与契约不符的 Skill（如 stage-designer 要 milestone）
 * 点「运行预览」必然以 INVALID_INPUT 失败。
 */
import { describe, expect, it } from 'vitest';
import { buildTrialInputFromContract } from '../skill-design/sdp-shared';

describe('buildTrialInputFromContract（#15 试跑默认载荷）', () => {
  it('只收必填（type 不带 ?），stage-designer → { milestone, cognitiveCore }', () => {
    const inputs = [
      { name: 'milestone', type: 'object' },
      { name: 'previousMilestone', type: 'object?' },
      { name: 'cognitiveCore', type: 'object' },
      { name: 'normalizedInput', type: 'object?' },
      { name: 'materials', type: 'object[]?' },
      { name: 'repairHints', type: 'object?' },
    ];
    expect(JSON.parse(buildTrialInputFromContract(inputs))).toEqual({ milestone: {}, cognitiveCore: {} });
  });

  it('按类型给形状示例：string/number/boolean/数组', () => {
    const inputs = [
      { name: 'text', type: 'string' },
      { name: 'n', type: 'number' },
      { name: 'flag', type: 'boolean' },
      { name: 'list', type: 'string[]' },
    ];
    expect(JSON.parse(buildTrialInputFromContract(inputs))).toEqual({ text: '', n: 0, flag: false, list: [] });
  });

  it('无 name 声明（旧 mock / 无声明）→ 空对象，不再塞无关的 input 键', () => {
    expect(buildTrialInputFromContract([{ ref: 'skill:x.y' } as unknown as { name?: string; type?: string }])).toBe('{}');
    expect(buildTrialInputFromContract([])).toBe('{}');
    expect(buildTrialInputFromContract(null)).toBe('{}');
  });
});
