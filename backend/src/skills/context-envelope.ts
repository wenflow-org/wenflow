import type { RetryBudget } from '../gateway/api-gateway/retry-budget';
import type { RuntimeContextMode } from '../services/prompt-lab/runtime-contract';

export type ContextEnvelopeRole = 'admin' | 'user' | 'tester' | 'viewer';
export type ContextEnvelopeSource = 'user' | 'test' | 'admin' | 'platform' | 'arena' | 'lab' | 'simulation';

export interface ContextEnvelopeV1 {
  schemaVersion: 'context-envelope/v1';
  principal?: {
    userId?: string;
    role?: ContextEnvelopeRole;
  };
  session?: {
    sessionId?: string;
    conversationId?: string;
    pathId?: string;
    taskId?: string;
  };
  locale?: {
    language?: string;
    timeZone?: string;
  };
  trace?: {
    traceId?: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
  };
  execution?: {
    sourceEntry?: ContextEnvelopeSource;
    agentId?: string;
    callerAgent?: string;
    skillId?: string;
    contextMode?: RuntimeContextMode;
    retry?: {
      budgetId?: string;
      limits?: RetryBudget['limits'];
    };
  };
  memory?: {
    state?: unknown;
    thread?: unknown[];
    snapshot?: unknown;
  };
  extensions?: Record<string, unknown>;
}

export interface ContextEnvelopeParentContext {
  userId?: string;
  userRole?: ContextEnvelopeRole;
  sessionId?: string;
  conversationId?: string;
  pathId?: string;
  taskId?: string;
  locale?: { language?: string; timeZone?: string };
  traceId?: string;
  executionLogId?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  sourceEntry?: ContextEnvelopeSource;
  agentId?: string;
  callerAgent?: string;
  skillId?: string;
  retryBudget?: RetryBudget;
  contextEnvelope?: ContextEnvelopeV1;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function roleValue(value: unknown): ContextEnvelopeRole | undefined {
  return ['admin', 'user', 'tester', 'viewer'].includes(String(value))
    ? value as ContextEnvelopeRole
    : undefined;
}

function sourceValue(value: unknown): ContextEnvelopeSource | undefined {
  return ['user', 'test', 'admin', 'platform', 'arena', 'lab', 'simulation'].includes(String(value))
    ? value as ContextEnvelopeSource
    : undefined;
}

function contextModeValue(value: unknown): RuntimeContextMode | undefined {
  return ['state-refresh', 'thread-context', 'snapshot-context', 'simulation-refresh'].includes(String(value))
    ? value as RuntimeContextMode
    : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactRecord<T extends Record<string, unknown>>(value: T): Partial<T> | undefined {
  const compacted = Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export function normalizeContextEnvelope(value: unknown): ContextEnvelopeV1 | undefined {
  if (!isRecord(value)) return undefined;
  const principal = isRecord(value.principal) ? value.principal : {};
  const session = isRecord(value.session) ? value.session : {};
  const locale = isRecord(value.locale) ? value.locale : {};
  const trace = isRecord(value.trace) ? value.trace : {};
  const execution = isRecord(value.execution) ? value.execution : {};
  const retry = isRecord(execution.retry) ? execution.retry : {};
  const memory = isRecord(value.memory) ? value.memory : {};
  const retryLimits = isRecord(retry.limits)
    ? {
        maxUpstreamAttempts: Number(retry.limits.maxUpstreamAttempts),
        maxTransportRetries: Number(retry.limits.maxTransportRetries),
        maxLogicalRetries: Number(retry.limits.maxLogicalRetries),
      }
    : undefined;

  return {
    schemaVersion: 'context-envelope/v1',
    principal: compactRecord({
      userId: stringValue(principal.userId),
      role: roleValue(principal.role),
    }),
    session: compactRecord({
      sessionId: stringValue(session.sessionId),
      conversationId: stringValue(session.conversationId),
      pathId: stringValue(session.pathId),
      taskId: stringValue(session.taskId),
    }),
    locale: compactRecord({
      language: stringValue(locale.language),
      timeZone: stringValue(locale.timeZone),
    }),
    trace: compactRecord({
      traceId: stringValue(trace.traceId),
      parentExecutionId: stringValue(trace.parentExecutionId),
      rootExecutionId: stringValue(trace.rootExecutionId),
    }),
    execution: compactRecord({
      sourceEntry: sourceValue(execution.sourceEntry),
      agentId: stringValue(execution.agentId),
      callerAgent: stringValue(execution.callerAgent),
      skillId: stringValue(execution.skillId),
      contextMode: contextModeValue(execution.contextMode),
      retry: compactRecord({
        budgetId: stringValue(retry.budgetId),
        limits: retryLimits && Object.values(retryLimits).every(Number.isFinite)
          ? retryLimits
          : undefined,
      }),
    }),
    memory: compactRecord({
      state: Object.prototype.hasOwnProperty.call(memory, 'state') ? memory.state : undefined,
      thread: Array.isArray(memory.thread) ? memory.thread : undefined,
      snapshot: Object.prototype.hasOwnProperty.call(memory, 'snapshot') ? memory.snapshot : undefined,
    }),
    extensions: isRecord(value.extensions) ? { ...value.extensions } : undefined,
  };
}

export function mergeContextEnvelopes(
  ...values: Array<ContextEnvelopeV1 | undefined>
): ContextEnvelopeV1 {
  const result: ContextEnvelopeV1 = { schemaVersion: 'context-envelope/v1' };
  for (const raw of values) {
    const value = normalizeContextEnvelope(raw);
    if (!value) continue;
    if (value.principal) result.principal = { ...result.principal, ...value.principal };
    if (value.session) result.session = { ...result.session, ...value.session };
    if (value.locale) result.locale = { ...result.locale, ...value.locale };
    if (value.trace) result.trace = { ...result.trace, ...value.trace };
    if (value.execution) {
      result.execution = {
        ...result.execution,
        ...value.execution,
        retry: value.execution.retry
          ? { ...result.execution?.retry, ...value.execution.retry }
          : result.execution?.retry,
      };
    }
    if (value.memory) result.memory = { ...result.memory, ...value.memory };
    if (value.extensions) result.extensions = { ...result.extensions, ...value.extensions };
  }
  return result;
}

function readLegacyContainer(input: any): Record<string, any>[] {
  return [
    input?.context,
    input?.input?.context,
    input?.pluginContext,
    input?.metadata,
    input?.input?.metadata,
  ].filter(isRecord);
}

export function contextEnvelopeFromLegacyInput(input: unknown): ContextEnvelopeV1 | undefined {
  const containers = readLegacyContainer(input);
  if (containers.length === 0) return undefined;
  const combined = Object.assign({}, ...containers);
  const locale = isRecord(combined.locale) ? combined.locale : {};
  const memory = isRecord(combined.memory) ? combined.memory : {};
  return normalizeContextEnvelope({
    principal: {
      userId: combined.userId,
      role: combined.userRole || combined.role,
    },
    session: {
      sessionId: combined.sessionId,
      conversationId: combined.conversationId,
      pathId: combined.pathId,
      taskId: combined.taskId,
    },
    locale: {
      language: locale.language || combined.language || combined.locale,
      timeZone: locale.timeZone || combined.timeZone || combined.timezone,
    },
    memory: {
      state: memory.state,
      thread: memory.thread,
      snapshot: memory.snapshot,
    },
  });
}

export function contextEnvelopeFromParent(parent: ContextEnvelopeParentContext): ContextEnvelopeV1 {
  return mergeContextEnvelopes(parent.contextEnvelope, normalizeContextEnvelope({
    principal: {
      userId: parent.userId,
      role: parent.userRole,
    },
    session: {
      sessionId: parent.sessionId,
      conversationId: parent.conversationId,
      pathId: parent.pathId,
      taskId: parent.taskId,
    },
    locale: parent.locale,
    trace: {
      traceId: parent.traceId,
      parentExecutionId: parent.parentExecutionId || parent.executionLogId,
      rootExecutionId: parent.rootExecutionId,
    },
    execution: {
      sourceEntry: parent.sourceEntry,
      agentId: parent.agentId,
      callerAgent: parent.callerAgent,
      skillId: parent.skillId,
      retry: parent.retryBudget
        ? { budgetId: parent.retryBudget.id, limits: parent.retryBudget.limits }
        : undefined,
    },
  }));
}

export function buildSkillContextEnvelope(params: {
  parent: ContextEnvelopeParentContext;
  input?: unknown;
  explicit?: ContextEnvelopeV1;
  skillId: string;
  agentId?: string;
  callerAgent?: string;
  executionLogId: string;
  parentExecutionId?: string;
  rootExecutionId: string;
  retryBudget: RetryBudget;
}): ContextEnvelopeV1 {
  const legacy = contextEnvelopeFromLegacyInput(params.input);
  const inherited = contextEnvelopeFromParent(params.parent);
  const explicit = normalizeContextEnvelope(params.explicit);

  // legacy 仅补空；显式 sidecar 可补业务会话信息；可信父上下文最终覆盖 principal/trace。
  return mergeContextEnvelopes(
    legacy,
    explicit,
    inherited,
    normalizeContextEnvelope({
      trace: {
        traceId: params.parent.traceId,
        parentExecutionId: params.parentExecutionId,
        rootExecutionId: params.rootExecutionId,
      },
      execution: {
        sourceEntry: params.parent.sourceEntry,
        agentId: params.agentId,
        callerAgent: params.callerAgent,
        skillId: params.skillId,
        retry: {
          budgetId: params.retryBudget.id,
          limits: params.retryBudget.limits,
        },
      },
      extensions: {
        skillExecutionId: params.executionLogId,
      },
    })
  );
}

export function withContextMode(
  envelope: ContextEnvelopeV1 | undefined,
  contextMode: RuntimeContextMode
): ContextEnvelopeV1 {
  return mergeContextEnvelopes(envelope, normalizeContextEnvelope({
    execution: { contextMode },
  }));
}
