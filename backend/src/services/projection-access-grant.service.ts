import prisma from '../config/database';
import { withTransaction } from '../utils/with-transaction';
import type { Prisma } from '@prisma/client';

/**
 * 投影访问授权（`projection_access_grants`）查询与写入。
 *
 * 管理端（查看/签发投影 token）与用户端（自建/撤销授权）共用本模块，
 * 把 DB 访问收敛到服务层，路由层只做参数校验与响应整形（行为保持不变）。
 */

/** 管理端列表/详情需要带出用户基本信息（name/email 展示） */
const GRANT_USER_INCLUDE = {
  users: {
    select: { id: true, name: true, email: true },
  },
} as const;

/** 用户端列表：按创建时间倒序（不含 users 关系） */
export function listProjectionAccessGrants(
  where: Prisma.projection_access_grantsWhereInput
) {
  return prisma.projection_access_grants.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

/** 管理端列表：按创建时间倒序并附带 users 关系 */
export function listProjectionAccessGrantsWithUser(
  where: Prisma.projection_access_grantsWhereInput
) {
  return prisma.projection_access_grants.findMany({
    where,
    include: GRANT_USER_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

/** 管理端详情：按 id 读取并附带 users 关系 */
export function findProjectionAccessGrantWithUser(id: string) {
  return prisma.projection_access_grants.findUnique({
    where: { id },
    include: GRANT_USER_INCLUDE,
  });
}

/** 用户端撤销前定位：id + userId 双条件（避免越权撤销他人授权） */
export function findUserProjectionAccessGrant(id: string, userId: string) {
  return prisma.projection_access_grants.findFirst({
    where: { id, userId },
  });
}

export interface CreateProjectionAccessGrantInput {
  userId: string;
  scope: 'dashboard' | 'full';
  scopeDefinition: string | null;
  purpose: string | null;
  expiresAt: Date;
}

/**
 * 用户自建授权：同一事务内先撤销该用户全部活跃授权，再创建新授权。
 * where/data 与既有路由实现逐字一致。
 */
export function createProjectionAccessGrant(input: CreateProjectionAccessGrantInput) {
  const now = new Date();
  return withTransaction(async (tx) => {
    await tx.projection_access_grants.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    return tx.projection_access_grants.create({
      data: {
        userId: input.userId,
        scope: input.scope,
        scopeDefinition: input.scopeDefinition,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      },
    });
  }, { label: 'user-developer.createGrant' });
}

/** 用户端撤销：仅撤销目标授权（id + userId + 活跃条件） */
export function revokeProjectionAccessGrant(id: string, userId: string, now: Date) {
  return prisma.projection_access_grants.updateMany({
    where: {
      id,
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { revokedAt: now },
  });
}
