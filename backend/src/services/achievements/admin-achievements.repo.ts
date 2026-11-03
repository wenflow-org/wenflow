import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 成就管理仓储（routes/admin/achievements.ts 的取数层）。
 * 发放/撤回走 withTransaction（tx.* 在路由内编排），此处只承载非事务取数。
 */

/** 每个成就定义（type×title）已被解锁的用户数。
 *  where 由调用方给定读数口径：定义卡与解锁记录表必须同源，否则同一页两套数对不上。 */
export function groupAchievementUnlockCounts(where: Prisma.achievementsWhereInput = {}) {
  return prisma.achievements.groupBy({
    by: ['type', 'title'],
    where,
    _count: { _all: true },
  });
}

export function listAchievementRecordsForAdmin(where: Prisma.achievementsWhereInput, orderBy: Prisma.achievementsOrderByWithRelationInput[], skip: number, limit: number) {
  return prisma.achievements.findMany({
    where,
    orderBy,
    skip,
    take: limit,
    include: {
      users: {
        select: { id: true, name: true, email: true, isVirtualLearner: true },
      },
    },
  });
}

export function countAchievementRecords(where: Prisma.achievementsWhereInput) {
  return prisma.achievements.count({ where });
}

/** 手动发放前置：目标用户存在性与虚拟标记 */
export function findUserGrantTarget(userId: string) {
  return prisma.users.findUnique({ where: { id: userId }, select: { id: true, isVirtualLearner: true } });
}

/** 发放去重：同用户同类型同标题已解锁则拒绝 */
export function findUserAchievementOfType(userId: string, type: string, title: string) {
  return prisma.achievements.findFirst({
    where: { userId, type, title },
  });
}

export function findAchievementRecord(recordId: string) {
  return prisma.achievements.findUnique({ where: { id: recordId } });
}
