/**
 * dev 工具：清理编排声明已删除、但 DB 仍残留的孤儿行（prune）
 *
 * 为什么需要它：`prompts:drift-check` 会因孤儿行 FAIL（声明删除 → DB 行应消失），而
 * `prompts:seed-routings` 只建不删。这里直接调用仓库自带的 pruneStageFieldRoutings
 * （编排文件为唯一声明源；删除前逐行写 node_config_changes 审计）。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/prune-field-routings.ts --stage=goal          # dry-run
 *   npx ts-node --transpile-only scripts/prune-field-routings.ts --stage=goal --apply
 */
import dotenv from 'dotenv';
import systemPrisma from '../src/config/system-database';
import { loadOrchestrationFiles } from '../src/services/field-routing/orchestration-file';
import { pruneStageFieldRoutings } from '../src/services/field-routing-bootstrap.service';

dotenv.config();

const arg = (n: string) => {
  const hit = process.argv.find((i) => i.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const stageName = arg('stage');
const APPLY = process.argv.includes('--apply');

(async () => {
  if (!stageName) {
    console.error('用法：--stage=goal [--apply]（可选 stage：' + loadOrchestrationFiles().map((s) => s.stage).join(', ') + '）');
    process.exit(1);
  }
  const stage = loadOrchestrationFiles().find((s) => s.stage === stageName);
  if (!stage) {
    console.error(`找不到编排 stage：${stageName}`);
    process.exit(1);
  }
  const report = await pruneStageFieldRoutings(systemPrisma as any, stage as any, {
    dryRun: !APPLY,
    actorId: 'dev-prune-field-routings',
  });
  console.log(JSON.stringify({
    stage: stageName,
    dryRun: report.dryRun,
    candidates: report.candidates.map((c: any) => c.key ?? c),
    protectedRows: report.protectedRows.map((c: any) => c.key ?? c),
    deletedCount: report.deletedCount,
    auditIds: report.auditIds.length,
  }, null, 2));
  console.log(APPLY ? '== 已清理 ==' : '== dry-run（加 --apply 执行）==');
  await systemPrisma.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await systemPrisma.$disconnect();
  process.exit(1);
});
