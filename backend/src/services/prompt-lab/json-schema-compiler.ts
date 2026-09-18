/**
 * core fields 声明 → 严格 JSON Schema 编译器（Q11 tier-2 基础设施，纯函数）
 *
 * 目标：把 prompts/core/*.yaml 的 fields 表（name / type / desc / optional / turn）编译成
 * 「严格」JSON Schema（结构化输出用）：
 * - 顶层固定 `{ type: 'object', properties, required, additionalProperties: false }`
 * - 7 类受控类型（string | number | boolean | enum | object | object[] | string[]）逐个映射
 * - `?` 后缀 / optional=true → 该字段不进入 required（required 仅收非可选字段）
 * - object（含 object[] 的 item）一律 `additionalProperties: false`
 *
 * 设计原则：
 * - 纯函数、确定性、无 IO、无第三方依赖；同一输入必得同一产物（属性/required 保声明顺序）
 * - 类型词表单一来源：yaml-vocabulary CORE_FIELD_TYPES（本模块不复制字面量）
 *
 * ⚠️ 结构性限制（本任务只做编译器，不接入运行时）：
 * core fields 目前**只**结构化了 name/type/desc/optional/turn。以下两项在 core YAML 中只存在于
 * desc 自由文本，没有结构化声明，因此不能凭空编译出精确子 schema：
 * 1) enum 候选值：列于 desc（如 `equivalent | uncertain | divergent`），本编译器在缺少结构化
 *    enumValues 时降级为 `{ type: 'string', description }`，并记录 `enum-values-unavailable`。
 * 2) 嵌套 object 子字段：以「· 子字段（类型）说明」写在 desc 里（SKILL_PROTOCOL_V4 §4），
 *    本编译器在缺少结构化 properties 时输出 `{ type: 'object', additionalProperties: false }`，
 *    并记录 `object-properties-unavailable`。注意：此时严格模式只接受空对象 `{}`——这正是
 *    在词表/加载器补齐嵌套结构之前**不能**把本编译器直接接入运行时的原因。
 *
 * 前向兼容扩展（当前 core 加载器不产出、测试用于验证递归能力）：
 * 输入字段可选携带 `enumValues` 与 `properties`；一旦 core 词表未来结构化声明它们，
 * 编译器无需改动即可产出精确子 schema。限制由 collectSchemaLimitations 显式暴露，便于
 * 后续在 skill-output-validator.ts / 结构化输出链路上做「是否具备严格编译条件」的门禁。
 */

import { CORE_FIELD_TYPES, stripOptionalSuffix } from '../yaml-vocabulary';

/** JSON Schema 标量（string / number / boolean；enum 降级为 string + enum 或仅 description） */
export interface JsonSchemaScalar {
  type: 'string' | 'number' | 'boolean';
  /** 仅在结构化 enumValues 可用时出现 */
  enum?: readonly string[];
  description?: string;
}

/** JSON Schema 数组（string[] / object[]） */
export interface JsonSchemaArray {
  type: 'array';
  items: JsonSchema;
  description?: string;
}

/** JSON Schema 对象（顶层与嵌套 object 共用；object 一律 additionalProperties: false） */
export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties: false;
  description?: string;
}

export type JsonSchema = JsonSchemaScalar | JsonSchemaArray | JsonSchemaObject;

/**
 * 编译器输入字段。与 core-file-loader 的 CoreFieldSpec / skill-output-validator 的
 * CoreFieldDeclaration 结构兼容（后两者可原样传入）。
 *
 * `enumValues` / `properties` 为前向兼容的结构化扩展：当前 core YAML 不产出，
 * 缺省时走降级路径并记录 limitation。
 */
export interface CompileFieldInput {
  name: string;
  /** core 受控类型，可带 `?` 后缀（如 `object?`、`enum?`） */
  type: string;
  /** 功能描述（生成指令）；编译为 JSON Schema description */
  desc?: string;
  /** type 带 `?` 后缀时为 true（亦可由调用方显式给出） */
  optional?: boolean;
  /** 当轮消费即弃标记；当前不参与 schema 编译，保留以兼容声明形状 */
  turn?: boolean;
  /** 结构化 enum 候选值（前向兼容；缺省则降级为 string + description） */
  enumValues?: readonly string[];
  /** 结构化嵌套 object 子字段（前向兼容；缺省则降级为无 properties 的 object） */
  properties?: readonly CompileFieldInput[];
}

/** 编译期限制：说明哪些字段因缺少结构化信息而只能降级编译 */
export interface SchemaCompilationLimitation {
  code: 'enum-values-unavailable' | 'object-properties-unavailable';
  field: string;
  message: string;
}

/** 剥离 `?` 后缀并取 base 类型；optional 判定同时看显式标记与后缀 */
function baseTypeOf(field: CompileFieldInput): string {
  return stripOptionalSuffix(field.type);
}

function isOptional(field: CompileFieldInput): boolean {
  return field.optional === true || field.type.trim().endsWith('?');
}

/** 仅在 desc 非空时附加 description，保证产物中不出现 `description: undefined` 键 */
function withDescription<T>(schema: T, desc?: string): T {
  const trimmed = typeof desc === 'string' ? desc.trim() : '';
  return trimmed ? ({ ...schema, description: trimmed } as T) : schema;
}

function compileObjectSchema(
  field: CompileFieldInput,
  limitations: SchemaCompilationLimitation[],
  attachDescription = true
): JsonSchemaObject {
  const desc = attachDescription ? field.desc : undefined;
  // properties 存在即视为「结构性声明」（即使为空数组，也代表已声明的空对象）
  if (field.properties !== undefined) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const child of field.properties) {
      properties[child.name] = compileFieldSchema(child, limitations);
      if (!isOptional(child) && !required.includes(child.name)) {
        required.push(child.name);
      }
    }
    return withDescription(
      { type: 'object', properties, required, additionalProperties: false },
      desc
    );
  }

  // core 目前不结构化嵌套子字段：降级为无 properties 的严格对象并记录限制
  limitations.push({
    code: 'object-properties-unavailable',
    field: field.name,
    message: `字段 ${field.name} 声明的 object 缺少结构化 properties（core 仅在 desc 中自由描述子字段），已降级为 { type: 'object', additionalProperties: false }，严格模式下只接受空对象`,
  });
  return withDescription({ type: 'object', additionalProperties: false }, desc);
}

function compileFieldSchema(
  field: CompileFieldInput,
  limitations: SchemaCompilationLimitation[]
): JsonSchema {
  const base = baseTypeOf(field);

  switch (base) {
    case 'string':
      return withDescription({ type: 'string' }, field.desc);
    case 'number':
      return withDescription({ type: 'number' }, field.desc);
    case 'boolean':
      return withDescription({ type: 'boolean' }, field.desc);
    case 'enum': {
      if (field.enumValues && field.enumValues.length > 0) {
        return withDescription({ type: 'string', enum: [...field.enumValues] }, field.desc);
      }
      limitations.push({
        code: 'enum-values-unavailable',
        field: field.name,
        message: `字段 ${field.name} 声明的 enum 缺少结构化候选值（core 仅在 desc 中自由列出），已降级为 { type: 'string' }`,
      });
      return withDescription({ type: 'string' }, field.desc);
    }
    case 'object':
      return compileObjectSchema(field, limitations);
    case 'string[]':
      return withDescription({ type: 'array', items: { type: 'string' } }, field.desc);
    case 'object[]':
      return withDescription(
        { type: 'array', items: compileObjectSchema(field, limitations, false) },
        field.desc
      );
    default:
      throw new Error(
        `json-schema-compiler: 字段 ${field.name} 类型 "${field.type}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`
      );
  }
}

/**
 * core fields → 严格 JSON Schema。
 * - 顶层恒为 strict object（additionalProperties: false）
 * - required 仅含非可选字段，顺序与声明一致
 * - 传入 limitations 数组可同时收集降级限制（见 collectSchemaLimitations）
 */
export function compileStrictJsonSchema(
  fields: readonly CompileFieldInput[],
  limitations?: SchemaCompilationLimitation[]
): JsonSchemaObject {
  const collector = limitations ?? [];
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.name] = compileFieldSchema(field, collector);
    if (!isOptional(field) && !required.includes(field.name)) {
      required.push(field.name);
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/** 只收集编译期限制（不关心 schema 时使用；限制明细是判断能否严格编译的依据） */
export function collectSchemaLimitations(
  fields: readonly CompileFieldInput[]
): SchemaCompilationLimitation[] {
  const limitations: SchemaCompilationLimitation[] = [];
  compileStrictJsonSchema(fields, limitations);
  return limitations;
}
