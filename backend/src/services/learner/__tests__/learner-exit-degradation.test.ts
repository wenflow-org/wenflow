/**
 * B1/Q3：真实教学侧"未打标的降级"回归。
 * mock 误解读取失败 → 断言：过结构化降级、返回值带 degraded、复习队列不被阻断。
 */
jest.mock('../../memory/memory-trace.service', () => ({
  memoryTraceService: { getDueTraces: jest.fn() },
}));
jest.mock('../misconception-ledger.service', () => ({
  getActiveForConcepts: jest.fn(),
}));

import { LearnerExitService } from '../LearnerExitService';
import type { LearnerSnapshotService } from '../LearnerSnapshotService';
import { getActiveForConcepts } from '../misconception-ledger.service';
import { memoryTraceService } from '../../memory/memory-trace.service';
import { resetDegradationCounters, snapshotDegradationCounters } from '../../../skills/degradation-telemetry';

const mockedGetActive = getActiveForConcepts as jest.MockedFunction<typeof getActiveForConcepts>;
const mockedGetDueTraces = memoryTraceService.getDueTraces as jest.MockedFunction<typeof memoryTraceService.getDueTraces>;

const mockTraces = [
  { conceptKey: 'CAP', label: 'CAP 定理', masteryScore: 0.4, retention: 0.55, reason: 'below-threshold', extractionCount: 2 },
  { conceptKey: 'BASE', label: '基线', masteryScore: 0.6, retention: 0.6, reason: 'due', extractionCount: 3 },
];

function buildService() {
  const snapshotService = {
    getSnapshot: jest.fn().mockResolvedValue({ snapshotVersion: 'learner-snapshot-v1' }),
  } as unknown as LearnerSnapshotService;
  const service = new LearnerExitService(snapshotService);
  jest.spyOn(service, 'getAccountView').mockResolvedValue({ name: null, xp: 0, level: 1 });
  return { service, snapshotService };
}

describe('LearnerExitService 降级打标（B1/Q3）', () => {
  beforeEach(() => {
    resetDegradationCounters();
    jest.clearAllMocks();
    mockedGetDueTraces.mockResolvedValue(mockTraces as unknown as Awaited<ReturnType<typeof memoryTraceService.getDueTraces>>);
  });

  it('误解读取失败：记结构化降级并在返回值附挂 degraded，复习队列照常返回', async () => {
    mockedGetActive.mockRejectedValue(new Error('sqlite busy'));
    const { service } = buildService();

    const due = await service.getDueReview('u1');

    expect(mockedGetActive).toHaveBeenCalledWith('u1', ['CAP', 'BASE'], 20, { rethrowOnError: true });
    expect(snapshotDegradationCounters()['learner/LearnerExitService']).toBe(1);
    expect(due.degraded).toHaveLength(1);
    expect(due.degraded?.[0]).toMatchObject({
      source: 'learner/LearnerExitService',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      mitigationApplied: 'skip-confusable-interleaving',
    });
    // 领域语义不变：仍返回全部到期复习项
    expect(due).toHaveLength(2);
  });

  it('getLearnerContext 把 degraded 带进下游视图', async () => {
    mockedGetActive.mockRejectedValue(new Error('db down'));
    const { service } = buildService();

    const view = await service.getLearnerContext({ userId: 'u1' });

    expect(view.degraded?.[0].source).toBe('learner/LearnerExitService');
    expect(view.dueReview).toHaveLength(2);
    expect(view.accountView).toEqual({ name: null, xp: 0, level: 1 });
  });

  it('正常读取：无 degraded 附挂、无降级计数', async () => {
    mockedGetActive.mockResolvedValue([]);
    const { service } = buildService();

    const due = await service.getDueReview('u1');

    expect(due.degraded).toBeUndefined();
    expect(snapshotDegradationCounters()['learner/LearnerExitService']).toBeUndefined();
    expect(due).toHaveLength(2);
  });
});
