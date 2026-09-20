/**
 * 教学复习暖场（warmup）纯函数域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：复习计划与暖场点的匹配/选定/产出合并（matchWarmupItem 模糊匹配、
 * pendingWarmupForModel 模型侧待暖场集、resolveTurnMemoryWarmup 回合暖场决策、
 * extract/merge/mark/strip 暖场状态流转）。自 AITeachingCoordinator 头部迁出，
 * 行为保持不变；AITeachingCoordinator re-export 维持既有 import 路径。
 */
import type { ReviewPlan, ReviewPlanItem } from '../memory/review-plan.service';
import { normalizeConceptKey } from '../memory/memory-trace.service';

function warmupKeyOf(name: string): string {
  return normalizeConceptKey(name);
}

/**
 * 能代表「当场回捞出了结果」的看板状态。
 * 提示词要求回捞成功才把温故点推进为 learning / mastered；模型有时会把它标成 'review'
 * （= 已提问、待作答）或 'pending'（= 尚未处理）——这两种只说明"问过了"，不是作答表现，
 * 因此**不收录为结果**（否则收束时会按"没答出"落成 again，污染记忆状态与间隔）。
 */
const WARMUP_RESULT_STATUSES = new Set(['mastered', 'learning']);

/**
 * 结构化召回等级 → 看板状态/进度（2026-09-17）。
 * 与 `mapReviewStatusToRating` 的口径对齐：unaided→easy(0.9)、with-hint→hard(0.5)、failed→again(0.5)。
 * "给了多少帮助才想起来"是 desirable difficulty 的直接观测量，比"是否答出"二分更有信息量。
 */
const WARMUP_RECALL_TO_STATUS: Record<'unaided' | 'with-hint' | 'failed', { status: string; progress: number }> = {
  unaided: { status: 'mastered', progress: 100 },
  'with-hint': { status: 'learning', progress: 50 },
  failed: { status: 'not-recalled', progress: 0 },
};

/** 保守包含匹配的长度门槛（归一化后字符数）：短名包含关系太容易误伤，宁可不匹配 */
export const WARMUP_FUZZY_MIN_LENGTH = 8;

/** 字符重合率下限（以较短名为分母）：低于它就不再视为同一概念 */
export const WARMUP_FUZZY_OVERLAP_MIN = 0.8;

/**
 * 把「模型回写的点位名」对到计划项上（保守匹配）。
 *
 * 为什么需要退一步：实测两次全流程验证，一次摘到、一次没摘到——模型用**近义/截断**说法
 * 回写点位（提示词要求"用计划里的原名字"，但不总是遵守），结果**随机丢样本**，
 * 而样本正是动态预算与保持曲线的输入。
 *
 * 为什么必须保守：温故点会被**从本节看板摘除**（回归 2e3ca16），一旦误判，
 * 本节知识点会被当成温故点摘掉。因此：
 * 1) 先精确（归一化后相等）；计划内自身歧义 → 放弃；
 * 2) 再退一步做包含匹配，但要求**双方长度 ≥ 门槛**且**唯一命中**；否则放弃（宁缺勿错）。
 */
export function matchWarmupItem(
  plan: ReviewPlan | null | undefined,
  name: string,
): ReviewPlanItem | null {
  const items = (plan?.items || []).filter((item) => item && (item.label || item.conceptKey));
  if (items.length === 0) return null;
  const target = warmupKeyOf(String(name || ''));
  if (!target) return null;

  const exact = items.filter((item) => warmupKeyOf(item.label || item.conceptKey) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const contained = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length < WARMUP_FUZZY_MIN_LENGTH || target.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    return key.includes(target) || target.includes(key);
  });
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) return null;

  // 3) 同字异序：模型常把中文概念名调序（实测 "整合输出8月龄食物质地安全判据" → 写回 "
  //    食物质地安全判据整合"）。字符多重集完全相同的两个名字几乎不可能指不同概念 → 唯一命中就认。
  const sameChars = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length !== target.length || key.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    return [...key].sort().join('') === [...target].sort().join('');
  });
  if (sameChars.length === 1) return sameChars[0];
  if (sameChars.length > 1) return null;

  // 4) 最后退一步：**调序 + 截断**同时出现（实测那次就是丢了"输出/8月龄"）。按字符重合率（不看顺序），
  //    以较短名为分母要求 ≥ 0.8，双方均 ≥ 8 字，且唯一命中。
  //    再松就会开始误伤本节知识点（误判会把知识点从看板摘掉）——宁可漏摘。
  const similar = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length < WARMUP_FUZZY_MIN_LENGTH || target.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    const shortName = key.length <= target.length ? key : target;
    const pool = [...(key.length <= target.length ? target : key)];
    let hit = 0;
    for (const char of shortName) {
      const index = pool.indexOf(char);
      if (index >= 0) {
        pool.splice(index, 1);
        hit += 1;
      }
    }
    return hit / shortName.length >= WARMUP_FUZZY_OVERLAP_MIN;
  });
  return similar.length === 1 ? similar[0] : null;
}

/**
 * 交给模型的本节温故视图：**只保留尚未回捞的点**。
 * - 已在本节报告过结果的点不再重复问（也避免后续回合覆盖已记录的结果）；
 * - 全部完成 → 返回 null，提示词走"本节不温故"分支；
 * - 注意：`stripWarmupPoints` / `extractWarmupOutcomes` 仍须用**完整计划**（它们负责"温故点永不进
 *   本节看板"），否则模型若在后续回合才报出结果，就会漏摘并串进看板（回归 2e3ca16）。
 */
export function pendingWarmupForModel(plan: ReviewPlan | null | undefined): ReviewPlan | null {
  if (!plan || !Array.isArray(plan.items)) return null;
  const pending = plan.items.filter((item) => !item?.outcome?.status);
  if (pending.length === 0) return null;
  return {
    ...plan,
    items: pending,
    // 与 items 保持一致的视图：只算还没回捞的负担
    usedLoad: pending.reduce((sum, item) => sum + (Number(item.load) || 0), 0),
  };
}

/**
 * 每回合重建 context 后回填温故计划。
 * 断点回归（2026-09-16 调查）：计划只在 `startSession` 里赋给 context，而回合侧每回合重建 context，
 * 于是 `scenario.memoryWarmup` 恒为 null——提示词的温故规则成了死代码，结果也永远摘不到。
 * 计划持久化在 `sessionArtifacts.memoryWarmup`（开课建立、随回合合并结果），这里必须回填。
 */
export function resolveTurnMemoryWarmup(
  sessionArtifacts: Record<string, any> | null | undefined,
): ReviewPlan | null {
  const persisted = sessionArtifacts?.memoryWarmup;
  return persisted && Array.isArray(persisted.items) && persisted.items.length > 0 ? persisted : null;
}

/**
 * 从教学回合的输出里摘出「课内温故」的结果。
 *
 * **两条通道，结构化优先（2026-09-17，审计 §3.6 问题④的另一半）**：
 * ① `control.warmupOutcomes`（首选）：模型直接报"给了多少帮助才想起来"（unaided / with-hint / failed），
 *    代码据此落结果——**不做名字匹配**，因此不再依赖"模型必须把温故点按原名回写进 knowledge.points"。
 *    实测背景：靠回写 + 名字匹配时，两次全流程验证一次摘到一次没摘到（本轮从零回归里温故点在消息中
 *    出现 5 次、却没进 knowledge.points ⇒ 摘取饿死、outcome 恒 null）。
 * ② `knowledge.points` 名字匹配（兼容）：老行为，结构化缺失时兜底。
 *
 * 到期旧知必须与本节点看板**物理分离**——历史事故 2e3ca16：日常课把跨 path 到期点注入
 * seededKnowledgeState，结果串进「本节知识点」且被前端 isCurrent 误显示为「进行中 · x%」，
 * 于是整个课内复习机制被下线。这里仍走独立通道（只取结果，不进看板）。
 */
export function extractWarmupOutcomes(
  plan: ReviewPlan | null | undefined,
  points: Array<{ name: string; status: string; progress: number }> | null | undefined,
  structured?: Array<{ conceptKey?: string; itemIndex?: number; recall: 'unaided' | 'with-hint' | 'failed'; evidence?: string }> | null,
): Array<{ conceptKey: string; status: string; progress: number }> {
  if (!plan) return [];
  const outcomes: Array<{ conceptKey: string; status: string; progress: number }> = [];
  const pushOnce = (item: ReviewPlanItem, status: string, progress: number) => {
    const key = warmupKeyOf(item.conceptKey);
    if (outcomes.some((existing) => warmupKeyOf(existing.conceptKey) === key)) return;
    // 用**计划项的规范键**（而非模型当时的写法）：记忆引擎按它定位 memory_traces
    outcomes.push({ conceptKey: item.conceptKey, status, progress });
  };

  // ① 结构化通道：itemIndex 相对的是**模型看到的待回捞视图**（pendingWarmupForModel），不是完整计划
  const pendingView = pendingWarmupForModel(plan)?.items ?? [];
  for (const entry of structured || []) {
    if (!entry) continue;
    const index = Number.isInteger(entry.itemIndex) ? Number(entry.itemIndex) : -1;
    const byIndex = index >= 0 && index < pendingView.length ? pendingView[index] : null;
    const item = byIndex ?? matchWarmupItem(plan, String(entry.conceptKey || ''));
    if (!item) continue;
    const mapped = WARMUP_RECALL_TO_STATUS[entry.recall];
    if (!mapped) continue;
    pushOnce(item, mapped.status, mapped.progress);
  }

  // ② 兼容通道：模型把温故点按原名写回 knowledge.points（仅在结构化没给这个点时生效）
  if (Array.isArray(points)) {
    for (const point of points) {
      const name = String(point?.name || '').trim();
      if (!name) continue;
      const matched = matchWarmupItem(plan, name);
      if (!matched) continue;
      const status = String(point.status || '') || 'learning';
      // 只有「当场回捞出了结果」的状态才算结果：模型把温故点写回来只为提问（'review'）时，
      // 它不代表任何作答表现——若当成结果收录，收束时会按"没答出"落成 again，污染记忆状态。
      if (!WARMUP_RESULT_STATUSES.has(status)) continue;
      pushOnce(matched, status, Number(point.progress) || 0);
    }
  }
  return outcomes;
}

/** 从本节看板点里剔除温故点（保证到期旧知不污染本节知识点清单） */
export function stripWarmupPoints<T extends { name: string }>(
  plan: ReviewPlan | null | undefined,
  points: T[],
): T[] {
  if (!plan || !Array.isArray(points)) return points;
  return points.filter((point) => !matchWarmupItem(plan, String(point?.name || '')));
}

/**
 * 标记「模型真的把这个温故点问出来了」（首次）。
 *
 * 与 `mergeWarmupOutcomes`（记录**结果**）分开：模型常把温故点以 `review`/`pending` 写回
 * （= 我已经问了/正要问），这不是作答表现，但它证明**确实发生了这次回捞**。
 * 结算时凭它把"问过、但始终没推进"判定为**没答出**——否则失败永不入库：
 * 成功率与保持曲线只剩上界，leech（连续答不出）与队列自净也永远不会触发。
 */
export function markWarmupAsked(
  plan: ReviewPlan | null | undefined,
  points: Array<{ name: string }> | null | undefined,
  askedAt: string,
): ReviewPlan | null {
  if (!plan || !Array.isArray(plan.items) || !Array.isArray(points)) return plan ?? null;
  const matched = new Set<string>();
  for (const point of points) {
    const item = matchWarmupItem(plan, String(point?.name || ''));
    if (item) matched.add(item.conceptKey);
  }
  if (matched.size === 0) return plan;
  return {
    ...plan,
    items: plan.items.map((item) =>
      matched.has(item.conceptKey) && !item.askedAt ? { ...item, askedAt } : item,
    ),
  };
}

/** 把温故结果并进持久化计划项（按归一化键匹配） */
export function mergeWarmupOutcomes(
  plan: ReviewPlan | null | undefined,
  updates: Array<{ conceptKey: string; status: string; progress: number }>,
  reviewedAt: string,
): ReviewPlan | null {
  if (!plan || updates.length === 0) return plan ?? null;
  const byKey = new Map(updates.map((item) => [warmupKeyOf(item.conceptKey), item]));
  return {
    ...plan,
    items: plan.items.map((item) => {
      const update = byKey.get(warmupKeyOf(item.label || item.conceptKey));
      if (!update) return item;
      return { ...item, outcome: { status: update.status, progress: update.progress, reviewedAt } };
    }),
  };
}
