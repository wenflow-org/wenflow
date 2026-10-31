/**
 * 进程内按键串行化（in-process keyed lock）。
 *
 * 用途：保护「读整包 JSON → 内存改 → 整包写回」这类无 DB 级乐观锁的读改写
 * （如 virtual_learner_profiles.profile 的多字段更新）。同一 key 的临界区按提交顺序
 * 串行执行，消除"两个并发流各自读旧包、各自整包写回、后写覆盖前写"的丢更新窗口。
 *
 * 边界（诚实声明）：
 * - 只在**单进程**内有效（本应用按单实例部署）；跨进程互斥由各业务的租约/版本机制负责；
 * - 前驱任务失败不会卡死队列：后续任务照常执行（失败由各任务自己的调用方处理）。
 */

const chains = new Map<string, Promise<unknown>>();

export function withKeyedLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // 前驱无论成败都继续（前驱的失败由它自己的调用方处理）
  const result = previous.then(task, task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}
