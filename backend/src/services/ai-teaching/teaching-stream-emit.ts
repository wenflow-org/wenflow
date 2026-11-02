/**
 * 课堂流式推送 · 运行时装配（薄接线层：只读请求上下文，无 DB、无日志、无业务判定）
 *
 * 与 `anchor-probe-emit.ts` 同构的分工：把「与请求绑定的流式通道」翻译成一个可单测的纯接线函数，
 * 从难以端到端测试的 `teaching-turn-engine` 里抽出来。
 *
 * ## 早发导师正文（2026-11-01 课堂流畅度实测）
 *
 * 背景：单轮的长尾**不在模型**，而在模型返回之后那段串行重活——伴学（peer）调用与板书绘图
 * （`designBoard`）。实测三轮：模型 17.7s + 板书 16.3s、模型 16.0s + 板书 21.2s、
 * 模型 108.1s + 板书 41.5s——板书一笔就占掉单轮的三分之一到一半，而它与「老师这段话本身」
 * 无关；两者跑完才 commit 并返回，用户整段时间只能看转圈（实测 31/34.5/37.2s 零界面变化）。
 *
 * 做法：在确定性护栏收口、正文定稿之后，先把正文作为 `delta` 推给客户端，让「老师这句话」先到；
 * `final` 照旧携带完整回合（含小测题面与板书），前端用官方消息覆盖流式气泡（`applyTurnResult`
 * 里 `aiMsg.text = r.aiResponse || aiMsg.text`，复用同一个气泡、不追加），
 * 因此**不需要新增 SSE 事件类型，也不需要改前端**。
 *
 * ## 调用点位置与「正文是否真定稿」
 *
 * 调用点（`teaching-turn-engine` 内 `effectiveTeachingOutput` 组装之后）之前，正文已过
 * 内容正确性与裁决话术两道护栏（`findArithmeticMismatches` / `stripAffirmationsOnFailedVerdict` /
 * `repairContradictedPassedVerdict`）。调用点**之后**正文仍可能变化，两种，均已在实测里确认无害：
 * - **本轮出小测** → 题面被追加进正文（`applyCheckpointQuestionVisibility`）。`final` 是早发文本的
 *   **超集**，前端覆盖同一气泡，观感是「讲解先到、题面随后补上」；
 * - **悬空图引用剥离** → 只改写落库的 `assistantMessage.content`，**不改** `aiResponse`
 *   （早发文本与 `final` 返回的 `aiResponse` 一致）。
 *
 * 为什么不把调用点再往后挪（挪到题面注入之后）：板书绘图（本轮最贵的一步）排在题面注入**之前**，
 * 挪到注入之后等于把板书也留在等待窗口里，早发的收益全丢。取舍见上。
 *
 * ## 边界
 * - 非流式调用（无 `onStream`）静默跳过——API 直接调用方行为零变化；
 * - 推送异常被吞掉，绝不因早发失败影响回合（`final` 仍会带完整正文）；
 * - 只负责"发"，不判断该不该发（该不该发的闸门在引擎里，正文定稿后才调用）；
 * - `TEACHING_EARLY_REPLY_DELTA=0` 可整体关回旧行为（一次性出字），见 `isEarlyReplyDeltaEnabled`。
 *
 * ## 落地实测（2026-11-01，真课/真模型）
 *
 * 修前（原走查 3 轮）：正文只在 `final` 一次性出现，`stream=0`；单轮 65.6s / 57.2s / 52.6s，
 * 其中 31.0s / 34.5s / 37.2s 界面零变化（用户对着转圈）。
 *
 * 修后（同课续 1 轮，chat 路径且本轮出小测）：发送 → 25.6s 模型返回并**同刻**触发早发，
 * 客户端 ≤1 个采样（~3s 粒度）即渲染出导师正文；本轮 42.9s 才 `final`——即**约 13.7s 的
 * 「干等」被挪成了「读着等」**；`final` 时正文由 111 字变 141 字（小测题面随后补上，符合上文预期）。
 * 服务端 `[EARLY-DELTA-PROBE] fired at=<epoch>` 与客户端首字时刻对齐，可复核。
 */
import { getRequestContext } from '../../gateway/api-gateway/context';

/**
 * 早发正文开关：env `TEACHING_EARLY_REPLY_DELTA=0|false|off|no` 关闭，默认开。
 * 留这个口子是为了能对同一课堂做「开/关」A/B（本改动只影响「何时把字给用户看」，
 * 关掉即回到旧行为：final 一次性出字），也让线上出问题时能一键回退而不必回滚代码。
 */
export function isEarlyReplyDeltaEnabled(raw?: string | null): boolean {
  const value = String(raw ?? process.env.TEACHING_EARLY_REPLY_DELTA ?? '1').trim().toLowerCase();
  return !(value === '0' || value === 'false' || value === 'off' || value === 'no');
}

/**
 * 把定稿的导师正文作为 `delta` 早发一份给客户端。
 *
 * @param reply 本轮导师正文（`TeachingTurnOutput['reply']`）。非字符串 / 空串直接跳过。
 */
export function emitEarlyReplyDelta(reply: unknown): void {
  const text = typeof reply === 'string' ? reply.trim() : '';
  if (!isEarlyReplyDeltaEnabled() || !text) return;
  const onStream = getRequestContext().streamRequest?.onStream;
  if (typeof onStream !== 'function') return;
  try {
    onStream({ type: 'delta', text });
  } catch {
    // 早发失败不影响回合：final 仍会带完整正文
  }
}
