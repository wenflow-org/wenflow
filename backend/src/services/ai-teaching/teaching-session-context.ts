/**
 * 当前教学会话上下文（AsyncLocalStorage）
 *
 * 动机（审计 §5.2 P2 尾巴）：会话内触发的 aux skill（learner-state-review / concept-consolidator /
 * concept-load-estimator / replan-attribution …）此前不传 `sessionId`，
 * 于是它们的 LLM 调用落在 `agent_call_logs` 的"(无会话)"栏——成本无法归到那一节课。
 *
 * 逐个调用点穿参要改 4 个服务的签名与内部调用链（易漏、且新调用点又会漏）；
 * 这里用 ALS 在**收束流程入口**声明一次"当前会话"，aux 调用构建上下文时自动带上 sessionId。
 *
 * 语义边界：
 * - 只在 `runWithTeachingSession` 的同步/异步派生调用里可见；fire-and-forget 的任务若被推到
 *   完全脱离该作用域的队列（如定时器重排），读不到就是 null —— 与改造前行为一致（不编造）。
 * - 只影响**归属（sessionId）**，不传递任何权限/身份（身份仍走各自入参）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ sessionId: string }>();

/** 在该会话作用域内执行（同步返回，异步派生调用同样可见） */
export function runWithTeachingSession<T>(sessionId: string, fn: () => T): T {
  if (!sessionId) return fn();
  return storage.run({ sessionId }, fn);
}

/** 当前作用域内的教学会话 id；不在作用域内为 null（调用方应保持"不编造"的旧行为） */
export function currentTeachingSessionId(): string | null {
  return storage.getStore()?.sessionId ?? null;
}
