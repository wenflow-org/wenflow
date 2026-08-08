import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { redactLogValue } from '../../utils/secret-redaction';
import { ResolvedRoute, ChatRequest, ChatResponse, ExecutionContext } from './types';
import { getDefaultAIRequestTimeoutMs } from '../../services/agentRequestTimeout.service';
import { supportsThinkingMode } from '../../config/models.config';
import { safeHttpRequest, safeHttpStreamRequest, SafeHttpBodyLimitError, UnsafeUrlError } from '../../utils/safe-http';
import { isEncryptedSecret } from '../../utils/secret-crypto';
import { telemetryWriter } from '../../services/telemetry-writer.service';
import { GatewayExecutionError, parseRetryAfterMs } from './failure-classification';
import { consumeUpstreamAttempt, createRetryBudget } from './retry-budget';
import { hoistLlmParamsFromContext } from '../../services/resolve-llm-call-params';
import { SseParser } from '../../utils/sse-parser';

const MAX_SINGLE_ATTEMPT_TIMEOUT_MS = 300_000;
/** 流式响应的空闲超时：两次数据块间隔超过该值即判定超时（数据流动时重置） */
const STREAM_IDLE_TIMEOUT_MS = 60_000;
/** 流式响应累计字节上限 */
const STREAM_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

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
  /** 本次尝试的传输模式：流式（上游 SSE）或缓冲（完整 JSON） */
  executionMode: 'stream' | 'buffered';
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
    // 流式路径：仅「首字节（首个内容增量）之前」允许重试；
    // 一旦内容已透传，连接不可重试（否则客户端收到两段拼接内容，且 HTTP 200 已提交）。
    // request.stream 即触发流式（上游 SSE）；onStreamChunk 可选——未提供时仅流式请求，
    // 不逐字透传（JSON 类输出在流结束时合成完整响应，由调用方整体解析校验）。
    const streamRequested = request.stream === true;
    let streamStarted = false;
    const streamDeltaHandler = streamRequested
      ? (delta: string) => {
          streamStarted = true;
          context.onStreamChunk?.(delta);
        }
      : undefined;

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
        const result = await this.executeRequest(route, request, normalizedContext, streamDeltaHandler);
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
          resolvedModel: result.resolvedModel,
          executionMode: streamRequested ? 'stream' : 'buffered'
        };
        attempts.push(record);
        attemptTelemetryComplete = await this.persistAttempt(
          route, request, normalizedContext, llmRequestId, record, maxAttempts
        ) && attemptTelemetryComplete;
        this.attachGatewayMetadata(result.response, route, request, llmRequestId, attempt, streamRequested);
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
        let willRetry = retryEligible && attempt < maxAttempts && !streamStarted;
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
          retryAfterMs: executionError.retryAfterMs,
          executionMode: streamRequested ? 'stream' : 'buffered'
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
    context: ExecutionContext,
    onStreamChunk?: (delta: string) => void
  ): Promise<RequestResult> {
    if (request.stream === true) {
      return this.executeStreamRequest(route, request, context, onStreamChunk);
    }

    const configuredTimeoutMs = route.timeoutSource === 'environment-default'
      ? context.retryBudget?.policy.defaultRequestTimeoutMs ?? route.timeoutMs ?? this.defaultTimeoutMs
      : route.timeoutMs ?? this.defaultTimeoutMs;
    const effectiveTimeoutMs = Math.min(configuredTimeoutMs, MAX_SINGLE_ATTEMPT_TIMEOUT_MS);
    const requestUrl = this.resolveChatCompletionsUrl(route.endpoint);
    // 兼容历史误把 temperature/maxTokens/model 放进 ExecutionContext 的调用点
    const requestBody = this.buildRequestBody(route, request, context);
    // 非流式路径不得携带流式参数（部分 provider 收到 stream:true 会返回 SSE 而破坏缓冲解析）
    if (requestBody.stream === true || requestBody.stream_options) {
      delete requestBody.stream;
      delete requestBody.stream_options;
    }

    try {
      logger.debug('[api-gateway] request payload resolved', {
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

      const parsedResponse = this.parseChatResponseBody(responseText, requestUrl, contentType, response.status);
      (parsedResponse as any)._routeThinkingMode = route.thinkingMode || 'default';

      return {
        response: parsedResponse,
        statusCode: response.status,
        providerRequestId: this.resolveProviderRequestId(response.headers),
        responseBytes: Buffer.byteLength(responseText || '', 'utf8'),
        resolvedModel: String(requestBody.model || route.model)
      };
    } catch (error: any) {
      throw this.classifyTransportError(error, requestUrl, effectiveTimeoutMs);
    }
  }

  /**
   * 流式执行：请求上游 stream:true，逐段解析 SSE 并透传内容增量；
   * 流结束时合成与缓冲路径一致的 ChatResponse（id/model/content/usage/finish_reason），
   * 使 persistAttempt/logExecution 等遥测路径原样复用。
   */
  private async executeStreamRequest(
    route: ResolvedRoute,
    request: ChatRequest,
    context: ExecutionContext,
    onStreamChunk?: (delta: string) => void
  ): Promise<RequestResult> {
    const configuredTimeoutMs = route.timeoutSource === 'environment-default'
      ? context.retryBudget?.policy.defaultRequestTimeoutMs ?? route.timeoutMs ?? this.defaultTimeoutMs
      : route.timeoutMs ?? this.defaultTimeoutMs;
    const effectiveTimeoutMs = Math.min(configuredTimeoutMs, MAX_SINGLE_ATTEMPT_TIMEOUT_MS);
    const requestUrl = this.resolveChatCompletionsUrl(route.endpoint);
    const baseBody = this.buildRequestBody(route, request, context);
    logger.info('[api-gateway] streaming request started', {
      traceId: context.traceId,
      providerId: route.providerId,
      model: request.model || route.model,
      requestUrl,
      requestPath: context.requestPath
    });
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${route.apiKey}`
    };
    const privateNetworkPolicy = route.privateNetworkPolicy
      || (route.source === 'user-provider' || route.source === 'user-agent-override'
        ? 'public-only'
        : 'runtime');

    // 极少数 provider 不识别 stream_options 会报 400：去该参数重试一次（不消耗重试预算）
    for (let pass = 0; pass < 2; pass++) {
      const withUsage = pass === 0;
      const state = {
        chunks: [] as Buffer[],
        parser: new SseParser(),
        id: '',
        model: '',
        content: '',
        usage: undefined as ChatResponse['usage'] | undefined,
        finishReason: '',
        sawSseEvent: false,
        ttftMs: undefined as number | undefined,
      };
      const streamStartAt = Date.now();
      let statusCode = 0;
      let contentType = '';
      let responseHeaders: Record<string, string> = {};
      const requestBody: ChatRequest = {
        ...baseBody,
        stream: true,
        ...(withUsage ? { stream_options: { include_usage: true } } : {})
      };
      try {
        await safeHttpStreamRequest(requestUrl, {
          method: 'POST',
          headers,
          body: requestBody,
          timeoutMs: effectiveTimeoutMs,
          idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
          maxResponseBytes: STREAM_MAX_RESPONSE_BYTES,
          privateNetworkPolicy,
          signal: context.abortSignal,
          onHeaders: (status, responseHeadersValue) => {
            statusCode = status;
            contentType = responseHeadersValue['content-type'] || '';
            responseHeaders = responseHeadersValue;
          },
          onChunk: (chunk) => {
            state.chunks.push(chunk);
            for (const event of state.parser.push(chunk)) {
              state.sawSseEvent = true;
              if (event.data === '[DONE]') continue;
              let parsed: any;
              try {
                parsed = JSON.parse(event.data);
              } catch {
                continue;
              }
              const choice = parsed?.choices?.[0];
              const delta = typeof choice?.delta?.content === 'string' ? choice.delta.content : undefined;
              if (delta !== undefined) {
                if (state.ttftMs === undefined) state.ttftMs = Date.now() - streamStartAt;
                state.content += delta;
                if (delta) onStreamChunk?.(delta);
              }
              if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
                state.finishReason = choice.finish_reason;
              }
              if (parsed?.usage && typeof parsed.usage === 'object') {
                state.usage = parsed.usage;
              }
              if (!state.id && typeof parsed?.id === 'string') state.id = parsed.id;
              if (!state.model && typeof parsed?.model === 'string') state.model = parsed.model;
            }
          }
        });
        const retryAfterMs = parseRetryAfterMs(responseHeaders['retry-after']);
        const fullText = Buffer.concat(state.chunks).toString('utf8');

        if (statusCode < 200 || statusCode >= 300) {
          const quota = this.isQuotaOrBalanceError(statusCode, fullText);
          const authentication = statusCode === 401 || (statusCode === 403 && !quota);
          const retryable = !quota && !authentication
            && (statusCode >= 500 || statusCode === 429 || statusCode === 408 || statusCode === 425);
          throw new GatewayExecutionError(
            `API request failed with status ${statusCode}: ${this.truncate(fullText, 500)}`,
            {
              category: quota ? 'quota' : authentication ? 'authentication' : statusCode === 429 ? 'rate_limit' : 'provider_http',
              code: quota ? 'QUOTA_EXHAUSTED' : authentication ? 'AUTH_INVALID' : statusCode === 429 ? 'RATE_LIMITED' : `UPSTREAM_${statusCode}`,
              statusCode,
              requestUrl,
              contentType,
              retryable,
              retryAfterMs
            }
          );
        }

        const isSse = /text\/event-stream/i.test(contentType);
        const isJson = this.isJsonContentType(contentType);
        if (!isSse && !isJson) {
          throw new GatewayExecutionError(
            `API returned non-SSE/non-JSON response (content-type: ${contentType || 'unknown'}) from ${requestUrl}. Body preview: ${this.truncate(fullText, 300)}`,
            {
              category: 'protocol', code: 'NON_JSON_RESPONSE', statusCode,
              requestUrl, contentType, retryable: false
            }
          );
        }

        let parsedResponse: ChatResponse;
        if (isJson) {
          // provider 忽略了 stream 参数并返回完整 JSON：回退缓冲解析
          parsedResponse = this.parseChatResponseBody(fullText, requestUrl, contentType, statusCode);
          (parsedResponse as any)._routeThinkingMode = route.thinkingMode || 'default';
        } else {
          if (!state.sawSseEvent) {
            throw new GatewayExecutionError(
              `API returned event-stream content-type without SSE events from ${requestUrl}. Body preview: ${this.truncate(fullText, 300)}`,
              {
                category: 'protocol', code: 'INVALID_STREAM_RESPONSE', statusCode,
                requestUrl, contentType, retryable: false
              }
            );
          }
          parsedResponse = {
            id: state.id || 'stream',
            model: state.model || String(requestBody.model || route.model),
            choices: [{
              index: 0,
              message: { role: 'assistant', content: state.content },
              finish_reason: state.finishReason || 'stop'
            }],
            ...(state.usage ? { usage: state.usage } : {})
          } as ChatResponse;
          (parsedResponse as any)._routeThinkingMode = route.thinkingMode || 'default';
          if (state.ttftMs !== undefined) (parsedResponse as any).ttftMs = state.ttftMs;
        }

        return {
          response: parsedResponse,
          statusCode,
          providerRequestId: this.resolveProviderRequestId(responseHeaders),
          responseBytes: state.chunks.reduce((total, chunk) => total + chunk.length, 0),
          resolvedModel: String(requestBody.model || route.model)
        };
      } catch (error: any) {
        const mapped = this.classifyTransportError(error, requestUrl, effectiveTimeoutMs);
        if (
          pass === 0
          && mapped.statusCode === 400
          && /stream_options|unknown parameter|unknown field|invalid.*parameter/i.test(mapped.message)
        ) {
          logger.debug('[api-gateway] provider rejected stream_options, retrying without include_usage', {
            traceId: context.traceId,
            providerId: route.providerId,
            model: request.model || route.model,
            requestUrl,
            errorMessage: mapped.message
          });
          continue;
        }
        throw mapped;
      }
    }
    throw this.classifyTransportError(new Error('Stream execution exhausted'), requestUrl, effectiveTimeoutMs);
  }

  /** 构造上游请求体（合并调用参数、路由兜底与 thinking 模式） */
  private buildRequestBody(route: ResolvedRoute, request: ChatRequest, context: ExecutionContext): ChatRequest {
    const hoisted = hoistLlmParamsFromContext(request, context);
    const requestBody: ChatRequest = {
      ...request,
      model: hoisted.model || route.model,
      temperature: hoisted.temperature ?? route.temperature,
      max_tokens: hoisted.max_tokens ?? route.maxTokens
    };
    this.applyThinkingMode(route, requestBody);
    return requestBody;
  }

  /** 解析并校验完整 JSON chat completion 信封（缓冲路径与流式 JSON 回退共用） */
  private parseChatResponseBody(
    responseText: string,
    requestUrl: string,
    contentType: string,
    statusCode: number
  ): ChatResponse {
    try {
      const rawResponse = JSON.parse(responseText) as any;
      const parsedResponse = (!Array.isArray(rawResponse?.choices) && Array.isArray(rawResponse?.data?.choices)
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
            category: 'protocol', code: 'INVALID_RESPONSE_SCHEMA', statusCode,
            requestUrl, contentType, retryable: false
          }
        );
      }
      return parsedResponse;
    } catch (error) {
      if (error instanceof GatewayExecutionError) throw error;
      throw new GatewayExecutionError(
        `API returned invalid JSON from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
        {
          category: 'protocol', code: 'INVALID_JSON_RESPONSE', statusCode,
          requestUrl, contentType, retryable: false
        }
      );
    }
  }

  /** 传输层错误归一化（缓冲路径与流式路径共用） */
  private classifyTransportError(
    error: any,
    requestUrl: string,
    effectiveTimeoutMs: number
  ): GatewayExecutionError {
    if (error instanceof GatewayExecutionError) return error;
    if (error instanceof UnsafeUrlError) {
      return new GatewayExecutionError(error.message, {
        category: 'security', code: 'NETWORK_POLICY_BLOCKED', retryable: false, requestUrl
      });
    }
    if (error instanceof SafeHttpBodyLimitError) {
      return new GatewayExecutionError(error.message, {
        category: 'protocol', code: 'RESPONSE_BODY_LIMIT_EXCEEDED', retryable: false, requestUrl
      });
    }
    if (error?.code === 'ERR_CANCELED') {
      return new GatewayExecutionError('API request canceled', {
        category: 'caller_abort', code: 'CALLER_ABORTED', retryable: false, requestUrl
      });
    }
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || /timeout|超时/i.test(error?.message || '')) {
      return new GatewayExecutionError(`API request timed out after ${effectiveTimeoutMs}ms`, {
        category: 'provider_timeout', code: 'ATTEMPT_TIMEOUT', retryable: true, requestUrl
      });
    }
    if (['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ECONNREFUSED'].includes(String(error?.code || ''))) {
      return new GatewayExecutionError(error?.message || 'Transient network error', {
        category: 'network', code: 'NETWORK_TRANSIENT', retryable: true, requestUrl
      });
    }
    if (['ENOTFOUND', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(String(error?.code || ''))) {
      return new GatewayExecutionError(error?.message || 'Provider configuration error', {
        category: 'configuration', code: 'PROVIDER_CONFIGURATION_ERROR', retryable: false, requestUrl
      });
    }
    return new GatewayExecutionError(error?.message || 'Internal API gateway error', {
      category: 'internal', code: 'API_GATEWAY_INTERNAL_ERROR', retryable: false, requestUrl
    });
  }

  private attachGatewayMetadata(
    response: ChatResponse,
    route: ResolvedRoute,
    request: ChatRequest,
    llmRequestId: string,
    attemptCount: number,
    streamed: boolean
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
        attemptCount,
        streamed
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
      metadata: JSON.stringify({
        temperature: request.temperature ?? null,
        max_tokens: request.max_tokens ?? null,
        model: request.model ?? null,
        thinkingMode: route.thinkingMode ?? null,
        reasoningEffort: route.reasoningEffort ?? null,
        executionMode: attempt.executionMode ?? null,
        // 可观测增量（2026-08）：TTFT 与 DeepSeek 前缀缓存命中（usage 透传字段）
        ttftMs: (response as any)?.ttftMs ?? null,
        promptCacheHitTokens: (response as any)?.usage?.prompt_cache_hit_tokens ?? null,
        promptCacheMissTokens: (response as any)?.usage?.prompt_cache_miss_tokens ?? null,
      })
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
    const contentPreview = response?.choices?.[0]?.message?.content?.slice(0, 120);
    const executionMode = attempts[0]?.executionMode || 'buffered';
    const logData = {
      traceId: context.traceId, llmRequestId,
      userId: context.userId, sessionId: context.sessionId, callerAgent: context.callerAgent,
      sourceEntry: context.sourceEntry, model: request.model || route.model, source: route.source,
      providerId: route.providerId, providerType: route.providerType, statusCode,
      requestPath: context.requestPath, durationMs, attempts: attemptsMade, success,
      usage: response?.usage, finishReason: response?.choices?.[0]?.finish_reason,
      contentPreview, errorCategory: finalError?.category, errorCode: finalError?.code, errorMessage,
      executionMode
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
        executionMode,
        skillId: context.skillId || null, agentId: context.agentId || null,
        sessionId: context.sessionId || null,
        conversationId: context.conversationId || null,
        pathId: context.pathId || null,
        taskId: context.taskId || null,
        language: context.locale?.language || null,
        timeZone: context.locale?.timeZone || null,
        providerId: route.providerId, providerType: route.providerType,
        routeSource: route.source, model: request.model || route.model,
        statusCode, attempts: attemptsMade, maxAttempts,
        requestPath: context.requestPath, messageCount: request.messages?.length || 0,
        requestParams: {
          temperature: request.temperature ?? null,
          max_tokens: request.max_tokens ?? null,
          model: request.model ?? null,
        },
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
