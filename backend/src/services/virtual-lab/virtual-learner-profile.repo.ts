import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 虚拟学习者画像/账号仓储（routes/admin/virtual-learners.ts 的取数层）。
 * 由 route 下沉：DB 直连集中于此，路由层保留请求语义与业务编排；
 * 返回类型一律走推断（与原路由内联调用完全同型）。
 */

/** 故事生成的「最近样本」提示数据源（buildRecentScenarioHints） */
export function findRecentProfilesForHints() {
  return prisma.virtual_learner_profiles.findMany({
    take: 12,
    orderBy: { createdAt: 'desc' },
    select: {
      profile: true,
      learningGoal: true,
      notes: true,
    },
  });
}

export function findProfileById(id: string) {
  return prisma.virtual_learner_profiles.findUnique({ where: { id } });
}

/** 记忆池遗忘曲线数据源（memory_traces 全量，按最近触达倒序） */
export function findMemoryTracesByUser(userId: string) {
  return prisma.memory_traces.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
  });
}

/** 故事摘要视图：画像 + 用户 + 最近 200 条会话 */
export function findProfileWithRecentSessions(id: string) {
  return prisma.virtual_learner_profiles.findUnique({
    where: { id },
    include: {
      users: {
        select: { id: true, email: true, name: true }
      },
      sessions: {
        orderBy: { updatedAt: 'desc' },
        take: 200,
      },
    },
  });
}

/** 详情视图：比故事摘要多 currentLevel */
export function findProfileDetail(id: string) {
  return prisma.virtual_learner_profiles.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          name: true,
          currentLevel: true
        }
      },
      sessions: {
        orderBy: { updatedAt: 'desc' },
        take: 200
      }
    }
  });
}

/** 投影 token 签发用：画像 + 用户基本信息 */
export function findProfileForProjectionToken(id: string) {
  return prisma.virtual_learner_profiles.findUnique({
    where: { id },
    include: {
      users: {
        select: { id: true, email: true, name: true }
      }
    }
  });
}

/** advance-day 时钟解析用：仅取 profile JSON 列 */
export function findProfileJsonById(profileId: string) {
  return prisma.virtual_learner_profiles.findUnique({ where: { id: profileId }, select: { profile: true } });
}

/** 故事池整体回写（生成/编辑/删除故事共用） */
export function updateProfileJsonField(id: string, profileJson: string) {
  return prisma.virtual_learner_profiles.update({
    where: { id },
    data: { profile: profileJson },
  });
}

/** 画像字段部分更新（PUT /:id） */
export function updateProfileFields(id: string, data: Record<string, unknown>) {
  return prisma.virtual_learner_profiles.update({
    where: { id },
    data
  });
}

export function updateUserName(userId: string, name: string) {
  return prisma.users.update({ where: { id: userId }, data: { name } });
}

export function createVirtualLearnerUser(args: { data: Prisma.usersCreateInput }) {
  return prisma.users.create(args);
}

export function createVirtualLearnerProfile(args: { data: Prisma.virtual_learner_profilesUncheckedCreateInput }) {
  return prisma.virtual_learner_profiles.create(args);
}

/** 列表页：画像 + 会话样本（50 条）+ 会话计数 */
export function listProfilesWithSessionSamples(skip: number, limit: number) {
  return prisma.virtual_learner_profiles.findMany({
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          name: true,
          currentLevel: true,
          createdAt: true
        }
      },
      sessions: {
        select: {
          id: true,
          status: true,
          currentStage: true,
          createdAt: true,
          updatedAt: true,
          stageResults: true,
          goalConversationId: true,
          learningPathId: true,
          currentTaskId: true,
          completedTasks: true,
          totalTasks: true
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      },
      _count: {
        select: { sessions: true }
      }
    }
  });
}

export function countProfiles() {
  return prisma.virtual_learner_profiles.count();
}
