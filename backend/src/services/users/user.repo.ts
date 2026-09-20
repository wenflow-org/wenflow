import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { REAL_USER_WHERE } from '../../utils/test-account';

/**
 * 用户表仓储（routes/users.ts 自助域 + routes/admin/users.ts 管理域的取数层）。
 * 由 route 下沉：DB 直连集中于此；where 组装（请求筛选语义）留在路由层。
 */

// ---------- 自助域（/me*） ----------

/** GET /me：当前用户公开画像（含软删标记供 401 判定） */
export function findCurrentUserProfile(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      xp: true,
      role: true,
      currentLevel: true,
      createdAt: true,
      lastLoginAt: true,
      streakDays: true,
      longestStreak: true,
      onboardingCompleted: true,
      deletedAt: true
    }
  });
}

/** 学习中心全局快照兜底：最近更新的活跃路径 */
export function findActivePathIdByUpdatedAt(userId: string) {
  return prisma.learning_paths.findFirst({
    where: {
      userId,
      status: 'active'
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true }
  });
}

/** 注销前置校验：取密码哈希与软删标记 */
export function findUserForDeactivation(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, password: true, deletedAt: true }
  });
}

export function listUserAchievements(userId: string) {
  return prisma.achievements.findMany({
    where: { userId },
    orderBy: { unlockedAt: 'desc' }
  });
}

export function listUserTeachingSessions(where: Prisma.teaching_sessionsWhereInput, skip: number, take: number) {
  return prisma.teaching_sessions.findMany({
    where,
    orderBy: { startTime: 'desc' },
    skip,
    take
  });
}

export function countUserTeachingSessions(where: Prisma.teaching_sessionsWhereInput) {
  return prisma.teaching_sessions.count({ where });
}

export function findSubtasksByIds(taskIds: string[]) {
  return prisma.subtasks.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      title: true,
      status: true,
      estimatedMinutes: true
    }
  });
}

export function listUserAgentLogs(where: Prisma.agent_call_logsWhereInput, skip: number, take: number) {
  return prisma.agent_call_logs.findMany({
    where,
    orderBy: { calledAt: 'desc' },
    skip,
    take,
    select: {
      id: true,
      agentId: true,
      sourceEntry: true,
      traceId: true,
      callerAgent: true,
      success: true,
      durationMs: true,
      tokensUsed: true,
      error: true,
      errorCode: true,
      calledAt: true,
      metadata: true
    }
  });
}

export function countUserAgentLogs(where: Prisma.agent_call_logsWhereInput) {
  return prisma.agent_call_logs.count({ where });
}

export function listUserAgentLogsForExport(where: Prisma.agent_call_logsWhereInput) {
  return prisma.agent_call_logs.findMany({
    where,
    orderBy: { calledAt: 'desc' },
    take: 1000
  });
}

export function findUserAgentLogById(logId: string, userId: string) {
  return prisma.agent_call_logs.findFirst({
    where: {
      id: logId,
      userId
    }
  });
}

export function markOnboardingCompleted(userId: string) {
  return prisma.users.update({
    where: { id: userId },
    data: { onboardingCompleted: true }
  });
}

// ---------- 管理域（/admin/users） ----------

export function findUsersForAdminList(where: Prisma.usersWhereInput, skip: number, take: number) {
  return prisma.users.findMany({
    where,
    skip,
    take,
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      isVirtualLearner: true,
      xp: true,
      currentLevel: true,
      lastLoginAt: true,
      createdAt: true,
      deletedAt: true,
      _count: {
        select: {
          learning_paths: true,
          teaching_sessions: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export function countUsersWhere(where: Prisma.usersWhereInput) {
  return prisma.users.count({ where });
}

/** 用户详情（includeDeleted=1 时放行已软删账号，供回收站详情/恢复入口） */
export function findUserDetailForAdmin(userId: string, includeDeleted: boolean) {
  return prisma.users.findFirst({
    where: includeDeleted ? { id: userId } : { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      currentLevel: true,
      xp: true,
      isAdmin: true,
      role: true,
      createdAt: true,
      deletedAt: true,
      _count: {
        select: {
          learning_paths: true,
          goal_conversations: true
        }
      }
    }
  });
}

export function findUserByEmail(email: string) {
  return prisma.users.findUnique({ where: { email } });
}

export function createUser(args: Prisma.usersCreateArgs) {
  return prisma.users.create(args);
}

export function updateUser(args: Prisma.usersUpdateArgs) {
  return prisma.users.update(args);
}

/** PATCH 前置：取邮箱与管理员标记（改邮箱查重、最后管理员保护） */
export function findUserEditableFields(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isAdmin: true }
  });
}

/** 最后管理员保护：现存活跃管理员数（软删不计入） */
export function countActiveAdmins() {
  return prisma.users.count({ where: { isAdmin: true, deletedAt: null } });
}

/** 批量删除的虚拟学习者保护：命中即拒绝 */
export function findVirtualLearnerUserIds(ids: string[]) {
  return prisma.virtual_learner_profiles.findMany({
    where: { userId: { in: ids } },
    select: { userId: true }
  });
}

export function findActiveAdminIdsInBatch(ids: string[]) {
  return prisma.users.findMany({
    where: { id: { in: ids }, isAdmin: true, deletedAt: null },
    select: { id: true }
  });
}

/** 批量删除前快照（操作审计 before） */
export function findBatchDeleteTargets(ids: string[]) {
  return prisma.users.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, name: true, isAdmin: true, deletedAt: true }
  });
}

/** 批量软删除（仅未删账号，deletedAt: null 兜底幂等） */
export function softDeleteUsersBatch(ids: string[], deletedAt: Date, operatorId?: string) {
  return prisma.users.updateMany({
    where: {
      id: { in: ids },
      deletedAt: null
    },
    data: {
      deletedAt,
      deletedBy: operatorId,
      updatedAt: deletedAt
    }
  });
}

/** 角色变更前快照（操作审计 before） */
export function findUserForRoleAudit(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isAdmin: true, deletedAt: true }
  });
}

/** 删除前置：管理员标记与软删状态（幂等 409 / 最后管理员保护） */
export function findUserDeleteTarget(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, isAdmin: true, deletedAt: true }
  });
}

/** 恢复前置：软删状态（未删重复恢复 → 409 幂等） */
export function findUserRestoreTarget(userId: string) {
  return prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true }
  });
}

// ---------- 跨域共用 ----------

/** 存在性校验（发放/发送/执行前的前置检查） */
export function findUserIdOnly(userId: string) {
  return prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
}

/** 全部真实用户 id（全员通知等批量目标；排除虚拟学习者与测试/审计账号） */
export function listRealUserIds() {
  return prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } });
}
