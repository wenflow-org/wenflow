/**
 * 「会带图」技能清单 + 保存绑定时的视觉提示（#123 验收③的保存面）。
 */
import {
  VISION_CONTEXT_SKILLS,
  buildVisionBindingWarning,
  skillCarriesVisionContext,
} from '../vision-capability';

describe('skillCarriesVisionContext', () => {
  it('三个带图技能在册：教师侧 + 学习者侧（learn/goal 模拟器）', () => {
    expect([...VISION_CONTEXT_SKILLS].sort()).toEqual([
      'teaching-turn',
      'virtual-learner-goal-dialogue-simulator',
      'virtual-learner-learn-turn-simulator',
    ]);
    expect(skillCarriesVisionContext('teaching-turn')).toBe(true);
    expect(skillCarriesVisionContext(' teaching-turn ')).toBe(true);
    expect(skillCarriesVisionContext('session-wrapup')).toBe(false);
    expect(skillCarriesVisionContext('')).toBe(false);
    expect(skillCarriesVisionContext(null)).toBe(false);
  });
});

describe('buildVisionBindingWarning（保存时的可见提示，不阻断）', () => {
  it('带图技能 + 未声明 vision 的模型 → 提示含技能、模型与实测命令', () => {
    const warning = buildVisionBindingWarning('teaching-turn', 'deepseek-v4-pro');
    expect(warning).toContain('teaching-turn');
    expect(warning).toContain('deepseek-v4-pro');
    expect(warning).toContain('vision:probe');
    expect(warning).toContain('vision');
  });

  it('带图技能 + 已声明 vision 的模型 → 无提示', () => {
    expect(buildVisionBindingWarning('teaching-turn', 'deepseek-v4.1-flash')).toBeNull();
    expect(buildVisionBindingWarning('virtual-learner-learn-turn-simulator', 'agnes-3.0-flash')).toBeNull();
  });

  it('不带图的技能 → 无提示（不打扰无关配置）', () => {
    expect(buildVisionBindingWarning('path-planning', 'deepseek-v4-pro')).toBeNull();
    expect(buildVisionBindingWarning('session-wrapup', 'some-unknown-model')).toBeNull();
  });

  it('生效模型未知（null）→ 不猜，不提', () => {
    expect(buildVisionBindingWarning('teaching-turn', null)).toBeNull();
  });
});
