/**
 * dispose-consolidation-backlog.ts —— R7 概念归并存量处置（2026-10-08 B2 止血批）。
 *
 * 背景：R7 出口（apply/reject/rollback）落地后存量无人走——331 份 concept-consolidation
 * 投影、379 条建议（auto 档为主）、stats.applied 全 0。本脚本对每个有审计投影的用户：
 *   1) getAudit() 读当前建议（服务端已剔除 rejected）；
 *   2) 取 autoApplicable 档的 canonical 名单（需人工确认项不动，留在人审队列）；
 *   3) applyProposals(canonicals, { strategy: 'alias' }) —— 非破坏别名归并，逐条留快照可回滚。
 *
 * 用法：
 *   ts-node src/scripts/dispose-consolidation-backlog.ts --dry-run   # 只打印将执行什么
 *   ts-node src/scripts/dispose-consolidation-backlog.ts             # 实际执行
 */
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import {
  conceptConsolidatorService,
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
} from '../services/learner/ConceptConsolidatorService';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const projections = await prisma.learner_projections.findMany({
    where: { scope: CONSOLIDATION_AUDIT_PROJECTION_SCOPE },
    select: { userId: true, payload: true },
  });
  console.log(`[backlog] 投影用户数=${projections.length} dryRun=${DRY_RUN}`);

  let totalProposals = 0;
  let totalAuto = 0;
  let totalApplied = 0;
  let totalSkipped = 0;
  const perUser: Array<{ userId: string; auto: number; applied: number; skipped: number }> = [];

  for (const projection of projections) {
    const audit = await conceptConsolidatorService.getAudit(projection.userId);
    const proposals = audit?.proposals ?? [];
    if (proposals.length === 0) continue;
    const autoCanonicals = proposals.filter((item) => item.autoApplicable).map((item) => item.canonical);
    totalProposals += proposals.length;
    totalAuto += autoCanonicals.length;
    if (autoCanonicals.length === 0) continue;

    if (DRY_RUN) {
      console.log(`  [dry] ${projection.userId}: auto ${autoCanonicals.length}/${proposals.length} → ${autoCanonicals.slice(0, 5).join(' | ')}${autoCanonicals.length > 5 ? ' …' : ''}`);
      continue;
    }

    const result = await conceptConsolidatorService.applyProposals(projection.userId, autoCanonicals, { strategy: 'alias' });
    // 注意：applyProposals 返回的 applied 只计破坏性 merge（strategy='merge' 档）；
    // alias 档的执行数在写回后的 stats.applied 增量里（2026-10-08 首跑教训：
    // 235 条实际全执行，脚本却报 applied=0）。
    const aliasApplied = (result.audit?.stats?.applied ?? 0) - ((audit?.stats?.applied as number | undefined) ?? 0);
    const repointed = (result.audit?.stats?.rowsRepointed ?? 0) - ((audit?.stats?.rowsRepointed as number | undefined) ?? 0);
    totalApplied += aliasApplied;
    totalSkipped += result.skipped.length;
    perUser.push({ userId: projection.userId, auto: autoCanonicals.length, applied: aliasApplied, skipped: result.skipped.length });
    console.log(`  [apply] ${projection.userId}: aliasMerged=${aliasApplied} rowsRepointed=${repointed} skipped=${result.skipped.length} (auto ${autoCanonicals.length}/${proposals.length})`);
    if (result.applied > 0) {
      logger.info('[backlog] consolidation applied', { userId: projection.userId, applied: result.applied });
    }
  }

  console.log(`[backlog] 汇总：建议总数=${totalProposals} auto档=${totalAuto} 已应用=${totalApplied} 跳过=${totalSkipped} 用户数=${perUser.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error('[backlog] 失败:', error);
    void prisma.$disconnect();
    process.exit(1);
  });
