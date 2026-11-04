import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { findRealUserIds, isTestAccountUser } from '../../utils/test-account';

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

/**
 * 取该用户符合筛选条件的全量原始行（有上限），供列表路由先折叠成组再对组做分页。
 * 分页/total 必须与 dedupe→会话折叠后的组同口径（#214）：故在应用层折叠前一次性取数，
 * 上限防止无界扫描；超出上限时按调用时间倒序截断，与列表最终排序方向一致。
 */
export function listUserAgentLogsForGrouping(where: Prisma.agent_call_logsWhereInput) {
  return prisma.agent_call_logs.findMany({
    where,
    orderBy: { calledAt: 'desc' },
    take: 5000,
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

/**
 * #230：模型名只写在 api-gateway 行的 metadata 上（见 gateway/api-gateway/executor），
 * 而网关行不在默认口径的 userListed 白名单里，默认视图的主取数（listUserAgentLogsForGrouping）
 * 拿不到它，于是折叠组的 model 恒为 null。这里按**已选中行的 traceId 集合**单独补取网关行，
 * 不受白名单约束——补的是同一 trace 的展示元数据，不是「要展示的一行」。
 * 只 select 建模型索引所需字段；traceIds 为空时不发查询。
 */
export function listAgentLogModelRowsByTraceIds(userId: string, traceIds: string[]) {
  if (!traceIds.length) return Promise.resolve([] as Array<{ traceId: string | null; metadata: string | null }>);
  return prisma.agent_call_logs.findMany({
    where: { userId, agentId: 'api-gateway', traceId: { in: traceIds } },
    select: { traceId: true, metadata: true }
  });
}

export function markOnboardingCompleted(userId: string) {
  return prisma.users.update({
    where: { id: userId },
    data: { onboardingCompleted: true }
  });
}

// ---------- 管理域（/admin/users） ----------

/** 「课堂（节）」不计的会话状态：discarded 是用户点「重新开始」丢掉的旧会话、timeout 是
 *  跑飞后被打断的会话，两者都没真正上成一节课——直接取关系计数会把它们算进节数
 *  （演示数据里该列 19 节有 12 节是这两类，真上成的只有 7 节）。与 learning-state-reads
 *  里「真实学习时长」排除终态会话同向。 */
const UNCOUNTED_SESSION_STATUSES = ['discarded', 'timeout'] as const;

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
          /* 过滤计数而非新增字段：响应里 _count.teaching_sessions 仍是数字，
             live.ts 与已删视图（同走本函数）的取数都不用跟着改 */
          teaching_sessions: { where: { status: { notIn: [...UNCOUNTED_SESSION_STATUSES] } } }
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
      /** 虚拟/测试账号标记（2026-10-12）：学习者详情页是用户作用域，虚拟/测试口径从账号
       *  自身身份来（isVirtualLearner → 数据取数带 includeTest），不取决于入口是否携带旗标 */
      isVirtualLearner: true,
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

/** 全部真实用户 id（全员通知等批量目标；排除虚拟学习者与测试/审计账号）。
 *  判据单点在 utils/test-account.ts，不用 Prisma startsWith（SQLite LIKE 的 `_` 是通配符）。 */
export function listRealUserIds() {
  return findRealUserIds().then((ids) => ids.map((id) => ({ id })));
}

/**
 * 学员 id 清单（全员通知用）：真实账号里再摘掉管理员。
 *
 * 2026-11-01 外部评审（五轮 P2）：站内通知的「全员（真实用户）」会把 admin 也算进去——
 * 教学向通知（如「学习周报已生成」）发给管理员，受众口径不成立。管理员要收通知就定向发。
 */
export function listLearnerIds() {
  return prisma.users
    .findMany({
      where: { isVirtualLearner: false, isAdmin: false, deletedAt: null },
      select: { id: true, email: true, name: true },
    })
    .then((rows) => rows.filter((row) => !isTestAccountUser(row)).map((row) => ({ id: row.id })));
}
