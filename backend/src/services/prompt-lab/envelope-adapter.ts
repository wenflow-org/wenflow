import {
  type RuntimeBusinessStatus,
  type RuntimeContract,
  type RuntimeContextUpdateMode,
  type RuntimeStateOwner,
  buildDefaultRuntimeContract,
  normalizeRuntimeContract,
} from './runtime-contract';

export interface RuntimeBusinessState {
  domain: string;
  phase: string;
  status: RuntimeBusinessStatus;
  confidence?: number;
  isTerminal: boolean;
  nextAction?: string | null;
  reason?: string | null;
}

export interface RuntimeContextUpdate {
  mode: RuntimeContextUpdateMode;
  stateOwner: RuntimeStateOwner;
  nextState?: unknown | null;
}

/**
 * 统一运行时 envelope：
 * - artifact: 业务载荷
 * - businessState: 阶段/状态机视图
 * - contextUpdate: 上下文刷新指令
 */
export interface RuntimeEnvelope {
  artifact: unknown;
  businessState: RuntimeBusinessState;
  contextUpdate: RuntimeContextUpdate;
}

export interface AdaptToRuntimeEnvelopeInput {
  contract: RuntimeContract;
  artifact: unknown;
  phase?: string;
  status?: RuntimeBusinessStatus;
  confidence?: number;
  isTerminal?: boolean;
  nextAction?: string | null;
  reason?: string | null;
  nextState?: unknown | null;
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function resolvePhase(contract: RuntimeContract, phase?: string): string {
  const candidate = typeof phase === 'string' ? phase.trim() : '';
  if (candidate && contract.businessState.phases.includes(candidate)) return candidate;
  return contract.businessState.defaultPhase;
}

function resolveStatus(
  contract: RuntimeContract,
  status?: RuntimeBusinessStatus
): RuntimeBusinessStatus {
  if (status && contract.businessState.statusValues.includes(status)) return status;
  return contract.businessState.statusValues[0] || 'succeeded';
}

/**
 * 将 skill 业务输出映射为统一 RuntimeEnvelope。
 * outputEnvelope=model 时若 artifact 已是 envelope 则透传归一化；否则统一包装。
 */
export function adaptToRuntimeEnvelope(input: AdaptToRuntimeEnvelopeInput): RuntimeEnvelope {
  // contract 已是正式结构时原样透传；若上游传入部分对象则 normalize
  const contract =
    input.contract?.version === 'prompt-runtime-contract/v1' &&
    Array.isArray(input.contract.businessState?.phases)
      ? input.contract
      : normalizeRuntimeContract(input.contract, {
          skillId: String(input.contract?.businessState?.domain || 'unknown'),
        });

  if (
    contract.outputEnvelope === 'model' &&
    input.artifact &&
    typeof input.artifact === 'object' &&
    'artifact' in (input.artifact as object) &&
    'businessState' in (input.artifact as object) &&
    'contextUpdate' in (input.artifact as object)
  ) {
    const raw = input.artifact as RuntimeEnvelope;
    const phase = resolvePhase(
      contract,
      raw.businessState?.phase || input.phase
    );
    return {
      artifact: raw.artifact,
      businessState: {
        domain: contract.businessState.domain,
        phase,
        status: resolveStatus(contract, raw.businessState?.status || input.status),
        confidence: clampConfidence(raw.businessState?.confidence ?? input.confidence),
        isTerminal:
          typeof raw.businessState?.isTerminal === 'boolean'
            ? raw.businessState.isTerminal
            : contract.businessState.terminalPhases.includes(phase),
        nextAction:
          raw.businessState?.nextAction !== undefined
            ? raw.businessState.nextAction
            : input.nextAction ?? null,
        reason:
          raw.businessState?.reason !== undefined
            ? raw.businessState.reason
            : input.reason ?? null,
      },
      contextUpdate: {
        mode: contract.contextUpdate.mode,
        stateOwner: contract.contextUpdate.stateOwner,
        nextState:
          raw.contextUpdate?.nextState !== undefined
            ? raw.contextUpdate.nextState
            : input.nextState ?? null,
      },
    };
  }

  const phase = resolvePhase(contract, input.phase);
  const isTerminal =
    typeof input.isTerminal === 'boolean'
      ? input.isTerminal
      : contract.businessState.terminalPhases.includes(phase);

  return {
    artifact: input.artifact,
    businessState: {
      domain: contract.businessState.domain,
      phase,
      status: resolveStatus(contract, input.status),
      confidence: clampConfidence(input.confidence),
      isTerminal,
      nextAction: input.nextAction ?? null,
      reason: input.reason ?? null,
    },
    contextUpdate: {
      mode: contract.contextUpdate.mode,
      stateOwner: contract.contextUpdate.stateOwner,
      nextState: contract.contextUpdate.mode === 'none' ? null : input.nextState ?? null,
    },
  };
}

export interface GoalConversationEnvelopeSource {
  userVisible: string;
  internal: {
    core: {
      stage: string;
      confidence: number;
      isCompleted: boolean;
    };
    ext: {
      goalConversation: {
        understanding?: unknown;
        nextQuestions?: unknown;
        quickReplies?: unknown;
        collected?: unknown;
        structuredData?: unknown;
        confirmedProposal?: unknown;
        confidenceScores?: unknown;
      };
    };
  };
}

function inferGoalNextAction(phase: string): string {
  if (phase === 'proposing') return 'await-confirm';
  if (phase === 'ready' || phase === 'completed') return 'generate-path';
  return 'continue-clarify';
}

/**
 * goal-conversation 专用映射：agent-output 内部结构 → RuntimeEnvelope
 */
/**
 * 通用 skill 输出 → RuntimeEnvelope（virtual-learner / path 链等可复用）
 */
export function mapSkillOutputEnvelope(
  skillId: string,
  output: unknown,
  options: {
    archetype?: string;
    phase?: string;
    status?: RuntimeBusinessStatus;
    nextState?: unknown | null;
    isTerminal?: boolean;
    nextAction?: string | null;
    reason?: string | null;
    confidence?: number;
  } = {}
): RuntimeEnvelope {
  const contract = buildDefaultRuntimeContract(
    skillId.replace(/^skill:/, ''),
    options.archetype || ''
  );
  const phase = options.phase || contract.businessState.defaultPhase;
  const nextState =
    options.nextState !== undefined
      ? options.nextState
      : contract.contextUpdate.mode === 'none'
        ? null
        : (output && typeof output === 'object' && (output as any).learnerState
          ? (output as any).learnerState
          : null);

  return adaptToRuntimeEnvelope({
    contract,
    artifact: output,
    phase,
    status: options.status || 'succeeded',
    confidence: options.confidence,
    isTerminal:
      typeof options.isTerminal === 'boolean'
        ? options.isTerminal
        : contract.businessState.terminalPhases.includes(phase),
    nextAction: options.nextAction ?? null,
    reason: options.reason ?? null,
    nextState,
  });
}

export function adaptGoalConversationEnvelope(
  result: GoalConversationEnvelopeSource,
  options: {
    contract: RuntimeContract;
    status?: RuntimeBusinessStatus;
    reason?: string | null;
  }
): RuntimeEnvelope {
  const gc = result.internal.ext.goalConversation || {};
  const phase = result.internal.core.stage;
  const nextState = {
    stage: phase,
    confidence: result.internal.core.confidence,
    understanding: gc.understanding || {},
    collected: gc.collected || {},
    confirmedProposal: gc.confirmedProposal ?? null,
    structuredData: gc.structuredData ?? null,
    confidenceScores: gc.confidenceScores ?? null,
  };

  return adaptToRuntimeEnvelope({
    contract: options.contract,
    artifact: {
      reply: result.userVisible,
      understanding: gc.understanding || {},
      nextQuestions: Array.isArray(gc.nextQuestions) ? gc.nextQuestions : [],
      quickReplies: gc.quickReplies,
      confirmedProposal: gc.confirmedProposal,
      confidenceScores: gc.confidenceScores,
      structuredData: gc.structuredData,
      collected: gc.collected,
    },
    phase,
    status: options.status || 'succeeded',
    confidence: result.internal.core.confidence,
    isTerminal: result.internal.core.isCompleted,
    nextAction: inferGoalNextAction(phase),
    reason: options.reason ?? null,
    nextState,
  });
}
