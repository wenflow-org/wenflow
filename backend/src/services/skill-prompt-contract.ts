import type { Archetype } from './prompt-schema';
import type { RuntimeContract } from './prompt-lab/runtime-contract';

export type SkillPromptExecutionMode = 'llm' | 'code-only';

export type SkillPromptArtifactKind =
  | 'conversation'
  | 'generation'
  | 'extraction'
  | 'distillation'
  | 'copy'
  | 'normalization'
  | 'compilation'
  | 'code';

export type SkillPromptInteractionMode = 'turn' | 'snapshot' | 'batch' | 'none';
export type SkillPromptInputTransport = 'json' | 'tagged-text' | 'yaml' | 'mixed' | 'none';
export type SkillPromptOutputMedia = 'json' | 'markdown' | 'text' | 'none';
export type SkillPromptSchemaSource =
  | 'skill-definition'
  | 'runtime-validator'
  | 'prompt-example'
  | 'external-spec'
  | 'none';
export type SkillPromptOutputEnvelope = 'adapter' | 'model' | 'none';
export type SkillPromptContextDelivery = 'sidecar' | 'none';
export type SkillPromptModelExposure = 'projected' | 'none';
export type SkillPromptFailurePolicy =
  | 'blocking'
  | 'retry'
  | 'best-effort'
  | 'deterministic-fallback'
  | 'none';

/**
 * 字段级角色分类（三轴正交）：
 * - direction：input（平台→模型）/ output（模型→平台）/ state（双向主记忆，进时快照、出时 nextState）
 * - visibility：user-visible（前端可看）/ handoff（交给编排层）/ internal（内部处理）/ debug（仅调试）
 * - owner：仅 state 有意义——该字段的写入权威（runtime/model/orchestrator/none）
 * - export：仅 output 有意义——除默认 userVisible 通道外的流出方式（renderHints/event/none）
 */
export type SkillPromptFieldDirection = 'input' | 'output' | 'state';
export type SkillPromptFieldVisibility = 'user-visible' | 'handoff' | 'internal' | 'debug';
export type SkillPromptFieldOwner = 'runtime' | 'model' | 'orchestrator' | 'none';
export type SkillPromptFieldExport = 'renderHints' | 'event' | 'none';

export interface SkillPromptFieldRole {
  direction: SkillPromptFieldDirection;
  visibility: SkillPromptFieldVisibility;
  owner?: SkillPromptFieldOwner;
  export?: SkillPromptFieldExport;
}

export interface SkillPromptContract {
  version: 'skill-prompt-contract/v2';
  executionMode: SkillPromptExecutionMode;
  artifactKind: SkillPromptArtifactKind;
  interactionMode: SkillPromptInteractionMode;
  input: {
    transport: SkillPromptInputTransport;
    schemaSource: SkillPromptSchemaSource;
  };
  output: {
    media: SkillPromptOutputMedia;
    schemaSource: SkillPromptSchemaSource;
    envelope: SkillPromptOutputEnvelope;
  };
  context: {
    envelope: 'context-envelope/v1' | 'none';
    delivery: SkillPromptContextDelivery;
    modelExposure: SkillPromptModelExposure;
  };
  failurePolicy: SkillPromptFailurePolicy;
  /** 可选字段角色声明；缺失时不影响契约其他部分。 */
  fields?: Record<string, SkillPromptFieldRole>;
}

export interface SkillPromptContractIdentity {
  skillId: string;
  archetype?: string;
  runtimeContract?: RuntimeContract | null;
}

export interface SkillPromptContractIssue {
  level: 'error' | 'warning';
  code: string;
  field: string;
  message: string;
}

const EXECUTION_MODES: SkillPromptExecutionMode[] = ['llm', 'code-only'];
const ARTIFACT_KINDS: SkillPromptArtifactKind[] = [
  'conversation',
  'generation',
  'extraction',
  'distillation',
  'copy',
  'normalization',
  'compilation',
  'code',
];
const INTERACTION_MODES: SkillPromptInteractionMode[] = ['turn', 'snapshot', 'batch', 'none'];
const INPUT_TRANSPORTS: SkillPromptInputTransport[] = ['json', 'tagged-text', 'yaml', 'mixed', 'none'];
const OUTPUT_MEDIA: SkillPromptOutputMedia[] = ['json', 'markdown', 'text', 'none'];
const SCHEMA_SOURCES: SkillPromptSchemaSource[] = [
  'skill-definition',
  'runtime-validator',
  'prompt-example',
  'external-spec',
  'none',
];
const OUTPUT_ENVELOPES: SkillPromptOutputEnvelope[] = ['adapter', 'model', 'none'];
const CONTEXT_DELIVERIES: SkillPromptContextDelivery[] = ['sidecar', 'none'];
const MODEL_EXPOSURES: SkillPromptModelExposure[] = ['projected', 'none'];
const FAILURE_POLICIES: SkillPromptFailurePolicy[] = [
  'blocking',
  'retry',
  'best-effort',
  'deterministic-fallback',
  'none',
];
const FIELD_DIRECTIONS: SkillPromptFieldDirection[] = ['input', 'output', 'state'];
const FIELD_VISIBILITIES: SkillPromptFieldVisibility[] = ['user-visible', 'handoff', 'internal', 'debug'];
const FIELD_OWNERS: SkillPromptFieldOwner[] = ['runtime', 'model', 'orchestrator', 'none'];
const FIELD_EXPORTS: SkillPromptFieldExport[] = ['renderHints', 'event', 'none'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeArchetype(value: string | undefined): Archetype {
  const allowed: Archetype[] = [
    'conversational',
    'generator',
    'extractor',
    'distiller',
    'copywriter',
    'code-only',
  ];
  return allowed.includes(value as Archetype) ? value as Archetype : 'generator';
}

function inferArtifactKind(skillId: string, archetype: Archetype): SkillPromptArtifactKind {
  if (archetype === 'code-only') return 'code';
  if (skillId === 'prompt-compiler') return 'compilation';
  if (skillId === 'path-scene-framing') return 'normalization';
  if (archetype === 'conversational') return 'conversation';
  if (archetype === 'extractor') return 'extraction';
  if (archetype === 'distiller') return 'distillation';
  if (archetype === 'copywriter') return 'copy';
  return 'generation';
}

function inferInteractionMode(archetype: Archetype): SkillPromptInteractionMode {
  if (archetype === 'code-only') return 'none';
  if (archetype === 'conversational') return 'turn';
  return 'snapshot';
}

function inferInputTransport(skillId: string, archetype: Archetype): SkillPromptInputTransport {
  if (archetype === 'code-only') return 'none';
  if (skillId === 'prompt-compiler') return 'yaml';
  if (['path-planning', 'peer-reinforcement', 'session-wrapup', 'label-generator'].includes(skillId)) {
    return 'tagged-text';
  }
  return 'json';
}

function inferOutputMedia(skillId: string, archetype: Archetype): SkillPromptOutputMedia {
  if (archetype === 'code-only') return 'none';
  if (skillId === 'prompt-compiler') return 'markdown';
  return 'json';
}

function inferFailurePolicy(skillId: string, archetype: Archetype): SkillPromptFailurePolicy {
  if (archetype === 'code-only') return 'none';
  if (['goal-conversation', 'path-planning', 'path-scene-framing', 'stage-designer', 'teaching-turn', 'prompt-compiler'].includes(skillId)) {
    return 'retry';
  }
  if (['adaptive-guidance-copy', 'dialogue-concept-extractor', 'goal-profile-inference', 'label-generator', 'learning-pattern-distiller', 'session-knowledge-distiller', 'session-wrapup', 'peer-reinforcement'].includes(skillId)) {
    return 'deterministic-fallback';
  }
  if (archetype === 'extractor' || archetype === 'distiller' || archetype === 'copywriter') {
    return 'best-effort';
  }
  return 'blocking';
}

export function buildDefaultSkillPromptContract(identity: SkillPromptContractIdentity): SkillPromptContract {
  const skillId = String(identity.skillId || '').replace(/^skill:/, '').trim();
  const archetype = normalizeArchetype(identity.archetype);
  const executionMode: SkillPromptExecutionMode = archetype === 'code-only' ? 'code-only' : 'llm';
  const outputMedia = inferOutputMedia(skillId, archetype);
  return {
    version: 'skill-prompt-contract/v2',
    executionMode,
    artifactKind: inferArtifactKind(skillId, archetype),
    interactionMode: inferInteractionMode(archetype),
    input: {
      transport: inferInputTransport(skillId, archetype),
      schemaSource: executionMode === 'code-only' ? 'none' : 'skill-definition',
    },
    output: {
      media: outputMedia,
      schemaSource: executionMode === 'code-only'
        ? 'none'
        : skillId === 'prompt-compiler'
          ? 'external-spec'
          : 'runtime-validator',
      envelope: executionMode === 'code-only'
        ? 'none'
        : identity.runtimeContract?.outputEnvelope || 'adapter',
    },
    context: {
      envelope: 'context-envelope/v1',
      delivery: 'sidecar',
      modelExposure: executionMode === 'code-only' ? 'none' : 'projected',
    },
    failurePolicy: inferFailurePolicy(skillId, archetype),
  };
}

function normalizeFieldRole(value: unknown): SkillPromptFieldRole | null {
  if (!isRecord(value)) return null;
  if (typeof value.direction !== 'string' || !FIELD_DIRECTIONS.includes(value.direction as SkillPromptFieldDirection)) return null;
  if (typeof value.visibility !== 'string' || !FIELD_VISIBILITIES.includes(value.visibility as SkillPromptFieldVisibility)) return null;
  const role: SkillPromptFieldRole = {
    direction: value.direction as SkillPromptFieldDirection,
    visibility: value.visibility as SkillPromptFieldVisibility,
  };
  if (typeof value.owner === 'string' && FIELD_OWNERS.includes(value.owner as SkillPromptFieldOwner)) {
    role.owner = value.owner as SkillPromptFieldOwner;
  }
  if (typeof value.export === 'string' && FIELD_EXPORTS.includes(value.export as SkillPromptFieldExport)) {
    role.export = value.export as SkillPromptFieldExport;
  }
  return role;
}

/** 字段名排序归一，保证 ACTIVE metadata 快照与文件声明的结构比较键序无关。 */
export function normalizeSkillPromptFields(value: unknown): Record<string, SkillPromptFieldRole> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, SkillPromptFieldRole> = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = key.trim();
    if (!name) continue;
    const role = normalizeFieldRole(raw);
    if (role) result[name] = role;
  }
  const names = Object.keys(result).sort();
  if (names.length === 0) return undefined;
  return Object.fromEntries(names.map((name) => [name, result[name]]));
}

export function normalizeSkillPromptContract(
  value: unknown,
  identity: SkillPromptContractIdentity
): SkillPromptContract {
  const base = buildDefaultSkillPromptContract(identity);
  const candidate = isRecord(value) ? value : {};
  const input = isRecord(candidate.input) ? candidate.input : {};
  const output = isRecord(candidate.output) ? candidate.output : {};
  const context = isRecord(candidate.context) ? candidate.context : {};
  const fields = normalizeSkillPromptFields(candidate.fields);

  return {
    version: 'skill-prompt-contract/v2',
    executionMode: pickOne(candidate.executionMode, EXECUTION_MODES, base.executionMode),
    artifactKind: pickOne(candidate.artifactKind, ARTIFACT_KINDS, base.artifactKind),
    interactionMode: pickOne(candidate.interactionMode, INTERACTION_MODES, base.interactionMode),
    input: {
      transport: pickOne(input.transport, INPUT_TRANSPORTS, base.input.transport),
      schemaSource: pickOne(input.schemaSource, SCHEMA_SOURCES, base.input.schemaSource),
    },
    output: {
      media: pickOne(output.media, OUTPUT_MEDIA, base.output.media),
      schemaSource: pickOne(output.schemaSource, SCHEMA_SOURCES, base.output.schemaSource),
      envelope: pickOne(output.envelope, OUTPUT_ENVELOPES, base.output.envelope),
    },
    context: {
      envelope: pickOne(context.envelope, ['context-envelope/v1', 'none'] as const, base.context.envelope),
      delivery: pickOne(context.delivery, CONTEXT_DELIVERIES, base.context.delivery),
      modelExposure: pickOne(context.modelExposure, MODEL_EXPOSURES, base.context.modelExposure),
    },
    failurePolicy: pickOne(candidate.failurePolicy, FAILURE_POLICIES, base.failurePolicy),
    ...(fields ? { fields } : {}),
  };
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  issues: SkillPromptContractIssue[]
): void {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push({
      level: 'error',
      code: 'INVALID_PROMPT_CONTRACT_FIELD',
      field,
      message: `${field} 必须是以下值之一：${allowed.join(', ')}`,
    });
  }
}

export function lintDeclaredSkillPromptContract(
  value: unknown,
  identity: SkillPromptContractIdentity
): { contract: SkillPromptContract; issues: SkillPromptContractIssue[] } {
  const issues: SkillPromptContractIssue[] = [];
  const archetype = normalizeArchetype(identity.archetype);
  if (!isRecord(value)) {
    issues.push({
      level: 'error',
      code: 'MISSING_PROMPT_CONTRACT',
      field: 'promptContract',
      message: 'frontmatter 必须声明 promptContract: skill-prompt-contract/v2',
    });
    return { contract: buildDefaultSkillPromptContract(identity), issues };
  }

  requireOneOf(value.version, ['skill-prompt-contract/v2'] as const, 'promptContract.version', issues);
  requireOneOf(value.executionMode, EXECUTION_MODES, 'promptContract.executionMode', issues);
  requireOneOf(value.artifactKind, ARTIFACT_KINDS, 'promptContract.artifactKind', issues);
  requireOneOf(value.interactionMode, INTERACTION_MODES, 'promptContract.interactionMode', issues);

  if (!isRecord(value.input)) {
    issues.push({ level: 'error', code: 'INVALID_PROMPT_CONTRACT_FIELD', field: 'promptContract.input', message: 'promptContract.input 必须是对象' });
  } else {
    requireOneOf(value.input.transport, INPUT_TRANSPORTS, 'promptContract.input.transport', issues);
    requireOneOf(value.input.schemaSource, SCHEMA_SOURCES, 'promptContract.input.schemaSource', issues);
  }

  if (!isRecord(value.output)) {
    issues.push({ level: 'error', code: 'INVALID_PROMPT_CONTRACT_FIELD', field: 'promptContract.output', message: 'promptContract.output 必须是对象' });
  } else {
    requireOneOf(value.output.media, OUTPUT_MEDIA, 'promptContract.output.media', issues);
    requireOneOf(value.output.schemaSource, SCHEMA_SOURCES, 'promptContract.output.schemaSource', issues);
    requireOneOf(value.output.envelope, OUTPUT_ENVELOPES, 'promptContract.output.envelope', issues);
  }

  if (!isRecord(value.context)) {
    issues.push({ level: 'error', code: 'INVALID_PROMPT_CONTRACT_FIELD', field: 'promptContract.context', message: 'promptContract.context 必须是对象' });
  } else {
    requireOneOf(value.context.envelope, ['context-envelope/v1', 'none'] as const, 'promptContract.context.envelope', issues);
    requireOneOf(value.context.delivery, CONTEXT_DELIVERIES, 'promptContract.context.delivery', issues);
    requireOneOf(value.context.modelExposure, MODEL_EXPOSURES, 'promptContract.context.modelExposure', issues);
  }

  requireOneOf(value.failurePolicy, FAILURE_POLICIES, 'promptContract.failurePolicy', issues);
  const contract = normalizeSkillPromptContract(value, identity);

  if (archetype === 'code-only' && contract.executionMode !== 'code-only') {
    issues.push({ level: 'error', code: 'PROMPT_CONTRACT_ARCHETYPE_MISMATCH', field: 'promptContract.executionMode', message: 'code-only archetype 必须使用 executionMode=code-only' });
  }
  if (archetype !== 'code-only' && contract.executionMode !== 'llm') {
    issues.push({ level: 'error', code: 'PROMPT_CONTRACT_ARCHETYPE_MISMATCH', field: 'promptContract.executionMode', message: `${archetype} archetype 必须使用 executionMode=llm` });
  }
  if (contract.executionMode === 'code-only') {
    if (contract.interactionMode !== 'none' || contract.input.transport !== 'none' || contract.output.media !== 'none' || contract.output.envelope !== 'none') {
      issues.push({ level: 'error', code: 'PROMPT_CONTRACT_CODE_ONLY_IO', field: 'promptContract', message: 'code-only 契约必须使用 interactionMode/input/output/envelope 的 none 组合' });
    }
  } else {
    if (contract.context.envelope !== 'context-envelope/v1' || contract.context.delivery !== 'sidecar') {
      issues.push({ level: 'error', code: 'PROMPT_CONTRACT_CONTEXT_POLICY', field: 'promptContract.context', message: 'LLM skill 必须通过 context-envelope/v1 sidecar 接收统一上下文' });
    }
    if (contract.output.media === 'none' || contract.output.envelope === 'none') {
      issues.push({ level: 'error', code: 'PROMPT_CONTRACT_LLM_OUTPUT', field: 'promptContract.output', message: 'LLM skill 必须声明实际输出媒体和 envelope' });
    }
  }
  if (identity.runtimeContract && contract.executionMode === 'llm' && contract.output.envelope !== identity.runtimeContract.outputEnvelope) {
    issues.push({
      level: 'error',
      code: 'PROMPT_RUNTIME_ENVELOPE_MISMATCH',
      field: 'promptContract.output.envelope',
      message: `promptContract.output.envelope=${contract.output.envelope} 与 runtimeContract.outputEnvelope=${identity.runtimeContract.outputEnvelope} 不一致`,
    });
  }

  // fields：字段级角色声明（direction × visibility × owner/export）
  if (value.fields !== undefined) {
    if (!isRecord(value.fields)) {
      issues.push({
        level: 'error',
        code: 'INVALID_PROMPT_CONTRACT_FIELD',
        field: 'promptContract.fields',
        message: 'promptContract.fields 必须是对象',
      });
    } else {
      for (const [name, raw] of Object.entries(value.fields)) {
        const prefix = `promptContract.fields.${name}`;
        if (!name.trim()) {
          issues.push({ level: 'error', code: 'INVALID_PROMPT_CONTRACT_FIELD', field: prefix, message: '字段名不能为空' });
          continue;
        }
        if (!isRecord(raw)) {
          issues.push({ level: 'error', code: 'INVALID_PROMPT_CONTRACT_FIELD', field: prefix, message: `${prefix} 必须是对象` });
          continue;
        }
        requireOneOf(raw.direction, FIELD_DIRECTIONS, `${prefix}.direction`, issues);
        requireOneOf(raw.visibility, FIELD_VISIBILITIES, `${prefix}.visibility`, issues);
        if (raw.owner !== undefined) {
          requireOneOf(raw.owner, FIELD_OWNERS, `${prefix}.owner`, issues);
          if (raw.direction !== 'state') {
            issues.push({ level: 'warning', code: 'PROMPT_CONTRACT_FIELD_AXIS_MISUSE', field: `${prefix}.owner`, message: 'owner 仅对 direction=state 的字段有意义' });
          }
        }
        if (raw.export !== undefined) {
          requireOneOf(raw.export, FIELD_EXPORTS, `${prefix}.export`, issues);
          if (raw.direction !== 'output') {
            issues.push({ level: 'warning', code: 'PROMPT_CONTRACT_FIELD_AXIS_MISUSE', field: `${prefix}.export`, message: 'export 仅对 direction=output 的字段有意义' });
          }
        }
        if (raw.direction === 'input' && raw.visibility === 'user-visible' && name !== 'userInput' && name !== 'latestLearnerMessage') {
          issues.push({ level: 'warning', code: 'PROMPT_CONTRACT_FIELD_VISIBILITY', field: `${prefix}.visibility`, message: 'input 字段通常不应声明 user-visible（用户原生消息除外）' });
        }
      }
    }
  }
  if (identity.runtimeContract && contract.fields) {
    const stateOwner = identity.runtimeContract.contextUpdate.stateOwner;
    if (stateOwner !== 'none') {
      for (const [name, role] of Object.entries(contract.fields)) {
        if (role.direction === 'state' && role.owner && role.owner !== 'none' && role.owner !== stateOwner) {
          issues.push({
            level: 'warning',
            code: 'PROMPT_CONTRACT_STATE_OWNER_MISMATCH',
            field: `promptContract.fields.${name}.owner`,
            message: `fields.${name}.owner=${role.owner} 与 runtimeContract.contextUpdate.stateOwner=${stateOwner} 不一致`,
          });
        }
      }
    }
  }

  return { contract, issues };
}
