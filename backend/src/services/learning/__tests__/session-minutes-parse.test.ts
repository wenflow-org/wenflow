/**
 * 会话时长解析单测（R7，2026-09-29 第三波评审实证）：
 * 「一天三小时」此前只认阿拉伯数字 → 漏解析回退默认档 [30,120]，wild-09 人设
 * （一天凑一小时/三小时中文）整条路径排了 90min 课。修后中文数字/半个钟头全覆盖。
 * 经 derivePlanningHints 的 subtaskMinutesRange 观测解析结果。
 */
import { derivePlanningHints } from '../path-planning-hints';

function band(timePerSession: string) {
  const h = derivePlanningHints(null, timePerSession, null, null, ['S1', 'S2', 'S3'], null, 'medium', null, null);
  return h.subtaskMinutesRange;
}

describe('会话时长解析（中文数字+阿拉伯数字）', () => {
  it('「一天三小时」→ 上界 120（不再回退默认档；下限 45 证明解析为 180min）', () => {
    expect(band('一天三小时')).toEqual([45, 120]);
  });
  it('「每天两小时」→ [36,96]', () => {
    expect(band('每天两小时')).toEqual([36, 96]);
  });
  it('「一个半小时」=1.5h → [27,72]', () => {
    expect(band('一个半小时')).toEqual([27, 72]);
  });
  it('「三个半小时」=3.5h → [45,120]', () => {
    expect(band('三个半小时')).toEqual([45, 120]);
  });
  it('「半小时」→ [9,24]', () => {
    expect(band('半小时')).toEqual([9, 24]);
  });
  it('「三十分钟」/「30分钟」/「2小时」等价', () => {
    expect(band('三十分钟')).toEqual(band('30分钟'));
    expect(band('2小时')).toEqual([36, 96]);
  });
  it('「一个钟头」→ [18,48]', () => {
    expect(band('一个钟头')).toEqual([18, 48]);
  });
  it('「十五分钟」→ [8,15]（短会话不抬高上界）', () => {
    expect(band('十五分钟')).toEqual([8, 15]);
  });
  it('混合文本「晚上大概两个小时吧」→ [36,96]', () => {
    expect(band('晚上大概两个小时吧')).toEqual([36, 96]);
  });
  it('无会话信息 → 默认档不受影响', () => {
    const before = band(null);
    expect(before[1]).toBeLessThanOrEqual(90);
  });
});
