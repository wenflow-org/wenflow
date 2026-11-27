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
 * 返回 published 且未过期、受众含学习者的公告（新→旧，最多 limit 条）。
 *
 * audience（2026-11-26）：此前没有受众维度，运维巡检公告会原样推到学习者顶部横幅
 * （全站 UI 走查 LD-07 / LS-08 / LM-14 三处同症）。学习者只收 all 与 learner 两档；
 * admin 档（运维/巡检/内部变更）在这一层就被滤掉，前端不需要知道这个字段。
 */
export async function listActiveAnnouncements(
  limit = ACTIVE_ANNOUNCEMENTS_LIMIT,
  now: Date = new Date()
): Promise<ActiveAnnouncement[]> {
  return prisma.announcements.findMany({
    where: {
      status: 'published',
      audience: { in: ['all', 'learner'] },
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
