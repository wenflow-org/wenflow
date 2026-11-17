/**
 * 学习者模型证据读取（管理端路由的数据库边界，2026-10-22 架构审计）。
 */
import prisma from '../../config/database';

export async function findCalibrationEvidence(userId: string, pathId?: string) {
  return prisma.learner_evidence.findMany({
    where: {
      userId,
      evidenceType: { in: ['checkpoint:result', 'review:completed', 'task:difficulty:adjustment'] },
      // 证据页已按路径收窄（2026-11-11 多路径串台走查）：不传 pathId 时保持原有全局口径，
      // 兼容列表页/旧调用；详情页会带上当前路径。
      ...(pathId ? { pathId } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: 30,
    select: { evidenceType: true, payload: true, sessionId: true, taskId: true, occurredAt: true },
  });
}

/**
 * 当前路径的互动历史（画像页「探索主题 / 挣扎过概念」，2026-11-11）。
 *
 * 全局 profile.history 取最近 50 节课（跨全部路径），多路径账号会把两条互不相干的课
 * 混进同一张叙述卡。这里只统计 `teaching_sessions.learningPathId = pathId` 的课堂；
 * 误解按 `lastSessionId` 归属到本路径（最后一次出现的位置）——这是现有 schema 下能给出的
 * 最接近「该路径的卡点」的口径，不假装是跨路径并集。
 */
export async function findPathHistory(userId: string, pathId: string) {
  const sessions = await prisma.teaching_sessions.findMany({
    where: { userId, learningPathId: pathId },
    orderBy: { startTime: 'desc' },
    take: 50,
    select: { id: true, duration: true, topic: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const [totalSessions, totalMessages, struggled] = await Promise.all([
    prisma.teaching_sessions.count({ where: { userId, learningPathId: pathId } }),
    sessionIds.length
      ? prisma.teaching_session_messages.count({ where: { sessionId: { in: sessionIds } } })
      : Promise.resolve(0),
    sessionIds.length
      ? prisma.misconception_ledger.findMany({
          where: {
            userId,
            status: { in: ['suspected', 'confirmed'] },
            lastSessionId: { in: sessionIds },
          },
          orderBy: { occurrenceCount: 'desc' },
          take: 8,
          select: { canonicalLabel: true },
        })
      : Promise.resolve([] as Array<{ canonicalLabel: string | null }>),
  ]);
  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  return {
    learningPathId: pathId,
    totalSessions,
    totalMessages,
    avgSessionDuration: sessions.length ? totalDuration / sessions.length : 0,
    topicsExplored: Array.from(new Set(sessions.map((s) => (s.topic || '').trim()).filter(Boolean))).slice(0, 8),
    conceptsStruggled: Array.from(new Set(struggled.map((r) => (r.canonicalLabel || '').trim()).filter(Boolean))),
  };
}

/**
 * 管理端「当前进度」的展示兜底：最近一条非 abandoned 路径及其真实完成度。
 *
 * 为什么需要（2026-11-08 审计）：快照只锚 active 路径（#205，防止学员端被引导去继续学
 * 一条已下线路径）。学习者的路径一旦被运营下线（status=archived），currentPath 恒空 →
 * 管理台「当前进度」显示「尚未开始学习」，而同一页下方照常列着他 5 节已完成的课堂，
 * 同一份数据在 100 像素内自相矛盾。此查询只喂展示字段 `displayPath`，不写快照锚点，
 * 学员端行为不受影响。
 */
export async function findDisplayPathFallback(userId: string) {
  return prisma.learning_paths.findFirst({
    where: { userId, status: { not: 'abandoned' } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      milestones: {
        orderBy: { stageNumber: 'asc' },
        select: { id: true, title: true, stageNumber: true, subtasks: { select: { status: true } } },
      },
    },
  });
}
