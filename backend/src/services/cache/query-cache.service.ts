/**
 * 查询缓存服务
 * 
 * 为数据库查询提供缓存功能，减少重复的数据库访问
 * 支持自定义查询函数和 TTL 配置
 */

import prisma from '../../config/database';
import { responseCache } from './response-cache.service';
import { logger } from '../../utils/logger';

/**
 * 查询缓存服务类
 */
export class QueryCacheService {
  // 默认 TTL 配置
  private readonly DEFAULT_TTL = {
    SHORT: 60000,      // 1 分钟 - 高频变化数据
    MEDIUM: 300000,    // 5 分钟 - 一般数据
    LONG: 600000,      // 10 分钟 - 稳定数据
    VERY_LONG: 3600000 // 1 小时 - 极少变化数据
  };
  
  /**
   * 缓存 Prisma 查询
   * 
   * @param key 缓存键
   * @param queryFn 查询函数
   * @param ttl 缓存时间（毫秒）
   * @returns 查询结果
   */
  async cachedQuery<T>(
    key: string,
    queryFn: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL.MEDIUM
  ): Promise<T> {
    // 尝试从缓存获取
    const cached = responseCache.get<T>(key);
    if (cached !== null) {
      logger.debug('[QueryCache] 缓存命中', { key });
      return cached;
    }
    
    // 执行查询
    logger.debug('[QueryCache] 缓存未命中，执行查询', { key });
    const result = await queryFn();
    
    // 存入缓存
    responseCache.set(key, result, ttl);
    
    return result;
  }
  
  /**
   * 获取学生状态的缓存查询
   * 
   * @param userId 用户 ID
   * @returns 学生学习状态指标
   */
  async getCachedStudentState(userId: string) {
    return this.cachedQuery(
      `student-state:${userId}`,
      async () => {
        const state = await prisma.learning_metrics.findFirst({
          where: { userId },
          orderBy: { recordedAt: 'desc' }
        });
        return state;
      },
      this.DEFAULT_TTL.SHORT  // 1 分钟 - 学生状态变化较快
    );
  }
  
  /**
   * 获取任务信息的缓存查询
   * 
   * @param taskId 任务 ID
   * @returns 任务信息
   */
  async getCachedTaskInfo(taskId: string) {
    return this.cachedQuery(
      `task:${taskId}`,
      async () => {
        const task = await prisma.subtasks.findUnique({
          where: { id: taskId }
        });
        return task;
      },
      this.DEFAULT_TTL.LONG  // 10 分钟 - 任务信息相对稳定
    );
  }
  
  /**
   * 获取学习路径信息的缓存查询
   * 
   * @param pathId 学习路径 ID
   * @returns 学习路径信息
   */
  async getCachedPathInfo(pathId: string) {
    return this.cachedQuery(
      `path:${pathId}`,
      async () => {
        const path = await prisma.learning_paths.findUnique({
          where: { id: pathId }
        });
        return path;
      },
      this.DEFAULT_TTL.LONG  // 10 分钟
    );
  }
  
  /**
   * 获取用户信息的缓存查询
   * 
   * @param userId 用户 ID
   * @returns 用户信息
   */
  async getCachedUserInfo(userId: string) {
    return this.cachedQuery(
      `user:${userId}`,
      async () => {
        const user = await prisma.users.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            xp: true,
            createdAt: true
          }
        });
        return user;
      },
      this.DEFAULT_TTL.MEDIUM  // 5 分钟
    );
  }
  
  /**
   * 获取成就信息的缓存查询
   * 
   * @returns 所有成就信息
   */
  async getCachedAchievements() {
    return this.cachedQuery(
      'achievements:all',
      async () => {
        const achievements = await prisma.achievements.findMany({
          orderBy: { id: 'asc' }
        });
        return achievements;
      },
      this.DEFAULT_TTL.VERY_LONG  // 1 小时 - 成就定义很少变化
    );
  }
  
  /**
   * 获取用户成就的缓存查询
   * 
   * @param userId 用户 ID
   * @returns 用户已解锁的成就
   */
  async getCachedUserAchievements(userId: string) {
    return this.cachedQuery(
      `user-achievements:${userId}`,
      async () => {
        // 获取用户已解锁的成就
        const achievements = await prisma.achievements.findMany({
          where: { 
            userId,
            completed: true
          },
          include: {
            users: true
          }
        });
        return achievements;
      },
      this.DEFAULT_TTL.MEDIUM  // 5 分钟
    );
  }
  
  /**
   * 获取学习会话的缓存查询
   * 
   * @param sessionId 会话 ID
   * @returns 学习会话信息
   */
  async getCachedSession(sessionId: string) {
    return this.cachedQuery(
      `session:${sessionId}`,
      async () => {
        const session = await prisma.learning_sessions.findUnique({
          where: { id: sessionId }
        });
        return session;
      },
      this.DEFAULT_TTL.SHORT  // 1 分钟 - 会话状态可能快速变化
    );
  }
  
  /**
   * 获取 Prompt 配置的缓存查询
   * 
   * @param agentId Agent ID
   * @param version Prompt 版本
   * @returns Prompt 配置
   */
  async getCachedPromptConfig(agentId: string, version?: string) {
    const key = version 
      ? `prompt:${agentId}:${version}`
      : `prompt:${agentId}:active`;
    
    return this.cachedQuery(
      key,
      async () => {
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
      },
      this.DEFAULT_TTL.MEDIUM  // 5 分钟
    );
  }
  
  /**
   * 清除特定类型的缓存
   * 
   * @param prefix 缓存键前缀
   * @returns 清除的数量
   */
  clearByPrefix(prefix: string): number {
    const keys = responseCache.keys();
    let cleared = 0;
    
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        responseCache.delete(key);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      logger.info('[QueryCache] 清除缓存', { prefix, count: cleared });
    }
    
    return cleared;
  }
  
  /**
   * 清除用户相关的缓存
   * 
   * @param userId 用户 ID
   */
  clearUserCache(userId: string): void {
    const prefixes = [
      `student-state:${userId}`,
      `user:${userId}`,
      `user-achievements:${userId}`,
      `session:`
    ];
    
    prefixes.forEach(prefix => this.clearByPrefix(prefix));
    
    logger.info('[QueryCache] 清除用户缓存', { userId });
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats() {
    return responseCache.getStats();
  }
}

// 导出单例
export const queryCache = new QueryCacheService();
