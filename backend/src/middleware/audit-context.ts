import { Response } from 'express';

/**
 * 每请求操作审计增强上下文（res.locals.audit 单例）。
 *
 * 路由 handler 内调用 setAuditAction / setAuditBefore / setAuditAfter，
 * admin-audit.middleware 在响应 finish 时读取并合并进同一条审计记录。
 */
export interface AuditContext {
  action?: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}

const AUDIT_LOCALS_KEY = 'audit';

export function getAuditContext(res: Response): AuditContext {
  // 防御式：Express 真实请求中 res.locals 恒为对象，但测试 mock / 异常中间件可能缺省
  if (!res.locals || typeof res.locals !== 'object') {
    (res as { locals: Record<string, unknown> }).locals = {};
  }
  if (!res.locals[AUDIT_LOCALS_KEY] || typeof res.locals[AUDIT_LOCALS_KEY] !== 'object') {
    res.locals[AUDIT_LOCALS_KEY] = {};
  }
  return res.locals[AUDIT_LOCALS_KEY] as AuditContext;
}

export function setAuditAction(
  res: Response,
  action: string,
  meta: { targetType?: string; targetId?: string } = {}
): AuditContext {
  const context = getAuditContext(res);
  context.action = action;
  if (meta.targetType !== undefined) context.targetType = meta.targetType;
  if (meta.targetId !== undefined) context.targetId = meta.targetId;
  return context;
}

export function setAuditBefore(res: Response, before: unknown): void {
  getAuditContext(res).before = before;
}

export function setAuditAfter(res: Response, after: unknown): void {
  getAuditContext(res).after = after;
}
