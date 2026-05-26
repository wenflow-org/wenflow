import { executeSkill } from '../../skills';
import { sessionKnowledgeDistillerDefinition } from '../../skills/session-knowledge-distiller';
import { dialogueConceptExtractorDefinition } from '../../skills/dialogue-concept-extractor';
import { EventBus, LearningEvent } from '../../gateway/event-bus';
import { learnerModelAgent } from '../../agents/learner-model-agent';

function mergeStringArrays(...values: Array<Array<string> | undefined>): string[] {
  return Array.from(new Set(values.flatMap((items) => Array.isArray(items) ? items.filter(Boolean) : [])));
}

function mergeTransferSignals(
  primary: Array<{ conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>,
  secondary: Array<{ conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>
) {
  const merged = new Map<string, { conceptKey: string; label: string; readiness: 'low' | 'medium' | 'high'; confidence: number }>();
  for (const item of [...primary, ...secondary]) {
    if (!item?.conceptKey) continue;
    const existing = merged.get(item.conceptKey);
    if (!existing || item.confidence >= existing.confidence) {
      merged.set(item.conceptKey, item);
    }
  }
  return Array.from(merged.values()).slice(0, 20);
}

export class LearnerBackgroundOrchestrator {
  setupEventListeners(eventBus: EventBus): void {
    eventBus.on('lesson:completed', async (event) => {
      await this.handleLessonCompleted(event);
    });
  }

  private async handleLessonCompleted(event: LearningEvent): Promise<void> {
    const userId = event.userId;
    if (!userId) return;

    try {
      const wrapup = event.data?.wrapup || null;
      const knowledgeState = Array.isArray(event.data?.knowledgeState) ? event.data.knowledgeState : [];
      const visibleDialogueContext = Array.isArray(event.data?.visibleDialogueContext)
        ? event.data.visibleDialogueContext
            .map((item: any) => ({
              role: typeof item?.role === 'string' ? item.role : 'user',
              content: typeof item?.content === 'string' ? item.content : '',
              analysis: item?.analysis || null,
            }))
            .filter((item: any) => item.content)
        : [];
      const classroomEventHistory = Array.isArray(event.data?.classroomEventHistory)
        ? event.data.classroomEventHistory
        : [];

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
      }).catch(() => null);

      const dialogueKnowledge = await executeSkill(dialogueConceptExtractorDefinition, {
        visibleDialogueContext,
        classroomEventHistory: classroomEventHistory.length > 0
          ? classroomEventHistory
          : wrapup?.sessionStructure?.classroomEventHistory || [],
        currentKnowledgeState: knowledgeState,
      }).catch(() => null);

      if (!sessionKnowledge && !dialogueKnowledge) {
        return;
      }

      await learnerModelAgent.updateProfile(userId, {
        agentId: 'learner-background-orchestrator',
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
      });
    } catch {
      // best-effort only
    }
  }
}

export const learnerBackgroundOrchestrator = new LearnerBackgroundOrchestrator();
