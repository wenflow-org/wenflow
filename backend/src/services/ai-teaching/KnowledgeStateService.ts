import type { TeachingKnowledgePointState } from './TeachingSessionRepository';

export class KnowledgeStateService {
  /**
   * 合并知识看板。
   * @param allowDegrade 是否允许 mastered 降级（复习课传 true：复习失败时 LLM 判定可把
   *   mastered 回退为 review/learning，让掌握度数据真实反映；普通课保持"只升不降"，
   *   避免 LLM 单轮误判导致掌握度倒退）。
   */
  merge(
    existing: TeachingKnowledgePointState[],
    incoming: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>,
    allowDegrade = false,
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
        // 只升不降：mastered 一旦达成，除非 allowDegrade（复习课）否则不降级
        status:
          previous.status === 'mastered' && !allowDegrade
            ? previous.status
            : point.status,
        progress: allowDegrade ? point.progress : Math.max(previous.progress, point.progress),
      });
    }

    return Array.from(merged.values());
  }
}

export const knowledgeStateService = new KnowledgeStateService();
