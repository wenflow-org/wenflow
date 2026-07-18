import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { ResolvedRoute, ChatRequest, ChatResponse, ExecutionContext } from './types';
import { getDefaultAIRequestTimeoutMs } from '../../services/agentRequestTimeout.service';
import { supportsThinkingMode } from '../../config/models.config';
import { safeHttpRequest, UnsafeUrlError } from '../../utils/safe-http';
import { isEncryptedSecret } from '../../utils/secret-crypto';

class APIExecutionError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly requestUrl?: string;
  readonly contentType?: string;

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      statusCode?: number;
      requestUrl?: string;
      contentType?: string;
    }
  ) {
    super(message);
    this.name = 'APIExecutionError';
    this.retryable = options?.retryable ?? true;
    this.statusCode = options?.statusCode;
    this.requestUrl = options?.requestUrl;
    this.contentType = options?.contentType;
  }
}

export class APIExecutor {
  private readonly defaultTimeoutMs = getDefaultAIRequestTimeoutMs();
  private readonly maxAttempts = 2;
  private readonly retryDelay = 1000;

  private isQuotaOrBalanceError(status: number, body: string): boolean {
    const normalized = body.toLowerCase();
    if (status === 429) {
      return normalized.includes('quota')
        || normalized.includes('exceeded today')
        || normalized.includes('try again tomorrow')
        || normalized.includes('rate limit');
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
    let lastError: Error | null = null;
    let lastStatusCode: number | undefined;
    let attemptsMade = 0;
    const traceId = context.traceId || this.generateTraceId();
    const normalizedContext: ExecutionContext = {
      ...context,
      traceId
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attemptsMade = attempt;
      try {
        const { response, statusCode } = await this.executeRequest(route, request);
        lastStatusCode = statusCode;
        
        await this.logExecution(route, request, response, normalizedContext, startTime, attempt, true, undefined, lastStatusCode);
        
        return response;
      } catch (error) {
        lastError = error as Error;
        const executionError = this.asExecutionError(lastError);
        lastStatusCode = executionError?.statusCode || this.extractStatusCode(lastError.message) || lastStatusCode;
        logger.warn('[api-gateway] execution attempt failed', {
          traceId,
          attempt,
          maxAttempts: this.maxAttempts,
          source: route.source,
          providerId: route.providerId,
          model: route.model,
          statusCode: executionError?.statusCode,
          requestUrl: executionError?.requestUrl,
          contentType: executionError?.contentType,
          retryable: executionError?.retryable,
          errorMessage: lastError.message
        });

        if (executionError && !executionError.retryable) {
          break;
        }
        
        if (attempt < this.maxAttempts) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }

    await this.logExecution(route, request, undefined, normalizedContext, startTime, attemptsMade, false, lastError?.message, lastStatusCode);
    throw lastError || new Error('API execution failed after retries');
  }

  private async executeRequest(route: ResolvedRoute, request: ChatRequest): Promise<{ response: ChatResponse; statusCode: number }> {
    if (isEncryptedSecret(route.apiKey)) {
      throw new APIExecutionError('API Key 解密边界缺失，已阻止发送数据库密文', { retryable: false });
    }
    const timeoutMs = route.timeoutMs ?? this.defaultTimeoutMs;
    const requestUrl = this.resolveChatCompletionsUrl(route.endpoint);

    try {
      const requestBody = {
        ...request,
        model: request.model || route.model,
        temperature: request.temperature ?? route.temperature,
        max_tokens: request.max_tokens ?? route.maxTokens
      };
      this.applyThinkingMode(route, requestBody);

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
        timeoutMs,
        maxResponseBytes: 10 * 1024 * 1024,
        responseType: 'text'
      });

      const contentType = response.headers['content-type'] || '';
      const responseText = response.data;

      if (response.status < 200 || response.status >= 300) {
        const nonRetryableQuotaOrBalance = this.isQuotaOrBalanceError(response.status, responseText);
        throw new APIExecutionError(
          `API request failed with status ${response.status}: ${this.truncate(responseText, 500)}`,
          {
            statusCode: response.status,
            requestUrl,
            contentType,
            retryable: nonRetryableQuotaOrBalance
              ? false
              : (response.status >= 500 || response.status === 429 || response.status === 408)
          }
        );
      }

      if (!this.isJsonContentType(contentType)) {
        throw new APIExecutionError(
          `API returned non-JSON response (content-type: ${contentType || 'unknown'}) from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
          {
            statusCode: response.status,
            requestUrl,
            contentType,
            retryable: false
          }
        );
      }

      let parsedResponse: ChatResponse;
      try {
        parsedResponse = JSON.parse(responseText) as ChatResponse;
        (parsedResponse as any)._routeThinkingMode = route.thinkingMode || 'default';
      } catch {
        throw new APIExecutionError(
          `API returned invalid JSON from ${requestUrl}. Body preview: ${this.truncate(responseText, 300)}`,
          {
            statusCode: response.status,
            requestUrl,
            contentType,
            retryable: false
          }
        );
      }

      return {
        response: parsedResponse,
        statusCode: response.status
      };
    } catch (error: any) {
      if (error instanceof UnsafeUrlError) {
        throw new APIExecutionError(error.message, {
          retryable: false,
          requestUrl
        });
      }
      if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
        throw new APIExecutionError(`API request timed out after ${timeoutMs}ms`, {
          retryable: true,
          requestUrl
        });
      }
      throw error;
    }
  }

  private applyThinkingMode(route: ResolvedRoute, requestBody: ChatRequest): void {
    const modelId = String(requestBody.model || route.model || '');
    
    // 使用统一的模型配置检查是否支持 thinking mode
    if (!supportsThinkingMode(modelId)) {
      return;
    }

    if (route.thinkingMode === 'enabled' || route.thinkingMode === 'disabled') {
      requestBody.thinking = {
        type: route.thinkingMode
      };
    }

    if (route.thinkingMode !== 'disabled' && (route.reasoningEffort === 'high' || route.reasoningEffort === 'max')) {
      requestBody.reasoning_effort = route.reasoningEffort;
    }
  }

  /**
   * @deprecated 使用 supportsThinkingMode() 替代
   * 保留此方法用于向后兼容
   */
  private isDeepSeekV4Model(model: string): boolean {
    return supportsThinkingMode(model);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async logExecution(
    route: ResolvedRoute,
    request: ChatRequest,
    response: ChatResponse | undefined,
    context: ExecutionContext,
    startTime: number,
    attempts: number,
    success: boolean,
    errorMessage?: string,
    statusCode?: number
  ): Promise<void> {
    const duration = Date.now() - startTime;
    const contentPreview = response?.choices?.[0]?.message?.content
      ? response.choices[0].message.content.slice(0, 500)
      : undefined;

    const logData = {
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      userId: context.userId,
      sessionId: context.sessionId,
      callerAgent: context.callerAgent,
      userRole: context.userRole,
      sourceEntry: context.sourceEntry,
      model: route.model,
      source: route.source,
      providerId: route.providerId,
      providerType: route.providerType,
      statusCode,
      requestPath: context.requestPath,
      duration,
      attempts,
      success,
      usage: response?.usage,
      finishReason: response?.choices?.[0]?.finish_reason,
      contentPreview,
      errorMessage
    };

    if (success) {
      logger.info('[api-gateway] execution succeeded', logData);
    } else {
      logger.error('[api-gateway] execution failed', logData);
    }

    await this.persistExecution(route, request, response, context, {
      duration,
      attempts,
      statusCode,
      success,
      errorMessage
    });
  }

  private async persistExecution(
    route: ResolvedRoute,
    request: ChatRequest,
    response: ChatResponse | undefined,
    context: ExecutionContext,
    metrics: {
      duration: number;
      attempts: number;
      statusCode?: number;
      success: boolean;
      errorMessage?: string;
    }
  ): Promise<void> {
    if (!context.userId) {
      return;
    }

    if (context.executionLogId) {
      return;
    }

    try {
      const metadataSkillId = typeof context.skillId === 'string' ? context.skillId : null;
      const metadataAgentId = typeof context.agentId === 'string' ? context.agentId : null;
      const actorType = metadataSkillId ? 'skill' : (metadataAgentId ? 'agent' : 'system');
      const actorId = metadataSkillId || metadataAgentId || context.callerAgent || 'api-gateway';
      const requestPreview = JSON.stringify(this.sanitizeRequest(request)).slice(0, 1000);
      const responsePreview = response?.choices?.[0]?.message?.content
        ? response.choices[0].message.content.slice(0, 1000)
        : undefined;

      await prisma.agent_call_logs.create({
        data: {
          id: `gw_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          agentId: context.callerAgent || 'api-gateway',
          userId: context.userId,
          sourceEntry: context.sourceEntry || 'platform',
          traceId: context.traceId,
          callerAgent: context.callerAgent,
          userRole: context.userRole || 'user',
          input: requestPreview,
          output: responsePreview ? JSON.stringify({ content: responsePreview }) : null,
          success: metrics.success,
          durationMs: metrics.duration,
          tokensUsed: response?.usage?.total_tokens,
          error: metrics.errorMessage,
          errorCode: metrics.success ? null : 'API_GATEWAY_EXECUTION_FAILED',
          calledAt: new Date(),
          metadata: JSON.stringify({
            layer: 'api-gateway-v2',
            executionLayer: 'api-gateway',
            actorType,
            actorId,
            agentId: metadataAgentId,
            skillId: metadataSkillId,
            invokerId: context.callerAgent || null,
            invokerType: context.callerAgent ? 'agent' : null,
            model: route.model,
            providerId: route.providerId,
            providerType: route.providerType,
            routeSource: route.source,
            statusCode: metrics.statusCode,
            attempts: metrics.attempts,
            maxAttempts: this.maxAttempts,
            requestPath: context.requestPath,
            messageCount: request.messages?.length || 0,
            finishReason: response?.choices?.[0]?.finish_reason,
            completionId: response?.id,
            experimentId: context.experimentId || null,
            runId: context.runId || null
          })
        }
      });
    } catch (error) {
      logger.error('[api-gateway] persist execution log failed', {
        traceId: context.traceId,
        userId: context.userId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private sanitizeRequest(request: ChatRequest): Record<string, unknown> {
    return {
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      messageCount: request.messages?.length || 0,
      messages: (request.messages || []).map(message => ({
        role: message.role,
        content: (message.content || '').slice(0, 500)
      }))
    };
  }

  private extractStatusCode(message: string): number | undefined {
    const match = message.match(/status\s+(\d{3})/i);
    if (!match) {
      return undefined;
    }
    return Number(match[1]);
  }

  private asExecutionError(error: Error): APIExecutionError | undefined {
    if (error instanceof APIExecutionError) {
      return error;
    }
    return undefined;
  }

  private isJsonContentType(contentType: string): boolean {
    return /application\/json/i.test(contentType) || /application\/problem\+json/i.test(contentType);
  }

  private truncate(value: string, max: number): string {
    if (!value) {
      return '';
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) {
      return normalized;
    }
    return `${normalized.slice(0, max)}...`;
  }

  private resolveChatCompletionsUrl(endpoint: string): string {
    const normalizedEndpoint = (endpoint || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(normalizedEndpoint)) {
      return normalizedEndpoint;
    }
    if (/\/v1$/i.test(normalizedEndpoint)) {
      return `${normalizedEndpoint}/chat/completions`;
    }
    return `${normalizedEndpoint}/v1/chat/completions`;
  }

  private generateTraceId(): string {
    return `gw-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
