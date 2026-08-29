// 内容管理路由（admin 后台：学习路径治理）
// 挂载: /api/admin/learning-content
// 功能：全局学习路径列表（含统计）/ 路径详情 / 下线与恢复（内容治理）/
//       低质量路径标记 / 路径删除（级联子表由外键处理）
import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';
import { logger } from '../../utils/logger';
import { REAL_USER_WHERE } from '../../utils/test-account';

const router = express.Router();

router.use(authMiddleware);

const ensureAdmin = async (userId?: string) => {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
};

/** 路径列表（全局内容治理视图：跨用户内容目录，非单用户视角） */
router.get('/paths', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const status = typeof req.query.status === 'string' && req.query.status.trim() ? String(req.query.status).trim() : undefined;
    const subject = typeof req.query.subject === 'string' && req.query.subject.trim() ? String(req.query.subject).trim() : undefined;
    const keyword = typeof req.query.keyword === 'string' && req.query.keyword.trim() ? String(req.query.keyword).trim() : undefined;
    const includeTest = String(req.query.includeTest || '') === 'true';

    const where: any = {};
    if (status) where.status = status;
    if (subject) where.subject = subject;
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { description: { contains: keyword } },
        { users: { name: { contains: keyword } } },
      ];
    }
    // 内容治理默认仅真实用户；includeTest=1 时含虚拟/测试
    if (!includeTest) where.users = REAL_USER_WHERE;

    const [paths, total] = await Promise.all([
      prisma.learning_paths.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          subject: true,
          status: true,
          difficulty: true,
          estimatedHours: true,
          totalMilestones: true,
          completedMilestones: true,
          aiGenerated: true,
          createdAt: true,
          updatedAt: true,
          deadline: true,
          users: { select: { id: true, name: true, email: true, isVirtualLearner: true } },
          milestones: {
            select: { id: true, status: true, title: true },
          },
          _count: { select: { milestones: true } },
        },
      }),
      prisma.learning_paths.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        paths: paths.map((p) => ({
          id: p.id,
          title: p.title,
          subject: p.subject,
          status: p.status,
          difficulty: p.difficulty,
          estimatedHours: p.estimatedHours,
          totalMilestones: p.totalMilestones,
          completedMilestones: p.completedMilestones,
          aiGenerated: p.aiGenerated,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          deadline: p.deadline,
          user: p.users
            ? { id: p.users.id, name: p.users.name, email: p.users.email, isVirtualLearner: p.users.isVirtualLearner }
            : null,
          milestoneStatuses: p.milestones.map((m) => m.status),
          milestoneCount: p._count.milestones,
        })),
        pagination: { total, page, limit },
      },
    });
  } catch (error: any) {
    logger.error('[admin-learning-content] 获取路径列表失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取路径列表失败', status: 500 } });
  }
});

/** 路径详情（含 milestones + subtasks，供治理页查看内容结构） */
router.get('/paths/:id', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const path = await prisma.learning_paths.findUnique({
      where: { id: req.params.id },
      include: {
        users: { select: { id: true, name: true, email: true, isVirtualLearner: true } },
        milestones: {
          orderBy: { order: 'asc' },
          include: {
            subtasks: { orderBy: { order: 'asc' }, select: { id: true, title: true, status: true, taskType: true, estimatedMinutes: true, completedAt: true, cognitiveLoad: true } },
          },
        },
      },
    });
    if (!path) return res.status(404).json({ success: false, error: { message: '路径不存在' } });

    res.json({ success: true, data: path });
  } catch (error: any) {
    logger.error('[admin-learning-content] 获取路径详情失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取路径详情失败', status: 500 } });
  }
});

/** 下线路径（内容治理：用户端不可继续学习；status=archived） */
router.post('/paths/:id/archive', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const path = await prisma.learning_paths.findUnique({ where: { id: req.params.id } });
    if (!path) return res.status(404).json({ success: false, error: { message: '路径不存在' } });

    const before = { status: path.status };
    await prisma.learning_paths.update({
      where: { id: req.params.id },
      data: { status: 'archived', updatedAt: new Date() },
    });

    setAuditAction(res, 'learning-content.archive', { targetType: 'learning-path', targetId: path.id });
    setAuditBefore(res, before);
    setAuditAfter(res, { status: 'archived', pathId: path.id, title: path.title });

    res.json({ success: true, data: { id: path.id, status: 'archived' } });
  } catch (error: any) {
    logger.error('[admin-learning-content] 下线路径失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '下线路径失败', status: 500 } });
  }
});

/** 恢复路径（archived → active） */
router.post('/paths/:id/restore', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const path = await prisma.learning_paths.findUnique({ where: { id: req.params.id } });
    if (!path) return res.status(404).json({ success: false, error: { message: '路径不存在' } });

    const before = { status: path.status };
    await prisma.learning_paths.update({
      where: { id: req.params.id },
      data: { status: 'active', updatedAt: new Date() },
    });

    setAuditAction(res, 'learning-content.restore', { targetType: 'learning-path', targetId: path.id });
    setAuditBefore(res, before);
    setAuditAfter(res, { status: 'active', pathId: path.id, title: path.title });

    res.json({ success: true, data: { id: path.id, status: 'active' } });
  } catch (error: any) {
    logger.error('[admin-learning-content] 恢复路径失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '恢复路径失败', status: 500 } });
  }
});

/** 删除路径（级联删除 milestones/subtasks/会话引用；危险操作，审计留痕） */
router.delete('/paths/:id', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const path = await prisma.learning_paths.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { milestones: true } } },
    });
    if (!path) return res.status(404).json({ success: false, error: { message: '路径不存在' } });

    setAuditAction(res, 'learning-content.delete', { targetType: 'learning-path', targetId: path.id });
    setAuditBefore(res, { pathId: path.id, title: path.title, milestoneCount: path._count.milestones });
    setAuditAfter(res, null);

    await prisma.learning_paths.delete({ where: { id: req.params.id } });
    logger.info('[admin-learning-content] 删除学习路径', { adminId: req.user?.userId, pathId: path.id });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-learning-content] 删除路径失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '删除路径失败', status: 500 } });
  }
});

/** 内容统计（治理页顶部：总数 / 按状态分布 / 按学科分布 / 里程碑与任务总量） */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const [total, byStatus, bySubject, totalMilestones, totalTasks] = await Promise.all([
      prisma.learning_paths.count({ where: { users: REAL_USER_WHERE } }),
      prisma.learning_paths.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.learning_paths.groupBy({ by: ['subject'], _count: { _all: true } }),
      prisma.milestones.count({ where: { learning_paths: { users: REAL_USER_WHERE } } }),
      prisma.subtasks.count({ where: { users: REAL_USER_WHERE } }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
        bySubject: bySubject
          .map((g) => ({ subject: g.subject, count: g._count._all }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        totalMilestones,
        totalTasks,
      },
    });
  } catch (error: any) {
    logger.error('[admin-learning-content] 获取内容统计失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取内容统计失败', status: 500 } });
  }
});

export default router;
