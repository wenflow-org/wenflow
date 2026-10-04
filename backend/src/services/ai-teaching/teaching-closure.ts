/**
 * 收口闭合门禁（2026-10-04，H3 回测立项）
 *
 * 病灶形态（endTime 口径 26.5% 完结课残留，pre-S1/S1/S2 三窗稳定 22.8%→26.5%）：
 * 完成信号与「本回合新抛的问题 / 未答的检查点」同回合出现——学员永远轮不到作答，
 * 课已 completed；末问还被改写进 wrapup 的 actionPlan。提示词（evig1「未答不收口」）
 * 与检查点强制消费都不触及这条路径，属收口判决链缺口（computeClosureDecision 与
 * teaching-turn-engine 三条完成路径均不核对问答闭合）。
 *
 * 修法：延迟一轮收束——本回合照常输出教学内容，完成信号压住；学员先答这道题，
 * 下一回合再走收口。不做的事：
 * - 不拦 learner 主动求收课（endIntent 路径不动）；
 * - 不因「末次检核答错」拦收课——重答上限（CHECKPOINT_MAX_ATTEMPTS）到顶后
 *   「记复习清单→收课」是合法收束形态，拦它会把循环病灶请回来。
 *
 * 活力兜底：同会话最多延迟 COMPLETION_DEFERRAL_CAP 次，超过即放行，
 * 防止「老师每回合都带问号」把课拖到永不收敛。
 */

/** 同一会话内完成信号最多被延迟的次数；到顶后放行（liveness backstop）。 */
export const COMPLETION_DEFERRAL_CAP = 2;

/**
 * 末问检测：回复文本里是否新抛了等学员作答的问题。
 * 口径与 H3 回测的机械判据一致（含任意问号即计，不要求句尾）——
 * 「三国之后紧接着的是哪一段？A.晋 B.南北朝 C.秦汉」问号在句中。
 * 代码课堂里的 `obj?.method` 会误计一回合，由延迟上限兜住，可接受。
 */
export function detectTrailingQuestion(reply: string): boolean {
  return /[？?]/.test(String(reply || ''));
}

export interface ClosureGateInput {
  /** 本回合老师的回复文本（teachingOutput.reply） */
  reply: string;
  /** 上一回合遗留、尚未作答的检查点（previousTeachingState.pendingCheckpoint） */
  pendingCheckpoint: unknown;
  /** 本回合模型是否又输出了新检查题（control.checkpoint） */
  checkpointEmittedThisTurn: boolean;
  /** 此前已被延迟过几次（teachingState.completionDeferrals） */
  priorDeferrals: number;
}

export interface ClosureGateDecision {
  /** true = 本回合压住完成信号，延迟一轮 */
  defer: boolean;
  /** 压住原因（日志/观测用），defer=false 时为 null */
  reason: 'pending-checkpoint-unanswered' | 'checkpoint-emitted-this-turn' | 'trailing-question' | null;
}

export function shouldDeferCompletionForClosure(input: ClosureGateInput): ClosureGateDecision {
  const priorDeferrals = Number(input.priorDeferrals) || 0;
  if (priorDeferrals >= COMPLETION_DEFERRAL_CAP) {
    return { defer: false, reason: null };
  }
  if (input.pendingCheckpoint) {
    return { defer: true, reason: 'pending-checkpoint-unanswered' };
  }
  if (input.checkpointEmittedThisTurn) {
    return { defer: true, reason: 'checkpoint-emitted-this-turn' };
  }
  if (detectTrailingQuestion(input.reply)) {
    return { defer: true, reason: 'trailing-question' };
  }
  return { defer: false, reason: null };
}
