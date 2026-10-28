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

/**
 * 同一设备登录时收掉旧会话：设备以 ip + User-Agent 识别，保留本次新 jti。
 * 管理员反复登录（含自动化测试）会在同一浏览器攒出几十条活跃会话；旧 Cookie 已被
 * 新登录覆盖，留着只让「会话安全」列表失真。缺 ip 或 UA 时不做（避免误伤无法识别的设备）。
 */
export function revokeSiblingAdminSessions(
  adminId: string,
  ip: string | null,
  userAgent: string | null,
  keepJti: string,
) {
  if (!ip || !userAgent) return Promise.resolve({ count: 0 });
  return prisma.admin_sessions.updateMany({
    where: { adminId, ip, userAgent, revokedAt: null, jti: { not: keepJti } },
    data: { revokedAt: new Date() },
  });
}

/** 每个管理员最多保留的活跃会话数（含本次登录）：不同 UA/设备的会话也封顶，
    防止脚本或长期不退出把活跃数堆到几十条。 */
export const ADMIN_ACTIVE_SESSION_LIMIT = 10;

/** 活跃会话超限时吊销最旧的几条，保留本次 jti 与最新的 limit-1 条 */
export async function trimAdminSessions(
  adminId: string,
  keepJti: string,
  limit = ADMIN_ACTIVE_SESSION_LIMIT,
): Promise<number> {
  const keep = Math.max(1, Math.floor(limit));
  const rows = await prisma.admin_sessions.findMany({
    where: { adminId, revokedAt: null, expiresAt: { gt: new Date() }, jti: { not: keepJti } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const excess = rows.length - (keep - 1);
  if (excess <= 0) return 0;
  const staleIds = rows.slice(keep - 1).map((row) => row.id);
  const result = await prisma.admin_sessions.updateMany({
    where: { id: { in: staleIds } },
    data: { revokedAt: new Date() },
  });
  return result.count;
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
