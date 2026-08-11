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
 * - 参数一致性（P1 三写）：core params ↔ manifest runtimeDefaults ↔ skills/<skill>/definition.ts，
 *   只读比对（definition.ts 是代码声明，不可一键修）
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
import yaml from 'js-yaml';
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
  manifest: { temperature?: number; maxTokens?: number } | null;
  definition: { defaultTemperature?: number; defaultMaxTokens?: number } | null;
}

export interface ParamsConsistencyMismatch {
  skillId: string;
  field: 'temperature' | 'maxTokens';
  core: number | null;
  manifest: number | null | undefined;
  definition: number | null | undefined;
}

export interface ParamsConsistencyResult {
  mismatches: ParamsConsistencyMismatch[];
  /** definition.ts 未声明 defaultTemperature/defaultMaxTokens（或整个 definition 缺失）——只注明，不视为漂移 */
  missingDeclarations: string[];
}

/**
 * P1 三写比对：core params（真源）↔ manifest runtimeDefaults（手写镜像）↔
 * skills/<skill>/definition.ts defaultTemperature/defaultMaxTokens（展示权威）。
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
      const manifestValue = row.manifest?.[field];
      const defValue = field === 'temperature' ? def.defaultTemperature : def.defaultMaxTokens;
      const declared: Array<[string, number | undefined | null]> = [
        ['core', coreValue],
        ['manifest', manifestValue],
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
          manifest: manifestValue,
          definition: defValue,
        });
      }
    }
  }

  return { mismatches, missingDeclarations: [...new Set(missingDeclarations)].sort() };
}

const MANIFESTS_DIR = path.resolve(__dirname, '../../../prompt-lab/manifests');

interface RawManifestParams {
  runtimeDefaults?: { temperature?: unknown; maxTokens?: unknown };
}

/** manifest runtimeDefaults 装载（与 check-yaml-vocabulary 同目录同口径；仅读取，不复制其比对逻辑） */
function loadManifestRuntimeDefaults(): Map<string, { temperature?: number; maxTokens?: number }> {
  const map = new Map<string, { temperature?: number; maxTokens?: number }>();
  if (!fs.existsSync(MANIFESTS_DIR)) return map;
  for (const name of fs.readdirSync(MANIFESTS_DIR).filter((n) => n.endsWith('.yaml')).sort()) {
    try {
      const parsed = yaml.load(fs.readFileSync(path.join(MANIFESTS_DIR, name), 'utf-8')) as RawManifestParams;
      const rd = parsed?.runtimeDefaults;
      if (rd && typeof rd === 'object') {
        map.set(name.replace(/\.yaml$/, ''), {
          temperature: typeof rd.temperature === 'number' ? rd.temperature : undefined,
          maxTokens: typeof rd.maxTokens === 'number' ? rd.maxTokens : undefined,
        });
      }
    } catch {
      // 坏文件跳过（yaml 交叉校验项会报）
    }
  }
  return map;
}

/** fs 装配：core 扫描 + manifest 装载 + SKILL_RUNTIME_DEFINITIONS 注册表 → 纯函数比对 */
export function buildParamsConsistencyCheck(): ParamsConsistencyResult {
  const { files: cores } = scanCoreFiles();
  const manifests = loadManifestRuntimeDefaults();
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
      manifest: manifests.get(core.skillId) ?? null,
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

  // 快照 / yaml 交叉 / P1 参数三写
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
      cause: 'core.yaml 已改但产物/DB 未同步（frontmatter coreHash ≠ 核心文件哈希 或 DB ACTIVE 锚点）',
      action: 'fixable',
      fixHint: '一键修复：先备份 skill.*.md → 重编译产物 → 同步 DB ACTIVE；产物已更新需 git 提交',
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
      cause: 'P4 名实不符：检查名义为"编排文件 vs DB"，但 contracts 只声明 agentId，displayName/description 由 deriveContract(manifest) 派生——真实基准是 manifest（orchestration-file.ts:182）',
      action: 'fixable',
      fixHint: '一键修复：字段路由全量对账（manifest 派生值向 agent_contracts 收敛，跳过 managedByCode=false 覆盖行）',
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
      cause: '编排文件声明与 DB 三表（field_definitions/agent_field_routings）不一致（managedByCode=true 行参与 diff）',
      action: 'fixable',
      fixHint: '一键修复：全量对账（文件为准，admin 覆盖行保护）',
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
      cause: 'manifest 是 v4 契约唯一声明处；DB ACTIVE metadata.promptLab 与其不一致（缺失/非法即失败，不回退默认值）',
      action: 'manual',
      fixHint: '人工：npm run prompts:runtime-contract:check 定位后执行 prompts:sync（DB 从声明收敛）；或先经 w4 一键修复的 DB 同步',
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
      cause: 'agent-snapshots.md 与编排文件 + core fields 声明不一致（派生产物必须与重渲染逐字节一致）',
      action: 'fixable',
      fixHint: '一键修复：重新生成 agent-snapshots.md（先备份；产物需 git 提交）',
      source: 'generate-agent-snapshots.ts',
    }),
    buildItem('yaml-crosscheck', {
      label: 'YAML 交叉校验（C1 failurePolicy / C2 参数双写）',
      base: 'file:core.yaml',
      semantics: 'baseline-drift',
      severity: yamlCheck.ok ? 'ok' : 'error',
      status: yamlCheck.ok ? 'clean' : 'drifted',
      count: yamlCheck.errors.length,
      detail: yamlCheck.errors.slice(0, 20),
      cause: 'core params（真源）与 manifest runtimeDefaults/promptContract（手写镜像）不一致（B3 平行声明）',
      action: 'manual',
      fixHint: '人工：manifest 镜像与 core 对齐后重新生成（镜像为手写，改 core 需同批改 manifest；长期建议按 DRIFT_BASELINE_SURVEY §5.1 消除手写镜像）',
      source: 'check-yaml-vocabulary.ts',
    }),
    buildItem('params-consistency', {
      label: '参数一致性（P1 三写：core / manifest / definition.ts）',
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
          `${m.skillId} ${m.field}：core=${m.core} manifest=${m.manifest ?? '—'} definition.ts=${m.definition ?? '—'}`,
        ),
        ...paramsCheck.missingDeclarations.slice(0, 20).map((n) => `[注明] ${n}`),
      ],
      cause: 'temperature/maxTokens 三处声明（core params 真源 / manifest runtimeDefaults 手写镜像 / skills/<skill>/definition.ts 展示权威），只读比对；definition.ts 是代码不可一键修',
      action: 'manual',
      fixHint: '人工：统一三处声明后重新生成（或按 DRIFT_BASELINE_SURVEY §5.1 把 manifest/definition.ts 参数改为从 core 派生）',
      source: 'core-file-loader.ts + manifests/*.yaml + coordinators/definitions-registry.ts',
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
      cause: 'core 字段与编排产出行首段双向对等（缺项隐含向 core 收敛；孤儿无收敛方向，B5）——不叫"漂移"叫"不一致"',
      action: 'manual',
      fixHint: '人工决策：补编排路由、登记 EXEMPT_PLATFORM_ROOTS 豁免，或接受存量孤儿（现 5 条为真实漂移保留报）',
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
      cause: '户口簿活跃集与 agent_prompts ACTIVE 双向差集（noPromptFile=true 豁免；zombie 技能 ACTIVE 残留单列）',
      action: 'manual',
      fixHint: '人工决策：npm run prompts:compile-all && prompts:sync（缺侧）或登记/清理（残留侧）',
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
      cause: '户口簿与 skill_registrations 双向差集（registrationPoint=agents/platform-direct 豁免方向 A）',
      action: 'manual',
      fixHint: '人工决策：补注册片段（skills/index.ts）或清理幽灵行',
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
      cause: 'definition.ts steps 与户口簿 coordinator 两处手写权威（P5），无派生方向（W3_STEPS_EMPTY_EXEMPT 硬编码豁免）',
      action: 'manual',
      fixHint: '人工决策：在 coordinator definition.ts 补 steps、登记豁免，或移除引用',
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
      cause: 'managedByCode=false 的 admin 覆盖行：覆盖权高于基准，不参与 diff（field-routing-bootstrap.service.ts:284/:301/:328）',
      action: 'none',
      fixHint: '覆盖行只读展示（评估：撤销覆盖 = 把行标回 managedByCode=true 后执行字段路由 sync 向文件收敛；当前 0 条）',
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
      cause: '运行时传感器：每次 LLM 调用比对 代码侧 prompt vs DB ACTIVE，结果记入 prompt_call_logs.promptDrift（prompt-composer.ts:272/:433）',
      action: 'none',
      fixHint: '运行时观测项（info）：出现漂移的修复语义 = 重新 sync（w4 一键修复的 DB 同步覆盖）',
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
  'contract-parity': '契约 parity 属人工决策类：npm run prompts:runtime-contract:check 定位，再 prompts:sync 使 DB 从 manifest 收敛',
  'yaml-crosscheck': 'yaml 交叉属人工决策类：manifest 手写镜像（runtimeDefaults/promptContract）与 core 对齐后重新生成',
  'params-consistency': '参数一致性属人工决策类：definition.ts 是代码声明，不可一键修——人工统一 core params ↔ manifest runtimeDefaults ↔ skills/<skill>/definition.ts 三处后重新生成',
  'fields-sync': 'fields-sync 属一致性偏差（无单方基准）：人工决策——补编排路由、登记 EXEMPT_PLATFORM_ROOTS 豁免，或接受存量孤儿',
  'w1-active': 'W1 属一致性偏差：执行 npm run prompts:compile-all && prompts:sync（缺侧），或登记/清理（残留侧）',
  'w2-registration': 'W2 属一致性偏差：在 skills/index.ts 补注册片段后重启，或清理幽灵行',
  'w3-wiring': 'W3 属一致性偏差（两处手写权威）：在 coordinator definition.ts 补 steps，或登记 service 侧接线豁免',
};

export const HEALTH_CENTER_READONLY_GUIDANCE: Record<string, string> = {
  'override-record': '覆盖行只读展示：覆盖权高于基准，跳过对账为有意设计；如需撤销覆盖请人工将行标回 managedByCode=true 后执行字段路由 sync',
  'runtime-prompt': '运行时 prompt 漂移为观测项（info）：修复语义 = 重新 sync（w4 一键修复的 DB 同步覆盖）',
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
