/**
 * EduClaw Gateway - 主入口
 * 
 * 统一入口，负责调度、状态管理
 * 包含事件总线、注册表、AI统一入口
 */

import { PrismaClient } from '@prisma/client';
import systemPrisma from '../config/system-database';
import { EventBus, createEventBus } from './event-bus';
import { AgentRegistry } from './registries/agent-registry';
import { SkillRegistry } from './registries/skill-registry';
import { getAPIGateway } from './api-gateway';
import { getRequestContext, runWithContext } from './api-gateway/context';
import { logger } from '../utils/logger';
import {
  AgentInput,
  AgentOutput,
  AgentContext,
  AgentExecutionRequest,
  AgentExecutionResult
} from '../agents/protocol';
import { LearningEvent } from './event-bus';
import { normalizeAgentOutput } from '../agents/output-normalizer';
import { executeSkillHandler } from '../skills/executor';
import { agentPluginRegistry } from '../agents/plugin-registry';
import { mcpGateway } from '../core/mcp/McpGateway';

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
    defaultModel: process.env.AI_MODEL || '',
    defaultReasoningModel: process.env.AI_MODEL_REASONING || '',
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
    this.agentRegistry = new AgentRegistry(systemPrisma as any);
    this.skillRegistry = new SkillRegistry(systemPrisma as any);
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
  async executeSkill(skillName: string, input: any, options?: import('../skills/protocol').SkillExecutionOptions): Promise<any> {
    const registration = this.skillRegistry.get(skillName);

    if (!registration) {
      throw new Error(`Skill ${skillName} not found`);
    }

    if (!registration.handler) {
      throw new Error('Skill has no handler');
    }

    try {
      const result = options
        ? await executeSkillHandler(registration.definition, input, registration.handler, options)
        : await executeSkillHandler(registration.definition, input, registration.handler);
      this.skillRegistry.recordExecution(skillName, true, result.duration);
      return result;
    } catch (error: any) {
      this.skillRegistry.recordExecution(skillName, false, error?.skillDurationMs || 0);
      throw error;
    }
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
   * AI 聊天（通过 APIGateway）
   */
  async chat(messages: any[], options?: { temperature?: number; maxTokens?: number; agentId?: string; userId?: string }): Promise<string> {
    const gateway = getAPIGateway();
    const caller = {
      agentId: options?.agentId || 'gateway',
      userId: options?.userId
    };
    const response = await gateway.execute(
      { messages, temperature: options?.temperature, max_tokens: options?.maxTokens },
      caller,
      {
        userId: options?.userId,
        callerAgent: options?.agentId || 'gateway',
        requestPath: '/gateway/chat'
      }
    );
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
    await agentPluginRegistry.clear();
    mcpGateway.destroy();
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
export { getAPIGateway, APIGateway } from './api-gateway';
