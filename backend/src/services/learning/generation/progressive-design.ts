/**
 * 渐进式 stage 设计（活的 path 批次 D，2026-09-25）。
 *
 * 语义：骨架（core run）是唯一前置物；创建时只设计 stage 1，stage N 完成后
 * 才后台设计 stage N+1——设计输入带**学习者 agent 快照信号**（脆弱/挣扎概念、
 * 先修缺口、上一阶段 wrapup 里仍未掌握的点），让「上一阶段学得怎么样」
 * 机制化进入「下一阶段怎么设计」。
 *
 * 灰度：`PROGRESSIVE_STAGE_DESIGN=1|true` 开启；默认关——关闭时全部生成链路
 * 与改造前逐一等价（eager 全量设计）。
 *
 * 复用地基：append-only 子集设计（只设计空白阶段、不删既有任务）+ per-stage
 * kc 合并契约（kc-annotation.mergeKcStageAnnotation，v2 顶层与 v1 同形，读侧零改）。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { runBackgroundTask } from '../../background-task-tracker.service';
import { learnerSnapshotRefreshService } from '../../learner/LearnerSnapshotRefreshService';

/** 渐进式 stage 设计灰度开关（默认关）。 */
export function isProgressiveStageDesignEnabled(): boolean {
  const raw = String(process.env.PROGRESSIVE_STAGE_DESIGN || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/** 学习者信号（stage N+1 设计输入），条数按钳制上限裁剪。 */
export interface PreviousStageOutcome {
  source: 'learner-snapshot';
  previousStageNumber: number;
  /** 脆弱概念（≤5） */
  fragileConcepts: string[];
  /** 挣扎概念（≤5） */
  strugglingConcepts: string[];
  /** 先修缺口（≤5） */
  prerequisiteGaps: string[];
  /** 上一阶段 wrapup 里仍未掌握的知识点（≤5） */
  stillLearning: string[];
}

const SIGNAL_CAP = 5;

function capList(values: unknown, cap = SIGNAL_CAP): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, cap);
}

/**
 * 从快照与 wrapup 提炼信号（纯函数，钳制 ≤5/类）：
 * fragile/struggling/gaps + wrapup 里未掌握知识点（mastered 除外）。
 */
export function extractLearnerSignals(
  knowledgeMemory: Record<string, unknown>,
  wrapup: { summary?: { knowledgeItems?: Array<{ name?: string; status?: string }> } } | null
): Omit<PreviousStageOutcome, 'source' | 'previousStageNumber'> {
  const currentPath = (knowledgeMemory?.currentPath || {}) as { prerequisiteGaps?: unknown[] };
  const globalSignals = (knowledgeMemory?.globalSignals || {}) as { fragileConcepts?: unknown[]; strugglingConcepts?: unknown[] };
  const items = Array.isArray(wrapup?.summary?.knowledgeItems) ? wrapup.summary.knowledgeItems : [];
  const stillLearning = items
    .filter((item) => item?.name && item?.status && String(item.status) !== 'mastered')
    .map((item) => String(item.name));
  return {
    fragileConcepts: capList(globalSignals.fragileConcepts),
    strugglingConcepts: capList(globalSignals.strugglingConcepts),
    prerequisiteGaps: capList(currentPath.prerequisiteGaps?.map((gap: unknown) => (gap as { conceptName?: string; name?: string })?.conceptName || (gap as { name?: string })?.name || gap)),
    stillLearning: capList(stillLearning),
  };
}

/**
 * 从学习者 agent 账本提炼「上一阶段学得怎么样」：
 * 快照（fresh refresh，确保 task:completed 刚写完的证据已入账）的
 * fragile/struggling/gaps + 上一阶段最近一次 wrapup 的 stillLearning 知识点。
 * best-effort：任何失败返回 null（stage-designer 输入退化为骨架级 previousMilestone）。
 */
export async function buildPreviousStageOutcome(
  pathId: string,
  userId: string,
  previousStageNumber: number
): Promise<PreviousStageOutcome | null> {
  try {
    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId,
      pathId,
      scope: 'path',
    });
    const knowledgeMemory = (snapshot?.knowledgeMemory || {}) as Record<string, unknown>;

    // 上一阶段最近一次完成的课堂 wrapup：stillLearning 知识点是「讲过但没掌握」的直接证据
    const previousMilestones = await prisma.milestones.findMany({
      where: { learningPathId: pathId, stageNumber: previousStageNumber },
      select: { id: true },
    });
    const lastSession = previousMilestones.length > 0
      ? await prisma.teaching_sessions.findFirst({
          where: {
            userId,
            learningPathId: pathId,
            milestoneId: { in: previousMilestones.map((milestone) => milestone.id) },
            status: 'completed',
          },
          orderBy: { endTime: 'desc' },
          select: { wrapup: true },
        })
      : null;
    let wrapup: { summary?: { knowledgeItems?: Array<{ name?: string; status?: string }> } } | null = null;
    try {
      wrapup = lastSession?.wrapup ? JSON.parse(lastSession.wrapup) : null;
    } catch {
      // wrapup 解析失败不影响其余信号
    }

    const outcome: PreviousStageOutcome = {
      source: 'learner-snapshot',
      previousStageNumber,
      ...extractLearnerSignals(knowledgeMemory, wrapup),
    };
    logger.info('[progressive-design] 上一阶段学习者信号已提炼', {
      pathId,
      userId,
      previousStageNumber,
      fragile: outcome.fragileConcepts.length,
      struggling: outcome.strugglingConcepts.length,
      gaps: outcome.prerequisiteGaps.length,
      stillLearning: outcome.stillLearning.length,
    });
    return outcome;
  } catch (error) {
    logger.warn('[progressive-design] 学习者信号提炼失败（best-effort，设计输入退化为骨架级）', {
      pathId,
      userId,
      previousStageNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * stage N 完成 → 后台设计 stage N+1（append-only，restrict 到该 stage）。
 * fire-and-forget：失败只记 warn——学习者可等冷启动兜底（到达未设计 stage 时同步触发）
 * 或下次生成走库优先/重试链补齐。
 */
export function triggerNextStageDesign(
  pathId: string,
  userId: string,
  nextMilestoneId: string,
  nextStageNumber: number,
  previousStageNumber: number
): void {
  runBackgroundTask('learning.path.stage-design-next', async () => {
    const previousStageOutcome = await buildPreviousStageOutcome(pathId, userId, previousStageNumber);
    const { createAndClaimGenerationRun } = await import('./run-lifecycle');
    const { enrichLearningPathWithAnderson } = await import('./stage-enrichment');
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { description: true, title: true, name: true, subject: true, userId: true, activeGenerationRunId: true },
    });
    if (!path) return;
    const run = await createAndClaimGenerationRun(
      pathId,
      'stageDesign',
      'stageDesign',
      1,
      'append-tasks',
      path.activeGenerationRunId,
      { milestoneIds: [nextMilestoneId] }
    );
    const { updatePathGenerationStatus } = await import('./run-lifecycle');
    await updatePathGenerationStatus(pathId, {
      stageDesign: 'processing',
      lastError: null,
      updatedAt: new Date().toISOString(),
    }, run.id);
    await enrichLearningPathWithAnderson(
      pathId,
      run.id,
      {
        userId,
        description: path.description || path.title || path.name || '个性化学习路径',
        subject: path.subject || undefined,
        generationRunId: run.id,
        userProfile: {},
      },
      null,
      {
        appendOnly: true,
        progressive: true,
        restrictMilestoneIds: [nextMilestoneId],
        previousStageOutcome,
      }
    );
    logger.info('[progressive-design] 下一阶段设计完成', { pathId, userId, nextStageNumber });
  }, { pathId, userId, nextStageNumber });
}
