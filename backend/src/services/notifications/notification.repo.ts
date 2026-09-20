import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 站内通知仓储（routes/notifications.ts 用户端 + routes/admin/notifications.ts 管理端的取数层）。
 */

// ---------- 用户端（/api/notifications） ----------

export function listUserNotifications(userId: string, skip: number, limit: number) {
  return prisma.notifications.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });
}

export function countUserNotifications(userId: string) {
  return prisma.notifications.count({ where: { userId } });
}

export function countUserUnreadNotifications(userId: string) {
  return prisma.notifications.count({ where: { userId, isRead: false } });
}

export function findUserNotification(id: string, userId: string) {
  return prisma.notifications.findFirst({ where: { id, userId } });
}

export function markNotificationRead(id: string) {
  return prisma.notifications.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });
}

export function markAllUserNotificationsRead(userId: string) {
  return prisma.notifications.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

// ---------- 管理端（/api/admin/notifications） ----------

export function listNotificationsForAdmin(where: Prisma.notificationsWhereInput, orderBy: Prisma.notificationsOrderByWithRelationInput[], skip: number, limit: number) {
  return prisma.notifications.findMany({
    where,
    orderBy,
    skip,
    take: limit,
    include: { users: { select: { id: true, name: true, email: true } } },
  });
}

export function countNotificationsWhere(where: Prisma.notificationsWhereInput) {
  return prisma.notifications.count({ where });
}

export function countUnreadNotificationsWhere(where: Prisma.notificationsWhereInput) {
  return prisma.notifications.count({ where: { ...where, isRead: false } });
}

export function findNotificationById(id: string) {
  return prisma.notifications.findUnique({ where: { id } });
}

export function deleteNotification(id: string) {
  return prisma.notifications.delete({ where: { id } });
}

/** 批量发送（全员/定向统一为 createMany 行） */
export function createNotifications(args: { data: Prisma.notificationsCreateManyInput[] }) {
  return prisma.notifications.createMany(args);
}
