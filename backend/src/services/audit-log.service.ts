import prisma from '../config/database';

/**
 * 审计日志查询（P3）：`admin_audit_logs`（操作审计）/ `login_attempts`（登录审计）。
 *
 * 路由层只负责参数校验与响应整形，模型选择与 DB 调用在本服务内完成，
 * 避免 `src/routes/**` 越层直连数据库（边界棘轮）。
 */

export type AuditLogScope = 'operation' | 'login';

/** 两个审计表共有查询形状（count / findMany），避免绑定具体 Prisma 模型类型 */
interface AuditQueryModel {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
  }) => Promise<Array<Record<string, unknown>>>;
}

/** scope → 审计表模型（operation=admin_audit_logs，login=login_attempts） */
function resolveAuditModel(scope: AuditLogScope): AuditQueryModel {
  return scope === 'login'
    ? (prisma.login_attempts as unknown as AuditQueryModel)
    : (prisma.admin_audit_logs as unknown as AuditQueryModel);
}

/** 同筛选参数计数（stats 的 total / failed 复用） */
export function countAuditLogs(
  scope: AuditLogScope,
  where: Record<string, unknown>
): Promise<number> {
  return resolveAuditModel(scope).count({ where });
}

/** 分页/聚合查询 */
export function findAuditLogs(
  scope: AuditLogScope,
  args: Parameters<AuditQueryModel['findMany']>[0]
): Promise<Array<Record<string, unknown>>> {
  return resolveAuditModel(scope).findMany(args);
}
