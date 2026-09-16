/**
 * Admin · 记忆与复习观测（记忆层可观测）
 *
 * 覆盖本域三条链路的后台可见性：
 * 1. 到期复习点（memory_traces）规模与积压：谁积压、积压多少、预算与成功率如何；
 * 2. 课内温故计划（reviewPlanService）：本节预算/今日接几个/排队几个/判定需重学的点；
 * 3. 概念归并审计（concept-consolidator，观察模式）：同义重复多少、多少可自动执行、
 *    多少需要人工看（ambiguous）、已执行/已删除多少。
 *
 * 只读 + 一个显式的「重新观察」（force observe，不动数据）。
 */
import express from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import { normalizeConceptKey } from '../../services/memory/memory-trace.service';
import { reviewPlanService } from '../../services/memory/review-plan.service';
import {
  conceptConsolidatorService,
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
  MERGE_RECORD_EVIDENCE_TYPE,
  parseMergeRecord,
  type AppliedConceptMerge,
  type ConceptConsolidationAudit,
} from '../../services/learner/ConceptConsolidatorService';
import { fsrsRetrievability, fsrsStateFromLegacy, type FsrsMemoryState } from '../../services/memory/fsrs';

const router = express.Router();
router.use(authMiddleware);

async function ensureAdmin(userId?: string) {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
}

function parseAudit(payload: string | null): ConceptConsolidationAudit | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as ConceptConsolidationAudit;
  } catch {
    return null;
  }
}

function retentionOf(trace: {
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  masteryScore: number;
  extractionCount: number;
  lastSeenAt: Date | null;
}): number {
  if (!trace.lastSeenAt) return 1;
  const state: FsrsMemoryState = trace.fsrsStability !== null && trace.fsrsStability !== undefined
    ? {
        stability: trace.fsrsStability,
        difficulty: trace.fsrsDifficulty ?? 5,
        reps: trace.extractionCount,
        lapses: 0,
        lastReviewAt: trace.lastSeenAt,
      }
    : fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return Math.round(fsrsRetrievability(state, new Date()) * 100) / 100;
}

/**
 * GET /api/admin/memory-review
 * 跨用户总览：记忆层规模 + 到期积压 + 归并审计汇总（按痕迹数倒序）。
 * query: limit?（默认 30，上限 100）、includeVirtual?（默认排除虚拟学习者）
 */
router.get('/', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const rawLimit = req.query.limit ? Number(req.query.limit) : 30;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;
    const includeVirtual = String(req.query.includeVirtual || '') === 'true';
    const now = new Date();

    const virtualIds = includeVirtual
      ? []
      : (await prisma.users.findMany({
          where: { isVirtualLearner: true },
          select: { id: true },
        })).map((row) => row.id);

    const baseWhere = virtualIds.length > 0 ? { userId: { notIn: virtualIds } } : {};
    const [traceCounts, dueCounts, audits, mergeRecords] = await Promise.all([
      prisma.memory_traces.groupBy({ by: ['userId'], where: baseWhere, _count: { _all: true } }),
      prisma.memory_traces.groupBy({
        by: ['userId'],
        where: {
          ...baseWhere,
          dueAt: { lte: now },
          // 从未真正提取过的点不进复习队列（口径与 review-plan 一致）
          extractionCount: { gt: 0 },
        },
        _count: { _all: true },
      }),
      prisma.learner_projections.findMany({
        where: { scope: CONSOLIDATION_AUDIT_PROJECTION_SCOPE },
        select: { userId: true, payload: true, generatedAt: true },
      }),
      // 按次留档的归并凭据（权威、长期有效）：概览必须基于它，否则"审计窗口滚出去的旧归并"在界面上消失
      prisma.learner_evidence.findMany({
        where: { evidenceType: MERGE_RECORD_EVIDENCE_TYPE },
        select: { userId: true, payload: true },
      }),
    ]);

    const dueByUser = new Map(dueCounts.map((row) => [row.userId, row._count._all]));
    const auditByUser = new Map(audits.map((row) => [row.userId, row]));
    // 归并凭据按用户汇总：仍可回滚 / 已回滚（凭据不删，保留审计痕迹）
    const mergesByUser = new Map<string, { rollbackable: number; rolledBack: number }>();
    for (const row of mergeRecords) {
      const record = parseMergeRecord(row.payload);
      if (!record) continue;
      const bucket = mergesByUser.get(row.userId) ?? { rollbackable: 0, rolledBack: 0 };
      if (record.rolledBackAt) bucket.rolledBack += 1;
      else bucket.rollbackable += 1;
      mergesByUser.set(row.userId, bucket);
    }
    const rows = traceCounts
      .map((row) => {
        const audit = parseAudit(auditByUser.get(row.userId)?.payload ?? null);
        const merges = mergesByUser.get(row.userId) ?? { rollbackable: 0, rolledBack: 0 };
        return {
          userId: row.userId,
          traces: row._count._all,
          due: dueByUser.get(row.userId) ?? 0,
          merges,
          audit: audit
            ? {
                mode: audit.mode,
                generatedAt: audit.generatedAt,
                candidates: audit.stats.candidates,
                proposed: audit.stats.proposed,
                autoApplicable: audit.stats.autoApplicable,
                ambiguous: audit.ambiguous.length,
                drops: audit.dropCandidates.length,
                applied: audit.stats.applied,
                deleted: audit.stats.deleted,
              }
            : null,
        };
      })
      .sort((a, b) => b.traces - a.traces)
      .slice(0, limit);

    const userIds = rows.map((row) => row.userId);
    const users = userIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, isVirtualLearner: true },
        })
      : [];
    const userById = new Map(users.map((row) => [row.id, row]));

    const totals = {
      users: traceCounts.length,
      traces: rows.reduce((sum, row) => sum + row.traces, 0),
      due: rows.reduce((sum, row) => sum + row.due, 0),
      usersWithAudit: auditByUser.size,
      proposed: 0,
      autoApplicable: 0,
      ambiguous: 0,
      applied: 0,
      deleted: 0,
      rollbackableMerges: 0,
      rolledBackMerges: 0,
    };
    for (const row of rows) {
      totals.rollbackableMerges += row.merges.rollbackable;
      totals.rolledBackMerges += row.merges.rolledBack;
      if (!row.audit) continue;
      totals.proposed += row.audit.proposed;
      totals.autoApplicable += row.audit.autoApplicable;
      totals.ambiguous += row.audit.ambiguous;
      totals.applied += row.audit.applied;
      totals.deleted += row.audit.deleted;
    }

    res.json({
      success: true,
      data: {
        totals,
        users: rows.map((row) => ({
          ...row,
          name: userById.get(row.userId)?.name ?? null,
          email: userById.get(row.userId)?.email ?? null,
          isVirtualLearner: !!userById.get(row.userId)?.isVirtualLearner,
        })),
      },
    });
  } catch (error: any) {
    logger.error('[admin/memory-review] 总览查询失败:', error);
    return res.status(500).json({ success: false, error: { message: '获取记忆与复习总览失败' } });
  }
});

/**
 * GET /api/admin/memory-review/:userId
 * 单用户明细：温故计划（预算/成功率/今日接几个/排队/需重学）+ 到期清单预览
 * + 同族重复分组（「知识点过多过杂」的直接证据）+ 归并审计全文。
 */
router.get('/:userId', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, isVirtualLearner: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }

    const [plan, traces, audit] = await Promise.all([
      reviewPlanService.buildReviewPlan(userId).catch(() => null),
      prisma.memory_traces.findMany({
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
        },
      }),
      conceptConsolidatorService.getAudit(userId).catch(() => null),
    ]);
    // 归并凭据视图（按次留档，权威）：界面据此判断"还能不能回滚"，
    // 而不是看审计 blob 的滚动窗口——窗口外的旧归并同样可以回滚。
    const mergeCredentials = await conceptConsolidatorService
      .listAppliedMerges(userId, { includeRolledBack: true })
      .catch(() => [] as AppliedConceptMerge[]);
    const toMergeView = (merge: AppliedConceptMerge) => ({
      mergeId: merge.mergeId ?? null,
      canonical: merge.canonical,
      aliases: merge.aliases,
      appliedAt: merge.appliedAt,
      rolledBackAt: merge.rolledBackAt ?? null,
      deletedRows: merge.deletedRows.length,
    });
    const credentialIds = new Set(mergeCredentials.map((merge) => merge.mergeId));
    const appliedMerges = {
      rollbackable: mergeCredentials.filter((merge) => !merge.rolledBackAt).map(toMergeView),
      rolledBack: mergeCredentials.filter((merge) => merge.rolledBackAt).map(toMergeView),
      /** 本改动之前执行的旧归并：凭据只在审计窗口内（仍可回滚，但没有长期留档） */
      legacyWindowOnly: (audit?.appliedMerges ?? [])
        .filter((merge) => !merge.mergeId || !credentialIds.has(merge.mergeId))
        .map(toMergeView),
    };

    const now = new Date();
    const dueTraces = traces
      .filter((trace) => trace.dueAt && trace.dueAt <= now && trace.extractionCount > 0)
      .map((trace) => ({
        conceptKey: trace.conceptKey,
        label: trace.label || trace.conceptKey,
        retention: retentionOf(trace),
        masteryScore: trace.masteryScore,
        extractionCount: trace.extractionCount,
        dueAt: trace.dueAt,
        lastSeenAt: trace.lastSeenAt,
        source: trace.source,
      }))
      .sort((a, b) => a.retention - b.retention);

    // 同族分组：按归一化键归族，只看 size > 1（重复/近义就是「过多过杂」的直接证据）
    const families = new Map<string, Array<typeof traces[number]>>();
    for (const trace of traces) {
      const family = normalizeConceptKey(trace.conceptKey);
      if (!family) continue;
      const bucket = families.get(family) ?? [];
      bucket.push(trace);
      families.set(family, bucket);
    }
    const duplicatedFamilies = Array.from(families.entries())
      .filter(([, bucket]) => bucket.length > 1)
      .map(([family, bucket]) => ({
        family,
        size: bucket.length,
        members: bucket.map((trace) => ({
          conceptKey: trace.conceptKey,
          extractionCount: trace.extractionCount,
          masteryScore: trace.masteryScore,
          lastSeenAt: trace.lastSeenAt,
        })),
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 30);

    res.json({
      success: true,
      data: {
        user,
        summary: {
          traces: traces.length,
          due: dueTraces.length,
          duplicatedFamilies: duplicatedFamilies.length,
          duplicatedTraces: duplicatedFamilies.reduce((sum, family) => sum + family.size, 0),
          neverExtracted: traces.filter((trace) => trace.extractionCount === 0).length,
          withFsrsState: traces.filter((trace) => trace.fsrsStability !== null).length,
        },
        reviewPlan: plan,
        duePreview: dueTraces.slice(0, 20),
        duplicatedFamilies,
        audit,
        appliedMerges,
      },
    });
  } catch (error: any) {
    logger.error('[admin/memory-review] 明细查询失败:', error);
    return res.status(500).json({ success: false, error: { message: '获取记忆与复习明细失败' } });
  }
});

/**
 * POST /api/admin/memory-review/:userId/apply
 * 执行选中的归并建议（前端勾选，默认只含 autoApplicable）。
 * body: { canonicals: string[]; includeNeedsReview?: boolean }
 * 每条都会留「胜出者合并前整行 + 被删行整行」快照，可经 rollback 还原。
 */
router.post('/:userId/apply', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const canonicals = Array.isArray(req.body?.canonicals)
      ? req.body.canonicals.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (canonicals.length === 0) {
      return res.status(400).json({ success: false, error: { message: '缺少要执行的归并项（canonicals）' } });
    }
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const result = await conceptConsolidatorService.applyProposals(userId, canonicals, {
      includeNeedsReview: req.body?.includeNeedsReview === true,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[admin/memory-review] 执行归并失败:', error);
    return res.status(500).json({ success: false, error: { message: '执行归并失败' } });
  }
});

/**
 * POST /api/admin/memory-review/:userId/rollback
 * 回滚指定归并：胜出者还原成合并前整行，被删除行按整行快照重建。
 * body: { canonicals: string[] }
 */
router.post('/:userId/rollback', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const canonicals = Array.isArray(req.body?.canonicals)
      ? req.body.canonicals.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (canonicals.length === 0) {
      return res.status(400).json({ success: false, error: { message: '缺少要回滚的归并项（canonicals）' } });
    }
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const result = await conceptConsolidatorService.rollbackMerge(userId, canonicals);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[admin/memory-review] 回滚归并失败:', error);
    return res.status(500).json({ success: false, error: { message: '回滚归并失败' } });
  }
});

/**
 * POST /api/admin/memory-review/:userId/recompute
 * 强制跑一次「概念归并观察」（observe：只记录建议，不动 memory_traces）。
 * 用于人工核对归并准确率；执行请走 apply（逐条勾选）。
 */
router.post('/:userId/recompute', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const audit = await conceptConsolidatorService.consolidate(userId, {
      mode: 'observe',
      force: true,
    });
    res.json({ success: true, data: { audit } });
  } catch (error: any) {
    logger.error('[admin/memory-review] 重新观察失败:', error);
    return res.status(500).json({ success: false, error: { message: '重新观察失败' } });
  }
});

export default router;
