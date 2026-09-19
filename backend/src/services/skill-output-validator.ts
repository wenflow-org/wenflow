/**
 * 通用输出校验器（P3：validateParsedOutput 由 core fields 声明驱动）
 *
 * 按 core 文件的 fields 声明（名称/受控类型/可缺省）校验 LLM 输出：
 * - 宽容路径（默认，历史行为不变）：
 *   必填字段（未标 `?`）缺失 → missing-required；类型不匹配 → type-mismatch；
 *   enum 值不在 desc 列明的候选中 → enum-out-of-range；`?` 字段缺失合法；数组空数组合法。
 * - 严格路径（Q11b，附加启用）：当 core 声明**实际携带**结构化 enumValues / 嵌套 properties，
 *   且编译不产生 `enum-values-unavailable` / `object-properties-unavailable` 降级限制时，
 *   改用 `compileStrictJsonSchema` 的严格 schema 校验（嵌套对象、additionalProperties:false、
 *   结构化 enum、嵌套必填），失败码带 `path`（如 goalSeed.primaryBlockType）便于定位。
 *   门禁按**每个 skill 的声明能力**判定（opt-in）：无任何结构化声明（如纯标量 fields）或存在任一
 *   降级限制（当前常见情形：enum 值只在 desc、object 子字段只在 desc）即退回宽容路径，
 *   **不会**用空 `{}` 的严格 object 误拒，也不改动现存 skill 行为。
 *
 * 与 skill 自有 validateParsedOutput（领域校验）互补：领域校验先行，
 * 本校验器作为"字段声明契约"层兜底（试点 skill 白名单启用）。
 * 类型词表单一来源：yaml-vocabulary CORE_FIELD_TYPES（2026-08 词表统一）；
 * 严格编译器单一来源：prompt-lab/json-schema-compiler（纯函数，无 IO）。
 */

import { CORE_FIELD_TYPES } from './yaml-vocabulary';
import {
  compileStrictJsonSchema,
  type JsonSchema,
  type JsonSchemaObject,
  type SchemaCompilationLimitation,
} from './prompt-lab/json-schema-compiler';
import type { CoreFieldSpec } from './prompt-lab/core-file-loader';

export interface CoreFieldDeclaration {
  name: string;
  type: string; // 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'object[]' | 'string[]'，可带 '?' 后缀
  desc?: string;
  turn?: boolean;
  /** 结构化 enum 候选值（Q11 前向兼容；缺省时 enum 值仅在 desc 文本，走宽容路径） */
  enumValues?: string[];
  /** 结构化嵌套 object / object[] 子字段（Q11 前向兼容；缺省时子字段仅在 desc，走宽容路径） */
  properties?: CoreFieldDeclaration[];
}

export type FieldValidationIssueCode =
  | 'missing-required'
  | 'type-mismatch'
  | 'enum-out-of-range'
  /** 严格路径：嵌套字段类型不匹配 */
  | 'nested-type-mismatch'
  /** 严格路径：嵌套对象缺失必填子字段 */
  | 'missing-nested-required'
  /** 严格路径：additionalProperties:false 拒绝表外属性 */
  | 'unknown-property';

export interface FieldValidationIssue {
  field: string;
  code: FieldValidationIssueCode;
  expected: string;
  actual?: unknown;
  /** 严格路径的完整字段路径（如 goalSeed.primaryBlockType / points[0].name）；宽容路径缺省 */
  path?: string;
}

export interface FieldValidationResult {
  valid: boolean;
  issues: FieldValidationIssue[];
}

const ENUM_MARKERS = ['|', '，', ','];

function parseType(declared: string): { base: string; optional: boolean } {
  const trimmed = declared.trim();
  const optional = trimmed.endsWith('?');
  const base = optional ? trimmed.slice(0, -1).trim() : trimmed;
  return { base, optional };
}

function valueTypeMatches(value: unknown, base: string): boolean {
  switch (base) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'object[]':
      return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object');
    case 'enum':
      return typeof value === 'string' || typeof value === 'number';
    default:
      return true; // 未知类型不拦截（契约演进期宽容）
  }
}

function extractEnumCandidates(desc: string | undefined): string[] | null {
  if (!desc) return null;
  // `|` 是枚举的标准分隔符：按它切分后，每段截到第一个非候选字符（说明文字等）为止，
  // 避免 `example-first|predict|self-assess，必须保持...` 这类 desc 把 self-assess 与说明混在一起被吞。
  const pipeParts = desc
    .split('|')
    .map((part) => {
      const m = part.match(/^[\w-]+/)
      return m ? m[0] : ''
    })
    .filter((part) => part.length > 0);
  if (pipeParts.length >= 2) return pipeParts;

  const candidates: string[] = [];
  for (const marker of ENUM_MARKERS) {
    if (!desc.includes(marker)) continue;
    const parts = desc
      .split(marker)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && /^[\w-]+$/.test(part));
    if (parts.length >= 2) return parts;
    candidates.push(...parts);
  }
  return candidates.length >= 2 ? candidates : null;
}

// ============================================================
// Q11b 严格 schema 层（附加启用；门禁见 tryCompileStrictSchema）
// ============================================================

/** 使严格编译失去精确性的降级限制：出现任一即退回宽容路径，避免空 object 误拒 */
const STRICT_BLOCKING_LIMITATION_CODES: ReadonlySet<SchemaCompilationLimitation['code']> = new Set([
  'enum-values-unavailable',
  'object-properties-unavailable',
]);

/**
 * 是否存在"结构化声明"（opt-in 信号）：任一字段带非空 enumValues 或非空 properties。
 * 纯标量声明没有可严格化的结构，保持宽容路径，避免无声明能力时也改变行为。
 */
function hasStructuredDeclaration(fields: readonly CoreFieldDeclaration[]): boolean {
  return fields.some(
    (field) =>
      (Array.isArray(field.enumValues) && field.enumValues.length > 0) ||
      (Array.isArray(field.properties) && field.properties.length > 0)
  );
}

/**
 * 判断 fields 是否具备严格编译条件：
 * - 先决：存在结构化声明（opt-in），否则返回 null（走宽容路径）；
 * - 再决：编译无 enum-values-unavailable / object-properties-unavailable 降级限制 → 返回严格 schema；
 * - 否则返回 null（走宽容路径），含编译抛错（未知类型等）的兜底，保证宽容行为不被破坏。
 * 纯函数、确定性、无 IO。
 */
function tryCompileStrictSchema(fields: CoreFieldDeclaration[]): JsonSchemaObject | null {
  if (!hasStructuredDeclaration(fields)) return null;
  try {
    const limitations: SchemaCompilationLimitation[] = [];
    const schema = compileStrictJsonSchema(fields, limitations);
    if (limitations.some((limitation) => STRICT_BLOCKING_LIMITATION_CODES.has(limitation.code))) {
      return null;
    }
    return schema;
  } catch {
    return null;
  }
}

function schemaTypeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (schema.type === 'array') return 'array';
  return schema.type; // string | number | boolean | object
}

function joinFieldPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function pushStrictIssue(
  issues: FieldValidationIssue[],
  issue: {
    rootField: string;
    path: string;
    code: FieldValidationIssueCode;
    expected: string;
    actual?: unknown;
  }
): void {
  issues.push({
    field: issue.rootField,
    code: issue.code,
    expected: issue.expected,
    ...(issue.actual !== undefined ? { actual: issue.actual } : {}),
    path: issue.path,
  });
}

/**
 * 递归校验值是否满足严格 schema。
 * `rootField` 为该值所属的顶层字段名（用于 issue.field 归属）；`path` 为完整路径。
 * 顶层属性 path 与 rootField 相等（→ 复用既有 type-mismatch/missing-required 码），
 * 嵌套字段则使用 nested-* 新码并携带完整 path。
 */
function validateStrictValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  rootField: string,
  issues: FieldValidationIssue[]
): void {
  const atRoot = path === rootField;

  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: atRoot ? 'type-mismatch' : 'nested-type-mismatch',
          expected: 'object',
          actual: value,
        });
        return;
      }
      const record = value as Record<string, unknown>;
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) {
            pushStrictIssue(issues, {
              rootField,
              path: joinFieldPath(path, key),
              code: 'unknown-property',
              expected: Object.keys(properties).join('|'),
              actual: record[key],
            });
          }
        }
      }

      for (const key of Object.keys(properties)) {
        const childValue = record[key];
        const childPath = joinFieldPath(path, key);
        const childSchema = properties[key];
        if (childValue === undefined) {
          if (required.has(key)) {
            // 本函数只处理"字段值"（root 对象由 validateStrictAgainstSchema 处理），
            // 故对象内的缺失子字段一律是嵌套必填。
            pushStrictIssue(issues, {
              rootField,
              path: childPath,
              code: 'missing-nested-required',
              expected: schemaTypeLabel(childSchema),
            });
          }
          continue;
        }
        // 与宽容路径一致：可选字段显式 null 视为缺省（required 字段的 null 照常判类型不符）
        if (childValue === null && !required.has(key)) continue;
        validateStrictValue(childValue, childSchema, childPath, rootField, issues);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: atRoot ? 'type-mismatch' : 'nested-type-mismatch',
          expected: 'array',
          actual: value,
        });
        return;
      }
      value.forEach((item, index) => {
        validateStrictValue(item, schema.items, `${path}[${index}]`, rootField, issues);
      });
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: atRoot ? 'type-mismatch' : 'nested-type-mismatch',
          expected: 'string',
          actual: value,
        });
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: 'enum-out-of-range',
          expected: schema.enum.join('|'),
          actual: value,
        });
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: atRoot ? 'type-mismatch' : 'nested-type-mismatch',
          expected: 'number',
          actual: value,
        });
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        pushStrictIssue(issues, {
          rootField,
          path,
          code: atRoot ? 'type-mismatch' : 'nested-type-mismatch',
          expected: 'boolean',
          actual: value,
        });
      }
      return;
    }
  }
}

/** 顶层严格校验：根必须为对象，顶层属性各视为一个 rootField（复用既有顶层失败码） */
function validateStrictAgainstSchema(
  parsed: unknown,
  schema: JsonSchemaObject
): FieldValidationResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      issues: [{ field: '(root)', code: 'type-mismatch', expected: 'object' }],
    };
  }
  const record = parsed as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const issues: FieldValidationIssue[] = [];

  for (const key of Object.keys(record)) {
    if (!(key in properties)) {
      pushStrictIssue(issues, {
        rootField: key,
        path: key,
        code: 'unknown-property',
        expected: Object.keys(properties).join('|'),
        actual: record[key],
      });
    }
  }

  for (const key of Object.keys(properties)) {
    const value = record[key];
    if (value === undefined) {
      if (required.has(key)) {
        pushStrictIssue(issues, {
          rootField: key,
          path: key,
          code: 'missing-required',
          expected: schemaTypeLabel(properties[key]),
        });
      }
      continue;
    }
    if (value === null && !required.has(key)) continue;
    validateStrictValue(value, properties[key], key, key, issues);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * 校验 LLM 平铺输出（fields 表声明形态）与 core fields 声明的一致性。
 * parsed 必须是字段名→值的平铺对象（模型按字段表产出的形态）。
 *
 * 分派（Q11b）：具备严格编译条件 → 严格 schema 校验；否则 → 宽容校验（历史行为）。
 */
export function validateOutputAgainstFields(
  parsed: unknown,
  fields: CoreFieldDeclaration[]
): FieldValidationResult {
  const strictSchema = tryCompileStrictSchema(fields);
  if (strictSchema) {
    return validateStrictAgainstSchema(parsed, strictSchema);
  }
  return validateTolerantAgainstFields(parsed, fields);
}

/** 宽容校验（历史默认路径；行为与 Q11b 之前完全一致） */
function validateTolerantAgainstFields(
  parsed: unknown,
  fields: CoreFieldDeclaration[]
): FieldValidationResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      issues: [{ field: '(root)', code: 'type-mismatch', expected: 'object' }],
    };
  }
  const record = parsed as Record<string, unknown>;
  const issues: FieldValidationIssue[] = [];

  for (const field of fields) {
    const { base, optional } = parseType(field.type);
    const value = record[field.name];

    if (value === undefined) {
      if (!optional) {
        issues.push({ field: field.name, code: 'missing-required', expected: base });
      }
      continue;
    }
    if (value === null && optional) continue;

    if (!valueTypeMatches(value, base)) {
      issues.push({ field: field.name, code: 'type-mismatch', expected: base, actual: value });
      continue;
    }

    if (base === 'enum' && typeof value === 'string') {
      const candidates = extractEnumCandidates(field.desc);
      if (candidates && !candidates.includes(value)) {
        issues.push({ field: field.name, code: 'enum-out-of-range', expected: candidates.join('|'), actual: value });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** 校验核心文件 fields 声明本身的合法性（受控词表 + 名称唯一） */
export function validateCoreFieldDeclarations(fields: CoreFieldDeclaration[]): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) {
      errors.push(`字段重复声明：${field.name}`);
    }
    names.add(field.name);
    const { base } = parseType(field.type);
    if (!(CORE_FIELD_TYPES as readonly string[]).includes(base)) {
      errors.push(`字段 ${field.name} 类型 ${field.type} 不在受控词表（${CORE_FIELD_TYPES.join('|')}）`);
    }
  }
  return errors;
}

// ============================================================
// P3 运行时接入：从 core 文件（File-as-Truth）加载 fields 声明
// ============================================================

/**
 * 排除名单：默认全部 LLM skill 启用 fields 契约校验，
 * 以下场景排除（按原因分类）：
 * - 非 JSON 对象输出：skill-author（markdown）
 * - 平台守门直调：semantic-freeze-judge（发布门禁，失败后果重，不走常规重试语义）
 * - 模拟器家族：virtual-learner-*（turn 字段多、fallback 路径特殊、referee 旁路通道）
 * - concept-priority（已退役，仅 manifest 残留）
 */
const FIELD_VALIDATION_EXCLUDED_SKILLS = new Set([
  'skill:skill-author',
  'skill:semantic-freeze-judge',
  'skill:virtual-learner-goal-dialogue-simulator',
  'skill:virtual-learner-learn-turn-simulator',
  'skill:virtual-learner-path-evaluator',
  'skill:virtual-learner-persona-designer',
  'skill:virtual-learner-referee',
  'skill:virtual-learner-actor-auditor',
  'skill:virtual-learner-scenario-designer',
  'skill:concept-priority',
]);

export function isFieldValidatedSkill(agentId: string): boolean {
  return !FIELD_VALIDATION_EXCLUDED_SKILLS.has(agentId);
}

interface CoreFieldsCacheEntry {
  fields: CoreFieldDeclaration[];
  deltaOutput: boolean;
  loadedAt: number;
}

const CORE_FIELDS_CACHE_TTL_MS = 60 * 1000;
const coreFieldsCache = new Map<string, CoreFieldsCacheEntry>();

/**
 * CoreFieldSpec → CoreFieldDeclaration：递归保留结构化 enumValues / properties（Q11b 严格层所需）。
 * 缺省时与旧版映射完全一致（向后兼容）。
 */
function toCoreFieldDeclaration(field: CoreFieldSpec): CoreFieldDeclaration {
  const declaration: CoreFieldDeclaration = {
    name: field.name,
    type: field.type,
    desc: field.desc,
    turn: field.turn,
  };
  if (field.enumValues && field.enumValues.length) {
    declaration.enumValues = [...field.enumValues];
  }
  if (field.properties && field.properties.length) {
    declaration.properties = field.properties.map(toCoreFieldDeclaration);
  }
  return declaration;
}

/**
 * 从 prompts/core/<skillId>.yaml 读取 fields 声明与 deltaOutput（File-as-Truth；60s 缓存）。
 * 无 core 文件/解析失败返回 null（跳过校验，不阻断）。
 */
export async function loadCoreFieldDeclarations(skillId: string): Promise<CoreFieldDeclaration[] | null> {
  const cached = coreFieldsCache.get(skillId);
  if (cached && Date.now() - cached.loadedAt < CORE_FIELDS_CACHE_TTL_MS) {
    return cached.fields;
  }
  try {
    const { loadCoreFile } = await import('./prompt-lab/core-file-loader');
    const loaded = loadCoreFile(skillId);
    const core = loaded?.core;
    if (!core) return null;
    const fields = core.fields.map(toCoreFieldDeclaration);
    coreFieldsCache.set(skillId, { fields, deltaOutput: core.deltaOutput === true, loadedAt: Date.now() });
    return fields;
  } catch {
    return null;
  }
}

function isDeltaSkill(skillId: string): boolean {
  const cached = coreFieldsCache.get(skillId);
  return cached?.deltaOutput === true;
}

/**
 * P3 运行时入口：按 core fields 声明校验 skill 输出。
 * - 排除名单内的 skill / 无 core 文件 → 返回 null（跳过）
 * - delta 模式（core.deltaOutput=true，File-as-Truth）：缺席合法（delta 语义），仅校验存在的字段
 */
export async function validateSkillOutputFields(
  agentId: string,
  parsed: unknown
): Promise<FieldValidationResult | null> {
  if (!isFieldValidatedSkill(agentId)) return null;
  const skillId = agentId.replace(/^skill:/, '');
  const fields = await loadCoreFieldDeclarations(skillId);
  if (!fields || fields.length === 0) return null;

  if (isDeltaSkill(skillId)) {
    // delta 写：缺席=不变；仅对"存在且类型可判"的值做类型校验
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, issues: [{ field: '(root)', code: 'type-mismatch', expected: 'object' }] };
    }
    const issues: FieldValidationIssue[] = [];
    const record = parsed as Record<string, unknown>;
    for (const field of fields) {
      const { base } = parseType(field.type);
      const value = record[field.name];
      if (value === undefined || value === null) continue;
      if (!valueTypeMatches(value, base)) {
        issues.push({ field: field.name, code: 'type-mismatch', expected: base, actual: value });
      }
    }
    return { valid: issues.length === 0, issues };
  }

  return validateOutputAgainstFields(parsed, fields);
}
