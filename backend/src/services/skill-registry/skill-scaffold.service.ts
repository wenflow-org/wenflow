/**
 * Skill scaffold 服务（SCAFFOLD_P5_SURVEY §5 / SKILL_READINESS_SPEC §5 步骤 1）
 *
 * POST /api/admin/skills/scaffold 的确定性写盘核心（纯模板拼装，无 LLM）。
 * 把"6~7 处手写动作"收敛为 1 次请求，并保证每个生成物通过对应校验器：
 *   - core.yaml 骨架          → parseCoreFile（写盘前内存校验）
 *   - skills.yaml 条目        → validateSkillsContent（追加后校验）
 *   - 编排文件 contracts 追加 → parseOrchestrationFile（追加后校验）
 *   - handler 占位（可编译）  → 不注册进 skillHandlers（启动安全，失败面收敛在调用点）
 *
 * 生成物按 kind 差异：
 *   mainline      core.yaml 骨架 + skills.yaml 条目 + 编排 contracts 追加 + handler 占位
 *   aux           core.yaml 骨架 + skills.yaml 条目 + handler 占位（仅满足 F5；
 *                 实际注册在 v4-aux-skills/index.ts，4 处修改片段作为文本返回）
 *   handler-only  skills.yaml 条目（noPromptFile=true，无 coreFile）+ handler 占位
 *
 * 幂等语义（以 skills.yaml 为唯一状态事实，SKILLS_YAML_SPEC §4.2）：
 *   - 条目存在且该 kind 全部生成物齐备 → already-exists（路由 → 409）
 *   - 条目存在但部分生成物缺失       → 补齐缺失生成物（status=completed，幂等重放）
 *   - 条目不存在                     → 全量生成（status=created）
 *
 * 写盘顺序：core.yaml → handler 占位 → 编排 contracts → skills.yaml 条目（提交点）。
 * 每次写盘前备份受影响文件到 prompts/backups/scaffold/<ts>/（仿既有备份模式）；
 * 新文件（handler 占位）无需备份。
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import {
  REPO_ROOT,
  SKILLS_FILE_PATH,
  SKILL_KINDS,
  SKILL_STAGES,
  loadSkillsBookRaw,
  validateSkillsContent,
  invalidateSkillsFileCache,
  type SkillKind,
  type SkillsBook,
} from './skills-file';
import { CORE_FILES_DIR, parseCoreFile, type CoreFile } from '../prompt-lab/core-file-loader';
import { serializeCoreFile } from '../prompt-lab/core-yaml-writer';
import { ORCHESTRATION_DIR, parseOrchestrationFile } from '../field-routing/orchestration-file';
import { listRawManifestEntries } from '../agent-manifest.service';
import type { SkillCompletionReport } from './skill-completion.service';

export interface ScaffoldRequest {
  skillId: string;
  kind: SkillKind;
  /** mainline 必填（∈ goal/path/teaching/profile/simulation）；aux/handler-only 可选 */
  stage?: string;
  /** mainline 必填（∈ manifest kind=agent 条目）；aux/handler-only 可选 */
  parentAgent?: string;
  displayName?: string;
  description?: string;
  aliases?: string[];
}

export interface ScaffoldResult {
  skillId: string;
  kind: SkillKind;
  /** created = 全量新建；completed = 部分存在补齐（幂等重放） */
  status: 'created' | 'completed';
  /** 本次实际写入/追加的文件清单（仓库相对路径） */
  generated: string[];
  completion: SkillCompletionReport;
  /** 注册/接线片段（文本，不落盘；按 kind 差异返回） */
  snippets: Array<{ title: string; content: string }>;
  note: string;
}

export type ScaffoldOutcome =
  | { status: 'already-exists'; skillId: string; completion: SkillCompletionReport }
  | ScaffoldResult;

/** 输入非法（400） */
export class ScaffoldInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldInputError';
  }
}

/** 冲突（409）：skillId/alias 已存在或目录占用 */
export class ScaffoldConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldConflictError';
  }
}

export interface ScaffoldDeps {
  /** 户口簿文件路径（默认 SKILLS_FILE_PATH） */
  skillsFilePath?: string;
  /** core 目录（默认 CORE_FILES_DIR） */
  coreDir?: string;
  /** 编排目录（默认 ORCHESTRATION_DIR） */
  orchestrationDir?: string;
  /** backend/src/skills 目录（默认 REPO_ROOT/backend/src/skills） */
  skillsDir?: string;
  /** 备份根目录（默认 REPO_ROOT/prompts/backups/scaffold） */
  backupsRoot?: string;
  /** 户口簿加载器（默认 loadSkillsBookRaw；测试注入内存书避免读真实仓库） */
  bookLoader?: () => SkillsBook;
  /** 完成度装配（默认 getSkillCompletion；测试注入假报告避免 DB） */
  completionLoader?: (skillId: string) => Promise<SkillCompletionReport>;
  /** 时钟（默认 new Date） */
  now?: () => Date;
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function asNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new ScaffoldInputError(`${label} 必须为非空字符串`);
  }
  return value.trim();
}

/* ------------------------------------------------------------------ */
/* 骨架与占位模板                                                       */
/* ------------------------------------------------------------------ */

/**
 * 最小合法 core.yaml 骨架（validateCoreFileShape 可过）：
 * channels: [task]；identity/rules/fields 带 TODO 占位标记（core-ready 判定识别，
 * 完成度停在 handler-ready，直到 admin 在 SkillDesignPage 填真实内容）。
 * 骨架按 generic-chat.yaml 的 25/25 存量惯例显式声明 stateAdvance/deltaOutput/outputMedia。
 */
export function buildCoreSkeleton(skillId: string): CoreFile {
  return {
    skillId,
    baseVersion: 1,
    identity: 'TODO: 填写本 Skill 的身份与职责（scaffold 骨架占位，消除 TODO 后完成度推进到 core-ready）',
    channels: ['task'],
    stateAdvance: false,
    rules: ['TODO: 填写行为规则（scaffold 骨架占位，至少一条非空规则）'],
    fields: [
      {
        name: 'reply',
        type: 'string',
        optional: false,
        desc: 'TODO: 填写输出字段说明（scaffold 骨架占位）',
        turn: false,
      },
    ],
    constraints: [],
    params: { temperature: 0.5, maxTokens: 4000, failurePolicy: 'fallback' },
    deltaOutput: false,
    outputMedia: 'json',
  };
}

/** handler 占位源码：最小可编译 TS（无外部依赖），导出占位函数抛 SC_NOT_IMPLEMENTED。 */
export function buildPlaceholderHandlerSource(skillId: string): string {
  const camel = skillId.replace(/-([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase());
  return [
    '/**',
    ` * ${skillId} —— scaffold 占位 handler（SC_NOT_IMPLEMENTED）`,
    ' *',
    ' * 由 POST /api/admin/skills/scaffold 生成：满足 skills:check F5（handlerRef 文件存在）。',
    ' * 本占位不注册进 skillHandlers（注册片段仅返回文本）；实现完成后直接覆盖本文件，',
    ' * 并把返回的注册片段粘贴进 skills/index.ts（aux 为 v4-aux-skills/index.ts 4 处修改）。',
    ' */',
    '',
    '/**',
    ' * 占位 handler：实现完成后替换为本 Skill 的真实执行逻辑（SkillHandler = (input) => Promise<any>）。',
    ' * 若在实现前被调用，将抛出 SC_NOT_IMPLEMENTED（skill 级失败，失败面收敛在调用点）。',
    ' */',
    `export async function ${camel}Handler(_input: unknown): Promise<never> {`,
    `  throw new Error('SC_NOT_IMPLEMENTED: ${skillId} 尚未实现（scaffold 占位）');`,
    '}',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 文本级追加（保留原文件注释/排版）                                     */
/* ------------------------------------------------------------------ */

/** skills.yaml 追加条目的 YAML 文本（2 空格条目缩进，字段序对齐存量惯例） */
export function buildSkillEntryYaml(
  input: ScaffoldRequest,
  handlerRef: string,
  coreFile: string | undefined,
  now: Date = new Date(),
): string {
  const kind = input.kind;
  const doc: Record<string, unknown> = {
    skillId: input.skillId,
    kind,
  };
  if (input.stage !== undefined) doc.stage = input.stage;
  if (input.parentAgent !== undefined) doc.parentAgent = input.parentAgent;
  doc.handlerRef = handlerRef;
  if (coreFile !== undefined) doc.coreFile = coreFile;
  if (kind === 'handler-only') doc.noPromptFile = true;
  if (input.displayName !== undefined) doc.displayName = input.displayName;
  if (input.description !== undefined) doc.description = input.description;
  if (input.aliases && input.aliases.length > 0) doc.aliases = input.aliases;
  doc.notes = `scaffold 生成（${now.toISOString().slice(0, 10)}）；注册片段未粘贴前处于 draft 态`;
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, noCompatMode: true }).trimEnd();
  const lines = dumped.split('\n');
  return `\n  - ${lines[0]}\n    ${lines.slice(1).join('\n    ')}`;
}

/** 定位编排文件 contracts 块：返回 { startIdx, endIdx }（endIdx = 块后第一个列 0 非注释行；EOF 用 lines.length） */
function findContractsBlock(lines: string[]): { startIdx: number; endIdx: number } | null {
  const startIdx = lines.findIndex((line) => /^contracts:\s*(#.*)?$/.test(line));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx };
}

/** 编排文件 contracts 追加 `- agentId: skill:<id>`（块感知，重复追加安全） */
export function appendContractEntry(orchestrationText: string, skillId: string): string | null {
  const lines = orchestrationText.split('\n');
  const block = findContractsBlock(lines);
  if (!block) return null;
  const agentId = `skill:${skillId}`;
  const already = lines.slice(block.startIdx, block.endIdx).some((line) => line.trim() === `- agentId: ${agentId}`);
  if (already) return orchestrationText;
  lines.splice(block.endIdx, 0, `  - agentId: ${agentId}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 字段级追加（M1 统一编辑：加字段向导双文件生成）                        */
/* appendFieldToCore / appendFieldToOrchestration 为纯文本级插入，        */
/* 保留原文件注释与排版（与 appendContractEntry 同源；追加后由调用方       */
/* parseCoreFile / validateOrchestrationContent 硬性校验）。              */
/* ------------------------------------------------------------------ */

/** 定位 YAML 顶层块（`<header>:` 起始；endIdx = 块后第一个列 0 非注释行，EOF 用 lines.length） */
function findTopLevelBlock(lines: string[], header: string): { startIdx: number; endIdx: number } | null {
  const startIdx = lines.findIndex((line) => new RegExp(`^${header}:\\s*(#.*)?$`).test(line));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx };
}

/** 标量 → 确定性 YAML 文本（多行字符串产出块标量；特殊字符自动加引号） */
function scalarDumpLines(value: string): string[] {
  return yaml.dump(value, { lineWidth: -1, noRefs: true, noCompatMode: true }).trimEnd().split('\n');
}

/** core.yaml fields 追加条目（key 序对齐 serializeCoreFile：name/type/desc/turn） */
function buildCoreFieldEntryLines(spec: CoreFieldAppendSpec): string[] {
  const lines: string[] = [`  - name: ${spec.name}`, `    type: ${spec.type}`];
  const descLines = scalarDumpLines(spec.desc);
  lines.push(`    desc: ${descLines[0]}`);
  for (const line of descLines.slice(1)) lines.push(`      ${line}`);
  if (spec.turn) lines.push('    turn: true');
  return lines;
}

/** 编排文件 fields 追加条目（key 序对齐存量惯例：fieldId/promptRole/valueType/path/persistKey/description/锁） */
function buildOrchestrationFieldEntryLines(field: OrchestrationFieldAppendSpec): string[] {
  const lines: string[] = [
    `  - fieldId: ${field.fieldId}`,
    `    promptRole: ${field.promptRole}`,
    `    valueType: ${field.valueType}`,
  ];
  if (field.pathInRawOutput) lines.push(`    pathInRawOutput: ${scalarDumpLines(field.pathInRawOutput)[0]}`);
  if (field.persistKey) lines.push(`    persistKey: ${scalarDumpLines(field.persistKey)[0]}`);
  const descLines = scalarDumpLines(field.description);
  lines.push(`    description: ${descLines[0]}`);
  for (const line of descLines.slice(1)) lines.push(`      ${line}`);
  if (field.systemLocked) lines.push('    systemLocked: true');
  if (field.structureLocked) lines.push('    structureLocked: true');
  return lines;
}

/** 编排文件 routings 追加条目（handoff 用流式数组对齐存量惯例） */
function buildOrchestrationRoutingEntryLines(routing: OrchestrationRoutingAppendSpec): string[] {
  const lines: string[] = [
    `  - agentId: ${routing.agentId}`,
    `    fieldId: ${routing.fieldId}`,
    `    render: ${routing.render}`,
    `    handoff: [${routing.handoff.join(', ')}]`,
    `    internal: ${routing.internal ? 'true' : 'false'}`,
    `    accumulate: ${routing.accumulate ? 'true' : 'false'}`,
  ];
  if (routing.visibilityPreset) lines.push(`    visibilityPreset: ${routing.visibilityPreset}`);
  return lines;
}

export interface CoreFieldAppendSpec {
  /** core 字段名（顶层直配 = 字段名；嵌套形态 = 顶层 object 名） */
  name: string;
  /** core 类型（受控词表，可带 ? 后缀） */
  type: string;
  desc: string;
  /** 当轮消费即弃（仅顶层直配生效） */
  turn?: boolean;
  /** 嵌套子字段说明（name 含点分时追加到顶层 object 的 desc；顶层直配忽略） */
  children?: Array<{ path: string; type: string; desc: string }>;
}

export interface OrchestrationFieldAppendSpec {
  fieldId: string;
  promptRole: string;
  valueType: string;
  pathInRawOutput?: string;
  persistKey?: string;
  description: string;
  systemLocked?: boolean;
  structureLocked?: boolean;
}

export interface OrchestrationRoutingAppendSpec {
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  visibilityPreset?: string;
}

/** 嵌套字段追加到顶层 object 的 desc 说明（对齐 goal-conversation.yaml 子字段列表惯例） */
export function buildNestedChildNotes(children: Array<{ path: string; type: string; desc: string }>): string {
  return children.map((child) => `· ${child.path}（${child.type}）${child.desc}`).join('\n');
}

/**
 * core.yaml 文本级字段追加（保留原文件注释/排版）：
 * - 顶层直配（name 无点分）：fields 段末尾追加 `- name: …/type/desc(/turn)`
 * - 嵌套形态（name 含点分）：顶层 object 存在则仅补 desc 子字段说明（保留原块标量；
 *   无则追加 object 顶层 + desc 列子字段）
 */
export function appendFieldToCore(coreText: string, spec: CoreFieldAppendSpec): string {
  const lines = coreText.replace(/\r\n/g, '\n').split('\n');
  const block = findTopLevelBlock(lines, 'fields');
  if (!block) throw new Error('[field-append] core.yaml 缺少 fields 段');

  const segments = spec.name.split('.');
  if (segments.length === 1) {
    // 顶层直配：fields 块末尾追加（endIdx 前补空白行，保持块间分隔）
    const entryLines = buildCoreFieldEntryLines(spec);
    const insertAt = block.endIdx;
    const needBlank = insertAt > 0 && lines[insertAt - 1].trim() !== '';
    lines.splice(insertAt, 0, ...(needBlank ? [''] : []), ...entryLines);
    return lines.join('\n') + '\n';
  }

  // 嵌套形态
  const root = segments[0];
  const children = spec.children?.length
    ? spec.children
    : [{ path: segments.slice(1).join('.'), type: spec.type, desc: spec.desc }];
  const entryStart = lines.findIndex((line) => new RegExp(`^  - name:\\s*${root}\\s*$`).test(line));
  if (entryStart === -1) {
    // 顶层 object 不存在：追加 object 字段，desc 列子字段
    const note = buildNestedChildNotes(children);
    const objectSpec: CoreFieldAppendSpec = {
      name: root,
      type: 'object',
      desc: `包含子字段：\n${note}`,
    };
    const entryLines = buildCoreFieldEntryLines(objectSpec);
    const insertAt = block.endIdx;
    const needBlank = insertAt > 0 && lines[insertAt - 1].trim() !== '';
    lines.splice(insertAt, 0, ...(needBlank ? [''] : []), ...entryLines);
    return lines.join('\n') + '\n';
  }

  // 顶层 object 存在：定位该条目内 desc 标量跨度，追加子字段说明
  let entryEnd = block.endIdx;
  for (let i = entryStart + 1; i < block.endIdx; i += 1) {
    if (/^  - /.test(lines[i])) {
      entryEnd = i;
      break;
    }
  }
  let descIdx = -1;
  for (let i = entryStart + 1; i < entryEnd; i += 1) {
    if (/^ {4}desc:/.test(lines[i])) {
      descIdx = i;
      break;
    }
  }
  if (descIdx === -1) throw new Error(`[field-append] core.yaml 顶层字段 "${root}" 缺少 desc 键`);
  // desc 标量跨度 = desc 行起，至下一同级键（缩进 ≤ 4）或下一条目/块尾
  let spanEnd = entryEnd;
  for (let i = descIdx + 1; i < entryEnd; i += 1) {
    if (/^ {4}[A-Za-z0-9_-]+:/.test(lines[i]) || /^ {2}- /.test(lines[i]) || !lines[i].startsWith(' ')) {
      spanEnd = i;
      break;
    }
  }
  const parsed = yaml.load(coreText) as { fields?: Array<Record<string, unknown>> };
  const existingField = (parsed?.fields || []).find((field) => String(field.name).trim() === root);
  const existingDesc = existingField && typeof existingField.desc === 'string' ? existingField.desc : '';
  const note = buildNestedChildNotes(children);
  const newDesc = existingDesc.trim() ? `${existingDesc.trimEnd()}\n${note}` : note;
  const newScalar = scalarDumpLines(newDesc);
  const replacement = [`    desc: ${newScalar[0]}`, ...newScalar.slice(1).map((line) => `      ${line}`)];
  lines.splice(descIdx, spanEnd - descIdx, ...replacement);
  return lines.join('\n') + '\n';
}

/**
 * 编排文件文本级字段追加：fields 段末尾（routings 段前）追加 1 行字段定义，
 * routings 段末尾追加 1 行路由（agentId=skill:<id>）。保留原文件注释/排版。
 */
export function appendFieldToOrchestration(
  orchestrationText: string,
  field: OrchestrationFieldAppendSpec,
  routing: OrchestrationRoutingAppendSpec,
): string {
  const lines = orchestrationText.replace(/\r\n/g, '\n').split('\n');
  const fieldsBlock = findTopLevelBlock(lines, 'fields');
  const routingsBlock = findTopLevelBlock(lines, 'routings');
  if (!fieldsBlock || !routingsBlock) throw new Error('[field-append] 编排文件缺少 fields/routings 段');

  const fieldEntryLines = buildOrchestrationFieldEntryLines(field);
  const routingEntryLines = buildOrchestrationRoutingEntryLines(routing);

  // fields：插到 routings 段之前（保留块内尾部注释）
  const fieldInsertAt = routingsBlock.startIdx;
  const needFieldBlank = fieldInsertAt > 0 && lines[fieldInsertAt - 1].trim() !== '';
  lines.splice(fieldInsertAt, 0, ...(needFieldBlank ? [''] : []), ...fieldEntryLines);

  // routings：追加到文件末尾
  if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
  lines.push(...routingEntryLines);

  return lines.join('\n').trimEnd() + '\n';
}

/* ------------------------------------------------------------------ */
/* 字段级修改 / 删除（M3 统一编辑：改/删字段原子 API 的双文件文本级操作）    */
/* updateFieldInCore / updateFieldInOrchestration / deleteFieldFromCore / */
/* deleteFieldFromOrchestration 为纯文本级操作，保留原文件注释与排版；      */
/* 追加后由调用方 parseCoreFile / validateOrchestrationContent 硬性校验。  */
/* ------------------------------------------------------------------ */

export interface CoreFieldUpdateSpec {
  /** 字段名（顶层直配 = 顶层字段名；嵌套 = root.sub 点分） */
  name: string;
  /** 顶层直配：core 类型（受控词表，可带 ? 后缀） */
  type?: string;
  /** 顶层直配：desc 替换 */
  desc?: string;
  /** 顶层直配：turn 显式设置（true = 加行；false = 删行） */
  turn?: boolean;
  /** 嵌套：子字段说明（path 相对 root；替换 desc 中的 `· path（type）desc` 块） */
  child?: { path: string; type: string; desc: string };
}

export interface OrchestrationFieldUpdateSpec {
  fieldId: string;
  promptRole?: string;
  valueType?: string;
  /** null = 移除声明行 */
  pathInRawOutput?: string | null;
  /** null = 移除声明行 */
  persistKey?: string | null;
  description?: string;
  /** false/null = 移除 systemLocked 行 */
  systemLocked?: boolean | null;
  /** false/null = 移除 structureLocked 行 */
  structureLocked?: boolean | null;
}

export interface OrchestrationRoutingUpdateSpec {
  agentId: string;
  fieldId: string;
  render?: string;
  handoff?: string[];
  internal?: boolean;
  accumulate?: boolean;
  /** null = 移除声明行 */
  visibilityPreset?: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 拆行并剥离尾部空行（文本级操作统一收尾：join('\n') + '\n' 精确还原单换行结尾，防链式编辑累积空行） */
function splitLinesPreserving(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 顶层字段条目块：定位 `- name: X` 起始与条目结束（下一 `- name:` 或块尾） */
function findCoreFieldEntryBlock(lines: string[], name: string): { startIdx: number; endIdx: number } | null {
  const block = findTopLevelBlock(lines, 'fields');
  if (!block) return null;
  const startIdx = lines.findIndex((line) => new RegExp(`^  - name:\\s*${escapeRegExp(name)}\\s*$`).test(line));
  if (startIdx === -1) return null;
  let endIdx = block.endIdx;
  for (let i = startIdx + 1; i < block.endIdx; i += 1) {
    if (/^  - /.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx };
}

/** 定位顶层字段条目内 desc 标量跨度（desc 行起，至下一 4 缩进键 / 条目 / 块尾） */
function findDescScalarSpan(lines: string[], entryStart: number, entryEnd: number): { descIdx: number; spanEnd: number } | null {
  let descIdx = -1;
  for (let i = entryStart; i < entryEnd; i += 1) {
    if (/^ {4}desc:/.test(lines[i])) {
      descIdx = i;
      break;
    }
  }
  if (descIdx === -1) return null;
  let spanEnd = entryEnd;
  for (let i = descIdx + 1; i < entryEnd; i += 1) {
    if (/^ {4}[A-Za-z0-9_-]+:/.test(lines[i]) || /^ {2}- /.test(lines[i]) || !lines[i].startsWith(' ')) {
      spanEnd = i;
      break;
    }
  }
  return { descIdx, spanEnd };
}

/**
 * core.yaml 文本级字段修改（保留原文件注释/排版）：
 * - 顶层直配：替换 type 行 / desc 标量 / turn 行（按需增删）
 * - 嵌套形态：替换顶层 object 的 desc 中 `· <path>（<type>）<desc>` 子字段说明块
 */
export function updateFieldInCore(coreText: string, spec: CoreFieldUpdateSpec): string {
  const lines = splitLinesPreserving(coreText);
  const segments = spec.name.split('.');
  const block = findTopLevelBlock(lines, 'fields');
  if (!block) throw new Error('[field-update] core.yaml 缺少 fields 段');

  if (segments.length === 1) {
    const entry = findCoreFieldEntryBlock(lines, spec.name);
    if (!entry) throw new Error(`[field-update] core.yaml 未找到顶层字段 "${spec.name}"`);
    let entryLines = lines.slice(entry.startIdx, entry.endIdx);

    const replaceScalar = (key: string, value: string): void => {
      const idx = entryLines.findIndex((line) => new RegExp(`^ {4}${key}:`).test(line));
      if (idx === -1) throw new Error(`[field-update] core.yaml 顶层字段 "${spec.name}" 缺少 ${key} 键`);
      let spanEnd = idx + 1;
      while (
        spanEnd < entryLines.length
        && entryLines[spanEnd].startsWith('      ')
        && !/^ {4}[A-Za-z0-9_-]+:/.test(entryLines[spanEnd])
      ) {
        spanEnd += 1;
      }
      const scalar = scalarDumpLines(value);
      const replacement = [`    ${key}: ${scalar[0]}`, ...scalar.slice(1).map((line) => `      ${line}`)];
      entryLines = [...entryLines.slice(0, idx), ...replacement, ...entryLines.slice(spanEnd)];
    };

    if (spec.type !== undefined) {
      const idx = entryLines.findIndex((line) => /^ {4}type:/.test(line));
      if (idx === -1) throw new Error(`[field-update] core.yaml 顶层字段 "${spec.name}" 缺少 type 键`);
      entryLines[idx] = `    type: ${spec.type}`;
    }
    if (spec.desc !== undefined) replaceScalar('desc', spec.desc);
    if (spec.turn !== undefined) {
      const idx = entryLines.findIndex((line) => /^ {4}turn:/.test(line));
      if (spec.turn) {
        if (idx === -1) {
          const span = findDescScalarSpan(entryLines, 0, entryLines.length);
          const insertAt = span ? span.spanEnd : entryLines.length;
          entryLines = [...entryLines.slice(0, insertAt), '    turn: true', ...entryLines.slice(insertAt)];
        }
      } else if (idx !== -1) {
        entryLines.splice(idx, 1);
      }
    }

    lines.splice(entry.startIdx, entry.endIdx - entry.startIdx, ...entryLines);
    return lines.join('\n') + '\n';
  }

  // ---- 嵌套形态：替换顶层 object desc 中的子字段说明块 ----
  const root = segments[0];
  const entry = findCoreFieldEntryBlock(lines, root);
  if (!entry) throw new Error(`[field-update] core.yaml 未找到顶层字段 "${root}"（嵌套字段 "${spec.name}" 的承载）`);
  const span = findDescScalarSpan(lines, entry.startIdx, entry.endIdx);
  if (!span) throw new Error(`[field-update] core.yaml 顶层字段 "${root}" 缺少 desc 键`);
  if (!spec.child) throw new Error(`[field-update] 嵌套字段 "${spec.name}" 必须提供 child 子字段说明`);
  const noteRe = new RegExp(`^\\s*·\\s*${escapeRegExp(spec.child.path)}\\s*（`);
  const spanLines = lines.slice(span.descIdx, span.spanEnd);
  const noteIdx = spanLines.findIndex((line) => noteRe.test(line));
  if (noteIdx === -1) {
    throw new Error(`[field-update] core.yaml 顶层字段 "${root}" 的 desc 未找到子字段说明 "${spec.child.path}"`);
  }
  let noteEnd = noteIdx + 1;
  while (noteEnd < spanLines.length && !/^\s*·\s/.test(spanLines[noteEnd])) {
    noteEnd += 1;
  }
  const indent = (spanLines[noteIdx].match(/^\s*/) || [''])[0];
  lines.splice(span.descIdx + noteIdx, noteEnd - noteIdx, `${indent}· ${spec.child.path}（${spec.child.type}）${spec.child.desc}`);
  return lines.join('\n') + '\n';
}

export interface CoreFieldDeleteResult {
  text: string;
  /** 被整体移除的顶层条目名（顶层删除或嵌套级联删除 root 时） */
  removedEntry: string | null;
  /** 仅移除子字段说明块（嵌套，root 条目保留） */
  removedChildNote: boolean;
}

/**
 * core.yaml 文本级字段删除：
 * - 顶层直配：整块移除 `- name: X` 条目（含前置空行）
 * - 嵌套形态：移除顶层 object desc 中的 `· <path>…` 子字段说明块（root 条目保留，由调用方决定级联）
 */
export function deleteFieldFromCore(coreText: string, name: string): CoreFieldDeleteResult {
  const lines = splitLinesPreserving(coreText);
  const segments = name.split('.');
  const block = findTopLevelBlock(lines, 'fields');
  if (!block) throw new Error('[field-delete] core.yaml 缺少 fields 段');

  if (segments.length === 1) {
    const entry = findCoreFieldEntryBlock(lines, name);
    if (!entry) throw new Error(`[field-delete] core.yaml 未找到顶层字段 "${name}"`);
    const before = entry.startIdx > 0 && lines[entry.startIdx - 1].trim() === '' ? entry.startIdx - 1 : entry.startIdx;
    lines.splice(before, entry.endIdx - before);
    return { text: lines.join('\n') + '\n', removedEntry: name, removedChildNote: false };
  }

  const root = segments[0];
  const entry = findCoreFieldEntryBlock(lines, root);
  if (!entry) throw new Error(`[field-delete] core.yaml 未找到顶层字段 "${root}"（嵌套字段 "${name}" 的承载）`);
  const span = findDescScalarSpan(lines, entry.startIdx, entry.endIdx);
  if (!span) throw new Error(`[field-delete] core.yaml 顶层字段 "${root}" 缺少 desc 键`);
  const childPath = segments.slice(1).join('.');
  const noteRe = new RegExp(`^\\s*·\\s*${escapeRegExp(childPath)}\\s*（`);
  const spanLines = lines.slice(span.descIdx, span.spanEnd);
  const noteIdx = spanLines.findIndex((line) => noteRe.test(line));
  if (noteIdx === -1) {
    throw new Error(`[field-delete] core.yaml 顶层字段 "${root}" 的 desc 未找到子字段说明 "${childPath}"`);
  }
  let noteEnd = noteIdx + 1;
  while (noteEnd < spanLines.length && !/^\s*·\s/.test(spanLines[noteEnd])) {
    noteEnd += 1;
  }
  lines.splice(span.descIdx + noteIdx, noteEnd - noteIdx);
  return { text: lines.join('\n') + '\n', removedEntry: null, removedChildNote: true };
}

/** 条目块内定位键行并设置（value 为 null 时移除该行；缺行时追加到条目末尾） */
function setEntryKey(entryLines: string[], key: string, value: string | null, indent = '    '): string[] {
  const re = new RegExp(`^${indent}${key}:`);
  const idx = entryLines.findIndex((line) => re.test(line));
  if (idx === -1) {
    if (value === null) return entryLines;
    return [...entryLines, `${indent}${key}: ${value}`];
  }
  if (value === null) {
    return [...entryLines.slice(0, idx), ...entryLines.slice(idx + 1)];
  }
  const next = [...entryLines];
  next[idx] = `${indent}${key}: ${value}`;
  return next;
}

/** 替换条目内 desc 标量（多行 desc 走块标量行内替换） */
function replaceEntryDesc(entryLines: string[], value: string, indent = '    '): string[] {
  const idx = entryLines.findIndex((line) => new RegExp(`^${indent}desc(ription)?:`).test(line));
  if (idx === -1) throw new Error('[field-update] 条目缺少 desc/description 键');
  let spanEnd = idx + 1;
  while (
    spanEnd < entryLines.length
    && entryLines[spanEnd].startsWith(`${indent}  `)
    && !new RegExp(`^${indent}[A-Za-z0-9_-]+:`).test(entryLines[spanEnd])
  ) {
    spanEnd += 1;
  }
  const scalar = scalarDumpLines(value);
  const replacement = [`${indent}description: ${scalar[0]}`, ...scalar.slice(1).map((line) => `${indent}  ${line}`)];
  return [...entryLines.slice(0, idx), ...replacement, ...entryLines.slice(spanEnd)];
}

/**
 * 编排文件文本级字段修改（保留原文件注释/排版）：
 * fields 段条目（fieldId）键级修改 + routings 段条目（agentId+fieldId）键级修改。
 */
export function updateFieldInOrchestration(
  orchestrationText: string,
  field: OrchestrationFieldUpdateSpec,
  routing: OrchestrationRoutingUpdateSpec,
): string {
  const lines = splitLinesPreserving(orchestrationText);
  const fieldsBlock = findTopLevelBlock(lines, 'fields');
  const routingsBlock = findTopLevelBlock(lines, 'routings');
  if (!fieldsBlock || !routingsBlock) throw new Error('[field-update] 编排文件缺少 fields/routings 段');

  // ---- fields 条目 ----
  const fieldEntryStart = lines.findIndex(
    (line) => new RegExp(`^  - fieldId:\\s*${escapeRegExp(field.fieldId)}\\s*$`).test(line),
  );
  if (fieldEntryStart === -1 || fieldEntryStart >= routingsBlock.startIdx) {
    throw new Error(`[field-update] 编排文件未找到字段定义 "${field.fieldId}"`);
  }
  let fieldEntryEnd = routingsBlock.startIdx;
  for (let i = fieldEntryStart + 1; i < routingsBlock.startIdx; i += 1) {
    if (/^  - /.test(lines[i])) {
      fieldEntryEnd = i;
      break;
    }
  }
  let fieldLines = lines.slice(fieldEntryStart, fieldEntryEnd);
  if (field.promptRole !== undefined) fieldLines = setEntryKey(fieldLines, 'promptRole', field.promptRole);
  if (field.valueType !== undefined) fieldLines = setEntryKey(fieldLines, 'valueType', field.valueType);
  if (field.pathInRawOutput !== undefined) {
    fieldLines = setEntryKey(fieldLines, 'pathInRawOutput', field.pathInRawOutput === null ? null : scalarDumpLines(field.pathInRawOutput)[0]);
  }
  if (field.persistKey !== undefined) {
    fieldLines = setEntryKey(fieldLines, 'persistKey', field.persistKey === null ? null : scalarDumpLines(field.persistKey)[0]);
  }
  if (field.description !== undefined) fieldLines = replaceEntryDesc(fieldLines, field.description);
  if (field.systemLocked !== undefined) fieldLines = setEntryKey(fieldLines, 'systemLocked', field.systemLocked ? 'true' : null);
  if (field.structureLocked !== undefined) {
    fieldLines = setEntryKey(fieldLines, 'structureLocked', field.structureLocked ? 'true' : null);
  }
  lines.splice(fieldEntryStart, fieldEntryEnd - fieldEntryStart, ...fieldLines);

  // ---- routings 条目（agentId + fieldId 双键定位） ----
  let routingEntryStart = -1;
  let routingEntryEnd = lines.length;
  for (let i = routingsBlock.startIdx; i < lines.length; i += 1) {
    if (!/^  - agentId:/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !/^  - agentId:/.test(lines[end]) && !/^[^ #]/.test(lines[end])) end += 1;
    const entry = lines.slice(i, end);
    if (entry.some((line) => new RegExp(`^ {4}fieldId:\\s*${escapeRegExp(routing.fieldId)}\\s*$`).test(line))) {
      routingEntryStart = i;
      routingEntryEnd = end;
      break;
    }
  }
  if (routingEntryStart === -1) {
    throw new Error(`[field-update] 编排文件未找到路由条目 ${routing.agentId}/${routing.fieldId}`);
  }
  let routingLines = lines.slice(routingEntryStart, routingEntryEnd);
  if (routing.render !== undefined) routingLines = setEntryKey(routingLines, 'render', routing.render);
  if (routing.handoff !== undefined) routingLines = setEntryKey(routingLines, 'handoff', `[${routing.handoff.join(', ')}]`);
  if (routing.internal !== undefined) routingLines = setEntryKey(routingLines, 'internal', routing.internal ? 'true' : 'false');
  if (routing.accumulate !== undefined) routingLines = setEntryKey(routingLines, 'accumulate', routing.accumulate ? 'true' : 'false');
  if (routing.visibilityPreset !== undefined) {
    routingLines = setEntryKey(routingLines, 'visibilityPreset', routing.visibilityPreset === null ? null : routing.visibilityPreset);
  }
  lines.splice(routingEntryStart, routingEntryEnd - routingEntryStart, ...routingLines);

  return lines.join('\n') + '\n';
}

export interface OrchestrationFieldDeleteResult {
  text: string;
  routingRemoved: boolean;
  fieldRemoved: boolean;
}

/**
 * 编排文件文本级字段删除：
 * - 移除 routings 段中（agentId, fieldId）路由条目
 * - removeFieldEntry=true 时同时移除 fields 段 fieldId 字段定义条目（调用方保证无其他 agent 引用）
 */
export function deleteFieldFromOrchestration(
  orchestrationText: string,
  fieldId: string,
  agentId: string,
  opts: { removeFieldEntry?: boolean } = {},
): OrchestrationFieldDeleteResult {
  const lines = splitLinesPreserving(orchestrationText);
  const escapedFieldId = escapeRegExp(fieldId);
  const result: OrchestrationFieldDeleteResult = { text: orchestrationText, routingRemoved: false, fieldRemoved: false };

  // ---- 移除路由条目 ----
  let routingStart = -1;
  let routingEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^  - agentId:/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !/^  - agentId:/.test(lines[end]) && !/^[^ #]/.test(lines[end])) end += 1;
    const entry = lines.slice(i, end);
    const isAgent = new RegExp(`^  - agentId:\\s*${escapeRegExp(agentId)}\\s*$`).test(entry[0] || '');
    if (isAgent && entry.some((line) => new RegExp(`^ {4}fieldId:\\s*${escapedFieldId}\\s*$`).test(line))) {
      routingStart = i;
      routingEnd = end;
      break;
    }
  }
  if (routingStart === -1) throw new Error(`[field-delete] 编排文件未找到路由条目 ${agentId}/${fieldId}`);
  const before = routingStart > 0 && lines[routingStart - 1].trim() === '' ? routingStart - 1 : routingStart;
  lines.splice(before, routingEnd - before);
  result.routingRemoved = true;

  // ---- 移除字段定义条目 ----
  if (opts.removeFieldEntry) {
    const fieldsBlock = findTopLevelBlock(lines, 'fields');
    const routingsBlock = findTopLevelBlock(lines, 'routings');
    if (!fieldsBlock || !routingsBlock) throw new Error('[field-delete] 编排文件缺少 fields/routings 段');
    const fieldStart = lines.findIndex((line) => new RegExp(`^  - fieldId:\\s*${escapedFieldId}\\s*$`).test(line));
    if (fieldStart === -1 || fieldStart >= routingsBlock.startIdx) {
      throw new Error(`[field-delete] 编排文件未找到字段定义 "${fieldId}"`);
    }
    let fieldEnd = routingsBlock.startIdx;
    for (let i = fieldStart + 1; i < routingsBlock.startIdx; i += 1) {
      if (/^  - /.test(lines[i])) {
        fieldEnd = i;
        break;
      }
    }
    // 前置空行处理：向导追加的字段条目插在 routings 边界，其前置空行即 fields/routings 块
    // 分隔符（ADD 的 needBlank 在前置行已为空时不新增空行）——删除时必须保留，避免吃掉原分隔符；
    // 块内条目（fieldEnd < routings 头）的前置空行是 ADD 新增的（前置行非空），删除时一并移除。
    const isLastFieldEntry = fieldEnd >= routingsBlock.startIdx;
    const fieldBefore = fieldStart > 0 && lines[fieldStart - 1].trim() === '' && !isLastFieldEntry ? fieldStart - 1 : fieldStart;
    lines.splice(fieldBefore, fieldEnd - fieldBefore);
    result.fieldRemoved = true;
  }

  result.text = lines.join('\n') + '\n';
  return result;
}

/* ------------------------------------------------------------------ */
/* 注册/接线片段（文本返回，不落盘 —— SKILLS_YAML_SPEC:210-215 决策）      */
/* ------------------------------------------------------------------ */

function buildSnippets(input: ScaffoldRequest): Array<{ title: string; content: string }> {
  const { skillId } = input;
  const camel = skillId.replace(/-([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase());
  if (input.kind === 'aux') {
    return [
      {
        title: 'v4-aux-skills/index.ts 4 处修改（aux 实际注册点）',
        content: [
          `// 1) AuxSkillId 联合类型追加：'${skillId}'`,
          `// 2) META 表追加（参考 generic-chat 形态）：`,
          `//    ${skillId}: { name: '${skillId}', displayName: '${input.displayName || skillId}', description: '${input.description || ''}', category: 'generation' },`,
          `// 3) handler 函数（runAux 模板，参考 genericChatHandler）：`,
          `//    async function ${camel}Handler(input: any) {`,
          `//      return runAux({ meta: META['${skillId}'], input,`,
          `//        buildUserPayload: (d) => d.message ?? '',`,
          `//        normalize: (parsed) => typeof parsed === 'string' ? parsed : String(parsed || ''),`,
          `//        validate: (parsed) => typeof parsed === 'string' && parsed.length > 0 ? { valid: true } : { valid: false, failureReason: '${skillId.toUpperCase()}_OUTPUT_EMPTY' },`,
          `//      });`,
          `//    }`,
          `// 4) auxSkillHandlers 映射追加：${skillId}: ${camel}Handler`,
          '',
        ].join('\n'),
      },
    ];
  }
  const snippets: Array<{ title: string; content: string }> = [
    {
      title: 'skills/index.ts 注册片段（两段：定义 + handler）',
      content: [
        `// 1) allSkillDefinitions 数组追加一项（参考既有 definition 形态）：`,
        `//    { name: '${skillId}', version: 1, category: 'generation', description: '${input.description || ''}', capabilities: [], inputSchema: {}, outputSchema: {} },`,
        `// 2) skillHandlers 映射追加：`,
        `//    '${skillId}': (input) => ${camel}Handler(input),`,
        `//    （import { ${camel}Handler } from './${skillId}';）`,
        '',
      ].join('\n'),
    },
    // F12 铁律：mainline/handler-only 必须在 AGENT_MANIFEST 登记（check-skills-file F12 双向一致）。
    // 对照既有 skill 条目（agent-manifest.service.ts:60 AGENT_MANIFEST 数组）的占位结构。
    {
      title: 'agent-manifest.service.ts 条目模板（F12：mainline/handler-only 必须登记，kind=skill）',
      content: [
        `// 粘贴进 AGENT_MANIFEST 数组（backend/src/services/agent-manifest.service.ts:60），字段对照既有 skill 条目：`,
        `{`,
        `  id: 'skill:${skillId}',`,
        `  name: '${input.displayName || skillId} Skill',`,
        `  description: '${input.description || 'TODO: 填写职责描述'}',`,
        `  category: '${input.stage || 'skill'}',`,
        `  kind: 'skill',`,
        `  runtimeEnabled: true,`,
        `  userVisible: false,`,
        ...(input.stage ? [`  monitoringGroup: '${input.stage.charAt(0).toUpperCase()}${input.stage.slice(1)}',`] : []),
        ...(input.aliases && input.aliases.length > 0 ? [`  aliases: ['${input.aliases.join("', '")}'],`] : []),
        `  ioContractVersion: 'agent-output-v1',`,
        `  // 与 core.yaml params / handler codeDefaults 对齐（仅展示/兜底，权威在 ACTIVE prompt）`,
        `  defaultModelConfig: { temperature: 0.5, maxTokens: 4000 },`,
        `},`,
        '',
      ].join('\n'),
    },
  ];
  if (input.kind === 'mainline' && input.parentAgent) {
    snippets.push({
      title: 'coordinator steps 片段（可选，粘贴进户口簿条目 coordinator 块）',
      content: [
        `// 参考存量条目（如 goal-conversation）追加：`,
        `coordinator:`,
        `  agentId: ${input.parentAgent}`,
        `  steps:`,
        `    - { step: 1, role: <填入角色>, condition: <填入触发条件> }`,
        '',
      ].join('\n'),
    });
  }
  return snippets;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function resolveDeps(deps?: ScaffoldDeps): Required<Pick<ScaffoldDeps, 'now'>> & ScaffoldDeps {
  return { ...deps, now: deps?.now ?? (() => new Date()) };
}

function backupFile(filePath: string, backupsRoot: string, name: string, now: Date): void {
  if (!fs.existsSync(filePath)) return;
  const dir = path.join(backupsRoot, now.toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(filePath, path.join(dir, name));
}

/**
 * 确定性 scaffold 主流程。返回：
 *   - { status: 'already-exists' } —— 条目与生成物齐备（路由 → 409）
 *   - ScaffoldResult                —— created / completed
 * 抛出：ScaffoldInputError（400）/ ScaffoldConflictError（409）/ Error（写盘校验失败 → 500）
 */
export async function scaffoldSkill(input: ScaffoldRequest, deps?: ScaffoldDeps): Promise<ScaffoldOutcome> {
  const opts = resolveDeps(deps);
  const now = opts.now();
  const skillsFilePath = opts.skillsFilePath ?? SKILLS_FILE_PATH;
  const coreDir = opts.coreDir ?? CORE_FILES_DIR;
  const orchestrationDir = opts.orchestrationDir ?? ORCHESTRATION_DIR;
  const skillsDir = opts.skillsDir ?? path.resolve(REPO_ROOT, 'backend/src/skills');
  const backupsRoot = opts.backupsRoot ?? path.resolve(REPO_ROOT, 'prompts/backups/scaffold');
  const bookLoader = opts.bookLoader ?? loadSkillsBookRaw;
  const completionLoader = opts.completionLoader ?? (async (skillId: string) => {
    const { getSkillCompletion } = await import('./skill-completion.service');
    return getSkillCompletion(skillId);
  });

  // ---- 输入校验 ----
  const skillId = asNonEmptyString(input.skillId, 'skillId');
  if (!KEBAB_CASE.test(skillId)) {
    throw new ScaffoldInputError(`skillId "${skillId}" 非法（须为 kebab-case，如 goal-conversation）`);
  }
  const kind = input.kind;
  if (!(SKILL_KINDS as readonly string[]).includes(kind)) {
    throw new ScaffoldInputError(`kind "${String(kind)}" 非法（须在 ${SKILL_KINDS.join(',')} 中）`);
  }
  const stage = asNonEmptyString(input.stage, 'stage');
  const parentAgent = asNonEmptyString(input.parentAgent, 'parentAgent');
  if (kind === 'mainline') {
    if (stage === undefined) throw new ScaffoldInputError('kind=mainline 必填 stage（∈ goal/path/teaching/profile/simulation）');
    if (!(SKILL_STAGES as readonly string[]).includes(stage as never)) {
      throw new ScaffoldInputError(`stage "${stage}" 非法（须在 ${SKILL_STAGES.join(',')} 中）`);
    }
    if (parentAgent === undefined) throw new ScaffoldInputError('kind=mainline 必填 parentAgent（∈ manifest kind=agent 条目）');
  } else {
    if (stage !== undefined && !(SKILL_STAGES as readonly string[]).includes(stage as never)) {
      throw new ScaffoldInputError(`stage "${stage}" 非法（须在 ${SKILL_STAGES.join(',')} 中）`);
    }
  }
  const displayName = asNonEmptyString(input.displayName, 'displayName');
  const description = asNonEmptyString(input.description, 'description');
  let aliases: string[] | undefined;
  if (input.aliases !== undefined) {
    if (!Array.isArray(input.aliases)) throw new ScaffoldInputError('aliases 必须为字符串数组');
    aliases = input.aliases.map((alias, i) => {
      const value = asNonEmptyString(alias, `aliases[${i}]`);
      if (!KEBAB_CASE.test(value)) {
        throw new ScaffoldInputError(`aliases[${i}] "${value}" 非法（须为 kebab-case）`);
      }
      return value;
    });
    if (new Set(aliases).size !== aliases.length) throw new ScaffoldInputError('aliases 存在重复');
  }

  // parentAgent ∈ manifest kind=agent 条目（F4 预检，给出友好错误）
  const manifestAgents = new Set(
    listRawManifestEntries().filter((item) => item.kind === 'agent').map((item) => item.id),
  );
  if (parentAgent !== undefined && !manifestAgents.has(parentAgent)) {
    throw new ScaffoldInputError(`parentAgent "${parentAgent}" 不在 manifest kind=agent 条目中（可选：${[...manifestAgents].join(',')}）`);
  }

  // 归一化请求（全部经 asNonEmptyString 规整后进入生成物）
  const normalizedInput: ScaffoldRequest = {
    skillId,
    kind,
    ...(stage !== undefined ? { stage } : {}),
    ...(parentAgent !== undefined ? { parentAgent } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
  };

  const coreFileRel = kind === 'handler-only' ? undefined : `prompts/core/${skillId}.yaml`;
  const handlerRef = `backend/src/skills/${skillId}/index.ts`;

  // ---- 唯一性预检（SKILLS_YAML_SPEC:320 三处：户口簿 + manifest + 目录） ----
  const book = bookLoader();
  const existingEntry = book.skills.find((entry) => entry.skillId === skillId);
  const manifestSkillIds = new Set(
    listRawManifestEntries()
      .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
      .map((item) => item.id.slice('skill:'.length)),
  );
  const manifestAliases = new Set(
    listRawManifestEntries().flatMap((item) => item.aliases || []),
  );
  const skillDir = path.join(skillsDir, skillId);

  if (!existingEntry) {
    if (manifestSkillIds.has(skillId) || manifestAliases.has(skillId)) {
      throw new ScaffoldConflictError(`skillId "${skillId}" 已被 manifest 占用（F9：skillId/alias 全表唯一）`);
    }
    if (fs.existsSync(skillDir)) {
      throw new ScaffoldConflictError(`backend/src/skills/${skillId}/ 目录已存在（唯一性预检），请先移除或换 skillId`);
    }
    for (const alias of aliases || []) {
      if (manifestSkillIds.has(alias) || manifestAliases.has(alias) || book.skills.some((entry) => entry.skillId === alias || (entry.aliases || []).includes(alias))) {
        throw new ScaffoldConflictError(`alias "${alias}" 已被占用（F9：全表唯一）`);
      }
    }
  }

  // ---- 生成物路径与存在性（幂等：存在即跳过；重放以已落盘条目为准） ----
  // 注：scaffold 始终写确定性约定路径（coreDir/skillsDir/orchestrationDir 注入点）；
  // 若用户手工改过条目内路径，超出 scaffold 契约，由 skills:check F5/F6 暴露。
  const effectiveStage = existingEntry ? existingEntry.stage : stage;
  const corePath = coreFileRel ? path.join(coreDir, `${skillId}.yaml`) : null;
  const handlerPath = path.join(skillsDir, skillId, 'index.ts');
  const orchestrationPath = effectiveStage !== undefined ? path.join(orchestrationDir, `${effectiveStage}.yaml`) : null;

  const artifactExists = (() => {
    const needCore = corePath !== null;
    const needContract = orchestrationPath !== null;
    let contractExists = false;
    if (needContract && fs.existsSync(orchestrationPath)) {
      const block = findContractsBlock(fs.readFileSync(orchestrationPath, 'utf-8').split('\n'));
      contractExists = block !== null
        && fs.readFileSync(orchestrationPath, 'utf-8').split('\n').slice(block.startIdx, block.endIdx)
          .some((line) => line.trim() === `- agentId: skill:${skillId}`);
    }
    return {
      core: !needCore || fs.existsSync(corePath),
      handler: fs.existsSync(handlerPath),
      contract: !needContract || contractExists,
      entry: Boolean(existingEntry),
    };
  })();

  if (existingEntry && artifactExists.core && artifactExists.handler && artifactExists.contract) {
    const completion = await completionLoader(skillId);
    return { status: 'already-exists', skillId, completion };
  }

  // ---- 写盘（每次写前备份受影响文件；handler 占位为新建文件无需备份） ----
  const generated: string[] = [];

  // a. core.yaml 骨架（mainline/aux；handler-only 无）
  if (corePath && !artifactExists.core) {
    const core = buildCoreSkeleton(skillId);
    const yamlText = serializeCoreFile(core);
    const checked = parseCoreFile(corePath, yamlText); // 写盘前内存校验（硬性约束）
    if (!checked.core) {
      throw new Error(`[scaffold] core.yaml 骨架未通过 validateCoreFileShape：${checked.diagnostics.map((d) => d.message).join('；')}`);
    }
    backupFile(corePath, backupsRoot, `core-${skillId}.yaml`, now);
    fs.mkdirSync(path.dirname(corePath), { recursive: true });
    fs.writeFileSync(corePath, yamlText, 'utf-8');
    generated.push(coreFileRel!);
  }

  // b. handler 占位（全部 kind：mainline/handler-only 必落盘；aux 落盘仅满足 F5）
  if (!artifactExists.handler) {
    backupFile(handlerPath, backupsRoot, `handler-${skillId}.ts`, now);
    fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
    fs.writeFileSync(handlerPath, buildPlaceholderHandlerSource(skillId), 'utf-8');
    generated.push(handlerRef);
  }

  // c. 编排文件 contracts 追加（mainline F3 铁律）
  if (orchestrationPath && !artifactExists.contract) {
    if (!fs.existsSync(orchestrationPath)) {
      throw new Error(`[scaffold] 编排文件不存在：${orchestrationPath}（stage=${effectiveStage}）`);
    }
    const raw = fs.readFileSync(orchestrationPath, 'utf-8');
    const appended = appendContractEntry(raw, skillId);
    if (appended === null) {
      throw new Error(`[scaffold] 编排文件缺少 contracts 段：${orchestrationPath}`);
    }
    backupFile(orchestrationPath, backupsRoot, `orchestration-${effectiveStage}.yaml`, now);
    fs.writeFileSync(orchestrationPath, appended, 'utf-8');
    const checked = parseOrchestrationFile(orchestrationPath); // 追加后校验（硬性约束）
    if (!checked.contracts.some((contract) => contract.agentId === `skill:${skillId}`)) {
      throw new Error(`[scaffold] 编排文件 contracts 追加校验失败：skill:${skillId} 不在 ${effectiveStage}.yaml contracts`);
    }
    generated.push(`prompts/orchestration/${effectiveStage}.yaml`);
  }

  // d. skills.yaml 条目追加（提交点；追加后 validateSkillsContent 硬性校验）
  if (!existingEntry) {
    const raw = fs.readFileSync(skillsFilePath, 'utf-8');
    const appendedText = `${raw.trimEnd()}${buildSkillEntryYaml(normalizedInput, handlerRef, coreFileRel, now)}\n`;
    backupFile(skillsFilePath, backupsRoot, 'skills.yaml', now);
    fs.writeFileSync(skillsFilePath, appendedText, 'utf-8');
    try {
      validateSkillsContent(fs.readFileSync(skillsFilePath, 'utf-8')); // F1-F12 内存校验
    } catch (error) {
      throw new Error(`[scaffold] skills.yaml 条目追加未通过 validateSkillsContent：${error instanceof Error ? error.message : String(error)}`);
    }
    invalidateSkillsFileCache();
    generated.push('prompts/skills.yaml');
  }

  const completion = await completionLoader(skillId);
  const snippets = buildSnippets(normalizedInput);
  return {
    skillId,
    kind,
    status: existingEntry ? 'completed' : 'created',
    generated,
    completion,
    snippets,
    note: 'handler 未实现前调用会抛 SC_NOT_IMPLEMENTED（占位不注册，启动安全；实现后请粘贴返回的注册片段）；登记进 agent-manifest.service.ts 后 F12 通过（片段见上）',
  };
}

/** scaffold 表单元数据：kind/stage 枚举 + manifest kind=agent 条目（parentAgent 下拉数据源） */
export function getScaffoldMeta(): {
  kinds: readonly SkillKind[];
  stages: readonly string[];
  agents: Array<{ id: string; name: string }>;
} {
  const agents = listRawManifestEntries()
    .filter((item) => item.kind === 'agent')
    .map((item) => ({ id: item.id, name: item.name }));
  return { kinds: SKILL_KINDS, stages: SKILL_STAGES, agents };
}
