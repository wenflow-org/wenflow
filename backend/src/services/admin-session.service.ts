import prisma from '../config/database';

/**
 * 管理员会话（admin_sessions）查询/吊销单点。
 *
 * 供 `routes/admin/sessions.ts` 消费，把 DB 访问收敛到服务层；语义与既有路由一致：
 * 列出、按 id 查、单个吊销、批量吊销、批量取管理员名称。
 */

/**
 * 会话列表：活跃优先、同档按 createdAt 倒序取 limit 条（过滤条件由调用方构造）。
 *
 * 2026-11-01 外部评审：「活跃会话」表只显示 3 行，而同屏「下线全部（7）」按全量计数——
 * 管理员每次登录写一行，历史行很快把 100 行窗口占满，仍在有效期内的旧会话被挤出窗口
 * （原排序只看 createdAt）。活跃行才是「要动手的对象」，必须先占窗口：
 * revokedAt 升序让 NULL（未撤销）排在已撤销之前。
 */
export function listAdminSessions(where: Record<string, unknown>, take: number) {
  return prisma.admin_sessions.findMany({
    where,
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
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
 * 按管理员分组的会话计数（全量口径）：单条 SQL 把每行归入 active/expired/revoked 后计数，
 * total 为三者之和（同一分区的并集，不会重复计数）。
 *
 * 列表接口的 limit 只约束「行窗口」，页面上的活跃/过期/总数一律以本函数为准——
 * 否则窗口行数会被读成全量（运营走查 B13 F6-1：默认 limit=100 被页签角标/统计条/组头当全量）。
 *
 * 2026-11-04：不再用 Prisma 的 `expiresAt: { gt: now }` 过滤。SQLite 里日期列若被以 ISO
 * 文本写入（历史/外部脚本直插，非 Prisma 写入路径），与整数毫秒的 now 跨类型比较顺时针恒判
 * 「文本更大」，早已过期的行会被算作 active；而前端按 `new Date()` 解析判过期，两端口径打架，
 * 「下线其他会话（N）」比同屏活跃行多算（会话安全卡片 3 vs 2）。这里对文本值经 unixepoch()
 * 归一到毫秒再比较，两类存储同口径。
 */
export async function countAdminSessionsByAdmin(
  scopeWhere: Record<string, unknown>,
  now: Date,
): Promise<Map<string, AdminSessionCounts>> {
  const adminId = typeof scopeWhere.adminId === 'string' ? scopeWhere.adminId : null;
  const nowMs = now.getTime();
  const rows = await prisma.$queryRawUnsafe<
    Array<{ adminId: string; active: number | bigint; expired: number | bigint; revoked: number | bigint }>
  >(
    `SELECT adminId AS adminId,
       SUM(CASE WHEN revokedAt IS NULL AND (
             CASE WHEN typeof(expiresAt) = 'text' THEN unixepoch(expiresAt) * 1000 ELSE expiresAt END
           ) > ? THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN revokedAt IS NULL AND (
             CASE WHEN typeof(expiresAt) = 'text' THEN unixepoch(expiresAt) * 1000 ELSE expiresAt END
           ) <= ? THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN revokedAt IS NOT NULL THEN 1 ELSE 0 END) AS revoked
     FROM admin_sessions
     ${adminId ? 'WHERE adminId = ?' : ''}
     GROUP BY adminId`,
    ...(adminId ? [nowMs, nowMs, adminId] : [nowMs, nowMs]),
  );

  const counts = new Map<string, AdminSessionCounts>();
  for (const r of rows) {
    const active = Number(r.active);
    const expired = Number(r.expired);
    const revoked = Number(r.revoked);
    counts.set(r.adminId, { total: active + expired + revoked, active, expired, revoked });
  }
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

/** 删除已结束会话（已吊销或已过期）：只清历史行，登录事件仍由 login_attempts 留存 */
export function deleteEndedAdminSessions(where: Record<string, unknown>, now: Date) {
  return prisma.admin_sessions.deleteMany({
    where: {
      ...where,
      OR: [
        { revokedAt: { not: null } },
        { revokedAt: null, expiresAt: { lte: now } },
      ],
    },
  });
}

/**
 * 历史保留期：已过期 / 已吊销的会话行保留 14 天，之后惰性删除。
 * 管理员每次登录都会写一行，若一直不清理，历史量会随登录次数无限增长
 * （2026-10-28 用户「怎么这么多」：本地 261 行里 57 活跃、204 已结束）。
 * 登录审计在 login_attempts，不受这里影响。
 */
const ADMIN_SESSION_RETENTION_DAYS = 14;
const ADMIN_SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

export async function pruneAdminSessions(
  retentionDays = ADMIN_SESSION_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.admin_sessions.deleteMany({
    where: {
      OR: [
        { revokedAt: { not: null, lt: cutoff } },
        { revokedAt: null, expiresAt: { lt: cutoff } },
      ],
    },
  });
  return result.count;
}

/** 列表请求顺带清理：每小时最多执行一次，避免每次加载都扫表 */
export async function pruneAdminSessionsIfDue(): Promise<number> {
  const now = Date.now();
  if (now - lastPruneAt < ADMIN_SESSION_PRUNE_INTERVAL_MS) return 0;
  lastPruneAt = now;
  return pruneAdminSessions();
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
