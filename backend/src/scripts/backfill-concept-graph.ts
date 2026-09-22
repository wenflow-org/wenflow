/* eslint-disable no-console -- 一次性回填 CLI：概念图边物化（设计 §4.3） */
/**
 * 概念图边物化回填（L2）
 *
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §4.3
 *
 * 把存量路径 `aiPromptTemplate.kcAnnotation` 里的图搬进 `concept_edges`：
 *   - `prerequisite`：来自 `kcGraph.edges`（实测仅 5 条路径有内容、共 96 条边）
 *   - `part_of`：由 `conceptKcs` 嵌套结构代码推导（每 KC → 其 coreConcept）
 *
 * 纪律：幂等（复合唯一键去重）；`--dry-run` **纯只读**（只统计计划，不碰注册表也不写边）；
 * `--scope=virtual` 隔离真实用户。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-concept-graph.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/backfill-concept-graph.ts --scope=virtual
 */
import 'dotenv/config';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { conceptGraphService } from '../services/learner/concept-graph.service';
import { parsePathPromptTemplate } from '../services/learning/learning.helpers';

interface Args { scope: 'virtual' | 'all'; dryRun: boolean; limit: number | null; }

function parseArgs(): Args {
  const out: Args = { scope: 'virtual', dryRun: false, limit: null };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'scope' && (v === 'all' || v === 'virtual')) out.scope = v;
    if (k === 'dry-run') out.dryRun = true;
    if (k === 'limit' && v && Number.isFinite(Number(v))) out.limit = Number(v);
  }
  return out;
}

async function loadPaths(args: Args) {
  return prisma.learning_paths.findMany({
    where: {
      aiPromptTemplate: { contains: 'kcAnnotation' },
      ...(args.scope === 'virtual' ? { users: { isVirtualLearner: true } } : {}),
    },
    select: { id: true, userId: true, aiPromptTemplate: true },
    ...(args.limit ? { take: args.limit } : {}),
  });
}

/** 纯只读计划：统计待物化的边数，不写任何行 */
async function reportPlan(args: Args): Promise<void> {
  const paths = await loadPaths(args);
  let withEdges = 0;
  let prerequisiteEdges = 0;
  let partOfEdges = 0;
  for (const row of paths) {
    const template = parsePathPromptTemplate(row.aiPromptTemplate);
    const ann = (template as { kcAnnotation?: { kcGraph?: { edges?: unknown[] }; conceptKcs?: Array<{ kcs?: unknown[] }> } } | null)?.kcAnnotation;
    if (!ann) continue;
    const edges = Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph!.edges!.length : 0;
    if (edges > 0) withEdges += 1;
    prerequisiteEdges += edges;
    for (const item of Array.isArray(ann.conceptKcs) ? ann.conceptKcs! : []) {
      partOfEdges += Array.isArray(item?.kcs) ? item.kcs!.length : 0;
    }
  }
  const existing = await prisma.concept_edges.count();
  console.log(`[graph:plan] 含 kcAnnotation 的路径=${paths.length}（其中有 prerequisite 边的=${withEdges}）`);
  console.log(`[graph:plan] 待物化边：prerequisite=${prerequisiteEdges} part_of=${partOfEdges}`);
  console.log(`[graph:plan] 库内现有 concept_edges=${existing}（幂等：已存在的不重复创建）`);
  console.log('[graph:plan] dry-run 结束：未写任何行');
}

async function main() {
  const args = parseArgs();
  console.log(`[graph] scope=${args.scope} dryRun=${args.dryRun} limit=${args.limit ?? '∞'}`);

  if (args.dryRun) {
    await reportPlan(args);
    return;
  }

  const paths = await loadPaths(args);
  const started = Date.now();
  const total = { prerequisite: 0, partOf: 0, skipped: 0, failed: 0 };
  for (const row of paths) {
    const template = parsePathPromptTemplate(row.aiPromptTemplate);
    const ann = (template as { kcAnnotation?: unknown } | null)?.kcAnnotation;
    if (!ann) continue;
    try {
      const r = await conceptGraphService.materializePathGraph({
        userId: row.userId,
        pathId: row.id,
        kcAnnotation: ann as never,
        cognitiveCore: (template as { cognitiveCore?: unknown } | null)?.cognitiveCore as never,
      });
      total.prerequisite += r.prerequisite;
      total.partOf += r.partOf;
      total.skipped += r.skipped;
    } catch (error) {
      total.failed += 1;
      logger.warn('[graph] 单条路径物化失败（跳过）', {
        pathId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const edgeCount = await prisma.concept_edges.count();
  console.log(`[graph] 完成 耗时=${((Date.now() - started) / 1000).toFixed(1)}s` +
    ` ｜prerequisite=${total.prerequisite} part_of=${total.partOf} 跳过=${total.skipped} 失败路径=${total.failed}`);
  console.log(`[graph] 库内 concept_edges=${edgeCount}`);
}

// 仅在直接执行时跑 CLI：被 import（如单测）时不得产生副作用。
if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { logger.error('[graph] 失败', e); console.error(e); process.exit(1); });
}
