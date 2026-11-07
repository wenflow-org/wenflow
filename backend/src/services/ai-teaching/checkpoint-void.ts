/**
 * 检查点作废通道（2026-11-07 入户实证）。
 *
 * ## 为什么需要它
 * 模型能在 reply 正文里宣布「这道跳过」，但此前**没有任何作废通道**——客户端的 `payload.skip`
 * 要求 `checkpoint.allowSkip === true`，模型刚创建的小测无法被自己撤销；单槽 `pendingCheckpoint`
 * 加上出题闸门（有 pending 就不发新题）导致旧题物理卡住新题约 65 分钟（真课轨迹：⑤ 题
 * attempts 1、2 跨 11:25–11:41，而教师 10:49 已说弃、10:50 已把话题推进到 ⑥）。
 *
 * ## 语义边界（终审 2026-11-07 修正过一轮，务必保持）
 * **作废不授权本轮出题。** 出题时机只有一个权威——编排层的 `controls.emitCheckpoint`。
 * 作废恰恰发生在「pending 还在」的回合，该轮 `shouldEmitCheckpoint` 必为 false（它第一眼就看到
 * pending）；即便模型仍输出了 `control.checkpoint`，也会被引擎的出题闸（待答票 + 节奏票）拦下、
 * 不落库。新题留到后续满足出题时机的回合按正常节奏再出。
 * 早期实现用 `voidedPendingCheckpoint ||` 额外放开了节奏票，等于让模型靠一句「作废」就能绕过
 * 编排层的出题节奏（与提示词里「emitCheckpoint 为 false 时不得输出 checkpoint」直接冲突），已删除。
 *
 * ## 调用方必须带的两条护栏
 * 1. 只在**非作答回合**调用。真实提交路径把 `checkpointId` 与 `checkpointJudgement` 一起送进同一
 *    回合，`submittedCheckpoint` 恒为真；若无条件清 pending，每一次真实作答回合都会把
 *    「答错保留可重答」静默打断。
 * 2. 只在**确实存在** pending 时调用（没有旧题可作废）。
 */
import { logger } from '../../utils/logger';
import { parseSessionArtifacts } from './checkpoint-shared';

/** 待作废检查点的最小结构：只取账本留痕需要的字段，避免把整个 pending 对象搬来搬去。 */
export interface VoidablePendingCheckpoint {
  id: string;
  title?: string;
  /** 检查点类型（判断题/选择题…），原样留痕 */
  type?: string;
  question?: string;
  options?: Array<{ id: string; text: string }>;
  correctOptionIds?: Array<string | number>;
}

/** `checkpointHistory` 里的一条作废记录（行形状照抄 skip 记录，用 `voided` 取代 `skipped`）。 */
export interface VoidedCheckpointRow {
  checkpointId: string;
  title?: string;
  type?: string;
  question?: string;
  options?: Array<{ id: string; text: string }>;
  correctOptionIds?: string[];
  submittedAt: string;
  passed: false;
  voided: true;
}

/**
 * 作废当前 pending 检查点：清 pending（同时清 `sessionArtifacts.pendingCheckpoint`，清理口径照
 * `teaching-session-ops.ts` 的 skip 分支）、往 `checkpointHistory` 追加一条 `voided: true` 留痕。
 *
 * 就地修改传入的 `teachingState`；返回值只为让调用方记日志/断言，不改变语义。
 */
export function applyVoidPendingCheckpoint(
  teachingState: Record<string, unknown>,
  pending: VoidablePendingCheckpoint,
  sessionId: string,
): VoidedCheckpointRow {
  delete teachingState.pendingCheckpoint;

  const artifacts = { ...parseSessionArtifacts(teachingState) };
  delete artifacts.pendingCheckpoint;
  teachingState.sessionArtifacts = artifacts;

  const history: VoidedCheckpointRow[] = Array.isArray(teachingState.checkpointHistory)
    ? [...(teachingState.checkpointHistory as VoidedCheckpointRow[])]
    : [];

  const row: VoidedCheckpointRow = {
    checkpointId: pending.id,
    ...(pending.title === undefined ? {} : { title: pending.title }),
    ...(pending.type === undefined ? {} : { type: pending.type }),
    ...(pending.question === undefined ? {} : { question: pending.question }),
    ...(pending.options?.length
      ? { options: pending.options.map((option) => ({ id: option.id, text: option.text })) }
      : {}),
    ...(pending.correctOptionIds?.length
      ? { correctOptionIds: pending.correctOptionIds.map(String) }
      : {}),
    submittedAt: new Date().toISOString(),
    passed: false,
    voided: true,
  };
  history.push(row);
  teachingState.checkpointHistory = history.slice(-20);

  logger.info('[teaching-turn] 模型声明作废检查点：清除 pendingCheckpoint 并留 voided 痕（出题时机仍由 controls.emitCheckpoint 决定）', {
    sessionId,
    checkpointId: pending.id,
  });

  return row;
}
