/**
 * Admin · 记忆与复习观测（记忆层可观测）
 *
 * 覆盖本域三条链路的后台可见性：
 * 1. 到期复习点（memory_traces）规模与积压：谁积压、积压多少、预算与成功率如何；
 * 2. 课内温故计划（reviewPlanService）：本节预算/今日接几个/排队几个/判定需重学的点；
 * 3. 概念归并审计（concept-consolidator，观察模式）：同义重复多少、多少可自动执行、
 *    多少需要人工看（ambiguous）、已执行/已删除多少。
 *
 * 只读 + outlet 出口（R7，「建议 → 人工确认 → 代码执行」后半环接线，2026-10-07 拍板）：
 * - GET  /:userId/candidates —— 候选读取（双档分类 auto/review + 碎片率指标）；
 * - POST /:userId/apply      —— 批量执行确认名单（canonicals/ambiguous/drops → 事务化 apply 引擎）；
 * - POST /:userId/reject     —— 驳回建议（留痕 + 移出待办 + 不再重复建议）；
 * - POST /:userId/rollback   —— 回滚指定归并（凭据还原）；
 * - POST /:userId/recompute  —— 强制重观察（observe，不动数据）。
 */
import express from 'express';
import { checkIsAdmin } from '../../services/admin-access.service';
import {
  listVirtualLearnerIds,
  groupTraceCountsByUser,
  groupDueCountsByUser,
  groupUnattachedCountsByUser,
  findConsolidationAuditProjections,
  findMergeRecordEvidence,
  findUsersByIdsWithFlags,
  findTracesForStrengthAgg,
  findUserMemoryProfile,
  listUserMemoryTraces,
  findUserIdOnly,
  computeFragmentationMetrics,
  type FragmentationMetrics,
} from '../../services/admin/memory-review.repo';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import { normalizeConceptKey } from '../../services/memory/memory-trace.service';
import { reviewPlanService } from '../../services/memory/review-plan.service';
import {
  conceptConsolidatorService,
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
  MERGE_RECORD_EVIDENCE_TYPE,
  classifyProposals,
  parseMergeRecord,
  type AppliedConceptAliasMerge,
  type AppliedConceptMerge,
  type ConceptConsolidationAudit,
} from '../../services/learner/ConceptConsolidatorService';
import { conceptGraphService } from '../../services/learner/concept-graph.service';
import { fsrsRetrievability, fsrsStateFromLegacy, type FsrsMemoryState } from '../../services/memory/fsrs';

const router = express.Router();
router.use(authMiddleware);

async function ensureAdmin(userId?: string) {
  return checkIsAdmin(userId);
}

/**
 * 待审队列深度（outlet D，任务书拍板口径）：人审队列待办条数 =
 * review 档建议数（近形/语义近义，需人判断）+ ambiguous 对数 + 散键清理建议数。
 * auto 档不进队列（预闸门自动执行，无需人工）。
 */
function pendingReviewQueueDepth(audit: ConceptConsolidationAudit | null): number {
  if (!audit) return 0;
  const reviewProposals = classifyProposals(audit.proposals ?? []).filter((item) => item.track === 'review');
  return reviewProposals.length + (audit.ambiguous?.length ?? 0) + (audit.dropCandidates?.length ?? 0);
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
  fsrsLapses: number | null;
  fsrsReps: number | null;
  masteryScore: number;
  extractionCount: number;
  lastSeenAt: Date | null;
}): number {
  if (!trace.lastSeenAt) return 1;
  const state: FsrsMemoryState = trace.fsrsStability !== null && trace.fsrsStability !== undefined
    ? {
        stability: trace.fsrsStability,
        difficulty: trace.fsrsDifficulty ?? 5,
        reps: trace.fsrsReps ?? trace.extractionCount,
        lapses: trace.fsrsLapses ?? 0,
        lastReviewAt: trace.lastSeenAt,
      }
    : fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return Math.round(fsrsRetrievability(state, new Date()) * 100) / 100;
}

/**
 * GET /api/admin/memory-review
 * 跨用户总览：记忆层规模 + 到期积压 + 归并审计汇总（按痕迹数倒序）。
 * query: limit?（默认 30，上限 100）、offset?（默认 0，#41 分页）、includeVirtual?（默认排除虚拟学习者）
 */
router.get('/', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const rawLimit = req.query.limit ? Number(req.query.limit) : 30;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;
    /* 审核 #41（T1 硬约束「列表必须分页」）：此前只接 limit，101 位有痕迹用户里第 51 位起
       永远不可达也不可搜。增 offset（同 clamp，非负）；排序在切片前做（待复习量倒序），
       totals 仍按全量 ranked 聚合，翻页不改总量口径。 */
    const rawOffset = req.query.offset ? Number(req.query.offset) : 0;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
    const includeVirtual = String(req.query.includeVirtual || '') === 'true';
    const now = new Date();

    const virtualIds = includeVirtual
      ? []
      : (await listVirtualLearnerIds()).map((row) => row.id);

    const baseWhere = virtualIds.length > 0 ? { userId: { notIn: virtualIds } } : {};
    const [traceCounts, dueCounts, audits, mergeRecords, unattachedCounts] = await Promise.all([
      groupTraceCountsByUser(baseWhere),
      groupDueCountsByUser(baseWhere, now),
      findConsolidationAuditProjections(),
      // 按次留档的归并凭据（权威、长期有效）：概览必须基于它，否则"审计窗口滚出去的旧归并"在界面上消失
      findMergeRecordEvidence(),
      // outlet(D)：未挂靠散键（conceptId 为空）跨用户计数——全量口径，供 totals 聚合
      groupUnattachedCountsByUser(baseWhere),
    ]);

    const dueByUser = new Map(dueCounts.map((row) => [row.userId, row._count._all]));
    const unattachedByUser = new Map(unattachedCounts.map((row) => [row.userId, row._count._all]));
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
    const ranked = traceCounts
      .map((row) => {
        const audit = parseAudit(auditByUser.get(row.userId)?.payload ?? null);
        const merges = mergesByUser.get(row.userId) ?? { rollbackable: 0, rolledBack: 0 };
        return {
          userId: row.userId,
          traces: row._count._all,
          due: dueByUser.get(row.userId) ?? 0,
          merges,
          // outlet(D)：待审队列深度（人审档建议 + ambiguous 对 + 散键清理建议）
          pendingReviewQueueDepth: pendingReviewQueueDepth(audit),
          unattachedScatterKeys: unattachedByUser.get(row.userId) ?? 0,
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
      // 原型 renderMemory 排序口径：按待复习（到期）量倒序，同量按痕迹数（存量体积）破平
      .sort((a, b) => (b.due - a.due) || (b.traces - a.traces));
    // 列表只返回 offset 起的 limit 条（#41 分页），但 totals 必须按全量聚合：
    // totals.users 是全量有痕迹用户数，若 traces/due 只对切片求和，
    // 用户数超过 limit 时前端的「覆盖 N 位用户」与到期比例条口径不一致（到期占比被低估）。
    const rows = ranked.slice(offset, offset + limit);

    const userIds = rows.map((row) => row.userId);
    const users = userIds.length > 0
      ? await findUsersByIdsWithFlags(userIds)
      : [];
    const userById = new Map(users.map((row) => [row.id, row]));

    /* 原型 renderMemory 三列（薄弱项/平均记忆强度/最近复习）的读数：强度 = FSRS 可提取率
       （retentionOf，与「记忆强度分布」卡同一算法）；从未看过（lastSeenAt 空）的痕迹
       无强度可算，不进分子分母（与分布卡「不硬造」口径一致）。 */
    const traceAggRows = await findTracesForStrengthAgg(userIds);
    const aggByUser = new Map<string, { weak: number; seen: number; sum: number; last: Date | null }>();
    for (const t of traceAggRows) {
      if (!t.lastSeenAt) continue;
      const agg = aggByUser.get(t.userId) ?? { weak: 0, seen: 0, sum: 0, last: null as Date | null };
      const retention = retentionOf(t);
      agg.seen += 1;
      agg.sum += retention;
      if (retention < 0.4) agg.weak += 1;
      if (!agg.last || t.lastSeenAt > agg.last) agg.last = t.lastSeenAt;
      aggByUser.set(t.userId, agg);
    }
    // outlet(D)：碎片率按该用户全部入围行计算（含 lastSeenAt 为空的行——它们同样占碎片口径），
    // 与强度三列共用一次取数，不加第二次扫描
    const fragByUser = new Map<string, FragmentationMetrics>();
    for (const userId of userIds) {
      const rows = traceAggRows.filter((t) => t.userId === userId);
      if (rows.length > 0) fragByUser.set(userId, computeFragmentationMetrics(rows));
    }
    // 跨用户合计的碎片率（2026-10-09 从零走查 F1：前端 KPI 行按 totals.fragmentation 契约绑定，
    // 此前只平铺 pendingReview/unattachedScatterKeys 两个值 → 三格 KPI 恒显「—」）。
    // duplicateLabelRatio 为痕迹加权全局比率（Σ重复痕迹/Σ痕迹），与前端 tooltip 的「痕迹占比」口径一致。
    const globalFrag = computeFragmentationMetrics(traceAggRows);

    const totals = {
      users: ranked.length,
      traces: ranked.reduce((sum, row) => sum + row.traces, 0),
      due: ranked.reduce((sum, row) => sum + row.due, 0),
      usersWithAudit: auditByUser.size,
      proposed: 0,
      autoApplicable: 0,
      ambiguous: 0,
      applied: 0,
      deleted: 0,
      rollbackableMerges: 0,
      rolledBackMerges: 0,
      // outlet(D)：平铺两个可全量聚合的口径（既有消费方保留）；
      // 前端 KPI 行消费的 totals.fragmentation 三字段（F1 修复，与前端契约命名对齐）
      pendingReview: 0,
      unattachedScatterKeys: 0,
      fragmentation: {
        duplicateLabelRatio: globalFrag.duplicateLabelRatio,
        unattachedKeys: globalFrag.unattachedScatterKeys,
        pendingReview: 0,
      },
    };
    for (const row of ranked) {
      totals.rollbackableMerges += row.merges.rollbackable;
      totals.rolledBackMerges += row.merges.rolledBack;
      totals.pendingReview += row.pendingReviewQueueDepth;
      totals.unattachedScatterKeys += row.unattachedScatterKeys;
      totals.fragmentation.pendingReview += row.pendingReviewQueueDepth;
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
        users: rows.map((row) => {
          const agg = aggByUser.get(row.userId);
          return {
            ...row,
            name: userById.get(row.userId)?.name ?? null,
            email: userById.get(row.userId)?.email ?? null,
            isVirtualLearner: !!userById.get(row.userId)?.isVirtualLearner,
            /* 薄弱 = 强度<40% 的痕迹数（原型 threshold）；平均强度 0-1，null = 无 FSRS 强度数据 */
            weak: agg?.weak ?? 0,
            avgStrength: agg && agg.seen > 0 ? Math.round((agg.sum / agg.seen) * 100) / 100 : null,
            lastReviewedAt: agg?.last ?? null,
            // outlet(D)：重复 label 比率等按用户粒度（供 adminui 渲染「概念碎片」读数）
            fragmentation: fragByUser.get(row.userId) ?? null,
          };
        }),
      },
    });
  } catch (error: any) {
    logger.error('[admin/memory-review] 总览查询失败:', error);
    return res.status(500).json({ success: false, error: { message: '获取记忆与复习总览失败' } });
  }
});

/**
 * GET /api/admin/memory-review/:userId/concept-graph
 * 概念图视图（前端画布用）：节点 = 该用户的概念（带掌握度/稳定性），边 = prerequisite / part_of。
 * 只读聚合，数据来自已落地的 concepts / concept_edges / memory_traces（不新增实体）。
 */
router.get('/:userId/concept-graph', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const pathId = typeof req.query.pathId === 'string' && req.query.pathId.trim() ? req.query.pathId.trim() : null;
    const view = await conceptGraphService.buildGraphView(userId, { pathId });
    res.json({ success: true, data: view });
  } catch (error) {
    logger.error('读取概念图失败:', error);
    res.status(500).json({ success: false, error: { message: error instanceof Error ? error.message : '读取概念图失败' } });
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
    const user = await findUserMemoryProfile(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }

    const [plan, traces, audit] = await Promise.all([
      reviewPlanService.buildReviewPlan(userId).catch(() => null),
      listUserMemoryTraces(userId),
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

    // alias 式归并（S3 非破坏策略）：凭据独立留档，回滚语义不同（还原 conceptId + 删别名，不重建行）
    const aliasCredentials = await conceptConsolidatorService
      .listAppliedAliasMerges(userId, { includeRolledBack: true })
      .catch(() => [] as AppliedConceptAliasMerge[]);
    const toAliasView = (merge: AppliedConceptAliasMerge) => ({
      aliasMergeId: merge.aliasMergeId ?? null,
      canonical: merge.canonical,
      aliases: merge.aliases,
      appliedAt: merge.appliedAt,
      rolledBackAt: merge.rolledBackAt ?? null,
      repointedRows: merge.touchedRows.length,
    });
    const aliasCredentialIds = new Set(aliasCredentials.map((item) => item.aliasMergeId));
    const appliedAliasMerges = {
      rollbackable: aliasCredentials.filter((item) => !item.rolledBackAt).map(toAliasView),
      rolledBack: aliasCredentials.filter((item) => item.rolledBackAt).map(toAliasView),
      legacyWindowOnly: (audit?.appliedAliasMerges ?? [])
        .filter((item) => !item.aliasMergeId || !aliasCredentialIds.has(item.aliasMergeId))
        .map(toAliasView),
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
        /* 强度来源标注（B5-F3-3）：true = 显式落库 fsrsStability，retention 为 FSRS 可提取率；
           false = 旧痕迹（无 FSRS 状态），retentionOf 走 fsrsStateFromLegacy 回退估算。
           与 summary.withFsrsState 同口径判断——两处数字来源不同，界面据此各自标注，
           避免「有 FSRS 状态 1」与「20 行都带记忆强度」读起来自相矛盾。 */
        fsrsScheduled: trace.fsrsStability !== null && trace.fsrsStability !== undefined,
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
          /* B5-F3-3：无 FSRS 状态、但看过（lastSeenAt 非空）→ 记忆强度由 fsrsStateFromLegacy
             回退估算的痕迹数。与 withFsrsState 是两种来源，界面各自标注，
             避免「有 FSRS 状态 1」与到期预览 20 行都带记忆强度读起来自相矛盾。 */
          strengthFromLegacy: traces.filter(
            (trace) => (trace.fsrsStability === null || trace.fsrsStability === undefined) && trace.lastSeenAt !== null
          ).length,
        },
        reviewPlan: plan,
        duePreview: dueTraces.slice(0, 20),
        duplicatedFamilies,
        audit,
        appliedMerges,
        appliedAliasMerges,
        // outlet(D)：碎片率（重复 label 比率 / 未挂靠散键数 / 待审队列深度），供 adminui 渲染
        fragmentation: {
          ...computeFragmentationMetrics(traces),
          pendingReviewQueueDepth: pendingReviewQueueDepth(audit),
        },
      },
    });
  } catch (error: any) {
    logger.error('[admin/memory-review] 明细查询失败:', error);
    return res.status(500).json({ success: false, error: { message: '获取记忆与复习明细失败' } });
  }
});

/**
 * GET /api/admin/memory-review/:userId/candidates
 * 候选读取（outlet C「GET 候选，复用现有 proposal 读取」）：数据与 detail().audit 同源
 * （proposals / ambiguous / dropCandidates 三组 + rejected 留痕），proposals 附双档分类
 * track（auto = autoApplicable 且完全同形，预闸门自动执行；review = 人审队列），
 * 并附碎片率指标（供 adminui 渲染）。
 */
router.get('/:userId/candidates', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const user = await findUserIdOnly(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const [candidates, traces] = await Promise.all([
      conceptConsolidatorService.listCandidates(userId).catch(() => null),
      listUserMemoryTraces(userId),
    ]);
    const auditForDepth = candidates
      ? { proposals: candidates.proposals, ambiguous: candidates.ambiguous, dropCandidates: candidates.dropCandidates, rejected: candidates.rejected } as ConceptConsolidationAudit
      : null;
    res.json({
      success: true,
      data: {
        ...(candidates ?? {
          generatedAt: null,
          mode: null,
          proposals: [],
          ambiguous: [],
          dropCandidates: [],
          rejected: [],
          stats: null,
        }),
        fragmentation: {
          ...computeFragmentationMetrics(traces),
          pendingReviewQueueDepth: pendingReviewQueueDepth(auditForDepth),
        },
      },
    });
  } catch (error: any) {
    logger.error('[admin/memory-review] 候选读取失败:', error);
    return res.status(500).json({ success: false, error: { message: '读取候选失败' } });
  }
});

/**
 * POST /api/admin/memory-review/:userId/apply
 * 执行确认名单（outlet C「POST apply（批量，body 带确认列表）」——事务化 apply 引擎）：
 * - canonicals：勾选的归并建议（按 canonical 匹配，逐别名成对执行 applyKeyMerge）；
 * - ambiguous：确认的「需人工看」对（a ← b：b 并入 a）；
 * - drops：确认清理的散键（dropCandidates.conceptKey，走 applyKeyDrop）。
 * 名单由前端勾选、服务端再校验一次（只执行审计里真实存在的建议，其余落 skipped）；
 * 每条都在事务里完成全部表迁移 + 按次凭据（防重放）+ 审计快照，可经 rollback 还原。
 * includeNeedsReview：旧契约参数，兼容保留——R7 后「需人工看」项必须显式进 ambiguous 名单。
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
    const ambiguous = Array.isArray(req.body?.ambiguous)
      ? req.body.ambiguous
        .map((item: any) => ({ a: String(item?.a || '').trim(), b: String(item?.b || '').trim() }))
        .filter((item: { a: string; b: string }) => item.a && item.b)
      : [];
    const drops = Array.isArray(req.body?.drops)
      ? req.body.drops.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (canonicals.length === 0 && ambiguous.length === 0 && drops.length === 0) {
      return res.status(400).json({ success: false, error: { message: '缺少要执行的确认项（canonicals / ambiguous / drops）' } });
    }
    const user = await findUserIdOnly(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const result = await conceptConsolidatorService.applyConfirmed(userId, { canonicals, ambiguous, drops });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[admin/memory-review] 执行归并失败:', error);
    return res.status(500).json({ success: false, error: { message: '执行归并失败' } });
  }
});

/**
 * POST /api/admin/memory-review/:userId/reject
 * 驳回建议（outlet C「POST reject」）：三组建议各自的主键可选携带（一次可驳一组或多组）。
 * 服务端留痕（audit.rejected）、移出待办，之后不再重复给出同一条建议。
 */
router.post('/:userId/reject', async (req, res) => {
  try {
    if (!(await ensureAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { userId } = req.params;
    const canonicals = Array.isArray(req.body?.canonicals)
      ? req.body.canonicals.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    const ambiguous = Array.isArray(req.body?.ambiguous)
      ? req.body.ambiguous
        .map((item: any) => ({ a: String(item?.a || '').trim(), b: String(item?.b || '').trim() }))
        .filter((item: { a: string; b: string }) => item.a && item.b)
      : [];
    const drops = Array.isArray(req.body?.drops)
      ? req.body.drops.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (canonicals.length === 0 && ambiguous.length === 0 && drops.length === 0) {
      return res.status(400).json({ success: false, error: { message: '缺少要驳回的建议（canonicals / ambiguous / drops）' } });
    }
    const user = await findUserIdOnly(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: '用户不存在' } });
    }
    const result = await conceptConsolidatorService.rejectProposals(userId, { canonicals, ambiguous, drops });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[admin/memory-review] 驳回建议失败:', error);
    return res.status(500).json({ success: false, error: { message: '驳回建议失败' } });
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
    const user = await findUserIdOnly(userId);
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
    const user = await findUserIdOnly(userId);
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
