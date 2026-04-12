/**
 * Agent 注册表 - EduClaw Gateway
 * 
 * 发现和管理可用 Agent
 */

import { PrismaClient } from '@prisma/client';
import {
  AgentDefinition,
  AgentType,
  AgentCategory,
  AgentInput,
  AgentOutput,
  AgentContext,
  AgentExecutionRequest,
  AgentExecutionResult
} from '../../agents/protocol';

// Agent 匹配规则
export interface AgentMatchRule {
  types?: AgentType[];
  categories?: AgentCategory[];
  capabilities?: string[];
  minSuccessRate?: number;
}

// Agent 注册项
export interface AgentRegistration {
  id: string;
  definition: AgentDefinition;
  handler?: (input: AgentInput, context: AgentContext) => Promise<AgentOutput>;
  endpoint?: string;
  registeredAt: Date;
  lastCalledAt?: Date;
}

/**
 * Agent 注册表实现
 */
export class AgentRegistry {
  private prisma: PrismaClient;
  private agents: Map<string, AgentRegistration> = new Map();
  private typeIndex: Map<AgentType, Set<string>> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.initializeTypeIndex();
  }

  private initializeTypeIndex(): void {
    const types: AgentType[] = ['path', 'content', 'tutor', 'progress', 'custom'];
    types.forEach(type => this.typeIndex.set(type, new Set()));
  }

  /**
   * 注册 Agent
   */
  async register(
    definition: AgentDefinition,
    handler?: (input: AgentInput, context: AgentContext) => Promise<AgentOutput>
  ): Promise<string> {
    const registration: AgentRegistration = {
      id: definition.id,
      definition,
      handler,
      endpoint: definition.endpoint,
      registeredAt: new Date()
    };

    // 内存注册
    this.agents.set(definition.id, registration);
    
    // 更新类型索引
    const typeSet = this.typeIndex.get(definition.type);
    if (typeSet) {
      typeSet.add(definition.id);
    }

    // 持久化注册
    await this.persistRegistration(registration);

    return definition.id;
  }

  /**
   * 取消注册
   */
  async unregister(agentId: string): Promise<boolean> {
    const registration = this.agents.get(agentId);
    if (!registration) return false;

    // 从内存移除
    this.agents.delete(agentId);
    
    // 更新类型索引
    const typeSet = this.typeIndex.get(registration.definition.type);
    if (typeSet) {
      typeSet.delete(agentId);
    }

    // 从数据库移除
    await this.prisma.agent_registrations.delete({
      where: { id: agentId }
    }).catch(() => {});

    return true;
  }

  /**
   * 获取 Agent
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 匹配 Agent
   */
  match(rule: AgentMatchRule): AgentRegistration[] {
    let candidates: AgentRegistration[] = [];

    // 按类型筛选
    if (rule.types && rule.types.length > 0) {
      for (const type of rule.types) {
        const ids = this.typeIndex.get(type);
        if (ids) {
          for (const id of ids) {
            const agent = this.agents.get(id);
            if (agent) candidates.push(agent);
          }
        }
      }
    } else {
      candidates = Array.from(this.agents.values());
    }

    // 按分类筛选
    if (rule.categories && rule.categories.length > 0) {
      candidates = candidates.filter(
        a => rule.categories!.includes(a.definition.category)
      );
    }

    // 按能力筛选
    if (rule.capabilities && rule.capabilities.length > 0) {
      candidates = candidates.filter(a =>
        rule.capabilities!.some(cap => 
          a.definition.capabilities.includes(cap)
        )
      );
    }

    // 按成功率筛选
    if (rule.minSuccessRate !== undefined) {
      candidates = candidates.filter(
        a => a.definition.stats.successRate >= rule.minSuccessRate!
      );
    }

    return candidates;
  }

  /**
   * 获取所有 Agent
   */
  getAll(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  /**
   * 按类型获取
   */
  getByType(type: AgentType): AgentRegistration[] {
    const ids = this.typeIndex.get(type);
    if (!ids) return [];
    
    return Array.from(ids)
      .map(id => this.agents.get(id))
      .filter((a): a is AgentRegistration => a !== undefined);
  }

  /**
   * 更新统计数据
   */
  async updateStats(
    agentId: string,
    success: boolean,
    latency: number
  ): Promise<void> {
    const registration = this.agents.get(agentId);
    if (!registration) return;

    const stats = registration.definition.stats;
    
    // 更新调用次数
    stats.callCount++;
    
    // 更新成功率（移动平均）
    const previousSuccesses = stats.successRate * (stats.callCount - 1);
    stats.successRate = (previousSuccesses + (success ? 1 : 0)) / stats.callCount;
    
    // 更新平均延迟
    stats.avgLatency = (stats.avgLatency * (stats.callCount - 1) + latency) / stats.callCount;
    
    // 更新最后调用时间
    registration.lastCalledAt = new Date();

    // 持久化更新
    await this.prisma.agent_registrations.update({
      where: { id: agentId },
      data: {
        callCount: stats.callCount,
        successRate: stats.successRate,
      }
    }).catch(() => {});
  }

  /**
   * 持久化注册
   */
  private async persistRegistration(registration: AgentRegistration): Promise<void> {
    const def = registration.definition;
    const now = new Date();
    
    await this.prisma.agent_registrations.upsert({
      where: { id: registration.id },
      create: {
        id: registration.id,
        name: def.name,
        version: def.version,
        category: def.category,
        type: def.type,
        inputSchema: JSON.stringify(def.inputSchema),
        outputSchema: JSON.stringify(def.outputSchema),
        capabilities: JSON.stringify(def.capabilities),
        subscribes: JSON.stringify(def.subscribes),
        publishes: JSON.stringify(def.publishes),
        endpoint: def.endpoint,
        callCount: def.stats.callCount,
        successRate: def.stats.successRate,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        version: def.version,
        capabilities: JSON.stringify(def.capabilities),
        subscribes: JSON.stringify(def.subscribes),
        publishes: JSON.stringify(def.publishes),
        endpoint: def.endpoint,
        updatedAt: now,
      }
    });
  }

  /**
   * 从数据库加载注册
   * 注意：不会覆盖已注册的 Agent（保留 handler）
   */
  async loadFromDatabase(): Promise<void> {
    const records = await this.prisma.agent_registrations.findMany();
    
    for (const record of records) {
      // 如果已经注册（有 handler），跳过，不覆盖
      if (this.agents.has(record.id)) {
        const existing = this.agents.get(record.id)!;
        // 只更新统计数据
        existing.definition.stats.callCount = record.callCount;
        existing.definition.stats.successRate = record.successRate;
        continue;
      }

      const definition: AgentDefinition = {
        id: record.id,
        name: record.name,
        version: record.version,
        type: record.type as AgentType,
        category: record.category as AgentCategory,
        description: '',
        capabilities: JSON.parse(record.capabilities),
        subscribes: JSON.parse(record.subscribes),
        publishes: JSON.parse(record.publishes),
        inputSchema: JSON.parse(record.inputSchema),
        outputSchema: JSON.parse(record.outputSchema),
        endpoint: record.endpoint || undefined,
        stats: {
          callCount: record.callCount,
          successRate: record.successRate,
          avgLatency: 0,
        }
      };

      const registration: AgentRegistration = {
        id: record.id,
        definition,
        endpoint: record.endpoint || undefined,
        registeredAt: record.createdAt,
      };

      this.agents.set(record.id, registration);
      
      const typeSet = this.typeIndex.get(definition.type);
      if (typeSet) {
        typeSet.add(record.id);
      }
    }
  }
}
