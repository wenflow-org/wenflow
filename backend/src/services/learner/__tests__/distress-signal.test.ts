/**
 * P0-2：弃课事件只进控制面，不进学习指标。
 * - 写入用 learner_evidence（幂等），不改写任何分数；
 * - 读取只在 72h 内生效，且事件之后有正常完成课则提前解除。
 */
const upsert = jest.fn();
const evidenceFindFirst = jest.fn();
const sessionFindFirst = jest.fn();
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_evidence: { upsert, findFirst: evidenceFindFirst },
    teaching_sessions: { findFirst: sessionFindFirst },
  },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  DISTRESS_ABANDON_EVIDENCE_TYPE,
  DISTRESS_RECOVER_HOURS,
  loadRecentDistressSignal,
  recordDistressAbandonEvidence,
} from '../distress-signal';
import { deriveLearningControlState } from '../LearnerSnapshotService';

describe('recordDistressAbandonEvidence', () => {
  beforeEach(() => upsert.mockReset().mockResolvedValue({}));

  it('写入 session:distress_abandon（幂等键 + payload），不碰 learning_metrics', async () => {
    await recordDistressAbandonEvidence({
      userId: 'u1',
      sessionId: 's1',
      pathId: 'p1',
      taskId: 't1',
      occurredAt: new Date('2026-11-23T00:00:00.000Z'),
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.where.eventId_evidenceKey).toEqual({
      eventId: 'session:s1',
      evidenceKey: 'distress:abandon',
    });
    expect(args.create).toMatchObject({
      userId: 'u1',
      sessionId: 's1',
      evidenceType: DISTRESS_ABANDON_EVIDENCE_TYPE,
      confidence: 1,
    });
    expect(JSON.parse(args.create.payload).flag).toBe('abandon');
  });

  it('写入失败只告警，不抛错（best-effort）', async () => {
    upsert.mockRejectedValue(new Error('db down'));
    await expect(recordDistressAbandonEvidence({ userId: 'u1', sessionId: 's1' })).resolves.toBeUndefined();
  });
});

describe('loadRecentDistressSignal', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  beforeEach(() => {
    evidenceFindFirst.mockReset();
    sessionFindFirst.mockReset().mockResolvedValue(null);
  });

  it('窗口内事件 + 之后无正常课 → 返回信号', async () => {
    evidenceFindFirst.mockResolvedValue({
      occurredAt: new Date('2026-11-23T06:00:00.000Z'),
      sessionId: 's1',
    });
    const signal = await loadRecentDistressSignal('u1', now);
    expect(signal?.sessionId).toBe('s1');
    const where = evidenceFindFirst.mock.calls[0][0].where;
    expect(where.evidenceType).toBe(DISTRESS_ABANDON_EVIDENCE_TYPE);
    // 窗口在应用层判定（先查最近事件，避免无事件时解析模拟钟）；此处断言不再带 DB 时间过滤。
    expect(where).not.toHaveProperty('occurredAt');
  });

  it('事件之后已有正常完成课 → 提前解除', async () => {
    evidenceFindFirst.mockResolvedValue({
      occurredAt: new Date('2026-11-23T06:00:00.000Z'),
      sessionId: 's1',
    });
    sessionFindFirst.mockResolvedValue({ id: 's2' });
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();
    expect(sessionFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: 'u1',
      status: 'completed',
      id: { not: 's1' },
    });
  });

  it('解除按「完课时刻」判定：事件前开课、事件后结课也能解锁', async () => {
    const occurredAt = new Date('2026-11-23T06:00:00.000Z');
    evidenceFindFirst.mockResolvedValue({ occurredAt, sessionId: 's1' });
    sessionFindFirst.mockResolvedValue({ id: 's2' });
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();
    const where = sessionFindFirst.mock.calls[0][0].where;
    // 旧口径只看 startTime → 这类课永远不会解锁；新口径看 endTime，缺 endTime 的旧行才回退 startTime。
    // lte: now 防止「未来时间」的假完成（模拟课次与真墙钟事件错位）。
    expect(where.OR).toEqual([
      { endTime: { gt: occurredAt, lte: now } },
      { endTime: null, startTime: { gt: occurredAt, lte: now } },
    ]);
  });

  it('72h 窗口外 / 未来事件（时钟错位）→ null，不锁人', async () => {
    evidenceFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() - (DISTRESS_RECOVER_HOURS + 1) * 3600_000),
      sessionId: 's1',
    });
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();

    evidenceFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() + 10 * 60_000),
      sessionId: 's1',
    });
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();
  });

  it('无事件 / 读取失败 → null（不阻塞快照）', async () => {
    evidenceFindFirst.mockResolvedValue(null);
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();
    evidenceFindFirst.mockRejectedValue(new Error('db down'));
    await expect(loadRecentDistressSignal('u1', now)).resolves.toBeNull();
  });

  it('端到端：弃课信号 → 下一节控制态强制 recover（指标再好也压住）', async () => {
    evidenceFindFirst.mockResolvedValue({
      occurredAt: new Date('2026-11-23T06:00:00.000Z'),
      sessionId: 's1',
    });
    const signal = await loadRecentDistressSignal('u1', now);
    const control = deriveLearningControlState({
      dynamicState: {
        metrics: { lss: 2, ktl: 8, lf: 2, lsb: 6 },
        recentTrend: 'improving',
        fatigueRisk: 'low',
      } as any,
      knowledgeMemory: {
        globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [], severeStrugglingConcepts: [] },
        globalBackground: { blockedFoundations: [] },
        currentPath: { prerequisiteGaps: [] },
      } as any,
      lessonMetrics: { lss: 2, ktl: 8, lf: 2, lsb: 6 },
      distressRecover: Boolean(signal),
      distressRecoverAt: signal?.occurredAt ?? null,
    });
    expect(control.paceMode).toBe('recover');
    expect(control.challengeLevelCap).toBe('low');
    expect(control.checkpointNeed).toBe('low');
    expect(control.controlFlags).toEqual({
      distressRecover: true,
      distressRecoverAt: '2026-11-23T06:00:00.000Z',
    });
  });
});
