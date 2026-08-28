/**
 * Quick Learn Service（虚拟账号自动学习运行器）
 *
 * 开发者选定虚拟学习者账号名下的 Task，系统沿真实生产链驱动这个账号学完一节课：
 *   startSession → teaching-turn × N（双重收束）→ endSession（含 wrapup）
 *   → completeTask → 等待异步投影 → 生成 Propagation Report。
 *
 * 设计文档：doc/VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_2026-07-21_091152.md
 *
 * 边界：
 * - 只走生产入口，不直接改业务状态；教师未认可时绝不强制完成任务。
 * - V1 仅 fast_forward 模式（frictionBudget='none' 的合作型学习者），用于学习链路验证，
 *   不代表教育质量评测。
 * - 后台进程内执行，状态持久化到 virtual_quick_learn_runs；进程中断不续跑，
 *   启动时由 recoverInterruptedRuns() 标记 interrupted。
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { executeSkill } from '../../skills';
import {
  virtualLearnerLearnTurnSimulatorDefinition,
  type LearnLearnerPhase,
  type LearnLearnerSimulationOutput,
} from '../../skills/virtual-learner-learn-turn-simulator';
import aiTeachingCoordinator from '../../services/ai-teaching/AITeachingCoordinator';
import learningService from '../../services/learning/learning.service';
import { learnerSnapshotService } from '../../services/learner/LearnerSnapshotService';
import { learnerProjectionService } from '../../services/learner/LearnerProjectionService';
import { runWithContext } from '../../gateway/api-gateway/context';
import {
  buildPropagationReport,
  type QuickLearnLifecycleInput,
  type QuickLearnPropagationReport,
  type QuickLearnTranscriptEntry,
} from './propagation-report';
import {
  buildLearnerMemorySnapshot,
  recordCompletedArtifact,
  writeProfileConceptsAfterLesson,
  type LessonKnowledgePoint,
} from '../learner-memory';

const DEFAULT_MAX_TURNS = 25;
const HARD_MAX_TURNS = 40;
const TEACHER_READY_STREAK_LIMIT = 4;
const SIMULATOR_FAILURE_LIMIT = 3;
const VISIBLE_HISTORY_LIMIT = 12;
const PROJECTION_WAIT_TIMEOUT_MS = 45_000;
const PROJECTION_POLL_INTERVAL_MS = 1_000;
const END_SESSION_RETRY_LIMIT = 10;
const END_SESSION_RETRY_INTERVAL_MS = 2_000;
const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;

export type QuickLearnRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted';

interface VisibleMessage {
  role: 'teacher' | 'learner';
  content: string;
}

type ClosureOutcome =
  | 'completed'
  | 'teacher_ready_learner_not'
  | 'learner_ready_teacher_not'
  | 'turns_exhausted'
  | 'aborted'
  | 'failed';

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractKnowledgePointNames(knowledgePoints: any[] | undefined): string[] {
  if (!Array.isArray(knowledgePoints)) return [];
  return knowledgePoints
    .map((kp: any) => kp?.name || kp?.title || kp?.concept || null)
    .filter((name: any): name is string => typeof name === 'string' && !!name)
    .slice(0, 12);
}

export class QuickLearnService {
  /** 进程内执行锁：防止同一 profile 并发运行（DB 检查之外的第二道保护） */
  private runningProfiles = new Set<string>();

  /**
   * 启动一次账号自动学习：校验归属与状态后创建运行记录，后台异步执行。
   */
  async startRun(input: { profileId: string; taskId: string; maxTurns?: number }): Promise<{ runId: string }> {
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id: input.profileId },
    });
    if (!profile) throw new Error('虚拟学习者不存在');

    const task = await prisma.subtasks.findUnique({
      where: { id: input.taskId },
      include: {
        milestones: {
          include: { learning_paths: true },
        },
      },
    });
    if (!task || !(task as any).milestones?.learning_paths) {
      throw new Error('学习任务不存在');
    }
    const milestone = (task as any).milestones;
    const path = milestone.learning_paths;

    if (path.userId !== profile.userId) {
      const error: any = new Error('该任务不属于此虚拟学习者，请先克隆测试夹具或选择其名下的任务');
      error.code = 'QUICK_LEARN_TASK_OWNERSHIP_MISMATCH';
      throw error;
    }
    if (task.status === 'completed') {
      const error: any = new Error('该任务已完成，不能重复自动学习');
      error.code = 'QUICK_LEARN_TASK_ALREADY_COMPLETED';
      throw error;
    }
    if (milestone.status === 'locked') {
      const error: any = new Error('该任务所在阶段尚未解锁');
      error.code = 'QUICK_LEARN_MILESTONE_LOCKED';
      throw error;
    }

    const maxTurns = Math.min(
      HARD_MAX_TURNS,
      Math.max(1, Number.isInteger(input.maxTurns) ? Number(input.maxTurns) : DEFAULT_MAX_TURNS)
    );

    if (this.runningProfiles.has(profile.id)) {
      const error: any = new Error('该虚拟学习者已有正在进行的自动学习');
      error.code = 'QUICK_LEARN_RUN_CONFLICT';
      throw error;
    }
    const activeRun = await prisma.virtual_quick_learn_runs.findFirst({
      where: { profileId: profile.id, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    if (activeRun) {
      const error: any = new Error('该虚拟学习者已有正在进行的自动学习');
      error.code = 'QUICK_LEARN_RUN_CONFLICT';
      throw error;
    }

    const fixtureOfPathId = path.sourcePathId || null;
    const run = await prisma.virtual_quick_learn_runs.create({
      data: {
        profileId: profile.id,
        userId: profile.userId,
        pathId: path.id,
        taskId: task.id,
        fixtureOfPathId,
        mode: 'fast_forward',
        status: 'queued',
        maxTurns,
      },
    });

    setImmediate(() => {
      void this.executeRun(run.id).catch(async (error) => {
        logger.error('[QuickLearn] 运行出现未捕获异常', {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.finalizeRun(run.id, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      });
    });

    return { runId: run.id };
  }

  async getRun(runId: string) {
    const run = await prisma.virtual_quick_learn_runs.findUnique({ where: { id: runId } });
    if (!run) throw new Error('自动学习运行不存在');
    return this.serializeRun(run);
  }

  async listRuns(profileId: string, options: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize || 20));
    const [total, runs] = await Promise.all([
      prisma.virtual_quick_learn_runs.count({ where: { profileId } }),
      prisma.virtual_quick_learn_runs.findMany({
        where: { profileId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, runs: runs.map((run) => this.serializeRun(run, { lite: true })) };
  }

  async requestAbort(runId: string) {
    const run = await prisma.virtual_quick_learn_runs.findUnique({ where: { id: runId } });
    if (!run) throw new Error('自动学习运行不存在');
    if (!['queued', 'running'].includes(run.status)) {
      return { runId, status: run.status, abortAccepted: false };
    }
    await prisma.virtual_quick_learn_runs.update({
      where: { id: runId },
      data: { abortRequestedAt: new Date() },
    });
    return { runId, status: run.status, abortAccepted: true };
  }

  /** 进程启动时调用：把遗留的 queued/running 标记为 interrupted（V1 不续跑） */
  async recoverInterruptedRuns(): Promise<number> {
    const threshold = new Date(Date.now() - INTERRUPTED_AFTER_MS);
    const result = await prisma.virtual_quick_learn_runs.updateMany({
      where: { status: { in: ['queued', 'running'] }, updatedAt: { lt: threshold } },
      data: { status: 'interrupted', error: '进程重启，运行中断（V1 不支持续跑）', completedAt: new Date() },
    });
    if (result.count > 0) {
      logger.warn('[QuickLearn] 标记中断的自动学习运行', { count: result.count });
    }
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // 后台执行主体
  // ---------------------------------------------------------------------------

  private async executeRun(runId: string): Promise<void> {
    const run = await prisma.virtual_quick_learn_runs.findUnique({ where: { id: runId } });
    if (!run || run.status !== 'queued') return;
    if (this.runningProfiles.has(run.profileId)) {
      await this.finalizeRun(runId, 'failed', { error: '同一虚拟学习者已有进行中的运行' });
      return;
    }
    this.runningProfiles.add(run.profileId);

    try {
      await runWithContext(
        {
          userId: run.userId,
          sourceEntry: 'simulation',
          callerAgent: 'simulation-agent',
          runId: run.id,
        },
        () => this.executeRunInContext(run)
      );
    } finally {
      this.runningProfiles.delete(run.profileId);
    }
  }

  private async executeRunInContext(run: any): Promise<void> {
    const startedAt = new Date();
    await prisma.virtual_quick_learn_runs.update({
      where: { id: run.id },
      data: { status: 'running', startedAt },
    });

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } });
    if (!profile) throw new Error('虚拟学习者不存在');
    const task = await prisma.subtasks.findUnique({
      where: { id: run.taskId },
      include: { milestones: true },
    });
    if (!task || !(task as any).milestones) throw new Error('学习任务不存在');
    const milestone = (task as any).milestones;

    const snapshotScope = { userId: run.userId, learningPathId: run.pathId, taskId: run.taskId, mode: 'teaching' as const };
    const warnings: string[] = [];

    // ① 学习前快照 + 预算下一任务的投影（用于完成后的下游对比）
    const preSnapshot = await learnerSnapshotService.getSnapshot(snapshotScope).catch((error) => {
      warnings.push(`学习前快照获取失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const plannedNextTask = await this.resolveNextTask(run.pathId, run.taskId);
    const preNextProjection = plannedNextTask
      ? await learnerSnapshotService
          .getSnapshot({ userId: run.userId, learningPathId: run.pathId, taskId: plannedNextTask.taskId, mode: 'teaching' })
          .then((snapshot) => learnerProjectionService.toTeachingProjection(snapshot))
          .catch(() => null)
      : null;

    // ② 生产学习门禁（path.userId / milestone locked / path 可学）
    await learningService.assertTaskReadyForLearning(run.taskId, run.userId);

    const transcriptEntries: QuickLearnTranscriptEntry[] = [];
    const visibleHistory: VisibleMessage[] = [];
    const lifecycle: QuickLearnLifecycleInput = {
      sessionStarted: false,
      sessionClosed: false,
      wrapupGenerated: false,
      wrapupSource: null,
      completionReached: false,
      divergence: null,
      taskCompleted: false,
      outboxConsumerDone: false,
      projectionWaitMs: 0,
      warnings,
    };

    let teachingSessionId: string | null = null;
    let revision = 0;
    let outcome: ClosureOutcome = 'failed';
    let runError: string | null = null;
    let turns = 0;

    try {
      // ③ 开始课堂（真实生产链）
      const session = await aiTeachingCoordinator.startSession({ userId: run.userId, taskId: run.taskId });
      teachingSessionId = session.sessionId;
      revision = session.revision;
      lifecycle.sessionStarted = true;
      await prisma.virtual_quick_learn_runs.update({
        where: { id: run.id },
        data: { teachingSessionId },
      });

      const openingMessage = [session.welcomeMessage, session.opening?.message, session.opening?.question]
        .filter((part) => typeof part === 'string' && part.trim())
        .join('\n');
      if (openingMessage) visibleHistory.push({ role: 'teacher', content: openingMessage });

      const learnerPersona = {
        profile: parseJson<Record<string, any>>(profile.profile, {}),
        learningGoal: profile.learningGoal,
        knownConcepts: parseJson<any[]>(profile.knownConcepts, []),
        struggleConcepts: parseJson<any[]>(profile.struggleConcepts, []),
        personalityTraits: parseJson<Record<string, any>>(profile.personalityTraits, {}),
      };

      let currentPhase: LearnLearnerPhase = 'trying';
      let previousLearnerState: Record<string, any> | null = null;
      let teacherReadyStreak = 0;
      let simulatorFailures = 0;

      // ④ 教学回合循环
      for (let turn = 1; turn <= run.maxTurns; turn += 1) {
        if (await this.isAbortRequested(run.id)) {
          outcome = 'aborted';
          break;
        }

        const simulatorOutput = await this.runSimulatorTurn({
          learnerPersona,
          userId: run.userId,
          visibleHistory,
          currentPhase,
          previousLearnerState,
          taskTitle: task.title,
          milestoneTitle: milestone.title,
          taskConcept: (task as any).linkedConcept || null,
        });

        if (!simulatorOutput || !simulatorOutput.reply || simulatorOutput.degraded) {
          simulatorFailures += 1;
          warnings.push(`第 ${turn} 轮学习者模拟器输出不可用（degraded/空）`);
          if (simulatorFailures >= SIMULATOR_FAILURE_LIMIT) {
            outcome = 'failed';
            runError = '学习者模拟器连续失败，终止运行';
            break;
          }
          continue;
        }
        simulatorFailures = 0;

        const learnerReply = simulatorOutput.reply;
        visibleHistory.push({ role: 'learner', content: learnerReply });

        const aiResult = await aiTeachingCoordinator.processStudentMessage(teachingSessionId, learnerReply, {
          expectedRevision: revision,
        });
        revision = aiResult.revision;
        turns = turn;
        visibleHistory.push({ role: 'teacher', content: aiResult.aiResponse || '' });

        const learnerFeedback = simulatorOutput.learnerFeedback;
        const teacherReady = !!(aiResult.isCompletion || aiResult.autoEnded);
        const learnerReady = !!(
          learnerFeedback?.selfReportedTaskDone === true &&
          learnerFeedback?.wantsMoreHelp !== true &&
          learnerFeedback?.stopAsking === true &&
          (!Array.isArray(learnerFeedback?.remainingBlockers) || learnerFeedback.remainingBlockers.length === 0)
        );

        transcriptEntries.push({
          turn,
          learner: learnerReply,
          teacher: aiResult.aiResponse || '',
          isCompletion: !!aiResult.isCompletion,
          autoEnded: !!aiResult.autoEnded,
          strategies: Array.isArray(aiResult.strategies) ? aiResult.strategies.slice(0, 6) : [],
          knowledgePoints: extractKnowledgePointNames(aiResult.knowledgePoints as any[]),
          phaseFocus: simulatorOutput.learnerState?.phaseFocus,
          degraded: !!simulatorOutput.degraded,
        });

        await this.updateProgress(run.id, {
          turn,
          phase: 'teaching',
          lastAction: `turn-${turn}${teacherReady ? '-teacher-ready' : ''}`,
          updatedAt: new Date().toISOString(),
        }, turns);

        currentPhase = simulatorOutput.learnerState?.phaseFocus || currentPhase;
        previousLearnerState = simulatorOutput.learnerState || previousLearnerState;

        if (teacherReady && learnerReady) {
          outcome = 'completed';
          break;
        }
        if (aiResult.autoEnded) {
          // 教学系统已自动结束课堂：按教师单方面收束处理
          outcome = learnerReady ? 'completed' : 'teacher_ready_learner_not';
          break;
        }
        if (teacherReady) {
          teacherReadyStreak += 1;
          if (teacherReadyStreak > TEACHER_READY_STREAK_LIMIT) {
            outcome = 'teacher_ready_learner_not';
            break;
          }
        } else {
          teacherReadyStreak = 0;
        }
      }

      if (turns === run.maxTurns && outcome === 'failed' && !runError) {
        outcome = 'learner_ready_teacher_not';
      }
      if (outcome === 'failed' && !runError && turns >= run.maxTurns) {
        outcome = 'learner_ready_teacher_not';
      }

      // ⑤ 结束课堂（始终尝试闭合，生成 wrapup 与 durable event）
      const endReason =
        outcome === 'completed'
          ? 'quick-learn-completed'
          : outcome === 'aborted'
            ? 'quick-learn-aborted'
            : outcome === 'teacher_ready_learner_not'
              ? 'quick-learn-teacher-only-close'
              : outcome === 'learner_ready_teacher_not'
                ? 'quick-learn-turns-exhausted'
                : 'quick-learn-error';

      const endResult = await this.endSessionWithRetry(teachingSessionId, endReason, revision);
      if (endResult) {
        lifecycle.sessionClosed = true;
        lifecycle.wrapupGenerated = !!endResult.wrapup;
        lifecycle.wrapupSource = (endResult.wrapup?.summarySource as any) || null;
        if (endResult.revision !== undefined) revision = endResult.revision;
      } else {
        warnings.push('课堂未能正常闭合（endSession 持续 processing）');
      }

      // ⑥ 仅在双重收束达成时完成任务——教师未认可绝不强制完成
      if (outcome === 'completed') {
        await learningService.completeTask({ taskId: run.taskId, userId: run.userId });
        // 虚拟学习者记忆回写：画像概念 + 成果物登记（best-effort）
        await this.persistLearnerMemoryAfterQuickLearn(run, teachingSessionId, task);
        lifecycle.completionReached = true;
        lifecycle.taskCompleted = true;
      } else if (outcome === 'teacher_ready_learner_not') {
        lifecycle.divergence = 'teacher_ready_learner_not';
      } else if (outcome === 'learner_ready_teacher_not') {
        lifecycle.divergence = 'learner_ready_teacher_not';
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
      if (outcome !== 'aborted') outcome = 'failed';
      logger.error('[QuickLearn] 运行失败', { runId: run.id, error: runError });
      if (teachingSessionId && lifecycle.sessionStarted && !lifecycle.sessionClosed) {
        await this.endSessionWithRetry(teachingSessionId, 'quick-learn-error', revision)
          .then((endResult) => {
            if (endResult) {
              lifecycle.sessionClosed = true;
              lifecycle.wrapupGenerated = !!endResult.wrapup;
              lifecycle.wrapupSource = (endResult.wrapup?.summarySource as any) || null;
            }
          })
          .catch(() => undefined);
      }
    }

    // ⑦ 等待异步投影（learner evidence / knowledge enrichment）
    const projectionWaitStart = Date.now();
    if (lifecycle.sessionClosed && teachingSessionId) {
      lifecycle.outboxConsumerDone = await this.awaitProjection(teachingSessionId);
      if (!lifecycle.outboxConsumerDone) {
        warnings.push('异步学习者投影等待超时，报告可能未包含全部课后数据');
      }
    }
    lifecycle.projectionWaitMs = Date.now() - projectionWaitStart;

    // ⑧ 学习后快照 + 下游投影对比
    const postSnapshot = await learnerSnapshotService.getSnapshot(snapshotScope).catch(() => null);
    const postNextProjection = plannedNextTask
      ? await learnerSnapshotService
          .getSnapshot({ userId: run.userId, learningPathId: run.pathId, taskId: plannedNextTask.taskId, mode: 'teaching' })
          .then((snapshot) => learnerProjectionService.toTeachingProjection(snapshot))
          .catch(() => null)
      : null;

    const completedAt = new Date();
    const finalStatus: QuickLearnRunStatus =
      outcome === 'completed' ? 'completed' : outcome === 'aborted' ? 'aborted' : 'failed';
    const report: QuickLearnPropagationReport = buildPropagationReport({
      run: {
        runId: run.id,
        mode: run.mode,
        profileId: run.profileId,
        userId: run.userId,
        pathId: run.pathId,
        taskId: run.taskId,
        taskTitle: task.title,
        status: finalStatus,
        turns,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      },
      lifecycle,
      preSnapshot,
      postSnapshot,
      nextTask: plannedNextTask,
      preNextProjection,
      postNextProjection,
      transcript: transcriptEntries,
    });

    await this.finalizeRun(run.id, finalStatus, {
      turns,
      transcript: transcriptEntries,
      report,
      error: runError,
      completedAt,
    });
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  private async runSimulatorTurn(input: {
    learnerPersona: Record<string, any>;
    userId: string;
    visibleHistory: VisibleMessage[];
    currentPhase: LearnLearnerPhase;
    previousLearnerState: Record<string, any> | null;
    taskTitle: string;
    milestoneTitle: string;
    taskConcept?: string | null;
  }): Promise<LearnLearnerSimulationOutput | null> {
    const history = input.visibleHistory.slice(-VISIBLE_HISTORY_LIMIT);
    const lastTeacherMessage = [...history].reverse().find((item) => item.role === 'teacher')?.content;
    try {
      const knowledgeSnapshot = await this.buildQuickLearnKnowledgeSnapshot({
        userId: input.userId,
        taskConcept: input.taskConcept,
        taskTitle: input.taskTitle,
      });
      const learnerMemory = input.userId
        ? await buildLearnerMemorySnapshot(input.userId, { limit: 8 })
            .then((m) => ({
              mastered: m.mastered.map((item) => item.name),
              dueReview: m.dueReview.map((item) => item.name),
              struggling: m.struggling.map((item) => item.name),
              recentCompleted: m.recentTaskTitles,
            }))
            .catch(() => null)
        : null;
      const output = await executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
        learner: input.learnerPersona,
        story: null,
        visibleContext: { history, lastTeacherMessage },
        currentPhase: input.currentPhase,
        previousLearnerState: input.previousLearnerState,
        currentTask: { title: input.taskTitle, milestoneTitle: input.milestoneTitle },
        knowledgeSnapshot,
        learnerMemory,
        frictionBudget: 'none',
      });
      return (output || null) as LearnLearnerSimulationOutput | null;
    } catch (error) {
      logger.warn('[QuickLearn] 学习者模拟器调用失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 组装学习者记忆快照（knowledgeSnapshot 用）：画像已掌握/易混淆 + 到期复习点 + 最近成果。
   * 让虚拟账号带着「学过什么」上这节课（friction=none 的合作型学习者依然“记得”）。
   */
  private async buildQuickLearnKnowledgeSnapshot(
    input: {
      userId: string | null;
      taskConcept?: string | null;
      taskTitle: string;
    }
  ): Promise<Array<{ name: string; status: string; progress: number }>> {
    const userId = input.userId || null;
    const memory = userId ? await buildLearnerMemorySnapshot(userId, { limit: 6 }).catch(() => null) : null;
    const currentName = input.taskConcept || input.taskTitle;
    const result: Array<{ name: string; status: string; progress: number }> = [];
    if (currentName) result.push({ name: String(currentName), status: 'learning', progress: 40 });
    for (const item of memory?.mastered || []) result.push({ name: item.name, status: 'mastered', progress: 100 });
    for (const item of memory?.dueReview || []) result.push({ name: item.name, status: 'review', progress: item.progress });
    for (const item of memory?.struggling || []) result.push({ name: item.name, status: 'learning', progress: 30 });
    return result.slice(0, 8);
  }

  /** quick-learn 任务结算后的记忆回写：画像概念 + 成果物登记（best-effort） */
  private async persistLearnerMemoryAfterQuickLearn(
    run: any,
    teachingSessionId: string | null,
    task: { title: string; acceptanceCriteria?: string | null; taskType?: string | null } | null
  ): Promise<void> {
    try {
      let knowledgePoints: LessonKnowledgePoint[] = [];
      if (teachingSessionId) {
        const teaching = await prisma.teaching_sessions.findUnique({ where: { id: teachingSessionId } }).catch(() => null);
        knowledgePoints = Array.isArray(teaching?.knowledgeState)
          ? (teaching.knowledgeState as LessonKnowledgePoint[]).filter((kp) => kp && typeof kp.name === 'string' && kp.name.trim())
          : [];
      }
      await writeProfileConceptsAfterLesson(run.userId, knowledgePoints, { source: 'quick-learn' });
      await recordCompletedArtifact({
        userId: run.userId,
        taskId: run.taskId,
        taskTitle: task?.title || '当前任务',
        artifactType: task?.taskType || null,
        deliverable: task?.acceptanceCriteria || null,
        knowledgePoints,
      });
    } catch (error) {
      logger.warn('[QuickLearn] 虚拟学习者记忆回写失败（不影响运行）', {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 预算“当前任务完成后的下一个任务”：扁平化 milestones×subtasks，取当前任务之后第一个未完成 */
  private async resolveNextTask(pathId: string, currentTaskId: string): Promise<{ taskId: string; title: string } | null> {    const milestones = await prisma.milestones.findMany({
      where: { learningPathId: pathId },
      orderBy: { order: 'asc' },
      include: { subtasks: { orderBy: { order: 'asc' } } },
    });
    const flat = milestones.flatMap((milestone) => milestone.subtasks);
    const currentIndex = flat.findIndex((task) => task.id === currentTaskId);
    if (currentIndex < 0) return null;
    const next = flat.slice(currentIndex + 1).find((task) => task.status !== 'completed');
    return next ? { taskId: next.id, title: next.title } : null;
  }

  private async endSessionWithRetry(sessionId: string, endReason: string, revision: number) {
    for (let attempt = 0; attempt < END_SESSION_RETRY_LIMIT; attempt += 1) {
      try {
        const result = await aiTeachingCoordinator.endSession(sessionId, endReason, revision);
        if (result.status === 'completed') return result;
        await sleep(END_SESSION_RETRY_INTERVAL_MS);
      } catch (error) {
        logger.warn('[QuickLearn] endSession 重试中', {
          sessionId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(END_SESSION_RETRY_INTERVAL_MS);
      }
    }
    return null;
  }

  /** 等待 lesson:completed 的 durable consumer 处理完成（inbox 出现消费记录） */
  private async awaitProjection(teachingSessionId: string): Promise<boolean> {
    const deadline = Date.now() + PROJECTION_WAIT_TIMEOUT_MS;
    let eventId: string | null = null;
    while (Date.now() < deadline) {
      if (!eventId) {
        const event = await prisma.domain_event_outbox.findFirst({
          where: { aggregateType: 'lesson', aggregateId: teachingSessionId, eventType: 'lesson:completed' },
          orderBy: { occurredAt: 'desc' },
          select: { id: true, status: true },
        });
        eventId = event?.id || null;
      }
      if (eventId) {
        const consumed = await prisma.domain_event_inbox.findFirst({
          where: { eventId },
          select: { id: true },
        });
        if (consumed) return true;
      }
      await sleep(PROJECTION_POLL_INTERVAL_MS);
    }
    return false;
  }

  private async isAbortRequested(runId: string): Promise<boolean> {
    const run = await prisma.virtual_quick_learn_runs.findUnique({
      where: { id: runId },
      select: { abortRequestedAt: true },
    });
    return !!run?.abortRequestedAt;
  }

  private async updateProgress(runId: string, progress: Record<string, any>, turns: number): Promise<void> {
    await prisma.virtual_quick_learn_runs.update({
      where: { id: runId },
      data: { progress: JSON.stringify(progress), turns },
    });
  }

  private async finalizeRun(
    runId: string,
    status: QuickLearnRunStatus,
    data: {
      turns?: number;
      transcript?: QuickLearnTranscriptEntry[];
      report?: QuickLearnPropagationReport;
      error?: string | null;
      completedAt?: Date;
    } = {}
  ): Promise<void> {
    await prisma.virtual_quick_learn_runs.update({
      where: { id: runId },
      data: {
        status,
        ...(data.turns !== undefined ? { turns: data.turns } : {}),
        ...(data.transcript ? { transcript: JSON.stringify(data.transcript) } : {}),
        ...(data.report ? { report: JSON.stringify(data.report) } : {}),
        ...(data.error ? { error: data.error } : {}),
        completedAt: data.completedAt || new Date(),
      },
    });
  }

  private serializeRun(run: any, options: { lite?: boolean } = {}) {
    const base = {
      runId: run.id,
      profileId: run.profileId,
      userId: run.userId,
      pathId: run.pathId,
      taskId: run.taskId,
      fixtureOfPathId: run.fixtureOfPathId,
      mode: run.mode,
      status: run.status,
      maxTurns: run.maxTurns,
      turns: run.turns,
      teachingSessionId: run.teachingSessionId,
      error: run.error,
      abortRequestedAt: run.abortRequestedAt?.toISOString?.() || null,
      startedAt: run.startedAt?.toISOString?.() || null,
      completedAt: run.completedAt?.toISOString?.() || null,
      createdAt: run.createdAt?.toISOString?.() || null,
    };
    if (options.lite) return base;
    return {
      ...base,
      progress: parseJson(run.progress, null),
      report: parseJson(run.report, null),
      transcript: parseJson(run.transcript, []),
    };
  }
}

export const quickLearnService = new QuickLearnService();
export default quickLearnService;
