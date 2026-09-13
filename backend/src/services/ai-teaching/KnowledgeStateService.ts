import type { TeachingKnowledgePointState } from './TeachingSessionRepository';

/**
 * 目标点达到该进度即视为「可收束」。
 * 背景：模型对 mastered 判定保守（要求无提示独立产出），复盘/巩固课长期停在 80-90%，
 * 导致「全部 mastered」的死条件永不满足、整门课卡死。此阈值是产品语义，可按需调整。
 */
export const COMPLETION_TARGET_PROGRESS_FLOOR = 80;

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

  /** 单点是否达到收束标准：已掌握，或非 pending 且进度达阈值 */
  isTargetSatisfied(point: TeachingKnowledgePointState | null | undefined): boolean {
    if (!point) return false;
    if (point.status === 'mastered') return true;
    if (point.status === 'pending') return false;
    const progress = Number(point.progress);
    return Number.isFinite(progress) && progress >= COMPLETION_TARGET_PROGRESS_FLOOR;
  }

  /**
   * 解析本会话的「收束目标集」，一经确定即冻结，后续不再随模型新增/改名的点膨胀。
   * 优先级：已冻结目标集 → 开课种子点名 → 首个教学回合的点集。
   */
  resolveCompletionTargets(
    existingTargets: unknown,
    seedPoints: TeachingKnowledgePointState[] | null | undefined,
    currentPoints: TeachingKnowledgePointState[] | null | undefined,
  ): string[] {
    if (Array.isArray(existingTargets) && existingTargets.length > 0) {
      return existingTargets.map((name) => String(name)).filter(Boolean);
    }
    const pickNames = (points: TeachingKnowledgePointState[] | null | undefined) =>
      (points || [])
        .map((point) => point?.name)
        .filter((name): name is string => typeof name === 'string' && !!name.trim());
    const seedNames = pickNames(seedPoints);
    const base = seedNames.length > 0 ? seedNames : pickNames(currentPoints);
    return Array.from(new Set(base));
  }

  /** 冻结目标集是否全部达到收束标准（按名 trim/lower 在合并后的看板里查） */
  areTargetsConsolidated(
    targets: string[],
    mergedPoints: TeachingKnowledgePointState[] | null | undefined,
  ): boolean {
    if (!targets.length) return false;
    const byName = new Map((mergedPoints || []).map((point) => [point.name.trim().toLowerCase(), point]));
    return targets.every((name) => this.isTargetSatisfied(byName.get(name.trim().toLowerCase())));
  }

  /** 冻结目标集中「仍在看板上」的点的平均进度（0 表示无可用目标点） */
  averageTargetProgress(
    targets: string[],
    mergedPoints: TeachingKnowledgePointState[] | null | undefined,
  ): number {
    if (!targets.length) return 0;
    const byName = new Map((mergedPoints || []).map((point) => [point.name.trim().toLowerCase(), point]));
    const present = targets
      .map((name) => byName.get(name.trim().toLowerCase()))
      .filter((point): point is TeachingKnowledgePointState => !!point);
    if (!present.length) return 0;
    const total = present.reduce((sum, point) => {
      if (point.status === 'mastered') return sum + 100;
      const progress = Number(point.progress);
      return sum + (Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0);
    }, 0);
    return total / present.length;
  }
}

export const knowledgeStateService = new KnowledgeStateService();
