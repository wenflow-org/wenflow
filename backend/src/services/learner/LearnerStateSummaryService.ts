import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';
import { classifyLoad } from '../learning/learning-load-verdict';

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
  /** 2026-09-27：当前任务 id——学习状态页「继续学习」据此直达 /learn/:taskId（原先只落路径详情页） */
  taskId?: string;
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

    const pressureLevel: LearnerGlobalStateSummary['pressureLevel'] = metrics.lss >= 7
      ? 'high'
      : metrics.lss >= 4
        ? 'medium'
        : 'low';

    /* #41（2026-10-20）：recover 不再只看「裸 lsb < 0」。
       冷启动学习者的 ktl 基座还没长起来（mature=false），lf 天然略高于 ktl，lsb 必然为负，
       把这种「正在建立适应」判成 recover 会让下游固定产出「近 7 天疲劳度持续高于健康度」的
       伪疲劳断言。改用 classifyLoad 的 imbalanced（form<0 且 ktl 达标）作为唯一失衡判据；
       其余档位仍按 lsb 分带，保持既有 reading。 */
    const loadVerdict = classifyLoad({ ktl: metrics.ktl, lf: metrics.lf });
    const lsb = Number.isFinite(metrics.lsb) ? metrics.lsb : loadVerdict.form;
    const stateLevel: LearnerGlobalStateSummary['stateLevel'] = loadVerdict.imbalanced
      ? 'recover'
      : lsb < 2
        ? 'caution'
        : lsb >= 4
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
      taskId: currentPath.currentPosition.taskId,
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
