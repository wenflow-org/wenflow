/**
 * outbox 唤醒通道（架构优化批 #5）。
 *
 * 背景：worker 原为固定 1s 轮询——事件稀疏时段每秒一次空查（SQLite 常驻 IO）。
 * 现改为「写入侧唤醒 + 自适应兜底轮询」：入队后立即唤醒 worker（典型入队→消费延迟
 * 从 0-1000ms 降到 ~100ms），空闲时轮询间隔指数退避到 30s，空转成本归零。
 *
 * 时序诚实声明：enqueueDomainEvent 在**事务内**被调用，唤醒信号可能先于事务提交发出。
 * 防抖窗口（WAKE_DEBOUNCE_MS=100ms）吸收绝大多数短事务的提交延迟；若唤醒 tick 仍跑到
 * 提交前（长事务），该事件由退避序列兜底拾取（首段间隔 1s，与旧固定轮询同量级）。
 * 唤醒 tick 与轮询 tick 走同一把互斥闸（worker.running），不会叠加执行。
 *
 * 单实例前提：唤醒是进程内回调（与限流/调度同假设），由启动期单实例断言守卫
 * （utils/instance-lock，架构优化批 #3）。
 */

type WakeListener = () => void;

let listener: WakeListener | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

export const WAKE_DEBOUNCE_MS = 100;

/** worker 启动时注册自身（重复注册后者胜；停止时传 null 注销） */
export function setOutboxWakeListener(fn: WakeListener | null): void {
  listener = fn;
}

/** 入队侧调用：合并 100ms 窗口内的多次入队为一次唤醒（批量入队只 tick 一轮） */
export function notifyOutboxActivity(): void {
  if (!listener) return;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    listener?.();
  }, WAKE_DEBOUNCE_MS);
  debounceTimer.unref?.();
}

/** 测试/关闭用：清掉挂起的防抖定时器 */
export function clearPendingWake(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
