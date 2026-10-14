/**
 * 编排文件（orchestration.yaml）加载器 —— 字段路由单源化第一步
 *
 * 编排文件位于 prompts/orchestration/<stage>.yaml，进 git，File-as-Truth。
 * 一个文件声明一个阶段的完整编排结构：
 *   - contracts：agent 契约（agentId 声明；displayName/description 仍由 agent-manifest 派生）
 *   - fields：字段定义（fieldId/promptRole/valueType/锁/路径）
 *   - routings：路由矩阵（agentId × fieldId → render/handoff/internal/accumulate）
 *
 * 本加载器把 yaml 解析为字段路由的标准数据结构，
 * bootstrap 从本加载器取数（seed TS 已退役，编排文件为唯一声明源）。
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { deriveContract } from '../prompt-manifest/seed-contract-helper';
import {
  CORE_VALUE_TYPES,
  PROMPT_ROLES,
  RENDER_VALUES,
  VISIBILITY_PRESETS,
  type PromptRole,
  type RenderValue,
} from '../yaml-vocabulary';
import { cachedFileParse } from '../yaml-file-cache';

/** 兼容 re-export：定义单一源为 yaml-vocabulary（rewrite-output-section / field-routings 既有 import 不变） */
export { PROMPT_ROLES, RENDER_VALUES } from '../yaml-vocabulary';
export type { PromptRole, RenderValue } from '../yaml-vocabulary';

/** 编排文件目录：默认仓库根 prompts/orchestration/，可用 ORCHESTRATION_DIR 覆盖 */
export const ORCHESTRATION_DIR = process.env.ORCHESTRATION_DIR
  ? path.resolve(process.env.ORCHESTRATION_DIR)
  : path.resolve(__dirname, '../../../../prompts/orchestration');

export interface OrchestrationContract {
  agentId: string;
  displayName: string;
  description: string;
}

export interface OrchestrationField {
  fieldId: string;
  promptRole: PromptRole;
  valueType: string;
  snakeName?: string;
  camelName?: string;
  pathInRawOutput?: string;
  /** 落库键/消费键别名：与 fieldId 不一致时标注（如 skill 产出键 acceptanceHint）；缺省 = 落库键与 fieldId 一致 */
  persistKey?: string;
  description: string;
  enumValues?: string[];
  systemLocked?: boolean;
  structureLocked?: boolean;
  bindings?: Record<string, unknown>;
}

export interface OrchestrationRouting {
  agentId: string;
  fieldId: string;
  render: RenderValue;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  visibilityPreset?: string;
  notes?: string;
}

export interface OrchestrationStage {
  stage: string;
  /** 业务顺序（goal=1 → path=2 → teaching=3 → profile=4 → simulation=5；缺省按文件名兜底） */
  order?: number;
  displayName?: string;
  description?: string;
  contracts: OrchestrationContract[];
  fields: OrchestrationField[];
  routings: OrchestrationRouting[];
}

interface RawStageFile {
  stage?: unknown;
  order?: unknown;
  displayName?: unknown;
  description?: unknown;
  contracts?: unknown;
  fields?: unknown;
  routings?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[orchestration] ${label} 必须为非空字符串`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`[orchestration] ${label} 必须为布尔值`);
  return value;
}

function parseField(raw: unknown, index: number): OrchestrationField {
  if (!isRecord(raw)) throw new Error(`[orchestration] fields[${index}] 必须是对象`);
  const fieldId = asString(raw.fieldId, `fields[${index}].fieldId`);
  const promptRole = asString(raw.promptRole, `fields[${index}].promptRole`);
  if (!(PROMPT_ROLES as readonly string[]).includes(promptRole)) {
    throw new Error(`[orchestration] fields[${index}] promptRole=${promptRole} 非法（须在 ${PROMPT_ROLES.join(',')} 中）`);
  }
  const enumValues = Array.isArray(raw.enumValues)
    ? raw.enumValues.map((v) => asString(v, `fields[${index}].enumValues`))
    : undefined;
  const bindings = isRecord(raw.bindings) ? (raw.bindings as Record<string, unknown>) : undefined;
  const valueType = asString(raw.valueType, `fields[${index}].valueType`);
  if (!(CORE_VALUE_TYPES as readonly string[]).includes(valueType)) {
    throw new Error(`[orchestration] fields[${index}] valueType=${valueType} 非法（须在 ${CORE_VALUE_TYPES.join(',')} 中）`);
  }
  return {
    fieldId,
    promptRole: promptRole as PromptRole,
    valueType,
    snakeName: asOptionalString(raw.snakeName),
    camelName: asOptionalString(raw.camelName),
    pathInRawOutput: asOptionalString(raw.pathInRawOutput),
    persistKey: asOptionalString(raw.persistKey),
    description: asString(raw.description, `fields[${index}].description`),
    enumValues,
    systemLocked: asBoolean(raw.systemLocked, `fields[${index}].systemLocked`, false),
    structureLocked: asBoolean(raw.structureLocked, `fields[${index}].structureLocked`, false),
    bindings,
  };
}

function parseRouting(raw: unknown, index: number): OrchestrationRouting {
  if (!isRecord(raw)) throw new Error(`[orchestration] routings[${index}] 必须是对象`);
  const render = asString(raw.render, `routings[${index}].render`);
  if (!(RENDER_VALUES as readonly string[]).includes(render)) {
    throw new Error(`[orchestration] routings[${index}] render=${render} 非法（须在 ${RENDER_VALUES.join(',')} 中）`);
  }
  const handoff = Array.isArray(raw.handoff)
    ? raw.handoff.map((v) => asString(v, `routings[${index}].handoff`))
    : [];
  const visibilityPreset = asOptionalString(raw.visibilityPreset);
  if (visibilityPreset !== undefined && !(VISIBILITY_PRESETS as readonly string[]).includes(visibilityPreset)) {
    throw new Error(`[orchestration] routings[${index}] visibilityPreset=${visibilityPreset} 非法（须在 ${VISIBILITY_PRESETS.join(',')} 中）`);
  }
  return {
    agentId: asString(raw.agentId, `routings[${index}].agentId`),
    fieldId: asString(raw.fieldId, `routings[${index}].fieldId`),
    render: render as RenderValue,
    handoff,
    internal: asBoolean(raw.internal, `routings[${index}].internal`, false),
    accumulate: asBoolean(raw.accumulate, `routings[${index}].accumulate`, false),
    visibilityPreset,
    notes: asOptionalString(raw.notes),
  };
}

/** 纯内存解析核心：parseOrchestrationFile 与 validateOrchestrationContent 共用同一套校验逻辑 */
function parseOrchestrationText(rawText: string, sourceLabel: string): OrchestrationStage {
  let parsed: unknown;
  try {
    parsed = yaml.load(rawText);
  } catch (error) {
    throw new Error(`[orchestration] yaml 解析失败：${sourceLabel}（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`[orchestration] ${sourceLabel} 顶层必须是对象`);
  }
  const raw = parsed as RawStageFile;
  const stage = asString(raw.stage, 'stage');
  const order = typeof raw.order === 'number' && Number.isInteger(raw.order) && raw.order >= 1 ? raw.order : undefined;

  const contracts = Array.isArray(raw.contracts)
    ? raw.contracts.map((c, i) => {
        if (!isRecord(c)) throw new Error(`[orchestration] contracts[${i}] 必须是对象`);
        return deriveContract(asString(c.agentId, `contracts[${i}].agentId`));
      })
    : [];

  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((f, i) => parseField(f, i))
    : [];

  const routings = Array.isArray(raw.routings)
    ? raw.routings.map((r, i) => parseRouting(r, i))
    : [];

  // 唯一性与引用一致性校验
  const fieldIds = new Set<string>();
  for (const f of fields) {
    if (fieldIds.has(f.fieldId)) throw new Error(`[orchestration] ${stage} fields 重复 fieldId：${f.fieldId}`);
    fieldIds.add(f.fieldId);
  }
  const routingKeys = new Set<string>();
  for (const r of routings) {
    const key = `${r.agentId}\0${r.fieldId}`;
    if (routingKeys.has(key)) throw new Error(`[orchestration] ${stage} routings 重复键：${r.agentId}/${r.fieldId}`);
    routingKeys.add(key);
    if (!fieldIds.has(r.fieldId)) {
      throw new Error(`[orchestration] ${stage} routings 引用了未声明字段：${r.agentId}/${r.fieldId}`);
    }
  }

  return {
    stage,
    order,
    displayName: asOptionalString(raw.displayName),
    description: asOptionalString(raw.description),
    contracts,
    fields,
    routings,
  };
}

/**
 * 解析编排文件（读盘 + 纯内存解析）。结果按文件 mtime 缓存（yaml-file-cache）：
 * admin N+1 场景（field-routings 逐 skill 请求）不再对同一文件重复解析；
 * 文件变化即失效，测试用临时路径可绕过旧缓存。
 */
export function parseOrchestrationFile(filePath: string): OrchestrationStage {
  return cachedFileParse(filePath, () => {
    let rawText: string;
    try {
      rawText = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`[orchestration] 读取失败：${filePath}（${error instanceof Error ? error.message : String(error)}）`);
    }
    return parseOrchestrationText(rawText, filePath);
  });
}

/**
 * 内存校验：以完整编排文件 YAML 文本为输入，执行与 parseOrchestrationFile
 * 完全相同的解析与校验逻辑（不依赖文件系统）。用于编辑侧保存前的预校验。
 */
export function validateOrchestrationContent(content: string): OrchestrationStage {
  return parseOrchestrationText(content, '<content>');
}

/** 行级路由 PATCH 的可编辑键集合（与编排文件 routing 条目键一致） */
export interface OrchestrationRoutingEdits {
  render?: RenderValue;
  handoff?: string[];
  internal?: boolean;
  accumulate?: boolean;
  visibilityPreset?: string | null;
  notes?: string | null;
}

/** 写回顺序固定为条目声明序，避免键序抖动 */
const ROUTING_EDIT_KEYS: Array<keyof OrchestrationRoutingEdits> = [
  'render',
  'handoff',
  'internal',
  'accumulate',
  'visibilityPreset',
  'notes',
];

/**
 * 行级路由编辑：把 (agentId, fieldId) 目标 routing 条目上的可编辑键写回编排 YAML 文本。
 *
 * 契约（File-as-Truth 行级编辑）：
 * - 仅改写目标 routing 条目，其余文本（含注释 / 其他条目 / 键序）逐字保留；
 * - notes / visibilityPreset 置空（null 或空串）时删除整行键，而不是写 `notes: null`
 *   —— 字段路由改回原值后文件必须回到原文（#10）；
 * - 保留原文件行尾（EOL）与文末换行，避免 Windows CRLF 检出下「git diff 空、git status M」
 *   的行尾噪音（#10/#11）；
 * - 目标条目不存在时抛错，由路由侧映射为 422。
 */
export function applyRoutingEditsToOrchestrationText(
  yamlText: string,
  agentId: string,
  fieldId: string,
  edits: OrchestrationRoutingEdits,
): string {
  const eol = yamlText.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = yamlText.endsWith('\n');
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  // 去掉 split 产生的尾部空元素：否则新增键会被追加到换行占位之后，丢掉文末换行（#10）
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  // 定位该 (agentId, fieldId) 的 routing 条目：routings 段内逐块扫描
  // （块 = 每条「- agentId: X」起始到下一个「- agentId:」前；goal-agent 的桥接路由
  //   可能被 YAML 拆成多段，不能只取首个同名 agent 块）
  const routingsIdx = lines.findIndex((l) => l.trim() === 'routings:');
  const scanStart = routingsIdx >= 0 ? routingsIdx : 0;
  let entryStart = -1;
  let entryEnd = 0;
  for (let i = scanStart; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t.startsWith('- agentId:')) continue;
    const idMatch = t.match(/agentId:\s*"?([^"\s]+)"?/);
    if (!idMatch || idMatch[1] !== agentId) continue;
    const nextBlock = lines.slice(i + 1).findIndex((l) => l.trim().startsWith('- agentId:'));
    const blockEnd = nextBlock >= 0 ? i + 1 + nextBlock : lines.length;
    const blockLines = lines.slice(i, blockEnd);
    const fIdx = blockLines.findIndex((l) => l.trim().startsWith('fieldId:'));
    if (fIdx < 0) continue;
    const idText = blockLines[fIdx].trim().replace(/^fieldId:\s*/, '').replace(/['"]/g, '').trim();
    if (idText !== fieldId) continue;
    entryStart = i;
    entryEnd = blockEnd;
    break;
  }
  if (entryStart < 0) {
    throw new Error(`[orchestration] 未找到路由条目 ${agentId}/${fieldId}`);
  }

  const indent = (lines[entryStart].match(/^\s*/) || [''])[0];
  const keyIndent = `${indent}  `;
  const edited = lines.slice(entryStart, entryEnd);
  const findKey = (key: string) => edited.findIndex((l) => l.trim().startsWith(`${key}:`));
  const setKey = (key: string, value: string) => {
    const line = `${keyIndent}${key}: ${value}`;
    const idx = findKey(key);
    if (idx >= 0) edited[idx] = line;
    else edited.push(line);
  };

  for (const key of ROUTING_EDIT_KEYS) {
    if (edits[key] === undefined) continue;
    const raw = edits[key];
    if (key === 'notes' || key === 'visibilityPreset') {
      // 安全审计批次3：自由文本字段以 JSON 双引号标量写回——JSON 字符串是合法 YAML 标量，
      // 换行/引号/控制字符天然转义；原样拼接会让值中换行注入任意 YAML 结构。
      if (raw == null || raw === '') {
        const idx = findKey(key);
        if (idx >= 0) edited.splice(idx, 1); // 删除键行而不是写 `key: null`（#10）
        continue;
      }
      setKey(key, JSON.stringify(String(raw)));
      continue;
    }
    let value: string;
    if (key === 'handoff') {
      const arr = Array.isArray(raw) ? raw : [];
      value = arr.length ? `[${arr.map((v) => `'${v}'`).join(', ')}]` : '[]';
    } else if (key === 'internal' || key === 'accumulate') {
      value = raw ? 'true' : 'false';
    } else {
      value = String(raw); // render（调用侧已校验 visible/hidden）
    }
    setKey(key, value);
  }

  const out = [...lines.slice(0, entryStart), ...edited, ...lines.slice(entryEnd)];
  let text = out.join('\n');
  if (hadTrailingNewline) text += '\n';
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}


/** 扫描编排目录，返回全部 stage（按文件名排序）；解析失败即抛错（fail-fast） */
export function loadOrchestrationFiles(): OrchestrationStage[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(ORCHESTRATION_DIR);
  } catch (error) {
    throw new Error(`[orchestration] 目录不存在：${ORCHESTRATION_DIR}（${error instanceof Error ? error.message : String(error)}）`);
  }
  const files = entries
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .filter((name) => !name.startsWith('_'))
    .sort();
  const orderedFiles = [...files].sort((a, b) => {
    const orderOf = (name: string) => {
      try {
        const parsed = parseOrchestrationFile(path.join(ORCHESTRATION_DIR, name));
        return parsed.order ?? Number.MAX_SAFE_INTEGER;
      } catch {
        return Number.MAX_SAFE_INTEGER;
      }
    };
    const ao = orderOf(a);
    const bo = orderOf(b);
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });
  if (files.length === 0) {
    throw new Error(`[orchestration] 目录为空：${ORCHESTRATION_DIR}`);
  }
  return orderedFiles.map((name) => parseOrchestrationFile(path.join(ORCHESTRATION_DIR, name)));
}
