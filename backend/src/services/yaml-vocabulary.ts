/**
 * YAML 词表统一模块（P0-A 共享词表，纯常量 + 纯函数，无 IO）
 *
 * 单一事实源，被以下消费方引用（反向依赖禁止：本模块不得 import 任何消费方）：
 * - prompt-lab/core-file-loader（CORE_FIELD_TYPES / FAILURE_POLICY_CORE，经 re-export 保兼容）
 * - skill-output-validator（CORE_FIELD_TYPES，替换原重复白名单）
 * - field-routing/orchestration-file（PROMPT_ROLES / RENDER_VALUES / CORE_VALUE_TYPES / VISIBILITY_PRESETS）
 * - scripts/check-yaml-vocabulary（failurePolicy 映射一致性门禁）
 *
 * 词表统一口径（YAML_UNIFICATION_AUDIT §2）：
 * - 字段类型：core 侧 `T[]` 拼写（string[]/object[]，enum 为 core-only），编排侧 `array<T>`（array<string>/array<object>），
 *   `?` 后缀仅 core 侧允许；裸 `array` 不设白名单（2026-08 已统一为具体类型）
 * - failurePolicy：core=业务意图（retry/fallback/propagate），manifest=运行时契约（retry/deterministic-fallback/blocking/best-effort/none），
 *   双向映射表机器可查；best-effort/none 无 core 对应（core-only 侧无入口）
 */

export const CORE_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'object[]',
  'string[]',
] as const;
export type CoreFieldType = (typeof CORE_FIELD_TYPES)[number];

/** 编排 valueType 受控词表（array<T> 拼写；裸 array 已归一，不设白名单项） */
export const CORE_VALUE_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array<string>',
  'array<object>',
] as const;
export type CoreValueType = (typeof CORE_VALUE_TYPES)[number];

/** 编排 visibilityPreset 受控词表（实测 2 值；历史五预设设计未落地，新值走词表扩展） */
export const VISIBILITY_PRESETS = ['user-clarification', 'agent-internal'] as const;
export type VisibilityPreset = (typeof VISIBILITY_PRESETS)[number];

/**
 * core params.failurePolicy（业务意图词表，SKILL_PROTOCOL_V4 §2.4.4）
 * 2026-08-11：fallback 已退役（纯重试+明确失败改造），存量 core 已收敛为 retry/propagate；
 * 词表保留 fallback 仅为兼容历史数据，中期收敛为 retry | propagate 两值（见 RETRY_FAILURE_IMPACT.md §5.2 路径 B）。
 */
export const FAILURE_POLICY_CORE = ['retry', 'fallback', 'propagate'] as const;
export type CoreFailurePolicy = (typeof FAILURE_POLICY_CORE)[number];

/** manifest promptContract.failurePolicy（运行时契约词表，skill-prompt-contract §v2） */
export const FAILURE_POLICY_MANIFEST = [
  'retry',
  'deterministic-fallback',
  'blocking',
  'best-effort',
  'none',
] as const;
export type ManifestFailurePolicy = (typeof FAILURE_POLICY_MANIFEST)[number];

/**
 * core → manifest 失败策略映射（唯一映射表）：
 * retry⇔retry、fallback⇔deterministic-fallback、propagate⇔blocking；
 * best-effort/none 无 core 对应，返回 undefined。
 */
export function manifestFailurePolicyOf(core: string): ManifestFailurePolicy | undefined {
  switch (core) {
    case 'retry':
      return 'retry';
    case 'fallback':
      return 'deterministic-fallback';
    case 'propagate':
      return 'blocking';
    default:
      return undefined;
  }
}

/** manifest → core 失败策略映射（manifestFailurePolicyOf 的反向；best-effort/none 无 core 对应返回 undefined） */
export function coreFailurePolicyOf(manifest: string): CoreFailurePolicy | undefined {
  switch (manifest) {
    case 'retry':
      return 'retry';
    case 'deterministic-fallback':
      return 'fallback';
    case 'blocking':
      return 'propagate';
    default:
      return undefined;
  }
}

/** 剥 `?` 后缀（core 侧字段类型可带；编排侧无此语法） */
export function stripOptionalSuffix(type: string): string {
  return type.trim().replace(/\?$/, '').trim();
}

/**
 * core 字段类型 → 编排 valueType（T[] ⇔ array<T> 拼写归一；剥 `?` 后缀）。
 * enum 为 core-only（值域列于 desc，SKILL_PROTOCOL_V4 §2.4.2），编排侧无对应 valueType，返回 undefined；
 * 未知类型返回 undefined（fail loud 由调用方负责）。
 */
export function coreTypeToValueType(type: string): string | undefined {
  const base = stripOptionalSuffix(type);
  switch (base) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return base;
    case 'object[]':
      return 'array<object>';
    case 'string[]':
      return 'array<string>';
    default:
      return undefined; // enum 与未知类型：core-only，无编排侧拼写
  }
}

/**
 * 编排 valueType → core 字段类型（反向归一；array<T> ⇔ T[]）。
 * 未知类型返回 undefined（校验闭环由调用方负责）。
 */
export function valueTypeToCoreType(valueType: string): string | undefined {
  const base = valueType.trim();
  switch (base) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return base;
    case 'array<string>':
      return 'string[]';
    case 'array<object>':
      return 'object[]';
    default:
      return undefined;
  }
}

/** 编排 promptRole 受控词表（单源；orchestration-file 经 re-export 保兼容） */
export const PROMPT_ROLES = [
  'hard-required',
  'soft-info',
  'hidden-inference',
  'public-reply',
  'proposal-output',
  'derived-presentation',
  'control-signal',
] as const;
export type PromptRole = (typeof PROMPT_ROLES)[number];

/** 编排 render 受控词表（单源） */
export const RENDER_VALUES = ['visible', 'hidden'] as const;
export type RenderValue = (typeof RENDER_VALUES)[number];
