/**
 * Concept Priority Strategy
 *
 * 动态调整知识分布策略
 * 根据目标类型和建议分布，调整概念性任务比例
 */

import { AdjustmentStrategy, PathAdjustment, AdjustmentReason } from '../../skills/path-planning/adjustment';
import { LearningSignal, AgentContext, MilestoneOutput, SubtaskOutput } from '../../agents/protocol';
import { logger } from '../../utils/logger';

interface ConceptPriorityContext {
  goalType: string;
  suggestedDistribution: {
    conceptual: number;
    practical: number;
    assessment: number;
  };
  currentDistribution: {
    conceptual: number;
    practical: number;
    assessment: number;
  };
}

interface TaskUpgradeResult {
  upgradedTasks: SubtaskOutput[];
  upgradeReasons: string[];
  confidence: number;
}

export const conceptPriorityStrategy: AdjustmentStrategy = {
  name: 'concept-priority',
  description: '动态调整知识分布，确保概念性任务比例符合目标类型要求',
  applicableSignals: ['lane-change', 'struggling'],

  async execute(
    path: any,
    signal: LearningSignal,
    context: AgentContext
  ): Promise<PathAdjustment[]> {
    const adjustments: PathAdjustment[] = [];
    const milestones = path.milestones;

    if (!milestones || milestones.length === 0) {
      return adjustments;
    }

    const priorityContext = extractPriorityContext(path, signal, context);

    const conceptualDeficit = priorityContext.suggestedDistribution.conceptual
      - priorityContext.currentDistribution.conceptual;

    if (conceptualDeficit <= 0.05) {
      logger.info('[ConceptPriorityStrategy] Conceptual tasks sufficient, no adjustment needed');
      return adjustments;
    }

    logger.info('[ConceptPriorityStrategy] Conceptual deficit detected', {
      deficit: conceptualDeficit,
      current: priorityContext.currentDistribution.conceptual,
      suggested: priorityContext.suggestedDistribution.conceptual
    });

    const tasksToUpgrade = findUpgradeCandidates(milestones, conceptualDeficit);

    if (tasksToUpgrade.length === 0) {
      logger.warn('[ConceptPriorityStrategy] No tasks available for upgrade');
      return adjustments;
    }

    const upgradeResult = await upgradeTasksWithLLM(
      tasksToUpgrade,
      priorityContext,
      signal,
      context
    );

    for (const upgradedTask of upgradeResult.upgradedTasks) {
      const milestoneIndex = findMilestoneIndex(milestones, upgradedTask);

      if (milestoneIndex >= 0) {
        adjustments.push({
          type: 'modify',
          target: 'subtask',
          stageNumber: milestoneIndex + 1,
          position: findSubtaskPosition(milestones[milestoneIndex], upgradedTask),
          content: upgradedTask,
          reason: 'lane-change' as AdjustmentReason,
          signal
        });
      }
    }

    if (upgradeResult.upgradeReasons.length > 0) {
      logger.info('[ConceptPriorityStrategy] Tasks upgraded', {
        count: upgradeResult.upgradedTasks.length,
        reasons: upgradeResult.upgradeReasons
      });
    }

    return adjustments;
  }
};

function extractPriorityContext(
  path: any,
  signal: LearningSignal,
  context: AgentContext
): ConceptPriorityContext {
  const goalType = context.metadata?.goalType || 'general';

  const suggestedDistribution = getSuggestedDistribution(goalType);

  const currentDistribution = analyzeCurrentDistribution(path.milestones);

  return {
    goalType,
    suggestedDistribution,
    currentDistribution
  };
}

function getSuggestedDistribution(goalType: string): {
  conceptual: number;
  practical: number;
  assessment: number;
} {
  const distributionMap: Record<string, { conceptual: number; practical: number; assessment: number }> = {
    'theory-heavy': { conceptual: 0.50, practical: 0.35, assessment: 0.15 },
    'skill-focused': { conceptual: 0.25, practical: 0.55, assessment: 0.20 },
    'balanced': { conceptual: 0.35, practical: 0.45, assessment: 0.20 },
    'certification': { conceptual: 0.30, practical: 0.30, assessment: 0.40 },
    'project-based': { conceptual: 0.20, practical: 0.60, assessment: 0.20 },
    'general': { conceptual: 0.30, practical: 0.50, assessment: 0.20 }
  };

  return distributionMap[goalType] || distributionMap['general'];
}

function analyzeCurrentDistribution(milestones: MilestoneOutput[]): {
  conceptual: number;
  practical: number;
  assessment: number;
} {
  let totalTasks = 0;
  let conceptualTasks = 0;
  let practicalTasks = 0;
  let assessmentTasks = 0;

  for (const milestone of milestones) {
    if (!milestone.subtasks) continue;

    for (const subtask of milestone.subtasks) {
      totalTasks++;

      switch (subtask.type) {
        case 'reading':
          conceptualTasks++;
          break;
        case 'practice':
          practicalTasks++;
          break;
        case 'project':
          practicalTasks++;
          break;
        case 'quiz':
          assessmentTasks++;
          break;
      }
    }
  }

  if (totalTasks === 0) {
    return { conceptual: 0, practical: 0, assessment: 0 };
  }

  return {
    conceptual: conceptualTasks / totalTasks,
    practical: practicalTasks / totalTasks,
    assessment: assessmentTasks / totalTasks
  };
}

function findUpgradeCandidates(
  milestones: MilestoneOutput[],
  deficit: number
): SubtaskOutput[] {
  const candidates: SubtaskOutput[] = [];

  const targetCount = Math.ceil(deficit * countTotalSubtasks(milestones));

  for (const milestone of milestones) {
    if (!milestone.subtasks) continue;

    for (const subtask of milestone.subtasks) {
      if (subtask.type === 'practice' && candidates.length < targetCount) {
        candidates.push(subtask);
      }
    }
  }

  return candidates;
}

function countTotalSubtasks(milestones: MilestoneOutput[]): number {
  return milestones.reduce((total, m) => total + (m.subtasks?.length || 0), 0);
}

async function upgradeTasksWithLLM(
  tasks: SubtaskOutput[],
  priorityContext: ConceptPriorityContext,
  signal: LearningSignal,
  context: AgentContext
): Promise<TaskUpgradeResult> {
  try {
    // 懒加载避免 skills/index -> path-planning -> strategies -> skills/index 循环依赖
    const { executeSkillWithResult, auxSkillDefinitionMap } = await import('../../skills');
    const result = await executeSkillWithResult(auxSkillDefinitionMap['concept-priority'], {
      tasks,
      priorityContext,
      signal,
      __fallback: fallbackUpgrade(tasks, priorityContext),
      __prompt: {
        requestPath: '/strategies/concept-priority/upgrade-tasks',
        callerAgentId: 'concept-priority',
      },
    });

    if (result.output) return result.output as TaskUpgradeResult;
  } catch (error) {
    logger.error('[ConceptPriorityStrategy] LLM upgrade failed:', error);
  }

  return fallbackUpgrade(tasks, priorityContext);
}

function fallbackUpgrade(
  tasks: SubtaskOutput[],
  priorityContext: ConceptPriorityContext
): TaskUpgradeResult {
  const upgradedTasks: SubtaskOutput[] = [];
  const upgradeReasons: string[] = [];

  for (const task of tasks.slice(0, 2)) {
    const upgraded: SubtaskOutput = {
      id: task.id,
      title: `${task.title} - 概念理解`,
      type: 'reading',
      estimatedMinutes: Math.min(task.estimatedMinutes, 45),
      description: `理解 ${task.title} 的核心概念和原理`,
      acceptanceCriteria: `能够解释 ${task.title} 的基本概念`,
      status: task.status
    };

    upgradedTasks.push(upgraded);
    upgradeReasons.push(`降级升级：${task.title} 从实践改为概念理解`);
  }

  return {
    upgradedTasks,
    upgradeReasons,
    confidence: 0.5
  };
}

function findMilestoneIndex(milestones: MilestoneOutput[], task: SubtaskOutput): number {
  for (let i = 0; i < milestones.length; i++) {
    const milestone = milestones[i];
    if (!milestone.subtasks) continue;

    for (const subtask of milestone.subtasks) {
      if (subtask.id === task.id) {
        return i;
      }
    }
  }
  return -1;
}

function findSubtaskPosition(milestone: MilestoneOutput, task: SubtaskOutput): number {
  if (!milestone.subtasks) return -1;

  for (let i = 0; i < milestone.subtasks.length; i++) {
    if (milestone.subtasks[i].id === task.id) {
      return i;
    }
  }
  return -1;
}

export function getConceptPriorityStrategies(): AdjustmentStrategy[] {
  return [conceptPriorityStrategy];
}

export default conceptPriorityStrategy;
