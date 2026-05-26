import type { LearnerReplanProjection, LearnerSnapshot, TeachingLearnerProjection } from '../../agents/learner-model-agent/types';

export class LearnerProjectionService {
  toTeachingProjection(snapshot: LearnerSnapshot): TeachingLearnerProjection {
    const currentPath = snapshot.knowledgeMemory.currentPath;

    return {
      stableProfile: {
        thinkingStyle: snapshot.profile.cognitive.thinkingStyle,
        preferredStyle: snapshot.profile.preferences.preferredStyle,
        theoryVsPractice: snapshot.profile.preferences.theoryVsPractice,
        sessionLength: snapshot.profile.preferences.sessionLength,
        confidenceLevel: snapshot.profile.emotional.confidenceLevel,
      },
      liveState: {
        lss: snapshot.dynamicState.metrics.lss,
        ktl: snapshot.dynamicState.metrics.ktl,
        lf: snapshot.dynamicState.metrics.lf,
        lsb: snapshot.dynamicState.metrics.lsb,
        recentTrend: snapshot.dynamicState.recentTrend,
        recommendedPacing: snapshot.dynamicState.recommendedPacing,
      },
      pathContext: {
        pathTitle: currentPath?.pathTitle || '当前学习路径',
        pathSummary: currentPath?.pathSummary,
        currentMilestoneTitle: currentPath?.currentPosition.milestoneTitle || '当前阶段',
        currentStageNumber: currentPath?.currentPosition.stageNumber || 1,
        currentTaskOrder: currentPath?.currentPosition.taskOrder || 1,
        totalTasksInMilestone: currentPath?.currentPosition.totalTasksInMilestone || 0,
        completedPrerequisiteTasks: currentPath?.taskMastery
          .filter((task) => task.status === 'completed')
          .map((task) => task.title)
          .slice(-5) || [],
      },
      relevantKnowledge: {
        mastered: snapshot.knowledgeMemory.globalSignals.masteredConcepts,
        fragile: snapshot.knowledgeMemory.globalSignals.fragileConcepts,
        struggling: snapshot.knowledgeMemory.globalSignals.strugglingConcepts,
      },
      backgroundKnowledge: {
        reusableFoundations: snapshot.knowledgeMemory.globalBackground.reusableFoundations,
        blockedFoundations: snapshot.knowledgeMemory.globalBackground.blockedFoundations,
        recentConceptLedger: snapshot.knowledgeMemory.globalBackground.conceptLedger.slice(0, 12),
        recurringConfusions: snapshot.knowledgeMemory.globalBackground.recurringConfusions.slice(0, 8),
      },
      learningControlState: snapshot.learningControlState,
      teachingHints: {
        promptEnhancement: snapshot.teachingHints.promptEnhancement,
        recommendedApproach: snapshot.teachingHints.recommendedApproach,
        emphasize: snapshot.teachingHints.emphasize,
        avoid: snapshot.teachingHints.avoid,
      },
    };
  }

  toReplanProjection(snapshot: LearnerSnapshot): LearnerReplanProjection | null {
    const currentPath = snapshot.knowledgeMemory.currentPath;
    if (!currentPath) return null;

    return {
      path: {
        learningPathId: currentPath.learningPathId,
        pathTitle: currentPath.pathTitle,
        progress: currentPath.progress,
        currentPosition: {
          milestoneId: currentPath.currentPosition.milestoneId,
          stageNumber: currentPath.currentPosition.stageNumber,
          milestoneTitle: currentPath.currentPosition.milestoneTitle,
          taskId: currentPath.currentPosition.taskId,
          taskTitle: currentPath.currentPosition.taskTitle,
        },
      },
      mastery: {
        stableTaskIds: currentPath.taskMastery.filter((task) => task.masteryState === 'stable').map((task) => task.taskId),
        fragileTaskIds: currentPath.taskMastery.filter((task) => task.masteryState === 'fragile').map((task) => task.taskId),
        stableConcepts: snapshot.knowledgeMemory.globalSignals.masteredConcepts,
        fragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts,
        strugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts,
      },
      risk: {
        fatigueRisk: snapshot.dynamicState.fatigueRisk,
        recentTrend: snapshot.dynamicState.recentTrend,
        prerequisiteGaps: currentPath.prerequisiteGaps.map((gap) => ({
          conceptKey: gap.conceptKey,
          label: gap.label,
          severity: gap.severity,
        })),
      },
      evidence: {
        recentEvidence: currentPath.recentEvidence,
        milestoneStates: currentPath.milestoneProgress,
        taskMastery: currentPath.taskMastery,
      },
      signal: snapshot.replanSignal,
    };
  }
}

export const learnerProjectionService = new LearnerProjectionService();
