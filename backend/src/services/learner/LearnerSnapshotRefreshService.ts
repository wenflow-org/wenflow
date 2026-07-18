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
  private cache = new Map<string, LearnerSnapshot>();

  async refresh(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    if (input.lastEventId) {
      const existing = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
      if (existing?.lastEventId === input.lastEventId) {
        try {
          const snapshot = JSON.parse(existing.payload) as LearnerSnapshot;
          this.cache.set(key, snapshot);
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
    this.cache.set(key, snapshot);
    return snapshot;
  }

  async getLatest(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const persisted = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
    if (persisted && Date.now() - persisted.generatedAt.getTime() < 10 * 60 * 1000) {
      try {
        const snapshot = JSON.parse(persisted.payload) as LearnerSnapshot;
        this.cache.set(key, snapshot);
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
    const limit = Math.max(1, Math.min(100, Number(params?.limit || 20)));

    const users = await prisma.users.findMany({
      where: params?.userId ? { id: params.userId } : undefined,
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

    const snapshots = await Promise.all(users.map(async (user) => {
      const path = user.learning_paths[0];
      const snapshot = await this.getLatest({
        userId: user.id,
        pathId: path?.id,
        scope: path?.id ? 'path' : 'global',
      });

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
        fragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts.slice(0, 5),
        strugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts.slice(0, 5),
      };
    }));

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
      total: filtered.length,
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
