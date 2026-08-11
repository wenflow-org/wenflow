import type { PrismaClient } from '../generated/system-client';
import { randomUUID } from 'crypto';
import { getCanonicalAgentId, getAgentManifest } from './agent-manifest.service';
import {
  loadOrchestrationFiles,
  type OrchestrationStage
} from './field-routing/orchestration-file';
import { writeNodeConfigChange } from './node-config-change-audit';

// 编排文件（prompts/orchestration/<stage>.yaml）是字段路由的唯一声明源；
// seed-*-field-routings.ts 已退役（2026-08 单源化收尾），编排文件为唯一编辑入口。
const ORCHESTRATION_STAGES: OrchestrationStage[] = loadOrchestrationFiles();

const contractGroups = ORCHESTRATION_STAGES.map((stage) => stage.contracts);
const fieldGroups = ORCHESTRATION_STAGES.map((stage) => stage.fields);
const routingGroups = ORCHESTRATION_STAGES.map((stage) => stage.routings);

export const FIELD_ROUTING_SEED_MANIFEST = {
  contractAgentIds: contractGroups.flat().map(item => item.agentId),
  fieldIds: fieldGroups.flat().map(item => item.fieldId),
  routings: routingGroups.flat().map(item => ({ agentId: item.agentId, fieldId: item.fieldId }))
};

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} seed 定义存在重复键`);
}

assertUnique(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds, 'agent_contracts');
// fieldId 唯一约束为 stage 内唯一：逐 stage 去重；跨 stage 允许同名（如 teaching/simulation 的 reply）。
// FIELD_ROUTING_SEED_MANIFEST.fieldIds 保持全局展平（readiness 数量用，重名在 in 查询中无害）。
for (const stage of ORCHESTRATION_STAGES) {
  assertUnique(
    stage.fields.map((f) => f.fieldId),
    `field_definitions@${stage.stage}`,
  );
}
assertUnique(
  FIELD_ROUTING_SEED_MANIFEST.routings.map(item => `${item.agentId}\0${item.fieldId}`),
  'agent_field_routings'
);

// ============================================================
// Seed 语义校验（启动 fail-fast）
// 1. handoff 取值白名单：skill:<id>（manifest 存在）｜<stage>-agent（manifest agent）｜阶段名
// 2. render/internal/accumulate 组合语义
// 3. 自环 handoff 拒绝
// ============================================================

// 阶段词表：goal/path/teaching/profile/simulation（2026-08 单源化补全 simulation）
const STAGE_NAMES = new Set(ORCHESTRATION_STAGES.map((stage) => stage.stage));

function validateHandoffTarget(target: string, key: string, errors: string[]) {
  const canonical = getCanonicalAgentId(target);
  if (target === canonical && STAGE_NAMES.has(target)) return; // 阶段名
  const entry = getAgentManifest(canonical);
  if (entry) return; // manifest 中存在的 skill 或 agent
  errors.push(`[field-routing] ${key} 的 handoff 目标 "${target}" 不在 manifest（也不是阶段名 ${[...STAGE_NAMES].join('/')}）`);
}

export interface SeedRoutingLike {
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
}

// 路由行 → 所属 stage / (stage, fieldId) → 字段定义 的查表（跨 stage 同名按 stage 区分）
const routingKeyToStage = new Map<string, string>();
const fieldByStageAndId = new Map<string, { fieldId: string; promptRole: string }>();
for (const s of ORCHESTRATION_STAGES) {
  for (const r of s.routings) routingKeyToStage.set(`${r.agentId}\0${r.fieldId}`, s.stage);
  for (const f of s.fields) fieldByStageAndId.set(`${s.stage}\0${f.fieldId}`, { fieldId: f.fieldId, promptRole: f.promptRole });
}

export function validateFieldRoutingSeedSemantics(
  routingsOverride?: SeedRoutingLike[]
): string[] {
  const errors: string[] = [];
  const allRoutings: SeedRoutingLike[] = routingsOverride || (routingGroups.flat() as SeedRoutingLike[]);

  for (const routing of allRoutings) {
    const key = `${routing.agentId}\0${routing.fieldId}`;
    // 优先按 (stage, fieldId) 取字段元数据；override 行查不到时回退全局展平（历史行为）
    const stage = routingKeyToStage.get(key);
    const field = (stage && fieldByStageAndId.get(`${stage}\0${routing.fieldId}`))
      ?? fieldGroups.flat().find((f) => f.fieldId === routing.fieldId);
    if (routing.handoff.includes(routing.agentId)) {
      errors.push(`[field-routing] ${key} handoff 自环（指向自身 ${routing.agentId}）`);
    }
    for (const target of routing.handoff) {
      validateHandoffTarget(target, key, errors);
    }
    if (routing.render === 'visible' && routing.internal) {
      // visible+internal 仅允许 control-signal 类（UI 进度条），宽松放行但记录约束来源
      if (field?.promptRole !== 'control-signal') {
        errors.push(`[field-routing] ${key} render=visible 与 internal=true 组合仅允许 control-signal 字段（${routing.fieldId} 是 ${field?.promptRole || 'unknown'}）`);
      }
    }
    if (routing.handoff.length === 0 && !routing.internal && !routing.accumulate && routing.render === 'visible') {
      // 对话终点（public-reply）合法；画像终点为 internal+accumulate；其余无流转终点需要备注说明
      if (field?.promptRole !== 'public-reply') {
        errors.push(`[field-routing] ${key} handoff 为空且非 public-reply/画像终点（internal+accumulate），缺少流转去向`);
      }
    }
  }

  return errors;
}

const FIELD_ROUTING_SEED_SEMANTIC_ERRORS = validateFieldRoutingSeedSemantics();
if (FIELD_ROUTING_SEED_SEMANTIC_ERRORS.length > 0) {
  throw new Error(`字段路由 seed 语义校验失败：\n${FIELD_ROUTING_SEED_SEMANTIC_ERRORS.join('\n')}`);
}

export interface FieldRoutingBootstrapDependencies {
  database: PrismaClient;
  /** 测试注入：覆盖编排文件数据 */
  stagesOverride?: OrchestrationStage[];
}

export interface FieldRoutingBootstrapResult {
  fieldsCreated: number;
  fieldsSkipped: number;
  contractsCreated: number;
  contractsSkipped: number;
  routingsCreated: number;
  routingsSkipped: number;
}

/** 通用 ensure：按编排文件数据对单个阶段执行三表 upsert（update:{} 只建不更新） */
export async function ensureStageFieldRoutings(
  systemPrisma: PrismaClient,
  stage: OrchestrationStage
): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of stage.contracts) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({
      where: { agentId: c.agentId },
      update: {},
      create: {
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
    if (exists) {
      result.contractsSkipped++;
    } else {
      result.contractsCreated++;
    }
  }

  for (const f of stage.fields) {
    const exists = await systemPrisma.field_definitions.findFirst({ where: { stage: stage.stage, fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({
      where: { stage_fieldId: { stage: stage.stage, fieldId: f.fieldId } },
      update: {},
      create: {
        id: randomUUID(),
        fieldId: f.fieldId,
        stage: stage.stage,
        promptRole: f.promptRole,
        valueType: f.valueType,
        snakeName: f.snakeName ?? null,
        camelName: f.camelName ?? null,
        pathInRawOutput: f.pathInRawOutput ?? null,
        persistKey: f.persistKey ?? null,
        description: f.description,
        enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null,
        systemLocked: f.systemLocked ?? false,
        structureLocked: f.structureLocked ?? false,
        bindings: f.bindings ? JSON.stringify(f.bindings) : null,
      },
    });
    if (exists) {
      result.fieldsSkipped++;
    } else {
      result.fieldsCreated++;
    }
  }

  for (const r of stage.routings) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({
      where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } },
      update: {},
      create: {
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
    if (exists) {
      result.routingsSkipped++;
    } else {
      result.routingsCreated++;
    }
  }

  return result;
}

export async function bootstrapFieldRoutings(dependencies: FieldRoutingBootstrapDependencies) {
  const stages = dependencies.stagesOverride || ORCHESTRATION_STAGES;
  const results: Record<string, FieldRoutingBootstrapResult> = {};
  for (const stage of stages) {
    results[stage.stage] = await ensureStageFieldRoutings(dependencies.database, stage);
  }
  return results;
}

// ============================================================
// 全量对账（文件为准，立即生效）：三表 upsert(update: 全部业务列)
//
// 单一实现，三处消费（禁止复制逻辑）：
// - POST /api/admin/field-routings/orchestration/:stage/sync
// - scripts/field-routing-orchestration-sync.ts（CLI）
// - health-center 一键修复 field-routing
// admin 覆盖行（managedByCode=false）跳过更新并记入 skipped 清单；
// 不删除任何行（孤儿行维度不在本对账范围）。
// ============================================================

export interface FieldRoutingFullSyncReport {
  stage: string;
  contractsUpdated: number;
  fieldsUpdated: number;
  routingsUpdated: number;
  contractsCreated: number;
  fieldsCreated: number;
  routingsCreated: number;
  /** 三表新增合计（route 响应兼容口径） */
  createdCount: number;
  skippedAdminRows: Array<{ table: string; key: string }>;
}

export async function syncStageFieldRoutingsFromFile(
  prisma: PrismaClient,
  stage: OrchestrationStage,
): Promise<FieldRoutingFullSyncReport> {
  const report: FieldRoutingFullSyncReport = {
    stage: stage.stage,
    contractsUpdated: 0,
    fieldsUpdated: 0,
    routingsUpdated: 0,
    contractsCreated: 0,
    fieldsCreated: 0,
    routingsCreated: 0,
    createdCount: 0,
    skippedAdminRows: [],
  };

  for (const c of stage.contracts) {
    const exists = await prisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'agent_contracts', key: c.agentId });
        continue;
      }
      await prisma.agent_contracts.update({
        where: { agentId: c.agentId },
        data: { stage: stage.stage, displayName: c.displayName, description: c.description, updatedAt: new Date() },
      });
      report.contractsUpdated++;
    } else {
      await prisma.agent_contracts.create({
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
      report.createdCount++;
    }
  }

  for (const f of stage.fields) {
    const exists = await prisma.field_definitions.findFirst({ where: { stage: stage.stage, fieldId: f.fieldId } });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'field_definitions', key: `${stage.stage}/${f.fieldId}` });
        continue;
      }
      await prisma.field_definitions.update({
        where: { stage_fieldId: { stage: stage.stage, fieldId: f.fieldId } },
        data: {
          stage: stage.stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          persistKey: f.persistKey ?? null,
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
      await prisma.field_definitions.create({
        data: {
          id: randomUUID(),
          fieldId: f.fieldId,
          stage: stage.stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          persistKey: f.persistKey ?? null,
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
      report.createdCount++;
    }
  }

  for (const r of stage.routings) {
    const where = { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } };
    const exists = await prisma.agent_field_routings.findUnique({ where });
    if (exists) {
      if (exists.managedByCode === false) {
        report.skippedAdminRows.push({ table: 'agent_field_routings', key: `${r.agentId}/${r.fieldId}` });
        continue;
      }
      await prisma.agent_field_routings.update({
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
      await prisma.agent_field_routings.create({
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
      report.createdCount++;
    }
  }

  return report;
}

// ============================================================
// 孤儿行清理（prune）：编排文件为唯一声明源，声明删除 → DB 行应消失
//
// 设计（P2 补全，AUDIT_CHANGEABILITY §七.5 缺口）：
//   - 只删 managedByCode=true 的行；managedByCode=false（admin 覆盖行）任何情况下
//     不删，仅记入 protectedRows 报告（硬性约束）。
//   - 全局声明集保护：某行若仍在任意编排文件（含其他 stage）声明，不视为孤儿。
//   - 默认 dry-run（只报告不删）；dryRun=false 才执行删除，删除前逐行写
//     node_config_changes 审计（changeType='orchestration-prune'，before=被删行全量）。
//   - 行归属：contracts/fields 按 stage 列归属；routings 无 stage 列，按
//     agentId ∈ 本 stage 声明契约 ∨ fieldId ∈ 本 stage 声明字段 ∨ agentId ∈
//     本 stage 待删契约 判定归属（覆盖"整契约+其路由一起删"的场景）。
// ============================================================

export interface StagePruneCandidate {
  table: 'agent_contracts' | 'field_definitions' | 'agent_field_routings';
  key: string;
  /** 被删行全量（审计 before 与响应清单的数据源） */
  row: Record<string, any>;
}

export interface StagePruneReport {
  stage: string;
  /** true = 只报告不删（默认）；false = 已执行删除 */
  dryRun: boolean;
  candidates: StagePruneCandidate[];
  /** managedByCode=false 覆盖行（候选但受保护，仅报告不删） */
  protectedRows: Array<{ table: string; key: string }>;
  deletedCount: number;
  auditIds: string[];
}

export async function pruneStageFieldRoutings(
  prisma: PrismaClient,
  stage: OrchestrationStage,
  options: { dryRun?: boolean; actorId?: string } = {},
): Promise<StagePruneReport> {
  const dryRun = options.dryRun !== false;
  const report: StagePruneReport = {
    stage: stage.stage,
    dryRun,
    candidates: [],
    protectedRows: [],
    deletedCount: 0,
    auditIds: [],
  };

  // 全局声明集（防止把其他 stage 文件仍声明的行当孤儿删掉）
  const declaredContractAgentIds = new Set(
    ORCHESTRATION_STAGES.flatMap((s) => s.contracts.map((c) => c.agentId)),
  );
  const declaredFieldKeys = new Set(
    ORCHESTRATION_STAGES.flatMap((s) => s.fields.map((f) => `${s.stage}\0${f.fieldId}`)),
  );
  const declaredRoutingKeys = new Set(
    ORCHESTRATION_STAGES.flatMap((s) => s.routings.map((r) => `${r.agentId}\0${r.fieldId}`)),
  );
  const stageContractIds = new Set(stage.contracts.map((c) => c.agentId));
  const stageFieldIds = new Set(stage.fields.map((f) => f.fieldId));

  // 1) agent_contracts：stage 归属本阶段 + 不在任何文件声明
  const contracts = await prisma.agent_contracts.findMany({ where: { stage: stage.stage } });
  const orphanContractIds = new Set<string>();
  for (const row of contracts) {
    if (declaredContractAgentIds.has(row.agentId)) continue;
    if (row.managedByCode === false) {
      report.protectedRows.push({ table: 'agent_contracts', key: row.agentId });
      continue;
    }
    orphanContractIds.add(row.agentId);
    report.candidates.push({ table: 'agent_contracts', key: row.agentId, row: { ...row } });
  }

  // 2) field_definitions：（stage, fieldId）复合键不在任何文件声明
  const fields = await prisma.field_definitions.findMany({ where: { stage: stage.stage } });
  for (const row of fields) {
    const key = `${stage.stage}\0${row.fieldId}`;
    if (declaredFieldKeys.has(key)) continue;
    if (row.managedByCode === false) {
      report.protectedRows.push({ table: 'field_definitions', key: `${stage.stage}/${row.fieldId}` });
      continue;
    }
    report.candidates.push({ table: 'field_definitions', key, row: { ...row } });
  }

  // 3) agent_field_routings：键不在任何文件声明，且归属本 stage
  const routingOwners = [...new Set([...stageContractIds, ...orphanContractIds])];
  const routingRows = await prisma.agent_field_routings.findMany({
    where: {
      OR: [
        ...(routingOwners.length > 0 ? [{ agentId: { in: routingOwners } }] : []),
        ...(stageFieldIds.size > 0 ? [{ fieldId: { in: [...stageFieldIds] } }] : []),
      ],
    },
  });
  for (const row of routingRows) {
    const key = `${row.agentId}\0${row.fieldId}`;
    if (declaredRoutingKeys.has(key)) continue;
    const ownsStage = stageContractIds.has(row.agentId) || stageFieldIds.has(row.fieldId) || orphanContractIds.has(row.agentId);
    if (!ownsStage) continue;
    if (row.managedByCode === false) {
      report.protectedRows.push({ table: 'agent_field_routings', key: `${row.agentId}/${row.fieldId}` });
      continue;
    }
    report.candidates.push({ table: 'agent_field_routings', key, row: { ...row } });
  }

  // 4) 执行：逐行先写审计（before=被删行全量）再删除；dry-run 不删不写
  if (!dryRun) {
    for (const candidate of report.candidates) {
      const auditId = await writeNodeConfigChange(prisma, {
        changeType: 'orchestration-prune',
        targetTable: 'orchestration',
        targetId: stage.stage,
        agentId: candidate.table === 'agent_field_routings' || candidate.table === 'agent_contracts'
          ? String(candidate.row.agentId ?? '')
          : undefined,
        fieldId: candidate.table === 'field_definitions' || candidate.table === 'agent_field_routings'
          ? String(candidate.row.fieldId ?? '')
          : undefined,
        before: candidate.row,
        after: null,
        actorId: options.actorId,
        reason: 'orchestration prune（编排文件声明删除 → DB 孤儿行清理）',
      });
      report.auditIds.push(auditId);

      if (candidate.table === 'agent_contracts') {
        await prisma.agent_contracts.delete({ where: { agentId: candidate.row.agentId } });
      } else if (candidate.table === 'field_definitions') {
        await prisma.field_definitions.delete({
          where: { stage_fieldId: { stage: stage.stage, fieldId: candidate.row.fieldId } },
        });
      } else {
        await prisma.agent_field_routings.delete({
          where: { agentId_fieldId: { agentId: candidate.row.agentId, fieldId: candidate.row.fieldId } },
        });
      }
      report.deletedCount += 1;
    }
  }

  return report;
}

// ============================================================
// 编排文件声明漂移检测（只读 diff）
//
// bootstrap 的 upsert(update:{}) 语义是"只建不更新"——编排文件声明改动后
// DB 已有行不会自动更新（保留 admin 编辑）。本检测对比编排文件声明与
// DB 行内容，让"声明一套、库里另一套"的漂移可见。
// 规则：managedByCode=true 的行参与 diff；admin 创建/改过的行跳过。
// ============================================================

export interface FieldRoutingDriftItem {
  kind: 'contract' | 'field' | 'routing';
  key: string;
  field: string;
  seedValue: unknown;
  dbValue: unknown;
}

export interface FieldRoutingDriftReport {
  driftCount: number;
  items: FieldRoutingDriftItem[];
}

type SystemDbLike = {
  agent_contracts: {
    findMany(args?: any): Promise<Array<Record<string, any>>>;
  };
  field_definitions: {
    findMany(args?: any): Promise<Array<Record<string, any>>>;
  };
  agent_field_routings: {
    findMany(args?: any): Promise<Array<Record<string, any>>>;
  };
};

function normalizeDriftValue(value: unknown): unknown {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (value === null || value === undefined) return null;
  return value;
}

export async function detectFieldRoutingDrift(systemDb: SystemDbLike): Promise<FieldRoutingDriftReport> {
  const [declaredContracts, declaredRoutings] = [
    contractGroups.flat(),
    routingGroups.flat(),
  ];
  const [dbContracts, dbFields, dbRoutings] = await Promise.all([
    systemDb.agent_contracts.findMany(),
    systemDb.field_definitions.findMany(),
    systemDb.agent_field_routings.findMany(),
  ]);

  const items: FieldRoutingDriftItem[] = [];

  const dbContractMap = new Map(dbContracts.map((row) => [row.agentId, row]));
  for (const declared of declaredContracts) {
    const db = dbContractMap.get(declared.agentId);
    if (!db) continue; // 缺失由 readiness 数量检查覆盖
    if (db.managedByCode === false) continue; // admin 全权行跳过
    if (JSON.stringify(normalizeDriftValue(declared.displayName)) !== JSON.stringify(normalizeDriftValue(db.displayName))) {
      items.push({ kind: 'contract', key: declared.agentId, field: 'displayName', seedValue: declared.displayName, dbValue: db.displayName });
    }
    if (JSON.stringify(normalizeDriftValue(declared.description)) !== JSON.stringify(normalizeDriftValue(db.description))) {
      items.push({ kind: 'contract', key: declared.agentId, field: 'description', seedValue: declared.description, dbValue: db.description });
    }
  }

  // 字段按 (stage, fieldId) 复合键对账：跨 stage 同名时互不覆盖（2026-08 单源化收尾）
  const declaredFieldRows = ORCHESTRATION_STAGES.flatMap((s) =>
    s.fields.map((f) => ({ stage: s.stage, ...f })),
  );
  const dbFieldMap = new Map(dbFields.map((row) => [`${row.stage}\0${row.fieldId}`, row]));
  for (const declared of declaredFieldRows) {
    const db = dbFieldMap.get(`${declared.stage}\0${declared.fieldId}`);
    if (!db) continue;
    if (db.managedByCode === false) continue;
    const pairs: Array<[string, unknown, unknown]> = [
      ['promptRole', declared.promptRole, db.promptRole],
      ['valueType', declared.valueType, db.valueType],
      ['snakeName', declared.snakeName ?? null, db.snakeName ?? null],
      ['camelName', declared.camelName ?? null, db.camelName ?? null],
      ['systemLocked', declared.systemLocked ?? false, db.systemLocked ?? false],
      ['structureLocked', declared.structureLocked ?? false, db.structureLocked ?? false],
      // pathInRawOutput 是配置式值抽取的依据，编排文件声明与 DB 不一致会导致
      // assemble* 抽取静默跑偏，必须纳入漂移检测（2026-08 补强）
      ['pathInRawOutput', declared.pathInRawOutput ?? null, db.pathInRawOutput ?? null],
      // persistKey 是落库键标注，声明与 DB 不一致会让"落库"列误导运营，纳入检测
      ['persistKey', declared.persistKey ?? null, db.persistKey ?? null],
      ['description', declared.description ?? null, db.description ?? null],
      ['bindings', declared.bindings ? JSON.stringify(declared.bindings) : null, db.bindings ?? null],
    ];
    for (const [field, seedValue, dbValue] of pairs) {
      if (JSON.stringify(seedValue ?? null) !== JSON.stringify(dbValue ?? null)) {
        // key 带 stage 前缀（跨 stage 同名可区分，admin drift 页 stage 过滤可命中）
        items.push({ kind: 'field', key: `${declared.stage}/${declared.fieldId}`, field, seedValue: seedValue ?? null, dbValue: dbValue ?? null });
      }
    }
  }

  const dbRoutingMap = new Map(dbRoutings.map((row) => [`${row.agentId}\0${row.fieldId}`, row]));
  for (const declared of declaredRoutings) {
    const key = `${declared.agentId}\0${declared.fieldId}`;
    const db = dbRoutingMap.get(key);
    if (!db) continue;
    if (db.managedByCode === false) continue; // admin 改过的行跳过
    const declaredHandoff = declared.handoff.length ? JSON.stringify(declared.handoff) : null;
    const dbHandoff = db.handoff ?? null;
    if (declaredHandoff !== dbHandoff) {
      items.push({ kind: 'routing', key, field: 'handoff', seedValue: declared.handoff, dbValue: db.handoff });
    }
    const pairs: Array<[string, unknown, unknown]> = [
      ['render', declared.render, db.render],
      ['internalFlag', declared.internal, !!db.internalFlag],
      ['accumulate', declared.accumulate, !!db.accumulate],
      ['visibilityPreset', declared.visibilityPreset ?? null, db.visibilityPreset ?? null],
    ];
    for (const [field, seedValue, dbValue] of pairs) {
      if (JSON.stringify(seedValue ?? null) !== JSON.stringify(dbValue ?? null)) {
        items.push({ kind: 'routing', key, field, seedValue: seedValue ?? null, dbValue: dbValue ?? null });
      }
    }
  }

  return { driftCount: items.length, items };
}
