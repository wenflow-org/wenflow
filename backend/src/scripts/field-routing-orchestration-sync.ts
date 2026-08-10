/**
 * 字段路由「全量对账」脚本（文件为准）：对 5 个 stage 逐阶段执行与
 * POST /api/admin/field-routings/orchestration/:stage/sync 完全相同的
 * 三表 upsert(update: 全部业务列) 逻辑：
 *   - managedByCode=true 的行按编排文件声明更新
 *   - managedByCode=false 的 admin 覆盖行跳过（保留不动）
 *   - 不删除任何行（孤儿行维度不在本脚本范围）
 * 输出每 stage 统计：contractsUpdated / fieldsUpdated / routingsUpdated /
 * createdCount（按表拆分）/ skippedAdminRows。
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import systemPrisma from '../config/system-database';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';

interface StageSyncReport {
  stage: string;
  contractsUpdated: number;
  fieldsUpdated: number;
  routingsUpdated: number;
  contractsCreated: number;
  fieldsCreated: number;
  routingsCreated: number;
  skippedAdminRows: Array<{ table: string; key: string }>;
}

async function syncStage(stage: ReturnType<typeof loadOrchestrationFiles>[number]): Promise<StageSyncReport> {
  const report: StageSyncReport = {
    stage: stage.stage,
    contractsUpdated: 0,
    fieldsUpdated: 0,
    routingsUpdated: 0,
    contractsCreated: 0,
    fieldsCreated: 0,
    routingsCreated: 0,
    skippedAdminRows: [],
  };

  for (const c of stage.contracts) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'agent_contracts', key: c.agentId });
        continue;
      }
      await systemPrisma.agent_contracts.update({
        where: { agentId: c.agentId },
        data: { stage: stage.stage, displayName: c.displayName, description: c.description, updatedAt: new Date() },
      });
      report.contractsUpdated++;
    } else {
      await systemPrisma.agent_contracts.create({
        data: {
          id: randomUUID(),
          agentId: c.agentId,
          stage: stage.stage,
          displayName: c.displayName,
          description: c.description,
          schemaVersion: 'v3',
          source: 'code',
          managedByCode: true,
        },
      });
      report.contractsCreated++;
    }
  }

  for (const f of stage.fields) {
    const exists = await systemPrisma.field_definitions.findFirst({ where: { stage: stage.stage, fieldId: f.fieldId } });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'field_definitions', key: `${stage.stage}/${f.fieldId}` });
        continue;
      }
      await systemPrisma.field_definitions.update({
        where: { stage_fieldId: { stage: stage.stage, fieldId: f.fieldId } },
        data: {
          stage: stage.stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          description: f.description,
          enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null,
          systemLocked: f.systemLocked ?? false,
          structureLocked: f.structureLocked ?? false,
          bindings: f.bindings ? JSON.stringify(f.bindings) : null,
          updatedAt: new Date(),
        },
      });
      report.fieldsUpdated++;
    } else {
      await systemPrisma.field_definitions.create({
        data: {
          id: randomUUID(),
          fieldId: f.fieldId,
          stage: stage.stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          description: f.description,
          enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null,
          systemLocked: f.systemLocked ?? false,
          structureLocked: f.structureLocked ?? false,
          bindings: f.bindings ? JSON.stringify(f.bindings) : null,
          schemaVersion: 'v3',
          source: 'code',
          managedByCode: true,
        },
      });
      report.fieldsCreated++;
    }
  }

  for (const r of stage.routings) {
    const where = { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } };
    const exists = await systemPrisma.agent_field_routings.findUnique({ where });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'agent_field_routings', key: `${r.agentId}/${r.fieldId}` });
        continue;
      }
      await systemPrisma.agent_field_routings.update({
        where,
        data: {
          render: r.render,
          handoff: r.handoff.length ? JSON.stringify(r.handoff) : null,
          internalFlag: r.internal,
          accumulate: r.accumulate,
          visibilityPreset: r.visibilityPreset ?? null,
          notes: r.notes ?? null,
          updatedAt: new Date(),
        },
      });
      report.routingsUpdated++;
    } else {
      await systemPrisma.agent_field_routings.create({
        data: {
          id: randomUUID(),
          agentId: r.agentId,
          fieldId: r.fieldId,
          render: r.render,
          handoff: r.handoff.length ? JSON.stringify(r.handoff) : null,
          internalFlag: r.internal,
          accumulate: r.accumulate,
          visibilityPreset: r.visibilityPreset ?? null,
          notes: r.notes ?? null,
          source: 'code',
          managedByCode: true,
        },
      });
      report.routingsCreated++;
    }
  }

  return report;
}

async function main() {
  const stages = loadOrchestrationFiles();
  const reports: StageSyncReport[] = [];
  for (const stage of stages) {
    reports.push(await syncStage(stage));
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
