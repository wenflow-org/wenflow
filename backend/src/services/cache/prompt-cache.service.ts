/**
 * Prompt 缓存服务
 * 
 * 为 Agent 的 Prompt 配置提供缓存功能
 * 减少数据库查询，提高 Prompt 加载速度
 */

import prisma from '../../config/database';
import { responseCache } from './response-cache.service';
import { logger } from '../../utils/logger';

/**
 * Prompt 配置缓存接口
 */
interface PromptConfigCache {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  model?: string;
  version?: string;
  timestamp: number;
}

/**
 * Prompt 缓存服务类
 */
export class PromptCacheService {
  private readonly DEFAULT_TTL = 3600000; // 1 小时
  private readonly PROMPT_PREFIX = 'prompt:';
  
  /**
   * 获取缓存的 Prompt 配置
   * 
   * @param agentId Agent ID
   * @param version Prompt 版本（可选，默认获取激活版本）
   * @returns Prompt 配置
   */
  async getCachedPrompt(
    agentId: string,
    version?: string
  ): Promise<PromptConfigCache | null> {
    const cacheKey = this.getCacheKey(agentId, version);
    
    // 尝试从缓存获取
    const cached = responseCache.get<PromptConfigCache>(cacheKey);
    if (cached) {
      logger.debug('[PromptCache] 缓存命中', { agentId, version: version || 'active' });
      return cached;
    }
    
    // 从数据库加载
    logger.debug('[PromptCache] 缓存未命中，从数据库加载', { agentId, version: version || 'active' });
    const prompt = await this.loadPromptFromDatabase(agentId, version);
    
    if (!prompt) {
      return null;
    }
    
    // 存入缓存
    const cacheData: PromptConfigCache = {
      systemPrompt: prompt.systemPrompt,
      temperature: prompt.temperature ?? 0.7,
      maxTokens: prompt.maxTokens ?? 2000,
      model: prompt.model || undefined,
      version: prompt.version,
      timestamp: Date.now()
    };
    
    responseCache.set(cacheKey, cacheData, this.DEFAULT_TTL);
    
    return cacheData;
  }
  
  /**
   * 从数据库加载 Prompt
   */
  private async loadPromptFromDatabase(
    agentId: string,
    version?: string
  ): Promise<any | null> {
    try {
      const where: any = { agentId };
      
      if (version) {
        where.version = version;
      } else {
        where.isActive = true;
      }
      
      const prompt = await prisma.agent_prompts.findFirst({
        where
      });
      
      return prompt;
    } catch (error: any) {
      logger.error('[PromptCache] 加载 Prompt 失败:', error.message);
      return null;
    }
  }
  
  /**
   * 预加载多个 Prompt 配置
   * 
   * @param agentId Agent ID
   * @param versions 版本列表
   * @returns 加载结果
   */
  async preloadPrompts(
    agentId: string,
    versions: string[]
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    
    for (const version of versions) {
      try {
        const result = await this.getCachedPrompt(agentId, version);
        if (result) {
          success++;
        } else {
          failed++;
        }
      } catch (error: any) {
        logger.warn('[PromptCache] 预加载 Prompt 失败:', { 
          agentId, 
          version, 
          error: error.message 
        });
        failed++;
      }
    }
    
    logger.info('[PromptCache] 预加载完成', { 
      agentId, 
      versions: versions.length, 
      success, 
      failed 
    });
    
    return { success, failed };
  }
  
  /**
   * 清除特定 Agent 的 Prompt 缓存
   * 
   * @param agentId Agent ID
   * @returns 清除的数量
   */
  clearAgentCache(agentId: string): number {
    const prefix = `${this.PROMPT_PREFIX}${agentId}:`;
    return this.clearByPrefix(prefix);
  }
  
  /**
   * 清除所有 Prompt 缓存
   */
  clearAll(): void {
    const prefix = this.PROMPT_PREFIX;
    const keys = responseCache.keys();
    let cleared = 0;
    
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        responseCache.delete(key);
        cleared++;
      }
    }
    
    logger.info('[PromptCache] 清空所有缓存', { count: cleared });
  }
  
  /**
   * 手动设置 Prompt 缓存
   * 
   * @param agentId Agent ID
   * @param version Prompt 版本
   * @param config Prompt 配置
   * @param ttl 缓存时间
   */
  setPromptCache(
    agentId: string,
    version: string,
    config: PromptConfigCache,
    ttl?: number
  ): void {
    const cacheKey = this.getCacheKey(agentId, version);
    responseCache.set(cacheKey, config, ttl || this.DEFAULT_TTL);
    
    logger.debug('[PromptCache] 手动设置缓存', { agentId, version });
  }
  
  /**
   * 获取缓存键
   */
  private getCacheKey(agentId: string, version?: string): string {
    if (version) {
      return `${this.PROMPT_PREFIX}${agentId}:${version}`;
    } else {
      return `${this.PROMPT_PREFIX}${agentId}:active`;
    }
  }
  
  /**
   * 按前缀清除缓存
   */
  private clearByPrefix(prefix: string): number {
    const keys = responseCache.keys();
    let cleared = 0;
    
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        responseCache.delete(key);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      logger.info('[PromptCache] 清除缓存', { prefix, count: cleared });
    }
    
    return cleared;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    const allKeys = responseCache.keys();
    const promptKeys = allKeys.filter(key => key.startsWith(this.PROMPT_PREFIX));
    
    return {
      totalPrompts: promptKeys.length,
      cacheStats: responseCache.getStats()
    };
  }
}

// 导出单例
export const promptCache = new PromptCacheService();
