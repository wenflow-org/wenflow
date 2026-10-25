/**
 * goal 延期门禁（2026-10-25 夜批发现，v11/v12 实证）：
 *
 * 学员（虚拟或真人）连续「先去查后台 / 回头再说」时，goal 对话会在
 * understanding / proposing 无限等待——v11 停在 proposing、v12 停在 understanding，
 * 各 14 步（harness 上限）不收敛。与课堂收口是同一类语义缺口：
 * **用户延期时应产出带假设的临时方案并显式收敛，而不是无限等待。**
 *
 * 确定性护栏（不依赖模型自觉）：
 * - 同一会话普通回合数达到上限仍未离开 goal：
 *   - `proposing` → 视为事实确认，走确认链路生成路径（学员已给足信息，方案本就挂着）；
 *   - `understanding` → 本回合收敛为 `proposing`（用已收集的理解合成方案），
 *     下一回合自然命中确认分支。
 * - 显式拒绝文本不受门禁代签（沿用 confirm 链路的否决优先规则）。
 * - 门禁触发会写确认计量（reason=`forced-by-deferral-cap`），可查询、可统计。
 */

/** 回合上限：harness GOAL_MAX_STEPS=14，门禁在 10 回合触发，留 4 步给收敛+确认 */
export const GOAL_DEFERRAL_TURN_CAP = 10;

export interface GoalDeferralCapInput {
  /** 会话当前持久化 stage */
  stage: string | null | undefined;
  /** 会话 messages 数组长度（user+ai 消息合计；回合数 = ⌊条数/2⌋） */
  messageCount: number;
  /** 本轮是否已经确认（UI 标志或自然语言确认命中）——已确认则门禁不重复介入 */
  confirmAlready: boolean;
}

export interface GoalDeferralCapDecision {
  /** proposing 达上限：本轮按确认处理 */
  forceConfirm: boolean;
  /** understanding 达上限：本轮收敛为 proposing */
  forcePropose: boolean;
  /** 当前回合数（⌊条数/2⌋），供日志与计量 */
  turnCount: number;
}

export function evaluateGoalDeferralCap(input: GoalDeferralCapInput): GoalDeferralCapDecision {
  const noOp: GoalDeferralCapDecision = { forceConfirm: false, forcePropose: false, turnCount: Math.floor((Number(input.messageCount) || 0) / 2) };
  if (input.confirmAlready) return noOp;
  if (noOp.turnCount < GOAL_DEFERRAL_TURN_CAP) return noOp;
  const stage = String(input.stage || '');
  if (stage === 'proposing') return { forceConfirm: true, forcePropose: false, turnCount: noOp.turnCount };
  if (stage === 'understanding') return { forceConfirm: false, forcePropose: true, turnCount: noOp.turnCount };
  return noOp;
}

/** 解析会话 messages JSON 的条数；坏数据按 0 处理（门禁不误触发） */
export function parseConversationMessageCount(messages: unknown): number {
  if (Array.isArray(messages)) return messages.length;
  try {
    const parsed = JSON.parse(String(messages ?? '[]'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
