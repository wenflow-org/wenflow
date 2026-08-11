/**
 * 健康中心聚合服务（基准体系版，DRIFT_BASELINE_SURVEY.md §4/§5）
 *
 * 三分语义模型：
 * - baseline-drift（基准漂移）：镜像偏离唯一声明源，方向确定 → 可一键修复（仅 fixable 类）
 * - consistency（一致性偏差）：双向对等、无单方基准 → 只提示不自动修（409 + 人工指引）
 * - override-record（覆盖记录）：managedByCode=false 的 admin 覆盖行 → info 只读展示
 * - runtime-info（运行时观测）：prompt_call_logs.promptDrift 遥测 → info 只读展示
 *
 * 每项携带基准元数据（base/semantics），全部复用既有纯函数/装配函数，禁止复制逻辑：
 * - W4 coreHash：analyzeCoreHashParity（check-core-hash-parity.ts）
 * - W1/W2/W3/W4：analyzeSkillReadiness（skills-readiness.service.ts）
 * - fields-sync：analyzeCoreFieldsSync（check-core-fields-sync.ts）
 * - 字段路由漂移：detectFieldRoutingDrift（field-routing-bootstrap.service.ts），
 *   contract 维度独立成项（P4：declared 值经 deriveContract(manifest) 派生，真实基准为 manifest）
 * - 快照：checkAgentSnapshotsDrift / generateAgentSnapshotsContent（generate-agent-snapshots.ts）
 * - yaml 交叉：runYamlVocabularyCheck（check-yaml-vocabulary.ts）
 * - 契约 parity：analyzePromptRuntimeContractMetadataParity + 查询装配（check-prompt-runtime-contract-metadata-parity.ts）
 * - 参数一致性（P1 两写）：core params ↔ skills/<skill>/definition.ts（manifest runtimeDefaults
 *   已于 P0-1 废弃），只读比对（definition.ts 是代码声明，不可一键修）
 *
 * 修复（POST /fix，仅 semantics='baseline-drift' 且 action='fixable'）：
 * - w4-corehash：备份 skill.*.md → compileAllCorePromptFiles → ensureCoreAgentPrompts('sync')
 * - field-routing / field-routing-contract：syncStageFieldRoutingsFromFile 全量对账（跳过覆盖行）
 * - snapshots：备份 agent-snapshots.md → 重生成
 * 修复写 node_config_changes 审计（changeType='health-fix'，actorId），改 git 跟踪文件时响应注明需提交。
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { loadSkillsBookRaw } from './skill-registry/skills-file';
import { scanPromptFiles } from '../composers/prompt-files/loader';
import { scanCoreFiles, loadCoreFile, CORE_FILES_DIR } from './prompt-lab/core-file-loader';
import { analyzeCoreHashParity } from '../scripts/check-core-hash-parity';
import { analyzeSkillReadiness } from './skills-readiness.service';
import { analyzeCoreFieldsSync } from '../scripts/check-core-fields-sync';
import { detectFieldRoutingDrift } from './field-routing-bootstrap.service';
import {
  analyzePromptRuntimeContractMetadataParity,
  collectDeclaredPromptRuntimeContractAgentIdCandidates,
  queryActivePromptRuntimeContractMetadataRows,
} from '../scripts/check-prompt-runtime-contract-metadata-parity';
import { runYamlVocabularyCheck } from '../scripts/check-yaml-vocabulary';
import {
  AGENT_SNAPSHOTS_TARGET,
  checkAgentSnapshotsDrift,
  generateAgentSnapshotsContent,
} from '../scripts/generate-agent-snapshots';
import { loadOrchestrationFiles } from './field-routing/orchestration-file';
import { SKILL_RUNTIME_DEFINITIONS } from '../coordinators/definitions-registry';
import type { CoreAgentPromptEnsureResult } from '../scripts/seed-core-agent-prompts';
import type { FieldRoutingFullSyncReport } from './field-routing-bootstrap.service';

// ============================================================
// 类型（基准元数据 schema，DRIFT_BASELINE_SURVEY §4.1）
// ============================================================

export type HealthCenterBase =
  | 'file:core.yaml'        // 业务 SSOT（W4、yaml C1/C2、params P1）
  | 'file:manifest'         // 契约层（契约 parity、字段路由 contract 维度——P4 名实不符修正）
  | 'file:orchestration'    // 数据面（字段路由 field/routing 维度、快照）
  | 'file:skills.yaml'      // 户口簿（W1/W2，偏基准）
  | 'bidirectional'         // 无单方基准（fields-sync、W3）
  | 'db:managed'            // 覆盖层（managedByCode=false 行）
  | 'runtime';              // 运行时观测（prompt_call_logs.promptDrift）

export type HealthCenterSemantics = 'baseline-drift' | 'consistency' | 'override-record' | 'runtime-info';

export type HealthSeverity = 'ok' | 'warn' | 'error' | 'info';

export type HealthCenterAction = 'fixable' | 'manual' | 'none';

export interface HealthCenterItem {
  id: string;
  label: string;
  /** 基准元数据：谁是真源 */
  base: HealthCenterBase;
  /** 语义分级：决定修复语义 */
  semantics: HealthCenterSemantics;
  severity: HealthSeverity;
  status: string;
  count: number;
  detail: string[];
  cause: string;
  action: HealthCenterAction;
  fixHint: string;
  source: string;
}

export interface HealthCenterSummary {
  total: number;
  baselineDrift: number;
  consistency: number;
  overrideRecord: number;
  fixable: number;
}

export interface HealthCenterReport {
  generatedAt: string;
  summary: HealthCenterSummary;
  items: HealthCenterItem[];
}

export interface HealthCenterDbAdapter {
  agent_prompts: {
    findMany: (args?: any) => Promise<any[]>;
  };
  skill_registrations: {
    findMany: (args?: any) => Promise<Array<{ name: string }>>;
  };
  agent_contracts: { findMany: (args?: any) => Promise<Array<Record<string, any>>> };
  field_definitions: { findMany: (args?: any) => Promise<Array<Record<string, any>>> };
  agent_field_routings: { findMany: (args?: any) => Promise<Array<Record<string, any>>> };
  node_config_changes: {
    create: (args: any) => Promise<unknown>;
  };
  /** 运行时 prompt 漂移遥测（主库 prompt_call_logs）；缺省时 runtime 项标记不可用 */
  prompt_call_logs?: {
    findMany: (args?: any) => Promise<Array<{ agentId: string; createdAt?: Date | string | null }>>;
  };
}

// ============================================================
// P1 参数一致性（只读比对，纯函数 + fs 装配）
// ============================================================

export interface ParamsConsistencyRow {
  skillId: string;
  core: { temperature: number; maxTokens: number } | null;
  definition: { defaultTemperature?: number; defaultMaxTokens?: number } | null;
}

export interface ParamsConsistencyMismatch {
  skillId: string;
  field: 'temperature' | 'maxTokens';
  core: number | null;
  definition: number | null | undefined;
}

export interface ParamsConsistencyResult {
  mismatches: ParamsConsistencyMismatch[];
  /** definition.ts 未声明 defaultTemperature/defaultMaxTokens（或整个 definition 缺失）——只注明，不视为漂移 */
  missingDeclarations: string[];
}

/**
 * P1 两写比对：core params（真源）↔ skills/<skill>/definition.ts defaultTemperature/
 * defaultMaxTokens（展示权威）。manifest runtimeDefaults 已于 P0-1 废弃（参数唯一写源 = core）。
 * 任一已声明处与其他处不一致即 mismatch；definition.ts 缺声明只注明。
 */
export function analyzeParamsConsistency(rows: ParamsConsistencyRow[]): ParamsConsistencyResult {
  const mismatches: ParamsConsistencyMismatch[] = [];
  const missingDeclarations: string[] = [];

  for (const row of rows) {
    if (!row.core) continue;
    const def = row.definition;
    if (!def) {
      missingDeclarations.push(`${row.skillId}：definition.ts 缺失（无 defaultTemperature/defaultMaxTokens）`);
    } else {
      const missing: string[] = [];
      if (def.defaultTemperature === undefined) missing.push('defaultTemperature');
      if (def.defaultMaxTokens === undefined) missing.push('defaultMaxTokens');
      if (missing.length > 0) missingDeclarations.push(`${row.skillId}：definition.ts 未声明 ${missing.join('/')}`);
    }
    if (!def) continue;

    for (const field of ['temperature', 'maxTokens'] as const) {
      const coreValue = row.core[field];
      const defValue = field === 'temperature' ? def.defaultTemperature : def.defaultMaxTokens;
      const declared: Array<[string, number | undefined | null]> = [
        ['core', coreValue],
        ['definition', defValue],
      ];
      const declaredValues = declared.filter(([, value]) => typeof value === 'number') as Array<[string, number]>;
      if (declaredValues.length < 2) continue;
      const first = declaredValues[0][1];
      const diverging = declaredValues.filter(([, value]) => value !== first);
      if (diverging.length > 0) {
        mismatches.push({
          skillId: row.skillId,
          field,
          core: coreValue,
          definition: defValue,
        });
      }
    }
  }

  return { mismatches, missingDeclarations: [...new Set(missingDeclarations)].sort() };
}

/** fs 装配：core 扫描 + SKILL_RUNTIME_DEFINITIONS 注册表 → 纯函数比对（P1 两写：manifest runtimeDefaults 已废弃） */
export function buildParamsConsistencyCheck(): ParamsConsistencyResult {
  const { files: cores } = scanCoreFiles();
  const definitions = new Map<string, { defaultTemperature?: number; defaultMaxTokens?: number }>();
  for (const def of SKILL_RUNTIME_DEFINITIONS) {
    const skillId = String(def.id || '').replace(/^skill:/, '').trim();
    if (!skillId) continue;
    definitions.set(skillId, {
      defaultTemperature: def.defaultTemperature,
      defaultMaxTokens: def.defaultMaxTokens,
    });
  }
  return analyzeParamsConsistency(
    cores.map((core) => ({
      skillId: core.skillId,
      core: { temperature: core.params.temperature, maxTokens: core.params.maxTokens },
      definition: definitions.get(core.skillId) ?? null,
    })),
  );
}

// ============================================================
// 聚合（GET /api/admin/health-center）
// ============================================================

function buildItem(
  id: string,
  fields: Omit<HealthCenterItem, 'id'>,
): HealthCenterItem {
  return { id, ...fields };
}

export async function buildHealthCenterReport(db: HealthCenterDbAdapter): Promise<HealthCenterReport> {
  const scan = scanPromptFiles();
  const book = loadSkillsBookRaw();

  const [activeRows, registrations, driftReport, parityActiveRows, overrideRows, runtimeDriftRows] = await Promise.all([
    db.agent_prompts.findMany({
      where: { status: 'ACTIVE' },
      select: { agentId: true, metadata: true, coreHash: true, coreVersion: true },
    }),
    db.skill_registrations.findMany({ select: { name: true, updatedAt: true } }),
    detectFieldRoutingDrift(db),
    queryActivePromptRuntimeContractMetadataRows(
      db,
      collectDeclaredPromptRuntimeContractAgentIdCandidates(scan.files),
    ),
    Promise.all([
      db.agent_contracts.findMany({ where: { managedByCode: false } }),
      db.field_definitions.findMany({ where: { managedByCode: false } }),
      db.agent_field_routings.findMany({ where: { managedByCode: false } }),
    ]),
    (async () => {
      try {
        if (!db.prompt_call_logs?.findMany) {
          return { rows: [], note: 'prompt_call_logs 适配器未提供（运行时遥测不可用）' };
        }
        const rows = await db.prompt_call_logs.findMany({
          where: { promptDrift: true },
          select: { agentId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        return { rows, note: null };
      } catch (error) {
        return {
          rows: [],
          note: `prompt_call_logs 查询失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    })(),
  ]);

  // W4：复用 core-hash-parity 分析层（同一漂移口径，单一实现）
  const parityReport = analyzeCoreHashParity({
    files: scan.files,
    activeRows,
    loadCore: (skillId) => loadCoreFile(skillId),
    diagnostics: scan.diagnostics,
  });

  // W1-W5：复用 skills-readiness 纯分析层（同一报告，不重复扫描/查询）
  const readiness = analyzeSkillReadiness({ book, activeRows, registrations, parityReport });

  // fields-sync：复用 analyzeCoreFieldsSync 纯函数
  const fieldsSyncReports = analyzeCoreFieldsSync(loadOrchestrationFiles(), book.skills);

  // 契约 parity：复用 analyzePromptRuntimeContractMetadataParity 纯函数
  const contractParity = analyzePromptRuntimeContractMetadataParity({
    files: scan.files,
    activeRows: parityActiveRows,
    diagnostics: scan.diagnostics,
  });

  // 快照 / yaml 交叉 / P1 参数两写
  const [snapshotCheck, yamlCheck, paramsCheck] = await Promise.all([
    checkAgentSnapshotsDrift(),
    Promise.resolve(runYamlVocabularyCheck()),
    Promise.resolve(buildParamsConsistencyCheck()),
  ]);

  // ---- 字段路由漂移拆两维度（P4 名实不符：contract 维度真实基准为 manifest） ----
  const contractDrift = driftReport.items.filter((item) => item.kind === 'contract');
  const fieldRoutingDrift = driftReport.items.filter((item) => item.kind !== 'contract');
  const formatDrift = (items: typeof driftReport.items): string[] =>
    items
      .slice(0, 20)
      .map((d) => `${d.kind} ${d.key} .${d.field}：声明=${JSON.stringify(d.seedValue)} ≠ DB=${JSON.stringify(d.dbValue)}`);

  // ---- 逐项组装 ----
  const w1 = readiness.checks.W1;
  const w2 = readiness.checks.W2;
  const w3 = readiness.checks.W3;
  const w4 = readiness.checks.W4;
  const parityResultByAgent = new Map(parityReport.results.map((r) => [r.agentId, r]));
  const w4Detail = w4.drifted.map((agentId) => {
    const result = parityResultByAgent.get(agentId);
    return `${agentId} status=${result?.status || 'drifted'}${result?.detail ? `：${result.detail}` : ''}`;
  });

  const fieldsSyncMissing = fieldsSyncReports.flatMap((r) => r.missing);
  const fieldsSyncOrphans = fieldsSyncReports.flatMap((r) => r.orphan);
  const fieldsSyncTypeMismatch = fieldsSyncReports.flatMap((r) => r.typeMismatch);

  const overrideRowsAll = [...overrideRows[0], ...overrideRows[1], ...overrideRows[2]];
  const overrideDetail = overrideRowsAll.slice(0, 30).map((row) => {
    const key = row.agentId ?? `${row.stage ?? ''}/${row.fieldId ?? ''}`;
    const table =
      row.agentId !== undefined && row.displayName !== undefined
        ? 'agent_contracts'
        : row.stage !== undefined && row.fieldId !== undefined
          ? 'field_definitions'
          : 'agent_field_routings';
    return `${table} ${String(key)}`;
  });

  const items: HealthCenterItem[] = [
    // ============ baseline-drift（基准漂移，单向，可一键修复或人工） ============
    buildItem('w4-corehash', {
      label: 'W4 coreHash（core → 产物 → DB）',
      base: 'file:core.yaml',
      semantics: 'baseline-drift',
      severity: w4.drifted.length > 0 ? 'error' : 'ok',
      status: w4.drifted.length > 0 ? 'drifted' : 'clean',
      count: w4.drifted.length,
      detail: w4Detail,
      cause: '核心文件（core.yaml）已改动，但编译产物与数据库 ACTIVE 版本没跟着更新——线上仍在跑旧版 prompt',
      action: 'fixable',
      fixHint: '点此一键修复：自动重新编译产物并同步数据库；若产物是代码库跟踪文件，完成后需提交代码',
      source: 'check-core-hash-parity.ts + compile-core-files.ts + seed-core-agent-prompts.ts',
    }),
    buildItem('field-routing-contract', {
      label: '字段路由合同维度（P4：declared 来自 deriveContract(manifest)）',
      base: 'file:manifest',
      semantics: 'baseline-drift',
      severity: contractDrift.length > 0 ? 'error' : 'ok',
      status: contractDrift.length > 0 ? 'drifted' : 'clean',
      count: contractDrift.length,
      detail: formatDrift(contractDrift),
      cause: '契约名称来源标注有误：该检查名义是"编排文件 vs 数据库"，实际以 manifest（契约文件）为基准比对',
      action: 'fixable',
      fixHint: '点此一键修复：按 manifest 契约基准全量对账数据库（admin 手工改过的行自动跳过保护）',
      source: 'field-routing-bootstrap.service.ts（detectFieldRoutingDrift kind=contract）',
    }),
    buildItem('field-routing', {
      label: '字段路由（field/routing 维度）',
      base: 'file:orchestration',
      semantics: 'baseline-drift',
      severity: fieldRoutingDrift.length > 0 ? 'error' : 'ok',
      status: fieldRoutingDrift.length > 0 ? 'drifted' : 'clean',
      count: fieldRoutingDrift.length,
      detail: formatDrift(fieldRoutingDrift),
      cause: '编排文件（数据面声明）与数据库中的字段/路由登记不一致：声明改了但库里没同步',
      action: 'fixable',
      fixHint: '点此一键修复：以编排文件为准全量对账数据库（admin 手工改过的行自动跳过保护）',
      source: 'field-routing-bootstrap.service.ts（detectFieldRoutingDrift kind=field/routing）',
    }),
    buildItem('contract-parity', {
      label: '契约 parity（manifest ↔ DB metadata.promptLab）',
      base: 'file:manifest',
      semantics: 'baseline-drift',
      severity: contractParity.hasErrors ? 'error' : 'ok',
      status: contractParity.hasErrors ? 'drifted' : 'clean',
      count: contractParity.summary.errorCount,
      detail: contractParity.results
        .filter((r) => r.status !== 'in-sync')
        .slice(0, 20)
        .map((r) => `${r.agentId} status=${r.status}${r.detail ? `：${r.detail}` : ''}`),
      cause: '契约文件（manifest）与数据库登记的契约元数据不一致：缺失或非法即判定失败，不回退默认值',
      action: 'manual',
      fixHint: '需开发处理：定位差异后执行契约同步（DB 从 manifest 收敛），或经 w4 一键修复的数据库同步后复查',
      source: 'check-prompt-runtime-contract-metadata-parity.ts',
    }),
    buildItem('snapshots', {
      label: '快照（agent-snapshots.md，base=file:orchestration+core）',
      base: 'file:orchestration',
      semantics: 'baseline-drift',
      severity: snapshotCheck.drifted ? 'error' : 'ok',
      status: snapshotCheck.drifted ? 'drifted' : 'clean',
      count: snapshotCheck.drifted ? 1 : 0,
      detail: snapshotCheck.drifted ? [snapshotCheck.detail] : [],
      cause: '自动生成的沙盘说明书（agent-snapshots.md）与编排文件 + core 字段声明不一致：说明书过期了',
      action: 'fixable',
      fixHint: '点此一键修复：重新生成沙盘说明书（先备份；生成物需提交代码）',
      source: 'generate-agent-snapshots.ts',
    }),
    buildItem('yaml-crosscheck', {
      label: 'YAML 交叉校验（C1 failurePolicy / C2 参数单写）',
      base: 'file:core.yaml',
      semantics: 'baseline-drift',
      severity: yamlCheck.ok ? 'ok' : 'error',
      status: yamlCheck.ok ? 'clean' : 'drifted',
      count: yamlCheck.errors.length,
      detail: yamlCheck.errors.slice(0, 20),
      cause: '核心文件的运行参数（温度/token/失败策略）与契约文件的镜像声明不一致：同一参数写了两份',
      action: 'manual',
      fixHint: '需开发处理：以核心文件为准对齐契约文件后重新生成；长期建议按 DRIFT_BASELINE_SURVEY §5.1 消除这份手写镜像',
      source: 'check-yaml-vocabulary.ts',
    }),
    buildItem('params-consistency', {
      label: '参数一致性（P1 两写：core / definition.ts）',
      base: 'file:core.yaml',
      semantics: 'baseline-drift',
      severity: paramsCheck.mismatches.length > 0 ? 'error' : paramsCheck.missingDeclarations.length > 0 ? 'warn' : 'ok',
      status: paramsCheck.mismatches.length > 0
        ? 'drifted'
        : paramsCheck.missingDeclarations.length > 0
          ? 'missing-declarations'
          : 'clean',
      count: paramsCheck.mismatches.length > 0 ? paramsCheck.mismatches.length : paramsCheck.missingDeclarations.length,
      detail: [
        ...paramsCheck.mismatches.slice(0, 20).map((m) =>
          `${m.skillId} ${m.field}：core=${m.core} definition.ts=${m.definition ?? '—'}`,
        ),
        ...paramsCheck.missingDeclarations.slice(0, 20).map((n) => `[注明] ${n}`),
      ],
      cause: '模型参数（temperature/maxTokens）在核心文件与代码声明（definition.ts）两处不一致：同一条参数有两个值',
      action: 'manual',
      fixHint: '需开发处理：统一两处声明后重新生成（definition.ts 是代码，不可一键修；长期建议按 DRIFT_BASELINE_SURVEY §5.1 改为从 core 派生）',
      source: 'core-file-loader.ts + coordinators/definitions-registry.ts',
    }),
    // ============ consistency（一致性偏差，双向对等，人工决策） ============
    buildItem('fields-sync', {
      label: 'Core↔编排字段同步',
      base: 'bidirectional',
      semantics: 'consistency',
      severity: fieldsSyncMissing.length > 0
        ? 'error'
        : fieldsSyncOrphans.length > 0 || fieldsSyncTypeMismatch.length > 0
          ? 'warn'
          : 'ok',
      status: fieldsSyncMissing.length > 0
        ? 'missing'
        : fieldsSyncOrphans.length > 0
          ? 'orphan'
          : fieldsSyncTypeMismatch.length > 0
            ? 'type-mismatch'
            : 'clean',
      count: fieldsSyncMissing.length + fieldsSyncOrphans.length + fieldsSyncTypeMismatch.length,
      detail: [
        ...fieldsSyncMissing.map((m) => `[error] 缺项 ${m.fieldId}：${m.detail}`),
        ...fieldsSyncOrphans.map((o) => `[warn] 孤儿 ${o.coreField}：${o.detail}`),
        ...fieldsSyncTypeMismatch.map((t) => `[warn] 类型不一致 ${t.fieldId}：core=${t.coreType} → 期望 ${t.expectedValueType}，编排=${t.routingValueType}`),
      ].slice(0, 30),
      cause: 'core 声明的字段与编排产出的字段对不上（缺项/孤儿/类型不一致）：两边分别维护，漏改了一方',
      action: 'manual',
      fixHint: '需开发决策：补编排路由、登记豁免，或明确接受存量孤儿（当前 5 条为有意保留）',
      source: 'check-core-fields-sync.ts',
    }),
    buildItem('w1-active', {
      label: 'ACTIVE 覆盖（W1，双向差集偏户口簿）',
      base: 'file:skills.yaml',
      semantics: 'consistency',
      severity: w1.items.length > 0 ? 'warn' : 'ok',
      status: w1.items.length > 0 ? 'unregistered' : 'clean',
      count: w1.items.length,
      detail: w1.items.map((i) => `W1 ${i.skillId || ''}：${i.message}`),
      cause: '户口簿里的活跃技能与数据库 ACTIVE 版本对不上：有技能缺"当前生效版"，或数据库残留已下架技能',
      action: 'manual',
      fixHint: '需开发处理：执行"编译+同步"补缺侧（npm run prompts:compile-all && prompts:sync），或登记/清理残留侧',
      source: 'skills-readiness.service.ts',
    }),
    buildItem('w2-registration', {
      label: '注册对账（W2，双向差集偏户口簿）',
      base: 'file:skills.yaml',
      semantics: 'consistency',
      severity: w2.items.length > 0 ? 'warn' : 'ok',
      status: w2.items.length > 0 ? 'unregistered' : 'clean',
      count: w2.items.length,
      detail: w2.items.map((i) => `W2 ${i.skillId || ''}：${i.message}`),
      cause: '户口簿与数据库注册表对不上：有技能没注册，或数据库有多出来的"幽灵注册"',
      action: 'manual',
      fixHint: '需开发处理：补注册片段（skills/index.ts），或清理幽灵行',
      source: 'skills-readiness.service.ts',
    }),
    buildItem('w3-wiring', {
      label: '接线对账（W3，双向对等无派生）',
      base: 'bidirectional',
      semantics: 'consistency',
      severity: w3.items.length > 0 ? 'warn' : 'ok',
      status: w3.items.length > 0 ? 'unwired' : 'clean',
      count: w3.items.length,
      detail: w3.items.map((i) => `W3 ${i.skillId || ''}：${i.message}`),
      cause: '运行时定义的执行步骤与户口簿的 coordinator 声明对不上：接线两边各维护了一份',
      action: 'manual',
      fixHint: '需开发处理：在 coordinator 定义里补 steps、登记豁免，或移除引用',
      source: 'skills-readiness.service.ts',
    }),
    // ============ override-record（覆盖层，info 只读） ============
    buildItem('override-record', {
      label: '覆盖行（managedByCode=false，覆盖权高于基准）',
      base: 'db:managed',
      semantics: 'override-record',
      severity: 'info',
      status: overrideRowsAll.length > 0 ? 'active' : 'none',
      count: overrideRowsAll.length,
      detail: overrideDetail.length > 0
        ? [
            ...overrideDetail,
            '覆盖行跳过对账与强制同步是有意设计（保留人工微调）；覆盖是隐式的：无 owner/reason 元数据，与文件背离不可见',
          ]
        : ['当前无覆盖行（三表 managedByCode=false 均为 0）——漂移计数不为零即真实文件/DB 背离，与覆盖无关'],
      cause: 'admin 在后台手工改过的配置行清单：覆盖权高于文件基准，对账时自动跳过',
      action: 'none',
      fixHint: '只读展示：当前 0 条覆盖行；如需撤销覆盖，需开发将行恢复为代码托管后重新对账',
      source: 'field-routing-bootstrap.service.ts（三表 where managedByCode=false）',
    }),
    // ============ runtime-info（运行时观测，info 只读） ============
    buildItem('runtime-prompt', {
      label: '运行时 prompt 漂移（prompt_call_logs.promptDrift）',
      base: 'runtime',
      semantics: 'runtime-info',
      severity: 'info',
      status: runtimeDriftRows.note ? 'unavailable' : runtimeDriftRows.rows.length > 0 ? 'observed' : 'none',
      count: runtimeDriftRows.rows.length,
      detail: runtimeDriftRows.note
        ? [runtimeDriftRows.note]
        : runtimeDriftRows.rows.slice(0, 20).map((row) =>
            `${row.agentId} @ ${row.createdAt ? new Date(row.createdAt).toISOString() : '—'}`,
          ),
      cause: '运行时遥测：每次 LLM 调用时比对"代码侧 prompt 与数据库 ACTIVE 版本"是否一致，记录异常',
      action: 'none',
      fixHint: '只读观察项：出现漂移时，修复=重新同步数据库（w4 一键修复覆盖）',
      source: 'prompt-composer.ts（detectPromptDrift）+ prompt_call_logs',
    }),
  ];

  const summary: HealthCenterSummary = {
    total: items.length,
    baselineDrift: items.filter((item) => item.semantics === 'baseline-drift').length,
    consistency: items.filter((item) => item.semantics === 'consistency').length,
    overrideRecord: items.filter((item) => item.semantics === 'override-record').length,
    fixable: items.filter((item) => item.action === 'fixable' && item.severity !== 'ok').length,
  };

  return { generatedAt: new Date().toISOString(), summary, items };
}

// ============================================================
// 60s 内存缓存（防轮询反复 fs 扫描；?refresh=1 强制重算）
// ============================================================

const CACHE_TTL_MS = 60_000;
let lastComputedAt = 0;
let cachedReport: HealthCenterReport | null = null;

export async function getHealthCenterReport(
  db: HealthCenterDbAdapter,
  options?: { skipCache?: boolean },
): Promise<HealthCenterReport> {
  const now = Date.now();
  if (!options?.skipCache && cachedReport && now - lastComputedAt < CACHE_TTL_MS) {
    return cachedReport;
  }
  const report = await buildHealthCenterReport(db);
  cachedReport = report;
  lastComputedAt = now;
  return report;
}

export function resetHealthCenterCache(): void {
  cachedReport = null;
  lastComputedAt = 0;
}

// ============================================================
// 一键修复（POST /api/admin/health-center/fix）
// ============================================================

export const HEALTH_CENTER_FIXABLE_IDS: readonly string[] = [
  'w4-corehash',
  'field-routing-contract',
  'field-routing',
  'snapshots',
];

export const HEALTH_CENTER_MANUAL_GUIDANCE: Record<string, string> = {
  'contract-parity': '需开发处理：定位契约差异后执行契约同步（DB 从 manifest 收敛），或经 w4 一键修复的数据库同步后复查',
  'yaml-crosscheck': '需开发处理：以核心文件为准对齐契约文件后重新生成（manifest 为手写镜像，改 core 需同批改 manifest）',
  'params-consistency': '需开发处理：definition.ts 是代码声明，不可一键修——人工统一核心文件参数 ↔ skills/<skill>/definition.ts 两处后重新生成',
  'fields-sync': 'fields-sync 属一致性偏差（无单方基准）：需开发决策——补编排路由、登记豁免，或明确接受存量孤儿',
  'w1-active': 'W1 属一致性偏差：执行"编译+同步"补缺侧（npm run prompts:compile-all && prompts:sync），或登记/清理残留侧',
  'w2-registration': 'W2 属一致性偏差：在 skills/index.ts 补注册片段后重启，或清理幽灵行',
  'w3-wiring': 'W3 属一致性偏差（两边各维护一份）：在 coordinator 定义里补 steps，或登记豁免、移除引用',
};

export const HEALTH_CENTER_READONLY_GUIDANCE: Record<string, string> = {
  'override-record': '覆盖行只读展示：覆盖权高于文件基准，跳过对账为有意设计；如需撤销覆盖，需开发将行恢复为代码托管后重新对账',
  'runtime-prompt': '运行时 prompt 漂移为观测项（info）：修复语义 = 重新同步数据库（w4 一键修复覆盖）',
};

export interface HealthCenterFixDeps {
  compileAllCorePromptFiles: () => Promise<string[]>;
  ensureCoreAgentPromptsSync: () => Promise<CoreAgentPromptEnsureResult>;
  syncAllFieldRoutings: () => Promise<FieldRoutingFullSyncReport[]>;
  renderAgentSnapshots: () => Promise<string>;
  writeAgentSnapshots: (content: string) => Promise<string>;
}

export interface HealthCenterFixInput {
  db: HealthCenterDbAdapter;
  id: string;
  deps: HealthCenterFixDeps;
  actorId?: string;
  backupsRoot?: string;
}

export interface HealthCenterFixSuccess {
  ok: true;
  id: string;
  fixed: boolean;
  backupDir: string | null;
  gitCommitHint: string;
  before: HealthCenterItem;
  after: HealthCenterItem;
  auditId?: string;
}

export interface HealthCenterFixRejected {
  ok: false;
  id: string;
  status: 404 | 409;
  error: string;
  fixHint?: string;
}

export type HealthCenterFixResult = HealthCenterFixSuccess | HealthCenterFixRejected;

/** 备份目录：<backupsRoot>/<ts>/；不存在的文件静默跳过 */
async function backupFiles(backupDir: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await fs.promises.mkdir(backupDir, { recursive: true });
  for (const file of files) {
    try {
      await fs.promises.copyFile(file, path.join(backupDir, path.basename(file)));
    } catch {
      // 文件不存在或读取失败：跳过（备份尽力而为，不阻断修复）
    }
  }
}

async function writeHealthFixAudit(
  db: HealthCenterDbAdapter,
  input: { targetId: string; before: unknown; after: unknown; actorId?: string },
): Promise<string> {
  const fallbackAuditId = `health-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await db.node_config_changes.create({
    data: {
      id: fallbackAuditId,
      changeType: 'health-fix',
      targetTable: 'health-center',
      targetId: input.targetId,
      before: JSON.stringify(input.before),
      after: JSON.stringify(input.after),
      actorId: input.actorId ?? 'admin',
      actorRole: 'admin',
      reason: 'health-center one-click fix（baseline 收敛）',
    },
  });
  return (created && (created as { id?: string }).id) || fallbackAuditId;
}

const PROMPTS_DIR = path.resolve(CORE_FILES_DIR, '..');

/** prompts/skill.*.md 清单（w4 修复备份对象） */
async function listPromptArtifacts(): Promise<string[]> {
  const entries = await fs.promises.readdir(PROMPTS_DIR).catch(() => []);
  return entries
    .filter((name) => /^skill\..*\.md$/.test(name))
    .map((name) => path.join(PROMPTS_DIR, name));
}

/**
 * 执行一键修复。只允许 semantics='baseline-drift' 且 action='fixable' 的项：
 * w4-corehash / field-routing / field-routing-contract / snapshots。
 * consistency 与 manual 类返回 409 + 人工指引；override-record / runtime-prompt 只读返回 409；未知 id 404。
 * 顺序：先备份 → 执行 → 复检（buildHealthCenterReport）→ 审计写入（node_config_changes, changeType='health-fix'）。
 */
export async function runHealthCenterFix(input: HealthCenterFixInput): Promise<HealthCenterFixResult> {
  const { db, id, deps, actorId } = input;
  const backupsRoot = input.backupsRoot ?? path.join(PROMPTS_DIR, 'backups', 'health-fix');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupsRoot, ts);

  if (!HEALTH_CENTER_FIXABLE_IDS.includes(id)) {
    const manualHint = HEALTH_CENTER_MANUAL_GUIDANCE[id];
    if (manualHint !== undefined) {
      return { ok: false, id, status: 409, error: `${id} 属人工决策类（semantics=baseline-drift 但 action=manual），不支持一键修复`, fixHint: manualHint };
    }
    const readonlyHint = HEALTH_CENTER_READONLY_GUIDANCE[id];
    if (readonlyHint !== undefined) {
      return { ok: false, id, status: 409, error: `${id} 为只读观测项（info 级），不支持一键修复`, fixHint: readonlyHint };
    }
    return { ok: false, id, status: 404, error: `未知检查项：${id}` };
  }

  const before = await buildHealthCenterReport(db);
  const beforeItem = before.items.find((item) => item.id === id);
  if (!beforeItem) {
    return { ok: false, id, status: 404, error: `检查项 ${id} 未出现在当前报告中` };
  }

  let backupDirUsed: string | null = null;
  let gitCommitHint = '';
  let afterItem: HealthCenterItem;

  if (id === 'w4-corehash') {
    const artifacts = await listPromptArtifacts();
    await backupFiles(backupDir, artifacts);
    backupDirUsed = backupDir;
    const written = await deps.compileAllCorePromptFiles();
    const syncResult = await deps.ensureCoreAgentPromptsSync();
    const after = await buildHealthCenterReport(db);
    afterItem = after.items.find((item) => item.id === 'w4-corehash')!;
    gitCommitHint = `产物已更新（编译 ${written.length} 个 skill.*.md；DB 同步 created=${syncResult.created.length} updated=${syncResult.updated?.length ?? 0}），产物为 git 跟踪文件，需 git 提交`;
  } else if (id === 'field-routing' || id === 'field-routing-contract') {
    const syncReports = await deps.syncAllFieldRoutings();
    const after = await buildHealthCenterReport(db);
    afterItem = after.items.find((item) => item.id === id)!;
    gitCommitHint = `DB 全量对账完成（${syncReports.length} 个 stage，managedByCode=false 覆盖行跳过），无 git 跟踪文件改动`;
  } else {
    // snapshots
    await backupFiles(backupDir, [AGENT_SNAPSHOTS_TARGET]);
    backupDirUsed = backupDir;
    const content = await deps.renderAgentSnapshots();
    await deps.writeAgentSnapshots(content);
    const after = await buildHealthCenterReport(db);
    afterItem = after.items.find((item) => item.id === 'snapshots')!;
    gitCommitHint = 'agent-snapshots.md 已重新生成，产物为 git 跟踪文件，需 git 提交';
  }

  const auditId = await writeHealthFixAudit(db, {
    targetId: id,
    before: { severity: beforeItem.severity, status: beforeItem.status, count: beforeItem.count },
    after: { severity: afterItem.severity, status: afterItem.status, count: afterItem.count },
    actorId,
  });

  // 修复后缓存已过期：强制下次重算
  resetHealthCenterCache();

  return {
    ok: true,
    id,
    fixed: afterItem.severity === 'ok' && afterItem.count === 0,
    backupDir: backupDirUsed,
    gitCommitHint,
    before: beforeItem,
    after: afterItem,
    auditId,
  };
}
