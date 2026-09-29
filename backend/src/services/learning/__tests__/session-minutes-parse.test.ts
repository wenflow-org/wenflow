/**
 * 会话时长解析单测（R7，2026-09-29 第三波评审实证）：
 * 「一天三小时」此前只认阿拉伯数字 → 漏解析回退默认档 [30,120]，wild-09 人设
 * （一天凑一小时/三小时中文）整条路径排了 90min 课。修后中文数字/半个钟头全覆盖。
 * 经 derivePlanningHints 的 subtaskMinutesRange 观测解析结果。
 *
 * 2026-09-29 用户口径修正：单课上界从 **0.8×会话** 改为一比一取会话时长。
 * 依据：0.8 系数把「课 ≤ 会话」偷偷变成「课 ≤ 0.8×会话」，白吃 20% 结构容量且无实证
 * （原案例 rw-school-15 只要求「别超会话」，从没要求留余量）。120 分钟只作理智上界，
 * 防「一次 8 小时」这类口语被当单课长度——**不是**负荷判断（用户：没有数据支撑学习者每天不能学八小时）。
 * 故下列上界 = min(会话分钟, 120)，下界仍 = clamp(0.3×会话, 8, 45)。
 */
import { derivePlanningHints } from '../path-planning-hints';

function band(timePerSession: string) {
  const h = derivePlanningHints(null, timePerSession, null, null, ['S1', 'S2', 'S3'], null, 'medium', null, null);
  return h.subtaskMinutesRange;
}

describe('会话时长解析（中文数字+阿拉伯数字）', () => {
  it('「一天三小时」→ 上界被理智上界封在 120（下限 45 证明解析为 180min）', () => {
    expect(band('一天三小时')).toEqual([45, 120]);
  });
  it('「每天两小时」→ [36,120]（上界=会话时长，不再打 0.8 折）', () => {
    expect(band('每天两小时')).toEqual([36, 120]);
  });
  it('「一个半小时」=1.5h → [27,90]', () => {
    expect(band('一个半小时')).toEqual([27, 90]);
  });
  it('「三个半小时」=3.5h → [45,120]', () => {
    expect(band('三个半小时')).toEqual([45, 120]);
  });
  it('「半小时」→ [9,30]', () => {
    expect(band('半小时')).toEqual([9, 30]);
  });
  it('「三十分钟」/「30分钟」/「2小时」等价', () => {
    expect(band('三十分钟')).toEqual(band('30分钟'));
    expect(band('2小时')).toEqual([36, 120]);
  });
  it('「一个钟头」→ [18,60]', () => {
    expect(band('一个钟头')).toEqual([18, 60]);
  });
  it('「十五分钟」→ [8,15]（短会话不抬高上界）', () => {
    expect(band('十五分钟')).toEqual([8, 15]);
  });
  it('混合文本「晚上大概两个小时吧」→ [36,120]', () => {
    expect(band('晚上大概两个小时吧')).toEqual([36, 120]);
  });
  it('无会话信息 → 默认档不受影响', () => {
    const before = band(null);
    expect(before[1]).toBeLessThanOrEqual(90);
  });

  it('上界永不超过用户自述会话时长（去掉 0.8 后仍守这条硬约束）', () => {
    for (const [text, minutes] of [
      ['每天两小时', 120],
      ['一个半小时', 90],
      ['半小时', 30],
      ['一个钟头', 60],
    ] as Array<[string, number]>) {
      expect(band(text)[1]).toBeLessThanOrEqual(minutes);
    }
  });
});
