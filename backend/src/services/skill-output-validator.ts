/**
 * 通用输出校验器（P3：validateParsedOutput 由 core fields 声明驱动）
 *
 * 按 core 文件的 fields 声明（名称/受控类型/可缺省）校验 LLM 输出：
 * - 必填字段（未标 `?`）缺失 → 失败
 * - 类型不匹配（受控词表：string|number|boolean|enum|object|object[]|string[]）→ 失败
 * - enum 值不在 desc 列明的候选中 → 失败
 * - `?` 字段缺失合法；数组类型空数组合法
 *
 * 与 skill 自有 validateParsedOutput（领域校验）互补：领域校验先行，
 * 本校验器作为"字段声明契约"层兜底（试点 skill 白名单启用）。
 * 类型词表单一来源：yaml-vocabulary CORE_FIELD_TYPES（2026-08 词表统一）。
 */

import { CORE_FIELD_TYPES } from './yaml-vocabulary';

export interface CoreFieldDeclaration {
  name: string;
  type: string; // 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'object[]' | 'string[]'，可带 '?' 后缀
  desc?: string;
  turn?: boolean;
}

export interface FieldValidationIssue {
  field: string;
  code: 'missing-required' | 'type-mismatch' | 'enum-out-of-range';
  expected: string;
  actual?: unknown;
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

/**
 * 校验 LLM 平铺输出（fields 表声明形态）与 core fields 声明的一致性。
 * parsed 必须是字段名→值的平铺对象（模型按字段表产出的形态）。
 */
export function validateOutputAgainstFields(
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
 * - 非 JSON 对象输出：generic-chat（string）、skill-author（markdown）
 * - 平台守门直调：semantic-freeze-judge（发布门禁，失败后果重，不走常规重试语义）
 * - 模拟器家族：virtual-learner-*（turn 字段多、fallback 路径特殊、referee 旁路通道）
 * - 零调用或不可达：basic-evaluator / goal-alignment-checker（注册中零调用，v4-aux 僵尸项，
 *   保留注册由 retired:check 守卫保护，不入退役名单）、concept-priority（已退役，仅 manifest 残留）、
 *   course-design（注册但生产不可达：唯一调用点 designWeekCourses 无调用者）
 */
const FIELD_VALIDATION_EXCLUDED_SKILLS = new Set([
  'skill:generic-chat',
  'skill:skill-author',
  'skill:semantic-freeze-judge',
  'skill:virtual-learner-goal-dialogue-simulator',
  'skill:virtual-learner-learn-turn-simulator',
  'skill:virtual-learner-path-evaluator',
  'skill:virtual-learner-persona-designer',
  'skill:virtual-learner-referee',
  'skill:virtual-learner-actor-auditor',
  'skill:virtual-learner-scenario-designer',
  'skill:basic-evaluator',
  'skill:concept-priority',
  'skill:course-design',
  'skill:goal-alignment-checker',
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
    const fields = core.fields.map((field) => ({
      name: field.name,
      type: field.type,
      desc: field.desc,
      turn: field.turn,
    }));
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
