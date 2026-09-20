import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import {
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
  MERGE_RECORD_EVIDENCE_TYPE,
} from '../learner/ConceptConsolidatorService';

/**
 * 记忆与复习观测仓储（routes/admin/memory-review.ts 的取数层）。
 * 跨用户总览聚合（痕迹/到期/归并审计/归并凭据）与单用户明细取数；只读。
 */

/** 全部虚拟学习者 id（总览排除口径） */
export function listVirtualLearnerIds() {
  return prisma.users.findMany({
    where: { isVirtualLearner: true },
    select: { id: true },
  });
}

export function groupTraceCountsByUser(baseWhere: Prisma.memory_tracesWhereInput) {
  return prisma.memory_traces.groupBy({ by: ['userId'], where: baseWhere, _count: { _all: true } });
}

export function groupDueCountsByUser(baseWhere: Prisma.memory_tracesWhereInput, now: Date) {
  return prisma.memory_traces.groupBy({
    by: ['userId'],
    where: {
      ...baseWhere,
      dueAt: { lte: now },
      // 从未真正提取过的点不进复习队列（口径与 review-plan 一致）
      extractionCount: { gt: 0 },
    },
    _count: { _all: true },
  });
}

/** 概念归并审计投影（滚动窗口，界面参考） */
export function findConsolidationAuditProjections() {
  return prisma.learner_projections.findMany({
    where: { scope: CONSOLIDATION_AUDIT_PROJECTION_SCOPE },
    select: { userId: true, payload: true, generatedAt: true },
  });
}

/** 按次留档的归并凭据（权威、长期有效） */
export function findMergeRecordEvidence() {
  return prisma.learner_evidence.findMany({
    where: { evidenceType: MERGE_RECORD_EVIDENCE_TYPE },
    select: { userId: true, payload: true },
  });
}

export function findUsersByIdsWithFlags(userIds: string[]) {
  return prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, isVirtualLearner: true },
  });
}

/** 单用户明细头：基础账号信息 */
export function findUserMemoryProfile(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isVirtualLearner: true },
  });
}

/** 单用户记忆痕迹全量（最近 1000 条，含 FSRS 状态列） */
export function listUserMemoryTraces(userId: string) {
  return prisma.memory_traces.findMany({
    where: { userId },
    orderBy: [{ lastSeenAt: 'desc' }],
    take: 1000,
    select: {
      conceptKey: true,
      label: true,
      source: true,
      masteryScore: true,
      extractionCount: true,
      lastSeenAt: true,
      dueAt: true,
      fsrsStability: true,
      fsrsDifficulty: true,
      fsrsLapses: true,
      fsrsReps: true,
    },
  });
}

/** 归并执行/回滚/重观察的前置存在性校验 */
export function findUserIdOnly(userId: string) {
  return prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
}
