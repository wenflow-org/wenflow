import { findArithmeticMismatches, describeMismatchesForRepair } from '../teaching-arithmetic-guard';

describe('findArithmeticMismatches（教学回复算式复算）', () => {
  it('真实缺陷样本：728÷26 写 130（宽域 A 轨 P0）', () => {
    const ms = findArithmeticMismatches('我们用 728 ÷ 26 = 130 来演示回乘。');
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ stated: 130, actual: 28 });
    expect(ms[0].expr).toContain('728');
  });

  it('正确算式不报', () => {
    expect(findArithmeticMismatches('先算 728 ÷ 26 = 28，再看商的每一位。')).toHaveLength(0);
    expect(findArithmeticMismatches('12 × 15 = 180，也就是 12 * 15 = 180。')).toHaveLength(0);
    expect(findArithmeticMismatches('3 + 4 = 7，全角加号也一样：3 ＋ 4 ＝ 7')).toHaveLength(0);
    expect(findArithmeticMismatches('总价 120 ÷ 4 = 30 元每份')).toHaveLength(0);
  });

  it('≈/约 的诚实近似不判', () => {
    expect(findArithmeticMismatches('总数约为 728 ÷ 26 ≈ 28')).toHaveLength(0);
    expect(findArithmeticMismatches('人口 728 ÷ 26 ≈ 28（万）')).toHaveLength(0);
  });

  it('不整除的除法不判（余数/舍入写法多样）', () => {
    expect(findArithmeticMismatches('10 ÷ 3 = 3.33（四舍五入）')).toHaveLength(0);
    expect(findArithmeticMismatches('10 ÷ 3 = 3 余 1')).toHaveLength(0);
  });

  it('日期/区间不误报（减号不收）', () => {
    expect(findArithmeticMismatches('今天是 2026-10-08，第 3-5 人一组，分成了 90-120 = 两批同学')).toHaveLength(0);
    expect(findArithmeticMismatches('区间 3-5 天，共 2026 天 = 不可能的说法也只按非减号算式处理')).toHaveLength(0);
  });

  it('日期与变量名不误报', () => {
    expect(findArithmeticMismatches('参考 2026-10-08 的记录，见 0x1F 与 3x4 表格列')).toHaveLength(0);
    expect(findArithmeticMismatches('2026 年 10 月 8 日，版本 v2 = ok')).toHaveLength(0);
  });

  it('容差内不算错（整数四舍五入、小数截断）', () => {
    expect(findArithmeticMismatches('约 99 ÷ 3 = 33')).toHaveLength(0);
    expect(findArithmeticMismatches('面积 3.14159 × 2 = 6.28')).toHaveLength(0);
  });

  it('乘号 x 必须两侧留白才判（0x1F 不是乘法）', () => {
    expect(findArithmeticMismatches('偏移量 0x10 x 每项 4 = 64')).toHaveLength(0);
    expect(findArithmeticMismatches('每箱 6 x 4 = 24 瓶，写法等价于 6 × 4 = 24')).toHaveLength(0);
  });

  it('真的算错了要报（乘法与加法）', () => {
    const ms = findArithmeticMismatches('每个 15 元，7 个就是 15 × 7 = 115 元。');
    expect(ms).toHaveLength(1);
    expect(ms[0].actual).toBe(105);
  });

  it('空/无算式文本零命中', () => {
    expect(findArithmeticMismatches('')).toHaveLength(0);
    expect(findArithmeticMismatches(null)).toHaveLength(0);
    expect(findArithmeticMismatches('我们来看这一步的含义。')).toHaveLength(0);
  });

  it('describeMismatchesForRepair 产出可读修复指令正文', () => {
    const ms = findArithmeticMismatches('728 ÷ 26 = 130');
    const text = describeMismatchesForRepair(ms);
    expect(text).toContain('728');
    expect(text).toContain('正确结果应为 28');
  });
});
