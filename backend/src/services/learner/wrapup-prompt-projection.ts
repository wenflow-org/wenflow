/**
 * wrapup 提示词投影（SSOT，2026-11-08 全 skill 缓存调查）
 *
 * 背景：`lesson:completed` 落库的 persistedWrapup 由
 * `services/ai-teaching/teaching-session-lifecycle.ts` 组装，除了收束语义，
 * 还混进了**运行时状态机**与**审计元数据**。这些键对提示词消费方零信息量，
 * 且逐次变化会打断 KV 前缀缓存（实测 guidance 载荷里 runtimeEnvelope 一个就 5.6KB）。
 *
 * 两个消费方共用本清单，避免各写一份而漂移：
 *  1. 引导文案/仪表盘投影 —— `LearnerProjectionService.toGuidanceWrapup`
 *  2. 课后知识增强器载荷 —— `LessonKnowledgeEnrichmentConsumer`
 *
 * 收录标准：**有源码或注释证明"不被消费方读取"**，或有同源重复副本可取。
 */
export const WRAPUP_PROMPT_DROP_KEYS: readonly string[] = [
  'runtimeEnvelope',      // 执行信封（模型/路由/耗时），审计用
  'shadowDeterministic',  // 源码自述「仅供比对，不被任何消费方读取」
  'closureAudit',         // 收口事实，离线评审/前端用
  'sources',              // 产物溯源标记
  'summarySource',        // summary 的来源标注（provenance）
  'evaluationSource',     // evaluation 的来源标注（provenance）
  'extensionObservability', // 源码自述「只观测…本期不进任何重排判据」
];

/**
 * 把 wrapup 投影成"只含收束语义"的载荷片段。
 *
 * 非对象/数组/空值原样返回（`null`/`undefined` → `null`），不抛错；
 * 对象经剔除后若一个键都不剩，同样返回 `null`（语义 = 没有可用的收束摘要）。
 */
export function projectWrapupForPrompt(
  wrapup: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!wrapup || typeof wrapup !== 'object' || Array.isArray(wrapup)) {
    return (wrapup as Record<string, unknown>) ?? null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wrapup)) {
    if (WRAPUP_PROMPT_DROP_KEYS.includes(key)) continue;
    out[key] = value;
  }
  // 全部键都被剔除 → 返回 null 而不是空对象。
  // 否则调用方的 `?? undefined` / `|| undefined` 对 `{}` 不生效（空对象非 nullish），
  // 会让「本来没有收束摘要」与「有但被投影成空」在载荷里表现不同（{} vs 缺键），
  // 白白多一段可变前缀。null 表示「没有可用的收束摘要」。
  return Object.keys(out).length > 0 ? out : null;
}
