import { extractTeacherNumberBindings, maskMismatchedBoardNumberLabels } from '../board-intent';

/**
 * 板面数字-指标绑定一致性守卫（修复批 36-②，BOARD-001 u04 reeval29 critical）：
 * T6 教师明言「腾讯净利润是 2298 亿」，板面 frame[0] 却把 2298 写进「营业收入 2298 亿」行
 * （营收应远大于净利）——同数字异指标冲突 → 数字挖成 ?（答案不上板纪律）。
 */
describe('extractTeacherNumberBindings（教师数字绑定提取）', () => {
  it('病历单形态：净利润是 2298 亿 → {净利润, 2298}', () => {
    expect(extractTeacherNumberBindings([
      '现在咱们用你上次找到的腾讯数字来验收一下：利润表净利润是 2298 亿，资产负债表"资产总计"是 28527 亿。',
    ])).toEqual(expect.arrayContaining([
      { metric: expect.stringContaining('净利润'), number: '2298' },
      { metric: expect.stringContaining('资产总计'), number: '28527' },
    ]));
  });

  it('过滤：不足 3 位数字 / 指标过短', () => {
    expect(extractTeacherNumberBindings(['预算是 5 亿。'])).toEqual([]);
    expect(extractTeacherNumberBindings(['营收是 2298 亿。'])).toEqual([{ metric: '营收', number: '2298' }]);
  });
});

describe('maskMismatchedBoardNumberLabels（板面数字错配遮蔽）', () => {
  const bindings = [{ metric: '净利润', number: '2298' }];

  it('病历单形态：营业收入 2298 亿（同数字异指标）→ 数字挖成 ?', () => {
    const spec = {
      frames: [
        { label: '利润表', items: ['营业收入 2298 亿', '减成本费用、税', '→ 净利润'] },
        { label: '资产负债表 · 资产', items: ['现金 ?', '存货 ?', '设备 ?'] },
      ],
    };
    const { spec: next, masked } = maskMismatchedBoardNumberLabels(spec, bindings);
    expect(masked).toHaveLength(1);
    const frames = (next as any).frames;
    expect(frames[0].items[0]).toBe('营业收入 ? 亿');
    expect(frames[1].items[0]).toBe('现金 ?');
  });

  it('豁免：教师绑定支持该组合（净利润 2298 亿上板）→ 不动', () => {
    const spec = { frames: [{ label: '利润表', items: ['净利润 2298 亿'] }] };
    const { spec: next, masked } = maskMismatchedBoardNumberLabels(spec, bindings);
    expect(masked).toHaveLength(0);
    expect((next as any).frames[0].items[0]).toBe('净利润 2298 亿');
  });

  it('豁免：教师未绑定该数字 → 不动', () => {
    const spec = { frames: [{ label: '利润表', items: ['营业收入 6090 亿'] }] };
    const { masked } = maskMismatchedBoardNumberLabels(spec, bindings);
    expect(masked).toHaveLength(0);
  });

  it('空绑定 → 原样返回', () => {
    const spec = { frames: [{ label: '利润表', items: ['营业收入 2298 亿'] }] };
    const { spec: next, masked } = maskMismatchedBoardNumberLabels(spec, []);
    expect(masked).toHaveLength(0);
    expect(next).toBe(spec);
  });
});
