/**
 * OpenAI 统一客户端 - EduClaw Gateway
 * 
 * 统一 AI 调用入口，兼容 OpenAI API 格式
 * 对接 NewAPI 服务
 * 
 * 特性：
 * - 指数退避重试机制
 * - 备用模型/端点支持
 * - 请求队列管理（避免并发过载）
 * - 动态超时设置
 */

import OpenAI from 'openai';
import prisma from '../config/database';

interface UserProviderConfig {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
  reasoningModel?: string;
}

// 全局请求上下文（用于传递 userId 和 agentId）
export interface RequestContext {
  userId?: string;
  agentId?: string;
  action?: string;
  skillId?: string;
  // 新增 ACP 字段
  sourceEntry?: 'lab' | 'platform' | 'arena' | 'test';
  traceId?: string;
  callerAgent?: string;
  userRole?: 'admin' | 'user' | 'tester' | 'viewer';
}

// 使用 AsyncLocalStorage 来传递请求上下文
import { AsyncLocalStorage } from 'async_hooks';
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// 设置请求上下文
export function setRequestContext(context: RequestContext): void {
  const store = requestContextStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

// 获取请求上下文
export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() || {};
}

// 在上下文中执行函数
export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(context, fn);
}

// OpenAI 消息格式
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// OpenAI 请求参数
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  // 自定义超时（毫秒）
  timeout?: number;
}

// OpenAI 响应
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// OpenAI 流式响应
export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

// 客户端配置
export interface OpenAIClientConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultReasoningModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  // 备用模型列表（当主模型不可用时切换）
  fallbackModels?: string[];
  // 备用端点（当主端点不可用时切换）
  fallbackEndpoints?: Array<{ baseUrl: string; apiKey: string }>;
  // 最大并发请求数
  maxConcurrent?: number;
  // 请求队列延迟（毫秒）
  queueDelay?: number;
}

const userProviderCache = new Map<string, { config: UserProviderConfig | null; expiresAt: number }>();

export function clearUserProviderCache(userId?: string): void {
  if (userId) {
    userProviderCache.delete(userId);
    return;
  }

  userProviderCache.clear();
}

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function getUserProviderConfig(userId?: string): Promise<UserProviderConfig | null> {
  if (!userId) {
    return null;
  }

  const cached = userProviderCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const userConfig = await prisma.user_api_configs.findUnique({
    where: { userId },
    select: {
      endpoint: true,
      apiKey: true,
      chatModel: true,
      reasoningModel: true,
      enabled: true,
    }
  });

  // 未配置或未启用，使用平台默认
  if (!userConfig || !userConfig.enabled || !userConfig.endpoint || !userConfig.apiKey) {
    userProviderCache.set(userId, { config: null, expiresAt: Date.now() + 60_000 });
    return null;
  }

  const resolved: UserProviderConfig = {
    providerId: 'user-config',
    providerName: '用户自定义',
    baseUrl: normalizeOpenAIBaseUrl(userConfig.endpoint),
    apiKey: userConfig.apiKey,
    defaultModel: userConfig.chatModel || 'deepseek-chat',
    reasoningModel: userConfig.reasoningModel || userConfig.chatModel || 'deepseek-think',
  };

  userProviderCache.set(userId, { config: resolved, expiresAt: Date.now() + 60_000 });
  return resolved;
}

// 默认配置
const DEFAULT_CONFIG: Partial<OpenAIClientConfig> = {
  defaultTemperature: 0.7,
  defaultMaxTokens: 2048,
  timeout: 300000, // 默认 5 分钟（复杂路径生成需要更长时间）
  maxRetries: 5, // API站点不稳定，增加重试次数
  fallbackModels: [],
  fallbackEndpoints: [],
  maxConcurrent: 5,
  queueDelay: 100,
};

// 错误类型枚举
enum ErrorType {
  NETWORK_ERROR,      // 网络错误，可重试
  TIMEOUT_ERROR,      // 超时错误，可重试
  RATE_LIMIT,         // 速率限制，可重试（需要等待）
  SERVER_ERROR,       // 服务器错误（5xx），可重试
  AUTH_ERROR,         // 认证错误，不可重试
  INVALID_REQUEST,    // 无效请求，不可重试
  MODEL_NOT_FOUND,    // 模型不存在，尝试备用模型
  INSUFFICIENT_BALANCE, // 余额不足（API站点不稳定，可重试）
  UNKNOWN,            // 未知错误（API站点不稳定，可重试）
}

// 解析错误类型
function parseErrorType(error: Error): ErrorType {
  const message = error.message.toLowerCase();
  
  if (message.includes('abort') || message.includes('timeout') || message.includes('etimedout')) {
    return ErrorType.TIMEOUT_ERROR;
  }
  if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
    return ErrorType.NETWORK_ERROR;
  }
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many')) {
    return ErrorType.RATE_LIMIT;
  }
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return ErrorType.SERVER_ERROR;
  }
  if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key')) {
    return ErrorType.AUTH_ERROR;
  }
  if (message.includes('insufficient balance') || message.includes('余额不足')) {
    return ErrorType.INSUFFICIENT_BALANCE;
  }
  if (message.includes('model') && (message.includes('not found') || message.includes('unavailable'))) {
    return ErrorType.MODEL_NOT_FOUND;
  }
  // API站点不稳定，UNKNOWN也视为可重试
  return ErrorType.UNKNOWN;
}

// 判断错误是否可重试（API站点不稳定，大多数错误都可重试）
function isRetryableError(errorType: ErrorType): boolean {
  // 只有认证错误和明确的无效请求不重试
  const nonRetryable = [ErrorType.AUTH_ERROR];
  return !nonRetryable.includes(errorType);
}

// 计算重试延迟（指数退避）
function calculateRetryDelay(attempt: number, errorType: ErrorType): number {
  const baseDelay = 1000; // 1 秒
  const maxDelay = 60000; // 60 秒最大延迟
  
  // 速率限制和余额不足错误使用更长延迟
  if (errorType === ErrorType.RATE_LIMIT || errorType === ErrorType.INSUFFICIENT_BALANCE) {
    return Math.min(baseDelay * Math.pow(3, attempt), maxDelay);
  }
  
  // 指数退避 + 随机抖动
  const delay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * delay; // 30% 随机抖动
  
  return Math.min(delay + jitter, maxDelay);
}

// 请求队列管理器
class RequestQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private maxConcurrent: number;
  private queueDelay: number;

  constructor(maxConcurrent: number, queueDelay: number) {
    this.maxConcurrent = maxConcurrent;
    this.queueDelay = queueDelay;
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (task) {
      // 添加队列延迟，避免突发请求
      setTimeout(() => task(), this.queueDelay);
    }
  }

  getStats() {
    return {
      pending: this.queue.length,
      running: this.running,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

/**
 * OpenAI 客户端实现
 */
export class OpenAIClient {
  private config: OpenAIClientConfig;
  private callLog: Array<{
    request: ChatCompletionRequest;
    response?: ChatCompletionResponse;
    error?: string;
    duration: number;
    timestamp: Date;
  }> = [];
  private requestQueue: RequestQueue;
  private currentEndpointIndex = 0;

  constructor(config: Partial<OpenAIClientConfig> & { baseUrl: string; apiKey: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as OpenAIClientConfig;
    this.requestQueue = new RequestQueue(
      this.config.maxConcurrent || 5,
      this.config.queueDelay || 100
    );
  }

  /**
   * 发送聊天完成请求
   */
  async chatCompletion(request: Partial<ChatCompletionRequest>): Promise<ChatCompletionResponse> {
    return this.requestQueue.enqueue(() => this.executeWithRetry(request));
  }

/**
    * 带重试的执行请求
    */
  private async executeWithRetry(request: Partial<ChatCompletionRequest>): Promise<ChatCompletionResponse> {
    const providerConfig = await getUserProviderConfig(getRequestContext().userId);
    const activeBaseUrl = providerConfig?.baseUrl || this.config.baseUrl;
    const activeApiKey = providerConfig?.apiKey || this.config.apiKey;
    const activeDefaultModel = providerConfig?.defaultModel || this.config.defaultModel;
    const activeReasoningModel = providerConfig?.reasoningModel || this.config.defaultReasoningModel || activeDefaultModel;
    const activeFallbackEndpoints = providerConfig ? [] : (this.config.fallbackEndpoints || []);

    // 根据 agentId/skillId 选择模型
    const context = getRequestContext();
    
    // Skills 默认用 chat 模型（高频调用，性价比优先）
    const useReasoningModel = !context.skillId && (
      context.agentId === 'path-agent' || 
      context.action?.includes('generateLearningPath') ||
      context.action?.includes('analyzeLearningGoal')
    );
    const selectedModel = useReasoningModel ? activeReasoningModel : activeDefaultModel;

    const fullRequest: ChatCompletionRequest = {
      model: request.model || selectedModel,
      messages: request.messages || [],
      temperature: request.temperature ?? this.config.defaultTemperature,
      max_tokens: request.max_tokens ?? this.config.defaultMaxTokens,
      top_p: request.top_p,
      frequency_penalty: request.frequency_penalty,
      presence_penalty: request.presence_penalty,
      stop: request.stop,
      stream: false,
    };

    const startTime = Date.now();
    let lastError: Error | null = null;
    const currentModel = fullRequest.model;
    const triedModels = new Set<string>();
    const triedEndpoints = new Set<number>();

    // 尝试所有模型和端点组合
    const allModels = [currentModel, ...(this.config.fallbackModels || [])];
    const allEndpoints = activeFallbackEndpoints.length > 0
      ? [null, ...activeFallbackEndpoints.map((_, i) => i)]
      : [null];

    for (const endpointIdx of allEndpoints) {
      for (const model of allModels) {
        if (triedModels.has(model) && endpointIdx === null) continue;
        if (endpointIdx !== null && triedEndpoints.has(endpointIdx)) continue;

        triedModels.add(model);
        if (endpointIdx !== null) triedEndpoints.add(endpointIdx);

        const endpoint = endpointIdx !== null 
          ? activeFallbackEndpoints[endpointIdx]
          : { baseUrl: activeBaseUrl, apiKey: activeApiKey };

        // 对每个模型/端点组合尝试重试
        for (let attempt = 0; attempt < (this.config.maxRetries || 1); attempt++) {
          try {
            const response = await this.makeRequest(fullRequest, endpoint, model);

            // 记录成功调用
            await this.logCall(fullRequest, response, Date.now() - startTime, undefined, providerConfig);

            return response;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const errorType = parseErrorType(lastError);

            // 不可重试的错误，直接跳出
            if (!isRetryableError(errorType)) {
              console.error(`[OpenAIClient] 不可重试错误 (${ErrorType[errorType]}):`, lastError.message);
              break;
            }

            // 模型不存在，切换到下一个模型
            if (errorType === ErrorType.MODEL_NOT_FOUND) {
              console.warn(`[OpenAIClient] 模型 ${model} 不可用，尝试备用模型`);
              break;
            }

            // 计算重试延迟
            const delay = calculateRetryDelay(attempt, errorType);
            console.warn(`[OpenAIClient] 请求失败 (${ErrorType[errorType]})，${Math.round(delay)}ms 后重试 (尝试 ${attempt + 1}/${this.config.maxRetries})`);

            // 等待后重试
            if (attempt < (this.config.maxRetries || 1) - 1) {
              await this.sleep(delay);
            }
          }
        }
      }
    }

    // 所有尝试都失败
    await this.logCall(fullRequest, undefined, Date.now() - startTime, lastError?.message, providerConfig);
    throw lastError || new Error('All retry attempts exhausted');
  }

  /**
   * 流式聊天完成
   */
  async *streamChatCompletion(
    request: Partial<ChatCompletionRequest>
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const fullRequest: ChatCompletionRequest = {
      model: request.model || this.config.defaultModel,
      messages: request.messages || [],
      temperature: request.temperature ?? this.config.defaultTemperature,
      max_tokens: request.max_tokens ?? this.config.defaultMaxTokens,
      stream: true,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(fullRequest),
    });

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is null');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // 处理 SSE 格式
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            const chunk: ChatCompletionChunk = JSON.parse(data);
            yield chunk;
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  }

  /**
   * 发送 HTTP 请求
   */
  private async makeRequest(
    request: ChatCompletionRequest,
    endpoint: { baseUrl: string; apiKey: string },
    model: string
  ): Promise<ChatCompletionResponse> {
    // 动态超时：根据请求复杂度调整
    const timeout = request.timeout || this.config.timeout || 120000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({ ...request, model }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }

      const data: unknown = await response.json();
      
      // 验证响应结构
      const responseData = data as Record<string, unknown>;
      if (!responseData.choices || !Array.isArray(responseData.choices) || responseData.choices.length === 0) {
        const responseStr = JSON.stringify(data);
        console.error('[OpenAIClient] 无效响应结构:', responseStr.substring(0, 500));
        throw new Error(`Invalid API response: missing choices array. Response: ${responseStr.substring(0, 200)}`);
      }
      
      return data as ChatCompletionResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 记录调用日志
   */
  private async logCall(
    request: ChatCompletionRequest,
    response?: ChatCompletionResponse,
    duration?: number,
    error?: string,
    providerConfig?: UserProviderConfig | null
  ): Promise<void> {
    // 记录到内存
    this.callLog.push({
      request,
      response,
      error,
      duration: duration || 0,
      timestamp: new Date(),
    });

    // 保持最近 1000 条记录
    if (this.callLog.length > 1000) {
      this.callLog.shift();
    }

    // 记录到数据库（AgentCallLog 表）
    try {
      const context = getRequestContext();
      // 只有在有 userId 时才记录到数据库
      if (context.userId) {
        const agentId = context.agentId || context.action || 'system-call';
        
        await prisma.agent_call_logs.create({
          data: {
            id: Date.now().toString(),
            agentId,
            userId: context.userId,
            // 新增 ACP 字段
            sourceEntry: context.sourceEntry || 'platform',
            traceId: context.traceId,
            callerAgent: context.callerAgent,
            userRole: context.userRole || 'user',
            input: JSON.stringify(request.messages),
            output: response ? JSON.stringify({ content: response.choices[0]?.message?.content }) : null,
            success: !error,
            durationMs: duration || 0,
            tokensUsed: response?.usage?.total_tokens,
            error: error,
            calledAt: new Date(),
            metadata: JSON.stringify({
              action: context.action,
              model: request.model,
              temperature: request.temperature,
              providerId: providerConfig?.providerId || 'platform-default',
              providerName: providerConfig?.providerName || 'platform-default',
              providerBaseUrl: providerConfig?.baseUrl || this.config.baseUrl,
              usesUserProvider: !!providerConfig
            })
          }
        });
      }
    } catch (logError) {
      // 数据库记录失败不应影响主流程
      console.error('[OpenAIClient] 记录 AgentCallLog 失败:', logError);
    }
  }

  /**
   * 获取调用日志
   */
  getCallLog(limit: number = 100): typeof this.callLog {
    return this.callLog.slice(-limit);
  }

  /**
   * 获取使用统计
   */
  getUsageStats(): {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalTokens: number;
    avgLatency: number;
    queueStats: ReturnType<RequestQueue['getStats']>;
  } {
    const totalCalls = this.callLog.length;
    const successfulCalls = this.callLog.filter(log => log.response).length;
    const failedCalls = totalCalls - successfulCalls;
    const totalTokens = this.callLog.reduce(
      (sum, log) => sum + (log.response?.usage.total_tokens || 0),
      0
    );
    const avgLatency = this.callLog.reduce((sum, log) => sum + log.duration, 0) / totalCalls || 0;

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      totalTokens,
      avgLatency,
      queueStats: this.requestQueue.getStats(),
    };
  }

  /**
   * 工具方法：睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ 便捷函数 ============

let defaultClient: OpenAIClient | null = null;

// 客户端缓存（支持多配置）
const clientCache: Map<string, OpenAIClient> = new Map();

/**
 * 生成客户端缓存键
 */
function getClientCacheKey(config: Partial<OpenAIClientConfig> & { baseUrl: string; apiKey: string }): string {
  return `${config.baseUrl}:${config.apiKey}:${config.defaultModel || 'default'}`;
}

/**
 * 获取平台 API 配置（从数据库读取）
 */
async function getPlatformAPIConfig(): Promise<{
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultReasoningModel: string;
}> {
  try {
    const platformConfig = await prisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
    });

    if (platformConfig && platformConfig.apiUrl && platformConfig.apiKey) {
      return {
        baseUrl: normalizeOpenAIBaseUrl(platformConfig.apiUrl),
        apiKey: platformConfig.apiKey,
        defaultModel: platformConfig.defaultModel || 'deepseek-chat',
        defaultReasoningModel: platformConfig.defaultReasoningModel || platformConfig.defaultModel || 'deepseek-reasoner',
      };
    }
  } catch (error) {
    console.error('[OpenAIClient] 获取平台配置失败:', error);
  }

  // 回退到环境变量（用于初始化或备用）
  return {
    baseUrl: normalizeOpenAIBaseUrl(process.env.AI_API_URL || 'http://localhost:3000'),
    apiKey: process.env.AI_API_KEY || '',
    defaultModel: process.env.AI_MODEL || 'deepseek-chat',
    defaultReasoningModel: process.env.AI_MODEL_REASONING || 'deepseek-reasoner',
  };
}

// 配置缓存时间戳（用于检测配置是否过期）
let lastConfigCheckTime = 0;
const CONFIG_CACHE_DURATION = 30_000; // 30秒缓存

/**
 * 获取默认客户端（异步版本，从数据库读取配置）
 */
export async function getOpenAIClientAsync(): Promise<OpenAIClient> {
  const now = Date.now();
  
  // 如果客户端存在且配置缓存未过期，直接返回
  if (defaultClient && now - lastConfigCheckTime < CONFIG_CACHE_DURATION) {
    return defaultClient;
  }

  // 从数据库获取平台配置
  const platformConfig = await getPlatformAPIConfig();
  
  const config: OpenAIClientConfig = {
    baseUrl: platformConfig.baseUrl,
    apiKey: platformConfig.apiKey,
    defaultModel: platformConfig.defaultModel,
    defaultReasoningModel: platformConfig.defaultReasoningModel,
    fallbackModels: process.env.AI_FALLBACK_MODELS?.split(',').filter(Boolean) || [],
  };

  // 创建新客户端（或更新配置）
  defaultClient = new OpenAIClient(config);
  lastConfigCheckTime = now;
  
  return defaultClient;
}

/**
 * 获取默认客户端（同步版本）
 * 注意：此方法返回已初始化的客户端，如果未初始化则使用环境变量配置
 */
export function getOpenAIClient(): OpenAIClient {
  if (!defaultClient) {
    // 如果客户端未初始化，使用环境变量配置作为临时方案
    // 服务启动时应该调用 initializeOpenAIClientFromDatabase() 来从数据库读取配置
    console.warn('[OpenAIClient] 客户端未初始化，使用环境变量配置。请在服务启动时调用 initializeOpenAIClientFromDatabase()');
    const config: OpenAIClientConfig = {
      baseUrl: normalizeOpenAIBaseUrl(process.env.AI_API_URL || 'http://localhost:3000'),
      apiKey: process.env.AI_API_KEY || '',
      defaultModel: process.env.AI_MODEL || 'glm-4-flash',
      defaultReasoningModel: process.env.AI_MODEL_REASONING || 'deepseek-think',
      fallbackModels: process.env.AI_FALLBACK_MODELS?.split(',').filter(Boolean) || [],
    };
    defaultClient = new OpenAIClient(config);
  }
  return defaultClient;
}

/**
 * 从数据库初始化 OpenAI 客户端
 * 应在服务启动时调用
 * 
 * 流程：
 * 1. 检查数据库是否有配置
 * 2. 如果没有，从 .env 读取并写入数据库作为初始值
 * 3. 从数据库读取配置创建客户端
 */
export async function initializeOpenAIClientFromDatabase(): Promise<OpenAIClient> {
  console.log('[OpenAIClient] 正在初始化客户端...');
  
  try {
    // 检查数据库是否有配置
    const existingConfig = await prisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
    });

    if (!existingConfig || !existingConfig.apiKey) {
      // 数据库没有配置，从 .env 读取作为初始值
      const envApiUrl = process.env.AI_API_URL;
      const envApiKey = process.env.AI_API_KEY;
      const envModel = process.env.AI_MODEL;
      const envReasoningModel = process.env.AI_MODEL_REASONING;

      if (envApiUrl && envApiKey) {
        // .env 有配置，写入数据库作为初始值
        console.log('[OpenAIClient] 数据库无配置，从 .env 初始化...');
        
        await prisma.platform_api_configs.upsert({
          where: { id: 'platform' },
          update: {},
          create: {
            id: 'platform',
            apiUrl: envApiUrl,
            apiKey: envApiKey,
            defaultModel: envModel || 'deepseek-chat',
            defaultReasoningModel: envReasoningModel || 'deepseek-reasoner',
            defaultEvaluationModel: envReasoningModel || 'deepseek-reasoner',
            connectionStatus: 'pending',
          },
        });

        console.log('[OpenAIClient] .env 配置已写入数据库:', {
          apiUrl: envApiUrl,
          hasApiKey: !!envApiKey,
          defaultModel: envModel || 'deepseek-chat',
        });
      } else {
        console.log('[OpenAIClient] .env 无有效配置，等待 Admin 后台配置');
      }
    } else {
      console.log('[OpenAIClient] 数据库已有配置，使用数据库配置');
    }

    // 从数据库读取最终配置
    const platformConfig = await getPlatformAPIConfig();

    const config: OpenAIClientConfig = {
      baseUrl: platformConfig.baseUrl,
      apiKey: platformConfig.apiKey,
      defaultModel: platformConfig.defaultModel,
      defaultReasoningModel: platformConfig.defaultReasoningModel,
      fallbackModels: process.env.AI_FALLBACK_MODELS?.split(',').filter(Boolean) || [],
    };

    defaultClient = new OpenAIClient(config);
    lastConfigCheckTime = Date.now();

    console.log('[OpenAIClient] 客户端初始化完成:', {
      baseUrl: config.baseUrl,
      hasApiKey: !!config.apiKey,
      apiKeyPrefix: config.apiKey?.substring(0, 15),
      defaultModel: config.defaultModel,
    });

    return defaultClient;
  } catch (error) {
    console.error('[OpenAIClient] 初始化失败:', error);
    
    // 回退到环境变量
    const fallbackConfig: OpenAIClientConfig = {
      baseUrl: normalizeOpenAIBaseUrl(process.env.AI_API_URL || 'http://localhost:3000'),
      apiKey: process.env.AI_API_KEY || '',
      defaultModel: process.env.AI_MODEL || 'glm-4-flash',
      defaultReasoningModel: process.env.AI_MODEL_REASONING || 'deepseek-think',
      fallbackModels: process.env.AI_FALLBACK_MODELS?.split(',').filter(Boolean) || [],
    };

    defaultClient = new OpenAIClient(fallbackConfig);
    lastConfigCheckTime = Date.now();

    console.log('[OpenAIClient] 使用环境变量回退配置:', {
      baseUrl: fallbackConfig.baseUrl,
      hasApiKey: !!fallbackConfig.apiKey,
    });

    return defaultClient;
  }
}

/**
 * 刷新客户端配置（强制从数据库重新读取）
 */
export async function refreshOpenAIClient(): Promise<OpenAIClient> {
  lastConfigCheckTime = 0; // 清除缓存
  return initializeOpenAIClientFromDatabase();
}

/**
 * 获取或创建客户端（支持多配置，带缓存）
 * 用于需要使用不同 API 配置的场景（如课程设计专用模型）
 */
export function getOrCreateClient(config: Partial<OpenAIClientConfig> & { baseUrl: string; apiKey: string }): OpenAIClient {
  const key = getClientCacheKey(config);
  
  if (!clientCache.has(key)) {
    clientCache.set(key, new OpenAIClient(config));
  }
  
  return clientCache.get(key)!;
}

/**
 * 初始化客户端
 */
export function initOpenAIClient(config: Partial<OpenAIClientConfig> & { baseUrl: string; apiKey: string }): OpenAIClient {
  defaultClient = new OpenAIClient(config);
  return defaultClient;
}

/**
 * 快速聊天完成（使用数据库配置）
 */
export async function quickChat(
  messages: ChatMessage[],
  options?: Partial<ChatCompletionRequest>
): Promise<string> {
  const client = await getOpenAIClientAsync();
  const response = await client.chatCompletion({ messages, ...options });
  return response.choices[0]?.message.content || '';
}

/**
 * 系统提示 + 用户消息（使用数据库配置）
 */
export async function chatWithSystem(
  systemPrompt: string,
  userMessage: string,
  options?: Partial<ChatCompletionRequest>
): Promise<string> {
  return quickChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    options
  );
}

// ============ 官方 OpenAI SDK 客户端缓存 ============
// 用于需要使用官方 SDK 接口的场景（如 courseDesignClient）

const openAISDKCache: Map<string, OpenAI> = new Map();

/**
 * 获取或创建官方 OpenAI SDK 客户端（带缓存）
 * 用于需要使用官方 SDK 接口 (chat.completions.create) 的场景
 */
export function getOrCreateOpenAISDK(config: {
  baseUrl: string;
  apiKey: string;
}): OpenAI {
  const normalizedBaseUrl = normalizeOpenAIBaseUrl(config.baseUrl);
  const key = `${normalizedBaseUrl}:${config.apiKey}`;
  
  if (!openAISDKCache.has(key)) {
    openAISDKCache.set(key, new OpenAI({
      baseURL: `${normalizedBaseUrl}/v1`,
      apiKey: config.apiKey,
    }));
  }
  
  return openAISDKCache.get(key)!;
}

export async function getOpenAISDKForCurrentUser(config: {
  baseUrl: string;
  apiKey: string;
}): Promise<OpenAI> {
  const providerConfig = await getUserProviderConfig(getRequestContext().userId);

  if (providerConfig) {
    return getOrCreateOpenAISDK({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey
    });
  }

  return getOrCreateOpenAISDK(config);
}
