/**
 * 相邻教师轮低增量重复护栏（issue #103 / E-02 语义卡环，2026-10-19 最小版）。
 *
 * 背景：课堂后半段出现「换句话重复同一信息」的循环——现库读数（.tmp-night-watch/e02.ts，
 * completed 会话 20 个）卡环率 0.3431 vs 置换零假设 0.1000。该形态对题面级机械尺不可见
 * （关键词/占位/重复问句全绿），本质是文本级相似度问题。主防线是提示词侧规则
 * （prompts/core/teaching-turn.yaml「相邻轮不得复述已教内容」）；本模块只提供
 * **运行时确定性判据**，由引擎打告警用（不改写回复、不阻断课堂，见 teaching-turn-engine.ts 调用点）。
 *
 * 判据与既有机械尺同源：backend/scripts/measurement-verify/r6post-eval.mjs 的
 * mechTeacherLoop 用「归一化后字三元组 Jaccard ≥ 0.5」判相邻老师轮高度雷同。本模块复用
 * 同一归一化与三元组口径、同一阈值，保证「运行时告警」与「事后读数」是同一把尺。
 * 跑批阶段的 embedding 语义尺（.tmp-night-watch/e02.ts：max(0.70, 本会话非相邻基线+0.05)、
 * 连续 ≥3 轮）是**验收**尺，不在运行时使用（远端 bge 不现实），两者口径差异已知。
 *
 * 判据（两步，见 assessAdjacentRepetition）：
 * 1) 相似够高：归一化字三元组 Jaccard ≥ 0.5；
 * 2) 增量够低：本轮三元组中「上一轮没出现过」的占比 ≤ 0.35——只有 1) 会把
 *    「完整复述上一轮 + 末尾补一句新推进」也判成重复（实测 Jaccard 0.61 / 新三元组 39%），
 *    那类轮次确实带来了新信息，不该告警。
 *
 * 精度优先（宁少勿多，误报会淹没告警、也会让后续回归读数失真）：
 * - 两条回复归一化后都 ≥ MIN_CHARS 才判定（"好，你试试"这类短回复一律不判）；
 * - 「检索/巩固式提问」豁免——这是提示词明文允许的唯一例外（让学生回忆/复述/用自己的话重讲）；
 * - 本模块纯函数、无 IO、无随机：只返回判定结果，告警与遥测由调用方决定。
 * - 已知局限：字面尺对「同义改写」（换掉全部用词）不敏感，会漏判——这是分词/改写级
 *   重复的固有上限；真正验收仍以跑批阶段的 embedding 语义尺（e02 口径）为准。
 */

/**
 * 相邻轮低增量重复阈值（归一化字三元组 Jaccard）。
 * 与 r6post-eval.mjs mechTeacherLoop 的 `j >= 0.5` 同值：两把尺同口径，便于事后对照。
 */
export const ADJACENT_REPEAT_JACCARD_THRESHOLD = 0.5;

/**
 * 判定下限（归一化后字符数）：低于它不判——短回复（"好，你试试""对，继续"）三元组太少，
 * Jaccard 噪声大，告警只会变成噪声。40 字≈38 个三元组，够构成稳定重叠。
 */
export const ADJACENT_REPEAT_MIN_CHARS = 40;

/**
 * 「低增量」上限：本轮三元组里最多只允许这么小的一部分是上一轮没出现过的。
 * 单看 Jaccard 会把「完整复述上一轮 + 末尾加一句新推进」也算重复（实测 a~f：
 * Jaccard 0.61 / 新三元组 39%——那是真加了新内容）；本上限把这类加料轮排除在告警外（宁少勿多）。
 */
export const ADJACENT_REPEAT_MAX_NOVEL_RATIO = 0.35;

/** 归一化：去 Markdown 记号/标点/空白并小写（与 r6post-eval.mjs normText 逐字符同口径） */
const NORMALIZE_STRIP_RE = /[*#`>\-\n\r\s、，。；：！？「」『』（）()【】[\]]/g;

/** 检索/巩固式提问的线索词（提示词例外条：调用已教内容 ≠ 复述） */
const RETRIEVAL_CUE_RE = /(回忆|回想|还记得|复述|用自己的话|回顾|想一想|说说看|试着说|说说|考考你|检查一下|再确认|刚才讲|前面讲|刚学|前面学)/;
const QUESTION_MARK_RE = /[?？]/;

export type AdjacentRepetitionReason =
  /** 命中：相邻轮换措辞未增信息 */
  | 'low-increment-repeat'
  /** 未命中：两轮内容确有增量 */
  | 'distinct'
  /** 豁免：本轮是检索/巩固式提问（提示词允许） */
  | 'exempt-retrieval-question'
  /** 不判：任一回复归一化后过短 */
  | 'too-short'
  /** 不判：缺基准（上一轮为空/本轮为空） */
  | 'no-baseline';

export interface AdjacentRepetitionAssessment {
  /** 是否判定为低增量重复（仅此字段为 true 时调用方应告警） */
  lowIncrement: boolean;
  reason: AdjacentRepetitionReason;
  /** 归一化字三元组 Jaccard（0-1） */
  jaccard: number;
  /** 两轮三元组规模与重叠（供遥测定位） */
  previousTrigrams: number;
  currentTrigrams: number;
  sharedTrigrams: number;
  /** 本轮相对上一轮的新三元组数与占比（低增量则占比小） */
  novelTrigrams: number;
  novelRatio: number;
  /** 归一化后字符数（长度门口径） */
  previousChars: number;
  currentChars: number;
}

/** 归一化（导出的纯函数，供单测与遥测对齐） */
export function normalizeReplyForSimilarity(text: unknown): string {
  return String(text ?? '').replace(NORMALIZE_STRIP_RE, '').toLowerCase();
}

/** 字三元组集合（与 r6post-eval.mjs trigrams 同口径） */
export function replyTrigrams(normalized: string): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    set.add(normalized.slice(index, index + 3));
  }
  return set;
}

/** 集合 Jaccard（任一为空返回 0） */
export function trigramJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * 本轮是否为「检索/巩固式提问」（提示词明文允许的例外）：既要有问号，也要有调用已教内容的线索词。
 * 只用于豁免告警——不改变任何教学行为。
 */
export function isRetrievalOrConsolidationQuestion(reply: unknown): boolean {
  const text = String(reply ?? '');
  return QUESTION_MARK_RE.test(text) && RETRIEVAL_CUE_RE.test(text);
}

/**
 * 相邻教师轮低增量重复判定（纯函数，供单测与引擎调用）。
 * previousReply 为上一轮教师回复原文，currentReply 为本轮最终回复原文。
 */
export function assessAdjacentRepetition(
  previousReply: unknown,
  currentReply: unknown,
): AdjacentRepetitionAssessment {
  const previousNormalized = normalizeReplyForSimilarity(previousReply);
  const currentNormalized = normalizeReplyForSimilarity(currentReply);
  const previousTrigrams = replyTrigrams(previousNormalized);
  const currentTrigrams = replyTrigrams(currentNormalized);
  let sharedTrigrams = 0;
  for (const gram of currentTrigrams) {
    if (previousTrigrams.has(gram)) sharedTrigrams += 1;
  }
  const novelTrigrams = currentTrigrams.size - sharedTrigrams;
  const jaccard = trigramJaccard(previousTrigrams, currentTrigrams);

  const base = {
    jaccard,
    previousTrigrams: previousTrigrams.size,
    currentTrigrams: currentTrigrams.size,
    sharedTrigrams,
    novelTrigrams,
    novelRatio: currentTrigrams.size ? novelTrigrams / currentTrigrams.size : 0,
    previousChars: previousNormalized.length,
    currentChars: currentNormalized.length,
  };

  if (!previousNormalized || !currentNormalized) {
    return { ...base, lowIncrement: false, reason: 'no-baseline' };
  }
  if (
    previousNormalized.length < ADJACENT_REPEAT_MIN_CHARS
    || currentNormalized.length < ADJACENT_REPEAT_MIN_CHARS
  ) {
    return { ...base, lowIncrement: false, reason: 'too-short' };
  }
  if (isRetrievalOrConsolidationQuestion(currentReply)) {
    return { ...base, lowIncrement: false, reason: 'exempt-retrieval-question' };
  }
  // 低增量 = 与上一轮够像（Jaccard ≥ 阈值，闭区间）**且**本轮内容几乎全是上一轮已有
  const lowIncrement =
    jaccard >= ADJACENT_REPEAT_JACCARD_THRESHOLD
    && base.novelRatio <= ADJACENT_REPEAT_MAX_NOVEL_RATIO;
  return { ...base, lowIncrement, reason: lowIncrement ? 'low-increment-repeat' : 'distinct' };
}

/**
 * 从消息序列里取**最近一条**教师回复（跳过学生消息与空内容），作为相邻轮基准。
 * 无教师回复（首轮）返回 null。
 */
export function findPreviousAssistantReply(
  messages: ReadonlyArray<{ role?: string | null; content?: unknown }> | null | undefined,
): string | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;
  }
  return null;
}
