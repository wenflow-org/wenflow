/**
 * Prompt 缓存服务
 * 
 * 为 Agent 的 Prompt 配置提供缓存功能
 * 减少数据库查询，提高 Prompt 加载速度
 */

import systemPrisma from '../../config/system-database';
import { responseCache } from './response-cache.service';
import { agentConfigService } from '../agentConfig.service';
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
   * 清除特定 Agent 的 Prompt 缓存
   * 
   * @param agentId Agent ID
   * @returns 清除的数量
   */
  clearAgentCache(agentId: string): number {
    // 联动失效 AgentConfigService 的运行时 ACTIVE prompt 缓存（发布/回滚/删除统一入口）
    agentConfigService.clearCachedPrompt(agentId);
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
