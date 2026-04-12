/**
 * 性能监控中间件
 * 
 * 监控 API 请求性能，记录慢请求和性能指标
 * 提供性能统计和告警功能
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { responseCache } from '../services/cache/response-cache.service';

/**
 * 性能指标接口
 */
interface PerformanceMetrics {
  path: string;
  method: string;
  duration: number;
  statusCode: number;
  timestamp: number;
  isSlow: boolean;
  cacheHit?: boolean;
}

/**
 * 性能统计接口
 */
interface PerformanceStats {
  totalRequests: number;
  slowRequests: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p95Duration: number;
  p99Duration: number;
}

/**
 * 慢请求阈值（毫秒）
 */
const SLOW_REQUEST_THRESHOLD = 1000;

/**
 * 性能数据存储器
 */
class PerformanceStore {
  private metrics: PerformanceMetrics[] = [];
  private readonly MAX_SIZE = 1000;  // 最多保留 1000 条记录
  
  /**
   * 添加性能指标
   */
  add(metrics: PerformanceMetrics) {
    this.metrics.push(metrics);
    
    // 超过最大大小时，删除最旧的 50%
    if (this.metrics.length > this.MAX_SIZE) {
      this.metrics = this.metrics.slice(this.MAX_SIZE / 2);
    }
  }
  
  /**
   * 获取统计信息
   */
  getStats(): PerformanceStats {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        slowRequests: 0,
        avgDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        p95Duration: 0,
        p99Duration: 0
      };
    }
    
    const durations = this.metrics.map(m => m.duration).sort((a, b) => a - b);
    const total = durations.length;
    const slowRequests = this.metrics.filter(m => m.isSlow).length;
    
    // 计算百分位数
    const p95Index = Math.floor(total * 0.95);
    const p99Index = Math.floor(total * 0.99);
    
    return {
      totalRequests: total,
      slowRequests,
      avgDuration: durations.reduce((a, b) => a + b, 0) / total,
      maxDuration: durations[durations.length - 1],
      minDuration: durations[0],
      p95Duration: durations[p95Index] || 0,
      p99Duration: durations[p99Index] || 0
    };
  }
  
  /**
   * 获取慢请求列表
   */
  getSlowRequests(limit: number = 10): PerformanceMetrics[] {
    return this.metrics
      .filter(m => m.isSlow)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }
  
  /**
   * 清空统计数据
   */
  clear() {
    this.metrics = [];
  }
}

const performanceStore = new PerformanceStore();

/**
 * 性能监控中间件
 */
export function performanceMonitor(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();
  
  // 响应结束后记录性能
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const endMemory = process.memoryUsage();
    const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
    
    const isSlow = duration > SLOW_REQUEST_THRESHOLD;
    
    // 构建性能指标
    const metrics: PerformanceMetrics = {
      path: req.path,
      method: req.method,
      duration,
      statusCode: res.statusCode,
      timestamp: Date.now(),
      isSlow
    };
    
    // 记录慢请求
    if (isSlow) {
      logger.warn('[慢请求]', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
        memoryUsage: `${Math.round(memoryDiff / 1024 / 1024 * 100) / 100}MB`
      });
    }
    
    // 记录 API 性能指标
    if (req.path.includes('/api/')) {
      logger.info('[API 性能]', {
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode
      });
      
      // 存储性能数据
      performanceStore.add(metrics);
    }
  });
  
  next();
}

/**
 * 性能监控中间件（带缓存统计）
 */
export function performanceMonitorWithCache(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isSlow = duration > SLOW_REQUEST_THRESHOLD;
    
    const metrics: PerformanceMetrics = {
      path: req.path,
      method: req.method,
      duration,
      statusCode: res.statusCode,
      timestamp: Date.now(),
      isSlow,
      cacheHit: res.get('X-Cache-Hit') === 'true'
    };
    
    if (isSlow) {
      logger.warn('[慢请求]', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
        cacheHit: metrics.cacheHit
      });
    }
    
    if (req.path.includes('/api/')) {
      performanceStore.add(metrics);
    }
  });
  
  next();
}

/**
 * 获取性能统计信息
 */
export function getPerformanceStats(): PerformanceStats {
  return performanceStore.getStats();
}

/**
 * 获取慢请求列表
 */
export function getSlowRequests(limit: number = 10): PerformanceMetrics[] {
  return performanceStore.getSlowRequests(limit);
}

/**
 * 性能监控路由处理器
 */
export function performanceStatsHandler(
  req: Request,
  res: Response
) {
  const stats = getPerformanceStats();
  const cacheStats = responseCache.getStats();
  const slowRequests = getSlowRequests(20);
  
  res.json({
    success: true,
    data: {
      performance: stats,
      cache: cacheStats,
      slowRequests: slowRequests.map(r => ({
        path: r.path,
        method: r.method,
        duration: r.duration,
        statusCode: r.statusCode,
        timestamp: new Date(r.timestamp).toISOString()
      }))
    }
  });
}

/**
 * 清空性能统计数据
 */
export function clearPerformanceStats(
  req: Request,
  res: Response
) {
  performanceStore.clear();
  
  res.json({
    success: true,
    message: '性能统计数据已清空'
  });
}

/**
 * 清理过期缓存（定时任务）
 */
export function startCacheCleanup(intervalMinutes: number = 5) {
  const intervalMs = intervalMinutes * 60 * 1000;
  
  setInterval(() => {
    const cleaned = responseCache.cleanup();
    if (cleaned > 0) {
      logger.info('[定时任务] 清理过期缓存', { count: cleaned });
    }
  }, intervalMs);
  
  logger.info('[定时任务] 缓存清理任务已启动', { interval: `${intervalMinutes}分钟` });
}
