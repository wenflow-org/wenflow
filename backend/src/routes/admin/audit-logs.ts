// 审计日志查询路由（P3）：操作审计（admin_audit_logs）+ 登录审计（login_attempts）
// 挂载在 admin 路由链内（adminAccessRestrict + adminAuth + admin 鉴权 + ACP 上下文），
// 本路由仅含 GET 只读端点，故挂载时不经过 adminAuditMiddleware——审计查询本身不入审计。
// 与 platform.ts agents/logs 同款筛选风格：精确时间优先、快捷 timeRange 兜底、非法参数 400。
import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';

const router = Router();

const VALID_TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all'] as const;
type TimeRange = (typeof VALID_TIME_RANGES)[number];

/** 操作审计 keyword 搜索列（不入 JSON 快照列） */
const OPERATION_KEYWORD_FIELDS = ['adminName', 'action', 'path', 'targetId', 'ip'] as const;
/** 登录审计 keyword 搜索列 */
const LOGIN_KEYWORD_FIELDS = ['username', 'ip'] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** 参数校验错误 → 400（区别于系统错误 → next(error)） */
class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterError';
  }
}

/** 可空字符串参数：undefined/空串/数组取首元素；其余原样字符串化 */
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw).trim();
  return text ? text : undefined;
}

/** success 参数：'true'/'false' → 布尔；其余 400 */
function parseSuccess(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  throw new FilterError(`非法 success 参数: ${String(raw)}（可选值: true/false）`);
}

/** 正整数解析：缺省取 defaultValue；非正整数 → 400 */
function parsePositiveInt(value: unknown, defaultValue: number, name: string): number {
  if (value === undefined || value === null) return defaultValue;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FilterError(`非法 ${name} 参数: ${String(raw)}（需为正整数）`);
  }
  return parsed;
}

/** 快捷 timeRange（本地时区当日 00:00 起点，与 platform.ts 同款） */
function timeRangeBounds(range: TimeRange): { gte?: Date; lt?: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case 'today':
      return { gte: today };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { gte: yesterday, lt: today };
    }
    case 'week': {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { gte: weekAgo };
    }
    case 'month': {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { gte: monthAgo };
    }
    case 'all':
      return {};
  }
}

/** 时间筛选：startTime/endTime 精确优先；否则 timeRange 快捷范围（省略/all = 全部） */
function buildTimeWhere(query: Record<string, unknown>): Record<string, Date> | undefined {
  const startTime = optionalString(query.startTime);
  const endTime = optionalString(query.endTime);
  if (startTime || endTime) {
    const bounds: Record<string, Date> = {};
    if (startTime) {
      const date = new Date(startTime);
      if (Number.isNaN(date.getTime())) throw new FilterError(`非法 startTime 参数: ${startTime}（需为 ISO 时间字符串）`);
      bounds.gte = date;
    }
    if (endTime) {
      const date = new Date(endTime);
      if (Number.isNaN(date.getTime())) throw new FilterError(`非法 endTime 参数: ${endTime}（需为 ISO 时间字符串）`);
      bounds.lte = date;
    }
    return bounds;
  }
  const rangeValue = optionalString(query.timeRange);
  if (!rangeValue || rangeValue === 'all') return undefined;
  if (!(VALID_TIME_RANGES as readonly string[]).includes(rangeValue)) {
    throw new FilterError(
      `非法 timeRange 参数: ${rangeValue}（可选值: ${VALID_TIME_RANGES.join('/')}）`
    );
  }
  const bounds = timeRangeBounds(rangeValue as TimeRange);
  return Object.keys(bounds).length > 0 ? bounds : undefined;
}

interface AuditQueryModel {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy: { createdAt: 'desc' };
    skip: number;
    take: number;
  }) => Promise<Array<Record<string, unknown>>>;
}

interface AuditFilter {
  scope: 'operation' | 'login';
  model: AuditQueryModel;
  where: Record<string, unknown>;
}

/** 组装筛选：scope=operation → admin_audit_logs；scope=login → login_attempts */
function buildFilter(query: Record<string, unknown>): AuditFilter {
  const scope = query.scope === 'login' ? 'login' : 'operation';
  const where: Record<string, unknown> = {};

  const timeWhere = buildTimeWhere(query);
  if (timeWhere) where.createdAt = timeWhere;

  if (scope === 'login') {
    const loginScope = query.loginScope === 'user' ? 'user' : 'admin';
    where.scope = loginScope;
    if (query.success !== undefined && query.success !== null) {
      where.success = parseSuccess(query.success);
    }
    const keyword = optionalString(query.keyword);
    if (keyword) {
      where.OR = LOGIN_KEYWORD_FIELDS.map((field) => ({ [field]: { contains: keyword } }));
    }
    return { scope, model: prisma.login_attempts as unknown as AuditQueryModel, where };
  }

  const adminId = optionalString(query.adminId);
  if (adminId) where.adminId = adminId;
  const adminName = optionalString(query.adminName);
  if (adminName) where.adminName = adminName;
  const action = optionalString(query.action);
  if (action) where.action = action;
  const targetType = optionalString(query.targetType);
  if (targetType) where.targetType = targetType;
  if (query.success !== undefined && query.success !== null) {
    where.success = parseSuccess(query.success);
  }
  const keyword = optionalString(query.keyword);
  if (keyword) {
    where.OR = OPERATION_KEYWORD_FIELDS.map((field) => ({ [field]: { contains: keyword } }));
  }
  return { scope, model: prisma.admin_audit_logs as unknown as AuditQueryModel, where };
}

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof FilterError) {
    return res.status(400).json({
      success: false,
      error: { message: error.message, status: 400 },
    });
  }
  next(error);
}

// 统计：同筛选参数（无分页）；failed = success=false 数
// 注意：/stats 必须先于 / 注册（Express 匹配顺序）
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model, where } = buildFilter(req.query as Record<string, unknown>);
    const [total, failed] = await Promise.all([
      model.count({ where }),
      model.count({ where: { ...where, success: false } }),
    ]);
    res.json({ success: true, data: { stats: { total, failed } } });
  } catch (error) {
    handleError(error, res, next);
  }
});

// 分页查询：scope=operation → data.logs；scope=login → data.attempts；均带 pagination
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scope, model, where } = buildFilter(req.query as Record<string, unknown>);
    const page = parsePositiveInt(req.query.page, 1, 'page');
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, 'limit');
    if (limit > MAX_LIMIT) {
      throw new FilterError(`limit 最大 ${MAX_LIMIT}`);
    }

    const [total, rows] = await Promise.all([
      model.count({ where }),
      model.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const pagination = { total, page, limit };
    res.json({
      success: true,
      data: scope === 'login'
        ? { attempts: rows, pagination }
        : { logs: rows, pagination },
    });
  } catch (error) {
    handleError(error, res, next);
  }
});

export default router;
