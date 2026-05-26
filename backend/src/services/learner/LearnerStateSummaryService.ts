import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';

export interface LearnerGuidanceActionSummary {
  type: 'continue-learning' | 'learning-state' | 'achievements' | 'create-goal' | 'path-detail';
  priority: 'high' | 'medium' | 'low';
}

export interface LearnerGlobalStateSummary {
  stateLevel: 'recover' | 'caution' | 'balanced' | 'strong';
  pressureLevel: 'low' | 'medium' | 'high';
  fatigueLevel: 'low' | 'medium' | 'high';
  trendLevel: 'improving' | 'stable' | 'declining';
  pacingLevel: 'slow' | 'moderate' | 'fast';
  hasWarnings: boolean;
  warningLevel: 'none' | 'info' | 'warning' | 'critical';
  primaryAction: LearnerGuidanceActionSummary['type'];
}

export interface LearnerPathStateSummary {
  pathId?: string;
  title?: string;
  progressPercent: number;
  stageTitle?: string;
  taskTitle?: string;
  hasPrerequisiteGaps: boolean;
  hasFragileConcepts: boolean;
  hasStrugglingConcepts: boolean;
  recommendedAction: 'continue-current-task' | 'review-prerequisites' | 'slow-down' | 'open-path';
}

export interface LearnerStateSummaryOutput {
  global: LearnerGlobalStateSummary;
  path?: LearnerPathStateSummary | null;
}

class LearnerStateSummaryService {
  build(input: {
    learnerSnapshot: LearnerSnapshot;
    learningState?: any;
    path?: any;
    warningCount?: number;
  }): LearnerStateSummaryOutput {
    const snapshot = input.learnerSnapshot;
    const metrics = snapshot.dynamicState.metrics;
    const warningCount = Math.max(0, Number(input.warningCount || 0));
    const fatigueLevel = snapshot.dynamicState.fatigueRisk;
    const trendLevel = snapshot.dynamicState.recentTrend;
    const pacingLevel = snapshot.dynamicState.recommendedPacing;

    const pressureLevel: LearnerGlobalStateSummary['pressureLevel'] = metrics.lss >= 70
      ? 'high'
      : metrics.lss >= 40
        ? 'medium'
        : 'low';

    const stateLevel: LearnerGlobalStateSummary['stateLevel'] = metrics.lsb < 0
      ? 'recover'
      : metrics.lsb < 20
        ? 'caution'
        : metrics.lsb >= 40
          ? 'strong'
          : 'balanced';

    const warningLevel: LearnerGlobalStateSummary['warningLevel'] = warningCount > 1
      ? 'critical'
      : warningCount === 1
        ? 'warning'
        : snapshot.knowledgeMemory.globalSignals.fragileConcepts.length > 0 || snapshot.knowledgeMemory.globalSignals.strugglingConcepts.length > 0
          ? 'info'
          : 'none';

    const primaryAction: LearnerGlobalStateSummary['primaryAction'] = stateLevel === 'recover'
      ? 'learning-state'
      : input.path?.id || snapshot.knowledgeMemory.currentPath?.learningPathId
        ? 'continue-learning'
        : 'create-goal';

    const currentPath = snapshot.knowledgeMemory.currentPath;
    const pathSummary: LearnerPathStateSummary | null = currentPath ? {
      pathId: currentPath.learningPathId,
      title: currentPath.pathTitle,
      progressPercent: currentPath.progress.totalTasks > 0
        ? Math.round((currentPath.progress.completedTasks / currentPath.progress.totalTasks) * 100)
        : 0,
      stageTitle: currentPath.currentPosition.milestoneTitle,
      taskTitle: currentPath.currentPosition.taskTitle,
      hasPrerequisiteGaps: currentPath.prerequisiteGaps.length > 0,
      hasFragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts.length > 0,
      hasStrugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts.length > 0,
      recommendedAction: currentPath.prerequisiteGaps.length > 0
        ? 'review-prerequisites'
        : pacingLevel === 'slow'
          ? 'slow-down'
          : currentPath.currentPosition.taskTitle
            ? 'continue-current-task'
            : 'open-path'
    } : null;

    return {
      global: {
        stateLevel,
        pressureLevel,
        fatigueLevel,
        trendLevel,
        pacingLevel,
        hasWarnings: warningLevel !== 'none',
        warningLevel,
        primaryAction
      },
      path: pathSummary
    };
  }
}

export const learnerStateSummaryService = new LearnerStateSummaryService();
