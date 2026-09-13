// 模拟协调器 - 模块级常量（自 simulation.coordinator.ts 抽离，行为保持不变）

export const COORDINATOR_ID = 'simulation-agent';
export const ASSISTED_SESSION_LEASE_MS = 10 * 60 * 1000;
export const ASSISTED_SESSION_LEASE_RENEW_MS = 2 * 60 * 1000;
export const LEASE_RETRY_DELAYS_MS = [25, 50, 100];
export const LEARN_UPSTREAM_RETRY_ATTEMPTS = 8;
export const LEARN_UPSTREAM_RETRY_DELAY_MS = 2000;
/** 一节课的课时预算：超过仍未双方收束则显式失败（可重启恢复），不允许无限拖堂 */
export const LEARN_TASK_TURN_BUDGET = 40;
/** 「自动完成本课」单次调用的回合上限（按课界停止，不按里程碑数估算） */
export const LEARN_AUTO_TURN_CAP = 40;
/** Provider 不稳定时的自动重试上限（每次 executeAutoLearning 循环内） */
export const LEARN_STEP_PROVIDER_RETRIES = 3;
/** 保护工作（可能悬挂的 LLM 调用）超过该时限仍未收尾时，强制放行会话队列 */
export const WORK_SETTLE_TIMEOUT_MS = 5 * 60 * 1000;
/** 疑似卡死 running 会话的判定阈值：无活跃租约且超过该时长未写入 */
export const STALE_RUNNING_SESSION_MS = 30 * 60 * 1000;
