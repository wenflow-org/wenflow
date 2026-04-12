// 成就服务
// Achievement Service - Handle achievements unlocking and tracking

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import AchievementSystem, { ACHIEVEMENTS, type AchievementDefinition } from './achievement-system';
import stateTrackingService from '../learning/state-tracking.service';

interface UserStats {
  completedTasks: number;
  currentStreak: number;
  completedPaths: number;
  totalPaths: number;
  ktl: number;
  weekCompletionRate?: number;
  timeEfficiency?: number;
}

class AchievementService {
  /**
   * 检查并解锁成就
   */
  async checkAndUnlockAchievements(userId: string): Promise<AchievementDefinition[]> {
    try {
      // 1. 获取用户统计
      const stats = await this.getUserStats(userId);

      // 2. 检查哪些成就可以解锁
      const unlocked = AchievementSystem.checkAchievements(stats);

      // 3. 过滤掉已经解锁的成就
      const newAchievements: AchievementDefinition[] = [];

      for (const achievement of unlocked) {
        const exists = await prisma.achievements.findFirst({
          where: {
            userId,
            type: achievement.type,
            title: achievement.name
          }
        });

if (!exists) {
          // 保存新成就
          await prisma.achievements.create({
            data: {
              id: `ach_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              userId,
              type: achievement.type,
              title: achievement.name,
              description: achievement.description,
              iconUrl: achievement.icon,
              xpReward: achievement.xpReward,
              earnedAt: new Date()
            }
          });

          // 奖励XP
          await prisma.users.update({
            where: { id: userId },
            data: {
              xp: { increment: achievement.xpReward }
            }
          });

          newAchievements.push(achievement);

          logger.info(`成就解锁: ${achievement.name}`, {
            userId,
            xpReward: achievement.xpReward
          });
        }
      }

      return newAchievements;
    } catch (error) {
      logger.error('检查成就失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户成就列表
   */
  async getUserAchievements(userId: string): Promise<
    Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      iconUrl: string | null;
      xpReward: number;
      earnedAt: Date | null;
    }>
  > {
    try {
      const achievements = await prisma.achievements.findMany({
        where: { userId },
        orderBy: { unlockedAt: 'desc' }
      });

      return achievements.map(a => ({
        id: a.id,
        type: a.type ?? 'milestone',
        title: a.title,
        description: a.description ?? '',
        iconUrl: a.iconUrl,
        xpReward: a.xpReward ?? 0,
        earnedAt: a.unlockedAt
      }));
    } catch (error) {
      logger.error('获取用户成就失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有成就及其解锁状态
   */
  async getAllAchievementsWithStatus(
    userId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      xpReward: number;
      type: string;
      unlocked: boolean;
      progress?: {
        current: number;
        total: number;
        percentage: number;
      };
      earnedAt?: Date;
    }>
  > {
    try {
      // 获取用户已解锁的成就
      const userAchievements = await prisma.achievements.findMany({
        where: { userId }
      });

      const unlockedSet = new Set(
        userAchievements.map(a => `${a.type}-${a.title}`)
      );

      // 获取用户统计
      const stats = await this.getUserStats(userId);

      // 返回所有成就及其状态
      return ACHIEVEMENTS.map(achievement => {
        const key = `${achievement.type}-${achievement.name}`;
        const unlocked = unlockedSet.has(key);

        const userAchievement = userAchievements.find(
          a => a.type === achievement.type && a.title === achievement.name
        );

        // 计算进度
        const progress = AchievementSystem.getAchievementProgress(
          achievement,
          stats
        );

        return {
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon ?? '🏆',
          xpReward: achievement.xpReward,
          type: achievement.type,
          unlocked,
          progress,
          earnedAt: userAchievement?.earnedAt
        };
      });
    } catch (error) {
      logger.error('获取成就列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户统计（用于成就检测）
   */
  private async getUserStats(userId: string): Promise<UserStats> {
    try {
      // 完成的任务数
      const completedTasks = await prisma.subtasks.count({
        where: {
          userId,
          status: 'completed'
        }
      });

      // 完成的学习路径数
      const completedPaths = await prisma.learning_paths.count({
        where: {
          userId,
          milestones: {
            some: {
              subtasks: {
                some: {
                  status: 'completed'
                }
              }
            }
          }
        }
      });

      // 总学习路径数
      const totalPaths = await prisma.learning_paths.count({
        where: { userId }
      });

      // 当前KTL
      const currentState = await stateTrackingService.getCurrentState(userId);
      const ktl = currentState?.ktl ?? 0;

      // 计算连续学习天数（简化版，实际可能需要更复杂的逻辑）
      // 注意：endTime是必需字段，无需过滤null值
      const sessions = await prisma.learning_sessions.findMany({
        where: {
          userId
        },
        orderBy: { startTime: 'desc' },
        take: 30
      });

      let currentStreak = 0;
      const dates = new Set<string>();

      for (const session of sessions) {
        if (session.endTime) {
          const date = session.endTime.toISOString().split('T')[0];
          if (!dates.has(date)) {
            dates.add(date);
            currentStreak++;
          }
        }
      }

      return {
        completedTasks,
        currentStreak,
        completedPaths,
        totalPaths,
        ktl
      };
    } catch (error) {
      logger.error('获取用户统计失败:', error);
      throw error;
    }
  }

  /**
   * 触发成就检测（在特定事件后调用）
   */
  async triggerAchievementCheck(
    userId: string,
    eventType: 'task_completed' | 'session_ended' | 'path_completed'
  ): Promise<AchievementDefinition[]> {
    logger.info(`触发成就检测: ${eventType}`, { userId });

    return await this.checkAndUnlockAchievements(userId);
  }
}

export default new AchievementService();
