import { PrismaClient } from '@prisma/client'
import { createDomainEvent } from '../../../events/contracts'

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip

jest.mock('../../../skills', () => ({
  executeSkill: jest.fn()
}))

import { executeSkill } from '../../../skills'

runIntegration('LessonKnowledgeEnrichmentConsumer 集成测试（真实数据库）', () => {
  const prisma = new PrismaClient()
  const ids = {
    user: 'enrichment-integration-user',
    event: 'enrichment-integration-event'
  }

  beforeAll(async () => {
    await prisma.users.upsert({
      where: { id: ids.user },
      create: {
        id: ids.user,
        email: 'enrichment-integration@wenflow.test',
        name: 'Enrichment Integration',
        password: 'not-used',
        updatedAt: new Date()
      },
      update: {}
    })
  })

  afterAll(async () => {
    await prisma.domain_event_inbox.deleteMany({ where: { eventId: ids.event } })
    await prisma.learner_evidence.deleteMany({ where: { eventId: ids.event } })
    await prisma.users.deleteMany({ where: { id: ids.user } })
    await prisma.$disconnect()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('消费 lesson:completed 事件后会写入 learner_evidence 和 domain_event_inbox', async () => {
    ;(executeSkill as jest.Mock)
      .mockResolvedValueOnce({
        conceptLedger: [{ conceptKey: 'a', label: 'A' }],
        reusableFoundations: ['a'],
        blockedFoundations: [],
        transferSignals: []
      })
      .mockResolvedValueOnce({
        recurringConfusions: [{ conceptKey: 'b', label: 'B', confidence: 0.7 }]
      })

    const { LessonKnowledgeEnrichmentConsumer } = await import('../LessonKnowledgeEnrichmentConsumer')

    await new LessonKnowledgeEnrichmentConsumer().handle(createDomainEvent({
      id: ids.event,
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-integration',
      userId: ids.user,
      source: 'integration-test',
      data: {
        sessionId: 'session-integration',
        taskId: 'task-integration',
        pathId: 'path-integration',
        knowledgeState: [
          { name: '概念A', status: 'mastered', progress: 100 },
          { name: '概念B', status: 'learning', progress: 55 }
        ],
        visibleDialogueContext: [
          { role: 'teacher', content: '让我们来理解这个概念' },
          { role: 'student', content: '我还是不太懂...' }
        ],
        wrapup: {
          progress: {
            newlyMastered: ['概念A'],
            movedToReview: [],
            stillLearning: ['概念B'],
            unchangedMastered: []
          }
        }
      }
    }))

    const [evidenceA, evidenceB, inbox] = await Promise.all([
      prisma.learner_evidence.findFirst({
        where: { eventId: ids.event, evidenceType: 'session-knowledge-distilled' }
      }),
      prisma.learner_evidence.findFirst({
        where: { eventId: ids.event, evidenceType: 'dialogue-concepts-extracted' }
      }),
      prisma.domain_event_inbox.findFirst({
        where: { eventId: ids.event }
      })
    ])

    expect(evidenceA).not.toBeNull()
    expect(evidenceA!.userId).toBe(ids.user)
    expect(evidenceA!.pathId).toBe('path-integration')
    expect(evidenceA!.sessionId).toBe('session-integration')
    expect(evidenceA!.confidence).toBe(0.8)

    const payloadA = JSON.parse(evidenceA!.payload)
    expect(payloadA.conceptLedger).toHaveLength(1)

    expect(evidenceB).not.toBeNull()
    expect(evidenceB!.userId).toBe(ids.user)
    expect(evidenceB!.confidence).toBe(0.72)

    const payloadB = JSON.parse(evidenceB!.payload)
    expect(payloadB.recurringConfusions).toHaveLength(1)

    expect(inbox).not.toBeNull()
    expect(inbox!.consumerId).toBe('lesson-knowledge-enrichment-v1')
  })

  it('重复消费同一事件会被 inbox 幂等拦截', async () => {
    ;(executeSkill as jest.Mock)
      .mockResolvedValueOnce({ conceptLedger: [] })
      .mockResolvedValueOnce({ recurringConfusions: [] })

    const { LessonKnowledgeEnrichmentConsumer } = await import('../LessonKnowledgeEnrichmentConsumer')

    const event = createDomainEvent({
      id: ids.event,
      type: 'lesson:completed',
      aggregateType: 'lesson',
      aggregateId: 'session-integration',
      userId: ids.user,
      source: 'integration-test',
      data: { sessionId: 'session-integration', knowledgeState: [], visibleDialogueContext: [] }
    })

    await new LessonKnowledgeEnrichmentConsumer().handle(event)

    expect(executeSkill).not.toHaveBeenCalled()
  })

  it('证据写入后 LearnerEvidenceProjector 能正确读取并写入投影', async () => {
    const projectorEvent = createDomainEvent({
      id: 'evt-projector-integration',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-projector',
      userId: ids.user,
      source: 'integration-test',
      data: {
        taskId: 'task-projector',
        pathId: 'path-integration',
        confidence: 0.9
      }
    })

    const { learnerEvidenceProjector } = await import('../LearnerEvidenceProjector')
    await learnerEvidenceProjector.handle(projectorEvent)

    const evidence = await prisma.learner_evidence.findFirst({
      where: { eventId: 'evt-projector-integration' }
    })
    const projection = await prisma.learner_projections.findFirst({
      where: { projectionKey: `learner:${ids.user}:events` }
    })
    const inbox = await prisma.domain_event_inbox.findFirst({
      where: { eventId: 'evt-projector-integration' }
    })

    expect(evidence).not.toBeNull()
    expect(evidence!.evidenceType).toBe('task:completed')
    expect(evidence!.confidence).toBe(0.9)

    expect(projection).not.toBeNull()
    expect(projection!.lastEventId).toBe('evt-projector-integration')
    const payload = JSON.parse(projection!.payload)
    expect(payload.eventCounts['task:completed']).toBeGreaterThanOrEqual(1)

    expect(inbox).not.toBeNull()

    await prisma.domain_event_inbox.deleteMany({
      where: { eventId: 'evt-projector-integration' }
    })
    await prisma.learner_evidence.deleteMany({
      where: { eventId: 'evt-projector-integration' }
    })
    await prisma.learner_projections.deleteMany({
      where: { projectionKey: `learner:${ids.user}:events` }
    })
  })
})
