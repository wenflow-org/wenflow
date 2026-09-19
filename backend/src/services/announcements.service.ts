import prisma from '../config/database';

/** 用户端「当前生效公告」查询条数上限 */
export const ACTIVE_ANNOUNCEMENTS_LIMIT = 3;

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * 用户端 · 当前生效公告
 * 返回 published 且未过期的公告（新→旧，最多 limit 条）。
 */
export async function listActiveAnnouncements(
  limit = ACTIVE_ANNOUNCEMENTS_LIMIT,
  now: Date = new Date()
): Promise<ActiveAnnouncement[]> {
  return prisma.announcements.findMany({
    where: {
      status: 'published',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      body: true,
      severity: true,
      publishedAt: true,
      expiresAt: true
    }
  });
}
