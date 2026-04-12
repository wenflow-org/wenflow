/**
 * 缓存预热脚本
 * 
 * 在系统启动时预加载常用数据到缓存中
 * 减少首次访问的延迟和 AI 调用次数
 */

import prisma from '../config/database';
import { queryCache } from '../services/cache/query-cache.service';
import { promptCache } from '../services/cache/prompt-cache.service';
import { responseCache } from '../services/cache/response-cache.service';
import { logger } from '../utils/logger';

/**
 * 缓存预热配置
 */
const WARMUP_CONFIG = {
  // 预加载的 Prompt 策略
  promptStrategies: ['SUPPORTIVE', 'BASIC', 'STANDARD', 'CHALLENGE', 'REMEDIAL'],
  
  // 预加载的活跃用户数量
  activeUserLimit: 100,
  
  // 预加载的热门任务数量
  popularTaskLimit: 50,
  
  // 预加载的学习路径数量
  popularPathLimit: 30,
  
  // 预加载的成就数据
  preloadAchievements: true,
  
  // 预加载的 Agent 配置
  agentIds: ['content-agent-v3', 'tutor-agent', 'path-agent', 'goal-agent']
};

/**
 * 预热结果统计
 */
interface WarmupResult {
  step: string;
  success: boolean;
  count: number;
  duration: number;
  error?: string;
}

/**
 * 缓存预热主函数
 */
async function warmupCache(): Promise<void> {
  const startTime = Date.now();
  const results: WarmupResult[] = [];
  
  logger.info('='.repeat(60));
  logger.info('开始缓存预热...');
  logger.info('='.repeat(60));
  
  try {
    // 1. 预加载 Prompt 配置
    logger.info('\n[1/6] 预加载 Prompt 配置...');
    const promptResult = await warmupPrompts();
    results.push(promptResult);
    
    // 2. 预加载活跃用户状态
    logger.info('\n[2/6] 预加载活跃用户状态...');
    const userResult = await warmupUserStates();
    results.push(userResult);
    
    // 3. 预加载热门任务信息
    logger.info('\n[3/6] 预加载热门任务信息...');
    const taskResult = await warmupTaskInfo();
    results.push(taskResult);
    
    // 4. 预加载学习路径信息
    logger.info('\n[4/6] 预加载学习路径信息...');
    const pathResult = await warmupPathInfo();
    results.push(pathResult);
    
    // 5. 预加载成就数据
    logger.info('\n[5/6] 预加载成就数据...');
    const achievementResult = await warmupAchievements();
    results.push(achievementResult);
    
    // 6. 预加载 Agent 配置
    logger.info('\n[6/6] 预加载 Agent 配置...');
    const agentResult = await warmupAgentConfigs();
    results.push(agentResult);
    
    // 输出统计信息
    logger.info('\n' + '='.repeat(60));
    logger.info('✅ 缓存预热完成！');
    logger.info('='.repeat(60));
    
    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    logger.info(`总耗时：${totalDuration}ms`);
    logger.info(`成功：${successCount}/${totalCount}`);
    
    for (const result of results) {
      const status = result.success ? '✅' : '❌';
      logger.info(`${status} ${result.step}: ${result.count} 项 (${result.duration}ms)`);
      if (result.error) {
        logger.warn(`   错误：${result.error}`);
      }
    }
    
    // 输出缓存统计
    const cacheStats = responseCache.getStats();
    logger.info('\n缓存统计:');
    logger.info(`  缓存大小：${cacheStats.size}`);
    logger.info(`  命中率：${(cacheStats.hitRate * 100).toFixed(2)}%`);
    
  } catch (error: any) {
    logger.error('❌ 缓存预热失败:', error.message);
    logger.error(error.stack);
  } finally {
    // 关闭数据库连接
    await prisma.$disconnect();
    logger.info('\n数据库连接已关闭');
  }
}

/**
 * 预热 Prompt 配置
 */
async function warmupPrompts(): Promise<WarmupResult> {
  const startTime = Date.now();
  let success = 0;
  let failed = 0;
  
  try {
    for (const agentId of WARMUP_CONFIG.agentIds) {
      for (const strategy of WARMUP_CONFIG.promptStrategies) {
        try {
          const result = await promptCache.getCachedPrompt(agentId, strategy);
          if (result) {
            success++;
          } else {
            failed++;
          }
        } catch (error: any) {
          logger.warn(`预加载 Prompt 失败 [${agentId}:${strategy}]:`, error.message);
          failed++;
        }
      }
    }
    
    return {
      step: 'Prompt 配置',
      success: failed === 0,
      count: success,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: 'Prompt 配置',
      success: false,
      count: success,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 预热用户状态
 */
async function warmupUserStates(): Promise<WarmupResult> {
  const startTime = Date.now();
  let count = 0;
  
  try {
    // 获取最近 24 小时内活跃的登录用户
    const activeUsers = await prisma.users.findMany({
      where: {
        updatedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      take: WARMUP_CONFIG.activeUserLimit,
      select: {
        id: true,
        email: true,
        name: true
      }
    });
    
    // 预加载每个用户的状态
    for (const user of activeUsers) {
      try {
        await queryCache.getCachedStudentState(user.id);
        await queryCache.getCachedUserInfo(user.id);
        await queryCache.getCachedUserAchievements(user.id);
        count++;
      } catch (error: any) {
        logger.warn(`预加载用户状态失败 [${user.id}]:`, error.message);
      }
    }
    
    return {
      step: '用户状态',
      success: true,
      count,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: '用户状态',
      success: false,
      count: 0,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 预热任务信息
 */
async function warmupTaskInfo(): Promise<WarmupResult> {
  const startTime = Date.now();
  let count = 0;
  
  try {
    // 获取热门任务（最近完成的 subtasks）
    const popularTasks = await prisma.subtasks.findMany({
      where: {
        completedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)  // 最近 7 天
        }
      },
      orderBy: { completedAt: 'desc' },
      take: WARMUP_CONFIG.popularTaskLimit
    });
    
    // 预加载任务信息
    for (const task of popularTasks) {
      try {
        await queryCache.getCachedTaskInfo(task.id);
        count++;
      } catch (error: any) {
        logger.warn(`预加载任务信息失败 [${task.id}]:`, error.message);
      }
    }
    
    return {
      step: '任务信息',
      success: true,
      count,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: '任务信息',
      success: false,
      count: 0,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 预热学习路径信息
 */
async function warmupPathInfo(): Promise<WarmupResult> {
  const startTime = Date.now();
  let count = 0;
  
  try {
    // 获取热门学习路径（最近创建的路径）
    const popularPaths = await prisma.learning_paths.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)  // 最近 30 天
        }
      },
      orderBy: { createdAt: 'desc' },
      take: WARMUP_CONFIG.popularPathLimit
    });
    
    // 预加载路径信息
    for (const path of popularPaths) {
      try {
        await queryCache.getCachedPathInfo(path.id);
        count++;
      } catch (error: any) {
        logger.warn(`预加载路径信息失败 [${path.id}]:`, error.message);
      }
    }
    
    return {
      step: '学习路径',
      success: true,
      count,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: '学习路径',
      success: false,
      count: 0,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 预热成就数据
 */
async function warmupAchievements(): Promise<WarmupResult> {
  const startTime = Date.now();
  
  try {
    if (WARMUP_CONFIG.preloadAchievements) {
      await queryCache.getCachedAchievements();
    }
    
    return {
      step: '成就数据',
      success: true,
      count: WARMUP_CONFIG.preloadAchievements ? 1 : 0,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: '成就数据',
      success: false,
      count: 0,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 预热 Agent 配置
 */
async function warmupAgentConfigs(): Promise<WarmupResult> {
  const startTime = Date.now();
  let count = 0;
  
  try {
    // 预加载所有 Agent 的活跃 Prompt
    for (const agentId of WARMUP_CONFIG.agentIds) {
      try {
        await promptCache.getCachedPrompt(agentId);
        count++;
      } catch (error: any) {
        logger.warn(`预加载 Agent 配置失败 [${agentId}]:`, error.message);
      }
    }
    
    return {
      step: 'Agent 配置',
      success: true,
      count,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      step: 'Agent 配置',
      success: false,
      count: 0,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * 清空所有缓存
 */
async function clearCache(): Promise<void> {
  logger.info('清空所有缓存...');
  responseCache.clear();
  logger.info('✅ 缓存已清空');
}

// 导出函数
export { warmupCache, clearCache };

// 如果直接运行此脚本
if (require.main === module) {
  warmupCache()
    .then(() => {
      logger.info('\n脚本执行完成');
      process.exit(0);
    })
    .catch(error => {
      logger.error('\n脚本执行失败:', error);
      process.exit(1);
    });
}