/* eslint-disable no-console -- 数据层重建 CLI（默认 dry-run） */
/**
 * rebuild-vl-data-layer.ts — 虚拟学习者「记忆 + KC」数据层从零重建
 *
 * 背景（用户拍板 2026-10-21）：数据层不再做增量迁移/修补，直接按新设计从零重建——
 *   - FSRS：清空排程状态（memory_traces）与派生投影，后续课堂按新写入链重新生成；
 *   - KC：清空 concepts/concept_aliases/concept_edges，按路径 kcAnnotation 重新种子化，
 *         并登记 `kc:<pathId>:<kcId>` 稳定锚键（此后措辞漂移也命中同一身份）；
 *   - 证据账本（learner_evidence）一并清空：它承载的是旧口径的观测，留着会与新层混算。
 *
 * 纪律：
 *   - 默认 **dry-run**（只统计不写）；`--apply` 才执行。
 *   - 默认 `--scope=virtual`（isVirtualLearner=1），真实用户不动。
 *   - 执行前把受影响行导出到 `.tmp-batch/backups/vl-layer-<ts>.json`。
 *   - 执行时建议先 `node backend/restart.mjs --stop`，避免后台 worker 并发写。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/rebuild-vl-data-layer.ts
 *   npx ts-node --transpile-only src/scripts/rebuild-vl-data-layer.ts --apply
 *   npx ts-node --transpile-only src/scripts/rebuild-vl-data-layer.ts --scope=all --apply
 *   npx ts-node --transpile-only src/scripts/rebuild-vl-data-layer.ts --apply --force  # 有在跑课堂时强制
 *
 * 2026-10-21 稳定性护栏：有未收束课堂/在跑会话时默认拒绝 `--apply`——清库会打断正在进行的
 * 课堂，并让后台 worker 的写回落到已清空的痕迹上（数据面自相矛盾）。真要在跑批时重建，
 * 显式 `--force`（会先备份）。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/database';
import { parsePathPromptTemplate } from '../services/learning/learning.helpers';
import { conceptRegistryService } from '../services/learner/concept-registry.service';
import { conceptGraphService } from '../services/learner/concept-graph.service';

interface Args { apply: boolean; scope: 'virtual' | 'all'; force: boolean; }

function parseArgs(): Args {
  const out: Args = { apply: false, scope: 'virtual', force: false };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'apply') out.apply = true;
    if (k === 'force') out.force = true;
    if (k === 'scope' && (v === 'virtual' || v === 'all')) out.scope = v;
  }
  return out;
}

/**
 * 纯函数：把「在跑工作量」翻译成拒绝理由；没有在跑的工作 → null。
 * 抽出来单独断言，避免守卫逻辑只在 CLI 里被间接覆盖。
 */
export function describeActiveWorkBlocker(counts: {
  activeClassrooms: number;
  runningSessions: number;
}): string | null {
  const classrooms = Math.max(0, Number(counts.activeClassrooms) || 0);
  const sessions = Math.max(0, Number(counts.runningSessions) || 0);
  if (classrooms === 0 && sessions === 0) return null;
  return `检测到未收束课堂 ${classrooms} 节 / 在跑仿真会话 ${sessions} 个：清库会打断在途课堂。`
    + '先收束或停止这些会话，确需强制重建请加 --force。';
}

async function assertNoActiveWork(userIds: string[], force: boolean): Promise<void> {
  if (force) return;
  // 只看「真的还在跑」的：active/paused/finalizing 一律算；timeout 是可恢复终态，
  // 但几天前的 timeout 不应永久拦住重建——只认最近 2 小时内的（可能正在被续课）。
  // 仿真会话的 running 是课间常态，只认最近 15 分钟内更新（= 车道确实在写）。
  const classroomRecency = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const sessionRecency = new Date(Date.now() - 15 * 60 * 1000);
  const [activeClassrooms, runningSessions] = await Promise.all([
    prisma.teaching_sessions.count({
      where: {
        userId: { in: userIds },
        OR: [
          { status: { in: ['active', 'paused', 'finalizing'] } },
          { status: 'timeout', updatedAt: { gte: classroomRecency } },
        ],
      },
    }),
    prisma.virtual_sessions.count({
      where: { userId: { in: userIds }, status: 'running', updatedAt: { gte: sessionRecency } },
    }),
  ]);
  const blocker = describeActiveWorkBlocker({ activeClassrooms, runningSessions });
  if (blocker) throw new Error(blocker);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

async function resolveUserIds(scope: Args['scope']): Promise<string[]> {
  const users = await prisma.users.findMany({
    where: scope === 'virtual' ? { isVirtualLearner: true } : {},
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function loadPaths(userIds: string[]) {
  return prisma.learning_paths.findMany({
    where: { userId: { in: userIds }, aiPromptTemplate: { contains: 'kcAnnotation' } },
    select: { id: true, userId: true, aiPromptTemplate: true },
  });
}

interface PathPlan {
  id: string;
  userId: string;
  kcCount: number;
  anchorCount: number;
  edgeCount: number;
  coreConceptCount: number;
}

function planPath(row: { id: string; userId: string; aiPromptTemplate: string | null }): PathPlan {
  const template = parsePathPromptTemplate(row.aiPromptTemplate) as {
    kcAnnotation?: {
      conceptKcs?: Array<{ conceptId?: string; kcs?: Array<{ kcId?: string; name?: string }> }>;
      kcGraph?: { edges?: unknown[] };
    };
    cognitiveCore?: { coreConcepts?: Array<{ id?: string; name?: string }> };
  } | null;
  const ann = template?.kcAnnotation;
  const conceptKcs = Array.isArray(ann?.conceptKcs) ? ann!.conceptKcs! : [];
  const kcs = conceptKcs.flatMap((item) => (Array.isArray(item?.kcs) ? item.kcs! : []));
  const kcIds = new Set(kcs.map((k) => str(k?.kcId)).filter(Boolean));
  const coreNames = new Set(
    (Array.isArray(template?.cognitiveCore?.coreConcepts) ? template!.cognitiveCore!.coreConcepts! : [])
      .map((c) => str(c?.name))
      .filter(Boolean),
  );
  return {
    id: row.id,
    userId: row.userId,
    kcCount: kcIds.size,
    anchorCount: kcIds.size,
    edgeCount: Array.isArray(ann?.kcGraph?.edges) ? ann!.kcGraph!.edges!.length : 0,
    coreConceptCount: coreNames.size,
  };
}

async function backup(userIds: string[], out: string): Promise<void> {
  const where = { userId: { in: userIds } } as const;
  const payload = {
    savedAt: new Date().toISOString(),
    scopeUsers: userIds,
    counts: {} as Record<string, number>,
    memoryTraces: await prisma.memory_traces.findMany({ where }),
    misconceptionLedger: await prisma.misconception_ledger.findMany({ where }),
    predictionRecords: await prisma.prediction_records.findMany({ where }),
    learnerEvidence: await prisma.learner_evidence.findMany({ where }),
    concepts: await prisma.concepts.findMany({ where }),
    conceptAliases: await prisma.concept_aliases.findMany({ where }),
    conceptEdges: await prisma.concept_edges.findMany({ where }),
  };
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) (payload.counts as Record<string, number>)[k] = v.length;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload));
  console.log(JSON.stringify({ backup: out, bytes: fs.statSync(out).size, counts: payload.counts }, null, 1));
}

async function wipe(userIds: string[]): Promise<Record<string, number>> {
  const where = { userId: { in: userIds } } as const;
  const counts: Record<string, number> = {};
  counts.memoryTraces = (await prisma.memory_traces.deleteMany({ where })).count;
  counts.misconceptionLedger = (await prisma.misconception_ledger.deleteMany({ where })).count;
  counts.predictionRecords = (await prisma.prediction_records.deleteMany({ where })).count;
  counts.learnerProjections = (await prisma.learner_projections.deleteMany({ where })).count;
  counts.learnerEvidence = (await prisma.learner_evidence.deleteMany({ where })).count;
  counts.conceptEdges = (await prisma.concept_edges.deleteMany({ where })).count;
  counts.concepts = (await prisma.concepts.deleteMany({ where })).count; // aliases 随 FK 级联

  // 计划行上的 canonical 身份随 concepts 一起失效：先置空，避免重建时把旧 id
  // 当成「已挂靠」跳过（第二轮 apply 实测只链上 18/1044 就是因为这个）。
  const subtaskIds = (await prisma.subtasks.findMany({
    where: { milestones: { learning_paths: { userId: { in: userIds } } } },
    select: { id: true },
  })).map((t) => t.id);
  const milestoneIds = (await prisma.milestones.findMany({
    where: { learning_paths: { userId: { in: userIds } } },
    select: { id: true },
  })).map((m) => m.id);
  counts.subtaskIdentityReset = (await prisma.subtasks.updateMany({
    where: { id: { in: subtaskIds } }, data: { conceptId: null },
  })).count;
  counts.milestoneIdentityReset = (await prisma.milestones.updateMany({
    where: { id: { in: milestoneIds } }, data: { conceptId: null },
  })).count;
  return counts;
}

/** 按 kcAnnotation 重新种子化概念身份、锚键与边 */
async function rebuild(userIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    paths: 0, kcConcepts: 0, coreConcepts: 0, anchors: 0, reused: 0,
    prerequisiteEdges: 0, partOfEdges: 0,
    milestonesScanned: 0, milestonesLinked: 0, subtasksLinked: 0, subtasksScanned: 0,
  };
  const paths = await loadPaths(userIds);
  // 概念级名称映射：cognitiveCore.coreConcepts（id → name）
  for (const row of paths) {
    const template = parsePathPromptTemplate(row.aiPromptTemplate) as {
      kcAnnotation?: {
        conceptKcs?: Array<{ conceptId?: string; kcs?: Array<{ kcId?: string; name?: string; taxonomy?: string }> }>;
        kcGraph?: { edges?: Array<{ from?: string; to?: string; relation?: string }> };
      };
      cognitiveCore?: { coreConcepts?: Array<{ id?: string; name?: string }> };
    } | null;
    const ann = template?.kcAnnotation;
    if (!ann) continue;
    counts.paths += 1;

    const coreNameById = new Map<string, string>();
    for (const c of Array.isArray(template?.cognitiveCore?.coreConcepts) ? template!.cognitiveCore!.coreConcepts! : []) {
      const id = str(c?.id); const name = str(c?.name);
      if (id && name) coreNameById.set(id, name);
    }

    const conceptKcs = Array.isArray(ann.conceptKcs) ? ann.conceptKcs : [];
    for (const group of conceptKcs) {
      const coreName = coreNameById.get(str(group?.conceptId));
      if (coreName) {
        await conceptRegistryService.resolveConcept(row.userId, coreName, {
          level: 'concept', originPathId: row.id, source: 'backfill',
        });
        counts.coreConcepts += 1;
      }
      for (const kc of Array.isArray(group?.kcs) ? group.kcs : []) {
        const kcId = str(kc?.kcId);
        const name = str(kc?.name);
        if (!kcId || !name) continue;
        const resolved = await conceptRegistryService.resolveConcept(row.userId, name, {
          level: 'kc', originPathId: row.id, source: 'backfill',
        });
        if (!resolved) continue;
        if (resolved.created) counts.kcConcepts += 1; else counts.reused += 1;
        const anchor = `kc:${row.id}:${kcId}`;
        const reg = await conceptRegistryService.registerAlias({
          userId: row.userId, conceptId: resolved.conceptId, aliasRaw: anchor,
          source: 'backfill', confidence: 1,
        });
        if (reg.registered) counts.anchors += 1;
      }
    }

    const materialized = await conceptGraphService.materializePathGraph({
      userId: row.userId,
      pathId: row.id,
      kcAnnotation: ann,
      cognitiveCore: template?.cognitiveCore ?? null,
    });
    counts.prerequisiteEdges += materialized.prerequisite;
    counts.partOfEdges += materialized.partOf;
  }

  // 里程碑 canonical 身份回填（coreConceptName → conceptId）
  const milestones = await prisma.milestones.findMany({
    where: { learning_paths: { userId: { in: userIds } } },
    select: {
      id: true,
      coreConceptName: true,
      conceptId: true,
      learning_paths: { select: { id: true, userId: true } },
    },
  });
  for (const milestone of milestones) {
    counts.milestonesScanned += 1;
    const name = str(milestone.coreConceptName);
    const owner = milestone.learning_paths;
    if (!name || milestone.conceptId || !owner?.userId) continue;
    const resolved = await conceptRegistryService.resolveConcept(owner.userId, name, {
      level: 'concept', originPathId: owner.id ?? null, source: 'backfill',
    });
    if (!resolved) continue;
    await prisma.milestones.update({ where: { id: milestone.id }, data: { conceptId: resolved.conceptId } });
    counts.milestonesLinked += 1;
  }

  // 子任务 canonical 身份回填（linkedConceptName → conceptId）
  const subtasks = await prisma.subtasks.findMany({
    where: { milestones: { learning_paths: { userId: { in: userIds } } } },
    select: {
      id: true,
      linkedConceptName: true,
      conceptId: true,
      milestones: { select: { learning_paths: { select: { id: true, userId: true } } } },
    },
  });
  for (const task of subtasks) {
    counts.subtasksScanned += 1;
    const name = str(task.linkedConceptName);
    const owner = task.milestones?.learning_paths;
    if (!name || task.conceptId || !owner?.userId) continue;
    const resolved = await conceptRegistryService.resolveConcept(owner.userId, name, {
      level: 'concept', originPathId: owner.id ?? null, source: 'backfill',
    });
    if (!resolved) continue;
    await prisma.subtasks.update({ where: { id: task.id }, data: { conceptId: resolved.conceptId } });
    counts.subtasksLinked += 1;
  }
  return counts;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const userIds = await resolveUserIds(args.scope);
  const paths = await loadPaths(userIds);
  const plans = paths.map(planPath);
  const planned = {
    scope: args.scope,
    users: userIds.length,
    paths: plans.length,
    kcConcepts: plans.reduce((a, p) => a + p.kcCount, 0),
    anchors: plans.reduce((a, p) => a + p.anchorCount, 0),
    edges: plans.reduce((a, p) => a + p.edgeCount, 0),
    coreConcepts: plans.reduce((a, p) => a + p.coreConceptCount, 0),
  };
  console.log(`[rebuild] ${args.apply ? 'APPLY' : 'DRY-RUN'} 计划：${JSON.stringify(planned)}`);
  if (!args.apply) {
    console.log('[rebuild] dry-run 结束（加 --apply 执行）');
    return;
  }

  await assertNoActiveWork(userIds, args.force);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(process.cwd(), '..', '.tmp-batch', 'backups', `vl-layer-${stamp}.json`);
  await backup(userIds, backupPath);

  const deleted = await wipe(userIds);
  console.log('[rebuild] 已清空：', JSON.stringify(deleted));

  const rebuilt = await rebuild(userIds);
  console.log('[rebuild] 已重建：', JSON.stringify(rebuilt));

  const after = {
    traces: await prisma.memory_traces.count({ where: { userId: { in: userIds } } }),
    evidence: await prisma.learner_evidence.count({ where: { userId: { in: userIds } } }),
    concepts: await prisma.concepts.count({ where: { userId: { in: userIds } } }),
    aliases: await prisma.concept_aliases.count({ where: { userId: { in: userIds } } }),
    edges: await prisma.concept_edges.count({ where: { userId: { in: userIds } } }),
  };
  console.log('[rebuild] 重建后存量：', JSON.stringify(after));
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('[rebuild] 失败：', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
}
