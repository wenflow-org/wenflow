/**
 * skills.yaml 技能户口簿加载器 —— 跨阶段技能注册唯一声明源（SKILLS_YAML_SPEC P0/P1）
 *
 * 定位：prompts/skills.yaml 是全部"活跃" skill（mainline / aux / handler-only）的
 * 注册登记唯一声明源；manifest 的 agentMembers 由 parentAgent 字段运行时派生（P1，
 * agent-manifest.service.ts 惰性 require 本模块的 loadSkillsBookRaw）。
 *
 * 边界（与既有单源化的分工，见 doc/SKILLS_YAML_SPEC.md §附）：
 *   - 编排文件 prompts/orchestration/<stage>.yaml 仍为字段路由数据面唯一声明源；
 *     本模块只做 stage 归属校验（F3）与 mainline 铁律（对应 stage contracts 对照）。
 *   - 退役名单执行权威 = backend/src/skills/retired-skills.ts；本文件不设 retired 字段，
 *     仅做活跃/退役互斥校验（F8）。
 *   - skills/index.ts 保持唯一手写注册点（F11 注册存在性校验放脚本侧 check-skills-file.ts，
 *     避免本模块静态 import skills/index.ts 造成循环依赖：skills/index.ts → executor →
 *     agent-manifest.service ← 本模块）。
 *
 * 本模块不得进入任何运行时热路径：仅启动校验（index.ts initializeGateway）、
 * 校验脚本（scripts/check-skills-file.ts）与 manifest 惰性派生使用。
 *
 * 过渡开关：SKILLS_FILE_DISABLED=1 时 index.ts 跳过加载（回滚点，见规格 §5.3）；
 * 本模块自身仍可被脚本/测试调用。
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { loadOrchestrationFiles } from '../field-routing/orchestration-file';
import { listRawManifestEntries } from '../agent-manifest.service';
import { PURGED_SKILLS, ALL_RETIRED_SKILLS } from '../../skills/retired-skills';

/** 仓库根目录（backend/src/services/skill-registry 上溯 4 级），用于解析 handlerRef/coreFile */
export const REPO_ROOT = path.resolve(__dirname, '../../../../');

/** 户口簿文件：默认仓库根 prompts/skills.yaml，可用 SKILLS_FILE 覆盖（对齐 ORCHESTRATION_DIR 模式） */
export const SKILLS_FILE_PATH = process.env.SKILLS_FILE
  ? path.resolve(process.env.SKILLS_FILE)
  : path.resolve(REPO_ROOT, 'prompts/skills.yaml');

export const SKILL_KINDS = ['mainline', 'aux', 'handler-only'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export const SKILL_STAGES = ['goal', 'path', 'teaching', 'profile', 'simulation'] as const;
export type SkillStage = (typeof SKILL_STAGES)[number];

export const REGISTRATION_POINTS = ['skillHandlers', 'agents', 'platform-direct', 'none'] as const;
export type RegistrationPoint = (typeof REGISTRATION_POINTS)[number];

export interface SkillCoordinatorStep {
  step: number;
  role: string;
  loopOver?: string;
  condition?: string;
  agentId?: string;
}

export interface SkillCoordinator {
  agentId: string;
  steps: SkillCoordinatorStep[];
}

export interface SkillEntry {
  skillId: string;
  kind: SkillKind;
  stage?: string;
  parentAgent?: string;
  handlerRef: string;
  registrationPoint?: RegistrationPoint;
  coreFile?: string;
  /** handler-only 强制 true；mainline/aux 禁 true（F7） */
  noPromptFile?: boolean;
  platformGate?: boolean;
  displayName?: string;
  description?: string;
  aliases?: string[];
  /** P4 预留：数据源直读声明（仅 schema 校验，不实施交叉校验） */
  dataSource?: { db?: string[]; api?: string[] };
  /** P4 预留：平台工具 id（仅 schema 校验，不实施交叉校验） */
  mcpTools?: string[];
  coordinator?: SkillCoordinator;
  notes?: string;
}

export interface RetiredMirrorEntry {
  skillId: string;
  reason?: string;
  scope: 'purge' | 'residue';
}

export interface SkillsBook {
  version: number;
  skills: SkillEntry[];
  /** 可选退役镜像段（仅 admin 展示用，与 retired-skills.ts 强一致；可整体缺席） */
  retired?: RetiredMirrorEntry[];
}

interface RawSkillEntry {
  skillId?: unknown;
  kind?: unknown;
  stage?: unknown;
  parentAgent?: unknown;
  handlerRef?: unknown;
  registrationPoint?: unknown;
  coreFile?: unknown;
  noPromptFile?: unknown;
  platformGate?: unknown;
  displayName?: unknown;
  description?: unknown;
  aliases?: unknown;
  dataSource?: unknown;
  mcpTools?: unknown;
  coordinator?: unknown;
  notes?: unknown;
  [key: string]: unknown;
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[skills.yaml] ${label} 必须为非空字符串`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, label);
}

function asOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`[skills.yaml] ${label} 必须为布尔值`);
  return value;
}

function asOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`[skills.yaml] ${label} 必须为字符串数组`);
  return value.map((v, i) => asString(v, `${label}[${i}]`));
}

function assertNoUnknownFields(raw: RawSkillEntry, label: string, allowed: string[]): void {
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`[skills.yaml] ${label} 存在未知字段：${unknown.join(', ')}`);
  }
}

function parseCoordinator(raw: unknown, label: string, ownSkillId: string, topAgentIds: Set<string>): SkillCoordinator {
  if (!isRecord(raw)) throw new Error(`[skills.yaml] ${label}.coordinator 必须是对象`);
  assertNoUnknownFields(raw as RawSkillEntry, label, ['agentId', 'steps']);
  const agentId = asString(raw.agentId, `${label}.coordinator.agentId`);
  if (!topAgentIds.has(agentId)) {
    throw new Error(
      `[skills.yaml] ${label}.coordinator.agentId=${agentId} 非法（须 ∈ manifest 顶层 agent：${[...topAgentIds].join(',')}）`,
    );
  }
  const stepsRaw = raw.steps;
  if (stepsRaw === undefined || stepsRaw === null) {
    throw new Error(`[skills.yaml] ${label}.coordinator.steps 必填（可空数组）`);
  }
  if (!Array.isArray(stepsRaw)) throw new Error(`[skills.yaml] ${label}.coordinator.steps 必须为数组`);
  const steps = stepsRaw.map((stepRaw, i) => {
    if (!isRecord(stepRaw)) throw new Error(`[skills.yaml] ${label}.coordinator.steps[${i}] 必须是对象`);
    assertNoUnknownFields(stepRaw as RawSkillEntry, `${label}.coordinator.steps[${i}]`, ['step', 'role', 'loopOver', 'condition', 'agentId']);
    const step = stepRaw.step;
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 1) {
      throw new Error(`[skills.yaml] ${label}.coordinator.steps[${i}].step 必须为正整数`);
    }
    const role = asString(stepRaw.role, `${label}.coordinator.steps[${i}].role`);
    const stepAgentId = asOptionalString(stepRaw.agentId, `${label}.coordinator.steps[${i}].agentId`);
    // F10：step 引用的 agentId ∈ manifest 顶层 agent，或引用自身 skillId（合法）
    if (stepAgentId !== undefined && !topAgentIds.has(stepAgentId) && stepAgentId !== `skill:${ownSkillId}`) {
      throw new Error(
        `[skills.yaml] ${label}.coordinator.steps[${i}].agentId=${stepAgentId} 非法（须 ∈ manifest 顶层 agent 或引用自身 skill:${ownSkillId}）`,
      );
    }
    return {
      step,
      role,
      loopOver: asOptionalString(stepRaw.loopOver, `${label}.coordinator.steps[${i}].loopOver`),
      condition: asOptionalString(stepRaw.condition, `${label}.coordinator.steps[${i}].condition`),
      ...(stepAgentId !== undefined ? { agentId: stepAgentId } : {}),
    };
  });
  return { agentId, steps };
}

/**
 * 纯内存解析核心（F1/F2/F3-enum/F7/F8/F9）：
 * parseSkillsFile / validateSkillsContent / loadSkillsBookRaw 共用同一套静态校验。
 * 不依赖文件系统与外部声明源（manifest / orchestration / retired 名单中的 TS 常量除外）。
 */
function parseSkillsText(rawText: string, sourceLabel: string, topAgentIds: Set<string>): SkillsBook {
  let parsed: unknown;
  try {
    parsed = yaml.load(rawText);
  } catch (error) {
    throw new Error(`[skills.yaml] yaml 解析失败：${sourceLabel}（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`[skills.yaml] ${sourceLabel} 顶层必须是对象`);
  }

  // F1a：version 必填整数
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`[skills.yaml] ${sourceLabel} version 必须为正整数（当前=${String(version)}）`);
  }

  // F1b：skills 必填数组（平铺列表；retired 条目不在此处）
  const skillsRaw = parsed.skills;
  if (!Array.isArray(skillsRaw)) {
    throw new Error(`[skills.yaml] ${sourceLabel} skills 必须为非空数组`);
  }

  // F2：skillId 全局唯一
  const seenSkillIds = new Set<string>();

  const skills: SkillEntry[] = skillsRaw.map((entryRaw, index) => {
    const label = `skills[${index}]`;
    if (!isRecord(entryRaw)) throw new Error(`[skills.yaml] ${label} 必须是对象`);
    const raw = entryRaw as RawSkillEntry;
    assertNoUnknownFields(raw, label, [
      'skillId', 'kind', 'stage', 'parentAgent', 'handlerRef', 'registrationPoint',
      'coreFile', 'noPromptFile', 'platformGate', 'displayName', 'description', 'aliases',
      'dataSource', 'mcpTools', 'coordinator', 'notes',
    ]);

    // F1c/F2：skillId kebab-case + 唯一
    const skillId = asString(raw.skillId, `${label}.skillId`);
    if (!KEBAB_CASE.test(skillId)) {
      throw new Error(`[skills.yaml] ${label}.skillId=${skillId} 非法（须为 kebab-case，如 goal-conversation）`);
    }
    if (seenSkillIds.has(skillId)) {
      throw new Error(`[skills.yaml] ${label}.skillId=${skillId} 重复（F2：全表唯一）`);
    }
    seenSkillIds.add(skillId);

    // F1d/F3：kind 值域；stage 值域（mainline 必填）
    const kind = asString(raw.kind, `${label}.kind`);
    if (!(SKILL_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`[skills.yaml] ${label}.kind=${kind} 非法（须在 ${SKILL_KINDS.join(',')} 中）`);
    }
    const stage = asOptionalString(raw.stage, `${label}.stage`);
    if (kind === 'mainline' && stage === undefined) {
      throw new Error(`[skills.yaml] ${label}.stage 必填（kind=mainline 必须有主链归属阶段）`);
    }
    if (stage !== undefined && !(SKILL_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`[skills.yaml] ${label}.stage=${stage} 非法（须在 ${SKILL_STAGES.join(',')} 中）`);
    }

    const parentAgent = asOptionalString(raw.parentAgent, `${label}.parentAgent`);
    if (parentAgent !== undefined && !topAgentIds.has(parentAgent)) {
      throw new Error(
        `[skills.yaml] ${label}.parentAgent=${parentAgent} 非法（须 ∈ manifest kind=agent 条目 id：${[...topAgentIds].join(',')}）`,
      );
    }

    const handlerRef = asString(raw.handlerRef, `${label}.handlerRef`);

    const registrationPointRaw = asOptionalString(raw.registrationPoint, `${label}.registrationPoint`);
    let registrationPoint: RegistrationPoint | undefined;
    if (registrationPointRaw !== undefined) {
      if (!(REGISTRATION_POINTS as readonly string[]).includes(registrationPointRaw)) {
        throw new Error(`[skills.yaml] ${label}.registrationPoint=${registrationPointRaw} 非法（须在 ${REGISTRATION_POINTS.join(',')} 中）`);
      }
      registrationPoint = registrationPointRaw as RegistrationPoint;
    }

    // F1e/F6/F7：coreFile 与 noPromptFile 的 kind 约束
    const coreFile = asOptionalString(raw.coreFile, `${label}.coreFile`);
    if (kind === 'handler-only' && coreFile !== undefined) {
      throw new Error(`[skills.yaml] ${label}.coreFile 禁填（kind=handler-only 无 prompt 文件，F7）`);
    }
    if (kind !== 'handler-only' && coreFile === undefined) {
      throw new Error(`[skills.yaml] ${label}.coreFile 必填（mainline/aux 必须有 prompts/core/<skillId>.yaml，F6）`);
    }
    const noPromptFile = asOptionalBoolean(raw.noPromptFile, `${label}.noPromptFile`);
    if (kind === 'handler-only' && noPromptFile === false) {
      throw new Error(`[skills.yaml] ${label}.noPromptFile 与 kind=handler-only 冲突（必须为 true，F7）`);
    }
    if (kind !== 'handler-only' && noPromptFile === true) {
      throw new Error(`[skills.yaml] ${label}.noPromptFile=true 与 kind=${kind} 冲突（mainline/aux 必须有 prompt，F7）`);
    }

    const platformGate = asOptionalBoolean(raw.platformGate, `${label}.platformGate`);

    // F1f：displayName/description 非空
    const displayName = asOptionalString(raw.displayName, `${label}.displayName`);
    const description = asOptionalString(raw.description, `${label}.description`);

    const aliases = asOptionalStringArray(raw.aliases, `${label}.aliases`);

    // F1g：dataSource / mcpTools（P4 预留，仅 schema 形状校验）
    let dataSource: { db?: string[]; api?: string[] } | undefined;
    if (raw.dataSource !== undefined && raw.dataSource !== null) {
      if (!isRecord(raw.dataSource)) throw new Error(`[skills.yaml] ${label}.dataSource 必须是对象`);
      assertNoUnknownFields(raw.dataSource as RawSkillEntry, label, ['db', 'api']);
      dataSource = {
        db: asOptionalStringArray((raw.dataSource as RawSkillEntry).db, `${label}.dataSource.db`),
        api: asOptionalStringArray((raw.dataSource as RawSkillEntry).api, `${label}.dataSource.api`),
      };
    }
    const mcpTools = asOptionalStringArray(raw.mcpTools, `${label}.mcpTools`);

    const coordinator = raw.coordinator === undefined || raw.coordinator === null
      ? undefined
      : parseCoordinator(raw.coordinator, label, skillId, topAgentIds);

    const notes = asOptionalString(raw.notes, `${label}.notes`);

    return {
      skillId,
      kind: kind as SkillKind,
      ...(stage !== undefined ? { stage } : {}),
      ...(parentAgent !== undefined ? { parentAgent } : {}),
      handlerRef,
      ...(registrationPoint !== undefined ? { registrationPoint } : {}),
      ...(coreFile !== undefined ? { coreFile } : {}),
      noPromptFile: kind === 'handler-only' ? true : (noPromptFile ?? false),
      ...(platformGate !== undefined ? { platformGate } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(aliases !== undefined ? { aliases } : {}),
      ...(dataSource !== undefined ? { dataSource } : {}),
      ...(mcpTools !== undefined ? { mcpTools } : {}),
      ...(coordinator !== undefined ? { coordinator } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
  });

  // F9：alias 全表唯一 + 不与 skillId 冲突
  const bookSkillIds = new Set(skills.map((entry) => entry.skillId));
  const seenAliases = new Map<string, string>();
  for (const entry of skills) {
    for (const alias of entry.aliases || []) {
      const owner = seenAliases.get(alias);
      if (owner !== undefined) {
        throw new Error(`[skills.yaml] alias "${alias}" 重复（F9：${owner} 与 ${entry.skillId} 冲突）`);
      }
      seenAliases.set(alias, entry.skillId);
      if (bookSkillIds.has(alias) && alias !== entry.skillId) {
        throw new Error(`[skills.yaml] alias "${alias}" 与另一 skillId 冲突（F9：${entry.skillId} 声明了它）`);
      }
    }
  }
  // F9 扩展：alias 不得与 manifest canonical id 冲突；与 manifest alias 同源同目标才允许
  const manifestEntries = listRawManifestEntries();
  const manifestIds = new Set(manifestEntries.map((item) => item.id));
  const manifestAliasToCanonical = new Map<string, string>();
  for (const item of manifestEntries) {
    for (const alias of item.aliases || []) manifestAliasToCanonical.set(alias, item.id);
  }
  for (const entry of skills) {
    for (const alias of entry.aliases || []) {
      if (manifestIds.has(alias)) {
        throw new Error(`[skills.yaml] alias "${alias}" 与 manifest canonical id 冲突（F9：${entry.skillId}）`);
      }
      const manifestCanonical = manifestAliasToCanonical.get(alias);
      if (manifestCanonical !== undefined && manifestCanonical !== `skill:${entry.skillId}`) {
        throw new Error(`[skills.yaml] alias "${alias}" 与 manifest alias 冲突（F9：${entry.skillId} vs ${manifestCanonical}）`);
      }
    }
  }

  // F8：活跃集 ∩ 退役名单 = ∅（retired-skills.ts 执行权威，本文件不做退役登记）
  const retiredSet = new Set([...PURGED_SKILLS, ...ALL_RETIRED_SKILLS]);
  for (const entry of skills) {
    if (retiredSet.has(entry.skillId)) {
      throw new Error(
        `[skills.yaml] skills[${entry.skillId}] 与退役名单冲突（F8：该 skillId 在 retired-skills.ts 中，须从户口簿移除；僵尸项除外并保留登记）`,
      );
    }
  }

  // retired 镜像段（可选）：形状 + 与 retired-skills.ts 强一致
  let retired: RetiredMirrorEntry[] | undefined;
  if (parsed.retired !== undefined && parsed.retired !== null) {
    if (!Array.isArray(parsed.retired)) throw new Error(`[skills.yaml] retired 必须为数组`);
    retired = (parsed.retired as unknown[]).map((entryRaw, index) => {
      const label = `retired[${index}]`;
      if (!isRecord(entryRaw)) throw new Error(`[skills.yaml] ${label} 必须是对象`);
      assertNoUnknownFields(entryRaw as RawSkillEntry, label, ['skillId', 'reason', 'scope']);
      const skillId = asString((entryRaw as RawSkillEntry).skillId, `${label}.skillId`);
      const scope = asString((entryRaw as RawSkillEntry).scope, `${label}.scope`);
      if (scope !== 'purge' && scope !== 'residue') {
        throw new Error(`[skills.yaml] ${label}.scope=${scope} 非法（须在 purge,residue 中）`);
      }
      if (!retiredSet.has(skillId)) {
        throw new Error(`[skills.yaml] ${label}.skillId=${skillId} 不在 retired-skills.ts 名单中（镜像段必须与执行权威强一致）`);
      }
      return { skillId, scope: scope as 'purge' | 'residue', reason: asOptionalString((entryRaw as RawSkillEntry).reason, `${label}.reason`) };
    });
  }

  return { version, skills, ...(retired !== undefined ? { retired } : {}) };
}

/**
 * F3（编排对照）/F10（coordinator 双向）/F12（与 manifest 双向一致）：
 * 依赖编排文件与 manifest 的交叉校验。mainline 铁律（对应 stage contracts 必须含本 skill）也在此。
 */
function validateCrossSource(book: SkillsBook): void {
  const orchestrationStages = loadOrchestrationFiles();
  const stageNames = new Set(orchestrationStages.map((stage) => stage.stage));
  const stageContracts = new Map<string, Set<string>>();
  for (const stage of orchestrationStages) {
    stageContracts.set(stage.stage, new Set(stage.contracts.map((contract) => contract.agentId)));
  }

  // F3：mainline 的 stage ∈ 编排文件 stage 清单
  for (const entry of book.skills) {
    if (entry.kind !== 'mainline') continue;
    if (entry.stage === undefined) {
      throw new Error(`[skills.yaml] ${entry.skillId}.stage 缺失（kind=mainline 必填）`);
    }
    if (!stageNames.has(entry.stage)) {
      throw new Error(`[skills.yaml] ${entry.skillId}.stage=${entry.stage} 非法（编排文件 stage 清单：${[...stageNames].join(',')}）`);
    }
    // mainline 铁律：对应 stage contracts 必须含 skill:<id>
    const contracts = stageContracts.get(entry.stage) || new Set<string>();
    if (!contracts.has(`skill:${entry.skillId}`)) {
      throw new Error(
        `[skills.yaml] ${entry.skillId}（mainline，stage=${entry.stage}）未登记在 prompts/orchestration/${entry.stage}.yaml contracts（铁律）`,
      );
    }
  }

  // F12：与 manifest 双向一致（方向一 fail-fast：manifest 条目必须登记在户口簿）
  const manifestSkillIds = new Set(
    listRawManifestEntries()
      .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
      .map((item) => item.id.slice('skill:'.length)),
  );
  const bookIds = new Set(book.skills.map((entry) => entry.skillId));
  const manifestWithoutBook = [...manifestSkillIds].filter((id) => !bookIds.has(id)).sort();
  if (manifestWithoutBook.length > 0) {
    throw new Error(
      `[skills.yaml] manifest skill 条目缺户口簿登记（F12）：${manifestWithoutBook.join(', ')}（差额见 skills:check 输出）`,
    );
  }
  // 方向二：户口簿登记缺 manifest 条目 —— 仅 mainline/handler-only fail-fast（aux 合法不登 manifest）
  const nonAuxWithoutManifest = book.skills
    .filter((entry) => entry.kind !== 'aux' && !manifestSkillIds.has(entry.skillId))
    .map((entry) => entry.skillId)
    .sort();
  if (nonAuxWithoutManifest.length > 0) {
    throw new Error(
      `[skills.yaml] 户口簿登记缺 manifest 条目（F12，mainline/handler-only 必须登记）：${nonAuxWithoutManifest.join(', ')}`,
    );
  }
}

/**
 * F5：handlerRef 文件存在（仓库相对路径，从仓库根解析）
 * F6：coreFile 文件存在（mainline/aux 必填；handler-only 已在上游禁填）
 */
function validateFileExistence(book: SkillsBook): void {
  for (const entry of book.skills) {
    const handlerPath = path.resolve(REPO_ROOT, entry.handlerRef);
    if (!fs.existsSync(handlerPath)) {
      throw new Error(`[skills.yaml] ${entry.skillId}.handlerRef 文件不存在（F5）：${entry.handlerRef}`);
    }
    if (entry.kind === 'handler-only') continue;
    if (entry.coreFile === undefined) {
      throw new Error(`[skills.yaml] ${entry.skillId}.coreFile 缺失（F6）`);
    }
    const corePath = path.resolve(REPO_ROOT, entry.coreFile);
    if (!fs.existsSync(corePath)) {
      throw new Error(`[skills.yaml] ${entry.skillId}.coreFile 文件不存在（F6）：${entry.coreFile}`);
    }
    const expectedBasename = `${entry.skillId}.yaml`;
    if (path.basename(entry.coreFile) !== expectedBasename) {
      throw new Error(
        `[skills.yaml] ${entry.skillId}.coreFile 文件名不符（F6）：${entry.coreFile}（约定 prompts/core/${expectedBasename}）`,
      );
    }
  }
}

function getTopLevelAgentIds(): Set<string> {
  return new Set(
    listRawManifestEntries()
      .filter((item) => item.kind === 'agent')
      .map((item) => item.id),
  );
}

/**
 * 读文件 + 解析 + F1~F10/F12 全量校验（fail-fast，[skills.yaml] 前缀抛错）。
 * F11（注册存在性）在脚本侧 check-skills-file.ts 执行（避免循环依赖）。
 */
export function parseSkillsFile(filePath: string): SkillsBook {
  let rawText: string;
  try {
    rawText = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`[skills.yaml] 读取失败：${filePath}（${error instanceof Error ? error.message : String(error)}）`);
  }
  const book = validateSkillsContent(rawText);
  validateFileExistence(book);
  validateCrossSource(book);
  return book;
}

/**
 * 内存校验：以完整户口簿 YAML 文本为输入，执行与 parseSkillsFile 相同的解析与
 * 静态校验逻辑（F1/F2/F3-enum/F4/F7/F8/F9/F10/F12；不含 fs 存在性 F5/F6）。
 * 用于编辑侧保存前的预检。
 */
export function validateSkillsContent(content: string): SkillsBook {
  return parseSkillsText(content, '<content>', getTopLevelAgentIds());
}

let cachedValidatedBook: SkillsBook | null = null;
let cachedRawBook: SkillsBook | null = null;

/** 启动入口：parseSkillsFile(SKILLS_FILE_PATH)，结果进程级缓存 */
export function loadSkillsFile(): SkillsBook {
  if (!cachedValidatedBook) {
    cachedValidatedBook = parseSkillsFile(SKILLS_FILE_PATH);
  }
  return cachedValidatedBook;
}

/**
 * 轻量加载（解析 + F1/F2/F3-enum/F7/F8/F9，不跑 fs 存在性与交叉校验）：
 * 供 agent-manifest.service 惰性派生使用（P1）。启动时 loadSkillsFile 已 fail-fast
 * 保证文件合法，运行时只需确定性数据。结果进程级缓存。
 */
export function loadSkillsBookRaw(): SkillsBook {
  if (!cachedRawBook) {
    let rawText: string;
    try {
      rawText = fs.readFileSync(SKILLS_FILE_PATH, 'utf-8');
    } catch (error) {
      throw new Error(`[skills.yaml] 读取失败：${SKILLS_FILE_PATH}（${error instanceof Error ? error.message : String(error)}）`);
    }
    cachedRawBook = parseSkillsText(rawText, SKILLS_FILE_PATH, getTopLevelAgentIds());
  }
  return cachedRawBook;
}

/** 活跃集（F8/F9/F12 对账基准） */
export function getActiveSkillIds(book?: SkillsBook): Set<string> {
  const source = book || loadSkillsBookRaw();
  return new Set(source.skills.map((entry) => entry.skillId));
}

/** parentAgent → skillIds（agentMembers 派生源，文件顺序即成员顺序） */
export function getParentAgentMembers(book?: SkillsBook): Map<string, string[]> {
  const source = book || loadSkillsBookRaw();
  const map = new Map<string, string[]>();
  for (const entry of source.skills) {
    if (!entry.parentAgent) continue;
    const members = map.get(entry.parentAgent) || [];
    members.push(`skill:${entry.skillId}`);
    map.set(entry.parentAgent, members);
  }
  return map;
}

/** 注册存在性校验（F11）的查表分派：缺省推导（mainline/aux/handler-only → skillHandlers） */
export function resolveRegistrationPoint(entry: SkillEntry): RegistrationPoint {
  return entry.registrationPoint || 'skillHandlers';
}

/**
 * F12 差额明细（供 skills:check 输出）：manifest skill 条目 ↔ 户口簿活跃集 双向 diff。
 */
export function diffSkillsBookWithManifest(book: SkillsBook): {
  manifestWithoutBook: string[];
  bookWithoutManifest: { skillId: string; kind: SkillKind }[];
} {
  const manifestSkillIds = new Set(
    listRawManifestEntries()
      .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
      .map((item) => item.id.slice('skill:'.length)),
  );
  const manifestWithoutBook = [...manifestSkillIds].filter((id) => !book.skills.some((entry) => entry.skillId === id)).sort();
  const bookWithoutManifest = book.skills
    .filter((entry) => !manifestSkillIds.has(entry.skillId))
    .map((entry) => ({ skillId: entry.skillId, kind: entry.kind }));
  return { manifestWithoutBook, bookWithoutManifest };
}
