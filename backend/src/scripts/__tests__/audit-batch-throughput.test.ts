import { summarizeThroughput, applyThroughputActivity, LOW_RUN_ALERT_MINUTES, type ThroughputAttempt } from '../audit-batch-throughput';

const NOW = new Date('2026-10-21T10:05:30.000Z');

function at(minutesAgo: number, count: number, opts: { rateLimit?: number } = {}): ThroughputAttempt[] {
  const base = new Date(NOW.getTime() - minutesAgo * 60_000);
  return Array.from({ length: count }, (_, i) => ({
    startedAt: new Date(base.getTime() + i * 100),
    success: i >= (opts.rateLimit ?? 0),
    errorCategory: i < (opts.rateLimit ?? 0) ? 'rate_limit' : null,
  }));
}

describe('summarizeThroughput（批量吞吐审计）', () => {
  it('窗口内零调用 → 全部分钟低于下限并触发告警', () => {
    const report = summarizeThroughput([], { windowMinutes: 10, minRpm: 20, now: NOW });
    expect(report.totalCalls).toBe(0);
    expect(report.avgRpm).toBe(0);
    expect(report.lowMinutes).toBe(10);
    expect(report.longestLowRun).toBe(10);
    expect(report.alert).toBe(true);
    expect(report.minutes).toHaveLength(10);
    // 窗口末端对齐到当前分钟
    expect(report.minutes[report.minutes.length - 1].minute).toBe('2026-10-21T10:05');
  });

  it('单分钟打满会打断连续低吞吐段', () => {
    // 10 分钟窗口（09:56–10:05）：10:03 打满 25 次 → 前 7 分钟 + 后 2 分钟两段，最长 7
    const report = summarizeThroughput(at(2, 25), { windowMinutes: 10, minRpm: 20, now: NOW });
    expect(report.totalCalls).toBe(25);
    expect(report.lowMinutes).toBe(9);
    expect(report.longestLowRun).toBe(7);
    expect(report.alert).toBe(true);
  });

  it('短窗口连续低吞吐不足阈值 → 不告警', () => {
    const report = summarizeThroughput([], { windowMinutes: LOW_RUN_ALERT_MINUTES - 1, minRpm: 20, now: NOW });
    expect(report.longestLowRun).toBe(LOW_RUN_ALERT_MINUTES - 1);
    expect(report.alert).toBe(false);
  });

  it('rate_limit 单独计数，不影响 rpm 口径', () => {
    const report = summarizeThroughput(at(0, 30, { rateLimit: 12 }), { windowMinutes: 5, minRpm: 20, now: NOW });
    const last = report.minutes[report.minutes.length - 1];
    expect(last.rpm).toBe(30);
    expect(last.ok).toBe(18);
    expect(last.rateLimit).toBe(12);
    expect(last.belowFloor).toBe(false);
  });

  it('跨分钟记录按分钟归桶', () => {
    const calls = [...at(0, 5), ...at(1, 7), ...at(2, 9)];
    const report = summarizeThroughput(calls, { windowMinutes: 5, minRpm: 5, now: NOW });
    const byMinute = new Map(report.minutes.map((m) => [m.minute, m.rpm]));
    expect(byMinute.get('2026-10-21T10:05')).toBe(5);
    expect(byMinute.get('2026-10-21T10:04')).toBe(7);
    expect(byMinute.get('2026-10-21T10:03')).toBe(9);
  });
});

describe('applyThroughputActivity（空闲不是低吞吐故障）', () => {
  const lowReport = () => summarizeThroughput([], { windowMinutes: 60, minRpm: 20, now: NOW });

  it('没有运行中的批次/会话/租约 → 空闲，保持 rpm 读数但不告警', () => {
    const report = applyThroughputActivity(lowReport(), { activeSessions: 0, activeBatches: 0, activeLeases: 0 });
    expect(report.idle).toBe(true);
    expect(report.alert).toBe(false);
    expect(report.alertReason).toBeNull();
    // 读数不被改写：低吞吐事实仍在，只是不当作故障
    expect(report.longestLowRun).toBe(60);
    expect(report.avgRpm).toBe(0);
  });

  it('跑批会话在运行但零调用 → 不空闲，照常告警（卡住的批次不能被吞）', () => {
    const report = applyThroughputActivity(lowReport(), { activeSessions: 2, activeBatches: 0, activeLeases: 0 });
    expect(report.idle).toBe(false);
    expect(report.alert).toBe(true);
    expect(report.alertReason).toContain('连续 60 分钟低于 20 rpm');
  });

  it('批量任务或未过期租约也算运行信号', () => {
    const byBatch = applyThroughputActivity(lowReport(), { activeSessions: 0, activeBatches: 1, activeLeases: 0 });
    const byLease = applyThroughputActivity(lowReport(), { activeSessions: 0, activeBatches: 0, activeLeases: 1 });
    expect(byBatch.idle).toBe(false);
    expect(byLease.idle).toBe(false);
  });

  it('有批次且吞吐达标 → 不告警也不标空闲', () => {
    const healthy = summarizeThroughput(at(0, 30), { windowMinutes: 5, minRpm: 20, now: NOW });
    const report = applyThroughputActivity(healthy, { activeSessions: 1, activeBatches: 0, activeLeases: 0 });
    expect(report.idle).toBe(false);
    expect(report.alert).toBe(false);
  });
});
