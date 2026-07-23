import { createHash, randomUUID } from 'crypto';
import { getAPIGateway } from '../gateway/api-gateway';
import { getRequestContext } from '../gateway/api-gateway/context';
import { agentConfigService } from '../services/agentConfig.service';
import { telemetryWriter } from '../services/telemetry-writer.service';
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
} from './types';

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

function resolveMaxTokens(promptMaxTokens?: number | null, defaultMaxTokens?: number, minMaxTokens?: number): number | undefined {
  const configured = Number(promptMaxTokens || defaultMaxTokens || 0);
  const minimum = Number(minMaxTokens || 0);
  const resolved = Math.max(configured, minimum);
  return resolved > 0 ? resolved : undefined;
}

function compactAttemptTrace(attempts: PromptAttemptTrace[]): string {
  return JSON.stringify(attempts.map(item => ({
    attempt: item.attempt,
    status: item.status,
    durationMs: item.durationMs,
    llmRequestId: item.llmRequestId,
    transportAttemptCount: item.transportAttemptCount,
    failureReason: item.failureReason
  })));
}

export async function callPrompt<TInput, TOutput>(
  spec: PromptCallSpec<TInput, TOutput>,
  input: TInput,
  context: PromptCallContext = {}
): Promise<PromptCallResult<TOutput>> {
  const requestContext = getRequestContext();
  const promptCallId = `pcl_${randomUUID()}`;
  const runtimeOverride = requestContext.promptRuntimeOverride || {};
  const systemPromptOverride = runtimeOverride.systemPromptOverride || context.systemPromptOverride;
  const promptConfig = await agentConfigService.getActivePrompt(spec.agentId);
  const userPayload = stringifyPayload(spec.buildUserPayload(input));
  const traceId = context.traceId || requestContext.traceId || null;
  const parentExecutionId = context.parentExecutionId || requestContext.executionLogId || null;
  const retryBudget = requestContext.retryBudget
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
      pathId: context.pathId || null,
      userId: context.userId || requestContext.userId || null,
      conversationId: context.conversationId || null,
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
        agentId: spec.agentId, systemPrompt: '', systemPromptVersion: null, userPayload,
        rawModelOutput: '', extractedJson: null, normalizedOutput: null,
        promptDrift: null, attempts: [], durationMs: 0, tokenUsage: null,
      },
    };
  }

  const systemPrompt = systemPromptOverride || promptConfig?.systemPrompt || spec.defaultSystemPrompt;
  const promptDrift = detectPromptDrift(spec.defaultSystemPrompt, promptConfig?.systemPrompt || null);
  const systemPromptHash = hashPrompt(systemPrompt);
  const attempts: PromptAttemptTrace[] = [];
  const gateway = getAPIGateway();
  const maxAttempts = Math.max(1, spec.retryStrategy?.maxAttempts || 1);
  const startTime = Date.now();
  let lastRaw = '';
  let lastExtractedJson: string | null = null;
  let lastFailureReason = 'Unknown failure';
  let lastLlmRequestId: string | null = null;
  let lastProviderId: string | null = null;
  let lastModel: string | null = null;
  let llmRequestCount = 0;

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
    const retryNotice = attempt > 1 && spec.retryStrategy?.onValidationFail
      ? spec.retryStrategy.onValidationFail({
          input, attempt, rawOutput: lastRaw, extractedJson: lastExtractedJson, failureReason: lastFailureReason,
        })
      : null;
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: retryNotice ? `${userPayload}\n\n${retryNotice}` : userPayload },
    ];

    let response: any;
    try {
      llmRequestCount += 1;
      response = await gateway.execute({
        messages,
        model: runtimeOverride.modelOverride,
        max_tokens: runtimeOverride.maxTokensOverride
          ?? resolveMaxTokens(promptConfig?.maxTokens, spec.modelDefaults?.maxTokens, spec.modelDefaults?.minMaxTokens),
        temperature: runtimeOverride.temperatureOverride
          ?? promptConfig?.temperature
          ?? spec.modelDefaults?.temperature,
      }, spec.caller, {
        userId: runtimeOverride.routingUserIdOverride || context.userId,
        traceId: traceId || undefined,
        parentExecutionId: parentExecutionId || undefined,
        rootExecutionId: requestContext.rootExecutionId,
        promptCallId,
        promptAttemptNo: attempt,
        retryBudget
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
        pathId: context.pathId || null,
        userId: context.userId || requestContext.userId || null,
        conversationId: context.conversationId || null,
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
    const extracted = extractJsonObject(rawModelOutput);
    lastRaw = rawModelOutput;
    lastExtractedJson = extracted.extractedJson;

    if (!extracted.extractedJson || extracted.parsed === null) {
      lastFailureReason = 'response does not contain valid JSON object';
      attempts.push({
        attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason,
        status: 'validation_failed', durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: gatewayMetadata?.attemptCount
      });
      continue;
    }

    const validation = spec.validateParsedOutput
      ? spec.validateParsedOutput(extracted.parsed, input)
      : { valid: true as const };
    if (!validation.valid) {
      lastFailureReason = validation.failureReason || 'parsed output validation failed';
      attempts.push({
        attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason,
        status: 'validation_failed', durationMs: Date.now() - attemptStartedAt,
        llmRequestId: lastLlmRequestId || undefined,
        transportAttemptCount: gatewayMetadata?.attemptCount
      });
      continue;
    }

    const normalizedOutput = spec.normalizeOutput(extracted.parsed, input);
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
      durationMs,
      tokenUsage: JSON.stringify(tokenUsage),
      pathId: context.pathId || null,
      userId: context.userId || requestContext.userId || null,
      conversationId: context.conversationId || null,
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
      debug: {
        agentId: spec.agentId, systemPrompt,
        systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
        userPayload, rawModelOutput, extractedJson: extracted.extractedJson,
        normalizedOutput, promptDrift, attempts, durationMs, tokenUsage,
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
    durationMs,
    pathId: context.pathId || null,
    userId: context.userId || requestContext.userId || null,
    conversationId: context.conversationId || null,
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
      agentId: spec.agentId, systemPrompt,
      systemPromptVersion: systemPromptOverride ? null : promptConfig?.version || null,
      userPayload, rawModelOutput: lastRaw, extractedJson: lastExtractedJson,
      normalizedOutput: null, promptDrift, attempts, durationMs, tokenUsage: null,
    },
  };
}
