/**
 * Phase 2：澄清契约门控的响应改写（纯函数，服务层只负责开关与日志）。
 *
 * 与 Phase 1 shadow 的区别：
 * - shadow 只记「本应拦截」；
 * - 本模块在 enabled=true 时真的把 proposing/ready 回落到 understanding，
 *   清掉 confirmedProposal，并把 reply 替换成一条澄清提问。
 *
 * 开关：默认开启；`GOAL_CLARIFICATION_ENFORCE=0` 显式关闭，回滚到 Phase 1 / 旧行为。
 */
import {
  decideClarificationGate,
  isClarificationEnforceEnabled,
  type ClarificationGateDecision,
} from './goal-clarification-contract';

interface GoalGateGoalConversation {
  clarification?: unknown;
  nextAction?: string | null;
  confirmedProposal?: unknown;
  nextQuestions?: unknown;
  quickReplies?: unknown;
  [key: string]: unknown;
}

interface GoalGateInternal {
  core?: {
    stage?: string;
    isCompleted?: boolean;
    [key: string]: unknown;
  };
  ext?: {
    goalConversation?: GoalGateGoalConversation;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface GoalGateEnvelope {
  businessState?: {
    phase?: string;
    isTerminal?: boolean;
    nextAction?: string | null;
    [key: string]: unknown;
  };
  artifact?: unknown;
  contextUpdate?: {
    nextState?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GoalGateResponse {
  userVisible: string;
  internal: GoalGateInternal;
  runtimeEnvelope?: GoalGateEnvelope;
}

export interface ClarificationGateBlockedInfo {
  conversationId: string;
  stage: string | null;
  blocking: ClarificationGateDecision['blocking'];
  prompt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * 如果契约不允许提案，则把响应改写成「澄清回合」：
 * - core.stage / runtimeEnvelope.phase → understanding
 * - confirmedProposal → null（前端不再出确认卡）
 * - reply → 最高优先级 unknown 的提问（或按缺口生成的兜底提问）
 * - nextQuestions / quickReplies → 新提问
 *
 * 不改 DB、不写日志；onBlocked 由调用方决定如何留痕。
 */
export function applyClarificationGateToResponse<T extends GoalGateResponse>(
  response: T,
  options: {
    conversationId: string;
    enabled: boolean;
    onBlocked?: (info: ClarificationGateBlockedInfo) => void;
  }
): T {
  if (!options.enabled) return response;

  const goalConversation = response?.internal?.ext?.goalConversation;
  if (!goalConversation || typeof goalConversation !== 'object') return response;

  const stage = response?.runtimeEnvelope?.businessState?.phase
    || response?.internal?.core?.stage
    || null;
  const decision = decideClarificationGate({
    clarification: goalConversation.clarification,
    nextAction: goalConversation.nextAction,
    confirmedProposal: goalConversation.confirmedProposal,
    stage,
  });
  if (!decision.blocked || !decision.prompt) return response;

  const prompt = decision.prompt;
  options.onBlocked?.({
    conversationId: options.conversationId,
    stage,
    blocking: decision.blocking,
    prompt,
  });

  const internal = response.internal;
  const ext = internal.ext || {};
  const nextInternal: GoalGateInternal = {
    ...internal,
    core: {
      ...(internal.core || {}),
      stage: 'understanding',
      isCompleted: false,
    },
    ext: {
      ...ext,
      goalConversation: {
        ...goalConversation,
        confirmedProposal: null,
        nextQuestions: [prompt],
        quickReplies: [],
        // 诊断留痕：模型原本可能写 propose，门控后统一记 ask。
        nextAction: 'ask',
      },
    },
  };

  const envelope = response.runtimeEnvelope;
  const nextEnvelope: GoalGateEnvelope | undefined = envelope
    ? {
        ...envelope,
        businessState: {
          ...(envelope.businessState || {}),
          phase: 'understanding',
          isTerminal: false,
          nextAction: 'ask',
        },
        ...(envelope.artifact && typeof envelope.artifact === 'object'
          ? {
              artifact: {
                ...asRecord(envelope.artifact),
                reply: prompt,
                confirmedProposal: null,
                nextQuestions: [prompt],
                quickReplies: [],
              },
            }
          : {}),
        ...(envelope.contextUpdate
          ? {
              contextUpdate: {
                ...envelope.contextUpdate,
                ...(envelope.contextUpdate.nextState && typeof envelope.contextUpdate.nextState === 'object'
                  ? {
                      nextState: {
                        ...asRecord(envelope.contextUpdate.nextState),
                        stage: 'understanding',
                        confirmedProposal: null,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      }
    : undefined;

  return {
    ...response,
    userVisible: prompt,
    internal: nextInternal,
    ...(nextEnvelope ? { runtimeEnvelope: nextEnvelope } : {}),
  } as T;
}

/** 服务层入口：读 env 开关，默认开启（`GOAL_CLARIFICATION_ENFORCE=0` 回滚）。 */
export function enforceClarificationGate<T extends GoalGateResponse>(
  response: T,
  options: {
    conversationId: string;
    env?: NodeJS.ProcessEnv;
    onBlocked?: (info: ClarificationGateBlockedInfo) => void;
  }
): T {
  return applyClarificationGateToResponse(response, {
    conversationId: options.conversationId,
    enabled: isClarificationEnforceEnabled(options.env),
    onBlocked: options.onBlocked,
  });
}
