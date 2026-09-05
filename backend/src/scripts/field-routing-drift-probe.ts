/**
 * 字段路由漂移只读探测（环境探测用）：
 *   - detectFieldRoutingDrift 当前漂移数量 + 抽样
 *   - 三表 DB 行数 / 声明数 / 孤儿行数 / admin 行（managedByCode=false）数
 * 只读，不写任何数据。
 * 用法：npx ts-node --transpile-only src/scripts/field-routing-drift-probe.ts [--check]
 *   --check：driftCount>0 或任一孤儿行 >0 时打印报告并退出 1（CI 门禁用）；无参时仅打印报告退出 0。
 */
import 'dotenv/config';
import systemPrisma from '../config/system-database';
import {
  detectFieldRoutingDrift,
  FIELD_ROUTING_SEED_MANIFEST,
} from '../services/field-routing-bootstrap.service';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';

async function main() {
  const checkMode = process.argv.includes('--check');
  const stages = loadOrchestrationFiles();
  console.log(`[probe] orchestration stages: ${stages.map((s) => s.stage).join(', ')}`);

  const [report, dbContracts, dbFields, dbRoutings] = await Promise.all([
    detectFieldRoutingDrift(systemPrisma),
    systemPrisma.agent_contracts.findMany(),
    systemPrisma.field_definitions.findMany(),
    systemPrisma.agent_field_routings.findMany(),
  ]);

  const declaredContractIds = new Set(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds);
  const declaredFieldKeys = new Set(
    stages.flatMap((s) => s.fields.map((f) => `${s.stage}\0${f.fieldId}`)),
  );
  const declaredRoutingKeys = new Set(
    FIELD_ROUTING_SEED_MANIFEST.routings.map((r) => `${r.agentId}\0${r.fieldId}`),
  );

  const orphanContracts = dbContracts.filter((r) => !declaredContractIds.has(r.agentId));
  const orphanFields = dbFields.filter((r) => !declaredFieldKeys.has(`${r.stage}\0${r.fieldId}`));
  const orphanRoutings = dbRoutings.filter((r) => !declaredRoutingKeys.has(`${r.agentId}\0${r.fieldId}`));

  const adminContracts = dbContracts.filter((r) => r.managedByCode === false);
  const adminFields = dbFields.filter((r) => r.managedByCode === false);
  const adminRoutings = dbRoutings.filter((r) => r.managedByCode === false);

  const kindCount = { contract: 0, field: 0, routing: 0 };
  for (const item of report.items) kindCount[item.kind]++;

  console.log(JSON.stringify(
    {
      driftCount: report.driftCount,
      driftByKind: kindCount,
      sample: report.items.slice(0, 10),
      counts: {
        contracts: { db: dbContracts.length, declared: declaredContractIds.size, orphan: orphanContracts.length, admin: adminContracts.length },
        fields: { db: dbFields.length, declared: declaredFieldKeys.size, orphan: orphanFields.length, admin: adminFields.length },
        routings: { db: dbRoutings.length, declared: declaredRoutingKeys.size, orphan: orphanRoutings.length, admin: adminRoutings.length },
      },
      orphanDetails: {
        contracts: orphanContracts.map((r) => ({ agentId: r.agentId, managedByCode: r.managedByCode })),
        fields: orphanFields.map((r) => ({ fieldId: r.fieldId, stage: r.stage, managedByCode: r.managedByCode })),
        routings: orphanRoutings.map((r) => ({ key: `${r.agentId}/${r.fieldId}`, managedByCode: r.managedByCode })),
      },
      adminDetails: {
        contracts: adminContracts.map((r) => r.agentId),
        fields: adminFields.map((r) => r.fieldId),
        routings: adminRoutings.map((r) => `${r.agentId}/${r.fieldId}`),
      },
    },
    null,
    2,
  ));

  if (checkMode) {
    const orphanTotal = orphanContracts.length + orphanFields.length + orphanRoutings.length;
    const failed = report.driftCount > 0 || orphanTotal > 0;
    console.log(`[probe:check] driftCount=${report.driftCount} orphans=${orphanTotal} ${failed ? 'FAIL' : 'OK'}`);
    if (failed) {
      console.error('[probe:check] 检测到字段路由漂移或孤儿行，详情见上方报告');
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error('[probe] FAILED:', error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
