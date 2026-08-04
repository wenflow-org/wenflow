/**
 * v4 核心文件（core.yaml）加载器 —— SKILL_PROTOCOL_V4 §2
 *
 * 设计原则：
 * - 核心文件是业务逻辑的唯一真相源（SSOT），位于 prompts/core/<skillId>.yaml，进 git
 * - 只含业务要素：identity / channels / rules / fields / constraints / params
 * - JSON 输出格式等包装指令由编译器全局注入，禁止写入核心文件
 * - 解析容错：单文件错误进入 diagnostics，不阻断其他文件（对标 prompt-files/loader.ts）
 */

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';

/** 核心文件目录解析：默认仓库根 prompts/core/，可用 CORE_FILES_DIR 覆盖 */
export const CORE_FILES_DIR = process.env.CORE_FILES_DIR
  ? path.resolve(process.env.CORE_FILES_DIR)
  : path.resolve(__dirname, '../../../../prompts/core');

/** §3.1 六大输入材料池 */
export const CORE_CHANNELS = ['dialogue', 'state', 'task', 'evidence', 'learner', 'path'] as const;
export type CoreChannel = (typeof CORE_CHANNELS)[number];

/** §2.3 字段类型受控词表（不含 ? 后缀） */
export const CORE_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'object[]',
  'string[]',
] as const;

export const CORE_FAILURE_POLICIES = ['retry', 'fallback', 'propagate'] as const;
export type CoreFailurePolicy = (typeof CORE_FAILURE_POLICIES)[number];

/** §2.4.3 平台包装字段（与 SkillResult/meta 碰撞者）：禁止出现在 fields 表 */
export const FORBIDDEN_PLATFORM_FIELDS = ['success', 'quality', 'stage', 'raw'] as const;

const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9_]*$/;

export interface CoreFieldSpec {
  name: string;
  /** 受控类型，可带 ? 后缀（如 `object?`） */
  type: string;
  /** type 带 ? 后缀时 true */
  optional: boolean;
  /** 功能描述（生成指令） */
  desc: string;
  /** 当轮消费即弃 */
  turn: boolean;
}

export interface CoreFileParams {
  temperature: number;
  maxTokens: number;
  failurePolicy: CoreFailurePolicy;
}

/** §2.5 上游字段输入声明：ref = `skill:<skillId>.<fieldPath>` */
export interface CoreInputRef {
  /** 原始引用，如 skill:path-scene-framing.normalizedInput */
  ref: string;
  /** 上游 skillId（不含 skill: 前缀） */
  skill: string;
  /** 上游输出字段路径 */
  fieldPath: string;
  /** 用途说明（可选） */
  note?: string;
}

const INPUT_REF_PATTERN = /^skill:([a-z0-9][a-z0-9-]*)\.([A-Za-z0-9_.\[\]-]+)$/;

/** 解析 inputs ref；不合法返回 null */
export function parseInputRef(ref: string): { skill: string; fieldPath: string } | null {
  const m = INPUT_REF_PATTERN.exec(ref.trim());
  return m ? { skill: m[1], fieldPath: m[2] } : null;
}

export interface CoreFile {
  skillId: string;
  baseVersion: number;
  identity: string;
  channels: CoreChannel[];
  stateAdvance: boolean;
  /** 上游字段输入声明（§2.5，可选；编译进「使用通道」块，供 handoff 对账与血缘推导） */
  inputs?: CoreInputRef[];
  rules: string[];
  fields: CoreFieldSpec[];
  constraints: string[];
  params: CoreFileParams;
  examples?: string[];
  /** §5.4 Delta 试验条款 */
  deltaOutput: boolean;
  /** 输出媒介（默认 json；markdown/text 时编译器注入非 JSON 交付条款） */
  outputMedia: CoreOutputMedia;
  /** 文件绝对路径（加载时填充，不参与哈希） */
  filePath?: string;
}

export interface CoreFileIssue {
  code: string;
  message: string;
}

export interface CoreFileDiagnostic {
  filePath: string;
  code: 'read-error' | 'yaml-parse-error' | 'schema-error';
  message: string;
  issues?: CoreFileIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  return list.length === value.length ? list : null;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'skillId',
  'baseVersion',
  'identity',
  'channels',
  'stateAdvance',
  'inputs',
  'rules',
  'fields',
  'constraints',
  'params',
  'examples',
  'deltaOutput',
  'outputMedia',
]);

/** 输出媒介（§4.3 注入条款分支依据；默认 json） */
export const CORE_OUTPUT_MEDIA = ['json', 'markdown', 'text'] as const;
export type CoreOutputMedia = (typeof CORE_OUTPUT_MEDIA)[number];

/**
 * 校验核心文件形状（SKILL_PROTOCOL_V4 §2.2/§2.3/§2.4）。
 * 收集全部问题，不提前返回；返回的 issues 为空即合法。
 */
export function validateCoreFileShape(raw: unknown): CoreFileIssue[] {
  const issues: CoreFileIssue[] = [];
  if (!isPlainObject(raw)) {
    return [{ code: 'not-an-object', message: '核心文件必须是 YAML 对象' }];
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      issues.push({ code: 'unknown-key', message: `未知顶层键：${key}` });
    }
  }

  if (asNonEmptyString(raw.skillId) == null) {
    issues.push({ code: 'skillId-required', message: 'skillId 必填且为非空字符串' });
  }

  if (typeof raw.baseVersion !== 'number' || !Number.isInteger(raw.baseVersion) || raw.baseVersion < 1) {
    issues.push({ code: 'baseVersion-invalid', message: 'baseVersion 必须是 >= 1 的整数' });
  }

  if (asNonEmptyString(raw.identity) == null) {
    issues.push({ code: 'identity-required', message: 'identity 必填且为非空字符串' });
  }

  // channels：六池子集，至少一个
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    issues.push({ code: 'channels-required', message: 'channels 必填且至少声明一个材料池' });
  } else {
    for (const channel of raw.channels) {
      if (!CORE_CHANNELS.includes(channel as CoreChannel)) {
        issues.push({
          code: 'channel-unknown',
          message: `未知材料池：${String(channel)}（可选：${CORE_CHANNELS.join('/')}）`,
        });
      }
    }
  }

  // inputs：可选；每项 { ref: skill:<skillId>.<fieldPath>, note? }
  if (raw.inputs !== undefined && raw.inputs !== null) {
    if (!Array.isArray(raw.inputs)) {
      issues.push({ code: 'inputs-invalid', message: 'inputs 必须是数组：每项 { ref, note? }' });
    } else {
      const seenRefs = new Set<string>();
      raw.inputs.forEach((item, index) => {
        const label = `inputs[${index}]`;
        if (!isPlainObject(item)) {
          issues.push({ code: 'input-not-object', message: `${label} 必须是对象 { ref, note? }` });
          return;
        }
        const ref = asNonEmptyString(item.ref);
        if (ref == null) {
          issues.push({ code: 'input-ref-required', message: `${label}.ref 必填（形如 skill:path-scene-framing.normalizedInput）` });
        } else {
          if (!parseInputRef(ref)) {
            issues.push({
              code: 'input-ref-invalid',
              message: `${label}.ref "${ref}" 格式不合法（应为 skill:<skillId>.<fieldPath>）`,
            });
          }
          if (seenRefs.has(ref)) {
            issues.push({ code: 'input-ref-duplicate', message: `输入声明重复：${ref}` });
          }
          seenRefs.add(ref);
        }
        if (item.note !== undefined && typeof item.note !== 'string') {
          issues.push({ code: 'input-note-invalid', message: `${label}.note 必须是字符串` });
        }
      });
    }
  }

  // rules：非空字符串数组
  const rules = asStringList(raw.rules);
  if (rules == null || rules.length === 0) {
    issues.push({ code: 'rules-required', message: 'rules 必填且至少一条非空字符串' });
  }

  // fields：至少一行，逐行校验
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    issues.push({ code: 'fields-required', message: 'fields 必填且至少一行' });
  } else {
    const seen = new Set<string>();
    raw.fields.forEach((field, index) => {
      const label = `fields[${index}]`;
      if (!isPlainObject(field)) {
        issues.push({ code: 'field-not-object', message: `${label} 必须是对象 {name, type, desc}` });
        return;
      }
      const name = asNonEmptyString(field.name);
      if (name == null) {
        issues.push({ code: 'field-name-required', message: `${label}.name 必填` });
      } else {
        if (!FIELD_NAME_PATTERN.test(name)) {
          issues.push({
            code: 'field-name-invalid',
            message: `${label}.name "${name}" 必须小写字母开头，仅含字母/数字/下划线`,
          });
        }
        if ((FORBIDDEN_PLATFORM_FIELDS as readonly string[]).includes(name)) {
          issues.push({
            code: 'field-name-platform',
            message: `${label}.name "${name}" 是平台包装字段，禁止出现在字段表（§2.4.3）`,
          });
        }
        if (seen.has(name)) {
          issues.push({ code: 'field-name-duplicate', message: `字段名重复：${name}` });
        }
        seen.add(name);
      }
      const type = asNonEmptyString(field.type);
      if (type == null) {
        issues.push({ code: 'field-type-required', message: `${label}.type 必填` });
      } else {
        const base = type.replace(/\?$/, '');
        if (!(CORE_FIELD_TYPES as readonly string[]).includes(base)) {
          issues.push({
            code: 'field-type-unknown',
            message: `${label}.type "${type}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`,
          });
        }
      }
      if (asNonEmptyString(field.desc) == null) {
        issues.push({ code: 'field-desc-required', message: `${label}.desc 必填（功能描述即生成指令）` });
      }
      if (field.turn !== undefined && typeof field.turn !== 'boolean') {
        issues.push({ code: 'field-turn-invalid', message: `${label}.turn 必须是布尔值` });
      }
    });
  }

  // constraints：必填，可为空数组
  if (raw.constraints === undefined || raw.constraints === null) {
    issues.push({ code: 'constraints-required', message: 'constraints 必填（可为空数组 []）' });
  } else if (asStringList(raw.constraints) == null) {
    issues.push({ code: 'constraints-invalid', message: 'constraints 必须是字符串数组' });
  }

  // params
  if (!isPlainObject(raw.params)) {
    issues.push({ code: 'params-required', message: 'params 必填：{temperature, maxTokens, failurePolicy}' });
  } else {
    if (typeof raw.params.temperature !== 'number' || !Number.isFinite(raw.params.temperature)) {
      issues.push({ code: 'params-temperature-invalid', message: 'params.temperature 必须是有限数字' });
    }
    if (typeof raw.params.maxTokens !== 'number' || !Number.isInteger(raw.params.maxTokens) || raw.params.maxTokens <= 0) {
      issues.push({ code: 'params-maxTokens-invalid', message: 'params.maxTokens 必须是正整数' });
    }
    if (!CORE_FAILURE_POLICIES.includes(raw.params.failurePolicy as CoreFailurePolicy)) {
      issues.push({
        code: 'params-failurePolicy-unknown',
        message: `params.failurePolicy 必须是 ${CORE_FAILURE_POLICIES.join(' | ')}`,
      });
    }
  }

  if (raw.examples !== undefined && asStringList(raw.examples) == null) {
    issues.push({ code: 'examples-invalid', message: 'examples 必须是字符串数组' });
  }
  if (raw.outputMedia !== undefined && !CORE_OUTPUT_MEDIA.includes(raw.outputMedia as CoreOutputMedia)) {
    issues.push({
      code: 'outputMedia-unknown',
      message: `outputMedia 必须是 ${CORE_OUTPUT_MEDIA.join(' | ')}`,
    });
  }
  if (raw.stateAdvance !== undefined && typeof raw.stateAdvance !== 'boolean') {
    issues.push({ code: 'stateAdvance-invalid', message: 'stateAdvance 必须是布尔值' });
  }
  if (raw.deltaOutput !== undefined && typeof raw.deltaOutput !== 'boolean') {
    issues.push({ code: 'deltaOutput-invalid', message: 'deltaOutput 必须是布尔值' });
  }

  return issues;
}

/** 将校验过的原始对象规整为标准 CoreFile（调用前须保证 validateCoreFileShape 通过） */
export function normalizeCoreFile(raw: Record<string, unknown>): CoreFile {
  return {
    skillId: String(raw.skillId).trim(),
    baseVersion: raw.baseVersion as number,
    identity: String(raw.identity).trim(),
    channels: (raw.channels as string[]).map((c) => c.trim()) as CoreChannel[],
    stateAdvance: raw.stateAdvance === true,
    ...(Array.isArray(raw.inputs) && raw.inputs.length
      ? {
          inputs: (raw.inputs as Array<Record<string, unknown>>).map((item) => {
            const ref = String(item.ref).trim();
            const parts = parseInputRef(ref)!;
            return {
              ref,
              skill: parts.skill,
              fieldPath: parts.fieldPath,
              ...(asNonEmptyString(item.note) ? { note: String(item.note).trim() } : {}),
            };
          }),
        }
      : {}),
    rules: (raw.rules as string[]).map((r) => r.trim()),
    fields: (raw.fields as Array<Record<string, unknown>>).map((field) => {
      const type = String(field.type).trim();
      return {
        name: String(field.name).trim(),
        type,
        optional: type.endsWith('?'),
        desc: String(field.desc).trim(),
        turn: field.turn === true,
      };
    }),
    constraints: (raw.constraints as string[]).map((c) => c.trim()),
    params: {
      temperature: (raw.params as Record<string, unknown>).temperature as number,
      maxTokens: (raw.params as Record<string, unknown>).maxTokens as number,
      failurePolicy: (raw.params as Record<string, unknown>).failurePolicy as CoreFailurePolicy,
    },
    ...(raw.examples !== undefined ? { examples: (raw.examples as string[]).map((e) => e.trim()) } : {}),
    deltaOutput: raw.deltaOutput === true,
    outputMedia: (raw.outputMedia as CoreOutputMedia) ?? 'json',
  };
}

/** 解析单个核心文件内容；schema 不合法时 core 为 null 且带 schema-error 诊断 */
export function parseCoreFile(
  filePath: string,
  raw: string
): { core: CoreFile | null; diagnostics: CoreFileDiagnostic[] } {
  const normalized = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let parsed: unknown;
  try {
    parsed = yaml.load(normalized);
  } catch (error) {
    return {
      core: null,
      diagnostics: [
        {
          filePath,
          code: 'yaml-parse-error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const issues = validateCoreFileShape(parsed);
  if (issues.length > 0) {
    return {
      core: null,
      diagnostics: [
        {
          filePath,
          code: 'schema-error',
          message: issues.map((issue) => issue.message).join('；'),
          issues,
        },
      ],
    };
  }

  const core = normalizeCoreFile(parsed as Record<string, unknown>);
  core.filePath = filePath;
  return { core, diagnostics: [] };
}

/** 按 skillId 加载单个核心文件；文件不存在返回 null，存在但非法时 core 为 null */
export function loadCoreFile(
  skillId: string,
  dir = CORE_FILES_DIR
): { core: CoreFile | null; diagnostics: CoreFileDiagnostic[] } | null {
  const filePath = path.join(dir, `${skillId}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return {
      core: null,
      diagnostics: [
        {
          filePath,
          code: 'read-error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return parseCoreFile(filePath, raw);
}

/** 容错扫描目录下全部核心文件（*.yaml） */
export function scanCoreFiles(dir = CORE_FILES_DIR): {
  files: CoreFile[];
  diagnostics: CoreFileDiagnostic[];
} {
  const files: CoreFile[] = [];
  const diagnostics: CoreFileDiagnostic[] = [];
  if (!fs.existsSync(dir)) return { files, diagnostics };

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name) && !entry.name.startsWith('_'))
    .map((entry) => path.join(dir, entry.name));

  for (const filePath of entries) {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      diagnostics.push({
        filePath,
        code: 'read-error',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const parsed = parseCoreFile(filePath, raw);
    if (parsed.core) files.push(parsed.core);
    diagnostics.push(...parsed.diagnostics);
  }

  files.sort((a, b) => a.skillId.localeCompare(b.skillId));
  diagnostics.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return { files, diagnostics };
}

/** 键序无关的稳定序列化（数组保序），供 coreHash 使用 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 计算核心文件内容哈希（§6.2 漂移检测锚点）。
 * 基于规整后的结构做键序无关序列化，不受 YAML 排版/键顺序影响。
 */
export function computeCoreHash(core: CoreFile): string {
  const { filePath: _filePath, ...hashable } = core;
  return crypto.createHash('sha256').update(stableStringify(hashable), 'utf8').digest('hex');
}
