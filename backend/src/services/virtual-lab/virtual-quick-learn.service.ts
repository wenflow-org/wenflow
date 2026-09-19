import prisma from '../../config/database';

/**
 * Admin 虚拟学习者「账号自动学习」前置查询单点。
 *
 * 供 `routes/admin/virtual-quick-learn.ts` 消费：按 profileId 取虚拟学习者档案、
 * 列出其绑定账号名下的可学任务树（path → milestones → subtasks）。DB 访问收敛到服务层。
 */

/** 按 id 读取虚拟学习者档案 */
export function findVirtualLearnerProfileById(id: string) {
  return prisma.virtual_learner_profiles.findUnique({ where: { id } });
}

/** 该账号名下 active 学习路径（含里程碑/任务序，最多 20 条，updatedAt 倒序） */
export function listActiveLearnablePaths(userId: string) {
  return prisma.learning_paths.findMany({
    where: { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: {
      milestones: {
        orderBy: { order: 'asc' },
        include: { subtasks: { orderBy: { order: 'asc' } } },
      },
    },
  });
}
