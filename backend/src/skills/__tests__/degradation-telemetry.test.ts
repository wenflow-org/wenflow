jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
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
