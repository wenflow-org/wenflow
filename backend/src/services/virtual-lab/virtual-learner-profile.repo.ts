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

/** 批量存在性检查（评估用例列表标记「人设引用失效」用；避免逐条 findUnique） */
export async function filterExistingProfileIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.virtual_learner_profiles.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
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

/**
 * 虚拟学习者列表的取数范围 = **派生实例**（2026-10-25 拍板「不播种、都派生」）。
 *
 * 卡库是身份池（导入卡 / 平台生产 / 预置一键加载都只往池里放**模板卡**），虚拟学习者
 * 一律由「选角 → 派生」产生（`card-import.service.cloneCardsToLearners`）。二者同一张表，
 * 唯一年龄可辨的标记是身份克隆时写进 `profile` JSON 的 `derivedFrom`——模板卡从不写这个键
 * （写入侧只有 cloneCardsToLearners，全仓唯一）。卡墙早已按同一字段反向过滤
 * （`getCardWallIndex` 的 `!c.derivedFrom`），此处补齐另一半：列表不再把模板卡当人列。
 *
 * 该字段在 `profile` JSON 里、没有独立列，故按 JSON 子串判定（不改 schema：本库客户端的
 * 迁移面受共享生成物约束，见 `prisma/schema.prisma` 的平台数据库说明）。
 */
const DERIVED_INSTANCE_WHERE = {
  profile: { contains: '"derivedFrom"' },
} satisfies Prisma.virtual_learner_profilesWhereInput

/** 列表页：派生实例 + 会话样本（50 条）+ 会话计数（范围见 DERIVED_INSTANCE_WHERE） */
export function listProfilesWithSessionSamples(skip: number, limit: number) {
  return prisma.virtual_learner_profiles.findMany({
    where: DERIVED_INSTANCE_WHERE,
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

/** 列表分页总数与「实例数」读数同源：只数派生实例（范围与 DERIVED_INSTANCE_WHERE 一致），
    否则分页器会把身份池里的模板卡也算进来，与列表行数对不上。 */
export function countProfiles() {
  return prisma.virtual_learner_profiles.count({ where: DERIVED_INSTANCE_WHERE });
}

/** 每个画像已生成的路径数（distinct learningPathId）：一个故事可衍生多条路径，
    同一路径的多次会话不重复计。列表页用它与故事条数并置，避免把多路径学习者读成一条路径。 */
export function groupPathCountsByProfile(profileIds: string[]) {
  if (!profileIds.length) {
    return Promise.resolve([] as Array<{ virtualProfileId: string; learningPathId: string | null }>);
  }
  return prisma.virtual_sessions.groupBy({
    by: ['virtualProfileId', 'learningPathId'],
    where: { virtualProfileId: { in: profileIds }, learningPathId: { not: null } },
  });
}

/** 学习路径标题（列表「进行中」列按路径归并时要有名字，只回标题不回整条路径） */
export function findLearningPathTitles(ids: string[]) {
  if (!ids.length) return Promise.resolve([] as Array<{ id: string; title: string }>);
  return prisma.learning_paths.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });
}

/* ---------- 卡库（card-import.service）取数 ---------- */

/** 全量卡的查重索引取数：profile JSON + tags（cardKey/同源扫描用） */
export function findAllProfilesForCardIndex() {
  return prisma.virtual_learner_profiles.findMany({
    select: { id: true, profile: true, tags: true, userId: true },
  });
}

/** 导出用：自建卡（presetKey 为空） */
export function findCustomCardsForExport() {
  return prisma.virtual_learner_profiles.findMany({
    where: { presetKey: null },
    select: { profile: true, learningGoal: true, knowledgeLevel: true, tags: true, notes: true, userId: true },
  });
}

/** 卡墙索引取数（2026-10-05 卡库改版）：全部卡（预置+自建）带展示列与账号信息，新卡在前。
 *  known/struggleConcepts 供「卡 → 虚拟学习者」派生时随身份带走（2026-10-16）。 */
export function findProfilesForCardWall() {
  return prisma.virtual_learner_profiles.findMany({
    select: {
      id: true,
      userId: true,
      profile: true,
      tags: true,
      learningGoal: true,
      knowledgeLevel: true,
      knownConcepts: true,
      struggleConcepts: true,
      presetKey: true,
      notes: true,
      createdAt: true,
      users: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** 卡导入更新路径：按 profileId 取归属 userId（自带资料要写进该用户的资料库） */
export async function findProfileUserIdById(id: string): Promise<string | null> {
  const r = await prisma.virtual_learner_profiles.findUnique({ where: { id }, select: { userId: true } });
  return r?.userId ?? null;
}
