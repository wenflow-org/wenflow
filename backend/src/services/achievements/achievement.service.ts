// 成就服务
// Achievement Service - Handle achievements unlocking and tracking

import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { logger } from '../../utils/logger';
import AchievementSystem, { ACHIEVEMENTS, type AchievementDefinition } from './achievement-system';
import learningStateService from '../learning/learning-state.service';

interface UserStats {
  completedTasks: number;
  currentStreak: number;
  completedPaths: number;
  totalPaths: number;
  ktl: number;
  weekCompletionRate?: number;
  timeEfficiency?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function achievementRecordId(userId: string, achievementId: string): string {
  return `ach_${userId}_${achievementId}`;
}

export function calculateCurrentStreak(endTimes: Date[], now = new Date()): number {
  const dateKeys = new Set(endTimes.map((date) => date.toISOString().slice(0, 10)));
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayKey = new Date(todayUtc).toISOString().slice(0, 10);
  const yesterdayKey = new Date(todayUtc - DAY_MS).toISOString().slice(0, 10);

  let cursor = dateKeys.has(todayKey)
    ? todayUtc
    : dateKeys.has(yesterdayKey)
      ? todayUtc - DAY_MS
      : null;
  let streak = 0;

  while (cursor !== null && dateKeys.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= DAY_MS;
  }

  return streak;
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

        if (exists) continue;

        const unlockedAt = new Date();
        try {
          await prisma.$transaction(async (tx) => {
            await tx.achievements.create({
              data: {
                id: achievementRecordId(userId, achievement.id),
                userId,
                type: achievement.type,
                title: achievement.name,
                description: achievement.description,
                iconUrl: achievement.icon,
                completed: true,
                xpReward: achievement.xpReward,
                unlockedAt,
                earnedAt: unlockedAt
              }
            });
            await this.addXp(userId, achievement.xpReward, tx);
          });
        } catch (error) {
          // 稳定主键充当并发 claim；另一请求已解锁时不重复发放 XP。
          if ((error as { code?: string })?.code === 'P2002') continue;
          throw error;
        }

        newAchievements.push(achievement);

        logger.info(`成就解锁: ${achievement.name}`, {
          userId,
          xpReward: achievement.xpReward
        });
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
        orderBy: { earnedAt: 'desc' }
      });

      return achievements.map(a => ({
        id: a.id,
        type: a.type ?? 'milestone',
        title: a.title,
        description: a.description ?? '',
        iconUrl: a.iconUrl,
        xpReward: a.xpReward ?? 0,
        earnedAt: a.unlockedAt || a.earnedAt
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

      // 完成的学习路径数（所有 milestone 均 completed）
      const pathsWithAllMilestonesCompleted = await prisma.learning_paths.findMany({
        where: { userId },
        select: {
          id: true,
          status: true,
          milestones: {
            select: { status: true }
          }
        }
      });

      // 失败或仍在生成的占位路径不属于“应完成路径”。
      const eligiblePaths = pathsWithAllMilestonesCompleted.filter(path =>
        path.milestones.length > 0 && path.status !== 'failed' && path.status !== 'generating'
      );
      const completedPaths = eligiblePaths.filter(path =>
        path.milestones.every(m => m.status === 'completed')
      ).length;
      const totalPaths = eligiblePaths.length;

      // 成就阈值使用 canonical 内部尺度（0-10），展示 API 继续使用 0-100。
      const currentState = await learningStateService.getCurrentState(userId);
      const ktl = currentState?.ktl ?? 0;

      // streak 只需覆盖最长 30 天成就，按 UTC 自然日从今天或昨天连续回溯。
      const streakWindowStart = new Date(Date.now() - 31 * DAY_MS);
      const sessions = await prisma.teaching_sessions.findMany({
        where: {
          userId,
          status: 'completed',
          wrapup: { not: null },
          endTime: { gte: streakWindowStart }
        },
        select: { endTime: true },
        orderBy: { endTime: 'desc' }
      });

      const currentStreak = calculateCurrentStreak(
        sessions.flatMap((session) => session.endTime ? [session.endTime] : [])
      );

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

  /**
   * users.xp 唯一写入口（边界契约 B3：xp 收敛到成就域服务）
   * @param tx 可选事务客户端（调用方在事务内时传入，参与同一事务）
   */
  async addXp(userId: string, amount: number, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.users.update({
      where: { id: userId },
      data: { xp: { increment: amount } },
    });
  }
}

export default new AchievementService();
