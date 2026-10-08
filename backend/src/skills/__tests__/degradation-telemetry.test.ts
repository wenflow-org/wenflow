jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// 遥测落库必须 mock：recordDegradation 的持久化是 fire-and-forget 写 dev.db——
// 本文件是唯一用真实现的测试（其余全部 mock 整个模块），不 mock 会把 test/a、test/b
// 垃圾行灌进活库（EPOCH2 发现 #6：曾混入 8 条测试产物）。持久化行为由活库验证覆盖。
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { $executeRaw: jest.fn(async () => 0) },
}));

import {
  recordDegradation,
  snapshotDegradationCounters,
  resetDegradationCounters,
  degradationCause,
} from '../degradation-telemetry';

describe('degradation-telemetry（允许降级，不允许未打标降级）', () => {
  beforeEach(() => resetDegradationCounters());

  it('记录遥测并按 source 计数', () => {
    const record = recordDegradation({
      source: 'test/a',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      impactedDimensions: ['profile'],
      mitigationApplied: 'return-empty',
    });
    expect(record.at).toBeTruthy();
    expect(record.source).toBe('test/a');
    expect(snapshotDegradationCounters()['test/a']).toBe(1);

    recordDegradation({
      source: 'test/a',
      faultCategory: 'UNKNOWN',
      severity: 'P3_NOTICE',
      impactedDimensions: [],
      mitigationApplied: 'noop',
    });
    expect(snapshotDegradationCounters()['test/a']).toBe(2);
  });

  it('rootCauseMessage 截断到 500 字符', () => {
    const record = recordDegradation({
      source: 'test/b',
      faultCategory: 'UNKNOWN',
      severity: 'P3_NOTICE',
      impactedDimensions: [],
      mitigationApplied: 'noop',
      rootCauseMessage: 'x'.repeat(900),
    });
    expect(record.rootCauseMessage?.length).toBe(500);
  });

  it('degradationCause：Error → message，其它 → String', () => {
    expect(degradationCause(new Error('boom'))).toBe('boom');
    expect(degradationCause('plain')).toBe('plain');
  });
});
