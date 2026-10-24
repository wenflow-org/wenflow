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


/**
 * 机械收束门禁（#51 P-25）：endSession 此前只看「谁来结束」，不核对课内问答是否闭合，
 * 于是「老师刚抛了问题 / 检查点还没判对」也能直接结算，末问被写进 wrapup 的 actionPlan。
 *
 * 与回合内的延迟收束（shouldDeferCompletionForClosure）分工不同：
 * - 回合内：压住「模型想收」的信号，最多 2 次，避免拖死；
 * - 收束入口：学员/系统主动结束时，若仍有未闭合问答则 409，让前端先作答（或走放弃路径）。
 * 放弃/异常终态一律放行——那不是「没答完」，是「不学了」。
 */
export type SessionClosableCode =
  | 'FINALIZATION_PENDING_CHECKPOINT'
  | 'FINALIZATION_OPEN_QUESTION'
  | 'FINALIZATION_LAST_CHECKPOINT_FAILED';

export interface SessionClosableDecision {
  closable: boolean;
  code?: SessionClosableCode;
  message?: string;
}

const ABNORMAL_END_REASONS = new Set([
  'learner-abandoned',
  'abandoned',
  'timeout',
  'error',
  'failed',
  'system',
]);

/** 检查点最多作答次数（与 CHECKPOINT_MAX_ATTEMPTS 同口径；到顶后允许带错收束） */
const CLOSURE_CHECKPOINT_MAX_ATTEMPTS = 2;

export function evaluateSessionClosable(input: {
  messages: Array<{ role?: string; content?: string }> | null | undefined;
  teachingState: Record<string, unknown> | null | undefined;
  endReason?: string | null;
  /**
   * 允许「教师刚提问、学生还没答」时收束。用于两类非结算场景：
   * - 复习课（complete_review）：有界课，回合上限到点就收，教师的下一问本来就是被截断的那一问；
   *   待答检查点同理（未答点按「本次无观测」跳过，由 collectReviewOutcomes 只收集已判定点）。
   * - 主动退出（end_only「结束学习，不计入完成」）：退出通道不该被「先答题」挡住，
   *   否则真人只能关页走 abandoned 豁免。
   * 结算（complete_task）不放行——那正是本门禁要守的假完成。
   */
  allowOpenQuestion?: boolean;
}): SessionClosableDecision {
  if (input.endReason && ABNORMAL_END_REASONS.has(input.endReason)) return { closable: true };

  const state = input.teachingState || {};
  if (state.pendingCheckpoint && !input.allowOpenQuestion) {
    return {
      closable: false,
      code: 'FINALIZATION_PENDING_CHECKPOINT',
      message: '还有一道题没有作答，先完成这道题再结束课堂',
    };
  }

  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user') break;
    if (message?.role === 'assistant' && !input.allowOpenQuestion && detectTrailingQuestion(String(message.content || ''))) {
      return {
        closable: false,
        code: 'FINALIZATION_OPEN_QUESTION',
        message: '老师刚提了一个问题，先回答再结束课堂',
      };
    }
  }

  const history = Array.isArray(state.checkpointHistory) ? state.checkpointHistory : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i] as { passed?: unknown; skipped?: unknown; attempts?: unknown };
    if (entry?.skipped === true) break;
    if (entry?.passed === false) {
      const attempts = Number(entry.attempts);
      // 只有「还能再答」时才拦；到顶（或旧数据没有次数）按既有设计放行，
      // 避免把「记复习清单 → 收课」这条合法收束路径重新焊死。
      if (Number.isFinite(attempts) && attempts < CLOSURE_CHECKPOINT_MAX_ATTEMPTS) {
        return {
          closable: false,
          code: 'FINALIZATION_LAST_CHECKPOINT_FAILED',
          message: '最后一道检查题还没答对，先再试一次或跳过它',
        };
      }
    }
    break;
  }

  return { closable: true };
}

/**
 * 收口审计（2026-10-24，离线评审基线：85% 课堂未答收口）：
 * end_only/复习课允许带着未答问题收束，但**必须留下可读的「待验证」事实**，
 * 不能把「会话结束」写成「任务完成/学员已掌握」。审计随 wrapup 落库，
 * 供前端、后续课堂与离线评审消费；不改任何收束判定。
 */
export interface ClosureAudit {
  openQuestion: boolean;
  code: SessionClosableCode | null;
  question: string | null;
  /** 回合内收口被延迟过几次（到顶后放行是 liveness 兜底） */
  deferredTimes: number;
}

/** 最后一条教师问题：从末尾向前找 assistant 消息中含问号的句子；遇到 user 消息即停。 */
export function lastTeacherQuestion(messages: Array<{ role?: string; content?: string }> | null | undefined): string | null {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message?.role === 'user') break;
    if (message?.role !== 'assistant') continue;
    const text = String(message.content || '').trim();
    if (!detectTrailingQuestion(text)) continue;
    const sentences = text.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
    const hit = [...sentences].reverse().find((sentence) => detectTrailingQuestion(sentence));
    const question = (hit || text).replace(/\s+/g, ' ').trim();
    return question.length > 240 ? question.slice(0, 240) + '…' : question;
  }
  return null;
}

/**
 * 生成收口审计。判定口径与结算门禁**同源**（allowOpenQuestion=false）：
 * 若门禁认为尚有未闭合问答，则记录 openQuestion；异常终态（放弃/超时）不算缺陷。
 */
export function buildClosureAudit(input: {
  messages: Array<{ role?: string; content?: string }> | null | undefined;
  teachingState: Record<string, unknown> | null | undefined;
  endReason?: string | null;
}): ClosureAudit {
  const deferredTimes = Number((input.teachingState as { completionDeferrals?: unknown } | null)?.completionDeferrals) || 0;
  const decision = evaluateSessionClosable({
    messages: input.messages,
    teachingState: input.teachingState,
    endReason: input.endReason,
    allowOpenQuestion: false,
  });
  if (decision.closable) {
    return { openQuestion: false, code: null, question: null, deferredTimes };
  }
  return {
    openQuestion: true,
    code: decision.code ?? null,
    question: lastTeacherQuestion(input.messages),
    deferredTimes,
  };
}

/**
 * 把「待验证」确定性写进总结的 actionPlan（去重、置顶）。
 * 不依赖模型是否诚实：即使 LLM 总结漏掉未答问题，这里也一定留痕。
 */
export function appendClosureFollowUp<T extends Record<string, unknown> | null | undefined>(
  summary: T,
  audit: ClosureAudit,
): T {
  if (!audit.openQuestion) return summary;
  const source = (summary || {}) as Record<string, unknown>;
  const note = `待验证：${audit.question || '最后提出的问题尚未得到学员回答'}`;
  const plan = Array.isArray(source.actionPlan)
    ? source.actionPlan.filter((item) => !String(item || '').startsWith('待验证'))
    : [];
  return { ...source, actionPlan: [note, ...plan] } as unknown as T;
}
