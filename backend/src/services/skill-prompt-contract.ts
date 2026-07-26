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

export function normalizeSkillPromptContract(
  value: unknown,
  identity: SkillPromptContractIdentity
): SkillPromptContract {
  const base = buildDefaultSkillPromptContract(identity);
  const candidate = isRecord(value) ? value : {};
  const input = isRecord(candidate.input) ? candidate.input : {};
  const output = isRecord(candidate.output) ? candidate.output : {};
  const context = isRecord(candidate.context) ? candidate.context : {};

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

  return { contract, issues };
}
