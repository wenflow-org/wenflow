/**
 * 路径截止日展示视图（cockpitFormat.pathDeadlineView；M-7，2026-10-29 夜审）。
 *
 * 缺陷：同一结构化 deadline 的 deadlineText 原文在库里并存互相矛盾的版本
 * （「明年 1 月 10 号婚礼前（约三个月）」vs「到明年 1 月 10 号婚礼（约 15 个月）」，
 * LLM 生成时落库的原样透传），座舱按原文渲染，用户看到同一日期配两种相差 5 倍的相对时长。
 * 钉死：结构化 deadline（epoch 毫秒 / ISO 串）优先格式化为本地日期，原文降级 title；
 * 结构化缺失/不可解析时回退原文展示。
 */
import { describe, expect, it } from 'vitest';
import { pathDeadlineView } from '../cockpitFormat';

describe('pathDeadlineView（截止日结构化日期优先）', () => {
  it('epoch 毫秒数（库内主流落库形态）→ 本地日期 YYYY-MM-DD', () => {
    // 1799510400000 = 2027-01-09T16:00Z（+08 即 2027-01-10），与夜审样本同值
    const v = pathDeadlineView(1799510400000, '明年 1 月 10 号婚礼前（约三个月）');
    expect(v.dateText).toBe(new Date(1799510400000).toLocaleDateString('sv-SE'));
    expect(v.text).toBe('明年 1 月 10 号婚礼前（约三个月）');
  });

  it('同值不同原文：dateText 一致（矛盾原文不再上正文）', () => {
    const a = pathDeadlineView(1799510400000, '明年 1 月 10 号婚礼前（约三个月）');
    const b = pathDeadlineView(1799510400000, '到明年 1 月 10 号婚礼（约 15 个月）');
    expect(a.dateText).toBe(b.dateText);
    expect(a.text).not.toBe(b.text);
  });

  it('epoch 数值串（旧接口字符串化形态）同样可解析', () => {
    expect(pathDeadlineView('1799510400000', '').dateText).toBe(new Date(1799510400000).toLocaleDateString('sv-SE'));
  });

  it('ISO 日期串 → 本地日期', () => {
    // 本地正午构造时刻：构造与展示同用本机时区，任意 CI 时区下都格式化回同一天（UTC runner 实证过 +08 深夜串会差一天）
    const instant = new Date(2027, 0, 10, 12, 0, 0).toISOString();
    expect(pathDeadlineView(instant, '').dateText).toBe('2027-01-10');
  });

  it('结构化缺失/不可解析 → dateText 空，回退原文展示', () => {
    expect(pathDeadlineView(null, '明年 1 月婚礼前')).toEqual({ dateText: '', text: '明年 1 月婚礼前' });
    expect(pathDeadlineView(undefined, '约三个月')).toEqual({ dateText: '', text: '约三个月' });
    expect(pathDeadlineView('不是日期', '约三个月')).toEqual({ dateText: '', text: '约三个月' });
  });

  it('两者皆缺 → 双空（页签 meta 不出现「截止」段）', () => {
    expect(pathDeadlineView(null, null)).toEqual({ dateText: '', text: '' });
  });
});
