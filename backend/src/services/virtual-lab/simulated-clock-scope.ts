/**
 * 「在该学习者当前模拟时刻下执行」的作用域工具（2026-11-09 跨日核查）
 *
 * 为什么需要：虚拟学习者的模拟日可以落在真实今天之后，而画像/指标读链内部走
 * `simulatedNowOr()` + `calculatedAt <= asOf` 的**上界过滤**。管理端请求没有模拟钟上下文，
 * 于是模拟日写出来的指标被整段过滤掉——概念台账（按业务时间 lastSeenAt 取数，不受影响）
 * 显示的是推进后的状态，四读数/dynamicState 显示的是推进前的旧值，同一个学习者页面上两种时态。
 *
 * 行为零变化承诺：非虚拟用户、未启用日期模拟、解析失败 → 不建上下文，直接执行 `fn(true)`，
 * 与现状完全一致（`resolveUserSimulatedNow` 返回 null 的三条路径见其注释）。
 * 启用模拟钟时调用方应走 `fn(false)` 分支（每次重算）：快照缓存键不含模拟时刻，
 * 复用会把别的模拟日算出来的结果带出来。
 */
import { runWithSimulatedClock } from './simulation-clock-context';
import { resolveUserSimulatedNow } from './simulation-clock-resolver';
import { learnerProfileService } from '../learner/LearnerProfileService';

export async function withUserSimulatedClock<T>(
  userId: string,
  fn: (realtimeScope: boolean) => Promise<T>,
): Promise<T> {
  const asOf = await resolveUserSimulatedNow(userId).catch(() => null);
  if (!asOf) return fn(true);
  /* 模拟钟下必须先清画像缓存（2026-11-09 跨日核查实测）：
     LearnerSnapshotService 走 `learnerProfileService.getProfile`（内存 5 分钟 TTL），
     而缓存键只有 userId——同一次推进前后会被判为同一个 key，于是**推进后仍返回推进前
     用真实时钟算出的画像**（实测：模拟日写在未来时，管理端读到的是推进前的四读数，
     而概念台账已包含推进后的概念，同一页面两种时态）。
     正常链路上由事件消费者 clear；这里补的是「读/重算入口」不经过事件链的场景（管理端、
     推进后的立即读取）。仅对启用模拟钟的实例生效，真实用户行为零变化。 */
  learnerProfileService.clear(userId);
  return runWithSimulatedClock(asOf, () => fn(false));
}
