import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import {
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
  MERGE_RECORD_EVIDENCE_TYPE,
  conceptFormKey,
} from '../learner/ConceptConsolidatorService';

/**
 * 记忆与复习观测仓储（routes/admin/memory-review.ts 的取数层）。
 * 跨用户总览聚合（痕迹/到期/归并审计/归并凭据）与单用户明细取数；只读。
 * outlet(D)：碎片率指标（重复 label 比率 / 未挂靠散键数 / 待审队列深度）的计算也在这里——
 * 供 adminui 渲染「概念碎片」读数（R7 契约）。
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

/** 未挂靠散键（outlet D）：conceptId 为空 = 尚未挂到 canonical 概念身份的痕迹行（跨用户计数） */
export function groupUnattachedCountsByUser(baseWhere: Prisma.memory_tracesWhereInput) {
  return prisma.memory_traces.groupBy({
    by: ['userId'],
    where: { ...baseWhere, conceptId: null },
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

/** 用户列表「薄弱项 / 平均记忆强度 / 最近复习」三列的逐痕迹读数（只对入围 top-N 用户取，
    全库有痕迹用户的痕迹总量为千级，一次 in 查询成本可忽略）。强度 = FSRS 可提取率，
    需逐痕迹的 FSRS 状态在内存计算，groupBy 聚合给不了。
    outlet(D)：同批数据附带概念键字段（conceptKey/label/conceptId）——碎片率
    （重复 label 比率/未挂靠散键）直接由这批行算出，不加第二次全量扫描。 */
export function findTracesForStrengthAgg(userIds: string[]) {
  if (userIds.length === 0) return Promise.resolve([] as Array<{
    userId: string;
    conceptKey: string;
    label: string | null;
    conceptId: string | null;
    masteryScore: number;
    extractionCount: number;
    lastSeenAt: Date | null;
    fsrsStability: number | null;
    fsrsDifficulty: number | null;
    fsrsLapses: number | null;
    fsrsReps: number | null;
  }>);
  return prisma.memory_traces.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      conceptKey: true,
      label: true,
      conceptId: true,
      masteryScore: true,
      extractionCount: true,
      lastSeenAt: true,
      fsrsStability: true,
      fsrsDifficulty: true,
      fsrsLapses: true,
      fsrsReps: true,
    },
  });
}

/** 单用户明细头：基础账号信息 */
export function findUserMemoryProfile(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isVirtualLearner: true },
  });
}

/** 单用户记忆痕迹全量（最近 1000 条，含 FSRS 状态列与 conceptId——outlet(D) 未挂靠散键口径） */
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
      conceptId: true,
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

// ─────────────── outlet(D)：碎片率指标（供 adminui 渲染，R7 契约）───────────────

export interface TraceKeyFact {
  conceptKey: string;
  label: string | null;
  conceptId: string | null;
}

export interface FragmentationMetrics {
  /** 参与计算的痕迹行数 */
  traceCount: number;
  /** 属于「同形多行族」（重复 label/键）的痕迹行数 */
  duplicatedTraces: number;
  /** 重复 label 比率 = duplicatedTraces / traceCount（0-1，两位小数；无痕迹时为 0） */
  duplicateLabelRatio: number;
  /** 同形多行族的个数 */
  duplicateFamilyCount: number;
  /** 未挂靠散键数：conceptId 为空的痕迹行数（尚未挂到 canonical 概念身份） */
  unattachedScatterKeys: number;
}

/**
 * 碎片率计算（纯函数，任务书拍板 2026-10-07）：
 * - 「重复」按 conceptFormKey（outlet 的确定性同形口径，与预闸门/自动档同一把尺）分族，
 *   族内 ≥2 行的行数记 duplicatedTraces，比率取对总行数之比；
 * - 「未挂靠」= conceptId 为空（kcid 域读侧 conceptId 优先、空则回落 conceptKey，
 *   故散键是「同一概念多个自由文本键」 still 碎片化的直接证据）。
 */
export function computeFragmentationMetrics(traces: TraceKeyFact[]): FragmentationMetrics {
  const traceCount = traces.length;
  const families = new Map<string, number>();
  for (const trace of traces) {
    const family = conceptFormKey(trace.conceptKey) || conceptFormKey(trace.label || '');
    if (!family) continue;
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  let duplicatedTraces = 0;
  let duplicateFamilyCount = 0;
  for (const size of families.values()) {
    if (size > 1) {
      duplicatedTraces += size;
      duplicateFamilyCount += 1;
    }
  }
  return {
    traceCount,
    duplicatedTraces,
    duplicateLabelRatio: traceCount > 0 ? Math.round((duplicatedTraces / traceCount) * 100) / 100 : 0,
    duplicateFamilyCount,
    unattachedScatterKeys: traces.filter((trace) => !trace.conceptId).length,
  };
}
