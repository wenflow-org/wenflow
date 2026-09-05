const transaction = jest.fn();
const inboxFindUnique = jest.fn();
const executeSkill = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    domain_event_inbox: { findUnique: inboxFindUnique },
    $transaction: transaction
  }
}));

jest.mock('../../../skills', () => ({ executeSkill }));
jest.mock('../../../skills/lesson-knowledge-enricher', () => ({ lessonKnowledgeEnricherDefinition: { name: 'lesson-knowledge-enricher' } }));

import { LessonKnowledgeEnrichmentConsumer } from '../LessonKnowledgeEnrichmentConsumer';
import { createDomainEvent } from '../../../events/contracts';

describe('LessonKnowledgeEnrichmentConsumer', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
