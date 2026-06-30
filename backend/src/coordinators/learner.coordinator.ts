import { learnerModelAgent } from '../agents/learner-model-agent'
import type { ProfileUpdateSource } from '../agents/learner-model-agent/types'
import { EventBus, LearningEvent } from '../gateway/event-bus'
import { executeSkill } from '../skills'
import { dialogueConceptExtractorDefinition } from '../skills/dialogue-concept-extractor'
import { sessionKnowledgeDistillerDefinition } from '../skills/session-knowledge-distiller'
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService'

const COORDINATOR_ID = 'learner-agent'

function mergeStringArrays(...values: Array<Array<string> | undefined>): string[] {
  return Array.from(new Set(values.flatMap((items) => Array.isArray(items) ? items.filter(Boolean) : [])))
}

function mergeTransferSignals(
  primary: Array<{ conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>,
  secondary: Array<{ conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>
) {
  const merged = new Map<string, { conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>()
  for (const item of [...primary, ...secondary]) {
    if (!item?.conceptKey) continue
    const existing = merged.get(item.conceptKey)
    if (!existing || item.confidence >= existing.confidence) {
      merged.set(item.conceptKey, item)
    }
  }
  return Array.from(merged.values()).slice(0, 20)
}

class LearnerCoordinator {
  readonly id = COORDINATOR_ID

  setupEventListeners(eventBus: EventBus): void {
    eventBus.on('learning:completed', async (event) => {
      await this.handleLearningCompleted(event)
    })

    eventBus.on('goal:understanding:updated', async (event) => {
      await this.handleGoalUnderstandingUpdated(event)
    })

    eventBus.on('lesson:completed', async (event) => {
      await this.handleLessonCompleted(event)
    })

    eventBus.on('path:created', async (event) => {
      await this.handlePathChanged(event)
    })

    eventBus.on('path:adjusted', async (event) => {
      await this.handlePathChanged(event)
    })
  }

  private async applyProfileUpdate(userId: string, source: ProfileUpdateSource): Promise<void> {
    await learnerModelAgent.updateProfile(userId, source)
  }

  private async refreshLearnerSnapshots(event: LearningEvent): Promise<void> {
    const userId = event.userId
    if (!userId) return

    const pathId = typeof event.data?.pathId === 'string'
      ? event.data.pathId
      : (typeof event.data?.newPathId === 'string'
        ? event.data.newPathId
        : (typeof event.data?.oldPathId === 'string' ? event.data.oldPathId : undefined))
    const milestoneId = typeof event.data?.milestoneId === 'string' ? event.data.milestoneId : undefined
    const taskId = typeof event.data?.taskId === 'string' ? event.data.taskId : undefined

    await learnerSnapshotRefreshService.refresh({
      userId,
      pathId,
      milestoneId,
      taskId,
      scope: pathId ? 'path' : 'global',
    }).catch(() => null)

    if (milestoneId || taskId) {
      await learnerSnapshotRefreshService.refresh({
        userId,
        pathId,
        milestoneId,
        taskId,
        scope: 'teaching',
      }).catch(() => null)
    }
  }

  private async handleLearningCompleted(event: LearningEvent): Promise<void> {
    if (!event.userId) return

    await this.applyProfileUpdate(event.userId, {
      agentId: this.id,
      timestamp: new Date().toISOString(),
      dataType: 'learning',
      data: {
        ktl: event.data.ktl,
        lf: event.data.lf,
        lss: event.data.lss,
      },
      confidence: 0.8,
    })

    await this.refreshLearnerSnapshots(event)
  }

  private async handleGoalUnderstandingUpdated(event: LearningEvent): Promise<void> {
    if (!event.userId) return

    await this.applyProfileUpdate(event.userId, {
      agentId: this.id,
      timestamp: new Date().toISOString(),
      dataType: 'cognitive',
      data: event.data.understanding || {},
      confidence: 0.7,
    })

    await this.refreshLearnerSnapshots(event)
  }

  private async handlePathChanged(event: LearningEvent): Promise<void> {
    await this.refreshLearnerSnapshots(event)
  }

  private async handleLessonCompleted(event: LearningEvent): Promise<void> {
    const userId = event.userId
    if (!userId) return

    try {
      const wrapup = event.data?.wrapup || null
      const knowledgeState = Array.isArray(event.data?.knowledgeState) ? event.data.knowledgeState : []
      const visibleDialogueContext = Array.isArray(event.data?.visibleDialogueContext)
        ? event.data.visibleDialogueContext
            .map((item: any) => ({
              role: typeof item?.role === 'string' ? item.role : 'user',
              content: typeof item?.content === 'string' ? item.content : '',
              analysis: item?.analysis || null,
            }))
            .filter((item: any) => item.content)
        : []
      const classroomEventHistory = Array.isArray(event.data?.classroomEventHistory)
        ? event.data.classroomEventHistory
        : []

      const sessionKnowledge = await executeSkill(sessionKnowledgeDistillerDefinition, {
        knowledgeState,
        knowledgeDelta: wrapup?.progress
          ? {
              newlyMastered: wrapup.progress.newlyMastered || [],
              movedToReview: wrapup.progress.movedToReview || [],
              stillLearning: wrapup.progress.stillLearning || [],
              unchangedMastered: wrapup.progress.unchangedMastered || [],
            }
          : null,
        wrapup,
        taskContext: {
          learningPathId: event.data?.pathId,
          taskId: event.data?.taskId,
        },
        sessionEvidence: event.data?.performance || null,
      }).catch(() => null)

      const dialogueKnowledge = await executeSkill(dialogueConceptExtractorDefinition, {
        visibleDialogueContext,
        classroomEventHistory: classroomEventHistory.length > 0
          ? classroomEventHistory
          : wrapup?.sessionStructure?.classroomEventHistory || [],
        currentKnowledgeState: knowledgeState,
      }).catch(() => null)

      if (!sessionKnowledge && !dialogueKnowledge) {
        await this.refreshLearnerSnapshots(event)
        return
      }

      await this.applyProfileUpdate(userId, {
        agentId: this.id,
        timestamp: new Date().toISOString(),
        dataType: 'knowledge-background',
        data: {
          learnerBackground: {
            conceptLedger: sessionKnowledge?.conceptLedger || [],
            recurringConfusions: dialogueKnowledge?.recurringConfusions || [],
            reusableFoundations: mergeStringArrays(sessionKnowledge?.reusableFoundations),
            blockedFoundations: mergeStringArrays(sessionKnowledge?.blockedFoundations),
            transferSignals: mergeTransferSignals(sessionKnowledge?.transferSignals || [], dialogueKnowledge?.transferSignals || []),
          },
        },
        confidence: 0.72,
      })
    } catch {
      // learner enrich is best-effort only and should never block wrapup
    }

    await this.refreshLearnerSnapshots(event)
  }
}

export const learnerCoordinator = new LearnerCoordinator()
export default learnerCoordinator
