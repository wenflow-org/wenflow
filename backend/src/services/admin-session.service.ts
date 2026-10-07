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

/** 会话计数的四口径（全量，非分页窗口） */
export interface AdminSessionCounts {
  total: number;
  active: number;
  expired: number;
  revoked: number;
}

/**
 * 按管理员分组的会话计数（全量口径）：groupBy 三次拿 active/expired/revoked，
 * total 为三者之和（同一分区的并集，不会重复计数）。
 *
 * 列表接口的 limit 只约束「行窗口」，页面上的活跃/过期/总数一律以本函数为准——
 * 否则窗口行数会被读成全量（运营走查 B13 F6-1：默认 limit=100 被页签角标/统计条/组头当全量）。
 */
export async function countAdminSessionsByAdmin(
  scopeWhere: Record<string, unknown>,
  now: Date,
): Promise<Map<string, AdminSessionCounts>> {
  const [active, expired, revoked] = await Promise.all([
    prisma.admin_sessions.groupBy({
      by: ['adminId'],
      where: { ...scopeWhere, revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
    prisma.admin_sessions.groupBy({
      by: ['adminId'],
      where: { ...scopeWhere, revokedAt: null, expiresAt: { lte: now } },
      _count: { _all: true },
    }),
    prisma.admin_sessions.groupBy({
      by: ['adminId'],
      where: { ...scopeWhere, revokedAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, AdminSessionCounts>();
  const bump = (adminId: string, key: 'active' | 'expired' | 'revoked', n: number) => {
    const row = counts.get(adminId) ?? { total: 0, active: 0, expired: 0, revoked: 0 };
    row[key] += n;
    row.total += n;
    counts.set(adminId, row);
  };
  for (const r of active) bump(r.adminId, 'active', r._count._all);
  for (const r of expired) bump(r.adminId, 'expired', r._count._all);
  for (const r of revoked) bump(r.adminId, 'revoked', r._count._all);
  return counts;
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
