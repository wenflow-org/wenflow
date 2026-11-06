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
import { isUpstreamFailureCategory } from '../gateway/api-gateway/upstream-failure';
import {
  ToolApprovalRequiredError,
  isToolApprovalRequired,
  runAfterToolHooks,
  runBeforeToolHooks,
  runErrorToolHooks,
  type ToolExecutionInfo,
} from './tool-execution-hooks';

export type SkillHandler = (input: any) => Promise<any>;

function normalizeSkillId(definition: SkillDefinition | { id?: string; name?: string }): string {
  const rawId = definition.id || definition.name;
  if (!rawId) throw new Error('Skill definition is missing id or name');
  return rawId.replace(/^skill:/, '');
}

/**
 * 是否为「调用方主动取消」（HTTP 断开 / 前端切页 / withTimeoutSignal 超时取消）。
 * 这类错误不代表 Skill 逻辑失败，不应计入技能成功率，也不应触发重试。
 */
function isCallerAbort(error: any): boolean {
  if (!error || typeof error !== 'object') return false;
  if (String(error.code || '') === 'CALLER_ABORTED') return true;
  if (String(error.name || '') === 'AbortError') return true;
  return /aborted by caller/i.test(String(error.message || ''));
}

/**
 * 是否为**上游/基础设施类**失败（限流、上游 HTTP、网络、上游超时）。
 * 与 {@link isCallerAbort} 同口径：这类错误不代表 Skill 逻辑失败，不应计入技能成功率——
 * 否则一次上游故障（含 #177 的「目录外模型无可用渠道」）会把整列 skill 打成 0 失败，
 * 污染健康度面板。类别集合复用网关既有的「上游不稳定」判定（upstream-failure），
 * 不再维护第二份清单；网关终止错误 `RETRY_BUDGET_EXHAUSTED` 会继承最后一次真实失败的
 * category，故本判定同样覆盖它。认证/配额/协议/配置类失败仍照常计入。
 */
function isUpstreamFailure(error: any): boolean {
  if (!error || typeof error !== 'object') return false;
  return isUpstreamFailureCategory(error.category);
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
  // 调用方已取消：立即短路，不进入 handler / 重试 / 统计。
  // 否则「取消 → 外层重试 → 每次立即失败」会产生 CALLER_ABORTED 风暴并污染技能成功率（QA skill 调查 P3）。
  const entryAbortSignal = options.abortSignal || parentContext.abortSignal;
  if (entryAbortSignal?.aborted) {
    throw Object.assign(new Error('Skill execution aborted by caller'), {
      code: 'CALLER_ABORTED',
    });
  }
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
  // #185：skill span 的 callerAgent 只认「本 skill 所属 agent」这一个真实边界，不再继承上层的
  // callerAgent。上层写入的 callerAgent（autopilot / blackbox 的 'simulation-agent'、
  // batch-experiment 的任务名、acp-context 中间件的 X-Caller-Agent 客户端身份）是「本次运行从哪来」，
  // 不是编排交接的调用方；一旦继承，simulation-agent 会盖住整条真实教学链的 span——实测
  // skill:session-wrapup 被记成 simulation-agent -> session-wrapup（同一 skill 的 LLM 行早已
  // 按自身声明的 caller.agentId 记为 teaching-agent）；无归属的 handler-only/aux skill
  // （getAgentOfSkill 为空）则借用该标记，把 learner-state-review 这类教学链内诊断调用
  // 记成仿真调用。运行来源本就由 sourceEntry / experimentId / runId 承载，无需 callerAgent 兜底。
  // 无归属 skill 记为「调用方未知」（null），与真实用户/管理端窗口下的既有记录口径一致。
  const callerAgent = parentAgent;
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

      // 工具执行闸门（2026-10-21）：审批命中而未带 approved 时拒绝执行。
      // 默认审批名单为空 → 与改造前完全一致。
      if (isToolApprovalRequired(skillId) && options.approved !== true) {
        throw new ToolApprovalRequiredError(skillId);
      }

      const hookInfo: ToolExecutionInfo = {
        skillId,
        userId,
        executionLogId,
        sessionId: executionContext.sessionId,
        input,
        inputSummary: summarizeSkillLogPayload(skillId, input, 'input'),
      };
      const veto = await runBeforeToolHooks(hookInfo);
      if (veto) {
        throw Object.assign(new Error(veto.message), {
          code: veto.code,
          status: veto.status,
          details: veto.details,
        });
      }

      const rawResult = options.timeout && options.timeout > 0
        ? await withSkillTimeout(handler(input), options.timeout, skillId)
        : await handler(input);
      const durationMs = Date.now() - startedAt;
      const result = normalizeHandlerResult(rawResult, durationMs);

      if (!result.success) {
        // 结构化失败：调用方可按业务语义降级（如把错误回灌给模型/换备用工具）。
        if (options.allowStructuredFailure === true) {
          await recordSkillStats(skillId, false, durationMs);
          await runAfterToolHooks(hookInfo, result);
          return result;
        }
        throw Object.assign(new Error(result.error?.message || `Skill ${skillId} execution failed`), {
          code: result.error?.code,
          details: result.error?.details,
        });
      }

      await runAfterToolHooks(hookInfo, result);

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
    } catch (error: any) {
      const durationMs = Date.now() - startedAt;
      if (error && typeof error === 'object') {
        error.skillDurationMs = durationMs;
      }
      // 调用方取消 / 上游基础设施故障不算技能失败：仍记 span 供观测，但不计入 successRate，
      // 否则客户端超时/切页、单次上游 5xx（含无可用渠道的目录外模型）会把技能成功率拉低
      // （QA skill 调查 P3 / #177 健康度面板污染）。
      if (!isCallerAbort(error) && !isUpstreamFailure(error)) {
        await recordSkillStats(skillId, false, durationMs);
      }
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
        error?.code,
        typeof error?.category === 'string' ? error.category : undefined
      );
      logger.error('[skill-executor] 执行失败', {
        skillId,
        durationMs,
        error: skillId === 'mcp-tool'
          ? error?.code || 'MCP_TOOL_EXECUTION_FAILED'
          : error?.message || String(error),
      });
      await runErrorToolHooks({
        skillId,
        userId,
        executionLogId,
        sessionId: executionContext.sessionId,
        input,
      }, error);
      throw error;
    }
  });
}

/**
 * 工具执行硬超时（2026-10-21）：`SkillExecutionOptions.timeout` 此前从未被读取。
 * 超时抛 `SKILL_TIMEOUT`，与调用方取消（CALLER_ABORTED）区分开：前者计入失败率，
 * 后者不计。
 */
function withSkillTimeout<T>(promise: Promise<T>, timeoutMs: number, skillId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`Skill ${skillId} exceeded ${timeoutMs}ms timeout`), {
        code: 'SKILL_TIMEOUT',
        status: 504,
      }));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
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
  errorCode?: string,
  errorCategory?: string
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
      // #177：skill 层行也带上真实失败类别（网关错误对象自带 category）——成功率口径据此判上游失败，
      // 不再靠 errorCode 猜；旧行无 category 时口径按 code 回退（见 skill-runtime-contract.service）。
      errorCategory: success ? null : (errorCategory || null),
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
