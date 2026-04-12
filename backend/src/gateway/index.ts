/**
 * EduClaw Gateway - 主入口
 * 
 * 统一入口，负责调度、状态管理
 * 包含事件总线、注册表、AI统一入口
 */

import { PrismaClient } from '@prisma/client';
import { EventBus, createEventBus } from './event-bus';
import { AgentRegistry } from './registries/agent-registry';
import { SkillRegistry } from './registries/skill-registry';
import { SignalRegistry } from './registries/signal-registry';
import { StrategyRegistry } from './registries/strategy-registry';
import { OpenAIClient, getOpenAIClient, runWithContext } from './openai-client';
import {
  AgentInput,
  AgentOutput,
  AgentContext,
  AgentExecutionRequest,
  AgentExecutionResult,
  LearningSignal
} from '../agents/protocol';
import { LearningEvent } from './event-bus';

// Gateway 配置
export interface GatewayConfig {
  ai: {
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    defaultReasoningModel?: string;
  };
  eventBus: {
    persistEvents: boolean;
  };
}

// 默认配置
const DEFAULT_CONFIG: GatewayConfig = {
  ai: {
    baseUrl: process.env.AI_API_URL || 'http://localhost:3000',
    apiKey: process.env.AI_API_KEY || '',
    defaultModel: process.env.AI_MODEL || 'glm-4-flash',
    defaultReasoningModel: process.env.AI_MODEL_REASONING || 'deepseek-think',
  },
  eventBus: {
    persistEvents: true,
  }
};

/**
 * EduClaw Gateway 实现
 */
export class EduClawGateway {
  private prisma: PrismaClient;
  private eventBus: EventBus;
  private agentRegistry: AgentRegistry;
  private skillRegistry: SkillRegistry;
  private signalRegistry: SignalRegistry;
  private strategyRegistry: StrategyRegistry;
  private openaiClient: OpenAIClient;
  private config: GatewayConfig;

  constructor(prisma: PrismaClient, config: Partial<GatewayConfig> = {}) {
    this.prisma = prisma;
    // 深合并 ai 配置，避免浅合并丢失 defaultReasoningModel
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      ai: {
        ...DEFAULT_CONFIG.ai,
        ...config.ai,
      }
    };

    // 初始化组件
    this.eventBus = createEventBus(prisma, this.config.eventBus);
    this.agentRegistry = new AgentRegistry(prisma);
    this.skillRegistry = new SkillRegistry(prisma);
    this.signalRegistry = new SignalRegistry();
    this.strategyRegistry = new StrategyRegistry();
    // 使用已初始化的客户端（从数据库读取配置），而不是创建新客户端
    this.openaiClient = getOpenAIClient();

    // 设置事件监听
    this.setupEventListeners();
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    // 监听学习信号事件
    const signalEvents = [
      'learning:speed:change',
      'learning:focus:shift',
      'learning:fatigue:high',
      'learning:struggle',
      'learning:mastery'
    ];

    signalEvents.forEach(eventType => {
      this.eventBus.on(eventType as any, async (event: LearningEvent) => {
        try {
          await this.handleSignalEvent(event);
        } catch (error) {
          console.error(`[Gateway] Error handling signal event ${eventType}:`, error);
          // 错误边界：不抛出异常，避免影响主流程
        }
      });
    });
  }

  /**
   * 处理信号事件
   */
  private async handleSignalEvent(event: LearningEvent): Promise<void> {
    // 查找订阅了此事件的 Agent
    const agents = this.agentRegistry.getAll().filter(
      reg => reg.definition.subscribes.includes(event.type)
    );

    // 通知相关 Agent
    for (const agent of agents) {
      if (agent.handler) {
        try {
          // 这里可以触发 Agent 的重新规划逻辑
          console.log(`Notifying agent ${agent.definition.name} of event ${event.type}`);
        } catch (error) {
          console.error(`Error notifying agent ${agent.definition.name}:`, error);
        }
      }
    }
  }

  // ============ Agent 相关方法 ============

  /**
   * 注册 Agent
   */
  async registerAgent(
    definition: any,
    handler?: (input: AgentInput, context: AgentContext) => Promise<AgentOutput>
  ): Promise<string> {
    return this.agentRegistry.register(definition, handler);
  }

  /**
   * 匹配 Agent
   */
  matchAgents(rule: any): any[] {
    return this.agentRegistry.match(rule);
  }

  /**
   * 获取 Agent
   */
  getAgent(agentId: string): any {
    return this.agentRegistry.get(agentId);
  }

  /**
   * 执行 Agent（带2分钟超时控制）
   */
  async executeAgent(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const registration = this.agentRegistry.get(request.agentId);

    if (!registration) {
      return {
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent ${request.agentId} not found`
        },
        duration: Date.now() - startTime
      };
    }

    try {
      if (!registration.handler) {
        throw new Error('Agent has no handler');
      }

      // 发布 Agent 调用事件
      await this.eventBus.emit({
        type: 'agent:called',
        source: 'gateway',
        userId: request.context.userId,
        data: { agentId: request.agentId, input: request.input }
      });

      // 执行 Agent（带超时控制）
      const TIMEOUT_MS = 5 * 60 * 1000; // 5分钟超时（Content Agent 需要多个 AI 调用）
      
      // 设置请求上下文，使所有 AI 调用自动记录到 AgentCallLog
      const output = await Promise.race([
        runWithContext({
          userId: request.context.userId,
          agentId: request.agentId,
          action: 'execute'
        }, () => registration.handler(request.input, request.context)),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Agent execution timeout after ${TIMEOUT_MS}ms`));
          }, TIMEOUT_MS);
        })
      ]);
      
      const duration = Date.now() - startTime;

      // 更新统计
      await this.agentRegistry.updateStats(request.agentId, true, duration);

      // 发布完成事件
      await this.eventBus.emit({
        type: 'agent:completed',
        source: request.agentId,
        userId: request.context.userId,
        data: { output, duration }
      });

      return {
        success: true,
        output,
        duration,
        tokensUsed: output.metadata ? undefined : undefined // TODO: 从 AI 响应中提取
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 更新统计
      await this.agentRegistry.updateStats(request.agentId, false, duration);

      // 发布错误事件
      await this.eventBus.emit({
        type: 'agent:error',
        source: request.agentId,
        userId: request.context.userId,
        data: { error: error instanceof Error ? error.message : String(error) }
      });

      // 判断是否是超时错误
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      
      return {
        success: false,
        error: {
          code: isTimeout ? 'AGENT_TIMEOUT' : 'AGENT_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        duration
      };
    }
  }

  // ============ Skill 相关方法 ============

  /**
   * 注册 Skill
   */
  async registerSkill(definition: any, handler?: (input: any) => Promise<any>): Promise<string> {
    return this.skillRegistry.register(definition, handler);
  }

  /**
   * 获取 Skill
   */
  getSkill(skillName: string): any {
    return this.skillRegistry.get(skillName);
  }

  /**
   * 匹配 Skill
   */
  matchSkills(rule: any): any[] {
    return this.skillRegistry.match(rule);
  }

  /**
   * 执行 Skill
   */
  async executeSkill(skillName: string, input: any): Promise<any> {
    const startTime = Date.now();
    const registration = this.skillRegistry.get(skillName);

    if (!registration) {
      throw new Error(`Skill ${skillName} not found`);
    }

    try {
      if (!registration.handler) {
        throw new Error('Skill has no handler');
      }

      const output = await registration.handler(input);
      const duration = Date.now() - startTime;

      await this.skillRegistry.updateStats(skillName, true, duration);

      return {
        success: true,
        output,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.skillRegistry.updateStats(skillName, false, duration);
      throw error;
    }
  }

  // ============ Signal 相关方法 ============

  /**
   * 注册信号检测器
   */
  registerSignalDetector(detector: any): void {
    this.signalRegistry.register(detector);
  }

  /**
   * 检测信号
   */
  async detectSignals(data: any): Promise<LearningSignal[]> {
    return this.signalRegistry.detect(data);
  }

  // ============ Strategy 相关方法 ============

  /**
   * 注册策略
   */
  registerStrategy(strategy: any): void {
    this.strategyRegistry.register(strategy);
  }

  /**
   * 应用策略
   */
  async applyStrategy(signals: LearningSignal[], context: any): Promise<any> {
    const matchedStrategies = this.strategyRegistry.match(signals, context);
    
    if (matchedStrategies.length === 0) {
      return { applied: false, message: 'No matching strategy found' };
    }

    // 执行优先级最高的策略
    const results = [];
    for (const strategy of matchedStrategies) {
      const result = await this.strategyRegistry.execute(strategy, context);
      results.push({ strategy: strategy.name, result });
    }

    return { applied: true, results };
  }

  // ============ Event 相关方法 ============

  /**
   * 发布事件
   */
  async emitEvent(event: LearningEvent): Promise<void> {
    return this.eventBus.emit(event);
  }

  /**
   * 订阅事件
   */
  onEvent(eventType: string, handler: (event: LearningEvent) => void): void {
    this.eventBus.on(eventType as any, handler);
  }

  /**
   * 获取事件历史
   */
  async getEventHistory(options: any): Promise<LearningEvent[]> {
    return this.eventBus.getHistory(options);
  }

  // ============ AI 相关方法 ============

  /**
   * 获取 OpenAI 客户端
   */
  getAIClient(): OpenAIClient {
    return this.openaiClient;
  }

  /**
   * AI 聊天
   */
  async chat(messages: any[], options?: any): Promise<string> {
    const response = await this.openaiClient.chatCompletion({
      messages,
      ...options
    });
    return response.choices[0]?.message.content || '';
  }

  // ============ 初始化方法 ============

  /**
   * 从数据库加载注册
   */
  async loadRegistrations(): Promise<void> {
    await this.agentRegistry.loadFromDatabase();
    await this.skillRegistry.loadFromDatabase();
  }

  /**
   * 关闭 Gateway
   */
  async close(): Promise<void> {
    await this.eventBus.close();
  }
}

// ============ 单例管理 ============

let gatewayInstance: EduClawGateway | null = null;

/**
 * 创建 Gateway 实例
 */
export function createGateway(prisma: PrismaClient, config?: Partial<GatewayConfig>): EduClawGateway {
  if (!gatewayInstance) {
    gatewayInstance = new EduClawGateway(prisma, config);
  }
  return gatewayInstance;
}

/**
 * 获取 Gateway 实例
 */
export function getGateway(): EduClawGateway {
  if (!gatewayInstance) {
    throw new Error('Gateway not initialized. Call createGateway first.');
  }
  return gatewayInstance;
}

// 导出所有组件
export { EventBus } from './event-bus';
export { AgentRegistry } from './registries/agent-registry';
export { SkillRegistry } from './registries/skill-registry';
export { SignalRegistry } from './registries/signal-registry';
export { StrategyRegistry } from './registries/strategy-registry';
export { OpenAIClient } from './openai-client';
