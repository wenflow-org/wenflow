import type { TeachingKnowledgePointState } from './TeachingSessionRepository';

export class KnowledgeStateService {
  merge(
    existing: TeachingKnowledgePointState[],
    incoming: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>
  ): TeachingKnowledgePointState[] {
    if (!incoming.length) return existing;

    const merged = new Map(existing.map((point) => [point.name, { ...point }]));
    for (const point of incoming) {
      const previous = merged.get(point.name);
      if (!previous) {
        merged.set(point.name, { ...point });
        continue;
      }

      merged.set(point.name, {
        ...previous,
        status: point.status === 'mastered' || previous.status !== 'mastered' ? point.status : previous.status,
        progress: Math.max(previous.progress, point.progress),
      });
    }

    return Array.from(merged.values());
  }
}

export const knowledgeStateService = new KnowledgeStateService();
