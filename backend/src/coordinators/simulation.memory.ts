// 模拟协调器 - 学习记忆回写（自 simulation.coordinator.ts 抽离，行为保持不变；无 this，仅 prisma / memoryTraceService / learner-memory / executeSkill）
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { memoryTraceService } from '../services/memory/memory-trace.service';
import {
  buildLearnerMemorySnapshot,
  recordCompletedArtifact,
  writeProfileConceptsAfterLesson,
  type LessonKnowledgePoint,
  type SelfReportedLearnerState,
} from '../virtual-lab/learner-memory';
import { executeSkill, virtualLearnerMemoryCuratorDefinition } from '../skills';
import { safeJsonParse } from '../utils/safe-json';
import { parseStageResultsPayload } from './simulation.helpers';
import { buildMemoryRecallHints, type MemoryRecallHint } from '../virtual-lab/memory-recall';
import type { SimulationMilestone, SimulationTask, VirtualSessionWithProfile } from '../virtual-lab/vlab-types';

/**
 * 记忆引擎 M2：教学回合后按知识看板状态增量写 memory_traces。
 * best-effort——失败不阻断教学回合；修复「卡死任务期间 learner 状态零落库」。
 */
export function persistKnowledgeState(userId: string, knowledgePoints: Array<{ name: string; status: string; progress: number }>): void {
  if (!userId || !Array.isArray(knowledgePoints) || !knowledgePoints.length) return;
  const outcomes = knowledgePoints
    .filter((kp) => kp && String(kp.name || '').trim())
    .map((kp) => ({
      name: String(kp.name).trim(),
      status: (['pending', 'learning', 'mastered', 'review'].includes(kp.status)
        ? kp.status
        : 'learning') as 'pending' | 'learning' | 'mastered' | 'review',
      progress: Number.isFinite(Number(kp.progress)) ? Number(kp.progress) : 0,
    }));
  if (!outcomes.length) return;
  memoryTraceService.recordSessionOutcome(userId, outcomes, 'derived').catch((error) => {
    logger.warn('[simulation-coordinator] 教学回合记忆痕迹回写失败', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * 组装 assisted 模式的学习者记忆（learnerMemory 用）：已掌握/到期复习/易混淆 + 最近成果。
 */
export async function buildAssistedLearnerMemory(
  userId: string
): Promise<{
  mastered: string[];
  dueReview: string[];
  struggling: string[];
  recentCompleted: string[];
} | null> {
  const memory = await buildLearnerMemorySnapshot(userId, { limit: 8 }).catch(() => null);
  if (!memory) return null;
  return {
    mastered: memory.mastered.map((item) => item.name),
    dueReview: memory.dueReview.map((item) => item.name),
    struggling: memory.struggling.map((item) => item.name),
    recentCompleted: memory.recentTaskTitles,
  };
}

/**
 * 组装 assisted 模式的「概率化提取」提示（Q4）：对到期复习点按 (会话, 天, 概念) 做确定性提取判定。
 * 只读、不改状态；失败静默返回空（不影响教学）。
 */
export async function buildAssistedMemoryRecall(
  userId: string,
  sessionId: string,
  stepIndex: number
): Promise<MemoryRecallHint[]> {
  const memory = await buildLearnerMemorySnapshot(userId, { limit: 8 }).catch(() => null);
  if (!memory) return [];
  return buildMemoryRecallHints({
    memory,
    experimentRunSeed: sessionId,
    virtualLearnerId: userId,
    sessionId,
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : 0,
  });
}

/**
 * 组装 assisted 模式的学习者记忆快照（knowledgeSnapshot 用）：
 * 当前任务概念为锚 + 画像已掌握/易混淆 + 到期复习点 + 最近成果。
 */
export async function buildAssistedKnowledgeSnapshot(
  userId: string,
  currentTask: SimulationTask | null,
  currentMilestone: SimulationMilestone | null
): Promise<Array<{ name: string; status: string; progress: number }>> {
  const memory = await buildLearnerMemorySnapshot(userId, { limit: 6 }).catch(() => null);
  const result: Array<{ name: string; status: string; progress: number }> = [];
  const anchor = currentTask?.linkedConcept || currentMilestone?.coreConceptId
    || currentTask?.title || currentMilestone?.title || '当前任务概念';
  result.push({ name: String(anchor), status: 'learning', progress: 40 });
  for (const item of memory?.mastered || []) result.push({ name: item.name, status: 'mastered', progress: 100 });
  for (const item of memory?.dueReview || []) result.push({ name: item.name, status: 'review', progress: item.progress });
  for (const item of memory?.struggling || []) result.push({ name: item.name, status: 'learning', progress: 30 });
  return result.slice(0, 8);
}

/**
 * assisted 模式任务结算后的记忆回写：画像概念（统一出口）+ 成果物登记。
 * best-effort——失败不阻断任务完成。
 */
export async function persistAssistedLearnerMemory(
  sessionId: string,
  session: VirtualSessionWithProfile,
  task: SimulationTask
): Promise<void> {
  try {
    const stageResults = parseStageResultsPayload(session.stageResults);
    const learningState = (stageResults.teaching || {}) as Record<string, unknown>;
    const teachingSessionId = typeof learningState.teachingSessionId === 'string' ? learningState.teachingSessionId : null;
    let knowledgePoints: LessonKnowledgePoint[] = [];
    if (teachingSessionId) {
      const teaching = await prisma.teaching_sessions.findUnique({ where: { id: teachingSessionId } }).catch(() => null);
      knowledgePoints = Array.isArray(teaching?.knowledgeState)
        ? (teaching.knowledgeState as LessonKnowledgePoint[]).filter(
            (kp) => kp && typeof kp.name === 'string' && kp.name.trim()
          )
        : [];
    }
    // 内部提炼：用模拟器自述状态（assisted 的收束轮 learnerState + learnerFeedback）
    const learnerState = (learningState.learnerState && typeof learningState.learnerState === 'object'
      ? learningState.learnerState : {}) as Record<string, unknown>;
    const feedback = (learningState.latestLearnerFeedback && typeof learningState.latestLearnerFeedback === 'object'
      ? learningState.latestLearnerFeedback : {}) as Record<string, unknown>;
    const selfState: SelfReportedLearnerState | null = {
      conceptName: task.linkedConcept || task.title || null,
      conceptualMastery: typeof learnerState.conceptualMastery === 'number' ? learnerState.conceptualMastery : null,
      taskUnderstanding: typeof learnerState.taskUnderstanding === 'number' ? learnerState.taskUnderstanding : null,
      proceduralMastery: typeof learnerState.proceduralMastery === 'number' ? learnerState.proceduralMastery : null,
      selfReportedTaskDone: typeof feedback.selfReportedTaskDone === 'boolean' ? feedback.selfReportedTaskDone : null,
      confidence: typeof feedback.confidence === 'number' ? feedback.confidence : null,
      wantsMoreHelp: typeof feedback.wantsMoreHelp === 'boolean' ? feedback.wantsMoreHelp : null,
      remainingBlockers: Array.isArray(feedback.remainingBlockers) ? feedback.remainingBlockers : null,
      wantsHint: typeof learnerState.wantsHint === 'boolean' ? learnerState.wantsHint : null,
    };
    // 记忆提炼 skill（LLM 主路径，失败走确定性 fallback）
    const curated = await runAssistedMemoryCurator(session, learningState, task);
    const effectiveSelfState: SelfReportedLearnerState | null = curated
      ? {
          ...(selfState || {}),
          conceptName: curated.masteredConcepts[0]?.name || curated.struggleConcepts[0]?.name
            || selfState?.conceptName || task.title || null,
          conceptualMastery: curated.masteredConcepts.length > 0 ? 0.85 : selfState?.conceptualMastery ?? null,
          selfReportedTaskDone: curated.masteredConcepts.length > 0 ? true : selfState?.selfReportedTaskDone ?? null,
          remainingBlockers: curated.struggleConcepts.length > 0
            ? curated.struggleConcepts.map((s) => s.blocker).filter(Boolean)
            : selfState?.remainingBlockers || null,
        }
      : selfState;
    await writeProfileConceptsAfterLesson(session.userId, knowledgePoints, { source: 'assisted', selfState: effectiveSelfState });
    await recordCompletedArtifact({
      userId: session.userId,
      taskId: task.id,
      taskTitle: task.title || '当前任务',
      artifactType: typeof task.taskType === 'string' ? task.taskType : null,
      deliverable: typeof task.acceptanceCriteria === 'string' ? task.acceptanceCriteria : null,
      knowledgePoints,
      selfState: effectiveSelfState,
      memoryDelta: curated?.memoryDelta || null,
      memoryCurated: curated ? {
        mastered: curated.masteredConcepts.map((m) => m.name),
        struggling: curated.struggleConcepts.map((s) => s.name),
        selfCalibration: curated.selfCalibration,
      } : undefined,
      milestoneTitle: null,
    });
  } catch (error) {
    logger.warn('[simulation-coordinator] 虚拟学习者记忆回写失败（不影响任务完成）', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** assisted 的记忆提炼 skill 调用（LLM 主路径；失败返回 null 走 fallback） */
export async function runAssistedMemoryCurator(
  session: VirtualSessionWithProfile,
  learningState: Record<string, unknown>,
  task: SimulationTask
): Promise<{
  masteredConcepts: Array<{ name: string; evidence: string; confidence: number }>;
  struggleConcepts: Array<{ name: string; blocker: string; severity: string }>;
  selfCalibration: string;
  memoryDelta: string;
} | null> {
  try {
    const profile = session.virtual_learner_profiles;
    if (!profile) return null;
    const persona = {
      ...safeJsonParse<Record<string, unknown>>(profile.profile, {}),
      learningGoal: profile.learningGoal,
    };
    // 从 conversationHistory 构建回合序列
    const history = Array.isArray(learningState.conversationHistory) ? learningState.conversationHistory : [];
    const turnSequence = history.slice(-24).map((m: Record<string, unknown>, index: number) => ({
      turn: index + 1,
      reply: typeof m.content === 'string' ? m.content : '',
      emotion: null,
      learnerState: undefined,
      learnerFeedback: undefined,
      role: m.role || 'learner',
    }));
    const existing = await buildLearnerMemorySnapshot(session.userId, { limit: 30 }).catch(() => null);
    const result = await executeSkill(virtualLearnerMemoryCuratorDefinition, {
      persona,
      turnSequence,
      currentTask: {
        title: task.title || null,
        linkedConcept: task.linkedConcept || null,
        acceptanceCriteria: typeof task.acceptanceCriteria === 'string' ? task.acceptanceCriteria : null,
      },
      existingKnown: existing?.mastered.map((m) => m.name) || [],
      existingStruggle: existing?.struggling.map((m) => m.name) || [],
    });
    if (!result.success || !result.output) return null;
    const output = result.output as Record<string, unknown>;
    return {
      masteredConcepts: Array.isArray(output.masteredConcepts) ? output.masteredConcepts : [],
      struggleConcepts: Array.isArray(output.struggleConcepts) ? output.struggleConcepts : [],
      selfCalibration: typeof output.selfCalibration === 'string' ? output.selfCalibration : '',
      memoryDelta: typeof output.memoryDelta === 'string' ? output.memoryDelta : '',
    };
  } catch (error) {
    logger.warn('[simulation-coordinator] 记忆提炼 skill 调用失败，走确定性 fallback', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 任务完成后回写画像字段：掌握的概念 → knownConcepts，仍在学/需复习 → struggleConcepts。
 * best-effort——失败不阻断；修复「画像字段整个学习过程不更新」。
 */
export async function persistProfileConcepts(sessionId: string, userId: string, knowledgePoints: Array<{ name: string; status: string }>): Promise<void> {
  if (!userId || !Array.isArray(knowledgePoints) || !knowledgePoints.length) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId } });
    if (!profile) return;
    const mastered = new Set<string>();
    const struggling = new Set<string>();
    for (const kp of knowledgePoints) {
      const name = String(kp?.name || '').trim();
      if (!name) continue;
      if (kp.status === 'mastered') mastered.add(name);
      else if (kp.status === 'review' || kp.status === 'learning' || kp.status === 'pending') struggling.add(name);
    }
    const profileData = safeJsonParse<Record<string, unknown>>(profile.profile, {});
    const knownConcepts = [...new Set([...((profileData.knownConcepts || []) as unknown[]), ...mastered])];
    const struggleConcepts = [...new Set([...((profileData.struggleConcepts || []) as unknown[]), ...struggling].filter((c) => !mastered.has(c as string)))];
    if (knownConcepts.length || struggleConcepts.length) {
      await prisma.virtual_learner_profiles.update({
        where: { userId },
        data: {
          profile: JSON.stringify({
            ...profileData,
            knownConcepts,
            struggleConcepts,
          }),
          knownConcepts: JSON.stringify(knownConcepts),
          struggleConcepts: JSON.stringify(struggleConcepts),
          updatedAt: new Date(),
        },
      });
      logger.info('[simulation-coordinator] 画像概念字段已回写', {
        sessionId,
        userId,
        known: knownConcepts.length,
        struggle: struggleConcepts.length,
      });
    }
  } catch (error) {
    logger.warn('[simulation-coordinator] 画像字段回写失败', {
      sessionId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
