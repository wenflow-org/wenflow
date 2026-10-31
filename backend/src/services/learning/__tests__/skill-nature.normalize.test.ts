/**
 * 技能性质 / 平台可判定性归一化（2026-10-26 二拆）。
 *
 * 背景（用户纠偏「乐器、运动……不能指导去具体画画什么的」）：
 * 原 `internalized_skill` 把「英语拆句」和「吉他弹唱」混成一档，但两者的可判定性完全不同——
 * 拆句的产出能交出来让平台对照，弹琴的手型/音色平台看不到、听不到。
 * 拆成 cognitive_internalized / physical_internalized 两档，并引入独立的 platformJudgment。
 */
import {
  normalizeSkillNature,
  normalizePlatformJudgment,
} from '../goal-path-visible-summary';

describe('normalizeSkillNature：四档枚举 + 旧值兼容', () => {
  it('四档原样通过', () => {
    expect(normalizeSkillNature('tool_operation')).toBe('tool_operation');
    expect(normalizeSkillNature('cognitive_internalized')).toBe('cognitive_internalized');
    expect(normalizeSkillNature('physical_internalized')).toBe('physical_internalized');
    expect(normalizeSkillNature('knowledge_structure')).toBe('knowledge_structure');
  });

  it('旧档 internalized_skill 归一为 cognitive_internalized（保守方向，不凭空降级）', () => {
    expect(normalizeSkillNature('internalized_skill')).toBe('cognitive_internalized');
  });

  it('大小写与空白容错', () => {
    expect(normalizeSkillNature('  Physical_Internalized  ')).toBe('physical_internalized');
  });

  it('脏值 / 非字符串 → null（不猜测、不落默认档）', () => {
    expect(normalizeSkillNature('physical')).toBeNull();
    expect(normalizeSkillNature('')).toBeNull();
    expect(normalizeSkillNature(null)).toBeNull();
    expect(normalizeSkillNature(undefined)).toBeNull();
    expect(normalizeSkillNature(123)).toBeNull();
    expect(normalizeSkillNature({})).toBeNull();
  });
});

describe('normalizePlatformJudgment：三档枚举', () => {
  it('三档原样通过', () => {
    expect(normalizePlatformJudgment('judgeable_output')).toBe('judgeable_output');
    expect(normalizePlatformJudgment('judgeable_sensor')).toBe('judgeable_sensor');
    expect(normalizePlatformJudgment('not_judgeable')).toBe('not_judgeable');
  });

  it('脏值 → null', () => {
    expect(normalizePlatformJudgment('judgeable')).toBeNull();
    expect(normalizePlatformJudgment('NOT_JUDGEABLE ')).toBe('not_judgeable');
    expect(normalizePlatformJudgment(null)).toBeNull();
    expect(normalizePlatformJudgment(['judgeable_output'])).toBeNull();
  });
});

describe('两字段正交：skillNature 与 platformJudgment 可以不一致', () => {
  it('吉他弹唱：本人练（physical）但平台判不了（not_judgeable）', () => {
    expect(normalizeSkillNature('physical_internalized')).toBe('physical_internalized');
    expect(normalizePlatformJudgment('not_judgeable')).toBe('not_judgeable');
  });

  it('骑行功率：本人练（physical）但有功率计读数（judgeable_sensor）', () => {
    expect(normalizeSkillNature('physical_internalized')).toBe('physical_internalized');
    expect(normalizePlatformJudgment('judgeable_sensor')).toBe('judgeable_sensor');
  });

  it('英语拆句：本人练（cognitive）且产出可交（judgeable_output）', () => {
    expect(normalizeSkillNature('cognitive_internalized')).toBe('cognitive_internalized');
    expect(normalizePlatformJudgment('judgeable_output')).toBe('judgeable_output');
  });
});
