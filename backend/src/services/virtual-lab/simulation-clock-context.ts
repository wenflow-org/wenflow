/**
 * 模拟时钟上下文（虚拟学习者 · 日期模拟）
 *
 * 目的：让"推进到第 N 天"时真实跑一遍学习链，而**写入的业务时间戳落在模拟日**。
 * 机制：AsyncLocalStorage 携带 `asOf`；写入点用 `simulatedNowOr()` 取值——
 * **没有上下文时等价于 `new Date()`**（现网行为零变化）。
 *
 * 只在 `POST /sessions/:id/advance-day` 的 `runTasks` 分支内启用（`runWithSimulatedClock`）。
 * 设计：doc/local/VIRTUAL_LEARNER_SIMULATED_DAY_DRAFT.md §四（asOf 注入）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface SimulatedClockStore {
  asOf: Date;
}

const storage = new AsyncLocalStorage<SimulatedClockStore>();

/** 在"模拟当前时刻"下执行（仅本调用链可见；不影响真实用户）。 */
export function runWithSimulatedClock<T>(asOf: Date, fn: () => T): T {
  return storage.run({ asOf }, fn);
}

/** 取当前模拟时刻；不在模拟上下文内返回 null。 */
export function getSimulatedAsOf(): Date | null {
  return storage.getStore()?.asOf ?? null;
}

/** 写入/读取统一入口：优先模拟时刻，否则真墙钟（默认行为不变）。
 *  返回**拷贝**：调用方原地修改（setHours/setDate 等）不会污染共享的模拟时刻。 */
export function simulatedNowOr(fallback: Date = new Date()): Date {
  const asOf = storage.getStore()?.asOf;
  return asOf ? new Date(asOf.getTime()) : fallback;
}

export function isSimulatedClockActive(): boolean {
  return storage.getStore() !== undefined;
}
