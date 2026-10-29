import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 虚拟模拟会话仓储（routes/admin/virtual-learners.ts 的取数层）。
 * 由 route 下沉：virtual_sessions / goal_conversations / admin_audit_logs /
 * virtual_experiment_leases 的直连集中于此；租约与事务编排仍留在路由/协调器。
 */

export function findSessionById(sessionId: string) {
  return prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
}

/** 会话详情视图：带画像与用户信息 */
export function findSessionWithProfileAndUser(sessionId: string) {
  return prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    include: {
      virtual_learner_profiles: {
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        }
      }
    }
  });
}

/** 会话绑定的目标对话（详情组装用） */
export function findGoalConversationById(id: string) {
  return prisma.goal_conversations.findFirst({
    where: { id }
  });
}

/**
 * 故事「在用」检查（issue #90）：该画像名下**全部**会话的 story 快照字段。
 * 不带样本截断（findProfileWithRecentSessions 只取 200 条）：删除守卫必须看到全量，
 * 否则 200 条之外的会话会被判「无人引用」而放行删除、留成孤儿。
 * 判据与读侧 `GET /:id/stories` 同源（isSameStory 对 stageResults.story 的匹配）。
 */
export function findSessionsForStoryUsage(profileId: string) {
  return prisma.virtual_sessions.findMany({
    where: { virtualProfileId: profileId },
    select: { id: true, status: true, stageResults: true },
  });
}

/** 画像最近一条会话（2026-10-29 审计 M-16）：管理端记忆池解析「该实例当前模拟钟」的锚点——
 *  会话级时钟（stageResults.simulationClock，advance-day 推进落在这里）优先取自它。 */
export function findLatestSessionForProfile(profileId: string) {
  return prisma.virtual_sessions.findFirst({
    where: { virtualProfileId: profileId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, stageResults: true, createdAt: true },
  });
}

/** runDayLearning 前置探测：当前阶段与状态 */
export function findSessionStageFields(sessionId: string) {
  return prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    select: { currentStage: true, status: true },
  });
}

/** 逐节循环后的完成态探测 */
export function findSessionStatus(sessionId: string) {
  return prisma.virtual_sessions.findUnique({ where: { id: sessionId }, select: { status: true } });
}

/** stageResults 回写（含 updatedAt 触碰）：simulation-config / clock / 暂停恢复等 */
export function updateSessionStageResults(sessionId: string, stageResultsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: { stageResults: stageResultsJson, updatedAt: new Date() }
  });
}

/** 仅覆写 stageResults（不触碰 updatedAt）：回归运行的系统提示词覆盖 */
export function overwriteSessionStageResults(sessionId: string, stageResultsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: { stageResults: stageResultsJson }
  });
}

/** 批量终止候选：按 sessionIds 或 profileIds 圈定的非终态会话（最多 50 条） */
export function findSessionsForTerminate(ids: string[], profileIds: string[]) {
  return prisma.virtual_sessions.findMany({
    where: {
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(profileIds.length ? [{ virtualProfileId: { in: profileIds } }] : [])
      ]
    },
    select: {
      id: true,
      virtualProfileId: true,
      status: true,
      currentStage: true,
      stageResults: true,
      logs: true,
      updatedAt: true,
      virtual_learner_profiles: { select: { userId: true } }
    },
    orderBy: { updatedAt: 'desc' },
    take: 50
  });
}

/** 终止前撤销活跃租约（模型可能缺失，调用方自带 catch） */
export function deleteSessionLeases(sessionId: string) {
  return prisma.virtual_experiment_leases?.deleteMany({ where: { sessionId } });
}

/** 单会话终态化（operator 批量终止）：abandoned + 终态时间戳。
 *  日志轨迹改走 virtual_session_logs 子表（appendSessionLogs），不再经列写回。 */
export function markSessionAbandoned(sessionId: string, terminatedAt: Date, stageResultsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: {
      status: 'abandoned',
      completedAt: terminatedAt,
      stageResults: stageResultsJson,
      updatedAt: terminatedAt
    }
  });
}

export function createAdminAuditLog(args: { data: Prisma.admin_audit_logsCreateInput }) {
  return prisma.admin_audit_logs.create(args);
}

/**
 * 会话读侧范围：只认派生实例的会话（2026-10-25「不播种，都派生」）。
 *
 * 身份池里的模板卡与派生实例同表（`virtual_learner_profiles`），模板卡理论上不该有运行记录，
 * 但历史库里有（预置卡当年直接当过学习者跑过）。列表既然只列派生实例，全量聚合（状态条 /
 * 仿真看板 / 卡死候选 / 平均时长）也必须同范围，否则会出现「列表 0 人、完成率却有数」。
 * 判据与 `virtual-learner-profile.repo` 的 DERIVED_INSTANCE_WHERE 同源（profile JSON 含 derivedFrom）。
 */
const DERIVED_PROFILE_FILTER = { profile: { contains: '"derivedFrom"' } } as const
const DERIVED_SESSION_SCOPE = { virtual_learner_profiles: DERIVED_PROFILE_FILTER } as const

/** 全量会话状态聚合（列表状态条 / 仿真看板共用；范围=派生实例） */
export function getSessionStatusAggregates() {
  return prisma.virtual_sessions.groupBy({
    by: ['status'],
    where: DERIVED_SESSION_SCOPE,
    _count: { _all: true }
  });
}

/** 页内画像的会话状态聚合（运行/失败分区用） */
export function getPerProfileStatusAggregates(profileIds: string[]) {
  return prisma.virtual_sessions.groupBy({
    by: ['virtualProfileId', 'status'],
    where: { virtualProfileId: { in: profileIds } },
    _count: { _all: true }
  });
}

/** 页内画像的卡死会话（running 且超过阈值无写入） */
export function findStaleSessionsByProfiles(profileIds: string[], staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: {
      virtualProfileId: { in: profileIds },
      status: 'running',
      updatedAt: { lt: staleBefore }
    },
    select: { id: true, virtualProfileId: true, stageResults: true }
  });
}

/** 卡死候选全集（列表 staleCount 用；不含 updatedAt；范围=派生实例） */
export function findStaleSessionCandidates(staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: { ...DERIVED_SESSION_SCOPE, status: { in: ['running', 'created'] }, updatedAt: { lt: staleBefore } },
    select: { id: true, stageResults: true }
  });
}

/** 仿真看板卡死候选（含 updatedAt，供 maxStaleMins 计算；范围=派生实例） */
export function findStaleSessionsForStats(staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: { ...DERIVED_SESSION_SCOPE, status: { in: ['running', 'created'] }, updatedAt: { lt: staleBefore } },
    select: { id: true, stageResults: true, updatedAt: true }
  });
}

/** 在跑/暂停/停滞判定的输入（2026-10-21）：非终态会话 + autopilot 状态 + 心跳。
    不再按 status='running' 取——新会话在 goal/path 阶段是 created，却可能正被自动驾驶推进 */
export function findLiveSessionsByProfiles(profileIds: string[]) {
  return prisma.virtual_sessions.findMany({
    where: { virtualProfileId: { in: profileIds }, status: { in: ['created', 'running'] } },
    select: { id: true, virtualProfileId: true, status: true, stageResults: true, updatedAt: true }
  });
}

/** 全量非终态会话（/stats 与列表同口径：running 由 autopilot 状态推导；范围=派生实例） */
export function findLiveSessionsAll() {
  return prisma.virtual_sessions.findMany({
    where: { ...DERIVED_SESSION_SCOPE, status: { in: ['created', 'running'] } },
    select: { id: true, status: true, stageResults: true, updatedAt: true }
  });
}

/** 运行中口径细分（识别 autopilot=stopped 的「已暂停」）——2026-10-21 起仅存量引用，列表改用 live 会话分类 */
export function findRunningSessionsByProfiles(profileIds: string[]) {
  return prisma.virtual_sessions.findMany({
    where: { virtualProfileId: { in: profileIds }, status: 'running' },
    select: { id: true, virtualProfileId: true, stageResults: true }
  });
}

/** 全局运行中会话（/stats 同口径细分用：running 扣 autopilot=stopped，与列表逐画像口径一致；
    范围=派生实例，与 findLiveSessionsAll 同源） */
export function findRunningSessionsForStats() {
  return prisma.virtual_sessions.findMany({
    where: { ...DERIVED_SESSION_SCOPE, status: 'running' },
    select: { id: true, stageResults: true }
  });
}

/** 终态会话（平均时长计算用；范围=派生实例） */
export function findTerminalSessions() {
  return prisma.virtual_sessions.findMany({
    where: { ...DERIVED_SESSION_SCOPE, status: { in: ['completed', 'failed', 'abandoned'] } },
    select: { createdAt: true, updatedAt: true }
  });
}

/** 今日虚拟/测试账号调用数（agent_call_logs）；仿真看板核心指标，与总览页真实口径互斥 */
export async function countTodayVirtualAgentCalls(): Promise<number> {
  const virtualIds = (
    await prisma.users.findMany({
      where: {
        OR: [
          { isVirtualLearner: true },
          { email: { startsWith: 'virtual_' } },
          { email: { endsWith: '@test.local' } }
        ]
      },
      select: { id: true }
    })
  ).map(u => u.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return prisma.agent_call_logs.count({
    where: {
      calledAt: { gte: today, lt: tomorrow },
      userId: { in: virtualIds }
    }
  });
}

/** 回归对比：成对取两个会话 */
export function findSessionsByIdPair(sessionA: string, sessionB: string) {
  return Promise.all([
    prisma.virtual_sessions.findUnique({ where: { id: sessionA } }),
    prisma.virtual_sessions.findUnique({ where: { id: sessionB } })
  ]);
}
