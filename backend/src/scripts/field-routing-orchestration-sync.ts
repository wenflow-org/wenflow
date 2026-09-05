/**
 * 字段路由「全量对账」脚本（文件为准）：对全部 stage 逐阶段执行与
 * POST /api/admin/field-routings/orchestration/:stage/sync 完全相同的
 * 三表 upsert(update: 全部业务列) 逻辑。
 *
 * 实现：syncStageFieldRoutingsFromFile（field-routing-bootstrap.service，
 * 与 route / health-center 一键修复共用同一实现，禁止复制逻辑）：
 *   - managedByCode=true 的行按编排文件声明更新
 *   - managedByCode=false 的 admin 覆盖行跳过（保留不动）
 *   - 不删除任何行（孤儿行维度不在本脚本范围）
 * 输出每 stage 统计：contractsUpdated / fieldsUpdated / routingsUpdated /
 * createdCount（按表拆分）/ skippedAdminRows。
 */
import 'dotenv/config';
import systemPrisma from '../config/system-database';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import { syncStageFieldRoutingsFromFile } from '../services/field-routing-bootstrap.service';

async function main() {
  const stages = loadOrchestrationFiles();
  const reports = [];
  for (const stage of stages) {
    reports.push(await syncStageFieldRoutingsFromFile(systemPrisma, stage));
  }

  const totals = reports.reduce(
    (acc, r) => {
      acc.contractsUpdated += r.contractsUpdated;
      acc.fieldsUpdated += r.fieldsUpdated;
      acc.routingsUpdated += r.routingsUpdated;
      acc.contractsCreated += r.contractsCreated;
      acc.fieldsCreated += r.fieldsCreated;
      acc.routingsCreated += r.routingsCreated;
      acc.skipped += r.skippedAdminRows.length;
      return acc;
    },
    { contractsUpdated: 0, fieldsUpdated: 0, routingsUpdated: 0, contractsCreated: 0, fieldsCreated: 0, routingsCreated: 0, skipped: 0 },
  );

  console.log(JSON.stringify({ reports, totals }, null, 2));
}

main()
  .catch((error) => {
    console.error('[sync] FAILED:', error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
