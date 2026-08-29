// 数据导出路由（admin 后台：CSV 导出）
// 挂载: /api/admin/export
// 功能：用户 / 执行日志 / 教学会话 / 反馈 / 目标对话 / 审计日志 导出为 CSV
import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
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

/** CSV 转义：双引号包裹含逗号/引号/换行的字段 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((row) => row.map(csvCell).join(','));
  return [head, ...body].join('\r\n');
}

function sendCsv(res: Response, filename: string, csv: string): void {
  // BOM 让 Excel 正确识别 UTF-8 中文
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send('\uFEFF' + csv);
}

const MAX_ROWS = 20000;

router.get('/users', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const includeTest = String(req.query.includeTest || '') === 'true';
    const where: any = { deletedAt: null };
    if (!includeTest) where.isVirtualLearner = false;

    const users = await prisma.users.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true, name: true, email: true, role: true, isAdmin: true, isVirtualLearner: true,
        xp: true, currentLevel: true, createdAt: true, lastLoginAt: true, deletedAt: true,
      },
    });

    const csv = toCsv(
      ['ID', '姓名', '邮箱', '角色', '管理员', '虚拟学习者', 'XP', '等级', '注册时间', '最近登录'],
      users.map((u) => [u.id, u.name, u.email, u.role, u.isAdmin ? '是' : '否', u.isVirtualLearner ? '是' : '否', u.xp, u.currentLevel, u.createdAt.toISOString(), u.lastLoginAt?.toISOString() || ''])
    );
    sendCsv(res, `users-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出用户失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

router.get('/agent-logs', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const limit = Math.min(MAX_ROWS, Math.max(1, Number(req.query.limit) || 1000));
    const logs = await prisma.agent_call_logs.findMany({
      orderBy: { calledAt: 'desc' },
      take: limit,
      select: {
        id: true, agentId: true, userId: true, sourceEntry: true, traceId: true,
        success: true, durationMs: true, errorCode: true, errorCategory: true, error: true,
        model: true, promptTokens: true, completionTokens: true, calledAt: true,
      },
    });

    const csv = toCsv(
      ['ID', 'Agent', '用户', '入口', 'Trace', '成功', '耗时ms', '错误码', '错误类', '错误', '模型', '输入Token', '输出Token', '时间'],
      logs.map((l) => [l.id, l.agentId, l.userId, l.sourceEntry, l.traceId || '', l.success ? '是' : '否', l.durationMs, l.errorCode || '', l.errorCategory || '', l.error || '', l.model || '', l.promptTokens ?? '', l.completionTokens ?? '', l.calledAt.toISOString()])
    );
    sendCsv(res, `agent-logs-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出执行日志失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

router.get('/teaching-sessions', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const sessions = await prisma.teaching_sessions.findMany({
      orderBy: { startTime: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true, userId: true, taskId: true, subject: true, topic: true, taskType: true,
        mode: true, status: true, duration: true, startTime: true, endTime: true,
      },
    });

    const csv = toCsv(
      ['ID', '用户', '任务', '学科', '主题', '任务类型', '模式', '状态', '时长s', '开始', '结束'],
      sessions.map((s) => [s.id, s.userId, s.taskId, s.subject, s.topic, s.taskType, s.mode, s.status, s.duration ?? '', s.startTime.toISOString(), s.endTime?.toISOString() || ''])
    );
    sendCsv(res, `teaching-sessions-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出教学会话失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

router.get('/feedback', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const items = await prisma.content_feedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true, userId: true, sessionId: true, agentId: true, rating: true,
        difficulty: true, comment: true, status: true, createdAt: true,
      },
    });

    const csv = toCsv(
      ['ID', '用户', '会话', 'Agent', '评分', '难度', '评论', '状态', '时间'],
      items.map((f) => [f.id, f.userId, f.sessionId, f.agentId, f.rating, f.difficulty ?? '', f.comment || '', f.status, f.createdAt.toISOString()])
    );
    sendCsv(res, `feedback-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出反馈失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

router.get('/goal-conversations', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const items = await prisma.goal_conversations.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: { id: true, userId: true, status: true, stage: true, description: true, createdAt: true, updatedAt: true },
    });

    const csv = toCsv(
      ['ID', '用户', '状态', '阶段', '描述', '创建', '更新'],
      items.map((g) => [g.id, g.userId, g.status, g.stage, g.description || '', g.createdAt.toISOString(), g.updatedAt.toISOString()])
    );
    sendCsv(res, `goal-conversations-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出目标对话失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const limit = Math.min(MAX_ROWS, Math.max(1, Number(req.query.limit) || 2000));
    const logs = await prisma.admin_audit_logs.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, adminName: true, action: true, targetType: true, targetId: true,
        method: true, path: true, statusCode: true, success: true, ip: true, durationMs: true, createdAt: true,
      },
    });

    const csv = toCsv(
      ['ID', '管理员', '动作', '目标类型', '目标ID', '方法', '路径', '状态码', '成功', 'IP', '耗时ms', '时间'],
      logs.map((l) => [l.id, l.adminName || '', l.action, l.targetType || '', l.targetId || '', l.method, l.path, l.statusCode, l.success ? '是' : '否', l.ip || '', l.durationMs ?? '', l.createdAt.toISOString()])
    );
    sendCsv(res, `audit-logs-${Date.now()}.csv`, csv);
  } catch (error: any) {
    logger.error('[admin-export] 导出审计日志失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '导出失败', status: 500 } });
  }
});

export default router;
