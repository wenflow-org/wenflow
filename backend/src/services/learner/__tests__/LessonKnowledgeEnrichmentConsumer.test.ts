const transaction = jest.fn();
const inboxFindUnique = jest.fn();
const outboxFindUnique = jest.fn();
const executeSkill = jest.fn();
const mockProfileClear = jest.fn();
const mockSnapshotRefresh = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    domain_event_inbox: { findUnique: inboxFindUnique },
    domain_event_outbox: { findUnique: outboxFindUnique },
    $transaction: transaction
  }
}));

jest.mock('../../../skills', () => ({ executeSkill }));
jest.mock('../../../skills/lesson-knowledge-enricher', () => ({ lessonKnowledgeEnricherDefinition: { name: 'lesson-knowledge-enricher' } }));
jest.mock('../LearnerProfileService', () => ({
  __esModule: true,
  learnerProfileService: { clear: (userId: string) => mockProfileClear(userId) }
}));
jest.mock('../LearnerSnapshotRefreshService', () => ({
  __esModule: true,
  // #176-2：清画像缓存时同源失效快照缓存
  learnerSnapshotRefreshService: {
    refresh: (input: unknown) => mockSnapshotRefresh(input),
    invalidate: jest.fn()
  }
}));

import { LessonKnowledgeEnrichmentConsumer } from '../LessonKnowledgeEnrichmentConsumer';
import { createDomainEvent } from '../../../events/contracts';

/** outbox 行：源 lesson:completed（增强事件只带 id，消费时按 id 回查） */
const buildSourceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt-lesson-src',
  eventType: 'lesson:completed',
  schemaVersion: 1,
  aggregateType: 'lesson',
  aggregateId: 'session-1',
  aggregateVersion: null,
  userId: 'user-1',
  source: 'test',
  payload: JSON.stringify({
    sessionId: 'session-1',
    taskId: 'task-1',
    pathId: 'path-1',
    knowledgeState: [{ name: 'A', status: 'mastered', progress: 100 }],
    visibleDialogueContext: []
  }),
  metadata: null,
  occurredAt: new Date('2026-09-01T00:00:00Z'),
  scheduledAt: null,
  ...overrides
});

const buildEnrichmentEvent = (data: Record<string, unknown> = { lessonEventId: 'evt-lesson-src' }) =>
  createDomainEvent({
    id: 'enr_evt-lesson-src',
    type: 'lesson:knowledge-enrichment',
    aggregateType: 'lesson',
    aggregateId: 'session-1',
    userId: 'user-1',
    source: 'test',
    data,
    occurredAt: new Date('2026-09-01T00:00:01Z')
  });

describe('LessonKnowledgeEnrichmentConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileClear.mockReturnValue(undefined);
    mockSnapshotRefresh.mockResolvedValue(undefined);
  });

  it('runs the merged enrichment skill once and commits evidence with one inbox receipt', async () => {
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockResolvedValue({
      conceptLedger: [{ conceptKey: 'a', label: 'A' }],
      reusableFoundations: ['A'],
      blockedFoundations: [],
      transferSignals: [{ conceptKey: 'a', label: 'A', readiness: 'high', confidence: 0.8 }],
      recurringConfusions: []
    });
    const tx = {
      domain_event_inbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      learner_evidence: { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));

    await new LessonKnowledgeEnrichmentConsumer().handle(createDomainEvent({
      id: 'evt-lesson',
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-1',
      userId: 'user-1',
      source: 'test',
      data: {
        sessionId: 'session-1',
        taskId: 'task-1',
        pathId: 'path-1',
        transferGoal: '把递归思想迁移到树的遍历',
        knowledgeState: [{ name: 'A', status: 'mastered', progress: 100 }],
        visibleDialogueContext: []
      }
    }));

    expect(executeSkill).toHaveBeenCalledTimes(1);
    expect(executeSkill).toHaveBeenCalledWith(
      { name: 'lesson-knowledge-enricher' },
      expect.objectContaining({
        transferGoal: '把递归思想迁移到树的遍历',
        knowledgeState: [{ name: 'A', status: 'mastered', progress: 100 }],
        visibleDialogueContext: []
      })
    );
    expect(tx.learner_evidence.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ evidenceType: 'session-knowledge-distilled' }),
        expect.objectContaining({ evidenceType: 'dialogue-concepts-extracted' })
      ])
    });
    const evidenceRows = tx.learner_evidence.createMany.mock.calls[0][0].data;
    expect(evidenceRows.every((row: any) => !('confidence' in row))).toBe(true);
    expect(tx.domain_event_inbox.create).toHaveBeenCalledTimes(1);
  });

  it('transferGoal 缺失/为空时不传给 skill（老事件兼容）', async () => {
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockResolvedValue({
      conceptLedger: [],
      reusableFoundations: [],
      blockedFoundations: [],
      transferSignals: [],
      recurringConfusions: []
    });
    const tx = {
      domain_event_inbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      learner_evidence: { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));

    await new LessonKnowledgeEnrichmentConsumer().handle(createDomainEvent({
      id: 'evt-lesson-no-transfer',
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-2',
      userId: 'user-1',
      source: 'test',
      data: {
        sessionId: 'session-2',
        taskId: 'task-2',
        knowledgeState: [],
        visibleDialogueContext: []
      }
    }));

    expect(executeSkill).toHaveBeenCalledWith(
      { name: 'lesson-knowledge-enricher' },
      expect.objectContaining({
        transferGoal: null,
        knowledgeState: []
      })
    );
  });

  it('executeSkill 失败时不写证据、不写 receipt，并向 outbox 抛错（退避重投语义）', async () => {
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockRejectedValue(new Error('LESSON_KNOWLEDGE_ENRICHER_FAILED: provider timeout'));

    await expect(new LessonKnowledgeEnrichmentConsumer().handle(createDomainEvent({
      id: 'evt-lesson-fail',
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-1',
      userId: 'user-1',
      source: 'test',
      data: { knowledgeState: [], visibleDialogueContext: [] }
    }))).rejects.toThrow('LESSON_KNOWLEDGE_ENRICHER_FAILED: provider timeout');

    expect(transaction).not.toHaveBeenCalled();
    expect(inboxFindUnique).toHaveBeenCalledTimes(1);
  });

  it('skips the expensive skills when the event was already consumed', async () => {
    inboxFindUnique.mockResolvedValue({ id: 'receipt' });
    await new LessonKnowledgeEnrichmentConsumer().handle(createDomainEvent({
      id: 'evt-lesson',
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-1',
      userId: 'user-1',
      source: 'test',
      data: {}
    }));
    expect(executeSkill).not.toHaveBeenCalled();
  });

  /* #144：增强事件在独立泳道被消费——按源事件 id 回查 lesson:completed 行，然后执行增强。 */
  it('#144：独立增强事件按源事件 id 回查并执行增强，证据/收据仍按源事件记账', async () => {
    outboxFindUnique.mockResolvedValue(buildSourceRow());
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockResolvedValue({ conceptLedger: [], recurringConfusions: [] });
    const tx = {
      domain_event_inbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      learner_evidence: { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));

    await new LessonKnowledgeEnrichmentConsumer().handleEnrichmentEvent(buildEnrichmentEvent());

    expect(outboxFindUnique).toHaveBeenCalledWith({ where: { id: 'evt-lesson-src' } });
    expect(executeSkill).toHaveBeenCalledTimes(1);
    // inbox receipt 与证据 id 仍以**源事件 id** 为键：重投幂等语义与旧实现一致
    const evidenceRows = tx.learner_evidence.createMany.mock.calls[0][0].data;
    expect(evidenceRows.every((row: any) => row.eventId === 'evt-lesson-src')).toBe(true);
    expect(tx.domain_event_inbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: 'evt-lesson-src' })
    });
  });

  /* #146：增强证据刚落库 → 立刻把增量推进画像。
     lastEventId 用**增强事件自己的 id**，否则会命中 refresh 的「lastEventId 相同直接返回旧投影」。 */
  it('#146：增强成功后刷新画像，且 lastEventId 用增强事件 id（不被短路）', async () => {
    outboxFindUnique.mockResolvedValue(buildSourceRow());
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockResolvedValue({ conceptLedger: [], recurringConfusions: [] });
    const tx = {
      domain_event_inbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      learner_evidence: { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));

    await new LessonKnowledgeEnrichmentConsumer().handleEnrichmentEvent(buildEnrichmentEvent());

    expect(mockProfileClear).toHaveBeenCalledWith('user-1');
    expect(mockSnapshotRefresh).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      pathId: 'path-1',
      taskId: 'task-1',
      scope: 'teaching',
      lastEventId: 'enr_evt-lesson-src',
    }));
    expect(mockSnapshotRefresh.mock.calls[0][0].lastEventId).not.toBe('evt-lesson-src');
  });

  /* #146：增强失败只让**增强事件**退避重试——不再牵动快路径（投影/清缓存/快照刷新已由源事件完成）。 */
  it('#146：增强失败时本链路不刷新画像（快路径不跟着重跑），错误上抛给增强泳道退避', async () => {
    outboxFindUnique.mockResolvedValue(buildSourceRow());
    inboxFindUnique.mockResolvedValue(null);
    executeSkill.mockRejectedValue(new Error('LESSON_KNOWLEDGE_ENRICHER_FAILED: provider timeout'));

    await expect(new LessonKnowledgeEnrichmentConsumer().handleEnrichmentEvent(buildEnrichmentEvent()))
      .rejects.toThrow('LESSON_KNOWLEDGE_ENRICHER_FAILED');

    expect(mockSnapshotRefresh).not.toHaveBeenCalled();
    expect(mockProfileClear).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('源事件行已不存在（被清理）：直接终结，不调 LLM、不抛错（避免无意义重试）', async () => {
    outboxFindUnique.mockResolvedValue(null);

    await expect(new LessonKnowledgeEnrichmentConsumer().handleEnrichmentEvent(buildEnrichmentEvent()))
      .resolves.toBeUndefined();

    expect(executeSkill).not.toHaveBeenCalled();
    expect(mockSnapshotRefresh).not.toHaveBeenCalled();
  });

  it('增强事件缺少源事件引用：跳过（不调 LLM）', async () => {
    await expect(new LessonKnowledgeEnrichmentConsumer().handleEnrichmentEvent(buildEnrichmentEvent({})))
      .resolves.toBeUndefined();

    expect(outboxFindUnique).not.toHaveBeenCalled();
    expect(executeSkill).not.toHaveBeenCalled();
  });
});
