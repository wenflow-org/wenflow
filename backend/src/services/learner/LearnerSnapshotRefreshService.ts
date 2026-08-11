import prisma from '../../config/database';
import { learnerSnapshotService } from './LearnerSnapshotService';
import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';

export interface LearnerSnapshotRefreshInput {
  userId: string;
  pathId?: string;
  milestoneId?: string;
  taskId?: string;
  scope?: 'global' | 'path' | 'teaching';
  lastEventId?: string;
  lastEventAt?: Date;
}

export class LearnerSnapshotRefreshService {
  private cache = new Map<string, { snapshot: LearnerSnapshot; cachedAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  async refresh(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    if (input.lastEventId) {
      const existing = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
      if (existing?.lastEventId === input.lastEventId) {
        try {
          const snapshot = JSON.parse(existing.payload) as LearnerSnapshot;
          this.cache.set(key, { snapshot, cachedAt: Date.now() });
          return snapshot;
        } catch {
          // Rebuild malformed projections from source facts.
        }
      }
    }

    const snapshot = await learnerSnapshotService.getSnapshot({
      userId: input.userId,
      learningPathId: input.pathId,
      milestoneId: input.milestoneId,
      taskId: input.taskId,
      mode: input.scope,
    });

    await prisma.learner_projections.upsert({
      where: { projectionKey: key },
      create: {
        id: `lsp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: key,
        userId: input.userId,
        scope: input.scope || snapshot.scope.mode,
        pathId: input.pathId || null,
        milestoneId: input.milestoneId || null,
        taskId: input.taskId || null,
        version: 1,
        payload: JSON.stringify(snapshot),
        lastEventId: input.lastEventId || null,
        lastEventAt: input.lastEventAt || null,
        generatedAt: new Date(snapshot.freshness.generatedAt)
      },
      update: {
        version: { increment: 1 },
        payload: JSON.stringify(snapshot),
        lastEventId: input.lastEventId || undefined,
        lastEventAt: input.lastEventAt || undefined,
        generatedAt: new Date(snapshot.freshness.generatedAt)
      }
    });
    this.cache.set(key, { snapshot, cachedAt: Date.now() });
    return snapshot;
  }

  async getLatest(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.cachedAt < LearnerSnapshotRefreshService.CACHE_TTL_MS) {
      return entry.snapshot;
    }
    this.cache.delete(key);
    const persisted = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
    if (persisted && Date.now() - persisted.generatedAt.getTime() < 10 * 60 * 1000) {
      try {
        const snapshot = JSON.parse(persisted.payload) as LearnerSnapshot;
        this.cache.set(key, { snapshot, cachedAt: Date.now() });
        return snapshot;
      } catch {
        // Rebuild malformed projections from source facts.
      }
    }
    return this.refresh(input);
  }

  async listForAdmin(params?: {
    userId?: string;
    pathId?: string;
    staleOnly?: boolean;
    riskOnly?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.max(1, Math.min(50, Number(params?.limit || 20)));

    // 软删用户不进入管理端快照列表（列表与总数口径一致）
    const userWhere = params?.userId ? { id: params.userId, deletedAt: null } : { deletedAt: null };
    const total = await prisma.users.count({ where: userWhere });

    const users = await prisma.users.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        learning_paths: {
          where: params?.pathId ? { id: params.pathId } : { status: 'active' },
          select: {
            id: true,
            title: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // 批量取快照：先命中模块缓存，再按 projectionKey in [...] 批量读 learner_projections，
    // 避免每用户逐个 getLatest 重建（原实现每页 100 用户 ≈1300+ 查询）。
    const entries = Array.from(users, (user) => {
      const path = user.learning_paths[0];
      return {
        user,
        path,
        key: this.buildKey({
          userId: user.id,
          pathId: path?.id,
          scope: path?.id ? 'path' : 'global',
        }),
      };
    });

    const snapshotsByUser = new Map<string, LearnerSnapshot>();
    const refreshQueue: typeof entries = [];

    for (const entry of entries) {
      const cached = this.cache.get(entry.key);
      if (cached && Date.now() - cached.cachedAt < LearnerSnapshotRefreshService.CACHE_TTL_MS) {
        snapshotsByUser.set(entry.user.id, cached.snapshot);
      } else {
        if (cached) this.cache.delete(entry.key);
        refreshQueue.push(entry);
      }
    }

    if (refreshQueue.length > 0) {
      const persisted = await prisma.learner_projections.findMany({
        where: {
          projectionKey: { in: refreshQueue.map((entry) => entry.key) },
          generatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        select: { projectionKey: true, payload: true },
      });
      const rowByKey = new Map(persisted.map((row) => [row.projectionKey, row]));
      const stillMissing: typeof entries = [];
      for (const entry of refreshQueue) {
        const row = rowByKey.get(entry.key);
        if (row) {
          try {
            const snapshot = JSON.parse(row.payload) as LearnerSnapshot;
            this.cache.set(entry.key, { snapshot, cachedAt: Date.now() });
            snapshotsByUser.set(entry.user.id, snapshot);
            continue;
          } catch {
            // 投影损坏：按未命中处理，走重建。
          }
        }
        stillMissing.push(entry);
      }
      // 仅未命中（缓存过期且无新鲜投影）才重建。
      if (stillMissing.length > 0) {
        await Promise.all(stillMissing.map(async (entry) => {
          const snapshot = await this.refresh({
            userId: entry.user.id,
            pathId: entry.path?.id,
            scope: entry.path?.id ? 'path' : 'global',
          });
          snapshotsByUser.set(entry.user.id, snapshot);
        }));
      }
    }

    const snapshots = entries.map(({ user, path }) => {
      const snapshot = snapshotsByUser.get(user.id);
      if (!snapshot) {
        throw new Error(`学习者快照构建失败: ${user.id}`);
      }
      return {
        userId: user.id,
        userName: user.name,
        email: user.email,
        pathId: path?.id || null,
        pathTitle: path?.title || null,
        generatedAt: snapshot.freshness.generatedAt,
        confidence: snapshot.freshness.confidence,
        recentTrend: snapshot.dynamicState.recentTrend,
        fatigueRisk: snapshot.dynamicState.fatigueRisk,
        currentMilestone: snapshot.knowledgeMemory.currentPath?.currentPosition.milestoneTitle || null,
        currentTask: snapshot.knowledgeMemory.currentPath?.currentPosition.taskTitle || null,
        masteredConcepts: snapshot.knowledgeMemory.globalSignals.masteredConcepts.slice(0, 5),
        fragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts.slice(0, 5),
        strugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts.slice(0, 5),
      };
    });

    const filtered = snapshots.filter((item) => {
      if (params?.staleOnly) {
        const ageMs = Date.now() - new Date(item.generatedAt).getTime();
        if (ageMs < 10 * 60 * 1000) return false;
      }
      if (params?.riskOnly) {
        if (item.fatigueRisk === 'low' && item.fragileConcepts.length === 0 && item.strugglingConcepts.length === 0) {
          return false;
        }
      }
      return true;
    });

    return {
      page,
      limit,
      total,
      items: filtered,
    };
  }

  private buildKey(input: LearnerSnapshotRefreshInput) {
    return [
      'learner-snapshot-v1',
      input.userId,
      input.scope || (input.taskId ? 'teaching' : input.pathId ? 'path' : 'global'),
      input.pathId || 'global',
      input.milestoneId || 'none',
      input.taskId || 'none'
    ].join(':');
  }
}

export const learnerSnapshotRefreshService = new LearnerSnapshotRefreshService();
