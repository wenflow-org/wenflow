/**
 * 学习路径级联清理（#176-3）。
 *
 * 背景：`learner_evidence` / `learner_projections` / `concept_edges` 的 `pathId` 是**无外键**
 * 的普通列，删路径只清会话软指针、不碰这几张表，于是出现「路径已删、证据/投影仍占库」的
 * 孤儿数据；而读侧（`LearnerKnowledgeMemoryService` 的 `pathId: { in: pathIds }`）只按
 * **现存**路径取数，这些行永久读不到，纯属存储泄漏。
 *
 * 处置口径（2026-11-07 拍板）：
 * - **path 级**证据/投影/边随路径删除；
 * - **用户级**数据一律保留：`learner_projections` 里 `scope != 'path'`（如 global）的行不删；
 *   `memory_traces.pathId` 只**置空**不删行（记忆痕迹是用户级事实，只标注来源路径）；
 * - 必须在调用方**同一事务**内、**删除 learning_paths 行之前**执行。
 */
import type { Prisma } from '@prisma/client';

/** path 级清理的结果计数（供调用方记日志 / 管理端回显）。 */
export interface PathLearningDataCleanupResult {
  /** 删除的 learner_evidence 行数（pathId = 该路径）。 */
  evidenceDeleted: number;
  /** 删除的 learner_projections 行数（pathId = 该路径且 scope = 'path'）。 */
  projectionsDeleted: number;
  /** 置空 pathId 的 memory_traces 行数（保留行本身，用户级记忆不随路径消失）。 */
  tracesDetached: number;
  /** 删除的 concept_edges 行数（scope = 'path' 且 pathId = 该路径）。 */
  pathEdgesDeleted: number;
}

/**
 * 在**已有事务**内清理一条学习路径的学习事实。
 *
 * 调用方负责事务边界（两个删路径入口都在 `withTransaction` 里调它，且必须在删除
 * `learning_paths` 行之前调用——删行后 pathId 已无从匹配）。
 */
export async function cleanupPathLearningData(
  tx: Prisma.TransactionClient,
  pathId: string
): Promise<PathLearningDataCleanupResult> {
  // memory_traces：只置空来源路径，保留痕迹（用户级记忆，温故/迁移仍要读）
  const traces = await tx.memory_traces.updateMany({
    where: { pathId },
    data: { pathId: null }
  });

  // concept_edges：path 级边随路径删除；user 级边（scope='user'）保留（其 pathId 本就为空）
  const pathEdges = await tx.concept_edges.deleteMany({
    where: { pathId, scope: 'path' }
  });

  // learner_projections：只删 path 级投影；用户级（global 等）投影不随单条路径消失
  const projections = await tx.learner_projections.deleteMany({
    where: { pathId, scope: 'path' }
  });

  // learner_evidence：pathId 即该路径的学习事实，随路径删除
  const evidence = await tx.learner_evidence.deleteMany({
    where: { pathId }
  });

  return {
    evidenceDeleted: evidence.count,
    projectionsDeleted: projections.count,
    tracesDetached: traces.count,
    pathEdgesDeleted: pathEdges.count
  };
}
