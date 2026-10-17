/**
 * #57：#截止日文本解析——「未明确，先按 3 个月规划」这类文本不得落成硬截止日。
 */
import { isDeadlineExplicitlyUnspecified, deriveRelativeDeadline, parseAbsoluteDeadline } from '../deadline-text';

describe('deadline-text（#57）', () => {
  it('自述未明确的文本被识别（不再据此推算硬锚）', () => {
    expect(isDeadlineExplicitlyUnspecified('未明确，先按 3 个月规划')).toBe(true);
    expect(isDeadlineExplicitlyUnspecified('还没有明确的截止日期')).toBe(true);
    expect(isDeadlineExplicitlyUnspecified('暂无')).toBe(true);
    expect(isDeadlineExplicitlyUnspecified('明年 1 月 10 号婚礼前（约三个月）')).toBe(false);
  });

  it('相对表述能推算日期（真实截止场景不被误伤）', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const months = deriveRelativeDeadline('三个月后考试', now);
    expect(months).toBeNull(); // 中文数字不解析（与旧行为一致，只认阿拉伯数字）
    const months2 = deriveRelativeDeadline('3 个月后考试', now);
    expect(months2?.getMonth()).toBe(3); // 1 月 + 3 个月 = 4 月（0-based 3）
    const weeks = deriveRelativeDeadline('6 周内完成', now);
    const expectedWeeks = new Date(now.getTime());
    expectedWeeks.setDate(expectedWeeks.getDate() + 42);
    expect(weeks?.getTime()).toBe(expectedWeeks.getTime());
    expect(deriveRelativeDeadline('尽快学完', now)).toBeNull();
  });

  it('显式绝对日期优先解析', () => {
    expect(parseAbsoluteDeadline('2027-01-10')?.getUTCFullYear()).toBe(2027);
    expect(parseAbsoluteDeadline('明年 1 月 10 号')).toBeNull();
  });
});
