/**
 * 平台可观测证据门（#54 P-28）
 *
 * 规则 15 已经禁止「对着镜子念一遍 / 用手比划 / 写在纸上」这类离线物理动作，
 * 但它只是提示词——完成判定与知识点推进仍完全信任模型输出。本模块提供确定性护栏：
 * - 本轮回复要求了离线动作 → 不得据此判完成，也不得把知识点升为 mastered / 推满进度；
 * - 本轮学生只回了「嗯/好的/继续」这类无实质文本 → 同样不足以作为完成证据。
 *
 * 刻意只拦「平台观测不到」的情形；有文本产出（作答/复述/解释）时一律放行，
 * 避免把正常收课卡死（规则 15 已把练习收窄为纯文本可完成）。
 */

/** 离线物理动作：与 prompts/core/teaching-turn.yaml 规则 15 的示例同源 */
export const OFFLINE_ACTION_RE = /对着镜子|镜子(?:里|前)?(?:念|说|练)|用手比划|比划(?:一下|一遍)?|写在纸上|纸上(?:写|画)|离开座位|动手做|拍(?:张|个)照|录(?:个|段)视[频像]|给家人(?:讲|说|演示)|向家人(?:讲|说|演示)/;

/** 无实质产出：纯应答/延续语（不含具体内容） */
const TRIVIAL_UTTERANCE_RE = /^(?:嗯+|哦+|啊+|好的?|好|行|可以|继续|知道了?|明白了?|懂了|收到|谢谢|ok|okay)[。.!！?？~～\s]*$/i;

export interface ObservableEvidence {
  /** 回复里要求了离线物理动作 */
  offlineAction: boolean;
  /** 本轮学生发言是否有实质文本 */
  substantiveUserTurn: boolean;
  /** 最近一条学生发言（截断留痕用） */
  lastUserText: string;
}

export function lastUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown };
    if (message?.role !== 'user') continue;
    return typeof message.content === 'string' ? message.content.trim() : '';
  }
  return '';
}

export function detectObservableEvidence(messages: unknown, reply: unknown): ObservableEvidence {
  const lastUserText = lastUserMessage(messages);
  const substantiveUserTurn = lastUserText.length >= 2 && !TRIVIAL_UTTERANCE_RE.test(lastUserText);
  return {
    offlineAction: typeof reply === 'string' && OFFLINE_ACTION_RE.test(reply),
    substantiveUserTurn,
    lastUserText: lastUserText.slice(0, 120),
  };
}

/**
 * 把证据门作用到知识点输出上：
 * - 离线动作 → mastered 降为 learning，progress 压到 79（不得当作已掌握）；
 * - 无实质学生发言 → 不允许本轮推进到 mastered（保留 learning 及以下）。
 */
export function applyObservableEvidenceGate<T extends { status: string; progress: number }>(
  points: T[],
  evidence: ObservableEvidence
): T[] {
  const blockMastery = evidence.offlineAction || !evidence.substantiveUserTurn;
  if (!blockMastery) return points;
  return points.map((point) => {
    if (point.status !== 'mastered') return point;
    return { ...point, status: 'learning', progress: Math.min(point.progress, 79) };
  });
}
