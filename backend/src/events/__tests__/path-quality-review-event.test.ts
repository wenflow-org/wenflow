const notifyOutboxActivity = jest.fn();
jest.mock('../outbox-wake', () => ({ notifyOutboxActivity }));

import {
  PATH_QUALITY_REVIEW_EVENT_TYPE,
  enqueuePathQualityReviewEvent,
  hashPathReviewSnapshot,
  pathQualityReviewEventId,
  stableStringify,
} from '../path-quality-review-event';

describe('path:quality-review 事件（后台评审）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('稳定序列化与哈希不受键顺序影响', () => {
    const a = { b: 2, a: [1, { d: 4, c: 3 }] };
    const b = { a: [1, { c: 3, d: 4 }], b: 2 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(hashPathReviewSnapshot(a)).toBe(hashPathReviewSnapshot(b));
    expect(hashPathReviewSnapshot(a)).toHaveLength(64);
  });

  it('幂等登记：事件 id 由版本派生，upsert 空更新，不重复入队', async () => {
    const upsert = jest.fn(async (_arg: any) => ({}));
    const tx = { domain_event_outbox: { upsert } };
    const snapshot = { version: 1, pathPlan: { name: '路径' }, goalContext: { surfaceGoal: '目标' } };

    await enqueuePathQualityReviewEvent(tx, {
      pathId: 'lp_1',
      userId: 'u1',
      reviewedGenerationRunId: 'pgr_core_1',
      mode: 'observe',
      requestedBy: 'path-generation',
      reviewConfig: { threshold: 0.75 },
      snapshot,
    });

    expect(pathQualityReviewEventId('pgr_core_1')).toBe('pqr_pgr_core_1');
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'pqr_pgr_core_1' });
    expect(arg.update).toEqual({});
    expect(arg.create).toMatchObject({
      id: 'pqr_pgr_core_1',
      eventType: PATH_QUALITY_REVIEW_EVENT_TYPE,
      aggregateType: 'path',
      aggregateId: 'lp_1',
      userId: 'u1',
      status: 'pending',
      scheduledAt: null,
    });
    const payload = JSON.parse(arg.create.payload);
    expect(payload).toMatchObject({
      pathId: 'lp_1',
      reviewedGenerationRunId: 'pgr_core_1',
      reviewerKind: 'platform_path_quality',
      mode: 'observe',
      requestedBy: 'path-generation',
      snapshotHash: hashPathReviewSnapshot(snapshot),
    });
    expect(notifyOutboxActivity).toHaveBeenCalledTimes(1);
  });

  it('试验分组只由显式 virtual-lab 标记决定', async () => {
    const upsert = jest.fn(async (_arg: any) => ({}));
    await enqueuePathQualityReviewEvent(
      { domain_event_outbox: { upsert } },
      {
        pathId: 'lp_1',
        userId: 'u1',
        reviewedGenerationRunId: 'pgr_core_2',
        mode: 'replan_experiment',
        requestedBy: 'virtual-lab',
        reviewConfig: { threshold: 0.75 },
        snapshot: { version: 1, pathPlan: {}, goalContext: {} },
        experiment: { compareReplan: true },
      },
    );
    const payload = JSON.parse((upsert.mock.calls[0][0] as any).create.payload);
    expect(payload.mode).toBe('replan_experiment');
    expect(payload.requestedBy).toBe('virtual-lab');
    expect(payload.experiment).toEqual({ compareReplan: true });
  });
});
