/**
 * 终态一致性校验（#52 P-26 第③例）。
 *
 * 两处不一致会在同一节课上互相打脸：
 * ① **任务终态**：收束记录「任务已完成」，但任务行仍是 todo/in_progress —— 会话 completed、
 *    任务没完成，进度与结算从此长期错账（重进补结算 / 清场重试都救不回来）。
 * ② **知识点终态**：wrapup 的 knowledgeItem 自己在 evidence/reason 里写了「反复冒头」「仍会」
 *    「还在怀疑」这类相悖表述，却把该点标成 mastered / ≥90% —— 总结与证据互相矛盾，
 *    下游掌握度与重排建议会按虚高的分走。
 *
 * 本模块只做确定性判断（无 LLM）：结构项不满足即失败；语义项命中即把该点封顶到 89%。
 */

/** 与知识点「已掌握」相悖的表述（来自 20261004/case-abbt 的 1a1fc1bb idea）。 */
export const CONTRADICTION_MARKERS = [
  '反复冒头',
  '仍会',
  '仍然会',
  '还在怀疑',
  '仍未掌握',
  '还没掌握',
  '依旧不会',
  '再次出错',
] as const;

/** 总评/单点自评里出现相悖表述时，该点允许的最高进度（严格低于 90 的门槛）。 */
export const CONTRADICTION_PROGRESS_CAP = 89;

type KnowledgeItemLike = {
  name?: string;
  status?: string;
  progress?: number;
  evidence?: string;
  reason?: string;
  [key: string]: unknown;
};

function itemText(item: KnowledgeItemLike): string {
  return [item.evidence, item.reason]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

/**
 * wrapup 知识点终态一致性：证据里出现相悖表述时，禁止该点继续输出 mastered / ≥90%。
 * - 命中且 status='mastered' → 降级 learning；
 * - 命中且 progress ≥ 90 → 封顶 89；
 * - 无可核对文本（evidence/reason 都空）→ 不动（证据不足不反过来惩罚）。
 */
export function applyKnowledgeTerminalConsistency<T extends KnowledgeItemLike>(
  knowledgeItems: T[] | undefined,
): { knowledgeItems: T[]; downgraded: string[] } {
  const downgraded: string[] = [];
  const items = (Array.isArray(knowledgeItems) ? knowledgeItems : []).map((item) => {
    const text = itemText(item);
    if (!text) return item;
    const contradicted = CONTRADICTION_MARKERS.some((marker) => text.includes(marker));
    if (!contradicted) return item;

    const progress = Number(item.progress);
    const needsCap = Number.isFinite(progress) && progress > CONTRADICTION_PROGRESS_CAP;
    const needsStatusDowngrade = item.status === 'mastered';
    if (!needsCap && !needsStatusDowngrade) return item;

    downgraded.push(String(item.name || item.status || 'unknown'));
    return {
      ...item,
      ...(needsStatusDowngrade ? { status: 'learning' } : {}),
      ...(needsCap ? { progress: CONTRADICTION_PROGRESS_CAP } : {}),
      terminalConsistencyDowngraded: true,
    } as T;
  });
  return { knowledgeItems: items, downgraded };
}

/**
 * 任务终态一致性：收束声称任务完成时，写入结果里的任务现状必须是 completed。
 * 形状未知（旧调用方/测试桩不返回 task）时不判——只对**明确观测到非 completed** 的情况失败。
 */
export function validateTaskTerminalConsistency(completion: unknown): {
  ok: boolean;
  observedStatus: string | null;
  message: string;
} {
  const task = (completion as { task?: { status?: unknown } | null } | null)?.task;
  const observedStatus = typeof task?.status === 'string' ? task.status : null;
  if (observedStatus === null || observedStatus === 'completed') {
    return { ok: true, observedStatus, message: '' };
  }
  return {
    ok: false,
    observedStatus,
    message: `任务终态不一致：收束记录了任务完成，但任务状态仍为 ${observedStatus}`,
  };
}
