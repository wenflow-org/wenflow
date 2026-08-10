/**
 * 技能完成度状态机（SKILL_READINESS_SPEC §1）
 *
 * 派生投影，不落库：每次 workbench-meta / reconciliation / scaffold 响应时重算。
 * state = 最大连续满足前缀（draft 恒满足）；条件回退即状态回退。
 *
 * 结构：computeCompletionState 纯函数（零 IO，可单测，依赖注入）
 *      + buildCompletionInput / getSkillCompletion 生产装配（book / core loader /
 *        orchestration loader / 注册键集 / agent_prompts 查询适配器注入）。
 *
 * 状态判定（§1.1 判定表 + 占位策略微调）：
 *   draft         户口簿 skills.yaml 活跃集含该 skillId
 *   handler-ready F5 handler 文件存在（F11 注册存在性移入 items 展示项 checksGreen 语义，
 *                不参与状态推进 —— scaffold 占位 handler 不注册的设计，注册是实现完成的标志）
 *   core-ready    coreFile 存在 + loadCoreFile schema 过 + fields ≥ 1
 *                + identity/rules 无 scaffold TODO 占位；handler-only 豁免（无 coreFile）
 *   fields-synced mainline 且编排 contracts 含 skill:<id>（F3 铁律只读化）
 *                + analyzeCoreFieldsSync 无缺项（孤儿/类型 mismatch 仅 warn 不阻断）；
 *                aux/handler-only 豁免（不进字段路由）
 *   live          agent_prompts 有 ACTIVE 行（noPromptFile=true 豁免；aux 不豁免：
 *                runAux 走 requireActivePrompt: true）
 *
 * skills:check（F1~F12+P1）全绿仅作 completion 展示项（checksGreen），不参与状态门槛
 * （避免状态机与脚本重复执行）；wired / recentCalls 为跨切面展示项，不参与状态推进。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadSkillsBookRaw,
  REPO_ROOT,
  resolveRegistrationPoint,
  type SkillsBook,
  type SkillEntry,
} from './skills-file';
import { loadCoreFile, type CoreFile } from '../prompt-lab/core-file-loader';
import { loadOrchestrationFiles, type OrchestrationStage } from '../field-routing/orchestration-file';
import { analyzeCoreFieldsSync } from '../../scripts/check-core-fields-sync';
import { listRawManifestEntries } from '../agent-manifest.service';

export const COMPLETION_STATES = ['draft', 'handler-ready', 'core-ready', 'fields-synced', 'live'] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

export interface CompletionGateDetail {
  ok: boolean;
  /** 判定依据文本（每档布尔 + 依据） */
  detail: string;
}

export interface CompletionGates {
  draft: CompletionGateDetail;
  handlerReady: CompletionGateDetail;
  coreReady: CompletionGateDetail;
  fieldsSynced: CompletionGateDetail;
  live: CompletionGateDetail;
}

export type CompletionItemId =
  | 'manifest'
  | 'handler'
  | 'registered'
  | 'core'
  | 'fieldsSynced'
  | 'promptActive'
  | 'checksGreen'
  | 'wired'
  | 'recentCalls';

export interface CompletionItem {
  id: CompletionItemId;
  label: string;
  /** null = 未知/不适用（仅展示，不参与状态） */
  ok: boolean | null;
  hint?: string;
}

/** §1.2 纯函数输入：全部外部事实注入（零 IO） */
export interface ComputeCompletionInput {
  entry: SkillEntry;
  /** F5：handlerRef 文件存在（fs 注入） */
  handlerFileExists: boolean;
  /** F11：注册存在（键集注入；platform-direct/none 已豁免）—— 仅 items 展示（checksGreen 语义），不参与状态推进 */
  registered: boolean;
  /** core 加载结果；handler-only 为 null（档位豁免） */
  core: { loaded: boolean; valid: boolean; fields: string[]; hasTodo: boolean } | null;
  /** fields-sync 摘要；aux/handler-only 为 null（档位豁免） */
  fieldsSync: {
    state: string;
    missingCount: number;
    orphanCount: number;
    typeMismatchCount: number;
    /** mainline 对应 stage contracts 含 skill:<id>（F3 铁律只读化） */
    contractWired: boolean;
  } | null;
  /** agent_prompts 有 ACTIVE 行（agentId='skill:<id>'） */
  activePromptExists: boolean;
  /** 脚本侧注入（仅 completion 展示，不参与状态门槛）；null = 未知 */
  checksGreen?: boolean | null;
  /** manifest 条目存在（展示项；aux 合法不登 manifest，F12 豁免） */
  inManifest?: boolean;
  /** W3 接线（展示项）；null = 未知 */
  wired?: boolean | null;
  /** stats.lastCalledAt（展示项） */
  lastCalledAt?: string | null;
}

export interface SkillCompletionReport {
  status: CompletionState;
  gates: CompletionGates;
  items: CompletionItem[];
  warnings: string[];
}

const CORE_ITEM_HINT = 'SkillDesignPage 协议页签保存并校验';
const REGISTERED_ITEM_HINT = 'skills/index.ts 注册片段（两段）';

/** 纯函数：由注入事实计算完成度报告。零 IO，可单测（对标 analyzeCoreHashParity 模式）。 */
export function computeCompletionState(input: ComputeCompletionInput): SkillCompletionReport {
  const { entry } = input;
  const isHandlerOnly = entry.kind === 'handler-only';
  const registrationPoint = resolveRegistrationPoint(entry);

  // ---- 每档独立判定（取最大连续满足前缀） ----
  const draftOk = true; // 户口簿有条目（调用方保证 entry 来自 book）

  // handler-ready 只判 F5（占位策略微调）：F11 注册存在性为 items 展示项（checksGreen 语义），
  // 不参与状态推进 —— scaffold 占位 handler 不注册进 skillHandlers 是既定设计
  //（SCAFFOLD_P5_SURVEY §5.3），注册粘贴是实现完成的标志，由 registered 展示项呈现。
  const handlerReadyOk = input.handlerFileExists;

  let coreReadyOk: boolean;
  let coreReadyDetail: string;
  if (isHandlerOnly) {
    coreReadyOk = true;
    coreReadyDetail = 'handler-only 豁免（无 coreFile，档位恒真）';
  } else if (!input.core || !input.core.loaded) {
    coreReadyOk = false;
    coreReadyDetail = `core.yaml 文件不存在（F6：${entry.coreFile || '<未声明>'}）`;
  } else if (!input.core.valid) {
    coreReadyOk = false;
    coreReadyDetail = 'core.yaml schema 校验失败（loadCoreFile schema-error）';
  } else if (input.core.fields.length < 1) {
    coreReadyOk = false;
    coreReadyDetail = 'core.yaml fields 为空（须 ≥1 行）';
  } else if (input.core.hasTodo) {
    coreReadyOk = false;
    coreReadyDetail = 'core.yaml 存在 scaffold TODO 占位（identity/rules 含 "TODO"）';
  } else {
    coreReadyOk = true;
    coreReadyDetail = `core.yaml 合法（fields=${input.core.fields.length} 行，无 TODO 占位）`;
  }

  let fieldsSyncedOk: boolean;
  let fieldsSyncedDetail: string;
  if (entry.kind !== 'mainline') {
    fieldsSyncedOk = true;
    fieldsSyncedDetail = `${entry.kind} 豁免（不进字段路由，档位恒真）`;
  } else if (!input.fieldsSync) {
    fieldsSyncedOk = false;
    fieldsSyncedDetail = 'fields-sync 摘要缺失（mainline 必须参与对账）';
  } else if (!input.fieldsSync.contractWired) {
    fieldsSyncedOk = false;
    fieldsSyncedDetail = `编排 contracts 缺 skill:${entry.skillId}（F3 铁律，stage=${entry.stage}）`;
  } else if (input.fieldsSync.missingCount > 0) {
    fieldsSyncedOk = false;
    fieldsSyncedDetail = `fields-sync 存在 ${input.fieldsSync.missingCount} 个缺项（check-core-fields-sync）`;
  } else {
    fieldsSyncedOk = true;
    const warnParts: string[] = [];
    if (input.fieldsSync.orphanCount > 0) warnParts.push(`孤儿 ${input.fieldsSync.orphanCount} 条`);
    if (input.fieldsSync.typeMismatchCount > 0) warnParts.push(`类型不一致 ${input.fieldsSync.typeMismatchCount} 条`);
    fieldsSyncedDetail = `fields-sync 无缺项（state=${input.fieldsSync.state}${warnParts.length ? `；${warnParts.join(' / ')} 仅 warn 不阻断` : ''}）`;
  }

  const liveExempt = entry.noPromptFile === true;
  let liveOk: boolean;
  let liveDetail: string;
  if (liveExempt) {
    liveOk = true;
    liveDetail = 'noPromptFile=true 豁免（无 prompt 文件，档位恒真）';
  } else if (input.activePromptExists) {
    liveOk = true;
    liveDetail = `agent_prompts 存在 ACTIVE 行（agentId=skill:${entry.skillId}）`;
  } else {
    liveOk = false;
    liveDetail = `agent_prompts 无 ACTIVE 行（agentId=skill:${entry.skillId}；aux 不豁免）`;
  }

  // ---- state = 最大连续满足前缀（draft 恒满足） ----
  let status: CompletionState = 'draft';
  if (handlerReadyOk) status = 'handler-ready';
  if (handlerReadyOk && coreReadyOk) status = 'core-ready';
  if (handlerReadyOk && coreReadyOk && fieldsSyncedOk) status = 'fields-synced';
  if (handlerReadyOk && coreReadyOk && fieldsSyncedOk && liveOk) status = 'live';

  const coreItemOk = isHandlerOnly
    ? true
    : input.core
      ? input.core.loaded && input.core.valid && input.core.fields.length >= 1 && !input.core.hasTodo
      : false;

  const items: CompletionItem[] = [
    {
      id: 'manifest',
      label: 'manifest 条目',
      ok: entry.kind === 'aux' ? true : (input.inManifest ?? false),
      hint: entry.kind === 'aux' ? 'aux 合法不登 manifest（F12 豁免）' : '登记在 agent-manifest（kind=skill）',
    },
    { id: 'handler', label: 'handler 存在', ok: input.handlerFileExists, hint: `创建 ${entry.handlerRef}` },
    { id: 'registered', label: '注册存在', ok: input.registered, hint: `${REGISTERED_ITEM_HINT}（F11 仅展示，不阻断状态推进）` },
    { id: 'core', label: 'core.yaml 合法', ok: coreItemOk, hint: CORE_ITEM_HINT },
    { id: 'fieldsSynced', label: '字段路由回填', ok: fieldsSyncedOk, hint: 'npm run prompts:fields-sync:check' },
    {
      id: 'promptActive',
      label: 'ACTIVE prompt',
      ok: liveExempt ? true : input.activePromptExists,
      hint: 'npm run prompts:compile-all && prompts:sync',
    },
    {
      id: 'checksGreen',
      label: 'skills:check 全绿',
      ok: input.checksGreen ?? null,
      hint: 'npm run prompts:skills:check',
    },
    { id: 'wired', label: '接线引用', ok: input.wired ?? false, hint: 'coordinator steps 或业务调用点' },
    { id: 'recentCalls', label: '最近调用', ok: null },
  ];

  const warnings: string[] = [];
  if (input.wired === false) warnings.push('W3-wired 未接线（辅助展示，不进状态判定）');

  return {
    status,
    gates: {
      draft: { ok: draftOk, detail: `户口簿 skills.yaml 有登记（kind=${entry.kind}${registrationPoint ? `，registrationPoint=${registrationPoint}` : ''}）` },
      handlerReady: handlerReadyOk
        ? {
            ok: true,
            detail: input.registered
              ? `handler 文件存在（F5：${entry.handlerRef}）且注册已就绪`
              : `handler 文件存在（F5：${entry.handlerRef}）；注册未就绪（F11 仅展示项，不阻断状态推进）`,
          }
        : { ok: false, detail: `handler 文件不存在（F5：${entry.handlerRef}）` },
      coreReady: { ok: coreReadyOk, detail: coreReadyDetail },
      fieldsSynced: { ok: fieldsSyncedOk, detail: fieldsSyncedDetail },
      live: { ok: liveOk, detail: liveDetail },
    },
    items,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 生产装配（依赖注入点：book / fs / 注册键集 / core loader / 编排 / DB） */
/* ------------------------------------------------------------------ */

export interface CompletionAssemblyDeps {
  /** 户口簿（默认 loadSkillsBookRaw） */
  book?: SkillsBook;
  /** F5/F6 文件存在性（默认 REPO_ROOT 解析 + fs.existsSync） */
  existsFile?: (relativePath: string) => boolean;
  /** F11 注册判定（默认 F11 同款键集分派） */
  registeredCheck?: (entry: SkillEntry) => boolean;
  /** core 加载器（默认 loadCoreFile） */
  loadCore?: (skillId: string) => { core: CoreFile | null } | null;
  /** 编排 stages（默认 loadOrchestrationFiles） */
  orchestrationStages?: OrchestrationStage[];
  /** ACTIVE prompt 判定（默认查 systemPrisma.agent_prompts status=ACTIVE） */
  activePromptIds?: Set<string> | (() => Set<string> | Promise<Set<string>>);
  /** manifest 条目存在（默认查 listRawManifestEntries kind=skill） */
  inManifest?: (skillId: string) => boolean;
  /** W3 接线（展示项；默认 null 未知） */
  wiredCheck?: (entry: SkillEntry) => boolean | null;
  /** skills:check 全绿（展示项；默认 null 未知） */
  checksGreen?: boolean | null;
  /** stats.lastCalledAt（展示项） */
  lastCalledAt?: string | null;
}

/** F11 同款注册判定（check-skills-file.ts:57-67 只读化；键集惰性 require 防循环依赖） */
export function defaultRegisteredCheck(entry: SkillEntry): boolean {
  const rp = resolveRegistrationPoint(entry);
  if (rp === 'platform-direct' || rp === 'none') return true; // 平台守门直调 / 无注册语义，豁免
  if (rp === 'agents') {
    const { agentHandlers } = require('../../agents') as { agentHandlers: Record<string, unknown> };
    return Object.prototype.hasOwnProperty.call(agentHandlers, `skill:${entry.skillId}`);
  }
  const { skillHandlers, allSkillDefinitions } = require('../../skills') as {
    skillHandlers: Record<string, unknown>;
    allSkillDefinitions: Array<{ name: string }>;
  };
  return (
    Object.prototype.hasOwnProperty.call(skillHandlers, entry.skillId) ||
    allSkillDefinitions.some((definition) => definition.name === entry.skillId)
  );
}

/** scaffold TODO 占位扫描：core.yaml 内容 identity/rules 不含 'TODO' */
export function hasScaffoldTodo(core: CoreFile): boolean {
  const text = [core.identity, ...(core.rules || [])].join('\n');
  return text.includes('TODO');
}

function defaultExistsFile(relativePath: string): boolean {
  return fs.existsSync(path.resolve(REPO_ROOT, relativePath));
}

function defaultInManifest(skillId: string): boolean {
  return listRawManifestEntries().some(
    (item) => item.kind === 'skill' && item.id === `skill:${skillId}`,
  );
}

async function defaultActivePromptIds(): Promise<Set<string>> {
  const systemPrisma = (await import('../../config/system-database')).default;
  const rows = await systemPrisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: { agentId: true },
  });
  return new Set(rows.map((row) => row.agentId));
}

/** 由户口簿条目装配纯函数输入（book 条目缺失时返回 null，调用方决定 404） */
export async function buildCompletionInput(
  entry: SkillEntry,
  deps?: CompletionAssemblyDeps,
): Promise<ComputeCompletionInput> {
  const existsFile = deps?.existsFile ?? defaultExistsFile;
  const registered = deps?.registeredCheck ? deps.registeredCheck(entry) : defaultRegisteredCheck(entry);

  // core（handler-only 无 coreFile，档位豁免 → null）
  let core: ComputeCompletionInput['core'] = null;
  if (entry.kind !== 'handler-only') {
    const loadCore = deps?.loadCore ?? loadCoreFile;
    const loaded = loadCore(entry.skillId);
    const validCore = loaded?.core ?? null;
    core = {
      loaded: loaded !== null && loaded !== undefined,
      valid: validCore !== null,
      fields: validCore ? validCore.fields.map((field) => field.name) : [],
      hasTodo: validCore ? hasScaffoldTodo(validCore) : false,
    };
  }

  // fields-sync（仅 mainline 参与；aux/handler-only 豁免 → null）
  let fieldsSync: ComputeCompletionInput['fieldsSync'] = null;
  if (entry.kind === 'mainline' && entry.stage !== undefined) {
    const stages = deps?.orchestrationStages ?? loadOrchestrationFiles();
    const stage = stages.find((item) => item.stage === entry.stage);
    const contractWired = stage
      ? stage.contracts.some((contract) => contract.agentId === `skill:${entry.skillId}`)
      : false;
    const loadCore = deps?.loadCore ?? loadCoreFile;
    const reports = analyzeCoreFieldsSync(stages, [entry], (skillId) => loadCore(skillId));
    const report = reports.find((item) => item.skillId === entry.skillId);
    fieldsSync = report
      ? {
          state: report.state,
          missingCount: report.missing.length,
          orphanCount: report.orphan.length,
          typeMismatchCount: report.typeMismatch.length,
          contractWired,
        }
      : { state: 'no-routings', missingCount: 0, orphanCount: 0, typeMismatchCount: 0, contractWired };
  }

  const activePromptIds =
    deps?.activePromptIds === undefined
      ? await defaultActivePromptIds()
      : typeof deps.activePromptIds === 'function'
        ? await deps.activePromptIds()
        : deps.activePromptIds;
  const activePromptExists = activePromptIds.has(`skill:${entry.skillId}`);

  return {
    entry,
    handlerFileExists: existsFile(entry.handlerRef),
    registered,
    core,
    fieldsSync,
    activePromptExists,
    checksGreen: deps?.checksGreen ?? null,
    inManifest: deps?.inManifest ? deps.inManifest(entry.skillId) : defaultInManifest(entry.skillId),
    wired: deps?.wiredCheck ? deps.wiredCheck(entry) : null,
    lastCalledAt: deps?.lastCalledAt ?? null,
  };
}

/** 生产入口：按 skillId 读户口簿 → 装配 → 纯函数（skillId 不在户口簿抛错） */
export async function getSkillCompletion(
  skillId: string,
  deps?: CompletionAssemblyDeps,
): Promise<SkillCompletionReport> {
  const book = deps?.book ?? loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) {
    throw new Error(`[skill-completion] skillId "${skillId}" 不在户口簿 skills.yaml`);
  }
  const input = await buildCompletionInput(entry, deps);
  return computeCompletionState(input);
}
