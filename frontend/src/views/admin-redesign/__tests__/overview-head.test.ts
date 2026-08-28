/**
 * buildOverviewHead 测试（P0-2：健康环钳制修复）
 * - 低成功率显示真实值（5.3 → 5.3，绝不钳到 50）
 * - 空态（今日 0 调用）→ score=null（环显示「—」），与 KPI 卡「—」对齐
 * - bad/warn/ok 三档 tone 判定
 */
import { describe, expect, it } from 'vitest';
import { buildOverviewHead } from '../live';

describe('live.buildOverviewHead（健康环口径）', () => {
  it('低成功率 → score=真实值（5.3 而非 50），tone=bad，headline 带真实百分比', () => {
    const head = buildOverviewHead({ todayCalls: 19, todaySuccessRate: 5.3, todayFailed: 18, activeUsers: 3 });
    expect(head.score).toBe(5.3);
    expect(head.tone).toBe('bad');
    expect(head.headline).toContain('5.3%');
  });

  it('成功率 100 → score=100，tone=ok', () => {
    const head = buildOverviewHead({ todayCalls: 20, todaySuccessRate: 100, todayFailed: 0, activeUsers: 2 });
    expect(head.score).toBe(100);
    expect(head.tone).toBe('ok');
  });

  it('warn 档（调用≥20 且成功率<90）→ score=真实值，tone=warn', () => {
    const head = buildOverviewHead({ todayCalls: 20, todaySuccessRate: 85, todayFailed: 3, activeUsers: 2 });
    expect(head.score).toBe(85);
    expect(head.tone).toBe('warn');
  });

  it('低流量单次失败不误报 warn（调用<20 且失败<3）→ ok', () => {
    const head = buildOverviewHead({ todayCalls: 10, todaySuccessRate: 90, todayFailed: 1, activeUsers: 2 });
    expect(head.tone).toBe('ok');
    expect(head.score).toBe(90);
  });

  it('空态：今日 0 调用 → score=null（环显示「—」），muted', () => {
    const head = buildOverviewHead({ todayCalls: 0, todaySuccessRate: 100, todayFailed: 0, activeUsers: 0 });
    expect(head.score).toBeNull();
    expect(head.tone).toBe('muted');
    expect(head.headline).toBe('系统空闲');
  });

  it('空态：0 调用但有活跃用户 → score=null，与 KPI「—」对齐', () => {
    const head = buildOverviewHead({ todayCalls: 0, todaySuccessRate: 100, todayFailed: 0, activeUsers: 5 });
    expect(head.score).toBeNull();
    expect(head.tone).toBe('muted');
  });

  it('bad 优先于 warn（成功率<80 且失败≥3）', () => {
    const head = buildOverviewHead({ todayCalls: 40, todaySuccessRate: 60, todayFailed: 16, activeUsers: 3 });
    expect(head.tone).toBe('bad');
    expect(head.score).toBe(60);
  });

  it('R3：真实 0 调用但全量有模拟调用 → 纯真实口径，仅给导航提示（不展示虚拟数字）', () => {
    const head = buildOverviewHead({ todayCalls: 0, todaySuccessRate: 100, todayFailed: 0, activeUsers: 0, todayCallsAll: 200 });
    expect(head.score).toBeNull();
    expect(head.tone).toBe('muted');
    expect(head.headline).toBe('真实用户暂无调用');
    expect(head.subline).toContain('虚拟学习者');
    expect(head.subline).not.toContain('200');
  });

  it('R3：真实 0 且全量 0 调用 → 维持「系统空闲」原文案', () => {
    const head = buildOverviewHead({ todayCalls: 0, todaySuccessRate: 100, todayFailed: 0, activeUsers: 0 });
    expect(head.headline).toBe('系统空闲');
    expect(head.subline).toContain('等待学习者开始');
  });
});
