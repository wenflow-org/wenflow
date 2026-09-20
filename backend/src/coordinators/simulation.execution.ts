/**
 * 虚拟仿真执行引擎（架构审计 §5 行动 #2：simulation.coordinator 按生命周期阶段拆分）
 *
 * 职责：单步执行（executeSingleStep：Goal→Path→Learn 状态机推进）、自动循环（executeAutoLoop）、
 * 全程执行（executeFullSession：goal→path→learn 汇聚）与检查点任务结算
 * （completeCheckpointedSimulationTask）。是 path-phase / learn-phase 的上层驱动。
 *
 * 跨方法调用一律经 ctx（orchestrator 实例）转发，保证测试对实例方法的覆写缝隙不变
 * （full-session-honesty 覆写 executeAutoLoop / waitForPathReady / executeAutoLearning 即依赖此约定）。
 * 行为与拆分前 simulation.coordinator 同名方法逐一等价。
 */
import { logger } from '../utils/logger';
import prisma from '../config/database';
import learningService from '../services/learning/learning.service';
import goalConversationService from '../services/learning/goal-conversation.service';
import { getSimulationAgentConfig } from '../services/agentConfig.service';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import { simulatedNowOr, isSimulatedClockActive } from '../services/virtual-lab/simulation-clock-context';
import type { SimulationMilestone, StageResults, VirtualSessionWithProfile } from '../virtual-lab/vlab-types';
import type {
  AutoLoopOptions,
  RunFullOptions,
  SimulationLogEntry,
  SimulationOrchestratorInput,
  SimulationStepResult,
} from './simulation.types';
import {
  boundTaskCompletionError,
  findTaskInPath,
  countTaskProgress,
  parseProfileData,
  parseStoryContextFromStageResults,
  getSessionFrictionBudget,
  finalizeGoalLearnerState,
  resolveSimLearnerState,
  isGoalConverged,
  mapGoalStageToLearnerPhase,
  inferDisclosedGoalConcerns,
  getSessionPromptOverrides,
  buildProgressAfterTaskCompletion,
  parseStageResultsPayload,
} from './simulation.helpers';
import {
  parseGoalConversationHistory,
  resolveGoalTurnState,
  buildGoalStepResult,
} from './simulation.goal.steps';
import { persistAssistedLearnerMemory } from './simulation.memory';
import { resolveStorySessionDemand } from '../virtual-lab/story-demand';
import type { SimulationOrchestrator } from './simulation.coordinator';

export async function completeCheckpointedSimulationTask(
  ctx: SimulationOrchestrator,
  sessionId: string,
  session: VirtualSessionWithProfile,
  learningState: Record<string, unknown>,
  milestones: SimulationMilestone[],
  taskRuntime: Record<string, unknown>,
  logs: SimulationLogEntry[]
) {
  const taskMatch = findTaskInPath(milestones, typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : undefined);
  if (!taskMatch) return null;

  let taskCompletionResult: Awaited<ReturnType<typeof learningService.completeTask>> | undefined;
  try {
    await ctx.assertCurrentSessionLeaseOwned(sessionId);
    taskCompletionResult = await learningService.completeTask({
      taskId: taskMatch.task.id,
      userId: session.userId,
      actualMinutes: taskMatch.task.estimatedMinutes || 30,
      notes: '虚拟学习者完成当前 task 的教学会话',
      rating: 5,
      // 日期模拟：台账/streak 落在模拟日（无模拟上下文时不传 → 现网行为不变）
      ...(isSimulatedClockActive() ? { asOf: simulatedNowOr() } : {}),
    });
    // 记忆回写：画像概念 + 成果物登记（best-effort，失败不阻断）
    await persistAssistedLearnerMemory(sessionId, session, taskMatch.task);
  } catch (error: unknown) {
    const boundedError = boundTaskCompletionError(error);
    const updatedAt = new Date().toISOString();
    await ctx.updateStageResults(sessionId, 'teaching', {
      ...learningState,
      teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
      taskRuntime: {
        ...taskRuntime,
        status: 'task_completion_pending',
        error: boundedError,
        updatedAt
      }
    }).catch((checkpointError: unknown) => {
      logger.warn('[simulation-coordinator] 更新任务完成待重试错误失败，保留原 pending checkpoint', {
        sessionId,
        error: asErrorLike(checkpointError).message || String(checkpointError)
      });
    });

    const errorLog: SimulationLogEntry = {
      timestamp: updatedAt,
      phase: 'error',
      details: {
        error: boundedError,
        output: {
          currentTask: taskMatch.task.title,
          currentMilestone: taskMatch.milestone.title,
          action: 'task-completion-pending'
        }
      }
    };
    logs.push(errorLog);
    await ctx.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
      logger.warn('[simulation-coordinator] 记录任务完成待重试日志失败', {
        sessionId,
        error: asErrorLike(logError).message || String(logError)
      });
    });

    return {
      success: false,
      milestoneProgress: {
        currentMilestone: taskMatch.milestoneIdx + 1,
        totalMilestones: milestones.length,
        currentTask: taskMatch.task.title
      },
      isPathCompleted: false,
      taskCompleted: false,
      currentTaskStopped: true,
      logs,
      error: boundedError
    };
  }

  const completedAt = new Date().toISOString();
  const nextProgress = buildProgressAfterTaskCompletion(milestones, taskMatch.task.id);
  const latestSession = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
  const latestStageResults = parseStageResultsPayload(latestSession?.stageResults);
  const latestLearningState = (latestStageResults.teaching || learningState) as Record<string, unknown>;
  const baseCompletedLearningState: Record<string, unknown> = {
    ...latestLearningState,
    teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
    ...nextProgress.progress,
    taskRuntime: {
      ...taskRuntime,
      status: 'completed',
      reason: ((taskRuntime.closureDecision && typeof taskRuntime.closureDecision === 'object' ? taskRuntime.closureDecision : {}) as Record<string, unknown>).reason || taskRuntime.reason || '教学系统与 AI 学生共同判定当前 task 已完成',
      completedAt,
      error: null,
      updatedAt: completedAt,
      completionResult: taskCompletionResult?.task ? {
        id: taskCompletionResult.task.id,
        status: taskCompletionResult.task.status,
        completedAt: taskCompletionResult.task.completedAt,
        alreadyCompleted: taskCompletionResult.alreadyCompleted === true
      } : null
    }
  };

  // 先持久化当前任务完成，再尝试启动下一课；下一课上游失败也不会丢失已完成 task。
  const currentProgress = countTaskProgress(milestones, taskMatch.task.id);

  await ctx.assertCurrentSessionLeaseOwned(sessionId);
  await prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: {
      stageResults: JSON.stringify({
        ...latestStageResults,
        teaching: baseCompletedLearningState
      }),
      currentTaskId: nextProgress.progress.currentTaskId,
      completedTasks: currentProgress.completedTasks,
      totalTasks: currentProgress.totalTasks,
      status: nextProgress.isPathCompleted ? 'completed' : undefined,
      currentStage: nextProgress.isPathCompleted ? 'teaching' : undefined,
      updatedAt: new Date()
    }
  });

  let completedLearningState: Record<string, unknown> = baseCompletedLearningState;
  let nextTaskStarted = false;
  if (!nextProgress.isPathCompleted) {
    try {
      const transition = await ctx.transitionToNextLearningTask(
        sessionId,
        session,
        baseCompletedLearningState,
        (baseCompletedLearningState.taskRuntime ?? {}) as Record<string, unknown>,
        nextProgress,
        milestones,
        logs
      );
      completedLearningState = transition.learningState;
      nextTaskStarted = transition.nextTaskStarted;
      await ctx.updateStageResults(sessionId, 'teaching', completedLearningState);
      await ctx.assertCurrentSessionLeaseOwned(sessionId);
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: typeof completedLearningState.currentTaskId === 'string' ? completedLearningState.currentTaskId : null,
          completedTasks: currentProgress.completedTasks,
          totalTasks: currentProgress.totalTasks,
          status: 'running',
          currentStage: 'teaching',
          updatedAt: new Date()
        }
      });
    } catch (error: unknown) {
      const rawMessage = boundTaskCompletionError(error);
      // 预算耗尽且本课已完成：文案明确「本课已学完、调高预算后可续传」，
      // 避免用户误以为学习失败；续传从下一课继续，不丢本课进度。
      const isBudget = /retry_budget_exhausted|budget_exhausted/i.test(rawMessage);
      const errorMessage = isBudget
        ? `本课已完成，但会话 AI 调用预算已耗尽，无法启动下一课。可在画像/故事预算中调高「会话 AI 调用上限」后重试续传（从下一课继续，不丢本课进度）。`
        : rawMessage;
      completedLearningState = {
        ...baseCompletedLearningState,
        taskRuntime: {
          ...((baseCompletedLearningState.taskRuntime ?? {}) as Record<string, unknown>),
          status: 'next_task_start_failed',
          error: errorMessage,
          updatedAt: new Date().toISOString()
        }
      };
      await ctx.updateStageResults(sessionId, 'teaching', completedLearningState);
      await ctx.persistLearningFailure(sessionId, error, logs);
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: errorMessage,
          output: {
            action: 'start-next-learning-task-failed',
            completedTaskId: taskMatch.task.id,
            nextTaskId: nextProgress.progress.currentTaskId
          }
        }
      });
      return {
        success: false,
        milestoneProgress: {
          currentMilestone: nextProgress.progress.currentMilestone + 1,
          totalMilestones: milestones.length,
          currentTask: nextProgress.progress.currentTaskTitle
        },
        isPathCompleted: false,
        taskCompleted: true,
        currentTaskStopped: true,
        logs,
        error: errorMessage
      };
    }
  }

  return {
    success: true,
    milestoneProgress: {
      currentMilestone: nextProgress.isPathCompleted
        ? milestones.length
        : nextProgress.progress.currentMilestone + 1,
      totalMilestones: milestones.length,
      currentTask: nextProgress.progress.currentTaskTitle
    },
    isPathCompleted: nextProgress.isPathCompleted,
    taskCompleted: true,
    currentTaskStopped: !nextTaskStarted,
    logs
  };
}

export async function executeSingleStep(ctx: SimulationOrchestrator, input: SimulationOrchestratorInput): Promise<SimulationStepResult> {
  const startTime = Date.now();
  const logs: SimulationLogEntry[] = [];
  
  try {
    logger.info('[simulation-coordinator] 执行单步模拟', {
      sessionId: input.sessionId,
      userId: input.userId
    });
    
    const session = await ctx.getVirtualSession(input.sessionId);
    const profile = parseProfileData(session.virtual_learner_profiles);
    const initialStageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
    const storyContext = parseStoryContextFromStageResults(initialStageResults);
    // 管理面终态（批量终止/僵尸回收/失败）的会话不可再推进：防止执行器复活会话
    if (session.status === 'failed' || session.status === 'abandoned') {
      throw new Error(`会话已终止（${session.status}），无法继续执行`);
    }
    if (!session.goalConversationId) {
      // 故事当次需求 → Goal 开场（写入 conversation.description）→ 正式 Path 只吃 Goal，不读 story
      // description 固定用 storyDemand.text，保证传递链不被模拟者改写；模拟者只负责后续轮次。
      const storyDemand = resolveStorySessionDemand({
        story: storyContext,
        profileLearningGoal: profile.learningGoal,
      });
      const openingReply = storyDemand.text;
      if (!openingReply) {
        throw new Error('缺少 Goal 开场诉求：请绑定故事（visibleOpening / goalSeed）或填写画像长期倾向');
      }

      const openingStart = Date.now();
      // 开场模拟者调用同样计入会话 AI 调用预算（此前旁路漏计，管理员手动
      // 「推进一步」开新 Goal 对话时每次白嫖 1 次调用）
      const openingResult = await ctx.retryLearnUpstream(input.sessionId, 'simulate-goal-opening', () =>
        ctx.simulateGoalLearnerReply({
          profile,
          storyContext,
          conversationHistory: [],
          lastAssistantMessage: '',
          currentPhase: 'opening',
          previousLearnerState: undefined,
          goalState: undefined,
          userId: input.userId,
          frictionBudget: getSessionFrictionBudget(session)
        })
      );

      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'virtual-reply',
        durationMs: Date.now() - openingStart,
        details: {
          output: {
            reply: openingReply,
            thoughtProcess: openingResult.output?.debug?.stateChangeReason,
            learnerState: finalizeGoalLearnerState(
              profile,
              resolveSimLearnerState(openingResult.output, openingResult.learnerStateFromEnvelope || {}),
              storyContext,
              'understanding'
            ),
            emotion: openingResult.output?.emotion,
            runtimeEnvelope: openingResult.runtimeEnvelope || openingResult.output?.runtimeEnvelope || null,
            opening: true,
            storyDemandSource: storyDemand.source,
            storyId: storyDemand.storyId,
            // 模拟者开场仅作旁路观测，不进入 description
            simulatorOpeningReply: openingResult.output?.reply || null,
          }
        }
      });

      await ctx.assertCurrentSessionLeaseOwned(input.sessionId);
      // 负荷画像：仅在画像确实带信号时才附加选项（无信号时 options 形状与改动前逐字节一致）。
      // 随 Goal 会话落库（collectedData.learnerLoadProfile），让"生成路径"的真实入口
      // （goal-conversation.service.buildGoalPathRequest）也能拿到并收紧体量。
      const learnerAvailableTime = profile.profile.availableTime ?? null;
      const learnerLoadTolerance = profile.profile.cognitiveLoadTolerance ?? null;
      // goal agent 开场回应是真实 LLM 调用，计入会话 AI 调用预算
      const goalResult = await ctx.retryLearnUpstream(input.sessionId, 'goal-opening-turn', () =>
        goalConversationService.startConversation(
          input.userId,
          openingReply,
          {
            systemPromptOverrides: getSessionPromptOverrides(session),
            ...(learnerAvailableTime || learnerLoadTolerance
              ? { learnerLoadProfile: { availableTime: learnerAvailableTime, loadTolerance: learnerLoadTolerance } }
              : {}),
          }
        )
      );
      
      await ctx.updateSessionStatus(
        input.sessionId,
        'running',
        'goal',
        goalResult.internal.core.conversationId
      );
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'goal-response',
        details: {
          output: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            conversationId: goalResult.internal.core.conversationId,
            // 分诊命中率遥测：goal 结果透出的 responseTriage.mode（缺失为 null，默认行为不变）
            responseTriageMode: goalResult.internal.ext?.goalConversation?.responseTriage?.mode ?? null,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
              typeof q === 'string' ? q : q.text
            ) || []
          }
        }
      });

      for (const log of logs) {
        await ctx.addSessionLog(input.sessionId, log);
      }

      return {
        success: true,
        virtualUserReply: openingReply,
        goalConversationResponse: {
          userVisible: goalResult.userVisible,
          stage: goalResult.internal.core.stage,
          confidence: goalResult.internal.core.confidence,
          quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q => 
            typeof q === 'string' ? q : q.text
          )
        },
        currentStage: 'goal',
        goalReady: isGoalConverged(goalResult.internal.core.stage),
        logs
      };
    }
    
    const conversation = await ctx.getGoalConversation(session.goalConversationId, input.userId);
    
    if (!conversation) {
      throw new Error('Goal对话不存在');
    }
    
    const { history: conversationHistory, lastAssistantMessage } = parseGoalConversationHistory(conversation.collectedData);

    const {
      stageResults,
      goalState,
      existingGoalState,
      activeStoryContext,
      concernPool,
      disclosedConcerns
    } = resolveGoalTurnState({
      profile,
      stageResultsRaw: session.stageResults,
      collectedData: conversation.collectedData
    });
    
    const virtualReplyStart = Date.now();
    const virtualReplyResult = await ctx.retryLearnUpstream(input.sessionId, 'simulate-goal-reply', () =>
      ctx.simulateGoalLearnerReply({
        profile,
        storyContext: activeStoryContext,
        conversationHistory,
        lastAssistantMessage,
        currentPhase: mapGoalStageToLearnerPhase(goalState?.stage || existingGoalState.stage as string | undefined),
        previousLearnerState: stageResults.goal?.learnerState,
        goalState,
        userId: input.userId,
        frictionBudget: getSessionFrictionBudget(session)
      })
    );
    
    if (!virtualReplyResult.success || !virtualReplyResult.output?.reply) {
      throw new Error('虚拟用户回复生成失败');
    }

    const currentGoalLearnerState = finalizeGoalLearnerState(
      profile,
      resolveSimLearnerState(
        virtualReplyResult.output,
        virtualReplyResult.learnerStateFromEnvelope || {}
      ),
      activeStoryContext,
      // 优先取本次对话的实时 stage；stageResults.goal 的 finalStage/stage 仅作兜底，
      // 避免历史落库字段遮蔽实时进度（issue #4 健壮性观察）
      goalState?.stage || (existingGoalState.finalStage as string | undefined) || (existingGoalState.stage as string | undefined)
    );
    
    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'virtual-reply',
      durationMs: Date.now() - virtualReplyStart,
      details: {
        output: {
            reply: virtualReplyResult.output?.reply,
          thoughtProcess: virtualReplyResult.output?.debug?.stateChangeReason,
          learnerState: currentGoalLearnerState,
          emotion: virtualReplyResult.output?.emotion,
          runtimeEnvelope: virtualReplyResult.runtimeEnvelope || virtualReplyResult.output?.runtimeEnvelope || null,
        }
      }
    });

    const nextDisclosedConcerns = inferDisclosedGoalConcerns(
      virtualReplyResult.output.reply,
      concernPool,
      disclosedConcerns
    );

    await ctx.updateStageResults(input.sessionId, 'goal', {
      ...existingGoalState,
      concernPool,
      disclosedConcerns: nextDisclosedConcerns,
      learnerState: currentGoalLearnerState,
      lastRuntimeEnvelope: virtualReplyResult.runtimeEnvelope || virtualReplyResult.output?.runtimeEnvelope || null,
    });
    
    const goalResponseStart = Date.now();
    await ctx.assertCurrentSessionLeaseOwned(input.sessionId);
    const goalResult = await ctx.retryLearnUpstream(input.sessionId, 'goal-conversation-turn', () =>
      goalConversationService.continueConversation(
        session.goalConversationId,
        virtualReplyResult.output.reply,
        input.userId,
        {
          systemPromptOverrides: getSessionPromptOverrides(session),
          // 平台硬规则：proposing 阶段只有显式确认动作才会收束并触发 Path 生成。
          // 黑盒有 confirm_proposal 动作映射；辅助模式由协调器根据虚拟学习者
          // 自评的 readyToAdvance 代发确认，否则 Goal 会永远停在 proposing。
          confirmProposal: currentGoalLearnerState.readyToAdvance === true
        }
      )
    );
    
    // 分诊命中率遥测：goal 结果透出的 responseTriage（缺失为 null，默认行为不变）
    // continueConversation 返回联合形状，部分分支不带该字段，故按可选读取。
    const goalResponseTriage = (goalResult.internal.ext?.goalConversation as
      | { responseTriage?: { mode?: string } | null }
      | undefined)?.responseTriage ?? null;

    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'goal-response',
      durationMs: Date.now() - goalResponseStart,
      details: {
        output: {
          userVisible: goalResult.userVisible,
          stage: goalResult.internal.core.stage,
          confidence: goalResult.internal.core.confidence,
          responseTriageMode: goalResponseTriage?.mode ?? null,
          quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
            typeof q === 'string' ? q : q.text
          ) || []
        }
      }
    });

    const goalReady = isGoalConverged(goalResult.internal.core.stage);
    const finalGoalLearnerState = finalizeGoalLearnerState(
      profile,
      // 与 currentGoalLearnerState 同口径（含 envelope 回退），否则最终落库会丢掉
      // envelope.contextUpdate.nextState（issue #4 一致性观察）
      resolveSimLearnerState(virtualReplyResult.output, virtualReplyResult.learnerStateFromEnvelope || {}),
      activeStoryContext,
      goalResult.internal.core.stage
    );

    if (goalReady) {
      // 同步 learningPathId 到 virtual_session（goalConversationService 已自动触发 path 生成）
      const updatedConversation = await prisma.goal_conversations.findUnique({
        where: { id: session.goalConversationId }
      });
      
      await ctx.updateSessionStatus(
        input.sessionId,
        'running',
        'path',
        undefined,
        updatedConversation?.learningPathId
      );
      
      await ctx.updateStageResults(input.sessionId, 'goal', {
        ...existingGoalState,
        success: true,
        durationMs: Date.now() - startTime,
        conversationId: session.goalConversationId,
        finalStage: goalResult.internal.core.stage,
        learningPathId: updatedConversation?.learningPathId,
        learnerState: finalGoalLearnerState,
        concernPool,
        disclosedConcerns: nextDisclosedConcerns,
        // 分诊命中率遥测：落 stageResults.goal.responseTriage（无迁移）
        responseTriage: goalResponseTriage
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: {
          output: {
            from: 'goal',
            to: 'path',
            learningPathId: updatedConversation?.learningPathId,
            message: '路径已自动开始生成'
          }
        }
      });
      
    }

    await ctx.addSessionLogs(input.sessionId, logs);

    logger.info('[simulation-coordinator] 单步模拟完成', {
      sessionId: input.sessionId,
      durationMs: Date.now() - startTime,
      goalReady
    });
    
    const goalQuickReplies = goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
      typeof q === 'string' ? q : q.text
    );

    return buildGoalStepResult({
      virtualUserReply: virtualReplyResult.output.reply,
      goalResponse: {
        userVisible: goalResult.userVisible,
        stage: goalResult.internal.core.stage,
        confidence: goalResult.internal.core.confidence,
        quickReplies: goalQuickReplies
      },
      goalReady,
      logs
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    
    logger.error('[simulation-coordinator] 单步模拟失败', {
      sessionId: input.sessionId,
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
    
    await ctx.addSessionLog(input.sessionId, logs[logs.length - 1]);
    
    return {
      success: false,
      virtualUserReply: '',
      currentStage: 'goal',
      goalReady: false,
      logs,
      error: asErrorLike(error).message
    };
  }
}

export async function executeAutoLoop(
  ctx: SimulationOrchestrator,
  input: SimulationOrchestratorInput,
  options: AutoLoopOptions = {}
): Promise<SimulationStepResult[]> {
  const config = await getSimulationAgentConfig();
  const maxRounds = options.maxRounds || config.maxRounds;
  const results: SimulationStepResult[] = [];
  
  logger.info('[simulation-coordinator] 开始自动循环模拟', {
    sessionId: input.sessionId,
    maxRounds,
    config
  });
  
  for (let round = 0; round < maxRounds; round++) {
    const stepResult = await ctx.executeSingleStep(input);
    results.push(stepResult);
    
    if (options.onStep) {
      options.onStep(stepResult);
    }
    
    if (config.stepDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, config.stepDelayMs));
    }
    
    if (!stepResult.success) {
      logger.warn('[simulation-coordinator] 自动循环因错误终止', {
        sessionId: input.sessionId,
        round,
        error: stepResult.error
      });
      break;
    }
    
    if (stepResult.goalReady) {
      logger.info('[simulation-coordinator] 自动循环因Goal Ready终止', {
        sessionId: input.sessionId,
        round
      });
      
      const shouldAdvancePath = options.autoAdvanceToPath ?? config.autoAdvanceToPath;
      if (shouldAdvancePath) {
        logger.info('[simulation-coordinator] 自动推进到Path阶段', {
          sessionId: input.sessionId
        });
        await ctx.advanceToPathGeneration(input.sessionId);

        if (options.autoAdvanceToLearning) {
          logger.info('[simulation-coordinator] 自动推进到Learning阶段', {
            sessionId: input.sessionId
          });
          try {
            await ctx.resolvePathReview(input.sessionId, { startLearning: true });
          } catch (err: unknown) {
            logger.warn('[simulation-coordinator] 自动启动 Learn 失败', { error: asErrorLike(err).message });
          }
        }
      }
      break;
    }
  }
  
  logger.info('[simulation-coordinator] 自动循环模拟完成', {
    sessionId: input.sessionId,
    totalRounds: results.length
  });
  
  return results;
}

/**
 * 一键运行整个会话: Goal -> Path -> Learn
 * 适合"全自动"按钮，跑到 Goal 收敛 -> 自动生成 Path -> 自动启动 Learn -> 跑完所有 task
 * 诚实返回：任何阶段未推进到位都返回 error，不静默报 success（2026-08-22 修复）。
 */
export async function executeFullSession(
  ctx: SimulationOrchestrator,
  sessionId: string,
  options: RunFullOptions = {}
): Promise<{
  success: boolean;
  goalRounds: number;
  learningSteps: number;
  pathGenerated: boolean;
  isPathCompleted: boolean;
  finalStage?: string;
  error?: string;
}> {
  const config = await getSimulationAgentConfig();
  const maxRounds = options.maxRounds || config.maxRounds;
  const maxMilestones = options.maxMilestones || 10;
  const continueOnTaskComplete = options.continueOnTaskComplete ?? true;

  logger.info('[simulation-coordinator] 一键全流程开始', {
    sessionId,
    maxRounds,
    maxMilestones,
    continueOnTaskComplete
  });

  const session = await ctx.getVirtualSession(sessionId);
  const summary = {
    success: false,
    goalRounds: 0,
    learningSteps: 0,
    pathGenerated: false,
    isPathCompleted: false,
    finalStage: session.currentStage,
    error: undefined as string | undefined
  };

  try {
    // ========== Phase A: Goal ==========
    if (session.currentStage === 'goal') {
      const goalResults = await ctx.executeAutoLoop(
        { sessionId, userId: session.userId, mode: 'auto-loop' },
        {
          maxRounds,
          autoAdvanceToPath: options.autoAdvanceToPath ?? true,
          autoAdvanceToLearning: false
        }
      );
      summary.goalRounds = goalResults.length;
      const lastGoal = goalResults[goalResults.length - 1];
      // 诚实返回：Goal 未在预算内收敛同样报错（不再静默跳到后续阶段）
      if (!lastGoal?.goalReady) {
        summary.error = lastGoal?.error || `Goal 阶段在 ${maxRounds} 轮内未收敛，请再次运行或调大 maxRounds`;
        return summary;
      }
    }

    // refresh session state
    const updatedAfterGoal = await ctx.getVirtualSession(sessionId);
    summary.finalStage = updatedAfterGoal.currentStage;
    summary.pathGenerated = !!updatedAfterGoal.learningPathId;

    // ========== Phase B: Path -> Learn bridge ==========
    if (updatedAfterGoal.currentStage === 'goal') {
      // Goal 已收敛但未进入 Path 生成（advance 未成功）——显式失败，不等候
      summary.error = 'Goal 已收敛但未进入 Path 生成，请检查路径生成状态或手动推进';
      return summary;
    }
    if (updatedAfterGoal.currentStage !== 'teaching') {
      // 等待 Path 生成完成（多点几分钟是正常的，黑盒实测 2-3 分钟）
      const waitResult = await ctx.waitForPathReady(sessionId, updatedAfterGoal.learningPathId);
      if (!waitResult.ready) {
        summary.error = waitResult.reason || '学习路径未就绪';
        return summary;
      }
      summary.pathGenerated = true;
      try {
        const review = await ctx.resolvePathReview(sessionId, {
          startLearning: options.autoAdvanceToLearning ?? false
        });
        if (!review.success) {
          summary.error = review.error || 'Path 评审失败';
          return summary;
        }
      } catch (err: unknown) {
        logger.warn('[simulation-coordinator] 启动 Learn 失败', { error: asErrorLike(err).message });
        summary.error = asErrorLike(err).message || '启动 Learn 失败';
        return summary;
      }
    }

    // ========== Phase C: Learn loop with continueOnTaskComplete ==========
    const refreshed = await ctx.getVirtualSession(sessionId);
    if (refreshed.currentStage !== 'teaching') {
      summary.finalStage = refreshed.currentStage;
      // 诚实返回：未能进入教学阶段 = 未完成，不允许 success=true 静默提前收工
      summary.error = `未能进入教学阶段（当前阶段：${refreshed.currentStage}），请检查路径生成或手动推进`;
      return summary;
    }

    // 边界预算按 path 实际任务数计算（不再用 maxMilestones*3 的下限截断：
    // 多任务 path（如 21 任务）一次点击必须能跑完，否则静默停在半路）
    let totalTasksBudget = 1;
    try {
      const milestones = refreshed.learningPathId
        ? await prisma.milestones.findMany({
            where: { learningPathId: refreshed.learningPathId },
            select: { subtasks: { select: { id: true } } }
          })
        : [];
      const taskCount = milestones.reduce((sum, m) => sum + m.subtasks.length, 0);
      totalTasksBudget = taskCount > 0 ? taskCount : 1;
    } catch {
      totalTasksBudget = 1;
    }
    const maxTaskBoundaries = continueOnTaskComplete ? totalTasksBudget + 2 : 1;

    let totalLearningSteps = 0;
    let taskBoundaries = 0;
    let lastAfter: VirtualSessionWithProfile | null = null;
    while (taskBoundaries < maxTaskBoundaries) {
      const learnResult = await ctx.executeAutoLearning(sessionId, { maxMilestones });
      totalLearningSteps += learnResult.totalSteps || 0;

      // refresh
      const after = await ctx.getVirtualSession(sessionId);
      lastAfter = after;
      summary.finalStage = after.currentStage;

      if (after.status === 'completed') {
        summary.isPathCompleted = true;
        break;
      }
      if (after.status === 'failed' || after.status === 'abandoned') {
        summary.error = learnResult?.error || `学习被中止（${after.status}）`;
        break;
      }
      if (!continueOnTaskComplete) {
        break;
      }
      if (!learnResult.success) {
        summary.error = learnResult.error || '自动学习失败';
        break;
      }

      // 无进展（0 回合）：区分暂停与真无进展，都显式说明
      if ((learnResult.totalSteps || 0) === 0) {
        const paused = parseStageResultsPayload(after.stageResults).teaching?.paused === true;
        summary.error = paused ? '学习已暂停，请先恢复再继续' : '自动学习无进展（0 回合），停止推进';
        break;
      }

      taskBoundaries += 1;
    }

    summary.learningSteps = totalLearningSteps;
    // 边界预算耗尽仍未完成：诚实报错（原实现 success=true 静默收工）
    if (!summary.isPathCompleted && !summary.error) {
      const doneTasks = lastAfter?.completedTasks ?? 0;
      const totalTasks = lastAfter?.totalTasks ?? totalTasksBudget;
      summary.error = `任务边界预算（${maxTaskBoundaries} 份任务）耗尽仍未完成路径（已完成 ${doneTasks}/${totalTasks}）`;
    }
    summary.success = !summary.error;
    return summary;
  } catch (error: unknown) {
    logger.error('[simulation-coordinator] 一键全流程失败', { sessionId, error });
    summary.error = asErrorLike(error).message || 'unknown';
    return summary;
  }
}

