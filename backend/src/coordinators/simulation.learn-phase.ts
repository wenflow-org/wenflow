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
import { executeSkill, virtualLearnerLearnTurnSimulatorDefinition, virtualLearnerEpistemicGroundingDefinition } from '../skills';
import { sessionWrapupAgent, type SessionWrapupInput } from '../skills/session-wrapup';
import simulatedDayService from '../services/virtual-lab/simulated-day.service';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import type { SimulationMilestone, StageResults, TeachingState } from '../virtual-lab/vlab-types';
import type { SimulationContext, SimulationLogEntry } from './simulation.types';
import { LEARN_AUTO_TURN_CAP } from './simulation.constants';
import {
  buildLearningProgressSnapshot,
  buildProgressAfterTaskCompletion,
  countTaskProgress,
  findTaskInPath,
  getRunnableTasks,
  resolveLearnTurnBudget,
  isAbortLikeLearnError,
  isProviderRetryable,
  resolveSimLearnerState,
  getSessionFrictionBudget,
  parseProfileData,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
  mergeLearnerState,
} from './simulation.helpers';
import {
  locateLearningTask,
  buildTeachingTurnContext,
  loadTeachTurnKnowledgeAssets,
  computeClosureDecision,
  buildNextLearningState,
  type LearningClosureDecision,
} from './simulation.learn.steps';
import { VirtualSessionLeaseBusyError } from './simulation.errors';
import { acquireSessionLease, releaseSessionLease } from './simulation.lease';
import {
  buildAssistedMemoryRecall,
  persistKnowledgeState,
  persistProfileConcepts,
} from './simulation.memory';
import type { PendingTeachingCheckpoint } from './simulation.coordinator';
import type { SimulationOrchestrator } from './simulation.coordinator';

/** 教学回合「模型抖动」类结构化错误（详见 simulation.coordinator 历史说明；迁入本模块并自 coordinator re-export） */
export function isTeachingTurnHiccupError(error: unknown): boolean {
  const message = String(asErrorLike(error).message || error || '');
  return /TEACHING_TURN_(REPLY_MISSING|REQUIRED_BLOCK_MISSING|REPLY_COMPLETION_MISMATCH|OUTPUT_NOT_OBJECT|OUTPUT_INVALID)/i.test(message);
}

export async function startLearningPhase(ctx: SimulationOrchestrator, sessionId: string, options: { taskId?: string } = {}): Promise<{
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
    if (session.status === 'failed' || sessionStageResults.teaching?.manualStop === true) {
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
    const teachingSession = await ctx.retryLearnUpstream(
      sessionId,
      'start-learning-task',
      () => aiTeachingOrchestrator.startSession({
        userId: session.userId,
        taskId: firstTask.id
      })
    );
    
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
          await aiTeachingOrchestrator.endSession(teachingSessionId, 'task-completed', teachingRevision).catch(() => {});
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
      currentMilestone
    );
    // 阶段1：认知判决（BEAGLE 物理两阶段第一段；失败降级 null，不阻断叙事）
    let epistemicGrounding: any = null;
    try {
      const groundingRaw: any = await executeSkill(virtualLearnerEpistemicGroundingDefinition, {
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
        previousLearnerState: mergedLearnerState,
      });
      epistemicGrounding = groundingRaw?.output?.epistemicGrounding || groundingRaw?.epistemicGrounding || null;
    } catch (groundingError) {
      logger.warn('[simulation-coordinator] 认知判决失败（降级为无硬约束叙事）', {
        sessionId,
        error: groundingError instanceof Error ? groundingError.message : String(groundingError),
      });
    }

    // 日期模拟：把"第几天/已过几天"作为可选输入注入（未开启则为 null，输入里省略 = 现网不变）
    const temporalContext = await simulatedDayService.getTemporalContext(session).catch(() => null);
    // Q4：到期旧知的概率化提取判定（代码裁决，确定性可回放；按模拟日作为步进种子，同一天内稳定）
    const memoryRecall = await buildAssistedMemoryRecall(
      session.userId,
      session.id,
      Number(temporalContext?.dayIndex) || 0
    ).catch(() => []);

    // 教学检查点消费（assisted 链路）：先取当前课堂（答案键已被 getSessionDetail 剥离）。
    // 仅当存在待答检查点时注入模拟器输入；读取失败/无检查点一律按原路径继续，不阻断学习。
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

    const virtualReplyOutput = await ctx.retryLearnUpstream(sessionId, 'simulate-teaching-turn', () => executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
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
    const virtualReplyResult = {
      success: !!virtualReplyOutput?.reply,
      userVisible: virtualReplyOutput?.reply || '',
      learnerState: resolvedLearnState,
      learnerFeedback: virtualReplyOutput?.learnerFeedback,
      runtimeEnvelope: virtualReplyOutput?.runtimeEnvelope || null,
      internal: {
        emotion: virtualReplyOutput?.emotion,
        learnerState: resolvedLearnState,
        learnerFeedback: virtualReplyOutput?.learnerFeedback,
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
          emotion: virtualReplyResult.internal?.emotion
        }
      }
    });
    
    let aiResponse = '';
    const nextTaskIdx = currentTaskIdx;
    const nextMilestoneIdx = currentMilestoneIdx;
    let learningStepError: string | null = null;
    // 中止类（客户端断开 / 进程重启取消 in-flight 上游）：**非终局**，保留 task 可续跑，
    // 不把会话打成 failed（见 isAbortLikeLearnError 注释 / 跑数观察 #3）。
    let learningStepInterrupted: string | null = null;
    // 教学回合「模型抖动」暂停（新发现问题 #3）：**非终局**，保留 task 可续跑，
    // 不把会话打成 failed，只落 runtimeStats.lastError 标记。
    let learningStepPaused: string | null = null;
    let closureDecision: LearningClosureDecision | null = null;
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
        });
        teachingRevision = aiResult.revision;
        
        aiResponse = aiResult.aiResponse || '';
        
        // 记忆引擎：教学回合后增量写 memory_traces（知识看板状态 → 内化强度）
        persistKnowledgeState(session.userId, aiResult.knowledgePoints);
        // 画像回写：掌握 → knownConcepts，仍在学/需复习 → struggleConcepts
        void persistProfileConcepts(sessionId, session.userId, aiResult.knowledgePoints);
        
        closureDecision = computeClosureDecision(
          aiResult.closureSignal,
          virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null
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
              closureDecision
            }
          }
        });
        
        if (closureDecision.canCompleteTask) {
          await ctx.assertCurrentSessionLeaseOwned(sessionId);
          const endResult = await aiTeachingOrchestrator.endSession(
            teachingSessionId,
            'task-completed',
            teachingRevision
          );
          teachingRevision = endResult.revision;
          const taskFinalizedAt = new Date().toISOString();
          const checkpointLearnerState = mergeLearnerState(
            profile,
            virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
            'teaching',
            parseStoryContextFromStageResults(stageResults)
          );
          const checkpointConversationHistory = [
            ...(learningState.conversationHistory || []),
            { role: 'user', content: virtualReplyResult.userVisible },
            { role: 'assistant', content: aiResponse }
          ];
          const pendingTaskRuntime = {
            status: 'task_completion_pending',
            reason: closureDecision.reason,
            taskId: currentTask.id,
            taskTitle: currentTask.title,
            teachingSessionId,
            teachingRevision,
            closureDecision,
            finalizedAt: taskFinalizedAt,
            completionSource: 'teacher-and-learner-feedback',
            error: null,
            updatedAt: taskFinalizedAt
          };
          const checkpointLearningState = {
            ...learningState,
            teachingRevision,
            learnerState: checkpointLearnerState,
            latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
            closureDecision,
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
            userMessage: virtualReplyResult.userVisible,
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
      learningStepError = '当前 Learn 没有绑定教学会话';
      aiResponse = '当前 Learn 没有绑定教学会话，请先重新开始当前 task。';
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: '当前 Learn 没有绑定教学会话',
          output: {
            currentTask: currentTask.title,
            currentMilestone: currentMilestone.title,
            action: 'teaching-step-stopped'
          }
        }
      });
    }

    // 新发现问题 #3：教学回合模型抖动 → 非终局暂停。此处**提前返回**，不进入
    // buildNextLearningState / 终局写库：既不追加任何 assistant 消息（杜绝伪教师回复），
    // 也不把会话打成 failed；只落可重试标记并保留同一 task 供下一次 advance-day 重试。
    if (learningStepPaused) {
      await ctx.persistTeachingPauseMarker(sessionId, learningStepPaused);
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
      aiResponse
    });

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
            message: 'Learn 上游调用重试耗尽，保留当前 task 供重启 Learn 恢复',
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
      userMessage: virtualReplyResult.userVisible,
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
        if (latestSession.status !== 'failed' && latestSession.status !== 'abandoned') {
          await ctx.updateSessionStatus(sessionId, 'abandoned', 'teaching').catch(() => {});
          await ctx.addSessionLog(sessionId, {
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: { error: `EMERGENCY_STOP:${latestStageResults.teaching?.stoppedReason || 'admin-emergency-stop'}` }
          }).catch(() => {});
        }
        return {
          success: false,
          totalSteps: steps,
          error: latestStageResults.teaching?.stoppedReason ? `学习已停止: ${latestStageResults.teaching.stoppedReason}` : '学习已停止'
        }
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
    await ctx.updateSessionStatus(sessionId, 'abandoned', 'teaching');

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
 *    拿不到说明循环在跑，返回 deferred，由循环退出时就地终态化（见 executeAutoLearning）。
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
