import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 管理端登录会话仓储（routes/admin-auth.ts 的取数层）。
 * 登录查找/最后登录时间/会话表写入与吊销；限流与 Cookie 语义留在路由/中间件。
 */

/** 登录查找：用户名或邮箱；仅活跃管理员（软删视为不存在） */
export function findAdminByLogin(name: string) {
  return prisma.users.findFirst({
    where: {
      OR: [
        { name: name },
        { email: name }
      ],
      isAdmin: true,
      deletedAt: null,
    },
  });
}

export function updateAdminLastLoginAt(adminId: string) {
  return prisma.users.update({
    where: { id: adminId },
    data: { lastLoginAt: new Date() },
  });
}

export function createAdminSession(args: Prisma.admin_sessionsCreateArgs) {
  return prisma.admin_sessions.create(args);
}

/** 登出吊销：按 jti 撤销会话表记录 */
export function revokeAdminSessionByJti(jti: string) {
  return prisma.admin_sessions.update({
    where: { jti },
    data: { revokedAt: new Date() },
  });
}

/** 当前管理员信息（软删视为不存在） */
export function findCurrentAdminProfile(userId: string) {
  return prisma.users.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isAdmin: true,
      xp: true,
      currentLevel: true,
      createdAt: true,
    },
  });
}
