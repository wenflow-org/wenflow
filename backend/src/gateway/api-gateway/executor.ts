import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { redactLogValue } from '../../utils/secret-redaction';
import { ResolvedRoute, ChatRequest, ChatResponse, ExecutionContext } from './types';
import { getDefaultAIRequestTimeoutMs } from '../../services/agentRequestTimeout.service';
import { supportsThinkingMode } from '../../config/models.config';
import { safeHttpRequest, UnsafeUrlError } from '../../utils/safe-http';
import { isEncryptedSecret } from '../../utils/secret-crypto';
import { telemetryWriter } from '../../services/telemetry-writer.service';
import { GatewayExecutionError, parseRetryAfterMs } from './failure-classification';
import { consumeUpstreamAttempt, createRetryBudget } from './retry-budget';

const MAX_SINGLE_ATTEMPT_TIMEOUT_MS = 300_000;

interface RequestResult {
  response: ChatResponse;
  statusCode: number;
  providerRequestId?: string;
  responseBytes: number;
  resolvedModel: string;
}

interface AttemptRecord {
  attempt: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  statusCode?: number;
  success: boolean;
  retryable?: boolean;
  willRetry: boolean;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  response?: ChatResponse;
  providerRequestId?: string;
  responseBytes?: number;
  resolvedModel: string;
  backoffMs?: number;
  retryAfterMs?: number;
}

export class APIExecutor {
  private readonly defaultTimeoutMs = getDefaultAIRequestTimeoutMs();

  private isQuotaOrBalanceError(status: number, body: string): boolean {
    const normalized = body.toLowerCase();
    if (status === 429) {
      return normalized.includes('quota')
        || normalized.includes('exceeded today')
        || normalized.includes('try again tomorrow');
    }
    if (status === 402 || status === 403) {
      return normalized.includes('insufficient balance')
        || normalized.includes('account balance')
        || normalized.includes('余额')
        || normalized.includes('quota');
    }
    return false;
  }

  async execute(
    route: ResolvedRoute,
    request: ChatRequest,
    context: ExecutionContext
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    const traceId = context.traceId || this.generateTraceId();
    const llmRequestId = `gw_${randomUUID()}`;
    const retryBudget = context.retryBudget || createRetryBudget();
    const normalizedContext: ExecutionContext = {
      ...context,
      traceId,
      parentExecutionId: context.parentExecutionId || context.executionLogId,
      rootExecutionId: context.rootExecutionId || context.executionLogId || llmRequestId,
      retryBudget
    };
    const transportMaxAttempts = Math.max(1, retryBudget.limits.maxTransportRetries + 1);
    const remainingUpstreamAttempts = Math.max(
      0,
      retryBudget.limits.maxUpstreamAttempts - retryBudget.used.upstreamAttempts
    );
    const maxAttempts = Math.max(
      1,
      Math.min(transportMaxAttempts, remainingUpstreamAttempts || 1)
    );
    let lastError: Error | null = null;
    let lastStatusCode: number | undefined;
    let attemptsMade = 0;
    let attemptTelemetryComplete = true;
    const attempts: AttemptRecord[] = [];

    if (isEncryptedSecret(route.apiKey)) {
      const error = new GatewayExecutionError('API Key 解密边界缺失，已阻止发送数据库密文', {
        category: 'configuration', code: 'CREDENTIAL_DECRYPTION_REQUIRED', retryable: false
      }).attachExecutionMetadata({
        llmRequestId,
        attemptCount: 0,
        providerId: route.providerId,
        model: request.model || route.model
      });
      await this.logExecution(
        route, request, undefined, normalizedContext, llmRequestId,
        startTime, 0, false, error.message, undefined, attempts, error, true, maxAttempts
      );
      throw error;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!consumeUpstreamAttempt(retryBudget, attempt > 1)) {
        lastError = new GatewayExecutionError('Provider request retry budget exhausted', {
          category: 'internal', code: 'RETRY_BUDGET_EXHAUSTED', retryable: false
        });
        break;
      }
      attemptsMade = attempt;
      const attemptStartedAt = new Date();
      try {
        const result = await this.executeRequest(route, request, normalizedContext);
        lastStatusCode = result.statusCode;
        const completedAt = new Date();
        const record: AttemptRecord = {
          attempt,
          startedAt: attemptStartedAt,
          completedAt,
          durationMs: completedAt.getTime() - attemptStartedAt.getTime(),
          statusCode: result.statusCode,
          success: true,
          retryable: false,
          willRetry: false,
          response: result.response,
          providerRequestId: result.providerRequestId,
          responseBytes: result.responseBytes,
          resolvedModel: result.resolvedModel
        };
        attempts.push(record);
        attemptTelemetryComplete = await this.persistAttempt(
          route, request, normalizedContext, llmRequestId, record, maxAttempts
        ) && attemptTelemetryComplete;
        this.attachGatewayMetadata(result.response, route, request, llmRequestId, attempt);
        await this.logExecution(
          route,
          request,
          result.response,
          normalizedContext,
          llmRequestId,
          startTime,
          attempt,
          true,
          undefined,
          lastStatusCode,
          attempts,
          undefined,
          attemptTelemetryComplete,
          maxAttempts
        );
        return result.response;
      } catch (error) {
        lastError = this.normalizeExecutionError(error);
        const executionError = lastError as GatewayExecutionError;
        lastStatusCode = executionError.statusCode || lastStatusCode;
        const retryEligible = executionError.retryable
          && (!executionError.retryAfterMs || executionError.retryAfterMs <= retryBudget.policy.maxRetryAfterMs);
        let willRetry = retryEligible && attempt < maxAttempts;
        let retryBudgetExhausted = false;
        if (
          retryEligible
          && !willRetry
          && retryBudget.used.upstreamAttempts >= retryBudget.limits.maxUpstreamAttempts
        ) {
          retryBudget.exhaustedBy = 'upstream-attempts';
          retryBudgetExhausted = true;
        } else if (
          retryEligible
          && !willRetry
          && attempt >= transportMaxAttempts
        ) {
          retryBudget.exhaustedBy = 'transport-retries';
          retryBudgetExhausted = true;
        }
        if (willRetry) {
          if (retryBudget.used.upstreamAttempts >= retryBudget.limits.maxUpstreamAttempts) {
            retryBudget.exhaustedBy = 'upstream-attempts';
            retryBudgetExhausted = true;
            willRetry = false;
          } else if (retryBudget.used.transportRetries >= retryBudget.limits.maxTransportRetries) {
            retryBudget.exhaustedBy = 'transport-retries';
            retryBudgetExhausted = true;
            willRetry = false;
          }
        }
        const completedAt = new Date();
        const backoffMs = willRetry
          ? this.resolveBackoffMs(
              attempt,
              retryBudget.policy.retryBaseDelayMs,
              retryBudget.policy.jitterEnabled,
              executionError.retryAfterMs
            )
          : undefined;
        const record: AttemptRecord = {
          attempt,
          startedAt: attemptStartedAt,
          completedAt,
          durationMs: completedAt.getTime() - attemptStartedAt.getTime(),
          statusCode: executionError.statusCode,
          success: false,
          retryable: executionError.retryable,
          willRetry,
          errorCategory: executionError.category,
          errorCode: executionError.code,
          errorMessage: executionError.message,
          resolvedModel: request.model || route.model,
          backoffMs,
          retryAfterMs: executionError.retryAfterMs
        };
        attempts.push(record);
        attemptTelemetryComplete = await this.persistAttempt(
          route, request, normalizedContext, llmRequestId, record, maxAttempts
        ) && attemptTelemetryComplete;
        logger.warn('[api-gateway] execution attempt failed', {
          traceId,
          llmRequestId,
          attempt,
          maxAttempts,
          source: route.source,
          providerId: route.providerId,
          model: request.model || route.model,
          statusCode: executionError.statusCode,
          requestUrl: executionError.requestUrl,
          contentType: executionError.contentType,
          errorCategory: executionError.category,
          errorCode: executionError.code,
          retryable: executionError.retryable,
          willRetry,
          backoffMs,
          errorMessage: executionError.message
        });

        if (retryBudgetExhausted) {
          lastError = new GatewayExecutionError('Provider request retry budget exhausted', {
            category: 'internal', code: 'RETRY_BUDGET_EXHAUSTED', retryable: false
          });
          break;
        }
        if (!willRetry) break;
        try {
          await this.delay(backoffMs || retryBudget.policy.retryBaseDelayMs, normalizedContext.abortSignal);
        } catch (delayError) {
          lastError = this.normalizeExecutionError(delayError);
          break;
        }
      }
    }

    const finalError = this.normalizeExecutionError(lastError || new Error('API execution failed'))
      .attachExecutionMetadata({
        llmRequestId,
        attemptCount: attemptsMade,
        providerId: route.providerId,
        model: request.model || route.model
      });
    await this.logExecution(
      route,
      request,
      undefined,
      normalizedContext,
      llmRequestId,
      startTime,
      attemptsMade,
      false,
      finalError.message,
      lastStatusCode,
      attempts,
      finalError,
      attemptTelemetryComplete,
      maxAttempts
    );
    throw finalError;
  }

  private async executeRequest(
    route: ResolvedRoute,
    request: ChatRequest,
    context: ExecutionContext
  ): Promise<RequestResult> {
    const configuredTimeoutMs = route.timeoutSource === 'environment-default'
      ? context.retryBudget?.policy.defaultRequestTimeoutMs ?? route.timeoutMs ?? this.defaultTimeoutMs
      : route.timeoutMs ?? this.defaultTimeoutMs;
    const effectiveTimeoutMs = Math.min(configuredTimeoutMs, MAX_SINGLE_ATTEMPT_TIMEOUT_MS);
    const requestUrl = this.resolveChatCompletionsUrl(route.endpoint);
    const requestBody = {
      ...request,
      model: request.model || route.model,
      temperature: request.temperature ?? route.temperature,
      max_tokens: request.max_tokens ?? route.maxTokens
    };
    this.applyThinkingMode(route, requestBody);

    try {
      logger.info('[api-gateway] request payload resolved', {
        providerId: route.providerId,
        source: route.source,
        requestUrl,
        routeModel: route.model,
        requestModel: request.model || null,
        finalModel: requestBody.model,
        thinkingMode: route.thinkingMode || 'default',
        reasoningEffort: route.reasoningEffort || 'default'
      });

      const response = await safeHttpRequest<string>(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${route.apiKey}`
        },
        body: requestBody,
        timeoutMs: effectiveTimeoutMs,
        maxResponseBytes: 10 * 1024 * 1024,
        maxRedirects: 0,
        responseType: 'text',
        privateNetworkPolicy: route.privateNetworkPolicy
          || (route.source === 'user-provider' || route.source === 'user-agent-override'
            ? 'public-only'
            : 'runtime'),
        signal: context.abortSignal
      });

      const contentType = response.headers['content-type'] || '';
      const responseText = response.data;
      const retryAfterMs = parseRetryAfterMs(response.headers['retry-after']);

      if (response.status < 200 || response.status >= 300) {
        const quota = this.isQuotaOrBalanceError(response.status, responseText);
        const authentication = response.status === 401 || (response.status === 403 && !quota);
        const retryable = !quota && !authentication
          && (response.status >= 500 || response.status === 429 || response.status === 408 || response.status === 425);
        throw new GatewayExecutionError(
          `API request failed with status ${response.status}: ${this.truncate(responseText, 500)}`,
          {
            category: quota ? 'quota' : authentication ? 'authentication' : response.status === 429 ? 'rate_limit' : 'provider_http',
            code: quota ? 'QUOTA_EXHAUSTED' : authentication ? 'AUTH_INVALID' : response.status === 429 ? 'RATE_LIMITED' : `UPSTREAM_${response.status}`,
            statusCode: response.status,
            requestUrl,
            contentType,
            retryable,
            retryAfterMs
          }
        );
      }

      if (!this.isJsonContentType(contentType)) {
        throw new GatewayExecutionError(
          `API returned non-JSON response (content-type: ${contentType || 'unknown'}) from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
          {
            category: 'protocol', code: 'NON_JSON_RESPONSE', statusCode: response.status,
            requestUrl, contentType, retryable: false
          }
        );
      }

      let parsedResponse: ChatResponse;
      try {
        const rawResponse = JSON.parse(responseText) as any;
        parsedResponse = (!Array.isArray(rawResponse?.choices) && Array.isArray(rawResponse?.data?.choices)
          ? {
              ...rawResponse,
              ...rawResponse.data,
              model: rawResponse.data.model || rawResponse.model,
              usage: rawResponse.data.usage || rawResponse.usage
            }
          : rawResponse) as ChatResponse;
        if (!parsedResponse || typeof parsedResponse !== 'object'
          || !Array.isArray(parsedResponse.choices)
          || parsedResponse.choices.length === 0
          || typeof parsedResponse.choices[0]?.message?.content !== 'string'
          || !parsedResponse.choices[0].message.content.trim()) {
          throw new GatewayExecutionError(
            `API returned an invalid chat completion envelope from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
            {
              category: 'protocol', code: 'INVALID_RESPONSE_SCHEMA', statusCode: response.status,
              requestUrl, contentType, retryable: false
            }
          );
        }
        (parsedResponse as any)._routeThinkingMode = route.thinkingMode || 'default';
      } catch (error) {
        if (error instanceof GatewayExecutionError) throw error;
        throw new GatewayExecutionError(
          `API returned invalid JSON from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
          {
            category: 'protocol', code: 'INVALID_JSON_RESPONSE', statusCode: response.status,
            requestUrl, contentType, retryable: false
          }
        );
      }

      return {
        response: parsedResponse,
        statusCode: response.status,
        providerRequestId: this.resolveProviderRequestId(response.headers),
        responseBytes: Buffer.byteLength(responseText || '', 'utf8'),
        resolvedModel: String(requestBody.model || route.model)
      };
    } catch (error: any) {
      if (error instanceof GatewayExecutionError) throw error;
      if (error instanceof UnsafeUrlError) {
        throw new GatewayExecutionError(error.message, {
          category: 'security', code: 'NETWORK_POLICY_BLOCKED', retryable: false, requestUrl
        });
      }
      if (error?.code === 'ERR_CANCELED') {
        throw new GatewayExecutionError('API request canceled', {
          category: 'caller_abort', code: 'CALLER_ABORTED', retryable: false, requestUrl
        });
      }
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || /timeout|超时/i.test(error?.message || '')) {
        throw new GatewayExecutionError(`API request timed out after ${effectiveTimeoutMs}ms`, {
          category: 'provider_timeout', code: 'ATTEMPT_TIMEOUT', retryable: true, requestUrl
        });
      }
      if (['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ECONNREFUSED'].includes(String(error?.code || ''))) {
        throw new GatewayExecutionError(error?.message || 'Transient network error', {
          category: 'network', code: 'NETWORK_TRANSIENT', retryable: true, requestUrl
        });
      }
      if (['ENOTFOUND', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(String(error?.code || ''))) {
        throw new GatewayExecutionError(error?.message || 'Provider configuration error', {
          category: 'configuration', code: 'PROVIDER_CONFIGURATION_ERROR', retryable: false, requestUrl
        });
      }
      throw new GatewayExecutionError(error?.message || 'Internal API gateway error', {
        category: 'internal', code: 'API_GATEWAY_INTERNAL_ERROR', retryable: false, requestUrl
      });
    }
  }

  private attachGatewayMetadata(
    response: ChatResponse,
    route: ResolvedRoute,
    request: ChatRequest,
    llmRequestId: string,
    attemptCount: number
  ): void {
    Object.defineProperty(response, '_gatewayMetadata', {
      enumerable: false,
      configurable: true,
      value: {
        llmRequestId,
        providerId: route.providerId,
        routeSource: route.source,
        requestedModel: request.model,
        resolvedModel: request.model || route.model,
        responseModel: response.model,
        attemptCount
      }
    });
  }

  private async persistAttempt(
    route: ResolvedRoute,
    request: ChatRequest,
    context: ExecutionContext,
    llmRequestId: string,
    attempt: AttemptRecord,
    maxAttempts: number
  ): Promise<boolean> {
    const response = attempt.response;
    const configuredTimeoutMs = route.timeoutSource === 'environment-default'
      ? context.retryBudget?.policy.defaultRequestTimeoutMs ?? route.timeoutMs ?? this.defaultTimeoutMs
      : route.timeoutMs ?? this.defaultTimeoutMs;
    return telemetryWriter.createLlmAttempt({
      id: `lla_${randomUUID()}`,
      llmRequestId,
      parentExecutionId: context.parentExecutionId || context.executionLogId || null,
      promptCallId: context.promptCallId || null,
      rootExecutionId: context.rootExecutionId || llmRequestId,
      traceId: context.traceId || null,
      userId: context.userId || null,
      sourceEntry: context.sourceEntry || 'platform',
      promptAttemptNo: context.promptAttemptNo || 1,
      transportAttemptNo: attempt.attempt,
      maxAttempts,
      providerId: route.providerId,
      providerType: route.providerType,
      routeSource: route.source,
      requestedModel: request.model || null,
      resolvedModel: attempt.resolvedModel,
      responseModel: response?.model || null,
      endpointHost: this.resolveEndpointHost(route.endpoint),
      success: attempt.success,
      retryable: attempt.retryable ?? null,
      willRetry: attempt.willRetry,
      statusCode: attempt.statusCode || null,
      errorCategory: attempt.errorCategory || null,
      errorCode: attempt.errorCode || null,
      errorMessage: attempt.errorMessage ? this.truncate(String(redactLogValue(attempt.errorMessage)), 512) : null,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
      backoffMs: attempt.backoffMs || null,
      retryAfterMs: attempt.retryAfterMs || null,
      configuredTimeoutMs,
      effectiveTimeoutMs: Math.min(configuredTimeoutMs, MAX_SINGLE_ATTEMPT_TIMEOUT_MS),
      promptTokens: response?.usage?.prompt_tokens || null,
      completionTokens: response?.usage?.completion_tokens || null,
      totalTokens: response?.usage?.total_tokens || null,
      finishReason: response?.choices?.[0]?.finish_reason || null,
      completionId: response?.id || null,
      providerRequestId: attempt.providerRequestId || null,
      messageCount: request.messages?.length || 0,
      requestBytes: Buffer.byteLength(JSON.stringify(request), 'utf8'),
      responseBytes: attempt.responseBytes || null,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      metadata: null
    });
  }

  private async logExecution(
    route: ResolvedRoute,
    request: ChatRequest,
    response: ChatResponse | undefined,
    context: ExecutionContext,
    llmRequestId: string,
    startTime: number,
    attemptsMade: number,
    success: boolean,
    errorMessage?: string,
    statusCode?: number,
    attempts: AttemptRecord[] = [],
    finalError?: GatewayExecutionError,
    attemptTelemetryComplete = true,
    maxAttempts = 1
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    const contentPreview = response?.choices?.[0]?.message?.content?.slice(0, 500);
    const logData = {
      traceId: context.traceId, llmRequestId,
      userId: context.userId, sessionId: context.sessionId, callerAgent: context.callerAgent,
      sourceEntry: context.sourceEntry, model: request.model || route.model, source: route.source,
      providerId: route.providerId, providerType: route.providerType, statusCode,
      requestPath: context.requestPath, durationMs, attempts: attemptsMade, success,
      usage: response?.usage, finishReason: response?.choices?.[0]?.finish_reason,
      contentPreview, errorCategory: finalError?.category, errorCode: finalError?.code, errorMessage
    };
    success ? logger.info('[api-gateway] execution succeeded', logData) : logger.error('[api-gateway] execution failed', logData);

    const promptTokens = attempts.reduce((sum, item) => sum + (item.response?.usage?.prompt_tokens || 0), 0);
    const completionTokens = attempts.reduce((sum, item) => sum + (item.response?.usage?.completion_tokens || 0), 0);
    await telemetryWriter.createAgentCall({
      id: llmRequestId,
      agentId: 'api-gateway',
      userId: context.userId || 'system',
      sourceEntry: context.sourceEntry || 'platform',
      traceId: context.traceId || null,
      callerAgent: context.callerAgent || null,
      userRole: context.userRole || 'user',
      input: JSON.stringify(this.sanitizeRequest(request)).slice(0, 1000),
      output: contentPreview ? JSON.stringify({ content: contentPreview }) : null,
      success,
      durationMs,
      tokensUsed: promptTokens + completionTokens || null,
      error: errorMessage || null,
      errorCode: success ? null : (finalError?.code || 'API_GATEWAY_EXECUTION_FAILED'),
      executionLayer: 'api-gateway',
      actorType: context.skillId ? 'skill' : context.agentId ? 'agent' : 'system',
      actorId: context.skillId || context.agentId || context.callerAgent || 'api-gateway',
      parentExecutionId: context.parentExecutionId || context.executionLogId || null,
      rootExecutionId: context.rootExecutionId || llmRequestId,
      promptCallId: context.promptCallId || null,
      providerId: route.providerId,
      providerType: route.providerType,
      routeSource: route.source,
      model: request.model || route.model,
      statusCode: statusCode || null,
      attemptCount: attemptsMade,
      maxAttempts,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
      finishReason: response?.choices?.[0]?.finish_reason || null,
      completionId: response?.id || null,
      errorCategory: success ? null : (finalError?.category || 'internal'),
      metadata: JSON.stringify({
        layer: 'api-gateway-v2', executionLayer: 'api-gateway',
        skillId: context.skillId || null, agentId: context.agentId || null,
        providerId: route.providerId, providerType: route.providerType,
        routeSource: route.source, model: request.model || route.model,
        statusCode, attempts: attemptsMade, maxAttempts,
        requestPath: context.requestPath, messageCount: request.messages?.length || 0,
        finishReason: response?.choices?.[0]?.finish_reason, completionId: response?.id,
        promptCallId: context.promptCallId || null,
        recoveredByRetry: success && attemptsMade > 1,
        retryBudget: {
          id: context.retryBudget?.id || null,
          limits: context.retryBudget?.limits || null,
          used: context.retryBudget?.used || null,
          policy: context.retryBudget?.policy || null,
          exhaustedBy: context.retryBudget?.exhaustedBy || null
        },
        attemptTelemetryComplete,
        experimentId: context.experimentId || null, runId: context.runId || null
      })
    });
  }

  private applyThinkingMode(route: ResolvedRoute, requestBody: ChatRequest): void {
    const modelId = String(requestBody.model || route.model || '');
    if (!supportsThinkingMode(modelId)) return;
    if (route.thinkingMode === 'enabled' || route.thinkingMode === 'disabled') {
      requestBody.thinking = { type: route.thinkingMode };
    }
    if (route.thinkingMode !== 'disabled' && (route.reasoningEffort === 'high' || route.reasoningEffort === 'max')) {
      requestBody.reasoning_effort = route.reasoningEffort;
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
    if (signal.aborted) {
      return Promise.reject(new GatewayExecutionError('API request canceled', {
        category: 'caller_abort', code: 'CALLER_ABORTED', retryable: false
      }));
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new GatewayExecutionError('API request canceled', {
          category: 'caller_abort', code: 'CALLER_ABORTED', retryable: false
        }));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private normalizeExecutionError(error: unknown): GatewayExecutionError {
    if (error instanceof GatewayExecutionError) return error;
    return new GatewayExecutionError(error instanceof Error ? error.message : String(error), {
      category: 'internal', code: 'API_GATEWAY_INTERNAL_ERROR', retryable: false
    });
  }

  private resolveBackoffMs(
    attempt: number,
    baseDelayMs: number,
    jitterEnabled: boolean,
    retryAfterMs?: number
  ): number {
    const cap = Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
    const localDelay = jitterEnabled ? Math.floor(Math.random() * cap) : cap;
    return Math.max(localDelay, retryAfterMs || 0);
  }

  private resolveProviderRequestId(headers: Record<string, string>): string | undefined {
    return headers['x-request-id'] || headers['openai-request-id'] || headers['request-id'] || headers['cf-ray'];
  }

  private resolveEndpointHost(endpoint: string): string | null {
    try { return new URL(endpoint).host; } catch { return null; }
  }

  private sanitizeRequest(request: ChatRequest): Record<string, unknown> {
    return redactLogValue({
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      messageCount: request.messages?.length || 0,
      messages: (request.messages || []).map(message => ({
        role: message.role,
        content: (message.content || '').slice(0, 500)
      }))
    }) as Record<string, unknown>;
  }

  private isJsonContentType(contentType: string): boolean {
    return /application\/json/i.test(contentType) || /application\/problem\+json/i.test(contentType);
  }

  private truncate(value: string, max: number): string {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
  }

  private resolveChatCompletionsUrl(endpoint: string): string {
    const normalizedEndpoint = (endpoint || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(normalizedEndpoint)) return normalizedEndpoint;
    if (/\/v1$/i.test(normalizedEndpoint)) return `${normalizedEndpoint}/chat/completions`;
    return `${normalizedEndpoint}/v1/chat/completions`;
  }

  private generateTraceId(): string {
    return `gw-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
