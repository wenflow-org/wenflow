/**
 * 响应缓存服务
 * 
 * 提供内存级别的响应缓存功能，支持 TTL、LRU 淘汰和性能统计
 * 用于减少重复的 AI 调用和计算开销
 */

import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

/**
 * 缓存条目接口
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;  // Time to live (ms)
  key: string;
  accessCount?: number;  // 访问次数（用于 LRU）
  lastAccessTime?: number;  // 最后访问时间
}

/**
 * 缓存统计信息
 */
interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

/**
 * 响应缓存服务类
 */
export class ResponseCacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0
  };
  
  // 配置
  private readonly MAX_SIZE = 1000;  // 最大缓存条目数
  private readonly DEFAULT_TTL = 3600000;  // 默认 1 小时
  
  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      logger.debug('[ResponseCache] 缓存过期', { key });
      return null;
    }
    
    // 更新访问信息
    entry.accessCount = (entry.accessCount || 0) + 1;
    entry.lastAccessTime = Date.now();
    
    this.stats.hits++;
    logger.debug('[ResponseCache] 缓存命中', { key, hits: this.stats.hits });
    return entry.data as T;
  }
  
  /**
   * 设置缓存
   */
  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    // LRU 淘汰：如果缓存太大，删除最久未访问的条目
    if (this.cache.size >= this.MAX_SIZE) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      key,
      accessCount: 0,
      lastAccessTime: Date.now()
    });
    
    logger.debug('[ResponseCache] 缓存写入', { key, size: this.cache.size, ttl });
  }
  
  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    logger.debug('[ResponseCache] 缓存删除', { key, success: result });
    return result;
  }
  
  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    logger.info('[ResponseCache] 缓存清空');
  }
  
  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: total > 0 ? this.stats.hits / total : 0
    };
  }
  
  /**
   * 生成缓存键
   * 使用 MD5 哈希确保键的唯一性和一致性
   */
  generateKey(prefix: string, params: any): string {
    try {
      const hash = createHash('md5')
        .update(JSON.stringify(params, this.getReplacer()))
        .digest('hex');
      return `${prefix}:${hash}`;
    } catch (error: any) {
      logger.warn('[ResponseCache] 生成缓存键失败:', error.message);
      // 降级处理：使用简单拼接
      return `${prefix}:${JSON.stringify(params)}`;
    }
  }
  
  /**
   * JSON.stringify 的 replacer 函数，处理循环引用和特殊类型
   */
  private getReplacer() {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      // 跳过循环引用
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      
      // 跳过函数和 undefined
      if (typeof value === 'function' || value === undefined) {
        return undefined;
      }
      
      // 处理 Date 对象
      if (value instanceof Date) {
        return value.toISOString();
      }
      
      return value;
    };
  }
  
  /**
   * LRU 淘汰策略：删除最久未访问的条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    this.cache.forEach((entry, key) => {
      const accessTime = entry.lastAccessTime || entry.timestamp;
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestKey = key;
      }
    });
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      logger.debug('[ResponseCache] LRU 淘汰', { key: oldestKey });
    }
  }
  
  /**
   * 清理过期缓存
   * 可以定期调用以释放内存
   */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();
    
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      logger.info('[ResponseCache] 清理过期缓存', { count: cleaned });
    }
    
    return cleaned;
  }
  
  /**
   * 获取所有缓存键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * 检查键是否存在（不更新访问统计）
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    
    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }
    
    return true;
  }
}

// 导出单例
export const responseCache = new ResponseCacheService();
