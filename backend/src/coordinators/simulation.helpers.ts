// 模拟协调器 - 模块级纯工具函数（自 simulation.coordinator.ts 抽离，行为保持不变；无 this / prisma）
import { asErrorLike } from '../virtual-lab/vlab-types';

/** 判断错误是否为 LLM Provider 可重试错误（过载/超时/JSON 解析失败） */
export function isProviderRetryable(errorMsg: string): boolean {
  const e = errorMsg.toLowerCase();
  // turn_budget_exhausted 是课时预算闸门的显式终止信号：若被当作可重试，
  // 自动循环会静默 restartLearningPhase 把 turns 归零，预算形同虚设
  // retry_budget_exhausted 同理：总 AI 调用预算耗尽后 restart 只会再次耗尽，空转恢复次数
  if (e.includes('turn_budget_exhausted') || e.includes('retry_budget_exhausted')) return false;
  return e.includes('provider') || e.includes('retry') || e.includes('timeout')
    || e.includes('overload') || e.includes('budget') || e.includes('503')
    || e.includes('does not contain valid json') || e.includes('response does not contain');
}

export function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && asErrorLike(error).code === code;
}

export function isLeaseDatabaseBusyError(error: unknown) {
  if (isPrismaErrorCode(error, 'P1008')) return true;
  const code = typeof error === 'object' && error !== null ? String(asErrorLike(error).code || '') : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return code === 'SQLITE_BUSY'
    || /SQLITE_BUSY|database (?:is|table is) locked|timed out|timeout/i.test(message);
}
