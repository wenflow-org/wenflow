/**
 * 虚拟学习者「概率化记忆提取」接线（Q4 集成层）。
 *
 * 分层（见 `docs` 与 `services/memory/probabilistic-recall.ts`）：
 * - **记忆强度 = 确定性**：FSRS 保留率（已有，`memory_traces` → `LearnerMemorySnapshot.dueReview[].progress`）。
 * - **能不能想起来 = 概率**：本模块按 `(会话, 天, 概念)` 派生确定性随机流，调用 `probabilisticRecall`
 *   得到 CLEAR / VAGUE / CONFUSED / FAILED，作为**代码裁决的观测**交给模拟器，由模拟器按人设自然表达。
 *
 * 纪律：确定性（同种子必回放一致）；只对"到期复习点"（=到达遗忘临界、才可能想不起来）计算；
 * 本模块不改任何持久状态，只产出给模拟器的提示。
 *
 * v1 范围：不接混淆池（`confusables: []`）——易混对需要相似度来源（项目无 embedding），
 * 后续接"LLM 离线判定 + 台账"（复用 `ConceptConsolidatorService` 范式）。
 */
import { probabilisticRecall, type RecallStatus, type ConfusableInput } from '../services/memory/probabilistic-recall';
import type { LearnerMemorySnapshot } from './learner-memory';

export interface MemoryRecallHint {
  conceptKey: string;
  status: RecallStatus;
  /** CONFUSED 时为被想成的那个概念；否则等于 conceptKey */
  outputConceptKey: string;
}

export interface BuildMemoryRecallHintsInput {
  memory: LearnerMemorySnapshot | null | undefined;
  /** 回放种子来源：通常用虚拟会话 id（同会话可完整回放） */
  experimentRunSeed: string;
  virtualLearnerId: string;
  sessionId: string;
  /**
   * 步进种子：用**模拟日**（dayIndex）最稳——同一"天"内对同一概念保持同一提取结果，
   * 避免同一节课里记忆忽好忽坏；跨天自然重抽。
   */
  stepIndex: number;
  /** 最多提示几个到期点（默认 4，避免噪声） */
  maxItems?: number;
  /** 易混候选（v1 恒为空；接入后传入即可） */
  confusablesFor?: (conceptKey: string) => ConfusableInput[];
}

const DEFAULT_MAX_ITEMS = 4;

/** progress(0-100) → FSRS 保留率 R(0-1)（夹紧到开区间，避免 logit 发散）。 */
function retentionFromProgress(progress: unknown): number {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.01, Math.min(0.99, value / 100));
}

/**
 * 对快照里的到期复习点计算提取结果提示。确定性：同一组输入必然得到同一结果（可回放）。
 */
export function buildMemoryRecallHints(input: BuildMemoryRecallHintsInput): MemoryRecallHint[] {
  const memory = input.memory;
  if (!memory || !Array.isArray(memory.dueReview) || memory.dueReview.length === 0) return [];
  const maxItems = Number.isFinite(input.maxItems) && (input.maxItems as number) > 0
    ? Math.floor(input.maxItems as number)
    : DEFAULT_MAX_ITEMS;

  const hints: MemoryRecallHint[] = [];
  for (const item of memory.dueReview.slice(0, maxItems)) {
    const conceptKey = String(item?.name || '').trim();
    if (!conceptKey) continue;
    const result = probabilisticRecall({
      experimentRunSeed: input.experimentRunSeed,
      virtualLearnerId: input.virtualLearnerId,
      sessionId: input.sessionId,
      stepIndex: input.stepIndex,
      targetConceptKey: conceptKey,
      retrievability: retentionFromProgress(item.progress),
      confusables: input.confusablesFor ? input.confusablesFor(conceptKey) : [],
    });
    hints.push({
      conceptKey,
      status: result.status,
      outputConceptKey: result.outputConceptKey,
    });
  }
  return hints;
}
