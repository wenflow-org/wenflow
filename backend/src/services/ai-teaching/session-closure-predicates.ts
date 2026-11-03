/**
 * 会话收束口径谓词（原在 teaching-session-lifecycle.ts，2026-11-03 拆出）。
 *
 * 拆出原因： 已超基线且只许缩短（超大文件棘轮），
 * 而这一簇是纯谓词/常量，不依赖收束流程的任何状态。
 * 调用方（SessionFinalizationService / 各测试）经由本文件或原文件的再导出取用，签名不变。
 */

/**
 * 非正常终态收束判定（幽灵课 / 弃跑状态泄漏，2026-10-06 修复）。
 *
 * 语义：这次收束不是「学完了」而是「跑掉了 / 课已经废了」。命中后收束**仍然闭合状态机**
 * （会话照常落到 completed，wrapup 照常落库，调用方的轮询/清场逻辑不变），但**不写正式轨**：
 * learner_evidence（含 lesson:completed 事件与快照刷新）/ learning_metrics（session-wrapup 与
 * session_load）/ 记忆回写（FSRS trace、误解台账、休眠信号）/ 温故回写（review:completed），
 * 只留一条审计日志。
 *
 * 判定口径（宁窄勿宽——正常收束路径必须逐字不变）：
 * - `endReason === 'learner-abandoned'`：调用方显式声明学习者放弃。这是当前唯一可达的异常信号：
 *   产品结束接口（`ai-teaching.routes.ts:906,965`）、清场服务（`open-session-clearance.service.ts:130`）、
 *   虚拟学习者驾驶器弃跑（`platform-user-adapter.ts:398`）都走它。
 * - `status ∈ {discarded, superseded, failed}`：防御性覆盖。正常状态机下这些状态到不了收束入口
 *   （`TeachingSessionRepository.ts:1025-1030` 的 allowedStatuses 已把它们挡在 claim 之外）。
 * - **`timeout` 不在集合内**：超时是可恢复态（`timeoutIfIdle`/`timeoutIfPaused` → 下一轮教学回合
 *   `commitTurnState` 复活为 active），其轻量兜底 wrapup 是既定行为；把它当异常会误伤
 *   「超时后回来继续学、正常收束」的路径。
 */
export const ABNORMAL_CLOSURE_STATUSES = ['discarded', 'superseded', 'failed'] as const;

/** 幽灵课判据：整节课没有形成一次真实往返，且时长不到一分钟（#69 实测样本 27.3s / 3 条消息）。 */
export const GHOST_SESSION_MAX_SECONDS = 60;
export const GHOST_SESSION_MAX_USER_TURNS = 2;

export function isAbnormalSessionClosure(input: {
  endReason?: string | null;
  status?: string | null;
  /**
   * 真实学生回合数（排除检查点合成消息）。与 durationSeconds 同时提供时才做幽灵课判定；
   * 不传 = 保持旧口径（只认 endReason/status），避免所有既有调用点被隐式改语义。
   */
  userTurnCount?: number | null;
  /** 会话时长（秒）。幽灵课判定的第二条件，见 GHOST_SESSION_*。 */
  durationSeconds?: number | null;
}): boolean {
  if (input.endReason === 'learner-abandoned') return true;
  if (!!input.status && (ABNORMAL_CLOSURE_STATUSES as readonly string[]).includes(input.status)) return true;
  // #69 幽灵课：走的是正常收束理由（manual-end / task-completed），但整节课只有开场 + 至多一句
  // 学生发言，几十秒就结算。它不是「学完了一节」，只是任务被顺手点完成——不该写证据/负荷/FSRS。
  // 阈值刻意收得窄（<2 个学生回合且 <60s）：正常短复习课仍有至少两次往返，不会误伤。
  if (input.userTurnCount != null && input.durationSeconds != null) {
    if (input.userTurnCount < GHOST_SESSION_MAX_USER_TURNS && input.durationSeconds < GHOST_SESSION_MAX_SECONDS) {
      return true;
    }
  }
  return false;
}