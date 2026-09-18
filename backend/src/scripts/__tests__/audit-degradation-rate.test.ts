/**
 * `audit-degradation-rate` 纯聚合/格式化函数单测（B1/Q3）。
 * 只测纯函数，不触碰文件系统；文件/日志扫描属 main() 的薄 I/O 层。
 */
import {
  parseDegradationLogLine,
  aggregateDegradationRecords,
  aggregateCounterSnapshot,
  formatDegradationReport,
} from '../audit-degradation-rate';

function degradationLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 'warn',
    timestamp: '2026-09-18 10:00:00',
    service: 'wenflow',
    message: '[degradation] 降级已记录',
    source: 'learner/LearnerExitService',
    faultCategory: 'DB_READ_FAILED',
    severity: 'P2_DEGRADED',
    ...overrides,
  });
}

describe('parseDegradationLogLine', () => {
  it('解析降级 JSON 行', () => {
    expect(parseDegradationLogLine(degradationLine())).toEqual({
      source: 'learner/LearnerExitService',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      at: '2026-09-18 10:00:00',
    });
  });

  it('非降级行 / 空行 / 非法 JSON 返回 null', () => {
    expect(parseDegradationLogLine(JSON.stringify({ message: '普通日志' }))).toBeNull();
    expect(parseDegradationLogLine('')).toBeNull();
    expect(parseDegradationLogLine('not-json [degradation]')).toBeNull();
  });

  it('缺 source 时归到 (unknown)', () => {
    const parsed = parseDegradationLogLine(degradationLine({ source: undefined }));
    expect(parsed?.source).toBe('(unknown)');
  });
});

describe('aggregateDegradationRecords', () => {
  const records = [
    { source: 'a', faultCategory: 'DB_READ_FAILED', severity: 'P2_DEGRADED', at: null },
    { source: 'a', faultCategory: 'DB_READ_FAILED', severity: 'P2_DEGRADED', at: null },
    { source: 'a', faultCategory: 'UPSTREAM_EMPTY', severity: 'P3_NOTICE', at: null },
    { source: 'b', faultCategory: null, severity: null, at: null },
  ];

  it('按 source 计数、占比与类别分布，按次数降序', () => {
    const report = aggregateDegradationRecords(records);
    expect(report.total).toBe(4);
    expect(report.bySource[0].source).toBe('a');
    expect(report.bySource[0].count).toBe(3);
    expect(report.bySource[0].share).toBeCloseTo(0.75);
    expect(report.bySource[0].categories).toEqual({ DB_READ_FAILED: 2, UPSTREAM_EMPTY: 1 });
    expect(report.bySource[1].source).toBe('b');
    expect(report.bySource[1].categories).toEqual({ '(unknown)': 1 });
  });

  it('空输入 → total 0、空列表', () => {
    expect(aggregateDegradationRecords([])).toEqual({ total: 0, bySource: [] });
  });
});

describe('aggregateCounterSnapshot', () => {
  it('按 source 计数与占比，过滤 0/负值', () => {
    const report = aggregateCounterSnapshot({ a: 3, b: 1, c: 0, d: -2, e: Number('x') });
    expect(report.total).toBe(4);
    expect(report.bySource.map((s) => s.source)).toEqual(['a', 'b']);
    expect(report.bySource[0].share).toBeCloseTo(0.75);
  });
});

describe('formatDegradationReport', () => {
  it('空报告给"无记录"', () => {
    expect(formatDegradationReport({ total: 0, bySource: [] }, '标题')).toEqual(['标题', '  （无记录）']);
  });

  it('非空报告含 source、次数与主要类别', () => {
    const report = aggregateDegradationRecords([
      { source: 'learner/ReviewCompletedConsumer', faultCategory: 'DB_READ_FAILED', severity: 'P2_DEGRADED', at: null },
    ]);
    const lines = formatDegradationReport(report, '标题');
    expect(lines[0]).toBe('标题');
    expect(lines[1]).toContain('合计 1');
    expect(lines.join('\n')).toContain('learner/ReviewCompletedConsumer');
    expect(lines.join('\n')).toContain('DB_READ_FAILED×1');
  });
});
