/**
 * 虚拟仿真 Learn 阶段流程（架构审计 §5 行动 #2：simulation.coordinator 按生命周期阶段拆分）
 *
 * 职责：开课（startLearningPhase）、单步学习回合（executeLearningStep：教学回合 + 任务推进 +
 * 检查点消费 + KC/画像回写）、自动学习循环（executeAutoLearning）、停止（requestStop/emergency）、
 * 阶段重跑（restartPathPhase/restartLearningPhase）与课后 wrapup（generateWrapupForSession）。
 *
 * 跨方法调用一律经 ctx（orchestrator 实例）转发，保证测试对实例方法的覆写缝隙不变
 * （full-session-honesty 覆写 executeAutoLearning / waitForPathReady 即依赖此约定）。
 * 行为与拆分前 simulation.coordinator 同名方法逐一等价。
 */
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import learningService from '../services/learning/learning.service';
import { assertPathMutationSafe } from '../services/learning/path-mutation-safety';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingCoordinator';
import { teachingSessionRepository } from '../services/ai-teaching/TeachingSessionRepository';
import { sessionFinalizationService } from '../services/ai-teaching/SessionFinalizationService';
import { executeSkill, virtualLearnerLearnTurnSimulatorDefinition, virtualLearnerEpistemicGroundingDefinition } from '../skills';
import { sessionWrapupAgent, type SessionWrapupInput } from '../skills/session-wrapup';
import simulatedDayService from '../services/virtual-lab/simulated-day.service';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import { writeProfileConceptsAfterLesson } from '../virtual-lab/learner-memory';
import type { SimulationMilestone, StageResults, TeachingState } from '../virtual-lab/vlab-types';
import type { SimulationContext, SimulationLogEntry, ConversationHistoryItem } from './simulation.types';
import { LEARN_AUTO_TURN_CAP } from './simulation.constants';
import {
  buildLearningProgressSnapshot,
  buildLessonOpeningHistory,
  buildProgressAfterTaskCompletion,
  countTaskProgress,
  findTaskInPath,
  getRunnableTasks,
  resolveLearnTurnBudget,
  isAbortLikeLearnError,
  isTransientUpstreamLearnError,
  isProviderRetryable,
  resolveSimLearnerState,
  getSessionFrictionBudget,
  parseProfileData,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
  mergeLearnerState,
  resolveStaleTaskRecovery,
} from './simulation.helpers';
import { decideControlledError } from '../skills/virtual-learner-shared/schemas';
import { findMisconceptionFor } from '../config/misconception-corpus';
import {
  locateLearningTask,
  buildTeachingTurnContext,
  loadTeachTurnKnowledgeAssets,
  computeClosureDecision,
  advanceLearnerDoneStreak,
  shouldBreakClosureLoop,
  LEARN_CLOSURE_LOOP_BREAK_TURNS,
  isExtensionActive,
  shouldCompleteExtension,
  LEARN_EXTENSION_MAX_TURNS,
  LEARN_REVIEW_TURN_CAP,
  appendClosureTrace,
  evaluateStuckClosure,
  buildNextLearningState,
  auditGroundingCompliance,
  clampLearnerStateToJudgment,
  reconcileKnowledgeBoardWithJudgment,
  type LearningClosureDecision,
} from './simulation.learn.steps';
import { VirtualSessionLeaseBusyError } from './simulation.errors';
import { acquireSessionLease, releaseSessionLease } from './simulation.lease';
import {
  buildAssistedMemoryRecall,
  persistKnowledgeState,
} from './simulation.memory';
import type { PendingTeachingCheckpoint } from './simulation.coordinator';
import type { SimulationOrchestrator } from './simulation.coordinator';

/** 教学回合「模型抖动」类结构化错误（详见 simulation.coordinator 历史说明；迁入本模块并自 coordinator re-export）
 *  2026-10-04 并入「非 JSON 输出」：上游偶发 200+纯散文（无截断、token 富余，实测约 3%/步），
 *  prompt-composer 的 JSON 提取拒绝即抛此文案。不归类时直通终局把会话判死→整课重来（死亡螺旋，
 *  实测 24 工位被压到 ~2 课/小时）；归类后走步骤级有界重试，耗尽也只是可续跑暂停。 */
export function isTeachingTurnHiccupError(error: unknown): boolean {
  const message = String(asErrorLike(error).message || error || '');
  if (/TEACHING_TURN_(REPLY_MISSING|REQUIRED_BLOCK_MISSING|REPLY_COMPLETION_MISMATCH|OUTPUT_NOT_OBJECT|OUTPUT_INVALID)/i.test(message)) return true;
  return /response does not contain valid JSON/i.test(message);
}

export async function startLearningPhase(ctx: SimulationOrchestrator, sessionId: string, options: { taskId?: string; mode?: 'tutor' | 'review' } = {}): Promise<{
  success: boolean;
  teachingSessionId?: string;
  welcomeMessage?: string;
  milestones?: SimulationMilestone[];
  selectedTaskId?: string;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    
    const sessionStageResults = parseStageResultsPayload(session.stageResults);
    // failed/abandoned 都是终态（abandoned 含僵尸回收，报告 #10）：不得再开课；
    // 显式复活走 restartLearningPhase（它先恢复为 running 再调本函数）
    if (session.status === 'failed' || session.status === 'abandoned' || sessionStageResults.teaching?.manualStop === true) {
      throw new Error('学习会话已停止或失败，请先重新开始学习（restartLearningPhase）');
    }

    if (!session.learningPathId) {
      throw new Error('学习路径不存在，请先生成路径');
    }

    // 评审是独立质量旁路，不作为 Learn 前置闸门：Path 存在且任务就绪即可启动。
    // Learn 产生进度后，路径变更保护会阻止重规划/删除，证据链不被破坏。
    
    const learningPath = await prisma.learning_paths.findUnique({
      where: { id: session.learningPathId },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });
    
    if (!learningPath || !learningPath.milestones.length) {
      // 里程碑由「阶段设计」异步产出：刚生成完的 Path 常见"路径行已在、里程碑尚未落库"（跑数观察 #6）。
      // 这是**尚未就绪**（可重试），不是"不存在"——措辞要如实，避免误导运维排查。
      throw new Error('学习路径尚未就绪（里程碑生成中），请稍后重试');
    }

    let firstMilestone = learningPath.milestones[0];
    let firstMilestoneIdx = 0;
    let runnableTasks = getRunnableTasks(firstMilestone?.subtasks || []);
    let firstTask = runnableTasks[0];
    let firstTaskIdx = 0;

    if (options.taskId) {
      firstMilestoneIdx = learningPath.milestones.findIndex(m => Array.isArray(m.subtasks) && m.subtasks.some(task => task.id === options.taskId));
      const selectedMilestone = firstMilestoneIdx >= 0 ? learningPath.milestones[firstMilestoneIdx] : undefined;
      runnableTasks = getRunnableTasks(selectedMilestone?.subtasks || []);
      const selectedTask = selectedMilestone?.subtasks?.find((task) => task.id === options.taskId);

      if (!selectedMilestone || !selectedTask) {
        throw new Error('指定任务不存在');
      }

      if (String(selectedTask.status || '').toLowerCase() === 'completed') {
        throw new Error('指定任务已完成，不能重新启动');
      }

      firstMilestone = selectedMilestone;
      firstTask = selectedTask;
      firstTaskIdx = runnableTasks.findIndex(task => task.id === options.taskId);

      if (firstTaskIdx < 0) {
        throw new Error('指定任务当前不可启动');
      }
    }
    
    if (!firstTask) {
      // 子任务由「阶段设计」异步产出：generateLearningPath 里 stage-enrichment 走 runBackgroundTask
      // 且**不 await**——所以刚生成完的 Path 常见「里程碑已建、子任务尚未落库」。
      // 此处**不得删库重建**：restartPathPhase 会重启同一竞态，并在 learning_paths.delete 后留下
      // 孤儿里程碑（实测：3 条路径共 11 个零子任务里程碑）。应按生成状态处置——
      //   仍在生成 → 如实上报"未就绪"，让调用方稍后重试；
      //   确实失败/超时 → 触发官方阶段设计重试（同一个 Path 重跑 stage-designer，不删库）。
      let retryAccepted: { accepted?: boolean; retryCount?: number; mode?: string } | null = null;
      let notReadyReason: string | undefined;
      try {
        retryAccepted = await learningService.retryPathEnrichment(session.learningPathId, session.userId);
      } catch (error: unknown) {
        notReadyReason = asErrorLike(error).message;
      }

      await ctx.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'path-enrichment-not-ready',
        details: {
          output: {
            reason: 'no-runnable-subtasks',
            learningPathId: learningPath.id,
            retryTriggered: retryAccepted?.accepted === true,
            retryCount: retryAccepted?.retryCount ?? null,
            notReadyReason: notReadyReason || null
          }
        }
      });

      logger.warn('[simulation-coordinator] 里程碑无可用任务：阶段设计未就绪（不删路径）', {
        sessionId,
        learningPathId: learningPath.id,
        retryTriggered: retryAccepted?.accepted === true,
        notReadyReason: notReadyReason || null
      });

      const retryLabel = retryAccepted?.mode === 'append' ? '追加空白阶段任务' : '阶段设计重试';
      throw new Error(retryAccepted?.accepted
        ? `第一个里程碑没有可用任务（阶段任务生成中：已触发${retryLabel} #${retryAccepted.retryCount ?? '?'}，请稍后重试）`
        : `第一个里程碑没有可用任务（阶段设计未就绪：${notReadyReason || '未知原因'}）`);
    }
    
    logger.info('[simulation-coordinator] 开始学习阶段', {
      sessionId,
      learningPathId: learningPath.id,
      firstTaskId: firstTask.id,
      firstMilestone: firstMilestone.title
    });
    
    await ctx.assertCurrentSessionLeaseOwned(sessionId);
    // 复习课（#104）：startSession 按 user+task 复用活跃课堂（resume），活跃的 tutor 课堂会让
    // mode=review 静默失效（实测返回同一 teachingSessionId、DB 里 mode 仍是 tutor）。
    // 开复习课前先把同任务的在跑课堂正常收掉，制造课间空窗。
    if (options.mode === 'review') {
      const activeClassroom = await prisma.teaching_sessions.findFirst({
        where: {
          userId: session.userId,
          taskId: firstTask.id,
          status: { in: ['active', 'paused', 'timeout'] },
          NOT: { mode: 'review' },
        },
        select: { id: true, mode: true, revision: true },
        orderBy: { createdAt: 'desc' },
      });
      if (activeClassroom) {
        try {
          // endSession 走乐观并发：不带 revision 会直接报「缺少有效的课堂 revision」
          await aiTeachingOrchestrator.endSession(activeClassroom.id, 'review-switch', activeClassroom.revision);
        } catch (error: unknown) {
          logger.warn('[simulation-coordinator] 开复习课前收束旧课堂失败', {
            sessionId,
            teachingSessionId: activeClassroom.id,
            error: asErrorLike(error).message
          });
        }
      }
    }
    const teachingSession = await ctx.retryLearnUpstream(
      sessionId,
      'start-learning-task',
      () => aiTeachingOrchestrator.startSession({
        userId: session.userId,
        taskId: firstTask.id,
        // 复习课（#104 取样）：到期复习点注入 knowledgeState；收束走 complete_review 且不结算任务
        ...(options.mode === 'review' ? { mode: 'review' as const } : {})
      })
    );
    // 复习课仍被旧课堂复用 → 明确报错，不要静默把教师课堂当复习课跑。
    // 例外：被复用的本来就是复习课堂（上一轮还没收束）→ 直接接着上，属于正常续课。
    if (options.mode === 'review' && teachingSession.mode === 'resumed') {
      const resumedClassroom = await prisma.teaching_sessions.findUnique({
        where: { id: teachingSession.sessionId },
        select: { mode: true },
      });
      if (resumedClassroom?.mode !== 'review') {
        throw new Error('复习课开课失败：同任务的旧课堂未能收束（会复用旧会话），请先结束当前课堂');
      }
    }
    
    await ctx.updateSessionStatus(
      sessionId,
      'running',
      'teaching',
      session.goalConversationId || undefined,
      session.learningPathId
    );
    
    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'teaching-start',
      details: {
        output: {
          teachingSessionId: teachingSession.sessionId,
          welcomeMessage: teachingSession.welcomeMessage,
          currentMilestone: firstMilestone.title,
          currentTask: firstTask.title
        }
      }
    });
    
    await ctx.updateStageResults(sessionId, 'teaching', {
      success: true,
      teachingSessionId: teachingSession.sessionId,
      teachingRevision: teachingSession.revision,
      classroomMode: options.mode === 'review' ? 'review' : 'tutor',
      // 开场白必须进入学习者可见历史：旧实现只写日志，学习者第一轮看不到老师开场，
      // 续跑/重开时还会继承上一课 conversationHistory（外部审计 P0-1）。
      conversationHistory: buildLessonOpeningHistory(teachingSession.welcomeMessage),
      // 新课堂不继承上一课的主观状态/收束判决/延迟计数
      learnerState: undefined,
      latestLearnerFeedback: null,
      closureDecision: null,
      closureTrace: null,
      completionDeferrals: 0,
      lessonKnowledgePoints: undefined,
      lessonDowngradedConcepts: undefined,
      ...buildLearningProgressSnapshot(learningPath.milestones, firstMilestoneIdx, firstTaskIdx)
    });

    await ctx.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        currentTaskId: firstTask.id,
        ...countTaskProgress(learningPath.milestones),
        updatedAt: new Date()
      }
    });
    
    return {
      success: true,
      teachingSessionId: teachingSession.sessionId,
      welcomeMessage: teachingSession.welcomeMessage,
      selectedTaskId: firstTask.id,
      milestones: learningPath.milestones.map(m => ({
        stageNumber: m.stageNumber,
        title: m.title,
        description: m.description,
        estimatedHours: m.estimatedHours,
        subtasksCount: m.subtasks?.length || 0
      }))
    };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 学习阶段启动失败', {
      sessionId,
      error: asErrorLike(error).message
    });
    
    return {
      success: false,
      error: asErrorLike(error).message
    };
  }
}

/**
 * 学习路径全部任务完成后的公共收口：写终态 + 生成 wrapup + 记录阶段日志。
 * executeLearningStep 的各完成分支共用，避免「已完成但会话仍 running/teaching」的悬挂状态。
 */
export async function finalizePathCompletion(ctx: SimulationOrchestrator, sessionId: string, logs: SimulationLogEntry[]) {
  await ctx.updateSessionStatus(sessionId, 'completed', 'teaching');

  logs.push({
    timestamp: new Date().toISOString(),
    phase: 'stage-transition',
    details: {
      output: {
        from: 'teaching',
        to: 'completed',
        message: '学习路径已完成'
      }
    }
  });

  try {
    await ctx.generateWrapupForSession(sessionId);
    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: {
        output: { message: '已生成学习总结' }
      }
    });
  } catch (err: unknown) {
    logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: asErrorLike(err).message });
    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'error',
      details: {
        error: asErrorLike(err).message || 'wrapup generation failed'
      }
    });
  }
}

/**
 * 执行一个学习回合：模拟学习者 → （可选）认知判决 → 教师回合 → 收束/任务结算。
 */
export async function executeLearningStep(ctx: SimulationOrchestrator, sessionId: string, options: { turnBudget?: number } = {}): Promise<{
  success: boolean;
  userMessage?: string;
  aiResponse?: string;
  milestoneProgress?: Record<string, unknown>;
  isPathCompleted?: boolean;
  taskCompleted?: boolean;
  currentTaskStopped?: boolean;
  logs?: SimulationLogEntry[];
  error?: string;
}> {
  const startTime = Date.now();
  const logs: SimulationLogEntry[] = [];
  
  try {
    const session = await ctx.getVirtualSession(sessionId);
    const profile = parseProfileData(session.virtual_learner_profiles);
    
    if (!session.learningPathId) {
      throw new Error('学习路径不存在');
    }

    // 清除上一次教学暂停留下的可重试标记（仅当存在时写库；无标记 → 零写入，成功路径不变）。
    // 若本回合再次抖动，稍后会重新写入。
    await ctx.clearTeachingPauseMarker(sessionId);

    const stageResults: StageResults = parseStageResultsPayload(session.stageResults)
    const simulationConfig = (stageResults.simulationConfig as Record<string, unknown> | undefined) || {}
    // 冻结考卷双臂协议（#85）：A 臂 = 护栏前口径（关闭 #84 后续回合肯定语护栏），B/缺省 = 现行口径。
    // 臂标签只影响对照实验，不改变任何默认行为。
    const experimentArm = String(simulationConfig.experimentArm || '').toUpperCase()
    // 延伸学探针（2026-10-21）：模拟器的 learnerFeedback.wantsExtension 实测 5017/5017 全为 false，
    // assisted 轨的延伸课因此从未开出来（0 节）——功能有通路却没有任何样本可验证。
    // 打开本开关后，本会话**第一次**正课收束时强制开一节延伸课（不论模型是否表达意愿），
    // 用来验证链路与采样；默认关，不改变常规批跑语义。
    const extensionProbe = simulationConfig.extensionProbe === true
    // 建议处置采样（2026-10-21）：VL 产出的重排建议此前 learnerResponse 恒空（无处置通道）。
    // 显式配置处置动作后，收束带回的建议走与真人同一端点的记账语义（只留痕，不执行重排）。
    const advisoryResponse = String(simulationConfig.advisoryResponse || '').toLowerCase()

    const learningState = (stageResults.teaching || {}) as TeachingState;
    if (learningState.manualStop || session.status === 'failed' || session.status === 'abandoned') {
      return {
        success: false,
        error: learningState.stoppedReason ? `学习已停止: ${learningState.stoppedReason}` : `学习已停止（${session.status}）`
      }
    }
    // 冻结语义：暂停期间手动单步同样拒绝（拍板 2026-08-21）——
    // 「暂停」的管理员预期是会话完全静止，而非仅停自动驾驶
    if (learningState.paused === true) {
      return {
        success: false,
        error: '会话已暂停：先恢复（▶ 继续）再执行学习步骤'
      }
    }

    const learningPath = await prisma.learning_paths.findUnique({
      where: { id: session.learningPathId },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });
    
    if (!learningPath) {
      throw new Error('学习路径不存在');
    }
    
    const milestones = (Array.isArray(learningPath.milestones) ? learningPath.milestones : []) as SimulationMilestone[];
    const taskRuntime = (learningState.taskRuntime || {}) as Record<string, unknown>;
    const runtimeTaskMatch = findTaskInPath(milestones, typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : undefined);

    if (taskRuntime.status === 'task_completion_pending' && runtimeTaskMatch) {
      return await ctx.completeCheckpointedSimulationTask(
        sessionId,
        session,
        learningState,
        milestones,
        taskRuntime,
        logs
      );
    }

    // 路径重排会替换/删除下游任务，而会话仍可能拿着旧 currentTaskId。
    // 不先对账就会在 startLearningPhase 撞「指定任务不存在」，并被 harness 误判为路径未就绪。
    const stalePointer = resolveStaleTaskRecovery(
      milestones,
      typeof learningState.currentTaskId === 'string' ? learningState.currentTaskId : null
    );
    if (stalePointer.stale) {
      if (!stalePointer.taskId) {
        await ctx.finalizePathCompletion(sessionId, logs);
        return {
          success: true,
          isPathCompleted: true,
          milestoneProgress: { completed: milestones.length, total: milestones.length },
          logs
        };
      }
      const recoveredTask = findTaskInPath(milestones, stalePointer.taskId);
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: {
          output: {
            reason: 'stale-current-task-after-replan',
            previousTaskId: learningState.currentTaskId,
            recoveredTaskId: stalePointer.taskId,
            recoveredTask: recoveredTask?.task.title || null
          }
        }
      });
      const recoveredStart = await ctx.startLearningPhase(sessionId, { taskId: stalePointer.taskId });
      if (!recoveredStart.success) {
        return {
          success: false,
          logs,
          error: recoveredStart.error || '路径重排后恢复下一学习任务失败'
        };
      }
      return {
        success: true,
        taskCompleted: false,
        currentTaskStopped: false,
        milestoneProgress: {
          currentMilestone: recoveredTask ? recoveredTask.milestoneIdx + 1 : null,
          totalMilestones: milestones.length,
          currentTask: recoveredTask?.task.title || null
        },
        logs
      };
    }

    // 上一节课的失败态（abort/timeout/stale-revision）可能残留在 taskRuntime，
    // 但 currentTaskId 已被推进到下一课。此时继续复用旧课堂只会反复撞同一错误，
    // 应先清掉旧课堂绑定，再按新任务开课。
    const runtimeTaskId = typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : null;
    const runtimeStatus = String(taskRuntime.status || '');
    if (
      runtimeTaskId
      && learningState.currentTaskId
      && runtimeTaskId !== learningState.currentTaskId
      && ['error', 'timeout'].includes(runtimeStatus)
    ) {
      const nextTask = findTaskInPath(milestones, learningState.currentTaskId);
      if (nextTask) {
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              reason: 'stale-task-runtime-after-failure',
              previousTaskId: runtimeTaskId,
              nextTaskId: learningState.currentTaskId,
              nextTask: nextTask.task.title
            }
          }
        });
        await ctx.updateTeachingStatePreservingControlFlags(sessionId, {
          ...learningState,
          teachingSessionId: null,
          taskRuntime: undefined,
        });
        const restarted = await ctx.startLearningPhase(sessionId, { taskId: learningState.currentTaskId });
        if (!restarted.success) {
          return { success: false, logs, error: restarted.error || '恢复下一学习任务失败' };
        }
        return {
          success: true,
          taskCompleted: false,
          currentTaskStopped: false,
          milestoneProgress: {
            currentMilestone: nextTask.milestoneIdx + 1,
            totalMilestones: milestones.length,
            currentTask: nextTask.task.title
          },
          logs
        };
      }
    }

    if (
      runtimeTaskMatch
      && taskRuntime.status !== 'task_completion_pending'
      && taskRuntime.status !== 'completed'
      && taskRuntime.teachingSessionId
    ) {
      const teachingDetail = await aiTeachingOrchestrator.getSessionDetail(
        taskRuntime.teachingSessionId as string,
        session.userId
      );
      if (
        teachingDetail?.id === taskRuntime.teachingSessionId
        && teachingDetail.status === 'completed'
        && teachingDetail.taskId === taskRuntime.taskId
      ) {
        const finalizedAt = taskRuntime.finalizedAt
          || (teachingDetail.endTime ? new Date(teachingDetail.endTime).toISOString() : new Date().toISOString());
        const recoveredRuntime = {
          ...taskRuntime,
          status: 'task_completion_pending',
          taskId: runtimeTaskMatch.task.id,
          taskTitle: runtimeTaskMatch.task.title,
          teachingSessionId: teachingDetail.id,
          teachingRevision: teachingDetail.revision,
          closureDecision: taskRuntime.closureDecision || learningState.closureDecision || null,
          finalizedAt,
          error: null,
          updatedAt: new Date().toISOString()
        };
        const recoveredLearningState = {
          ...learningState,
          teachingRevision: teachingDetail.revision,
          taskRuntime: recoveredRuntime
        };
        await ctx.updateStageResults(sessionId, 'teaching', recoveredLearningState);
        return await ctx.completeCheckpointedSimulationTask(
          sessionId,
          session,
          recoveredLearningState,
          milestones,
          recoveredRuntime,
          logs
        );
      }
    }

    if (taskRuntime.status === 'completed') {
      // 已完成任务与当前指针不同，说明在“完成 → 下一课开课”之间中断；恢复下一课。
      if (
        learningState.currentTaskId
        && taskRuntime.taskId
        && learningState.currentTaskId !== taskRuntime.taskId
      ) {
        const recoveredStart = await ctx.startLearningPhase(sessionId, {
          taskId: learningState.currentTaskId || undefined
        });
        if (!recoveredStart.success) {
          return {
            success: false,
            currentTaskStopped: true,
            logs,
            error: recoveredStart.error || '恢复下一学习任务失败'
          };
        }
        return {
          success: true,
          isPathCompleted: false,
          taskCompleted: false,
          currentTaskStopped: false,
          milestoneProgress: {
            currentMilestone: typeof learningState.currentMilestone === 'number'
              ? learningState.currentMilestone + 1
              : null,
            totalMilestones: milestones.length,
            currentTask: learningState.currentTaskTitle || null
          },
          logs
        };
      }
      const completedProgress = taskRuntime.taskId
        ? buildProgressAfterTaskCompletion(milestones, taskRuntime.taskId as string)
        : null;
      return {
        success: true,
        isPathCompleted: completedProgress?.isPathCompleted || false,
        taskCompleted: true,
        currentTaskStopped: true,
        milestoneProgress: {
          currentMilestone: completedProgress?.isPathCompleted
            ? milestones.length
            : typeof learningState.currentMilestone === 'number' ? learningState.currentMilestone + 1 : null,
          totalMilestones: milestones.length,
          currentTask: learningState.currentTaskTitle || null
        },
        logs
      };
    }

    const { currentMilestoneIdx, currentTaskIdx, currentMilestone, currentTask } = locateLearningTask(milestones, learningState);
    
    if (!currentMilestone) {
      await ctx.finalizePathCompletion(sessionId, logs);
      await ctx.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
        logger.warn('[simulation-coordinator] 记录学习完成日志失败', {
          sessionId,
          error: asErrorLike(logError).message || String(logError)
        });
      });
      return {
        success: true,
        isPathCompleted: true,
        milestoneProgress: {
          completed: milestones.length,
          total: milestones.length
        },
        logs
      };
    }
    
    if (!currentTask) {
      const nextMilestoneIdx = currentMilestoneIdx + 1;
      if (nextMilestoneIdx >= milestones.length) {
        await ctx.finalizePathCompletion(sessionId, logs);
        await ctx.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
          logger.warn('[simulation-coordinator] 记录学习完成日志失败', {
            sessionId,
            error: asErrorLike(logError).message || String(logError)
          });
        });
        return {
          success: true,
          isPathCompleted: true,
          logs
        };
      }
      
      await ctx.updateTeachingStatePreservingControlFlags(sessionId, {
        ...learningState,
        ...buildLearningProgressSnapshot(milestones, nextMilestoneIdx, 0)
      });

      return await ctx.executeLearningStep(sessionId, options);
    }

    // 课时预算（时间盒）：同一 task 回合数超限仍未双方收束 → 按「超时跳课」处理：
    // 标记本课完成（timebox skip），自动推进到下一课，而不是卡住本课等待人工干预。
    // 闸门取三者的最大值：默认 40 / 本次授权回合数（executeAutoLearning 透传）/ 会话生效回合上限。
    // 用户诉求（2026-08-30）：单课程上限轮次超了还没结束，就跳下一节课，不让进度卡死。
    const learnTurnBudget = resolveLearnTurnBudget(stageResults, options.turnBudget);
    const runtimeTurns = taskRuntime.taskId === currentTask.id ? Number(taskRuntime.turns || 0) : 0;
    if (runtimeTurns >= learnTurnBudget) {
      const skipReason = `当前 task 已达 ${learnTurnBudget} 回合课时上限仍未收束，自动跳过本课，进入下一课（timebox-skip）`;
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'teaching-response',
        details: {
          output: {
            currentTask: currentTask.title,
            action: 'turn-budget-skip',
            turns: runtimeTurns,
            budget: learnTurnBudget
          }
        }
      });
      // 构造 timebox 跳过的 pending 完成态，走完整完成链路（completeTask 落库 + 推进下一课）
      const skipFinalizedAt = new Date().toISOString();
      const skipTaskRuntime = {
        status: 'task_completion_pending',
        reason: skipReason,
        taskId: currentTask.id,
        taskTitle: currentTask.title,
        teachingSessionId: taskRuntime.teachingSessionId ?? null,
        teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
        closureDecision: {
          canCompleteTask: true,
          reason: 'timebox-skip',
          autoEnded: true
        },
        finalizedAt: skipFinalizedAt,
        completionSource: 'timebox-skip',
        error: null,
        updatedAt: skipFinalizedAt,
        timeboxSkip: true
      };
      const skipLearningState = {
        ...learningState,
        teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
        // 延伸段属于被跳过的这一课：不在这里关掉，结算快照会带着 active=true 进入下一课，
        // 新课第一回合就被当成延伸段收尾并挂到旧课堂结算（独立评审 P0）。
        ...(learningState.extensionRuntime
          ? {
              extensionRuntime: {
                ...(learningState.extensionRuntime as NonNullable<TeachingState['extensionRuntime']>),
                active: false,
              },
            }
          : {}),
        taskRuntime: skipTaskRuntime
      };
      await ctx.updateTeachingStatePreservingControlFlags(sessionId, skipLearningState);
      // 复用完成链路：endSession（若教学会话在跑）+ completeTask + 推进下一课
      try {
        await ctx.assertCurrentSessionLeaseOwned(sessionId);
        const teachingSessionId = typeof taskRuntime.teachingSessionId === 'string' ? taskRuntime.teachingSessionId : null;
        const teachingRevision = typeof taskRuntime.teachingRevision === 'number'
          ? taskRuntime.teachingRevision
          : (typeof learningState.teachingRevision === 'number' ? learningState.teachingRevision : undefined);
        if (teachingSessionId) {
          await aiTeachingOrchestrator.endSession(teachingSessionId, 'task-completed', teachingRevision).catch(async (endError: unknown) => {
            // #46：旧实现静默吞掉——教学会话收束失败时任务已 completed，留下永久 active 的孤儿会话
            // （wrapup / 证据 / FSRS 全缺）。这里留痕并重试一次，但必须**先现读 revision**：
            // endSession 的 revision 是必填乐观锁（缺省即抛 TEACHING_REVISION_REQUIRED），
            // 旧「去除 revision 重试」实测恒抛、是死代码，永远修不好并发回合推进导致的 STALE。
            logger.warn('[simulation-coordinator] timebox-skip endSession 失败，现读 revision 后重试', {
              sessionId,
              teachingSessionId,
              error: asErrorLike(endError).message || String(endError),
            });
            try {
              const freshTeachingRevision = await ctx.resolveTeachingRevision(teachingSessionId, session.userId);
              await aiTeachingOrchestrator.endSession(teachingSessionId, 'task-completed', freshTeachingRevision);
            } catch (retryError: unknown) {
              logger.warn('[simulation-coordinator] timebox-skip endSession 重试仍失败（孤儿会话待对账）', {
                sessionId,
                teachingSessionId,
                error: asErrorLike(retryError).message || String(retryError),
              });
            }
          });
        }
      } catch (error: unknown) {
        logger.warn('[simulation-coordinator] timebox-skip endSession 失败（不阻断跳课）', {
          sessionId,
          error: asErrorLike(error).message || String(error)
        });
      }
      const skipResult = await ctx.completeCheckpointedSimulationTask(
        sessionId,
        session,
        skipLearningState,
        milestones,
        skipTaskRuntime,
        logs
      );
      if (!skipResult) {
        throw new Error('待跳过的任务不在当前学习路径中');
      }
      if (!skipResult.success && skipResult.currentTaskStopped) {
        // completeTask 失败：保留 pending checkpoint（会话 running，可恢复续传）
        return {
          success: false,
          taskCompleted: false,
          currentTaskStopped: true,
          logs,
          error: skipResult.error || '跳过本课失败（完成结算未落库）'
        };
      }
      await ctx.addSessionLogs(sessionId, logs).catch(() => {});
      return {
        success: true,
        taskCompleted: true,
        isPathCompleted: skipResult.isPathCompleted === true,
        milestoneProgress: skipResult.milestoneProgress,
        logs,
        error: undefined
      };
    }
    
    const {
      trimmedConversationHistory,
      lastAssistantMessage,
      mergedLearnerState,
      simulationContext
    } = buildTeachingTurnContext({
      profile,
      learningState,
      stageResults,
      currentMilestone,
      currentTask,
      currentMilestoneIdx,
      milestones
    });
    
    const virtualReplyStart = Date.now();
    const { knowledgeSnapshot, learnerMemoryForSimulator } = await loadTeachTurnKnowledgeAssets(
      session.userId,
      currentTask,
      currentMilestone,
      Array.isArray(learningState.lessonKnowledgePoints)
        ? (learningState.lessonKnowledgePoints as Array<{ name: string; status: string; progress: number }>)
        : []
    );
    // 教学检查点消费（assisted 链路）：先取当前课堂（答案键已被 getSessionDetail 剥离）。
    // 判决器与模拟器必须看到同一份题面；教师 reply 正文不再打印选项（2026-10-28），
    // 因此这里必须在判决之前取到 pendingCheckpoint。
    const teachingSessionId = learningState.teachingSessionId;
    let pendingCheckpoint: PendingTeachingCheckpoint | null = null;
    if (teachingSessionId) {
      try {
        const teachingDetail = await aiTeachingOrchestrator.getSessionDetail(teachingSessionId, session.userId);
        pendingCheckpoint = (teachingDetail?.pendingCheckpoint as unknown as PendingTeachingCheckpoint | null) || null;
      } catch (checkpointDetailError) {
        logger.warn('[simulation-coordinator] 读取待答理解检查点失败（按无检查点继续）', {
          sessionId,
          teachingSessionId,
          error: asErrorLike(checkpointDetailError).message || String(checkpointDetailError),
        });
      }
    }

    // 阶段1：认知判决（BEAGLE 物理两阶段第一段；失败降级 null，不阻断叙事）
    // 受控错误（2026-10-02 小陈案例 P1-3）：概率在编排层采样（与 friction 同范式），
    // 命中时把硬指令传给判决器 + 判决器失败时直接合成判错判决——
    // 修复「判决概率交 LLM 自由把握 ⇒ 19 连对零失手」的扮演失真。
    const controlledError = decideControlledError({
      frictionBudget: getSessionFrictionBudget(session),
      struggleConcepts: profile.struggleConcepts,
      // 受控错误必须落在本轮正在教的概念上：旧实现只要 struggle 列表非空就按轮转取，
      // 会把别的技能/上节课的卡点硬塞进本轮（外部审计 P1-5）。
      currentTaskConcepts: [
        currentTask.title,
        currentTask.linkedConcept,
        currentTask.coreConcept,
        currentTask.acceptanceCriteria,
        currentMilestone.title,
        // 只用本课看板（learningState 传递），不要用 knowledgeSnapshot：
        // 后者含画像 mastered/struggling/dueReview，会把旧课卡点重新算进"本轮概念域"，
        // 使 P1-5 的域过滤在 assisted/blackbox 两条链路都失效（独立评审）。
        ...(Array.isArray(learningState.lessonKnowledgePoints)
          ? (learningState.lessonKnowledgePoints as Array<{ name?: unknown }>)
              .map((point) => point?.name)
              .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
          : []),
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      turnIndex: Number(taskRuntime.turns) || 0,
      // 真人误区语料库（2026-10-21）：命中就按有出处的具体误区演，没命中回退即兴卡点
      resolveMisconception: (concept) => {
        const hit = findMisconceptionFor(concept);
        return hit ? { statement: hit.statement, why: hit.why ?? null, source: hit.source ?? null } : null;
      },
    });
    let epistemicGrounding: any = null;
    try {
      // P1-7：判决器内容失明——此前 payload 只有画像/任务/看板，判决器看不到"老师本轮讲了什么"，
      // 却要对"本轮能否做对当前这一步"下判决，模拟器又必须服从（simulator yaml:91）。
      // 这里把执行器已经拿到的可见上下文（对话切片 + 教师最新消息）注入判决 payload 尾部。
      const judgeVisibleContext = {
        history: trimmedConversationHistory.map((item) => ({
          role: item.role === 'assistant' ? 'teacher' : 'learner',
          content: item.content,
          // 判决器与模拟器看到同一份可见上下文（#123）：配图一并带上
          ...(Array.isArray(item.images) && item.images.length > 0 ? { images: item.images } : {}),
        })),
        lastTeacherMessage: lastAssistantMessage,
      };
      const groundingRaw: any = await executeSkill(virtualLearnerEpistemicGroundingDefinition, {
        // 路由身份（2026-10-04）：扮演类技能以 VL 本人 userId 解析——user_api_configs 的
        // agnes 绑定（独立 RPM 桶）只在「调用链从用户自有 provider 起步」时生效，批跑以
        // admin 身份调用会永远回落平台 ds。技能内透传给 callPrompt 的 context.userId。
        routingUserId: simulationContext.profile.userId,
        learner: {
          profile: profile.profile || {},
          learningGoal: profile.learningGoal,
          knownConcepts: profile.knownConcepts || [],
          struggleConcepts: profile.struggleConcepts || [],
          personalityTraits: profile.personalityTraits || {},
        },
        currentTask: {
          title: currentTask.title,
          milestoneTitle: currentMilestone.title,
          acceptanceCriteria: currentTask.acceptanceCriteria || null,
          description: currentTask.description || null,
        },
        knowledgeSnapshot,
        visibleContext: judgeVisibleContext,
        ...(pendingCheckpoint ? { pendingCheckpoint } : {}),
        previousLearnerState: mergedLearnerState,
        ...(controlledError.forced ? { forcedCorrectness: controlledError } : {}),
      });
      epistemicGrounding = groundingRaw?.output?.epistemicGrounding || groundingRaw?.epistemicGrounding || null;
      // 判决器忽略编排层指令（比如旧版本 prompt 未同步）时兜底覆写，保证采样语义可测量。
      // targetConcept 为空时保留判决器自己定位的卡点/错误模式，别把具体性抹掉。
      if (controlledError.forced && epistemicGrounding?.sampledCorrectness !== false) {
        epistemicGrounding = {
          ...(epistemicGrounding || {}),
          sampledCorrectness: false,
          blockedConcept: controlledError.targetConcept ?? epistemicGrounding?.blockedConcept ?? null,
          errorPattern: controlledError.targetMisconception?.statement
            ?? epistemicGrounding?.errorPattern
            ?? (controlledError.targetConcept ? `卡在「${controlledError.targetConcept}」` : null),
          masteryProb: 0.15,
        };
      }
    } catch (groundingError) {
      logger.warn('[simulation-coordinator] 认知判决失败（降级为无硬约束叙事）', {
        sessionId,
        error: groundingError instanceof Error ? groundingError.message : String(groundingError),
      });
      // 降级路径同样执行编排层采样指令：否则「判决失败」会退化成无约束流畅答对
      if (controlledError.forced) {
        epistemicGrounding = {
          sampledCorrectness: false,
          blockedConcept: controlledError.targetConcept,
          errorPattern: controlledError.targetMisconception?.statement
            ?? (controlledError.targetConcept ? `卡在「${controlledError.targetConcept}」` : null),
          masteryProb: 0.15,
        };
      }
    }

    // 日期模拟：把"第几天/已过几天"作为可选输入注入（未开启则为 null，输入里省略 = 现网不变）
    const temporalContext = await simulatedDayService.getTemporalContext(session).catch(() => null);
    // Q4：到期旧知的概率化提取判定（代码裁决，确定性可回放；按模拟日作为步进种子，同一天内稳定）
    const memoryRecall = await buildAssistedMemoryRecall(
      session.userId,
      session.id,
      Number(temporalContext?.dayIndex) || 0
    ).catch(() => []);

    // 教学检查点消费（assisted 链路）：已在判决前取到 pendingCheckpoint，这里直接复用。

    const virtualReplyOutput = await ctx.retryLearnUpstream(sessionId, 'simulate-teaching-turn', () => executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
      // 同上：扮演身份 = VL 本人（接通 agnes 独立 RPM 桶）
      routingUserId: simulationContext.profile.userId,
      learner: {
        profile: profile.profile || {},
        learningGoal: profile.learningGoal,
        knownConcepts: profile.knownConcepts || [],
        struggleConcepts: profile.struggleConcepts || [],
        personalityTraits: profile.personalityTraits || {},
      },
      story: parseStoryContextFromStageResults(stageResults),
      visibleContext: {
        history: trimmedConversationHistory.map((item) => ({
          role: item.role === 'assistant' ? 'teacher' : 'learner',
          content: item.content,
          ...(Array.isArray(item.images) && item.images.length > 0 ? { images: item.images } : {}),
        })),
        lastTeacherMessage: lastAssistantMessage,
      },
      currentPhase: simulationContext.learnerState.phaseFocus,
      previousLearnerState: mergedLearnerState,
      currentTask: {
        title: currentTask.title,
        milestoneTitle: currentMilestone.title,
        // 学习者自评“是否达成”要与教师侧用同一判据（subtasks 表已有该字段）
        acceptanceCriteria: currentTask.acceptanceCriteria || null,
        description: currentTask.description || null,
      },
      knowledgeSnapshot,
      learnerMemory: learnerMemoryForSimulator,
      ...(memoryRecall.length ? { memoryRecall } : {}),
      ...(pendingCheckpoint ? { pendingCheckpoint } : {}),
      epistemicGrounding,
      ...(temporalContext ? { temporalContext } : {}),
      frictionBudget: getSessionFrictionBudget(session),
    }));

    const resolvedLearnState = resolveSimLearnerState(virtualReplyOutput);
    // P1-4：判决服从核验——virtualReplyResult 组装时对 blockedConcept 与 reply 做一致性检查。
    // 判错轮 reply 未暴露卡点 / 却宣称"已会" / 自评掌握度越过 masteryProb 上界 → 记 drift，
    // 随会话日志落证据链（区分「判决→服从→答错」与「判决→翻案→答对」，供 VL-1 受控错误锚点甄别）。
    const rawGroundingCompliance = auditGroundingCompliance({
      grounding: epistemicGrounding,
      reply: virtualReplyOutput?.reply || '',
      learnerState: resolvedLearnState as { conceptualMastery?: number; proceduralMastery?: number } | null,
    });
    // P1-4 最低验收：判错轮把自评掌握度钳制到 masteryProb 上界（判决缺失/判对原样）。
    const masteryClamp = clampLearnerStateToJudgment(
      resolvedLearnState as Record<string, unknown>,
      epistemicGrounding
    );
    const clampedLearnState = masteryClamp.learnerState;
    const groundingCompliance = masteryClamp.clampedFields.length
      ? {
          ...auditGroundingCompliance({
            grounding: epistemicGrounding,
            reply: virtualReplyOutput?.reply || '',
            learnerState: clampedLearnState as { conceptualMastery?: number; proceduralMastery?: number } | null,
          }),
          masteryClampedFields: masteryClamp.clampedFields,
          preClampDrift: rawGroundingCompliance.drift,
        }
      : rawGroundingCompliance;
    const virtualReplyResult = {
      success: !!virtualReplyOutput?.reply,
      userVisible: virtualReplyOutput?.reply || '',
      learnerState: clampedLearnState,
      learnerFeedback: virtualReplyOutput?.learnerFeedback,
      runtimeEnvelope: virtualReplyOutput?.runtimeEnvelope || null,
      internal: {
        emotion: virtualReplyOutput?.emotion,
        learnerState: clampedLearnState,
        learnerFeedback: virtualReplyOutput?.learnerFeedback,
        // 判决 + 服从核验：随 internal 一并透出，供日志证据与后续消费方核对
        epistemicGrounding: epistemicGrounding || null,
        groundingCompliance
      }
    };
    
    if (!virtualReplyResult.success || !virtualReplyResult.userVisible) {
      const errorMsg = !virtualReplyOutput?.reply ? '学习者回复生成失败' : '学习者回复为空';
      throw new Error(errorMsg);
    }
    
    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'teaching-reply',
      durationMs: Date.now() - virtualReplyStart,
      details: {
        output: {
          reply: virtualReplyResult.userVisible,
          currentTask: currentTask.title,
          currentMilestone: currentMilestone.title,
          learnerState: virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
          runtimeEnvelope: virtualReplyResult.runtimeEnvelope,
          learnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
          emotion: virtualReplyResult.internal?.emotion,
          // P1-4：主链路判决结构化落证据（session 日志）——判决字段 + 服从核验结果
          epistemicGrounding: epistemicGrounding || null,
          groundingCompliance
        }
      }
    });
    
    let aiResponse = '';
    // 本轮写入学习者可见历史的用户消息：检查点提交时与 payload 对齐（P0-4），
    // 普通聊天就是模拟器原话。
    let learnerVisibleMessage = '';
    // 本课知识看板（随 learningState 传递，不写画像基线；课后统一回写）
    let lessonKnowledgePoints: Array<{ name: string; status: string; progress: number }> =
      Array.isArray(learningState.lessonKnowledgePoints)
        ? (learningState.lessonKnowledgePoints as Array<{ name: string; status: string; progress: number }>)
        : [];
    // 本课被判错降级的看板概念（mastered → learning）。必须在任务结算的画像回写里
    // 显式移除，否则 knownConcepts 的 union-only 语义会让降级在下一课被读回 mastered。
    let lessonDowngradedConcepts: Array<{ name: string; from: string; to: string }> =
      Array.isArray(learningState.lessonDowngradedConcepts)
        ? (learningState.lessonDowngradedConcepts as Array<{ name: string; from: string; to: string }>)
            .filter((item) => item && typeof item.name === 'string' && item.name.trim())
            .map((item) => ({ name: String(item.name).trim(), from: String(item.from || 'mastered'), to: String(item.to || 'learning') }))
        : [];
    // 本轮教师配图（#123）：教学回合产出后随教师消息进学习者可见上下文（模拟学习者"看得见图"）
    let teacherImages: ConversationHistoryItem['images'] | undefined;
    const nextTaskIdx = currentTaskIdx;
    const nextMilestoneIdx = currentMilestoneIdx;
    let learningStepError: string | null = null;
    // 中止类（客户端断开 / 进程重启取消 in-flight 上游）：**非终局**，保留 task 可续跑，
    // 不把会话打成 failed（见 isAbortLikeLearnError 注释 / 跑数观察 #3）。
    let learningStepInterrupted: string | null = null;
    // 教学回合「模型抖动」暂停（新发现问题 #3）：**非终局**，保留 task 可续跑，
    // 不把会话打成 failed，只落 runtimeStats.lastError 标记。
    let learningStepPaused: string | null = null;
    // 暂停原因码（分诊用：模型抖动 vs 上游突发不可用）
    let learningStepPauseCode: string | null = null;
    let closureDecision: LearningClosureDecision | null = null;
    let closureTrace: TeachingState['closureTrace'] = learningState.closureTrace || null;
    let shouldStopCurrentTask = false;

    let teachingRevision = teachingSessionId
      ? await ctx.resolveTeachingRevision(teachingSessionId, session.userId, learningState.teachingRevision)
      : undefined;
    
    if (teachingSessionId) {
      try {
        const aiResponseStart = Date.now();
        await ctx.assertCurrentSessionLeaseOwned(sessionId);
        const aiResult = await ctx.runTeachingTurnWithStepRetry({
          sessionId,
          teachingSessionId,
          learnerMessage: virtualReplyResult.userVisible,
          teachingRevision,
          pendingCheckpoint,
          checkpointAnswer: virtualReplyOutput?.checkpointAnswer || null,
          failedConceptFollowupGuard: experimentArm !== 'A',
        });
        teachingRevision = aiResult.revision;
        
        aiResponse = aiResult.aiResponse || '';
        learnerVisibleMessage = aiResult.learnerVisibleMessage || virtualReplyResult.userVisible;
        teacherImages = Array.isArray(aiResult.images) && aiResult.images.length > 0
          ? aiResult.images.map((image) => ({ url: image.url, caption: image.caption ?? null }))
          : undefined;
        
        // P1-6：看板 × 判决对账——判错轮里被 blockedConcept 命中的教师侧看板项若仍标 mastered，
        // 落库前降级为 learning（progress ≤40），避免教师看板与判决器自相矛盾（audit n=12 中 6 条）。
        // 判决缺失/非判错轮 → 原样（宁松勿误伤）。
        const boardReconciliation = reconcileKnowledgeBoardWithJudgment(
          aiResult.knowledgePoints,
          epistemicGrounding
        );
        // 记忆引擎：教学回合后增量写 memory_traces（知识看板状态 → 内化强度）
        persistKnowledgeState(session.userId, boardReconciliation.points as Array<{ name: string; status: string; progress: number }>, sessionId);
        // 画像基线隔离（外部审计 P2-9）：旧实现在每个教学回合把看板 union 进画像
        // knownConcepts/struggleConcepts，人设的"先验掌握/易卡"被本课进度污染，
        // 下一课甚至同一课后续轮次的判决器/受控错误都读到被改写过的先验。
        // 本课看板改为随 learningState 传递（lessonKnowledgePoints），
        // 画像只在课后由 persistAssistedLearnerMemory + curator 统一回写。
        // 检查点提交回合的 knowledgePoints 恒为空（submit 结果不携带看板），
        // 此时必须保留上一回合看板，否则下一回合的判决/受控错误退回画像先验。
        if (Array.isArray(aiResult.knowledgePoints) && aiResult.knowledgePoints.length > 0) {
          lessonKnowledgePoints = boardReconciliation.points
            .filter((point) => point && typeof point.name === 'string' && point.name.trim())
            .map((point) => ({
              name: String(point.name),
              status: String(point.status),
              progress: Number.isFinite(Number(point.progress)) ? Number(point.progress) : 0,
            }));
        }
        // 降级跨回合累积：同一概念最终被重新掌握时，画像回写里 mastered 会把它重新并回去，
        // 因此这里只记录"本课发生过降级"，不在这里判定最终状态。
        if (boardReconciliation.downgraded.length > 0) {
          const merged = new Map(lessonDowngradedConcepts.map((item) => [item.name, item]));
          for (const item of boardReconciliation.downgraded) merged.set(item.name, item);
          lessonDowngradedConcepts = Array.from(merged.values());
        }
        
        closureDecision = computeClosureDecision(
          aiResult.closureSignal,
          virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
          // P1-5：#46 拍板后判决降级为观测信号（judgeBlocked 留痕），不再否决教师权威结课。
          epistemicGrounding
        );

        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'teaching-response',
          durationMs: Date.now() - aiResponseStart,
          details: {
            output: {
              aiResponse,
              isCompletion: aiResult.isCompletion,
              autoEnded: aiResult.autoEnded || false,
              cognitiveLevel: aiResult.cognitiveLevel,
              knowledgePoint: aiResult.knowledgePoint || null,
              knowledgePoints: aiResult.knowledgePoints,
              strategies: aiResult.strategies,
              peerTriggered: aiResult.peerTriggered,
              peerMessage: aiResult.peerMessage || null,
              currentState: aiResult.currentState || null,
              promptDebug: aiResult.promptDebug || null,
              closureDecision,
              // P1-6：对账降级留痕（哪些看板项因判决被判错而降级）
              knowledgeBoardReconciliation: boardReconciliation.downgraded.length
                ? boardReconciliation.downgraded
                : null,
              // P1-6：实际 profile knownConcepts 移除留痕（下一轮 mastered 不再读回）
              profileKnownConceptsDemotion: boardReconciliation.downgraded.length
                ? boardReconciliation.downgraded
                : null
            }
          }
        });
        
        // 收束循环熔断（2026-10-10 逐字稿评审）：学员连续 N 轮自评完成而教学系统不给收束信号
        // → 按学员意愿结课。连击计数与 buildNextLearningState 的 taskRuntime.learnerDoneStreak 同口径。
        // 延伸学（#124）：延伸段是有界陪学，收尾由 shouldCompleteExtension 判，不走正常课界的熔断。
        const extensionActive = isExtensionActive(learningState.extensionRuntime);
        const currentLearnerFeedback = virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null;
        const learnerDoneStreak = advanceLearnerDoneStreak(
          taskRuntime.taskId === currentTask.id ? Number(taskRuntime.learnerDoneStreak) || 0 : 0,
          closureDecision
        );
        const closureLoopBreak = !extensionActive && shouldBreakClosureLoop(learnerDoneStreak);
        if (closureLoopBreak) {
          closureDecision = {
            ...closureDecision,
            canCompleteTask: true,
            closureAuthority: 'learner-loop-break',
            reason: `连续 ${learnerDoneStreak} 轮学员自评完成而教学系统未给收束信号，触发收束循环熔断，按学员意愿结课`,
          };
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'stage-transition',
            details: {
              output: {
                action: 'closure-loop-break',
                learnerDoneStreak,
                threshold: LEARN_CLOSURE_LOOP_BREAK_TURNS,
                currentTask: currentTask.title,
                message: closureDecision.reason
              }
            }
          });
        }

        // 延伸学（#124 assisted 轨）：extension 模式下教学引擎不产生完成信号（延伸课不结算任务），
        // 收尾由本层判——跑满回合上限或学员表示学够了，就合成收束信号回到正常任务结算链路。
        if (extensionActive) {
          const extensionRuntime = learningState.extensionRuntime as NonNullable<TeachingState['extensionRuntime']>;
          if (shouldCompleteExtension({ runtime: extensionRuntime, learnerFeedback: currentLearnerFeedback })) {
            const extensionTurns = (Number(extensionRuntime.turns) || 0) + 1;
            closureDecision = {
              ...closureDecision,
              teacherReady: true,
              canCompleteTask: true,
              closureAuthority: 'extension-complete',
              reason: `延伸学已进行 ${extensionTurns} 回合（上限 ${extensionRuntime.maxTurns}），收束延伸课并结算本任务`,
            };
            logs.push({
              timestamp: new Date().toISOString(),
              phase: 'stage-transition',
              details: {
                output: {
                  action: 'extension-complete',
                  extensionTurns,
                  maxTurns: extensionRuntime.maxTurns,
                  currentTask: currentTask.title,
                  message: closureDecision.reason
                }
              }
            });
          }
        }

        // 复习课有界收束（#104）：到期点可能很多（注入上限 20），教师会围绕任务目标持续发问；
        // 跑满回合上限即收束（复习课不结算任务，见下方 classroomMode==='review' 分支）。
        if (learningState.classroomMode === 'review' && !closureDecision.canCompleteTask) {
          const reviewTurns = (taskRuntime.taskId === currentTask.id ? Number(taskRuntime.turns) || 0 : 0) + 1;
          if (reviewTurns >= LEARN_REVIEW_TURN_CAP) {
            closureDecision = {
              ...closureDecision,
              teacherReady: true,
              canCompleteTask: true,
              closureAuthority: 'review-turn-cap',
              reason: `复习课已进行 ${reviewTurns} 回合（上限 ${LEARN_REVIEW_TURN_CAP}），收束并回写复习结果`,
            };
            logs.push({
              timestamp: new Date().toISOString(),
              phase: 'stage-transition',
              details: {
                output: {
                  action: 'review-turn-cap',
                  reviewTurns,
                  cap: LEARN_REVIEW_TURN_CAP,
                  currentTask: currentTask.title,
                  message: closureDecision.reason
                }
              }
            });
          }
        }

        // 课堂探针（2026-10-21）：逐回合记录收束轨迹；连续无进展即提前收课，不再烧满回合上限。
        // 复习课/延伸课各有自己的有界收束口径，不参与卡死判定。
        const closureTurn = (taskRuntime.taskId === currentTask.id ? Number(taskRuntime.turns) || 0 : 0) + 1;
        closureTrace = appendClosureTrace(learningState.closureTrace, {
          turn: closureTurn,
          teacherReady: closureDecision.teacherReady === true,
          judgeFalse: closureDecision.judgeBlocked === true,
          mastery: typeof (clampedLearnState as { conceptualMastery?: unknown } | null)?.conceptualMastery === 'number'
            ? Number((clampedLearnState as { conceptualMastery?: number }).conceptualMastery)
            : null,
        });
        const stuckVerdict = learningState.classroomMode === 'review' || extensionActive
          ? { stuck: false, reason: null as string | null, masteryDelta: null as number | null, judgeFalseCount: 0 }
          : evaluateStuckClosure({ trace: closureTrace, totalTurns: closureTurn });

        if (stuckVerdict.stuck && !closureDecision.canCompleteTask) {
          await ctx.assertCurrentSessionLeaseOwned(sessionId);
          const attribution = {
            taskId: currentTask.id,
            taskTitle: currentTask.title,
            turns: closureTurn,
            reason: stuckVerdict.reason,
            masteryDelta: stuckVerdict.masteryDelta,
            judgeFalseCount: stuckVerdict.judgeFalseCount,
            trace: closureTrace,
            lastClosureReason: closureDecision.reason || null,
            lastTeacherMessage: String(aiResponse || '').slice(0, 600),
          };
          await aiTeachingOrchestrator
            .endSession(teachingSessionId, 'non-convergence', teachingRevision)
            .catch((error: unknown) => {
              logger.warn('[simulation-coordinator] 卡死收课 endSession 失败（继续收口）', {
                sessionId,
                teachingSessionId,
                error: asErrorLike(error).message
              });
            });
          const stuckLearningState: TeachingState = {
            ...learningState,
            teachingSessionId: null,
            closureTrace,
            lessonKnowledgePoints,
            lessonDowngradedConcepts,
            // 卡死也是本课的最后一回合：对话与主观状态必须落库，否则离线评审/逐字稿
            // 会看到少一轮的课堂（学员最后一问、老师最后一答都不在）。
            latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
            closureDecision,
            conversationHistory: [
              ...(learningState.conversationHistory || []),
              { role: 'user', content: learnerVisibleMessage || virtualReplyResult.userVisible },
              {
                role: 'assistant',
                content: aiResponse,
                ...(Array.isArray(teacherImages) && teacherImages.length > 0 ? { images: teacherImages } : {})
              }
            ],
            taskRuntime: {
              ...(taskRuntime as Record<string, unknown>),
              status: 'timeout',
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              turns: closureTurn,
              closureAttribution: attribution,
            },
          };
          await ctx.updateTeachingStatePreservingControlFlags(sessionId, stuckLearningState);
          // 归因留痕（append-only）：teaching 会被下一次 restart 整包重写，
          // 只写 taskRuntime 的话当晚就会丢（实测 8 次非收敛只剩 endReason）。
          try {
            await ctx.appendStuckAttribution(sessionId, {
              at: new Date().toISOString(),
              ...attribution,
            });
          } catch (error: unknown) {
            logger.warn('[simulation-coordinator] 卡死归因留痕失败（不影响收口）', {
              sessionId,
              error: asErrorLike(error).message
            });
          }
          logger.warn('[simulation-coordinator] 卡死判定收课', {
            sessionId,
            ...attribution
          });
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'closure-attribution',
            details: {
              output: {
                action: 'stuck-unclosed',
                ...attribution,
                message: `连续 ${closureTrace.length} 回合无收束信号且掌握度不再变化，判定卡死并提前收课（未结算任务）`,
              }
            }
          });
          await ctx.addSessionLogs(sessionId, logs);
          return {
            success: true,
            userMessage: learnerVisibleMessage || virtualReplyResult.userVisible,
            aiResponse,
            milestoneProgress: {
              currentMilestone: nextMilestoneIdx + 1,
              totalMilestones: milestones.length,
              currentTask: currentTask.title
            },
            isPathCompleted: false,
            taskCompleted: false,
            currentTaskStopped: true,
            logs
          };
        }

        if (closureDecision.canCompleteTask) {
          await ctx.assertCurrentSessionLeaseOwned(sessionId);
          // 复习课（#104 校准取样）：收束走 complete_review（wrapup + 复习结果回写记忆引擎），
          // **不结算任务**——复习不是任务完成课。一课一停，下一次复习由调用方重新 start-learning。
          if (learningState.classroomMode === 'review') {
            const reviewFinalizedAt = new Date().toISOString();
            let reviewFinalizeError: string | null = null;
            try {
              await sessionFinalizationService.finalize({
                sessionId: teachingSessionId,
                userId: session.userId,
                action: 'complete_review',
                operationId: `review:${teachingSessionId}:${teachingRevision}`,
                revision: teachingRevision,
              });
            } catch (reviewError: unknown) {
              reviewFinalizeError = asErrorLike(reviewError).message || 'review finalize failed';
              logger.warn('[simulation-coordinator] 复习课 complete_review 失败，降级为 end_only 收束', {
                sessionId,
                teachingSessionId,
                error: reviewFinalizeError
              });
              await aiTeachingOrchestrator
                .endSession(teachingSessionId, 'review-completed', teachingRevision)
                .catch(() => undefined);
            }
            const reviewConversationHistory = [
              ...(learningState.conversationHistory || []),
              { role: 'user', content: learnerVisibleMessage || virtualReplyResult.userVisible },
              {
                role: 'assistant',
                content: aiResponse,
                ...(Array.isArray(teacherImages) && teacherImages.length > 0 ? { images: teacherImages } : {})
              }
            ];
            const reviewLearningState = {
              ...learningState,
              ...learningState,lessonKnowledgePoints,lessonDowngradedConcepts,
              // 课堂已结束：清掉绑定，避免下一次误在已完结课堂里继续推回合
              teachingSessionId: null,
              teachingRevision: null,
              latestLearnerFeedback: currentLearnerFeedback,
              closureDecision,
              taskRuntime: {
                ...taskRuntime,
                status: 'review_completed',
                taskId: currentTask.id,
                taskTitle: currentTask.title,
                reviewCompletedAt: reviewFinalizedAt,
                error: reviewFinalizeError,
                updatedAt: reviewFinalizedAt
              },
              conversationHistory: reviewConversationHistory
            };
            await ctx.updateTeachingStatePreservingControlFlags(sessionId, reviewLearningState);
            // 复习课不结算任务，因此不会走 completeCheckpointedSimulationTask 的记忆回写；
            // 判决降级必须在这里单独落画像，否则复习课里判错的概念永远停留在 mastered。
            if (lessonDowngradedConcepts.length > 0) {
              await writeProfileConceptsAfterLesson(session.userId, [], {
                source: 'assisted-review',
                downgraded: lessonDowngradedConcepts,
              });
            }
            logs.push({
              timestamp: reviewFinalizedAt,
              phase: 'stage-transition',
              details: {
                output: {
                  action: 'review-class-complete',
                  taskId: currentTask.id,
                  taskTitle: currentTask.title,
                  teachingSessionId,
                  reviewFinalizeError,
                  message: '复习课已收束（不结算任务）'
                }
              }
            });
            await ctx.addSessionLogs(sessionId, logs);
            return {
              success: true,
              userMessage: learnerVisibleMessage || virtualReplyResult.userVisible,
              aiResponse,
              milestoneProgress: {
                currentMilestone: nextMilestoneIdx + 1,
                totalMilestones: milestones.length,
                currentTask: currentTask.title
              },
              isPathCompleted: false,
              taskCompleted: false,
              currentTaskStopped: true,
              logs
            };
          }
          const endResult = await aiTeachingOrchestrator.endSession(
            teachingSessionId,
            'task-completed',
            teachingRevision
          );
          teachingRevision = endResult.revision;

          // 建议处置采样（2026-10-21）：收束带回的重排建议会挂在本节课堂的 advisory 上，
          // 真人侧由前端「保留/稍后再看/预览/已采用」调用同一 repository 方法记账；VL 此前没有通道，
          // 336 条建议的 learnerResponse 全空。显式配置后才记录；keep/later/preview 只留痕，
          // adopt 走与真人相同的 replan 成功后才记账（否则执行档永远是 0，无法评估漏斗）。
          if (endResult.advisory?.shouldSuggest === true && advisoryResponse) {
            try {
              if (['keep', 'later', 'preview'].includes(advisoryResponse)) {
                await teachingSessionRepository.recordAdvisoryResponse(
                  teachingSessionId,
                  session.userId,
                  advisoryResponse as 'keep' | 'later' | 'preview'
                );
              } else if (advisoryResponse === 'adopt') {
                const advisory = endResult.advisory as Record<string, any>;
                const recommendation = String(advisory.recommendation || 'reinforce');
                const targetStage = Number(advisory.targetStageNumber);
                const stageParams = Number.isFinite(targetStage) && targetStage > 0
                  ? (advisory.scope === 'downstream_path'
                    ? { fromStageNumber: targetStage }
                    : { stageNumber: targetStage })
                  : {};
                // 同一路径已有后台重排在跑时，再发一次只会撞 PATH_REPLAN_SNAPSHOT_CHANGED
                // （跑批实测 4 次），并把正在学习的任务指针一起改乱。此时只记处置，
                // 让在途重排覆盖这次建议；等它结束后的下一次收束再按新路径判断。
                //
                // 注意不能看 learning_paths.activeGenerationRunId：它在成功收尾时不会清空，
                // 跑批实测三条路径都残留着已 succeeded 的 run，导致 adopt 全被跳过、
                // replanReason 恒 null。以运行表中真正 queued/processing 且租约未过期的行为准。
                const activeReplan = await prisma.path_generation_runs.findFirst({
                  where: {
                    learningPathId: session.learningPathId,
                    status: { in: ['queued', 'processing'] },
                    OR: [
                      { leaseExpiresAt: null },
                      { leaseExpiresAt: { gt: new Date() } },
                    ],
                  },
                  select: { id: true },
                }).catch(() => null);
                if (activeReplan) {
                  await teachingSessionRepository.recordAdvisoryResponse(
                    teachingSessionId,
                    session.userId,
                    'adopt'
                  );
                } else {
                  const replanResult = await learningService.requestPathReplan({
                    pathId: session.learningPathId,
                    userId: session.userId,
                    triggerSource: 'ai-teaching',
                    reason: `虚拟学习者按建议调整后续阶段（${recommendation}）`,
                    mode: recommendation === 'accelerate' ? 'compress' : 'overwrite',
                    requireConfirmation: false,
                    ...stageParams,
                    evidence: { advisoryAction: recommendation, advisory }
                  });
                  // 与前端同口径：只有真正执行（未被转成待确认）才记 adopt。
                  if (replanResult?.status !== 'awaiting-confirmation' && replanResult?.enabled !== false) {
                    await teachingSessionRepository.recordAdvisoryResponse(
                      teachingSessionId,
                      session.userId,
                      'adopt'
                    );
                  }
                }
              }
            } catch (error: unknown) {
              logger.warn('[simulation-coordinator] 建议处置留痕/执行失败（不影响收束）', {
                sessionId,
                teachingSessionId,
                action: advisoryResponse,
                error: asErrorLike(error).message || String(error)
              });
            }
          }

          // 延伸学（#124 assisted 轨）：正课收束时学员明确表达过延伸意愿 → 本任务暂不结算，
          // 先另起一节 extension 课堂陪学一段（有界回合），跑满后再回到这里的结算链路。
          // 每个任务只尝试一次（sourceTaskId 兼作已延伸标记）；开课失败 fail-open，不阻塞任务结算。
          // 2026-10-21：模型从不表达延伸意愿（5017/5017 false），加 extensionProbe —— 每会话一次强制开课。
          const extensionAlreadyForTask = learningState.extensionRuntime?.sourceTaskId === currentTask.id;
          const extensionProbePending = extensionProbe && learningState.extensionProbeUsed !== true;
          const wantsExtensionForTask = currentLearnerFeedback?.wantsExtension === true;
          if (!extensionActive && !extensionAlreadyForTask && (wantsExtensionForTask || extensionProbePending)) {
            try {
              const extensionSession = await aiTeachingOrchestrator.startSession({
                userId: session.userId,
                taskId: currentTask.id,
                mode: 'extension',
              });
              const extensionStartedAt = new Date().toISOString();
              const extensionLearningState = {
                ...learningState,
                ...learningState,lessonKnowledgePoints,lessonDowngradedConcepts,
                teachingSessionId: extensionSession.sessionId,
                teachingRevision: extensionSession.revision,
                latestLearnerFeedback: currentLearnerFeedback,
                ...(extensionProbePending ? { extensionProbeUsed: true } : {}),
                extensionRuntime: {
                  active: true,
                  extensionSessionId: extensionSession.sessionId,
                  sourceSessionId: teachingSessionId,
                  sourceTaskId: currentTask.id,
                  turns: 0,
                  maxTurns: LEARN_EXTENSION_MAX_TURNS,
                  startedAt: extensionStartedAt,
                },
                teachingSessionHistory: [
                  ...(Array.isArray(learningState.teachingSessionHistory) ? learningState.teachingSessionHistory : []),
                  {
                    teachingSessionId: extensionSession.sessionId,
                    taskId: currentTask.id,
                    taskTitle: currentTask.title,
                    status: 'extension',
                    startedAt: extensionStartedAt,
                  },
                ],
                taskRuntime: {
                  ...taskRuntime,
                  status: 'extension_running',
                  taskId: currentTask.id,
                  taskTitle: currentTask.title,
                  teachingSessionId: extensionSession.sessionId,
                  lessonSessionId: teachingSessionId,
                  updatedAt: extensionStartedAt,
                },
                conversationHistory: [
                  ...(learningState.conversationHistory || []),
                  { role: 'user', content: learnerVisibleMessage || virtualReplyResult.userVisible },
                  {
                    role: 'assistant',
                    content: aiResponse,
                    ...(Array.isArray(teacherImages) && teacherImages.length > 0 ? { images: teacherImages } : {})
                  }
                ],
              };
              await ctx.updateTeachingStatePreservingControlFlags(sessionId, extensionLearningState);
              logs.push({
                timestamp: extensionStartedAt,
                phase: 'stage-transition',
                details: {
                  output: {
                    action: 'extension-session-start',
                    taskId: currentTask.id,
                    lessonSessionId: teachingSessionId,
                    extensionSessionId: extensionSession.sessionId,
                    maxTurns: LEARN_EXTENSION_MAX_TURNS,
                    probe: extensionProbePending && !wantsExtensionForTask,
                    message: extensionProbePending && !wantsExtensionForTask
                      ? '延伸学探针：正课收束后强制进入延伸陪学（本任务暂不结算）'
                      : '学员表达延伸意愿，正课收束后进入延伸陪学（本任务暂不结算）',
                  }
                }
              });
              await ctx.addSessionLogs(sessionId, logs);
              return {
                success: true,
                userMessage: learnerVisibleMessage || virtualReplyResult.userVisible,
                aiResponse,
                milestoneProgress: {
                  currentMilestone: nextMilestoneIdx + 1,
                  totalMilestones: milestones.length,
                  currentTask: currentTask.title
                },
                isPathCompleted: false,
                taskCompleted: false,
                logs
              };
            } catch (extensionError: unknown) {
              logger.warn('[simulation-coordinator] 延伸课堂启动失败，按正常收束继续（不阻塞任务结算）', {
                sessionId,
                taskId: currentTask.id,
                error: asErrorLike(extensionError).message || String(extensionError)
              });
              logs.push({
                timestamp: new Date().toISOString(),
                phase: 'error',
                details: {
                  error: asErrorLike(extensionError).message || 'extension session start failed',
                  output: {
                    action: 'extension-session-start-failed',
                    taskId: currentTask.id,
                    fallback: 'complete-task'
                  }
                }
              });
            }
          }

          const taskFinalizedAt = new Date().toISOString();
          const checkpointLearnerState = mergeLearnerState(
            profile,
            virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
            'teaching',
            parseStoryContextFromStageResults(stageResults)
          );
          const checkpointConversationHistory = [
            ...(learningState.conversationHistory || []),
            { role: 'user', content: learnerVisibleMessage || virtualReplyResult.userVisible },
            // 教师配图同上（#123）：结课检查点快照也保住配图
            {
              role: 'assistant',
              content: aiResponse,
              ...(Array.isArray(teacherImages) && teacherImages.length > 0 ? { images: teacherImages } : {})
            }
          ];
          const pendingTaskRuntime = {
            status: 'task_completion_pending',
            reason: closureDecision.reason,
            taskId: currentTask.id,
            taskTitle: currentTask.title,
            // 延伸段收尾时，任务结算仍归属**正课会话**（延伸课是额外陪学，不是结算课）；
            // 正课已在开延伸课时 endSession 完毕，此处对它的二次 endSession 走 completed 幂等分支。
            teachingSessionId: extensionActive
              ? ((learningState.extensionRuntime?.sourceSessionId as string | null | undefined) || teachingSessionId)
              : teachingSessionId,
            teachingRevision,
            closureDecision,
            finalizedAt: taskFinalizedAt,
            completionSource: closureDecision.closureAuthority === 'extension-complete'
              ? 'extension-completed'
              : closureLoopBreak
                ? 'learner-done-streak-break'
                : 'teacher-and-learner-feedback',
            error: null,
            updatedAt: taskFinalizedAt
          };
          const checkpointLearningState = {
            ...learningState,
            ...learningState,lessonKnowledgePoints,lessonDowngradedConcepts,
            teachingRevision,
            learnerState: checkpointLearnerState,
            latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
            closureDecision,
            // 延伸课收尾：保留 sourceTaskId（本任务已延伸过），关闭 active 防重复开延伸段
            ...(learningState.extensionRuntime
              ? {
                  extensionRuntime: {
                    ...(learningState.extensionRuntime as NonNullable<TeachingState['extensionRuntime']>),
                    active: false,
                  }
                }
              : {}),
            taskRuntime: pendingTaskRuntime,
            conversationHistory: checkpointConversationHistory
          };
          await ctx.updateTeachingStatePreservingControlFlags(sessionId, checkpointLearningState);
          const taskCompletionResult = await ctx.completeCheckpointedSimulationTask(
            sessionId,
            session,
            checkpointLearningState,
            milestones,
            pendingTaskRuntime,
            logs
          );
          if (!taskCompletionResult) {
            throw new Error('待完成任务不在当前学习路径中');
          }

          if (taskCompletionResult.success) {
            if (taskCompletionResult.isPathCompleted) {
              logs.push({
                timestamp: new Date().toISOString(),
                phase: 'stage-transition',
                details: {
                  output: {
                    from: 'teaching',
                    to: 'completed',
                    message: '学习路径已完成'
                  }
                }
              });

              try {
                await ctx.generateWrapupForSession(sessionId);
                logs.push({
                  timestamp: new Date().toISOString(),
                  phase: 'stage-transition',
                  details: {
                    output: { message: '已生成学习总结' }
                  }
                });
              } catch (err: unknown) {
                logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: asErrorLike(err).message });
                logs.push({
                  timestamp: new Date().toISOString(),
                  phase: 'error',
                  details: {
                    error: asErrorLike(err).message || 'wrapup generation failed'
                  }
                });
              }
            }

            await ctx.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
              logger.warn('[simulation-coordinator] 记录任务完成日志失败', {
                sessionId,
                error: asErrorLike(logError).message || String(logError)
              });
            });
          }

          return {
            ...taskCompletionResult,
            userMessage: learnerVisibleMessage || virtualReplyResult.userVisible,
            aiResponse,
            logs
          };
        } else if (closureDecision.teacherReady) {
          shouldStopCurrentTask = true;
        }
      } catch (err: unknown) {
        const failureMessage = asErrorLike(err).message || '教学响应失败';
        if (isAbortLikeLearnError(err)) {
          // 中止（客户端断开 / 进程重启取消 in-flight 调用）：**非终局**——不把会话打成 failed，
          // 保留当前 task 供续跑；当天按"未开始"回滚，下一次 advance 可重试。
          learningStepInterrupted = failureMessage;
          logger.warn('[simulation-coordinator] Learn 被中止（非终局，可续跑）', {
            sessionId,
            error: failureMessage
          });
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'teaching-interrupted',
            details: {
              error: failureMessage,
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'teaching-step-interrupted'
              }
            }
          });
        } else if (isTeachingTurnHiccupError(err)) {
          // 新发现问题 #3：模型抖动（如 TEACHING_TURN_REPLY_MISSING）在 prompt 级 2 次 +
          // 步骤级额外重试后仍失败 → **非终局暂停**，不把会话打成 failed。
          // 边界（禁止伪造教师回复）：这里不合成任何兜底 reply/教师话术，只落可重试标记，
          // 保留同一 task 与课堂 revision，下一次 advance-day 重新推进同一回合。
          learningStepPaused = failureMessage;
          logger.warn('[simulation-coordinator] 教学回合模型抖动，暂停本回合（非终局，可续跑）', {
            sessionId,
            error: failureMessage
          });
          logs.push({
            timestamp: new Date().toISOString(),
            // 复用既有的「非终局中断」phase（类型白名单无 paused），以 action 区分暂停语义
            phase: 'teaching-interrupted',
            details: {
              error: failureMessage,
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'teaching-step-paused',
                retryable: true
              }
            }
          });
        } else if (isTransientUpstreamLearnError(err)) {
          // I-1（2026-09-23 四学段测试）：上游突发（5xx/超时/限流）把**单次调用**的重试预算耗尽——
          // 那是"这次上游没给到"，不是"这节课坏了"。与模型抖动同款处理：非终局暂停、保留同一 task
          // 与课堂 revision，下一次 advance-day 重新推进；避免一次突发就把会话打成终态 failed。
          learningStepPaused = failureMessage;
          learningStepPauseCode = 'LEARN_UPSTREAM_TRANSIENT_PAUSED';
          logger.warn('[simulation-coordinator] Learn 上游突发不可用，暂停本回合（非终局，可续跑）', {
            sessionId,
            error: failureMessage
          });
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'teaching-interrupted',
            details: {
              error: failureMessage,
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'teaching-step-upstream-paused',
                retryable: true
              }
            }
          });
        } else {
          logger.warn('[simulation-coordinator] AI教学响应失败，已停止当前学习步骤', {
            sessionId,
            error: failureMessage
          });
          learningStepError = failureMessage;
          aiResponse = `当前教学会话不可继续：${learningStepError}。请重新开始当前 task 或人工检查。`;
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: failureMessage,
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'teaching-step-stopped'
              }
            }
          });
        }
      }
    } else {
      // H-3（夜间审计）：本步没有可驱动的教学会话。典型场景：并行的上一步刚按 non-convergence
      // 收课（endSession + teachingSessionId=null，设计内保留现场等 restart-learning），本步随后
      // 进来。「无绑定教学会话」是收课后的正常中间态，不是上游失败——不能像下方 learningStepError
      // 那样把整个虚拟会话终态化为 failed（F07 实锤：会话被并发步误判终态 → autopilot 同步
      // 终态化、首轮 wrapup 缺失，只能人工 restart-learning）。处理：跳过本步干净返回
      // （对齐本文件「恢复下一学习任务失败」同款 success:false + currentTaskStopped 信号形态），
      // 零会话状态写入；error 保留「没有绑定教学会话」字样——batch 驱动
      // （batch-experiment.service）靠它命中既有 regex 重置 learningStarted 走重启恢复。
      const unboundSessionMessage = '当前 Learn 没有绑定教学会话';
      aiResponse = '当前 Learn 没有绑定教学会话：上一课堂已收束解绑（保留现场等待 restart-learning 续课），本步已跳过，不影响会话状态。';
      logger.warn('[simulation-coordinator] Learn 无绑定教学会话，跳过本步（非终局，不写 failed）', {
        sessionId,
        currentTask: currentTask.title
      });
      logs.push({
        timestamp: new Date().toISOString(),
        // 复用「非终局中断」phase（类型白名单），以 action 区分跳过语义
        phase: 'teaching-interrupted',
        details: {
          error: unboundSessionMessage,
          output: {
            currentTask: currentTask.title,
            currentMilestone: currentMilestone.title,
            action: 'teaching-step-skipped-unbound-classroom',
            retryable: true
          }
        }
      });
      await ctx.addSessionLogs(sessionId, logs);
      return {
        success: false,
        userMessage: virtualReplyResult.userVisible,
        aiResponse,
        logs,
        error: unboundSessionMessage,
        currentTaskStopped: true
      };
    }

    // 新发现问题 #3：教学回合模型抖动 → 非终局暂停。此处**提前返回**，不进入
    // buildNextLearningState / 终局写库：既不追加任何 assistant 消息（杜绝伪教师回复），
    // 也不把会话打成 failed；只落可重试标记并保留同一 task 供下一次 advance-day 重试。
    if (learningStepPaused) {
      await ctx.persistTeachingPauseMarker(sessionId, learningStepPaused, { code: learningStepPauseCode || undefined });
      await ctx.addSessionLogs(sessionId, logs);
      return {
        success: false,
        aiResponse: '教学回合暂时未能生成，已暂停本回合（可续跑）。',
        logs,
        error: learningStepPaused
      };
    }
    
    const isPathCompleted = nextMilestoneIdx >= milestones.length;
    
    const nextLearningState = buildNextLearningState({
      learningState,
      teachingRevision,
      isPathCompleted,
      milestones,
      nextMilestoneIdx,
      nextTaskIdx,
      virtualReply: virtualReplyResult,
      profile,
      stageResults,
      closureDecision,
      learningStepError,
      currentTask,
      teachingSessionId,
      aiResponse,
      teacherImages,
      learnerVisibleMessage,
      lessonKnowledgePoints,
      lessonDowngradedConcepts,
      // 延伸段回合计数：本步已完成一个延伸回合（未收尾时），下次进来按新计数判上限
      extensionRuntime: isExtensionActive(learningState.extensionRuntime)
        ? {
            ...(learningState.extensionRuntime as NonNullable<TeachingState['extensionRuntime']>),
            turns: (Number(learningState.extensionRuntime?.turns) || 0) + 1,
          }
        : learningState.extensionRuntime
    });

    nextLearningState.closureTrace = closureTrace;

    await ctx.updateTeachingStatePreservingControlFlags(sessionId, nextLearningState);
    await ctx.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        currentTaskId: isPathCompleted ? null : currentTask.id,
        status: learningStepError ? 'failed' : undefined,
        currentStage: learningStepError ? 'teaching' : undefined,
        updatedAt: new Date()
      }
    });

    if (learningStepError) {
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: {
          output: {
            from: 'teaching',
            to: 'failed',
            // 文案修正（H-3 审计）：能走到这里的只剩「教学回合抛错且不属于中止/模型抖动/
            // 上游突发」的不可恢复类失败——旧文案「上游调用重试耗尽」与实际分诊不符
            // （可重试的上游突发早已在上方走非终局暂停分支）。
            message: 'Learn 教学回合失败（不可恢复类错误），会话终态化为 failed，保留当前 task 供重启 Learn 恢复',
            currentTaskId: currentTask.id
          }
        }
      });
    }
    
    if (isPathCompleted) {
      await ctx.finalizePathCompletion(sessionId, logs);
    }

    await ctx.addSessionLogs(sessionId, logs);
    
    return {
      success: !learningStepError && !learningStepInterrupted,
      userMessage: learnerVisibleMessage || virtualReplyResult.userVisible,
      aiResponse,
      milestoneProgress: {
        currentMilestone: isPathCompleted
          ? milestones.length
          : nextMilestoneIdx + 1,
        totalMilestones: milestones.length,
        currentTask: isPathCompleted
          ? null
          : (buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx).currentTaskTitle || null)
      },
      isPathCompleted,
      taskCompleted: false,
      ...(shouldStopCurrentTask ? { currentTaskStopped: true } : {}),
      logs,
      error: learningStepError || learningStepInterrupted || undefined
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const outerFailureMessage = asErrorLike(error).message || '学习步骤执行失败';

    // 非终局防线（2026-10-13 夜跑）：内层教学回合 catch 管不到的 LLM 调用点（真凶=785 行「模拟学员
    // 回复」）此前任何失败都直落 persistLearningFailure 判终局——一次池轮换 404（账号池暂无可用账号
    // 服务该模型）就让整节课不可续（两轨 33 次全断于此）。此处与内层 1113/1133/1157 分支同语义：
    // 中止 / 模型抖动 / 上游突发一律**非终局暂停**，保留同一 task 与课堂，下一轮重新推进。
    const abortLikeFailure = isAbortLikeLearnError(error);
    const transientFailure = !abortLikeFailure
      && (isTransientUpstreamLearnError(error) || isTeachingTurnHiccupError(error));
    if (abortLikeFailure || transientFailure) {
      logger.warn('[simulation-coordinator] Learn 步骤被非终局中断（可续跑）', {
        sessionId,
        error: outerFailureMessage,
        abortLike: abortLikeFailure
      });
      await ctx.persistTeachingPauseMarker(
        sessionId,
        outerFailureMessage,
        transientFailure ? { code: 'LEARN_UPSTREAM_TRANSIENT_PAUSED' } : {}
      );
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'teaching-interrupted',
        durationMs,
        details: {
          error: outerFailureMessage,
          output: {
            action: transientFailure ? 'teaching-step-upstream-paused' : 'teaching-step-interrupted',
            retryable: true
          }
        }
      });
      await ctx.addSessionLogs(sessionId, logs);
      return {
        success: false,
        aiResponse: '教学回合暂时未能生成，已暂停本回合（可续跑）。',
        logs,
        error: outerFailureMessage
      };
    }
    
    logger.error('[simulation-coordinator] 学习步骤执行失败', {
      sessionId,
      error: asErrorLike(error).message,
      durationMs
    });
    
    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'error',
      durationMs,
      details: {
        error: asErrorLike(error).message
      }
    });

    await ctx.persistLearningFailure(sessionId, error, logs);
    
    return {
      success: false,
      logs,
      error: asErrorLike(error).message
    };
  }
}

/**
 * F5：manualStop 收口——凡检测到停止标志且会话尚未终态（completed/failed/abandoned），
 * 就地终态化为 abandoned（人为终止拍板 2026-08-21，不计入系统失败率）并补一条停止日志。
 * 幂等：非悬挂态调用一律零写入；返回停止原因（未触发返回 null）。
 *
 * 背景：requestStopLearning 的 deferred 路径把收口承诺交给「运行中的学习循环」，但
 * executeAutoLearning 旧实现只在循环顶兑现——停止落在最后一次迭代的步骤内、或两次
 * executeAutoLearning 调用之间（advance-day 一日多课）时，会话带着 manualStop 永久停在
 * running（runDayLearning 见「已停止」即回滚该日，不再有任何人收口）。收口点因此下沉为
 * 本函数，并在入口与全部出口调用。
 */
async function finalizeManualStopIfNeeded(
  ctx: SimulationOrchestrator,
  sessionId: string,
  latest?: { status: unknown; stageResults: string }
): Promise<string | null> {
  const session = latest ?? (await ctx.getVirtualSession(sessionId));
  const stageResults = parseStageResultsPayload(session.stageResults);
  const teaching = stageResults.teaching;
  if (teaching?.manualStop !== true) return null;
  const status = String(session.status);
  if (status === 'completed' || status === 'failed' || status === 'abandoned') return null;
  await ctx.updateSessionStatus(sessionId, 'abandoned').catch(() => {});
  await ctx.addSessionLog(sessionId, {
    timestamp: new Date().toISOString(),
    phase: 'error',
    details: { error: `EMERGENCY_STOP:${teaching.stoppedReason || 'admin-emergency-stop'}` }
  }).catch(() => {});
  return String(teaching.stoppedReason || 'admin-emergency-stop');
}

export async function executeAutoLearning(
  ctx: SimulationOrchestrator,
  sessionId: string,
  options: { maxMilestones?: number; maxTurns?: number } = {}
): Promise<{
  success: boolean;
  totalSteps?: number;
  completedMilestones?: number;
  /** 本课已完成但下一课启动失败（如预算耗尽）：进度已保留，会话为 failed 可续传 */
  taskCompleted?: boolean;
  error?: string;
}> {
  const maxMilestones = options.maxMilestones || 10;
  
  try {
    let session = await ctx.getVirtualSession(sessionId);

    if (session.status === 'completed') {
      return { success: true, totalSteps: 0, completedMilestones: 0 };
    }

    const initialStageResults = parseStageResultsPayload(session.stageResults)
    if (initialStageResults.teaching?.manualStop || session.status === 'failed' || session.status === 'abandoned') {
      // F5：入口命中停止标志不能只返回错误——deferred 收口承诺在「停止落在最后一次迭代/
      // 两次调用之间」时不兑现，此处补终态化，任何后续学习尝试都能把悬挂态收口（幂等）。
      await finalizeManualStopIfNeeded(ctx, sessionId, session);
      return {
        success: false,
        error: initialStageResults.teaching?.stoppedReason ? `学习已停止: ${initialStageResults.teaching.stoppedReason}` : `学习已停止（${session.status}）`
      }
    }

    if (session.currentStage !== 'teaching') {
      const startResult = await ctx.startLearningPhase(sessionId);
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }
      session = await ctx.getVirtualSession(sessionId)
    }
    
    let steps = 0;
    const maxSteps = options.maxTurns || LEARN_AUTO_TURN_CAP;

    // 外层循环上限 = 课时闸门 + 1（2026-08-30 timebox 语义修复）：
    // 旧实现外层上限与闸门同为 40，导致「回合数达到闸门」的那一轮永远进不来，
    // executeLearningStep 内部的 timebox-skip（endSession + completeTask + 推进下一课）
    // 没有机会触发，外层先耗尽并返回 auto_turn_cap_exhausted 失败。
    // 多给 1 轮，保证闸门那一轮能进入循环并完成跳课。
    const loopLimit = resolveLearnTurnBudget(
      parseStageResultsPayload(session.stageResults),
      maxSteps
    ) + 1;

    for (let i = 0; i < loopLimit; i++) {
      const latestSession = await ctx.getVirtualSession(sessionId)
      const latestStageResults = parseStageResultsPayload(latestSession.stageResults)
      if (latestStageResults.teaching?.manualStop || latestSession.status === 'failed' || latestSession.status === 'abandoned') {
        // 旁路紧急停止（requestStopLearning deferred 路径）：循环退出时就地终态化——
        // 此刻仍持有会话租约，是安全的收口点；避免会话停留在 running + manualStop 的悬挂态。
        // 人为终止记 abandoned（拍板 2026-08-21），不计入系统失败率
        const stoppedReason = await finalizeManualStopIfNeeded(ctx, sessionId, latestSession);
        if (stoppedReason) {
          return {
            success: false,
            totalSteps: steps,
            error: `学习已停止: ${stoppedReason}`
          };
        }
        return {
          success: false,
          totalSteps: steps,
          error: latestStageResults.teaching?.stoppedReason ? `学习已停止: ${latestStageResults.teaching.stoppedReason}` : '学习已停止'
        };
      }
      // 自动驾驶停止请求（autopilot.stopRequested）：管理员在驾驶舱点了「停止自动驾驶」，
      // 与 teaching.manualStop 不同源（前者在 stageResults.autopilot，后者在 teaching），
      // 循环内需单独检测，否则僵死为「自动驾驶 · 0 步」悬挂态
      if ((latestStageResults.autopilot as Record<string, unknown> | undefined)?.stopRequested === true) {
        logger.info('[simulation-coordinator] 检测到自动驾驶停止请求，退出自动学习', { sessionId, steps });
        return { success: true, totalSteps: steps, completedMilestones: 0 };
      }
      // 暂停检查：管理员手动暂停时，停止自动循环（不标记失败，可恢复）
      if (latestStageResults.teaching?.paused === true) {
        logger.info('[simulation-coordinator] 检测到暂停标志，停止自动学习', { sessionId, steps });
        return { success: true, totalSteps: steps, completedMilestones: 0 };
      }

      const stepResult = await ctx.executeLearningStep(sessionId, { turnBudget: maxSteps });
      steps++;

      if (stepResult.isPathCompleted) {
        logger.info('[simulation-coordinator] 自动学习完成', {
          sessionId,
          totalSteps: steps
        });

        // 真实完成数：路径完成即全部里程碑完成，取学习态中的实际总数而非请求上限
        const doneSession = await ctx.getVirtualSession(sessionId);
        const doneTeaching = parseStageResultsPayload(doneSession.stageResults).teaching || {};
        const actualMilestones = Number((doneTeaching as Record<string, unknown>).totalMilestones) || maxMilestones;

        // F5：停止若落在最后一步内，路径已完成的成功出口也要收口（已 completed 时 helper 幂等零写）
        const pathStopReason = await finalizeManualStopIfNeeded(ctx, sessionId, doneSession);
        if (pathStopReason) {
          return {
            success: false,
            totalSteps: steps,
            error: `学习已停止: ${pathStopReason}`
          };
        }

        return {
          success: true,
          totalSteps: steps,
          completedMilestones: actualMilestones
        };
      }

      if (!stepResult.success) {
        const stepErr = stepResult.error || '学习步骤失败';
        // 本课已完成但下一课启动失败（如预算耗尽）：不是循环可重试的错误，
        // 直接返回带 taskCompleted 标记的结果——本课进度已保留，会话已由
        // executeLearningStep 终态化为 failed（可调高预算后重试续传）。
        if (stepResult.taskCompleted) {
          return {
            success: false,
            totalSteps: steps,
            completedMilestones: 1,
            taskCompleted: true,
            error: stepErr
          };
        }
        // Provider 不稳定时自动重试（最多 3 次，间隔递增），而非直接 throw
        if (isProviderRetryable(stepErr) && i < maxSteps - 1) {
          const retryDelay = 3000 * (i === 0 ? 1 : 2);
          logger.warn('[simulation-coordinator] 教学步骤失败，自动重试', {
            sessionId, step: i, error: stepErr.substring(0, 80), retryDelayMs: retryDelay
          });
          await new Promise(r => setTimeout(r, retryDelay));
          // 重试前检查是否需要 restart-learning（会话可能变成 failed）
          const retrySession = await ctx.getVirtualSession(sessionId);
          if (retrySession.status === 'failed') {
            try {
              await ctx.restartLearningPhase(sessionId);
              logger.info('[simulation-coordinator] restart-learning 成功，继续自动学习', { sessionId });
            } catch {
              return { success: false, totalSteps: steps, error: stepErr };
            }
          }
          continue; // 重试当前步骤
        }
        throw new Error(stepErr);
      }

      // “自动完成本课”以课界为终点：本课完成即返回；状态机已自动开下一课，但不代跑。
      if (stepResult.taskCompleted) {
        // F5：停止落在收尾步骤内时，成功出口同样收口（否则会话带着 manualStop 停在 running，
        // 直到下一次学习入口才被入口检查补收）
        const taskStopReason = await finalizeManualStopIfNeeded(ctx, sessionId);
        if (taskStopReason) {
          return {
            success: false,
            totalSteps: steps,
            error: `学习已停止: ${taskStopReason}`
          };
        }
        return {
          success: true,
          totalSteps: steps,
          completedMilestones: 1
        };
      }

      if (stepResult.currentTaskStopped) {
        logger.info('[simulation-coordinator] 当前学习任务已收束或需处理，停止自动学习', {
          sessionId,
          totalSteps: steps
        });

        const taskStopReason = await finalizeManualStopIfNeeded(ctx, sessionId);
        if (taskStopReason) {
          return {
            success: false,
            totalSteps: steps,
            error: `学习已停止: ${taskStopReason}`
          };
        }

        return {
          success: true,
          totalSteps: steps,
          completedMilestones: 0
        };
      }

      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 回合上限耗尽 ≠ 完成：诚实返回失败，不再虚报 completedMilestones
    // 注意：会话仍为 running、本课教学对话仍 active——恢复动作是「调高上限后再次自动推进」或「手动推进对话」，
    // 不应引导「重试」（重试=重开本课教学会话，会丢本课已推进的对话轮次）
    // F5：停止若落在最后一次迭代的步骤内，循环顶不会再执行——此处补收口，避免悬挂在 running+manualStop
    const exhaustedStopReason = await finalizeManualStopIfNeeded(ctx, sessionId);
    if (exhaustedStopReason) {
      return {
        success: false,
        totalSteps: steps,
        completedMilestones: 0,
        error: `学习已停止: ${exhaustedStopReason}`
      };
    }
    return {
      success: false,
      totalSteps: steps,
      completedMilestones: 0,
      error: `auto_turn_cap_exhausted：已自动推进 ${steps} 回合，本课仍未收束。可先调高「回合上限」后再次自动推进，或改用手动单步推进`
    };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 自动学习失败', {
      sessionId,
      error: asErrorLike(error).message
    });
    
    return {
      success: false,
      error: asErrorLike(error).message
    };
  }
}

export async function emergencyStopLearning(ctx: SimulationOrchestrator, sessionId: string, reason = 'admin-emergency-stop'): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId);

    const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

    const learningState = stageResults.teaching || {};
    const teachingSessionId = learningState.teachingSessionId;

    if (teachingSessionId) {
      const teachingRevision = await ctx.resolveTeachingRevision(
        teachingSessionId,
        session.userId,
        learningState.teachingRevision
      );
      await ctx.assertCurrentSessionLeaseOwned(sessionId);
      await aiTeachingOrchestrator.resetSession(
        teachingSessionId,
        session.userId,
        teachingRevision
      ).catch(() => {});
    }

    await ctx.updateStageResults(sessionId, 'teaching', {
      ...learningState,
      manualStop: true,
      stoppedAt: new Date().toISOString(),
      stoppedReason: reason
    });

    // 人为终止统一记 abandoned（拍板 2026-08-21）：failed 只留给系统/上游失败，
    // 避免管理员主动停止污染失败率口径。abandoned 仍可经「重启学习」恢复
    // 不改 currentStage：终止可以发生在 goal / path / teaching 任一阶段，写死 'teaching'
    // 会让「在目标阶段被终止」的会话自称进过课堂——阶段推进把未发生的 Path 标成已完成、
    // deriveRunProgress 判 learnStarted、goalReadiness 抬到 0.86 三处读数一起失真。
    await ctx.updateSessionStatus(sessionId, 'abandoned');

    await ctx.addSessionLog(sessionId, {
      timestamp: new Date().toISOString(),
      phase: 'error',
      details: {
        error: `EMERGENCY_STOP:${reason}`
      }
    });

    return { success: true };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 紧急停止学习失败', {
      sessionId,
      error: asErrorLike(error).message
    });

    return {
      success: false,
      error: asErrorLike(error).message
    };
  }
}

/**
 * 紧急停止（旁路版）：不经租约队列，避免被正在运行的 auto-learning（整循环持一次租约）
 * 阻塞到自然结束——紧急语义要求立即生效。
 * 流程：① 旁路合并写入 manualStop 标志（循环每轮开头检查后自行退出）；
 * ② 尝试无排队获取 DB 租约：拿到说明没有活跃循环，就地复用 emergencyStopLearning 终态化；
 *    拿不到说明循环在跑，返回 deferred，由循环出口或后续学习入口就地终态化
 *    （见 finalizeManualStopIfNeeded；F5 修复前只在循环顶收口，停止落在最后一次迭代/节间会悬挂）。
 */
export async function requestStopLearning(ctx: SimulationOrchestrator, sessionId: string, reason = 'admin-emergency-stop'): Promise<{
  success: boolean;
  deferred?: boolean;
  alreadyStopped?: boolean;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    if (['completed', 'failed', 'abandoned'].includes(session.status)) {
      return { success: true, alreadyStopped: true };
    }

    // ① 旁路写停止标志（保留 teaching 其余键；已在停止流程中则不重复写）
    const stageResults = parseStageResultsPayload(session.stageResults);
    const teaching: Record<string, unknown> = { ...(stageResults.teaching || {}) };
    if (teaching.manualStop !== true) {
      teaching.manualStop = true;
      teaching.stoppedAt = new Date().toISOString();
      teaching.stoppedReason = reason;
      await ctx.updateStageResults(sessionId, 'teaching', teaching);
    }

    // ② 无排队尝试获取租约
    const ownerId = `stop_${uuidv4()}`;
    try {
      await acquireSessionLease(sessionId, ownerId);
    } catch (error) {
      if (error instanceof VirtualSessionLeaseBusyError) {
        logger.info('[simulation-coordinator] 停止标志已写入，运行中的学习循环将自行退出并终态化', { sessionId });
        return { success: true, deferred: true };
      }
      throw error;
    }

    try {
      const result = await ctx.emergencyStopLearning(sessionId, reason);
      return result.success ? { success: true } : result;
    } finally {
      await releaseSessionLease(sessionId, ownerId).catch(() => {});
    }
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 旁路紧急停止失败', {
      sessionId,
      error: asErrorLike(error).message
    });
    return { success: false, error: asErrorLike(error).message };
  }
}

export async function restartPathPhase(ctx: SimulationOrchestrator, sessionId: string): Promise<{
  success: boolean;
  learningPathId?: string;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId)

    const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

    const learningState = stageResults.teaching || {}
    const teachingSessionId = learningState.teachingSessionId

    if (session.learningPathId) {
      // 已进入 Learn/有任务进度的正式 Path 不能删除重建，保留故事→Goal→Path→Learn 证据链。
      await assertPathMutationSafe(prisma, session.learningPathId, 'delete-path')
    }

    if (teachingSessionId) {
      const teachingRevision = await ctx.resolveTeachingRevision(
        teachingSessionId,
        session.userId,
        learningState.teachingRevision
      )
      await ctx.assertCurrentSessionLeaseOwned(sessionId)
      await aiTeachingOrchestrator.resetSession(
        teachingSessionId,
        session.userId,
        teachingRevision
      ).catch(() => {})
    }

    if (session.learningPathId) {
      await prisma.learning_paths.delete({
        where: { id: session.learningPathId }
      })
      // Goal 上的 Path 指针同步清空，避免后续重规划引用已删除的旧 Path。
      if (session.goalConversationId) {
        await prisma.goal_conversations.update({
          where: { id: session.goalConversationId },
          data: { learningPathId: null }
        }).catch(() => {})
      }
    }

    await ctx.resetSessionRuntime(sessionId, {
      keepGoalConversation: true,
      keepLearningPath: false,
      nextStage: 'path',
      nextStatus: 'running',
      removeStageResults: ['path', 'path_review', 'teaching'],
      logPhasesToRemove: ['teaching-start', 'teaching-step', 'stage-transition'],
      // 重启课堂不重置 Path 上已完成 task 的真实进度。
      resetTaskProgress: false,
      clearCompletedAt: true
    })

    return await ctx.advanceToPathGeneration(sessionId)
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 重建路径失败', {
      sessionId,
      error: asErrorLike(error).message
    })

    return {
      success: false,
      error: asErrorLike(error).message
    }
  }
}

export async function restartLearningPhase(ctx: SimulationOrchestrator, sessionId: string, options: { taskId?: string } = {}): Promise<{
  success: boolean;
  teachingSessionId?: string;
  welcomeMessage?: string;
  milestones?: SimulationMilestone[];
  selectedTaskId?: string;
  error?: string;
}> {
  try {
    const session = await ctx.getVirtualSession(sessionId)

    if (session.status === 'completed') {
      throw new Error('学习会话已完成，不能重新开始学习')
    }

    const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

    const learningState = stageResults.teaching || {}
    const teachingSessionId = learningState.teachingSessionId
    const preferredTaskId = options.taskId || learningState.currentTaskId || undefined
    const teachingSessionHistory = [
      ...(Array.isArray(learningState.teachingSessionHistory) ? learningState.teachingSessionHistory : []),
      ...(teachingSessionId ? [{
        teachingSessionId,
        taskId: learningState.currentTaskId || null,
        taskTitle: learningState.currentTaskTitle || null,
        status: 'restarted',
        restartedAt: new Date().toISOString()
      }] : [])
    ]

    if (teachingSessionId) {
      const teachingRevision = await ctx.resolveTeachingRevision(
        teachingSessionId,
        session.userId,
        learningState.teachingRevision
      )
      await ctx.assertCurrentSessionLeaseOwned(sessionId)
      await aiTeachingOrchestrator.resetSession(
        teachingSessionId,
        session.userId,
        teachingRevision
      ).catch(() => {})
    }

    await ctx.resetSessionRuntime(sessionId, {
      keepGoalConversation: true,
      keepLearningPath: true,
      nextStage: 'teaching',
      nextStatus: 'running',
      removeStageResults: ['teaching'],
      logPhasesToRemove: ['teaching-start', 'teaching-step', 'teaching-reply', 'teaching-response', 'stage-transition'],
      // 保留已完成课程进度：重试/自动恢复从「第一个未完成课程」续传，
      // 只重开失败的本课（learning_paths 上已完成的 subtask 状态不受影响）。
      resetTaskProgress: false,
      clearCompletedAt: true
    })

    const restartResult = await ctx.startLearningPhase(sessionId, preferredTaskId ? { taskId: preferredTaskId } : {})
    if (restartResult.success) {
      const restartedSession = await ctx.getVirtualSession(sessionId)
      const restartedStageResults = parseStageResultsPayload(restartedSession.stageResults)
      await ctx.updateStageResults(sessionId, 'teaching', {
        ...(restartedStageResults.teaching || {}),
        teachingSessionHistory
      })
      return restartResult
    }

    if (preferredTaskId && ['指定任务不存在', '指定任务已完成，不能重新启动', '指定任务当前不可启动'].includes(String(restartResult.error || ''))) {
      logger.warn('[simulation-coordinator] 重新开始学习时指定任务不可用，回退到首个可启动任务', {
        sessionId,
        preferredTaskId,
        error: restartResult.error
      })

      return await ctx.startLearningPhase(sessionId)
    }

    // 保留进度后的续传兜底：当前任务缺失/第一个里程碑无可启动任务时，
    // 从「第一个存在可启动任务的里程碑」定位续传点，避免「全部清零重头学」与
    // 「第一里程碑已完成则报错」两个极端。
    if (['第一个里程碑没有可用任务', '指定任务当前不可启动'].includes(String(restartResult.error || ''))) {
      const resumeTaskId = await ctx.findFirstRunnableTaskId(sessionId)
      if (resumeTaskId) {
        logger.info('[simulation-coordinator] 从第一个未完成里程碑续传学习', { sessionId, resumeTaskId })
        return await ctx.startLearningPhase(sessionId, { taskId: resumeTaskId })
      }
      return restartResult
    }

    return restartResult
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 重开学习失败', {
      sessionId,
      error: asErrorLike(error).message
    })

    return {
      success: false,
      error: asErrorLike(error).message
    }
  }
}

/** 扫描全部里程碑，返回第一个「当前可启动」任务 id（保留进度后重试的续传定位） */
export async function findFirstRunnableTaskId(ctx: SimulationOrchestrator, sessionId: string): Promise<string | null> {
  const session = await ctx.getVirtualSession(sessionId)
  if (!session.learningPathId) return null
  const learningPath = await prisma.learning_paths.findUnique({
    where: { id: session.learningPathId },
    include: {
      milestones: {
        orderBy: { stageNumber: 'asc' },
        include: { subtasks: { orderBy: { order: 'asc' } } }
      }
    }
  })
  if (!learningPath) return null
  for (const ms of learningPath.milestones as SimulationMilestone[]) {
    const runnable = getRunnableTasks(ms.subtasks || [])
    if (runnable.length) return runnable[0].id
  }
  return null
}

/**
 * 学习完成后生成 wrapup 总结 (调用 skill:session-wrapup)
 * 将结果写入 stageResults.teaching.wrapup
 */
export async function generateWrapupForSession(ctx: SimulationOrchestrator, sessionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await ctx.getVirtualSession(sessionId);
    const stageResults = parseStageResultsPayload(session.stageResults);
    const learning = stageResults.teaching || {};
    const storyContext = (stageResults.story || stageResults.storyContext || null) as SimulationContext['storyContext'];

    // 已经生成过就不重复
    if (learning.wrapup) {
      return { success: true };
    }

    const conversation = Array.isArray(learning.conversationHistory) ? learning.conversationHistory : [];
    const messages = conversation.map((m: { role?: string; isLearner?: boolean; content?: string; text?: string; timestamp?: string; createdAt?: string }) => ({
      role: m.role || (m.isLearner ? 'user' : 'assistant'),
      content: m.content || m.text || '',
      timestamp: m.timestamp || m.createdAt || undefined
    }));

    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;

    // 业务闸门（拍板 2026-08-21）：课堂总结是「课程学完」的产物。
    // 任务已结算（completed / task_completion_pending）或整路径完成才允许生成，
    // 防止 goal/path 阶段的空对话产出假完成信号、点亮驾驶舱的 wrapup 阶段条
    const runtimeStatus = String(((learning.taskRuntime || {}) as Record<string, unknown>).status || '');
    const taskSettled = runtimeStatus === 'completed' || runtimeStatus === 'task_completion_pending';
    if (session.status !== 'completed' && !taskSettled) {
      return { success: false, error: '课堂总结在课程完成后才会生成：当前任务尚未结算完成' };
    }
    if (userMessageCount < 1 || assistantMessageCount < 1) {
      return { success: false, error: '课堂对话为空，没有可总结的内容' };
    }

    const createdAt = session.createdAt ? new Date(session.createdAt).getTime() : Date.now();
    const completedAt = Date.now();
    const durationMinutes = Math.max(1, Math.round((completedAt - createdAt) / 60000));

    // 知识点: 从 learnerState 抽取
    const learnerState = (learning.learnerState && typeof learning.learnerState === 'object' ? learning.learnerState : {}) as Record<string, unknown>;
    const knowledgePoints: SessionWrapupInput['knowledgePoints'] = Array.isArray(learnerState.knowledgePoints)
      ? learnerState.knowledgePoints.map((kp: { name?: string; label?: string; status?: string; progress?: number }) => ({
          name: kp.name || kp.label || '未命名知识点',
          status: kp.status || 'in_progress',
          progress: typeof kp.progress === 'number' ? kp.progress : 50
        }))
      : [];

    const wrapupInput: SessionWrapupInput = {
      messages,
      knowledgePoints,
      sessionInfo: {
        subject: storyContext?.subject || '虚拟学习场景',
        topic: storyContext?.title || storyContext?.storyTitle || '本次故事',
        durationMinutes,
        userMessageCount,
        assistantMessageCount,
        taskType: 'practice',
        taskTitle: learning.currentTaskTitle || undefined,
        taskDescription: learning.currentTaskDescription || undefined,
        pathTitle: storyContext?.pathTitle || null,
        pathSummary: storyContext?.pathSummary || null
      },
      learningState: typeof learnerState.lss === 'number'
        ? {
            lss: Number(learnerState.lss) || 5,
            ktl: Number(learnerState.ktl) || 5,
            lf: Number(learnerState.lf) || 5,
            lsb: Number(learnerState.lsb) || 5,
            recentTrend: typeof learnerState.recentTrend === 'string' ? learnerState.recentTrend : undefined,
            recommendedPacing: typeof learnerState.recommendedPacing === 'string' ? learnerState.recommendedPacing : undefined
          }
        : undefined
    };

    const result = await sessionWrapupAgent.generate(wrapupInput);

    // 写回 stageResults.teaching.wrapup
    await ctx.updateStageResults(sessionId, 'teaching', {
      ...learning,
      wrapup: {
        generatedAt: new Date().toISOString(),
        summary: result.summary,
        evaluation: result.evaluation,
        summarySource: result.summarySource,
        evaluationSource: result.evaluationSource
      }
    });

    logger.info('[simulation-coordinator] wrapup 已生成', { sessionId });
    return { success: true };
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] generateWrapupForSession 失败', { sessionId, error });
    return { success: false, error: asErrorLike(error).message || 'unknown' };
  }
}
