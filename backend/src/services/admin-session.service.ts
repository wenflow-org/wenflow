import prisma from '../config/database';

/**
 * 管理员会话（admin_sessions）查询/吊销单点。
 *
 * 供 `routes/admin/sessions.ts` 消费，把 DB 访问收敛到服务层；语义与既有路由一致：
 * 列出、按 id 查、单个吊销、批量吊销、批量取管理员名称。
 */

/** 会话列表：按 createdAt 倒序取 limit 条（过滤条件由调用方构造） */
export function listAdminSessions(where: Record<string, unknown>, take: number) {
  return prisma.admin_sessions.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/** 按 id 读取单个会话 */
export function findAdminSessionById(id: string) {
  return prisma.admin_sessions.findUnique({ where: { id } });
}

/** 吊销单个会话 */
export function revokeAdminSession(id: string) {
  return prisma.admin_sessions.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/** 批量吊销：按条件把 revokedAt=null 的会话置为已吊销 */
export function revokeAdminSessions(where: Record<string, unknown>) {
  return prisma.admin_sessions.updateMany({
    where,
    data: { revokedAt: new Date() },
  });
}

/** 批量取管理员名称（admin_sessions.adminId 为纯列，与 admin_audit_logs 同约定） */
export async function resolveAdminNames(
  adminIds: string[],
): Promise<Map<string, { name: string; email: string }>> {
  if (adminIds.length === 0) return new Map();
  const admins = await prisma.users.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, name: true, email: true },
  });
  return new Map(admins.map((admin) => [admin.id, { name: admin.name, email: admin.email }]));
}
