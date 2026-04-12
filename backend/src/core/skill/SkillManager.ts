/**
 * SkillManager - 技能管理器
 * 统一管理和执行所有技能
 */

import {
  ISkill,
  ISkillInput,
  ISkillOutput,
  ISkillManager,
  ISkillRegistration,
  SkillConstructor,
} from './ISkill';
import { logger } from '../../utils/logger';

export interface ISkillManagerConfig {
  /** 是否启用缓存 */
  cacheEnabled?: boolean;
  /** 缓存 TTL (ms) */
  cacheTTL?: number;
  /** 默认超时时间 */
  defaultTimeout?: number;
}

export class SkillManager implements ISkillManager {
  private skills: Map<string, ISkill> = new Map();
  private registrations: Map<string, ISkillRegistration> = new Map();
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private config: Required<ISkillManagerConfig>;

  constructor(config?: ISkillManagerConfig) {
    this.config = {
      cacheEnabled: true,
      cacheTTL: 5 * 60 * 1000, // 5 分钟
      defaultTimeout: 30000,
      ...config,
    };
  }

  /**
   * 注册技能
   */
  register(skill: ISkill): void {
    if (this.skills.has(skill.id)) {
      logger.warn(`[SkillManager] 技能 ${skill.id} 已存在，将被覆盖`);
    }

    this.skills.set(skill.id, skill);
    this.registrations.set(skill.id, {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      category: skill.category,
      capabilities: skill.capabilities,
      constructor: skill.constructor as SkillConstructor,
      filePath: '', // 动态注册时为空
    });

    // 预热（如果有）
    if (skill.warmup) {
      skill.warmup().catch(err => {
        logger.error(`[SkillManager] 技能 ${skill.id} 预热失败:`, err);
      });
    }

    logger.info(`[SkillManager] 注册技能: ${skill.id}`);
  }

  /**
   * 批量注册
   */
  registerMany(skills: ISkill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 获取技能
   */
  get(id: string): ISkill | undefined {
    return this.skills.get(id);
  }

  /**
   * 列出所有技能
   */
  list(): ISkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 按标签查找
   */
  findByTag(tag: string): ISkill[] {
    return this.list().filter(skill =>
      skill.capabilities.tags.includes(tag)
    );
  }

  /**
   * 按分类查找
   */
  findByCategory(category: string): ISkill[] {
    return this.list().filter(skill =>
      skill.category === category
    );
  }

  /**
   * 按输入类型查找
   */
  findByInputType(inputType: string): ISkill[] {
    return this.list().filter(skill =>
      skill.capabilities.inputTypes.includes(inputType)
    );
  }

  /**
   * 执行技能
   */
  async execute(skillId: string, input: ISkillInput): Promise<ISkillOutput> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        data: null,
        error: {
          code: 'SKILL_NOT_FOUND',
          message: `技能 ${skillId} 不存在`,
        },
      };
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(skillId, input);
    if (this.config.cacheEnabled && skill.config?.cacheEnabled !== false) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: { cacheHit: true, duration: 0 },
        };
      }
    }

    const startTime = Date.now();

    try {
      // 验证输入
      if (skill.validate && !skill.validate(input)) {
        return {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: '输入参数验证失败',
          },
          metadata: { duration: Date.now() - startTime },
        };
      }

      // 执行技能
      const result = await this.executeWithTimeout(skill, input);

      // 缓存结果
      if (result.success && this.config.cacheEnabled) {
        this.setCache(cacheKey, result.data);
      }

      return result;
    } catch (error: any) {
      logger.error(`[SkillManager] 技能 ${skillId} 执行失败:`, error);

      return {
        success: false,
        data: null,
        error: {
          code: error.code || 'EXECUTION_ERROR',
          message: error.message || '执行失败',
        },
        metadata: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * 带超时的执行
   */
  private async executeWithTimeout(
    skill: ISkill,
    input: ISkillInput
  ): Promise<ISkillOutput> {
    const timeout = skill.config?.timeout || this.config.defaultTimeout;

    return Promise.race([
      skill.execute(input),
      new Promise<ISkillOutput>((_, reject) =>
        setTimeout(() => reject(new Error('执行超时')), timeout)
      ),
    ]);
  }

  /**
   * 执行技能链（Pipeline）
   */
  async executePipeline(
    skillIds: string[],
    initialInput: ISkillInput
  ): Promise<ISkillOutput> {
    let currentInput = initialInput;

    for (const skillId of skillIds) {
      const result = await this.execute(skillId, currentInput);

      if (!result.success) {
        return result;
      }

      // 将当前输出作为下一个输入
      currentInput = {
        ...currentInput,
        data: result.data,
      };
    }

    return {
      success: true,
      data: currentInput.data,
    };
  }

  /**
   * 获取缓存键
   */
  private getCacheKey(skillId: string, input: ISkillInput): string {
    const inputStr = JSON.stringify({ data: input.data, options: input.options });
    return `${skillId}:${Buffer.from(inputStr).toString('base64')}`;
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.config.cacheTTL,
    });
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[SkillManager] 缓存已清除');
  }

  /**
   * 卸载技能
   */
  unregister(skillId: string): boolean {
    const existed = this.skills.has(skillId);
    this.skills.delete(skillId);
    this.registrations.delete(skillId);

    if (existed) {
      logger.info(`[SkillManager] 卸载技能: ${skillId}`);
    }

    return existed;
  }

  /**
   * 获取注册信息
   */
  getRegistration(id: string): ISkillRegistration | undefined {
    return this.registrations.get(id);
  }

  /**
   * 列出所有注册信息
   */
  listRegistrations(): ISkillRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalSkills: this.skills.size,
      categories: this.getCategoryStats(),
      cacheSize: this.cache.size,
    };
  }

  /**
   * 获取分类统计
   */
  private getCategoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      stats[skill.category] = (stats[skill.category] || 0) + 1;
    }
    return stats;
  }
}

// 导出单例实例
export const skillManager = new SkillManager();
