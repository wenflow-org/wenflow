import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 平台公告仓储（routes/admin/announcements.ts 的取数层）。
 * MVP：标题/正文/级别 + 草稿/发布/下线。
 */

export function listAnnouncements() {
  return prisma.announcements.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });
}

export function createAnnouncement(args: Prisma.announcementsCreateArgs) {
  return prisma.announcements.create(args);
}

export function updateAnnouncement(args: Prisma.announcementsUpdateArgs) {
  return prisma.announcements.update(args);
}

export function findAnnouncementById(id: string) {
  return prisma.announcements.findUnique({ where: { id } });
}

export function deleteAnnouncement(id: string) {
  return prisma.announcements.delete({ where: { id } });
}

/** 公告里 createdBy 历史上落的是 admin_* 用户 id；读取侧补一次显示名解析。 */
export function findAdminNamesByIds(ids: string[]) {
  return prisma.users.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true }
  });
}
