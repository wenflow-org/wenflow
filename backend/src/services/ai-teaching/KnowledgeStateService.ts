import type { TeachingKnowledgePointState } from './TeachingSessionRepository';
import { normalizeConceptName } from './checkpoint-shared';

/**
 * 掌握授予的证据来源（F1 修复轮 b，2026-10-06）：
 * - `code`：本会话有 code 裁决记录（独立传感器）且无失败行——授予有独立证据背书；
 * - `llm`：零 code 证据——授予纯出 LLM 判定（历史默认形态，行为不变仅标注，可追溯）；
 * - `mixed`：存在 code 失败行的同时点为 mastered——复习课（allowDegrade）通道下 LLM 重授
 *   保留 mastered 时如实标注证据混杂，或历史遗留标注。普通课遇 code 负证据已直接降级为
 *   learning（F1 修复轮 c，兑现 R1「checkpoint 负证据可降级」），正常路径不再新产 mixed。
 */
export type KnowledgePointEvidenceSource = 'code' | 'llm' | 'mixed';

/** 带授予证据标注的知识点状态（knowledgeState 为 JSON 列，字段级增补、无 schema 迁移） */
export interface ArbitratedTeachingKnowledgePointState extends TeachingKnowledgePointState {
  evidenceSource?: KnowledgePointEvidenceSource;
}

/**
 * code 负证据仲裁（F1 修复轮 b）：由 teaching-checkpoint.buildCheckpointCodeArbitration 聚合——
 * 本会话内有 code 裁决失败的（检查点归属）概念不得晋升 mastered；有 code 裁决记录（无论对错）
 * 的概念在授予处标注 evidenceSource。
 */
export interface KnowledgeMergeArbitration {
  codeFailedConceptNames?: ReadonlyArray<string>;
  codeJudgedConceptNames?: ReadonlyArray<string>;
}

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
   * @param arbitration 掌握聚合仲裁（F1 修复轮 b，缺省 = 历史行为）：本会话内有 code 裁决
   *   失败的（检查点归属）概念阻断 mastered 晋升——R1 finding A2「代码裁决的检查点失败不进
   *   任何掌握聚合」的聚合侧修复。F1 修复轮 c：已 mastered 的点遇 code 负证据时降为
   *   learning（兑现 R1 处置建议「checkpoint 负证据可降级」，与授予处 mixed 标注同一判据
   *   路径——不再「保留 mastered + 标 mixed」双写状态）；复习课（allowDegrade=true）通道
   *   行为保持原样，LLM 判定照旧生效。名字匹配与派生键同口径（normalizeConceptName，
   *   折叠全部空白+小写），同名异写不得绕过阻断/降级。
   */
  merge(
    existing: TeachingKnowledgePointState[],
    incoming: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>,
    allowDegrade = false,
    arbitration?: KnowledgeMergeArbitration,
  ): ArbitratedTeachingKnowledgePointState[] {
    if (!incoming.length) return existing;

    // 名字匹配口径与派生键一致（normalizeConceptName：折叠全部空白 + 小写），
    // 避免同名异写（'A B' vs 'AB'）绕过阻断/降级（F1 修复轮 c，复核 P16）
    const failedNames = new Set(
      (arbitration?.codeFailedConceptNames || []).map((name) => normalizeConceptName(name)).filter(Boolean)
    );
    const judgedNames = new Set(
      (arbitration?.codeJudgedConceptNames || []).map((name) => normalizeConceptName(name)).filter(Boolean)
    );
    /** 授予处证据标注（evidenceSource）：mastered 点必标；failed 有失败行 → mixed，否则有 code 记录 → code，零 code 证据 → llm（保留旧标注） */
    const evidenceSourceFor = (
      nameKey: string,
      previous?: ArbitratedTeachingKnowledgePointState,
    ): KnowledgePointEvidenceSource =>
      failedNames.has(nameKey)
        ? 'mixed'
        : judgedNames.has(nameKey)
          ? 'code'
          : (previous?.evidenceSource ?? 'llm');

    // 看板映射同样按归一名字键（与派生键同口径）：同名异写的存量点与新点归并到同一概念，
    // 不让「已 mastered 的旧写法」并存存活绕过阻断/降级
    const merged = new Map(
      existing.map((point) => [normalizeConceptName(point.name), { ...point } as ArbitratedTeachingKnowledgePointState])
    );
    for (const point of incoming) {
      const nameKey = normalizeConceptName(point.name);
      const previous = merged.get(nameKey);
      if (!previous) {
        // F1-b：code 失败概念不得经「新点直接报 mastered」绕过阻断。
        // 显式挑字段：evidenceSource 是代码权威标注，不透传模型输出里的同名回显
        const blocked = failedNames.has(nameKey) && !allowDegrade && point.status === 'mastered';
        const status = blocked ? 'learning' as const : point.status;
        merged.set(nameKey, {
          name: point.name,
          status,
          progress: point.progress,
          ...(status === 'mastered' ? { evidenceSource: evidenceSourceFor(nameKey) } : {}),
        });
        continue;
      }

      const retainedMastered = previous.status === 'mastered' && !allowDegrade;
      // F1-b/F1-c：code 失败概念——晋升被阻断，且已 mastered 的点在普通课降为 learning
      // （负证据降级；与授予处 mixed 标注同判据路径，不再保留 mastered 造成状态双写）。
      // 复习课（allowDegrade）通道不叠加仲裁，LLM 判定照旧生效。
      const incomingBlocked =
        failedNames.has(nameKey) && !allowDegrade && point.status === 'mastered';
      const degradeByNegativeEvidence =
        failedNames.has(nameKey) && !allowDegrade && previous.status === 'mastered';
      const nextStatus =
        degradeByNegativeEvidence
          ? ('learning' as const)
          : retainedMastered
            ? previous.status
            : incomingBlocked
              ? ('learning' as const)
              : point.status;
      const nextEvidenceSource =
        nextStatus === 'mastered' ? evidenceSourceFor(nameKey, previous) : previous.evidenceSource;
      merged.set(nameKey, {
        ...previous,
        status: nextStatus,
        progress: allowDegrade ? point.progress : Math.max(previous.progress, point.progress),
        // 授予处记录证据来源；非 mastered 点不再新授标注（保留历史值或缺省）
        ...(nextEvidenceSource ? { evidenceSource: nextEvidenceSource } : {}),
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
