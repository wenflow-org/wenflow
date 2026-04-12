/**
 * Skill 注册表 - EduClaw Gateway
 * 
 * 发现和管理可用 Skill
 */

import { PrismaClient } from '@prisma/client';
import {
  SkillDefinition,
  SkillCategory,
  SkillExecutionRequest,
  SkillExecutionResult
} from '../../skills/protocol';

// Skill 匹配规则
export interface SkillMatchRule {
  categories?: SkillCategory[];
  capabilities?: string[];
  names?: string[];
  minSuccessRate?: number;
}

// Skill 注册项
export interface SkillRegistration {
  name: string;
  definition: SkillDefinition;
  handler?: (input: any) => Promise<any>;
  endpoint?: string;
  registeredAt: Date;
  lastCalledAt?: Date;
}

/**
 * Skill 注册表实现
 */
export class SkillRegistry {
  private prisma: PrismaClient;
  private skills: Map<string, SkillRegistration> = new Map();
  private categoryIndex: Map<SkillCategory, Set<string>> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.initializeCategoryIndex();
  }

  private initializeCategoryIndex(): void {
    const categories: SkillCategory[] = ['parsing', 'generation', 'analysis', 'retrieval', 'computation'];
    categories.forEach(cat => this.categoryIndex.set(cat, new Set()));
  }

  /**
   * 注册 Skill
   */
  async register(
    definition: SkillDefinition,
    handler?: (input: any) => Promise<any>
  ): Promise<string> {
    const registration: SkillRegistration = {
      name: definition.name,
      definition,
      handler,
      endpoint: definition.endpoint,
      registeredAt: new Date()
    };

    // 内存注册
    this.skills.set(definition.name, registration);
    
    // 更新分类索引
    const catSet = this.categoryIndex.get(definition.category);
    if (catSet) {
      catSet.add(definition.name);
    }

    // 持久化注册
    await this.persistRegistration(registration);

    return definition.name;
  }

  /**
   * 取消注册
   */
  async unregister(skillName: string): Promise<boolean> {
    const registration = this.skills.get(skillName);
    if (!registration) return false;

    // 从内存移除
    this.skills.delete(skillName);
    
    // 更新分类索引
    const catSet = this.categoryIndex.get(registration.definition.category);
    if (catSet) {
      catSet.delete(skillName);
    }

    // 从数据库移除
    await this.prisma.skill_registrations.delete({
      where: { name: skillName }
    }).catch(() => {});

    return true;
  }

  /**
   * 获取 Skill
   */
  get(skillName: string): SkillRegistration | undefined {
    return this.skills.get(skillName);
  }

  /**
   * 匹配 Skill
   */
  match(rule: SkillMatchRule): SkillRegistration[] {
    let candidates: SkillRegistration[] = [];

    // 按名称筛选
    if (rule.names && rule.names.length > 0) {
      candidates = rule.names
        .map(name => this.skills.get(name))
        .filter((s): s is SkillRegistration => s !== undefined);
    }
    // 按分类筛选
    else if (rule.categories && rule.categories.length > 0) {
      for (const cat of rule.categories) {
        const names = this.categoryIndex.get(cat);
        if (names) {
          for (const name of names) {
            const skill = this.skills.get(name);
            if (skill) candidates.push(skill);
          }
        }
      }
    } else {
      candidates = Array.from(this.skills.values());
    }

    // 按能力筛选
    if (rule.capabilities && rule.capabilities.length > 0) {
      candidates = candidates.filter(s =>
        rule.capabilities!.some(cap => 
          s.definition.capabilities.includes(cap)
        )
      );
    }

    // 按成功率筛选
    if (rule.minSuccessRate !== undefined) {
      candidates = candidates.filter(
        s => s.definition.stats.successRate >= rule.minSuccessRate!
      );
    }

    return candidates;
  }

  /**
   * 获取所有 Skill
   */
  getAll(): SkillRegistration[] {
    return Array.from(this.skills.values());
  }

  /**
   * 按分类获取
   */
  getByCategory(category: SkillCategory): SkillRegistration[] {
    const names = this.categoryIndex.get(category);
    if (!names) return [];
    
    return Array.from(names)
      .map(name => this.skills.get(name))
      .filter((s): s is SkillRegistration => s !== undefined);
  }

  /**
   * 更新统计数据
   */
  async updateStats(
    skillName: string,
    success: boolean,
    latency: number
  ): Promise<void> {
    const registration = this.skills.get(skillName);
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
    await this.prisma.skill_registrations.update({
      where: { name: skillName },
      data: {
        callCount: stats.callCount,
        successRate: stats.successRate,
      }
    }).catch(() => {});
  }

  /**
   * 持久化注册
   */
  private async persistRegistration(registration: SkillRegistration): Promise<void> {
    const def = registration.definition;
    
    await this.prisma.skill_registrations.upsert({
      where: { name: registration.name },
      create: {
        id: `skill_${registration.name}_${Date.now()}`,
        name: registration.name,
        version: def.version,
        category: def.category,
        description: def.description,
        inputSchema: JSON.stringify(def.inputSchema),
        outputSchema: JSON.stringify(def.outputSchema),
        endpoint: def.endpoint,
        callCount: def.stats.callCount,
        successRate: def.stats.successRate,
      },
      update: {
        version: def.version,
        description: def.description,
        inputSchema: JSON.stringify(def.inputSchema),
        outputSchema: JSON.stringify(def.outputSchema),
        endpoint: def.endpoint,
      }
    });
  }

  /**
   * 从数据库加载注册
   * 注意：不会覆盖已注册的 Skill（保留 handler）
   */
  async loadFromDatabase(): Promise<void> {
    const records = await this.prisma.skill_registrations.findMany();
    
    for (const record of records) {
      // 如果已经注册（有 handler），跳过，不覆盖
      if (this.skills.has(record.name)) {
        const existing = this.skills.get(record.name)!;
        // 只更新统计数据
        existing.definition.stats.callCount = record.callCount;
        existing.definition.stats.successRate = record.successRate;
        continue;
      }

      const definition: SkillDefinition = {
        name: record.name,
        version: record.version,
        category: record.category as SkillCategory,
        description: record.description,
        inputSchema: JSON.parse(record.inputSchema),
        outputSchema: JSON.parse(record.outputSchema),
        capabilities: [],
        endpoint: record.endpoint || undefined,
        stats: {
          callCount: record.callCount,
          successRate: record.successRate,
          avgLatency: 0,
        }
      };

      const registration: SkillRegistration = {
        name: record.name,
        definition,
        endpoint: record.endpoint || undefined,
        registeredAt: record.createdAt,
      };

      this.skills.set(record.name, registration);
      
      const catSet = this.categoryIndex.get(definition.category);
      if (catSet) {
        catSet.add(record.name);
      }
    }
  }
}
