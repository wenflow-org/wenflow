/**
 * BatchExperimentService —— admin 虚拟学习者页「批量实验」系统级功能
 *
 * 职责：创建多个虚拟学习者 → 各自 Goal → Path → 学完所有任务 → 跨日衰减模拟，
 * 每任务快照 memory_traces / learner_evidence，验证画像系统工作。
 *
 * 数据：batch_experiments + batch_experiment_runs 两张表（schema.prisma）。
 * 驱动：startBatchExperimentScheduler() 定时轮询推进（每 30s 扫 active runs，busy 防重入）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { createSessionForProfile, getStoryPool } from '../../virtual-lab/session-factory';
import { executeSkill } from '../../skills';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../../skills/virtual-learner-scenario-designer';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { memoryTraceService } from '../memory/memory-trace.service';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

export interface BatchLearnerConfig {
  name: string;
  learningGoal?: string;
  frictionBudget?: string;
  /** 样本类型：'student' 生成传统学生样本（课纲/考试节点/学期节奏/家长同伴环境），缺省自由生成 */
  sampleType?: string;
}

const MAX_STALL = 10;

/** 每 run 的内存防重入标志（进程内；重启后由 DB 状态恢复） */
const busyRuns = new Set<string>();

function safeJson<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function getRun(runId: string) {
  const run = await prisma.batch_experiment_runs.findUnique({ where: { id: runId } });
  if (!run) throw new Error('实验 run 不存在');
  return run;
}

/** 创建虚拟学习者（users + profile），返回 profileId */
async function createLearner(cfg: BatchLearnerConfig): Promise<string> {
  const email = `virtual_${randomUUID().substring(0, 8)}@test.local`;
  const password = bcrypt.hashSync(randomUUID(), 10);
  const user = await prisma.users.create({
    data: {
      id: randomUUID(),
      email,
      name: cfg.name,
      password,
      role: 'user',
      currentLevel: 'beginner',
      isAdmin: false,
      isVirtualLearner: true,
      updatedAt: new Date(),
    },
  });
  const profile = await prisma.virtual_learner_profiles.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      profile: '{}',
      learningGoal: cfg.learningGoal ?? '',
      knowledgeLevel: 'beginner',
      simulationMode: 'manual',
      simulationTemperature: 0.8,
      tags: JSON.stringify(['batch-experiment']),
      notes: `批量实验自动创建`,
    },
  });
  return profile.id;
}

/** 生成人设（LLM）并写回 profile；失败不阻断（用基础档案继续） */
async function draftPersona(profileId: string, sampleType?: string): Promise<void> {
  try {
    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels: ['beginner'],
      existingPersonaSeed: {},
      ...(sampleType === 'student'
        ? {
            recentPersonaHints: ['本次明确生成传统学生样本：学段与年级、目标考试或升学节点、学期节奏（课表/晚自习/假期）、成绩自评、家长与老师的外部期望必须全部具体；emotionalTriggers/failurePatterns 写学生真实模式（家长问成绩、排名下滑、考前突击遗忘等）。'],
          }
        : {}),
    });
    const personaSeed = result?.personaSeed;
    if (personaSeed && typeof personaSeed === 'object') {
      const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: profileId } });
      const existing = safeJson<Record<string, unknown>>(profile?.profile, {});
      await prisma.virtual_learner_profiles.update({
        where: { id: profileId },
        data: { profile: JSON.stringify({ ...existing, ...personaSeed }) },
      });
    }
  } catch (e) {
    logger.warn('[batch-experiment] persona generation failed, using basic profile', { profileId, error: String(e) });
  }
}

/** 生成故事（LLM）并写回 storyPool；失败不阻断（会话启动再报错） */
async function draftStory(profileId: string, sampleType?: string): Promise<void> {
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: profileId } });
    if (!profile) return;
    const profileData = safeJson<Record<string, any>>(profile.profile, {});
    const existingStoryPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    if (existingStoryPool.length > 0) return;
    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredMotivations: undefined,
      candidateDomains: undefined,
      candidatePersonas: undefined,
      ...(sampleType === 'student'
        ? {
            recentScenarioHints: ['本次明确生成传统学生样本的故事：sourceType 取 study 或 goalType 取 exam_prep，必须写清考试节点与时间压力、课纲既定的学习内容、老师布置的作业情境、家长与老师的期望、同学比较环境；pressurePoints/behaviorHooks 写学生真实卡点。'],
          }
        : {}),
      existingPersonaSeed: profileData,
      existingStoryPool,
      targetStoryCount: 1,
    });
    const newStory = result?.story;
    if (newStory) {
      const storyWithStatus = { ...newStory, createdAt: new Date().toISOString() };
      await prisma.virtual_learner_profiles.update({
        where: { id: profileId },
        data: {
          profile: JSON.stringify({
            ...profileData,
            storyPool: [...existingStoryPool, storyWithStatus],
          }),
        },
      });
    }
  } catch (e) {
    logger.warn('[batch-experiment] story generation failed', { profileId, error: String(e) });
  }
}

/** 快照：memory_traces + learner_evidence 摘要 → checkpoints/decaySims 追加 */
async function collectSnapshot(runId: string): Promise<Record<string, unknown>> {
  const run = await getRun(runId);
  const profile = run.profileId
    ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } })
    : null;
  const userId = profile?.userId;
  if (!userId) return { traceCount: 0, evidence: [] };
  const traces = await prisma.memory_traces.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { conceptKey: true, label: true, masteryScore: true, stability: true, lastSeenAt: true, extractionCount: true, intervalFactor: true },
  });
  const evidence = await prisma.learner_evidence.groupBy({
    by: ['evidenceKey'],
    where: { userId },
    _count: { _all: true },
  });
  return {
    at: new Date().toISOString(),
    traceCount: traces.length,
    mastered: traces.filter((t) => t.stability === 'stable').length,
    fragile: traces.filter((t) => t.stability === 'fragile').length,
    traces: traces.map((t) => ({
      key: t.conceptKey,
      label: t.label,
      mastery: t.masteryScore,
      stability: t.stability,
      seen: t.lastSeenAt,
      n: t.extractionCount,
      interval: t.intervalFactor,
    })),
    evidence: evidence.map((e) => ({ key: e.evidenceKey, count: e._count._all })),
  };
}

/** 单步推进状态机：setup → goal → path → learn → learn-done → decay → done */
export async function advanceRun(runId: string): Promise<string> {
  if (busyRuns.has(runId)) return 'busy';
  busyRuns.add(runId);
  try {
    const run = await getRun(runId);
    if (!['active'].includes(run.status)) return run.status;

    // ---------- setup ----------
    if (run.phase === 'setup') {
      if (!run.profileId) {
        const cfg: BatchLearnerConfig = { name: run.learnerName, learningGoal: undefined, frictionBudget: run.frictionBudget };
        const profileId = await createLearner(cfg);
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { profileId } });
        logger.info('[batch-experiment] learner created', { runId, profileId });
        return 'setup';
      }
      // 样本类型：实验配置 learnerName 含 [student] 前缀或 frictionBudget 配置时仍自由；sampleType 从 name 标签推断（如 "[student] 高三-李"）
      const sampleType = run.learnerName?.startsWith('[student]') ? 'student' : undefined;
      await draftPersona(run.profileId, sampleType);
      await draftStory(run.profileId, sampleType);
      const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } });
      const storyList = getStoryPool(profile);
      const story = storyList[0];
      if (!story) {
        await new Promise((r) => setTimeout(r, 5000));
        return 'setup';
      }
      const session = await createSessionForProfile(run.profileId, {
        storyId: story.id || story.storyId,
        frictionBudget: run.frictionBudget as any,
      });
      if (!session?.id) return 'setup';
      await prisma.batch_experiment_runs.update({
        where: { id: runId },
        data: { sessionId: session.id, phase: 'goal', stallCount: 0 },
      });
      logger.info('[batch-experiment] session started', { runId, sessionId: session.id });
      return 'goal';
    }

    // ---------- goal ----------
    if (run.phase === 'goal') {
      const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
      let gcId = session?.goalConversationId ?? null;
      if (!gcId && run.profileId) {
        const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } });
        if (profile) {
          const gc = await prisma.goal_conversations.findFirst({
            where: { userId: profile.userId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          gcId = gc?.id ?? null;
        }
      }
      if (gcId) {
        const gc = await prisma.goal_conversations.findUnique({ where: { id: gcId }, select: { stage: true } });
        if (gc && ['proposing', 'ready', 'completed'].includes(gc.stage)) {
          await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'path' } });
          return 'path';
        }
      }
      try {
        // 纳入会话租约队列：与驾驶舱/其他驱动者互斥，消除 stageResults 并发交错（拍板 2026-08-21 精简方案）
        await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
          await simulationCoordinator.executeSingleStep({ sessionId: run.sessionId!, userId: session!.userId, mode: 'single-step' });
        });
        return 'goal';
      } catch (e) {
        await bumpStall(runId, String(e));
        return 'goal';
      }
    }

    // ---------- path ----------
    if (run.phase === 'path') {
      const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
      const profile = run.profileId ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } }) : null;
      // 优先按 userId 查最新 active 路径（goal 自动触发的 path 生成不会写回 virtual_sessions.learningPathId）
      let pathId: string | null = null;
      if (profile) {
        const lp = await prisma.learning_paths.findFirst({
          where: { userId: profile.userId, status: 'active' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        pathId = lp?.id ?? null;
      }
      if (!pathId) pathId = session?.learningPathId ?? null;
      if (pathId) {
        const taskCount = await prisma.subtasks.count({
          where: { milestones: { learningPathId: pathId } },
        });
        if (taskCount > 0) {
          // 绑定到会话（start-learning 依赖该列）
          await prisma.virtual_sessions.update({
            where: { id: run.sessionId! },
            data: { learningPathId: pathId, updatedAt: new Date() },
          });
          await prisma.batch_experiment_runs.update({
            where: { id: runId },
            data: { phase: 'learn', totalTasks: taskCount, stallCount: 0 },
          });
          logger.info('[batch-experiment] path ready', { runId, pathId, tasks: taskCount });
          return 'learn';
        }
      }
      if (!run.advanceCalled) {
        try {
          await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
            await simulationCoordinator.advanceToPathGeneration(run.sessionId!);
          });
          await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { advanceCalled: true } });
        } catch (e) {
          await bumpStall(runId, String(e));
        }
      }
      return 'path';
    }

    // ---------- learn ----------
    if (run.phase === 'learn') {
      const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
      if (!run.learningStarted) {
        try {
          const sl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
            simulationCoordinator.startLearningPhase(run.sessionId!, {})
          );
          if (sl?.success && sl.teachingSessionId) {
            await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true } });
            return 'learn';
          }
          // 会话失败 → restart-learning 恢复（保留任务）
          const rl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
            simulationCoordinator.restartLearningPhase(run.sessionId!, {})
          );
          if (rl?.success && rl.teachingSessionId) {
            await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true } });
            return 'learn';
          }
          await bumpStall(runId, rl?.error || 'start-learning failed');
          return 'learn';
        } catch (e) {
          const msg = String(e);
          if (/学习会话已停止|学习已停止|重新开始学习/i.test(msg)) {
            try {
              const rl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
                simulationCoordinator.restartLearningPhase(run.sessionId!, {})
              );
              if (rl?.success && rl.teachingSessionId) {
                await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true, stallCount: 0 } });
                return 'learn';
              }
              await bumpStall(runId, rl?.error || 'restart-learning failed');
            } catch (e2) {
              await bumpStall(runId, String(e2));
            }
          } else {
            await bumpStall(runId, msg);
          }
          return 'learn';
        }
      }

      // 教学一步（纳入租约：管理员驾驶舱操作将在此排队而非交错写入）
      const step = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
        simulationCoordinator.executeLearningStep(run.sessionId!)
      );
      if (step?.error) {
        if (/学习已停止|没有绑定教学会话|学习会话已停止/.test(String(step.error))) {
          await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: false } });
        }
        await bumpStall(runId, String(step.error));
        return 'learn';
      }
      if (step?.isPathCompleted) {
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'learn-done', stallCount: 0 } });
        logger.info('[batch-experiment] ALL TASKS COMPLETED', { runId });
        try {
          await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
            await simulationCoordinator.generateWrapupForSession(run.sessionId!);
          });
        } catch { /* wrapup optional */ }
        return 'learn-done';
      }
      if (step?.taskCompleted) {
        const completed = (run.completedTasks ?? 0) + 1;
        const snap = await collectSnapshot(runId);
        const checkpoints = safeJson<Record<string, unknown>[]>(run.checkpoints, []);
        checkpoints.push({
          at: new Date().toISOString(),
          task: step.milestoneProgress?.currentTask ?? null,
          milestone: step.milestoneProgress?.currentMilestone ?? null,
          totalMilestones: step.milestoneProgress?.totalMilestones ?? null,
          ...snap,
        });
        await prisma.batch_experiment_runs.update({
          where: { id: runId },
          data: {
            completedTasks: completed,
            currentTask: String(step.milestoneProgress?.currentTask ?? ''),
            checkpoints: JSON.stringify(checkpoints),
            stallCount: 0,
          },
        });
        logger.info('[batch-experiment] task completed', { runId, completed });
      } else if (step.milestoneProgress?.currentTask && step.milestoneProgress.currentTask !== run.currentTask) {
        await prisma.batch_experiment_runs.update({
          where: { id: runId },
          data: { currentTask: String(step.milestoneProgress.currentTask) },
        });
      }
      await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { stallCount: 0 } });
      return 'learn';
    }

    // ---------- learn-done → decay（自动 3/7/14 天） ----------
    if (run.phase === 'learn-done') {
      await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'decay' } });
      return 'decay';
    }

    // ---------- decay ----------
    if (run.phase === 'decay') {
      const profile = run.profileId ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } }) : null;
      if (!profile) { await finishRun(runId, 'failed'); return 'failed'; }
      const decaySims = safeJson<Record<string, unknown>[]>(run.decaySims, []);
      const doneDays = decaySims.length;
      const offsets: Record<number, string> = { 0: '-3 days', 1: '-4 days', 2: '-7 days' };
      const dayLabels = [3, 7, 14];
      if (doneDays >= 3) {
        await finishRun(runId, 'done');
        return 'done';
      }
      const off = offsets[doneDays];
      await prisma.$executeRawUnsafe(
        `UPDATE memory_traces SET lastSeenAt = strftime('%Y-%m-%dT%H:%M:%fZ', lastSeenAt, ?) WHERE userId = ?`,
        off,
        profile.userId,
      );
      try {
        await learnerSnapshotRefreshService.refresh({ userId: profile.userId, scope: 'global' });
      } catch (e) {
        logger.warn('[batch-experiment] snapshot refresh failed', { runId, error: String(e) });
      }
      const retention = await memoryTraceService.getRetentionSnapshot(profile.userId);
      decaySims.push({
        days: dayLabels[doneDays],
        at: new Date().toISOString(),
        traceCount: retention.length,
        retained: retention.map((r) => ({ key: r.conceptKey, retention: Math.round(r.retention * 100) / 100, mastery: r.masteryScore })),
      });
      await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { decaySims: JSON.stringify(decaySims) } });
      logger.info('[batch-experiment] decay simulated', { runId, days: dayLabels[doneDays] });
      return 'decay';
    }

    return run.phase;
  } finally {
    busyRuns.delete(runId);
  }
}

async function bumpStall(runId: string, error: string) {
  const run = await getRun(runId);
  const stall = (run.stallCount ?? 0) + 1;
  const data: any = { stallCount: stall, lastError: String(error).slice(0, 300), updatedAt: new Date() };
  if (stall >= MAX_STALL) {
    data.status = 'failed';
    logger.warn('[batch-experiment] run stalled', { runId, error: String(error).slice(0, 200) });
  }
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data });
}

async function finishRun(runId: string, status: string) {
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { status, phase: status === 'done' ? 'done' : 'failed', updatedAt: new Date() } });
  // 实验整体状态：全部 run 终态则 done
  const run = await getRun(runId);
  const others = await prisma.batch_experiment_runs.findMany({ where: { experimentId: run.experimentId, status: 'active' }, select: { id: true } });
  if (others.length === 0) {
    await prisma.batch_experiments.update({ where: { id: run.experimentId }, data: { status: 'done', updatedAt: new Date() } });
  }
}

/** 创建实验 */
export async function createExperiment(
  adminId: string,
  input: { name: string; description?: string; learners: BatchLearnerConfig[] },
) {
  const experiment = await prisma.batch_experiments.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      createdBy: adminId,
      learnersConfig: JSON.stringify(input.learners),
    },
  });
  for (const l of input.learners) {
    await prisma.batch_experiment_runs.create({
      data: {
        experimentId: experiment.id,
        learnerName: l.name,
        frictionBudget: l.frictionBudget ?? 'normal',
        phase: 'setup',
      },
    });
  }
  logger.info('[batch-experiment] experiment created', { experimentId: experiment.id, learners: input.learners.length });
  return experiment;
}

/** 手动推进一个 run（供页面调试） */
export async function manualAdvance(runId: string) {
  return advanceRun(runId);
}

/** 手动执行跨日衰减模拟（已 decay 的档位跳过，从下一档继续） */
export async function manualDecay(runId: string): Promise<{ simulated: boolean; phase: string }> {
  const run = await getRun(runId);
  if (!['learn-done', 'decay'].includes(run.phase)) {
    return { simulated: false, phase: run.phase };
  }
  if (run.phase === 'learn-done') {
    await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'decay' } });
  }
  const phase = await advanceRun(runId);
  return { simulated: phase === 'decay', phase };
}

/** 手动快照 */
export async function manualSnapshot(runId: string) {
  const snap = await collectSnapshot(runId);
  const run = await getRun(runId);
  const checkpoints = safeJson<Record<string, unknown>[]>(run.checkpoints, []);
  checkpoints.push({ at: new Date().toISOString(), manual: true, ...snap });
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { checkpoints: JSON.stringify(checkpoints) } });
  return snap;
}

/** 定时推进调度器（启动时注册） */
let schedulerStarted = false;
export function startBatchExperimentScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    try {
      const runs = await prisma.batch_experiment_runs.findMany({
        where: { status: 'active' },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const run of runs) {
        try {
          await advanceRun(run.id);
        } catch (e) {
          logger.warn('[batch-experiment] scheduler advance failed', { runId: run.id, error: String(e) });
        }
      }
    } catch (e) {
      logger.warn('[batch-experiment] scheduler tick failed', { error: String(e) });
    }
  }, 30_000);
  logger.info('[batch-experiment] scheduler started (30s interval)');
}
