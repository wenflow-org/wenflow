import systemPrisma from '../../config/system-database';
import type { Prisma } from '../../generated/system-client';
import {
  ensureStageFieldRoutings,
  syncStageFieldRoutingsFromFile,
  pruneStageFieldRoutings,
  detectFieldRoutingDrift,
  deleteStageFieldRows,
} from '../field-routing-bootstrap.service';

/**
 * 字段路由管理仓储（routes/admin/field-routings.ts 与 routes/prompt-lab.ts 的取数层，系统库）。
 * 字段定义/agent 契约/路由行读写与审计行查询；锁判定语义留在路由层。
 * 另提供 bootstrap 编排函数的免客户端包装（DB 客户端由本模块持有，路由层不再传递）。
 */

export function listFieldDefinitionsByStage(stage: string) {
  return systemPrisma.field_definitions.findMany({
    where: { stage },
    orderBy: [{ promptRole: 'asc' }, { fieldId: 'asc' }],
  });
}

export function listAgentContractsByStage(stage: string) {
  return systemPrisma.agent_contracts.findMany({
    where: { stage },
    orderBy: { displayName: 'asc' },
  });
}

export function listAgentIdsByStage(stage: string) {
  return systemPrisma.agent_contracts.findMany({ where: { stage }, select: { agentId: true } });
}

export function listFieldIdsByStage(stage: string) {
  return systemPrisma.field_definitions.findMany({ where: { stage }, select: { fieldId: true } });
}

export function listRoutingsByAgentsAndFields(agentIds: string[], fieldIds: string[]) {
  return systemPrisma.agent_field_routings.findMany({
    where: {
      agentId: { in: agentIds },
      fieldId: { in: fieldIds },
    },
  });
}

export function findRoutingRow(agentId: string, fieldId: string) {
  return systemPrisma.agent_field_routings.findUnique({
    where: { agentId_fieldId: { agentId, fieldId } },
  });
}

/** 字段定义级锁（systemLocked/structureLocked） */
export function findFieldDefLocks(stage: string, fieldId: string) {
  return systemPrisma.field_definitions.findFirst({
    where: { stage, fieldId },
    select: { systemLocked: true, structureLocked: true },
  });
}

export function updateRoutingRow(agentId: string, fieldId: string, data: Prisma.agent_field_routingsUpdateInput) {
  return systemPrisma.agent_field_routings.update({
    where: { agentId_fieldId: { agentId, fieldId } },
    data,
  });
}

export function listNodeConfigChanges(where: Prisma.node_config_changesWhereInput, limit: number) {
  return systemPrisma.node_config_changes.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ---------- bootstrap 编排函数的免客户端包装 ----------

export function ensureStageRoutingsForStage(stage: Parameters<typeof ensureStageFieldRoutings>[1]) {
  return ensureStageFieldRoutings(systemPrisma, stage);
}

export function syncStageRoutingsForStage(stage: Parameters<typeof syncStageFieldRoutingsFromFile>[1]) {
  return syncStageFieldRoutingsFromFile(systemPrisma, stage);
}

export function pruneStageRoutingsForStage(
  stage: Parameters<typeof pruneStageFieldRoutings>[1],
  options: Parameters<typeof pruneStageFieldRoutings>[2],
) {
  return pruneStageFieldRoutings(systemPrisma, stage, options);
}

export function detectFieldRoutingDriftNow() {
  return detectFieldRoutingDrift(systemPrisma);
}

export function deleteStageFieldRowsNow(args: Parameters<typeof deleteStageFieldRows>[1]) {
  return deleteStageFieldRows(systemPrisma, args);
}
