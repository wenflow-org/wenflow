import { createHash, randomUUID } from 'crypto';
import { getAPIGateway } from '../gateway/api-gateway';
import { getRequestContext } from '../gateway/api-gateway/context';
import { agentConfigService } from '../services/agentConfig.service';
import { telemetryWriter } from '../services/telemetry-writer.service';
import { logger } from '../utils/logger';
import { consumeLogicalRetry } from '../gateway/api-gateway/retry-budget';
import {
  createRuntimeRetryBudget,
  getEffectiveLogicalRetryLimit
} from '../services/reliability-settings.service';
import { detectPromptDrift } from './drift-detector';
import { extractJsonObject } from './json-extractor';
import {
  PromptCallContext,
  PromptCallResult,
  PromptCallSpec,
  PromptAttemptTrace,
  PromptRawParseResult,
  PromptRuntimeEnvelope,
} from './types';
import { resolveEffectiveRuntimeContract } from '../services/prompt-lab/resolve-runtime-contract';
import { resolveEffectivePromptContract } from '../services/prompt-lab/resolve-prompt-contract';
import { adaptToRuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';
import { validateSkillOutputFields } from '../services/skill-output-validator';
import type { RuntimeContract } from '../services/prompt-lab/runtime-contract';
import { resolveLlmCallParams } from '../services/resolve-llm-call-params';
import { getRoutingSnapshotHash } from '../services/prompt-composer';
import type { SkillPromptOutputMedia } from '../services/skill-prompt-contract';
import {
  mergeContextEnvelopes,
  normalizeContextEnvelope,
  withContextMode,
} from '../skills/context-envelope';

/**
 * 默认原始输出解析。JSON media 走 extractJsonObject；
 * markdown/text media 按契约直接透传原始文本（extractedJson 字段复用为提取负载）。
 */
function defaultParseRawOutput(rawOutput: string, media: SkillPromptOutputMedia): PromptRawParseResult {
  if (media === 'markdown' || media === 'text') {
    const cleaned = rawOutput.trim();
    if (!cleaned) {
      return { parsed: null, extractedJson: null, failureReason: 'response is empty' };
    }
    return { parsed: cleaned, extractedJson: cleaned };
  }
  const basic = extractJsonObject(rawOutput);
  return {
    parsed: basic.parsed,
    extractedJson: basic.extractedJson,
    failureReason: basic.parsed == null
      ? 'response does not contain valid JSON object'
      : undefined,
  };
}

function stringifyPayload(payload: string | object): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function normalizeTokenUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    prompt: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : undefined,
    completion: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : undefined,
    total: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : undefined,
  };
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt || '').digest('hex');
}

function compactAttemptTrace(attempts: PromptAttemptTrace[]): string {
  return JSON.stringify(attempts.map(item => ({
    attempt: item.attempt,
    status: item.status,
    durationMs: item.durationMs,
    llmRequestId: item.llmRequestId,
    transportAttemptCount: item.transportAttemptCount,
    failureReason: item.failureReason,
    violations: item.violations
  })));
}

async function buildDefaultEnvelope<TInput, TOutput>(
  spec: PromptCallSpec<TInput, TOutput>,
  output: TOutput,
  input: TInput,
  contract: RuntimeContract
): Promise<PromptRuntimeEnvelope> {
  if (spec.mapEnvelope) {
    return spec.mapEnvelope(output, input, contract);
  }
  return adaptToRuntimeEnvelope({
    contract,
    artifact: output,
    phase: contract.businessState.defaultPhase,
    status: 'succeeded',
    isTerminal: contract.businessState.terminalPhases.includes(
      contract.businessState.defaultPhase
    ),
    nextState: contract.contextUpdate.mode === 'none' ? null : null,
  });
}

export async function callPrompt<TInput, TOutput>(
  spec: PromptCallSpec<TInput, TOutput>,
  input: TInput,
  context: PromptCallContext = {}
): Promise<PromptCallResult<TOutput>> {
  const requestContext = getRequestContext();
  const promptCallId = `pcl_${randomUUID()}`;
  const requestRuntimeOverride = requestContext.promptRuntimeOverride || {};
  const callOverride = context.generationOverride || {};
  // 调用点级显式参数（generationOverride）与请求级调试覆盖合并，调用点更具体优先；
  // 统一归一为 promptRuntimeOverride 的字段命名（modelOverride/temperatureOverride/maxTokensOverride）
  const runtimeOverride = {
    ...requestRuntimeOverride,
    ...(callOverride.model !== undefined ? { modelOverride: callOverride.model } : {}),
    ...(callOverride.temperature !== undefined ? { temperatureOverride: callOverride.temperature } : {}),
    ...(callOverride.maxTokens !== undefined ? { maxTokensOverride: callOverride.maxTokens } : {}),
  };
  const systemPromptOverride = runtimeOverride.systemPromptOverride || context.systemPromptOverride;
  const promptConfig = await agentConfigService.getActivePrompt(spec.agentId);
  const { contract: runtimeContract } = await resolveEffectiveRuntimeContract(spec.agentId, promptConfig);
  const { contract: promptContract } = await resolveEffectivePromptContract(
    spec.agentId,
    promptConfig,
    { runtimeContract }
  );

  // code-only skill 不允许进入 LLM 调用链；lint/seed 已拦截，此处为运行时防线
  if (promptContract.executionMode === 'code-only') {
    const errorCode = `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_CODE_ONLY_SKILL`;
    const message = `Skill ${spec.agentId} declares executionMode=code-only and must not enter the LLM prompt chain`;
    await telemetryWriter.createPromptCall({
      id: promptCallId,
      agentId: spec.agentId,
      systemPromptVersion: null,
      systemPromptHash: hashPrompt(''),
      userPayload: '',
      rawModelOutput: null,
      extractedJson: null,
      normalizedOutput: null,
      success: false,
      errorCode,
      errorMessage: message,
      promptDrift: false,
      durationMs: 0,
      pathId: context.pathId || requestContext.pathId || null,
      userId: context.userId || requestContext.userId || null,
      conversationId: context.conversationId || requestContext.conversationId || null,
      pipelineRunId: context.pipelineRunId || null,
      pipelineStepIndex: context.pipelineStepIndex ?? null,
      traceId: context.traceId || requestContext.traceId || null,
      parentExecutionId: context.parentExecutionId || requestContext.executionLogId || null,
      promptAttemptCount: 0,
      llmRequestCount: 0,
      failureStage: 'prompt_resolution',
      attemptTrace: '[]'
    });
    return {
      success: false,
      error: { code: errorCode, message },
      debug: {
        promptCallId, agentId: spec.agentId, systemPrompt: '', systemPromptVersion: null, userPayload: '',
        rawModelOutput: '', extractedJson: null, normalizedOutput: null,
        promptDrift: null, attempts: [], durationMs: 0, tokenUsage: null,
        finalLlmRequestId: null, providerId: null, model: null,
      },
    };
  }

  // envelope 不一致时以 runtimeContract 为权威映射基准；lint/seed 已硬失败，运行时降级为告警
  if (promptContract.output.envelope !== runtimeContract.outputEnvelope) {
    logger.warn(
      `[callPrompt] ${spec.agentId} promptContract.output.envelope=${promptContract.output.envelope} 与 runtimeContract.outputEnvelope=${runtimeContract.outputEnvelope} 不一致，以 runtimeContract 为准`
    );
  }

  const contextEnvelope = withContextMode(
    mergeContextEnvelopes(
      requestContext.contextEnvelope,
      context.contextEnvelope,
      normalizeContextEnvelope({
        principal: { userId: context.userId || requestContext.userId },
        session: {
          sessionId: context.sessionId || requestContext.sessionId,
          conversationId: context.conversationId || requestContext.conversationId,
          pathId: context.pathId || requestContext.pathId,
          taskId: context.taskId || requestContext.taskId,
        },
        locale: context.locale || requestContext.locale,
      })
    ),
    runtimeContract.contextMode
  );
  const userPayload = stringifyPayload(spec.buildUserPayload(input, {
    contextEnvelope,
    runtimeContract,
    promptContract,
  }));
  const sessionId = context.sessionId || contextEnvelope.session?.sessionId || requestContext.sessionId || null;
  const pathId = context.pathId || contextEnvelope.session?.pathId || requestContext.pathId || null;
  const conversationId = context.conversationId
    || contextEnvelope.session?.conversationId
    || requestContext.conversationId
    || null;
  const taskId = context.taskId || contextEnvelope.session?.taskId || requestContext.taskId || null;
  const traceId = context.traceId || requestContext.traceId || null;
  const parentExecutionId = context.parentExecutionId || requestContext.executionLogId || null;
  const retryBudget = context.retryBudget
    || requestContext.retryBudget
    || await createRuntimeRetryBudget();
  const currentSkillLogicalRetryLimit = requestContext.logicalRetryLimit
    ?? await getEffectiveLogicalRetryLimit(
      requestContext.skillId,
      retryBudget.limits.maxLogicalRetries
    );
  const logicalRetryLimit = Math.min(
    retryBudget.limits.maxLogicalRetries,
    currentSkillLogicalRetryLimit
  );
  let localLogicalRetries = 0;

  if (spec.requireActivePrompt && !systemPromptOverride?.trim() && !promptConfig?.systemPrompt?.trim()) {
    const errorCode = `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PROMPT_MISSING`;
    await telemetryWriter.createPromptCall({
      id: promptCallId,
      agentId: spec.agentId,
      systemPromptVersion: null,
      systemPromptHash: hashPrompt(''),
      userPayload,
      rawModelOutput: null,
      extractedJson: null,
      normalizedOutput: null,
      success: false,
      errorCode,
      errorMessage: `Missing active prompt for ${spec.agentId}`,
      promptDrift: false,
      durationMs: 0,
       pathId,
      userId: context.userId || requestContext.userId || null,
       conversationId,
      pipelineRunId: context.pipelineRunId || null,
      pipelineStepIndex: context.pipelineStepIndex ?? null,
      traceId,
      parentExecutionId,
      promptAttemptCount: 0,
      llmRequestCount: 0,
      failureStage: 'prompt_resolution',
      attemptTrace: '[]'
    });
    return {
      success: false,
      error: { code: errorCode, message: `Missing active prompt for ${spec.agentId}` },
      debug: {
        promptCallId, agentId: spec.agentId, systemPrompt: '', systemPromptVersion: null, userPayload,
        rawModelOutput: '', extractedJson: null, normalizedOutput: null,
        promptDrift: null, attempts: [], durationMs: 0, tokenUsage: null,
        finalLlmRequestId: null, providerId: null, model: null,
      },
    };
  }

  let systemPrompt = systemPromptOverride || promptConfig?.systemPrompt || spec.defaultSystemPrompt;
  if (spec.prepareSystemPrompt) {
    systemPrompt = await spec.prepareSystemPrompt(systemPrompt, input, context);
  }
  const promptDrift = detectPromptDrift(spec.defaultSystemPrompt, promptConfig?.systemPrompt || null);
  const systemPromptHash = hashPrompt(systemPrompt);
  // 路由表快照指纹：admin 改 routings 后 hash 变化（≤30s），让按 version/coreHash 归因的分析
  // 能识别"prompt 变了但版本没变"的场景（版本追踪盲区补强）
  let routingContextHash: string | null = null;
  if (spec.caller?.skillId && typeof getRoutingSnapshotHash === 'function') {
    routingContextHash = await getRoutingSnapshotHash(spec.caller.skillId).catch(() => null);
  }
  const attempts: PromptAttemptTrace[] = [];
  const gateway = getAPIGateway();
  // 请求形态层（默认全流）：所有 LLM 调用一律以流式请求发出（上游 SSE，更早收到首字节），
  // 网关在流结束时合成完整 ChatResponse，JSON 整体校验、逻辑重试与遥测语义不变。
  // 可通过 context.stream === false 显式禁用（如连通性探测等不需要的场景）。
  // delta 逐字透传层：仅当调用方注入流式意向（context.stream=true 或请求级 streamRequest.enabled）
  // 且输出 media 为 markdown/text 时，才挂 onStreamChunk 把增量转发给客户端；
  // 同请求内首个 delta 调用消费 streamRequest.consumed，后续调用自动降级为整包。
  const streamRequest = requestContext.streamRequest;
  const streamOnStream = context.onStream ?? streamRequest?.onStream;
  const streamRequested = context.stream !== false;
  const streamDeltaEligible = streamRequested
    && typeof streamOnStream === 'function'
    && (context.stream === true || streamRequest?.enabled === true)
    && streamRequest?.consumed !== true
    && (promptContract.output.media === 'markdown' || promptContract.output.media === 'text');
  if (streamDeltaEligible && streamRequest) {
    // 本请求内首个 markdown/text 调用消费 delta 通道；同请求的后续调用自动降级整包
    streamRequest.consumed = true;
  }
  const maxAttempts = Math.max(1, spec.retryStrategy?.maxAttempts || 1);
  const startTime = Date.now();
  let lastRaw = '';
  let lastExtractedJson: string | null = null;
  let lastFailureReason = 'Unknown failure';
  let lastViolations: string[] | undefined;
  let lastLlmRequestId: string | null = null;
  let lastProviderId: string | null = null;
  let lastModel: string | null = null;
  let llmRequestCount = 0;
  // 生成参数单一解析：generationOverride → ACTIVE prompt（core params）→ route（model config）
  const generationResolution = await resolveLlmCallParams({
    skillId: spec.caller?.skillId,
    agentId: spec.caller?.agentId,
    promptConfig,
    runtimeOverride: {
      model: runtimeOverride.modelOverride,
      temperature: runtimeOverride.temperatureOverride,
      maxTokens: runtimeOverride.maxTokensOverride,
    },
  });
  let currentMaxTokens = generationResolution.maxTokens;
  const tokenCeiling = Math.max(currentMaxTokens || 8000, 16000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      if (localLogicalRetries >= logicalRetryLimit) {
        retryBudget.exhaustedBy = 'logical-retries';
        lastFailureReason = 'Prompt logical retry budget exhausted';
        break;
      }
      if (!consumeLogicalRetry(retryBudget)) {
        lastFailureReason = 'Prompt logical retry budget exhausted';
        break;
      }
      localLogicalRetries += 1;
    }
    const attemptStartedAt = Date.now();
    // 逻辑重试重新生成：仅在已向客户端透传 delta 时发 restart，清空已显示内容避免新旧拼接
    if (attempt > 1 && streamDeltaEligible) {
      streamOnStream?.({ type: 'restart', attempt });
    }
    const retryNotice = attempt > 1 && spec.retryStrategy?.onValidationFail
      ? spec.retryStrategy.onValidationFail({
          input,
          attempt,
          rawOutput: lastRaw,
          extractedJson: lastExtractedJson,
          failureReason: lastFailureReason,
          violations: lastViolations,
        })
      : null;
    const retryMessage = retryNotice && lastViolations?.length
      ? `${retryNotice}\n\n校验问题：\n${lastViolations.map(violation => `- ${violation}`).join('\n')}`
      : retryNotice;
    const messages = spec.buildMessages
      ? spec.buildMessages({
          input,
          systemPrompt,
          userPayload,
          retryMessage,
          runtime: { contextEnvelope, runtimeContract, promptContract },
        })
      : [
          { role: 'system' as const, content: systemPrompt },
          ...(Array.isArray(context.assistantMessages)
            ? context.assistantMessages.map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
            : []),
          { role: 'user' as const, content: retryMessage ? `${userPayload}\n\n${retryMessage}` : userPayload },
        ];

    let response: any;
    try {
      llmRequestCount += 1;
      // 单一读路径：override → ACTIVE prompt → route（executor 仅在 route 缺失时兜底）
      const llmParams = {
        request: {
          model: generationResolution.model,
          temperature: generationResolution.temperature,
          max_tokens: currentMaxTokens ?? generationResolution.maxTokens,
        },
      };
      response = await gateway.execute({
        messages,
        ...llmParams.request,
        stream: streamRequested,
      }, spec.caller, {
        userId: runtimeOverride.routingUserIdOverride || context.userId,
        traceId: traceId || undefined,
        parentExecutionId: parentExecutionId || undefined,
         rootExecutionId: requestContext.rootExecutionId,
         sessionId: sessionId || undefined,
         conversationId: conversationId || undefined,
         pathId: pathId || undefined,
         taskId: taskId || undefined,
          locale: contextEnvelope.locale,
          requestPath: context.requestPath,
         promptCallId,
        promptAttemptNo: attempt,
        retryBudget,
        ...(streamDeltaEligible
          ? { onStreamChunk: (delta: string) => streamOnStream?.({ type: 'delta', text: delta }) }
          : {}),
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      const errorCode = typeof (error as any)?.code === 'string' ? (error as any).code : `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TRANSPORT_FAILED`;
      lastLlmRequestId = typeof (error as any)?.llmRequestId === 'string' ? (error as any).llmRequestId : lastLlmRequestId;
      lastProviderId = typeof (error as any)?.providerId === 'string' ? (error as any).providerId : lastProviderId;
      lastModel = typeof (error as any)?.model === 'string' ? (error as any).model : lastModel;
      attempts.push({
        attempt,
        rawOutput: '',
        failureReason,
        status: 'transport_failed',
        durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: Number.isFinite(Number((error as any)?.attemptCount))
          ? Number((error as any).attemptCount)
          : undefined
      });
      await telemetryWriter.createPromptCall({
        id: promptCallId,
        agentId: spec.agentId,
        systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
        systemPromptHash,
        userPayload,
        rawModelOutput: lastRaw || null,
        extractedJson: lastExtractedJson,
        normalizedOutput: null,
        success: false,
        errorCode,
        errorMessage: failureReason,
        promptDrift: !!promptDrift?.driftDetected,
        durationMs: Date.now() - startTime,
         pathId,
        userId: context.userId || requestContext.userId || null,
         conversationId,
        pipelineRunId: context.pipelineRunId || null,
        pipelineStepIndex: context.pipelineStepIndex ?? null,
        traceId,
        parentExecutionId,
        promptAttemptCount: attempt,
        llmRequestCount,
        finalLlmRequestId: lastLlmRequestId,
        failureStage: 'transport',
        attemptTrace: compactAttemptTrace(attempts),
        providerId: lastProviderId,
        model: lastModel
      });
      throw error;
    }

    const gatewayMetadata = response._gatewayMetadata;
    lastLlmRequestId = gatewayMetadata?.llmRequestId || null;
    lastProviderId = gatewayMetadata?.providerId || null;
    lastModel = gatewayMetadata?.resolvedModel || response.model || null;
    const rawModelOutput = response.choices?.[0]?.message?.content || '';
    const extracted: PromptRawParseResult = spec.parseRawOutput
      ? spec.parseRawOutput(rawModelOutput, input)
      : defaultParseRawOutput(rawModelOutput, promptContract.output.media);
    lastRaw = rawModelOutput;
    lastExtractedJson = extracted.extractedJson;

    if (!extracted.extractedJson || extracted.parsed === null) {
      lastFailureReason = extracted.failureReason || 'response does not contain valid JSON object';
      lastViolations = Array.isArray(extracted.violations) && extracted.violations.length
        ? [...extracted.violations]
        : [lastFailureReason];
      attempts.push({
        attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason,
        violations: lastViolations,
        status: 'validation_failed', durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: gatewayMetadata?.attemptCount
      });
      // 长度截断时抬高后续 attempt 的 maxTokens（goal 原行为）
      const finishReason = response.choices?.[0]?.finish_reason || response.finishReason;
      const wasTruncated = finishReason === 'length'
        || /[",:][^"]*$/.test(rawModelOutput.trim().slice(-50));
      if (wasTruncated && typeof currentMaxTokens === 'number') {
        currentMaxTokens = Math.min(tokenCeiling, currentMaxTokens * 2);
      }
      continue;
    }

    const validation = spec.validateParsedOutput
      ? spec.validateParsedOutput(extracted.parsed, input)
      : { valid: true as const };
    if (!validation.valid) {
      lastFailureReason = validation.failureReason || 'parsed output validation failed';
      lastViolations = Array.isArray(validation.violations)
        ? [...validation.violations]
        : [lastFailureReason];
      attempts.push({
        attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason,
        violations: lastViolations,
        status: 'validation_failed', durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: gatewayMetadata?.attemptCount
      });
      continue;
    }

    // P3 试点：core fields 声明契约校验（skill 领域校验通过后追加；
    // delta 语义按 core 文件 deltaOutput 判定，File-as-Truth，不受 ACTIVE metadata 影响）
    const fieldsValidation = await validateSkillOutputFields(
      spec.agentId,
      extracted.parsed
    );
    if (fieldsValidation && !fieldsValidation.valid) {
      lastFailureReason = `fields contract violation: ${fieldsValidation.issues
        .map((issue) => `${issue.field}(${issue.code}:${issue.expected})`)
        .join('; ')}`;
      lastViolations = [lastFailureReason];
      attempts.push({
        attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason,
        violations: lastViolations,
        status: 'validation_failed', durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: gatewayMetadata?.attemptCount
      });
      continue;
    }

    const normalizedOutput = spec.normalizeOutput(extracted.parsed, input);
    const runtimeEnvelope = await buildDefaultEnvelope(spec, normalizedOutput, input, runtimeContract);
    const durationMs = Date.now() - startTime;
    const tokenUsage = normalizeTokenUsage(response.usage);
    attempts.push({
      attempt, rawOutput: rawModelOutput, status: 'success',
      durationMs: Date.now() - attemptStartedAt,
      llmRequestId: lastLlmRequestId || undefined,
      transportAttemptCount: gatewayMetadata?.attemptCount
    });
    await telemetryWriter.createPromptCall({
      id: promptCallId,
      agentId: spec.agentId,
      systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
      systemPromptHash,
      userPayload,
      rawModelOutput,
      extractedJson: extracted.extractedJson,
      normalizedOutput: JSON.stringify(normalizedOutput),
      success: true,
      promptDrift: !!promptDrift?.driftDetected,
      routingContextHash,
      durationMs,
      tokenUsage: JSON.stringify(tokenUsage),
       pathId,
      userId: context.userId || requestContext.userId || null,
       conversationId,
      pipelineRunId: context.pipelineRunId || null,
      pipelineStepIndex: context.pipelineStepIndex ?? null,
      traceId,
      parentExecutionId,
      promptAttemptCount: attempt,
      llmRequestCount,
      finalLlmRequestId: lastLlmRequestId,
      failureStage: null,
      attemptTrace: compactAttemptTrace(attempts),
      providerId: lastProviderId,
      model: lastModel
    });

    return {
      success: true,
      output: normalizedOutput,
      runtimeEnvelope,
      debug: {
        promptCallId, agentId: spec.agentId, systemPrompt,
        systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
        userPayload, rawModelOutput, extractedJson: extracted.extractedJson,
        normalizedOutput, promptDrift, attempts, durationMs, tokenUsage,
        finalLlmRequestId: lastLlmRequestId, providerId: lastProviderId, model: lastModel,
      },
    };
  }

  const durationMs = Date.now() - startTime;
  const errorCode = `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_FAILED`;
  await telemetryWriter.createPromptCall({
    id: promptCallId,
    agentId: spec.agentId,
    systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
    systemPromptHash,
    userPayload,
    rawModelOutput: lastRaw || null,
    extractedJson: lastExtractedJson,
    normalizedOutput: null,
    success: false,
    errorCode,
    errorMessage: lastFailureReason,
    promptDrift: !!promptDrift?.driftDetected,
    routingContextHash,
    durationMs,
     pathId,
    userId: context.userId || requestContext.userId || null,
     conversationId,
    pipelineRunId: context.pipelineRunId || null,
    pipelineStepIndex: context.pipelineStepIndex ?? null,
    traceId,
    parentExecutionId,
    promptAttemptCount: attempts.length,
    llmRequestCount,
    finalLlmRequestId: lastLlmRequestId,
    failureStage: 'validation',
    attemptTrace: compactAttemptTrace(attempts),
    providerId: lastProviderId,
    model: lastModel
  });

  return {
    success: false,
    error: { code: errorCode, message: lastFailureReason },
      debug: {
        promptCallId, agentId: spec.agentId, systemPrompt,
      systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
      userPayload, rawModelOutput: lastRaw, extractedJson: lastExtractedJson,
        normalizedOutput: null, promptDrift, attempts, durationMs, tokenUsage: null,
        finalLlmRequestId: lastLlmRequestId, providerId: lastProviderId, model: lastModel,
    },
  };
}
