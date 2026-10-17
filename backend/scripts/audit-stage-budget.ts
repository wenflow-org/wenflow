#!/usr/bin/env node
/**
 * 阶段预算不变量审计（#56 / I3，只读）
 *
 * 遍历学习路径与其阶段学时，重跑 `auditStageBudget`，输出退化形态的比例与样本：
 * - `stage_equals_upstream` 某阶段学时 == 上游总预算（阶段反推退化成复制）
 * - `all_stages_identical` 各阶段完全等分
 * - `stage_hours_missing` 阶段没有可用学时
 * - `stage_sum_mismatch` 阶段合计与路径总量差 >5%
 * - `capacity_overload` 路径总量超出学习者可用容量（信息项，不算不通过）
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/audit-stage-budget.ts [--limit 20] [--json]
 */
import prisma from '../src/config/database';
import { auditStageBudget, type StageBudgetViolationKind } from '../src/services/learning/generation/stage-budget-invariant';

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const SAMPLE_LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 20 : 20;
const AS_JSON = args.includes('--json');

async function main() {
  const paths = await prisma.learning_paths.findMany({
    select: {
      id: true,
      title: true,
      estimatedHours: true,
      aiPromptTemplate: true,
      milestones: { select: { stageNumber: true, title: true, estimatedHours: true }, orderBy: { stageNumber: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const histogram = new Map<StageBudgetViolationKind, number>();
  const samples: Array<{ pathId: string; title: string | null; kinds: StageBudgetViolationKind[] }> = [];
  let checked = 0;
  let failed = 0;

  for (const path of paths) {
    if (!path.milestones.length) continue;
    checked += 1;
    // 上游预算：优先取生成时落库的容量对表结论里的 pathMinutes，其次路径总量
    let upstreamBudgetHours: number | null = Number(path.estimatedHours) || null;
    try {
      const template = path.aiPromptTemplate ? JSON.parse(path.aiPromptTemplate) : null;
      const pathMinutes = Number(template?.capacityOverload?.pathMinutes);
      if (Number.isFinite(pathMinutes) && pathMinutes > 0) upstreamBudgetHours = Math.round(pathMinutes / 60);
    } catch { /* 模板损坏时按路径总量判 */ }

    const report = auditStageBudget({
      pathEstimatedHours: Number(path.estimatedHours) || null,
      upstreamBudgetHours,
      stages: path.milestones,
    });
    if (report.ok) continue;
    failed += 1;
    const kinds = Array.from(new Set(report.violations.map((violation) => violation.kind)));
    for (const kind of kinds) histogram.set(kind, (histogram.get(kind) || 0) + 1);
    if (samples.length < SAMPLE_LIMIT) samples.push({ pathId: path.id, title: path.title, kinds });
  }

  const result = {
    checked,
    failed,
    failRate: checked ? Math.round((failed / checked) * 1000) / 10 : 0,
    byKind: Object.fromEntries(Array.from(histogram.entries()).sort((a, b) => b[1] - a[1])),
    samples,
  };
  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[stage-budget] 检查 ${checked} 条路径，不通过 ${failed} 条（${result.failRate}%）`);
    console.log('[stage-budget] 违规类型分布:', JSON.stringify(result.byKind));
    for (const sample of samples) console.log(`- ${sample.title || sample.pathId}: ${sample.kinds.join(', ')}`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[stage-budget] 失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
