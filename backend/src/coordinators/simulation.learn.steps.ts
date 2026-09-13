// 模拟协调器 - Learn 阶段步进纯工具函数（自 simulation.coordinator.ts 抽离，行为保持不变；无 this）
import type {
  SimulationMilestone,
  SimulationTask,
  StageResults,
  TeachingState
} from '../virtual-lab/vlab-types';
import type {
  ConversationHistoryItem,
  LearnerLatentState,
  SimulationContext,
  VirtualLearnerProfile
} from './simulation.types';
import {
  buildLearningProgressSnapshot,
  getRunnableTasks,
  mergeLearnerState,
  parseStoryContextFromStageResults,
  resolveLearnerPhase,
  trimLearningConversationHistory
} from './simulation.helpers';
import {
  buildAssistedKnowledgeSnapshot,
  buildAssistedLearnerMemory
} from './simulation.memory';

/** Learn 回合收束判决（teacher / learner 双侧信号聚合） */
export type LearningClosureDecision = {
  teacherReady: boolean;
  learnerReady: boolean;
  canCompleteTask: boolean;
  teacherSignal: {
    isCompletion: boolean;
    autoEnded: boolean;
    classroomStage: string | null;
  };
  learnerFeedback: Record<string, unknown> | null;
  reason: string;
};

/** 定位当前里程碑/可运行任务；调用方仍需处理 currentMilestone / currentTask 缺失分支。 */
export function locateLearningTask(
  milestones: SimulationMilestone[],
  learningState: TeachingState
): {
  currentMilestoneIdx: number;
  currentTaskIdx: number;
  currentMilestone: SimulationMilestone | undefined;
  tasks: SimulationTask[];
  currentTask: SimulationTask | undefined;
} {
  const currentMilestoneIdx = learningState.currentMilestone || 0;
  const currentTaskIdx = learningState.currentTaskIdx || 0;
  const currentMilestone = milestones[currentMilestoneIdx];

  const tasks = getRunnableTasks(currentMilestone?.subtasks || []);
  const currentTask = tasks[currentTaskIdx];

  return { currentMilestoneIdx, currentTaskIdx, currentMilestone, tasks, currentTask };
}

/** 组装教学回合的可见上下文（裁剪历史 + 合并学习者状态 + simulationContext）。 */
export function buildTeachingTurnContext(params: {
  profile: VirtualLearnerProfile;
  learningState: TeachingState;
  stageResults: StageResults;
  currentMilestone: SimulationMilestone;
  currentTask: SimulationTask;
  currentMilestoneIdx: number;
  milestones: SimulationMilestone[];
}): {
  trimmedConversationHistory: ConversationHistoryItem[];
  lastAssistantMessage: string;
  mergedLearnerState: LearnerLatentState;
  simulationContext: SimulationContext;
} {
  const {
    profile,
    learningState,
    stageResults,
    currentMilestone,
    currentTask,
    currentMilestoneIdx,
    milestones
  } = params;

  const trimmedConversationHistory = trimLearningConversationHistory(learningState.conversationHistory || [])
  const lastAssistantMessage = [...trimmedConversationHistory]
    .reverse()
    .find((item) => item.role === 'assistant')?.content || '';

  const mergedLearnerState = mergeLearnerState(profile, learningState.learnerState as Partial<LearnerLatentState> | undefined, 'teaching', parseStoryContextFromStageResults(stageResults))
  const simulationContext: SimulationContext = {
    profile,
    conversationHistory: trimmedConversationHistory,
    lastAssistantMessage,
    currentStage: 'teaching',
    learnerState: {
      ...mergedLearnerState,
      phaseFocus: resolveLearnerPhase(mergedLearnerState)
    },
    learningState: {
      currentMilestone: currentMilestone.title,
      currentTask: currentTask.title,
      milestoneProgress: currentMilestoneIdx + 1,
      totalMilestones: milestones.length
    }
  };

  return { trimmedConversationHistory, lastAssistantMessage, mergedLearnerState, simulationContext };
}

/** 加载教学回合所需的知识看板快照与学习者记忆（assisted 模式）。 */
export async function loadTeachTurnKnowledgeAssets(
  userId: string,
  currentTask: SimulationTask,
  currentMilestone: SimulationMilestone
): Promise<{
  knowledgeSnapshot: Array<{ name: string; status: string; progress: number }>;
  learnerMemoryForSimulator: {
    mastered: string[];
    dueReview: string[];
    struggling: string[];
    recentCompleted: string[];
  } | null;
}> {
  // 知识看板快照：当前任务概念为锚 + 学习者记忆（已掌握/到期复习/易混淆/最近成果）
  const knowledgeSnapshot = await buildAssistedKnowledgeSnapshot(
    userId,
    currentTask,
    currentMilestone
  );
  const learnerMemoryForSimulator = await buildAssistedLearnerMemory(userId);
  return { knowledgeSnapshot, learnerMemoryForSimulator };
}

/** 依据教学系统信号与 AI 学生自评，计算本回合收束判决。 */
export function computeClosureDecision(
  aiResult: {
    isCompletion?: boolean;
    autoEnded?: boolean;
    promptDebug?: {
      learnDebug?: {
        output?: {
          stageDecision?: { stage?: string | null };
        };
      };
    };
  },
  learnerFeedback: Record<string, unknown> | null
): LearningClosureDecision {
  const teacherReady = !!(aiResult.isCompletion || aiResult.autoEnded);
  const learnerReady = !!(
    learnerFeedback?.selfReportedTaskDone === true &&
    learnerFeedback?.wantsMoreHelp !== true &&
    learnerFeedback?.stopAsking === true &&
    (!Array.isArray(learnerFeedback?.remainingBlockers) || learnerFeedback.remainingBlockers.length === 0)
  );
  return {
    teacherReady,
    learnerReady,
    canCompleteTask: teacherReady && learnerReady,
    teacherSignal: {
      isCompletion: !!aiResult.isCompletion,
      autoEnded: !!aiResult.autoEnded,
      classroomStage: aiResult.promptDebug?.learnDebug?.output?.stageDecision?.stage || null
    },
    learnerFeedback,
    reason: teacherReady && learnerReady
      ? '教学系统给出收束信号，AI 学生也自评当前 task 已完成。'
      : teacherReady
        ? '教学系统给出收束信号，但 AI 学生仍未自评完成或仍想继续获得帮助。'
        : learnerReady
          ? 'AI 学生自评当前 task 已完成，但教学系统尚未给出收束信号。'
          : '教学系统与 AI 学生均未同时满足当前 task 收束条件。'
  };
}

/** 组装本回合结束后的 teaching 状态（进度快照 + 学习者状态 + taskRuntime + 对话历史）。 */
export function buildNextLearningState(params: {
  learningState: TeachingState;
  teachingRevision: number | undefined;
  isPathCompleted: boolean;
  milestones: SimulationMilestone[];
  nextMilestoneIdx: number;
  nextTaskIdx: number;
  virtualReply: {
    userVisible: string;
    learnerState?: Record<string, unknown> | null;
    learnerFeedback?: Record<string, unknown> | null;
    internal?: {
      learnerState?: Record<string, unknown> | null;
      learnerFeedback?: Record<string, unknown> | null;
    };
  };
  profile: VirtualLearnerProfile;
  stageResults: StageResults;
  closureDecision: LearningClosureDecision | null;
  learningStepError: string | null;
  currentTask: SimulationTask;
  teachingSessionId: string | null | undefined;
  aiResponse: string;
}): Record<string, unknown> {
  const {
    learningState,
    teachingRevision,
    isPathCompleted,
    milestones,
    nextMilestoneIdx,
    nextTaskIdx,
    virtualReply,
    profile,
    stageResults,
    closureDecision,
    learningStepError,
    currentTask,
    teachingSessionId,
    aiResponse
  } = params;

  return {
    ...learningState,
    teachingRevision,
    ...(isPathCompleted
      ? {
          currentMilestone: milestones.length,
          currentMilestoneTitle: null,
          currentTaskIdx: 0,
          currentTaskId: null,
          currentTaskTitle: null,
          totalMilestones: milestones.length
        }
      : buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx)),
    learnerState: mergeLearnerState(profile, (virtualReply.learnerState || virtualReply.internal?.learnerState) as Partial<LearnerLatentState> | undefined, 'teaching', parseStoryContextFromStageResults(stageResults)),
    latestLearnerFeedback: virtualReply.learnerFeedback || virtualReply.internal?.learnerFeedback || null,
    closureDecision,
    taskRuntime: {
      ...((learningState.taskRuntime ?? {}) as Record<string, unknown>),
      status: learningStepError
        ? 'error'
        : closureDecision?.teacherReady && !closureDecision?.learnerReady
          ? 'teacher_ready_learner_not_satisfied'
          : closureDecision?.learnerReady && !closureDecision?.teacherReady
            ? 'learner_ready_waiting_teacher'
            : 'active',
      taskId: currentTask.id,
      taskTitle: currentTask.title,
      turns: learningState.taskRuntime?.taskId === currentTask.id
        ? Number(learningState.taskRuntime.turns || 0) + 1
        : 1,
      teachingSessionId,
      error: learningStepError,
      closureDecision,
      updatedAt: new Date().toISOString()
    },
    conversationHistory: [
      ...(learningState.conversationHistory || []),
      { role: 'user', content: virtualReply.userVisible },
      { role: 'assistant', content: aiResponse }
    ]
  };
}
