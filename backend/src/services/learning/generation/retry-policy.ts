/**
 * 补齐自愈通道的策略与查询（架构审计 §5 行动 #2：learning.service.ts 按领域拆分）
 *
 * 职责：自动重试延迟/基准时间计算、零子任务阶段清点、追加式补齐目标阶段解析
 * （replace 通道不可用/预算耗尽时的选路依据）。纯策略 + 只读查询，无写入。
 */
import prisma from '../../../config/database';
import {
  isGenerationRunStale,
  isStageDesignStale,
  type PersistedPathGenerationRun,
} from '../path-generation-status';
import { ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES } from '../learning.constants';
import type { ParsedPathGenerationStatus } from '../learning.types';

export function getNextEnrichmentRetryDelayMinutes(retryCount: number): number {
  return ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES[
    Math.min(retryCount, ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length - 1)
  ];
}

export function getEnrichmentRetryReferenceTime(
  path: { updatedAt: Date },
  generationStatus: ParsedPathGenerationStatus | null
): number {
  const rawTime = generationStatus?.updatedAt
    || generationStatus?.lastStageDesignRetryAt
    || path.updatedAt?.toISOString?.()
    || path.updatedAt;

  const timestamp = new Date(rawTime).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

/** 列出"零子任务且未完成"的阶段 id（追加式补齐的合法目标）。 */
export async function listEmptyMilestoneIds(pathId: string): Promise<string[]> {
  const milestones = await prisma.milestones.findMany({
    where: {
      learningPathId: pathId,
      status: { not: 'completed' },
      subtasks: { none: {} }
    },
    select: { id: true },
    orderBy: { stageNumber: 'asc' }
  });
  return milestones.map((milestone) => milestone.id);
}

/**
 * 追加式补齐是否被「生成在途」拦下（run 活跃未过期，或 stageDesign processing 未 stale）。
 * 供后台自愈环在 replace 通道不可用/预算耗尽时选路；与空阶段清量组合成最终目标集。
 */
export function isAppendBlockedByInFlightGeneration(
  generationStatus: ParsedPathGenerationStatus | null,
  activeRun: PersistedPathGenerationRun | null,
  pathUpdatedAt: Date
): boolean {
  return (activeRun != null
      && (activeRun.status === 'queued' || activeRun.status === 'processing')
      && !isGenerationRunStale(activeRun))
    || (generationStatus?.stageDesign === 'processing'
      && !isStageDesignStale(generationStatus, pathUpdatedAt));
}
