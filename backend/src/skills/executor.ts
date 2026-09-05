import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { getRequestContext, runWithContext } from '../gateway/api-gateway/context';
import { getAgentOfSkill } from '../services/agent-manifest.service';
import { logger } from '../utils/logger';
import { redactLogValue } from '../utils/secret-redaction';
import { telemetryWriter } from '../services/telemetry-writer.service';
import { SkillDefinition, SkillExecutionResult } from './protocol';
import type { SkillExecutionOptions } from './protocol';
import {
  buildSkillContextEnvelope,
  normalizeContextEnvelope,
} from './context-envelope';
import {
  createRuntimeRetryBudget,
  getEffectiveLogicalRetryLimit
} from '../services/reliability-settings.service';

export type SkillHandler = (input: any) => Promise<any>;

function normalizeSkillId(definition: SkillDefinition | { id?: string; name?: string }): string {
  const rawId = definition.id || definition.name;
  if (!rawId) throw new Error('Skill definition is missing id or name');
  return rawId.replace(/^skill:/, '');
}

function summarizeSkillPayload(value: any, depth = 0): any {
  if (depth > 3) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 2).map((item) => summarizeSkillPayload(item, depth + 1)),
    };
  }
  if (typeof value === 'object') {
    // 深度预算：depth>=2 的对象不再展开键名树（10×10×10 会展开出数百键），
    // 仅保留对象形状摘要，防巨型日志
    if (depth >= 2) return '[max-depth]';
    const entries = Object.entries(value)
      .slice(0, 10)
      .map(([key, item]) => [key, summarizeSkillPayload(item, depth + 1)]);
    return Object.fromEntries(entries);
  }
  return String(value);
}

function summarizeSkillLogPayload(
  skillId: string,
  value: any,
  direction: 'input' | 'output'
): any {
  if (skillId === 'mcp-tool') {
    if (direction === 'input') {
      return {
        toolId: typeof value?.toolId === 'string' ? value.toolId : null,
        params: '[REDACTED]'
      };
    }
    const result = value?.result;
    return {
      toolId: typeof value?.toolId === 'string' ? value.toolId : null,
      source: typeof value?.source === 'string' ? value.source : null,
      resultType: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result
    };
  }
  return redactLogValue(summarizeSkillPayload(value));
}

function normalizeHandlerResult(result: any, durationMs: number): SkillExecutionResult {
  if (result && typeof result === 'object' && typeof result.success === 'boolean') {
    if (!result.success) {
      const error = result.error;
      return {
        success: false,
        error: typeof error === 'object' && error
          ? {
              code: error.code || 'SKILL_EXECUTION_FAILED',
              message: error.message || 'Skill execution failed',
              details: error.details,
            }
          : {
              code: 'SKILL_EXECUTION_FAILED',
              message: typeof error === 'string' ? error : 'Skill execution failed',
            },
        duration: durationMs,
      };
    }

    if (Object.prototype.hasOwnProperty.call(result, 'output')) {
      // quality 是 canonical 降级标记；cached 为兼容派生字段，双向桥接
      const quality = result.quality ?? (result.cached === true ? 'fallback' : undefined);
      const cached = result.cached ?? (quality === 'fallback' || quality === 'failed' ? true : undefined);
      return {
        success: true,
        output: result.output,
        duration: durationMs,
        cached,
        runtimeEnvelope: result.runtimeEnvelope,
        quality,
        ...(result.debug !== undefined ? { debug: result.debug } : {}),
      };
    }
  }

  return {
    success: true,
    output: result,
    duration: durationMs,
  };
}

function resolveExecutionUserId(
  input: any,
  inheritedUserId?: string,
  explicitContextEnvelope?: unknown
): string | undefined {
  if (inheritedUserId) return inheritedUserId;
  const explicitUserId = normalizeContextEnvelope(explicitContextEnvelope)?.principal?.userId;
  if (explicitUserId) return explicitUserId;
  const candidates = [
    input?.context?.userId,
    input?.input?.context?.userId,
    input?.pluginContext?.userId,
    input?.metadata?.userId,
    input?.input?.metadata?.userId,
    input?.userId,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim();
}

async function assertSkillEnabledForUser(skillId: string, userId?: string): Promise<void> {
  if (!userId || userId === 'system') return;
  const config = await prisma.user_skill_configs.findUnique({
    where: { userId_skillName: { userId, skillName: skillId } },
    select: { enabled: true },
  });
  if (config?.enabled === false) {
    throw Object.assign(new Error(`Skill ${skillId} is disabled for this user`), {
      code: 'SKILL_DISABLED',
    });
  }
}

export async function executeSkillHandler(
  definition: SkillDefinition | { id?: string; name?: string },
  input: any,
  handler: SkillHandler,
  options: SkillExecutionOptions = {}
): Promise<SkillExecutionResult> {
  const skillId = normalizeSkillId(definition);
  const startedAt = Date.now();
  const parentContext = getRequestContext();
  const executionLogId = `acl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const parentAgent = getAgentOfSkill(`skill:${skillId}`)?.id;
  const userId = resolveExecutionUserId(input, parentContext.userId, options.contextEnvelope);
  const inheritedRetryBudget = parentContext.retryBudget;
  const retryBudget = inheritedRetryBudget || await createRuntimeRetryBudget();
  const logicalRetryLimit = await getEffectiveLogicalRetryLimit(
    skillId,
    retryBudget.limits.maxLogicalRetries
  );
  const agentId = parentContext.agentId || parentAgent;
  const callerAgent = parentContext.callerAgent || parentAgent;
  const parentExecutionId = parentContext.executionLogId;
  const rootExecutionId = parentContext.rootExecutionId || parentContext.executionLogId || executionLogId;
  const contextEnvelope = buildSkillContextEnvelope({
    parent: { ...parentContext, userId },
    input,
    explicit: options.contextEnvelope,
    skillId,
    agentId,
    callerAgent,
    executionLogId,
    parentExecutionId,
    rootExecutionId,
    retryBudget,
  });
  const executionContext = {
    ...parentContext,
    userId,
    agentId,
    callerAgent,
    skillId,
    executionLogId,
    parentExecutionId,
    rootExecutionId,
    retryBudget,
    logicalRetryLimit,
    sessionId: parentContext.sessionId || contextEnvelope.session?.sessionId,
    conversationId: parentContext.conversationId || contextEnvelope.session?.conversationId,
    pathId: parentContext.pathId || contextEnvelope.session?.pathId,
    taskId: parentContext.taskId || contextEnvelope.session?.taskId,
    locale: contextEnvelope.locale,
    contextEnvelope,
    // 调用方显式取消信号优先于请求级信号（如 withTimeoutSignal 的超时取消）
    abortSignal: options.abortSignal || parentContext.abortSignal,
  };

  return runWithContext(executionContext, async () => {
    logger.debug('[skill-executor] 开始执行', {
      skillId,
      inputSummary: summarizeSkillLogPayload(skillId, input, 'input'),
    });

    try {
      await assertSkillEnabledForUser(skillId, userId);
      const rawResult = await handler(input);
      const durationMs = Date.now() - startedAt;
      const result = normalizeHandlerResult(rawResult, durationMs);

      if (!result.success) {
        throw Object.assign(new Error(result.error?.message || `Skill ${skillId} execution failed`), {
          code: result.error?.code,
          details: result.error?.details,
        });
      }

      await recordSkillStats(skillId, true, durationMs);
      void recordSkillSpan(
        executionLogId,
        skillId,
        executionContext,
        parentContext.skillId,
        input,
        result.output,
        durationMs,
        true,
        undefined,
        undefined
      );

      logger.info('[skill-executor] 执行完成', {
        skillId,
        durationMs,
        outputSummary: summarizeSkillLogPayload(skillId, result.output, 'output'),
      });

      return result;
    } catch (error: any) {      const durationMs = Date.now() - startedAt;
      if (error && typeof error === 'object') {
        error.skillDurationMs = durationMs;
      }
      await recordSkillStats(skillId, false, durationMs);
      void recordSkillSpan(
        executionLogId,
        skillId,
        executionContext,
        parentContext.skillId,
        input,
        null,
        durationMs,
        false,
        skillId === 'mcp-tool'
          ? error?.code || 'MCP_TOOL_EXECUTION_FAILED'
          : error?.message || String(error),
        error?.code
      );
      logger.error('[skill-executor] 执行失败', {
        skillId,
        durationMs,
        error: skillId === 'mcp-tool'
          ? error?.code || 'MCP_TOOL_EXECUTION_FAILED'
          : error?.message || String(error),
      });
      throw error;
    }
  });
}

async function recordSkillStats(skillId: string, success: boolean, durationMs: number): Promise<void> {
  try {
    const current = await systemPrisma.skill_registrations.findUnique({
      where: { name: skillId },
      select: { callCount: true, successRate: true }
    });

    if (!current) return;

    const nextCallCount = current.callCount + 1;
    const previousSuccesses = current.successRate * current.callCount;
    const nextSuccessRate = (previousSuccesses + (success ? 1 : 0)) / nextCallCount;

    await systemPrisma.skill_registrations.update({
      where: { name: skillId },
      data: {
        callCount: nextCallCount,
        successRate: nextSuccessRate,
        updatedAt: new Date()
      }
    });
  } catch (error: any) {
    logger.warn('[skill-executor] 更新 Skill 统计失败', {
      skillId,
      success,
      durationMs,
      error: error?.message || String(error)
    });
  }
}

async function recordSkillSpan(
  executionLogId: string,
  skillId: string,
  ctx: ReturnType<typeof getRequestContext>,
  parentSkillId: string | undefined,
  input: any,
  output: any,
  durationMs: number,
  success: boolean,
  errorMessage?: string,
  errorCode?: string
): Promise<void> {
  try {
    const inputStr = JSON.stringify(summarizeSkillLogPayload(skillId, input, 'input')).slice(0, 1000);
    const outputStr = output === undefined || output === null
      ? null
      : JSON.stringify(summarizeSkillLogPayload(skillId, output, 'output')).slice(0, 1000);
    await telemetryWriter.createAgentCall({
      id: executionLogId,
      agentId: `skill:${skillId}`,
      userId: ctx.userId || 'system',
      sourceEntry: ctx.sourceEntry || 'platform',
      traceId: ctx.traceId || null,
      callerAgent: ctx.callerAgent || null,
      userRole: ctx.userRole || 'user',
      input: inputStr,
      output: outputStr,
      success,
      durationMs,
      error: success ? null : (errorMessage || 'SKILL_EXECUTION_FAILED'),
      errorCode: success ? null : (errorCode || 'SKILL_EXECUTION_FAILED'),
      executionLayer: 'skill',
      actorType: 'skill',
      actorId: skillId,
      parentExecutionId: ctx.parentExecutionId || null,
      rootExecutionId: ctx.rootExecutionId || executionLogId,
      metadata: JSON.stringify({
        layer: 'skill-executor',
        skillId,
        parentSkillId: parentSkillId || null,
        actorType: 'skill',
        actorId: skillId,
        contextEnvelopeVersion: ctx.contextEnvelope?.schemaVersion || null,
        sessionId: ctx.sessionId || ctx.contextEnvelope?.session?.sessionId || null,
        conversationId: ctx.conversationId || ctx.contextEnvelope?.session?.conversationId || null,
        pathId: ctx.pathId || ctx.contextEnvelope?.session?.pathId || null,
        taskId: ctx.taskId || ctx.contextEnvelope?.session?.taskId || null,
        language: ctx.contextEnvelope?.locale?.language || null,
        timeZone: ctx.contextEnvelope?.locale?.timeZone || null,
        experimentId: ctx.experimentId || null,
        runId: ctx.runId || null,
      }),
    });
  } catch {
    // 调试日志失败不影响主流程。
  }
}
