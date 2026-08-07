import type { PrismaClient } from '../generated/system-client';
import { getCanonicalAgentId, getAgentManifest } from './agent-manifest.service';
import {
  ensureGoalFieldRoutings,
  GOAL_FIELD_ROUTING_CONTRACTS,
  GOAL_FIELD_ROUTING_FIELDS,
  GOAL_FIELD_ROUTINGS
} from '../scripts/seed-goal-field-routings';
import {
  ensurePathFieldRoutings,
  PATH_FIELD_ROUTING_CONTRACTS,
  PATH_FIELD_ROUTING_FIELDS,
  PATH_FIELD_ROUTINGS
} from '../scripts/seed-path-field-routings';
import {
  ensureTeachingFieldRoutings,
  TEACHING_FIELD_ROUTING_CONTRACTS,
  TEACHING_FIELD_ROUTING_FIELDS,
  TEACHING_FIELD_ROUTINGS
} from '../scripts/seed-execution-field-routings';
import {
  ensureProfileFieldRoutings,
  PROFILE_FIELD_ROUTING_CONTRACTS,
  PROFILE_FIELD_ROUTING_FIELDS,
  PROFILE_FIELD_ROUTINGS
} from '../scripts/seed-learner-field-routings';

const contractGroups = [
  GOAL_FIELD_ROUTING_CONTRACTS,
  PATH_FIELD_ROUTING_CONTRACTS,
  TEACHING_FIELD_ROUTING_CONTRACTS,
  PROFILE_FIELD_ROUTING_CONTRACTS
];
const fieldGroups = [
  GOAL_FIELD_ROUTING_FIELDS,
  PATH_FIELD_ROUTING_FIELDS,
  TEACHING_FIELD_ROUTING_FIELDS,
  PROFILE_FIELD_ROUTING_FIELDS
];
const routingGroups = [
  GOAL_FIELD_ROUTINGS,
  PATH_FIELD_ROUTINGS,
  TEACHING_FIELD_ROUTINGS,
  PROFILE_FIELD_ROUTINGS
];

export const FIELD_ROUTING_SEED_MANIFEST = {
  contractAgentIds: contractGroups.flat().map(item => item.agentId),
  fieldIds: fieldGroups.flat().map(item => item.fieldId),
  routings: routingGroups.flat().map(item => ({ agentId: item.agentId, fieldId: item.fieldId }))
};

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} seed 定义存在重复键`);
}

assertUnique(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds, 'agent_contracts');
assertUnique(FIELD_ROUTING_SEED_MANIFEST.fieldIds, 'field_definitions');
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

const STAGE_NAMES = new Set(['goal', 'path', 'teaching', 'profile']);

function validateHandoffTarget(target: string, key: string, errors: string[]) {
  const canonical = getCanonicalAgentId(target);
  if (target === canonical && STAGE_NAMES.has(target)) return; // 阶段名
  const entry = getAgentManifest(canonical);
  if (entry) return; // manifest 中存在的 skill 或 agent
  errors.push(`[field-routing] ${key} 的 handoff 目标 "${target}" 不在 manifest（也不是阶段名 goal/path/teaching/profile）`);
}

export interface SeedRoutingLike {
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
}

export function validateFieldRoutingSeedSemantics(
  routingsOverride?: SeedRoutingLike[]
): string[] {
  const errors: string[] = [];
  const allRoutings: SeedRoutingLike[] = routingsOverride || (routingGroups.flat() as SeedRoutingLike[]);

  for (const routing of allRoutings) {
    const key = `${routing.agentId}\0${routing.fieldId}`;
    if (routing.handoff.includes(routing.agentId)) {
      errors.push(`[field-routing] ${key} handoff 自环（指向自身 ${routing.agentId}）`);
    }
    for (const target of routing.handoff) {
      validateHandoffTarget(target, key, errors);
    }
    if (routing.render === 'visible' && routing.internal) {
      // visible+internal 仅允许 control-signal 类（UI 进度条），宽松放行但记录约束来源
      const field = fieldGroups.flat().find((f) => f.fieldId === routing.fieldId);
      if (field?.promptRole !== 'control-signal') {
        errors.push(`[field-routing] ${key} render=visible 与 internal=true 组合仅允许 control-signal 字段（${routing.fieldId} 是 ${field?.promptRole || 'unknown'}）`);
      }
    }
    if (routing.handoff.length === 0 && !routing.internal && !routing.accumulate && routing.render === 'visible') {
      // 对话终点（public-reply）合法；画像终点为 internal+accumulate；其余无流转终点需要备注说明
      const field = fieldGroups.flat().find((f) => f.fieldId === routing.fieldId);
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
  ensureGoal?: typeof ensureGoalFieldRoutings;
  ensurePath?: typeof ensurePathFieldRoutings;
  ensureTeaching?: typeof ensureTeachingFieldRoutings;
  ensureProfile?: typeof ensureProfileFieldRoutings;
}

export async function bootstrapFieldRoutings(dependencies: FieldRoutingBootstrapDependencies) {
  const goal = await (dependencies.ensureGoal || ensureGoalFieldRoutings)(dependencies.database);
  const path = await (dependencies.ensurePath || ensurePathFieldRoutings)(dependencies.database);
  const teaching = await (dependencies.ensureTeaching || ensureTeachingFieldRoutings)(dependencies.database);
  const profile = await (dependencies.ensureProfile || ensureProfileFieldRoutings)(dependencies.database);
  return { goal, path, teaching, profile };
}

// ============================================================
// Seed 漂移检测（只读 diff）
//
// bootstrap 的 upsert(update:{}) 语义是"只建不更新"——seed 改动后
// DB 已有行不会自动更新（保留 admin 编辑）。本检测对比 seed 声明与
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
  const [seedContracts, seedFields, seedRoutings] = [
    contractGroups.flat(),
    fieldGroups.flat(),
    routingGroups.flat(),
  ];
  const [dbContracts, dbFields, dbRoutings] = await Promise.all([
    systemDb.agent_contracts.findMany(),
    systemDb.field_definitions.findMany(),
    systemDb.agent_field_routings.findMany(),
  ]);

  const items: FieldRoutingDriftItem[] = [];

  const dbContractMap = new Map(dbContracts.map((row) => [row.agentId, row]));
  for (const seed of seedContracts) {
    const db = dbContractMap.get(seed.agentId);
    if (!db) continue; // 缺失由 readiness 数量检查覆盖
    if (db.managedByCode === false) continue; // admin 全权行跳过
    if (JSON.stringify(normalizeDriftValue(seed.displayName)) !== JSON.stringify(normalizeDriftValue(db.displayName))) {
      items.push({ kind: 'contract', key: seed.agentId, field: 'displayName', seedValue: seed.displayName, dbValue: db.displayName });
    }
    if (JSON.stringify(normalizeDriftValue(seed.description)) !== JSON.stringify(normalizeDriftValue(db.description))) {
      items.push({ kind: 'contract', key: seed.agentId, field: 'description', seedValue: seed.description, dbValue: db.description });
    }
  }

  const dbFieldMap = new Map(dbFields.map((row) => [row.fieldId, row]));
  for (const seed of seedFields) {
    const db = dbFieldMap.get(seed.fieldId);
    if (!db) continue;
    if (db.managedByCode === false) continue;
    const pairs: Array<[string, unknown, unknown]> = [
      ['promptRole', seed.promptRole, db.promptRole],
      ['valueType', seed.valueType, db.valueType],
      ['snakeName', seed.snakeName ?? null, db.snakeName ?? null],
      ['camelName', seed.camelName ?? null, db.camelName ?? null],
      ['systemLocked', seed.systemLocked ?? false, db.systemLocked ?? false],
      ['structureLocked', seed.structureLocked ?? false, db.structureLocked ?? false],
    ];
    for (const [field, seedValue, dbValue] of pairs) {
      if (JSON.stringify(seedValue ?? null) !== JSON.stringify(dbValue ?? null)) {
        items.push({ kind: 'field', key: seed.fieldId, field, seedValue: seedValue ?? null, dbValue: dbValue ?? null });
      }
    }
  }

  const dbRoutingMap = new Map(dbRoutings.map((row) => [`${row.agentId}\0${row.fieldId}`, row]));
  for (const seed of seedRoutings) {
    const key = `${seed.agentId}\0${seed.fieldId}`;
    const db = dbRoutingMap.get(key);
    if (!db) continue;
    if (db.managedByCode === false) continue; // admin 改过的行跳过
    const seedHandoff = seed.handoff.length ? JSON.stringify(seed.handoff) : null;
    const dbHandoff = db.handoff ?? null;
    if (seedHandoff !== dbHandoff) {
      items.push({ kind: 'routing', key, field: 'handoff', seedValue: seed.handoff, dbValue: db.handoff });
    }
    const pairs: Array<[string, unknown, unknown]> = [
      ['render', seed.render, db.render],
      ['internalFlag', seed.internal, !!db.internalFlag],
      ['accumulate', seed.accumulate, !!db.accumulate],
      ['visibilityPreset', seed.visibilityPreset ?? null, db.visibilityPreset ?? null],
    ];
    for (const [field, seedValue, dbValue] of pairs) {
      if (JSON.stringify(seedValue ?? null) !== JSON.stringify(dbValue ?? null)) {
        items.push({ kind: 'routing', key, field, seedValue: seedValue ?? null, dbValue: dbValue ?? null });
      }
    }
  }

  return { driftCount: items.length, items };
}
