/**
 * 虚拟实验租约协议共享定义（#106 第一批，2026-10-18）
 *
 * 背景：`coordinators/simulation.constants.ts`（assisted 会话租约）与
 * `virtual-lab/blackbox-runner.ts`（黑盒命令租约）原本各自复制了一份
 * TTL / 续租间隔 / 重试退避 / DB_BUSY 判定。两者共用同一张
 * `virtual_experiment_leases` 表，参数分叉会让「改一处漏一处」变成静默的租约语义漂移。
 *
 * 本模块只做**单源化**：值保持现状（TTL 10min、续租 2min、退避 [25,50,100]ms），
 * 不改变任何协议行为。
 *
 * 第二批（2026-10-19，#106②）把剩余三套租约 TTL 一并收进来，同样是行为等价改动：
 * 路径生成 run（5min，心跳 = TTL/3）、教学操作（2min / 续租 30s）、finalization（3min / 续租 45s）。
 * 三处的原模块改为从本模块转出（re-export），不再各自写字面量。
 */

/** 会话/命令租约 TTL：过期即可被其他执行者抢占 */
export const VIRTUAL_SESSION_LEASE_TTL_MS = 10 * 60 * 1000;

/** 续租间隔：TTL 的 1/5，留足两次续租失败的重试窗口 */
export const VIRTUAL_SESSION_LEASE_RENEW_MS = 2 * 60 * 1000;

/** 续租/抢占遇 DB 忙时的有界重试退避（毫秒） */
export const LEASE_RETRY_DELAYS_MS: number[] = [25, 50, 100];

/** 路径生成 run 租约 TTL：leaseExpiresAt 过期即视为死 run，可被重新认领/失败处置 */
export const PATH_GENERATION_LEASE_MS = 5 * 60 * 1000;

/**
 * 教学操作租约（课堂回合）：短租期 + 心跳续租，最长孤儿窗口 = TTL。
 * 原为 30 分钟且无心跳——进程重启/请求挂起会把会话锁死很久（实测 BUSY 卡住 10+ 分钟）。
 */
export const TEACHING_OPERATION_LEASE_MS = 2 * 60 * 1000;

/** 教学操作续租间隔（TeachingOperationLeaseGuard 心跳周期） */
export const TEACHING_OPERATION_RENEW_MS = 30 * 1000;

/** finalization（收束）租约 TTL：收束流程的独占窗口 */
export const FINALIZATION_LEASE_MS = 3 * 60 * 1000;

/** finalization 续租间隔（FinalizationLeaseGuard 心跳周期） */
export const FINALIZATION_LEASE_RENEW_MS = 45 * 1000;

/** Prisma 错误码判定（P1008 = 操作超时） */
export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null
    && String((error as { code?: unknown }).code || '') === code;
}

/**
 * 租约写入是否属于「数据库忙」：Prisma P1008、SQLite BUSY/锁表、操作超时。
 * 调用方据此返回稳定的 503 DB_BUSY，而不是把锁竞争伪装成租约丢失。
 */
export function isLeaseDatabaseBusyError(error: unknown): boolean {
  if (isPrismaErrorCode(error, 'P1008')) return true;
  const code = typeof error === 'object' && error !== null
    ? String((error as { code?: unknown }).code || '')
    : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return code === 'SQLITE_BUSY'
    || /SQLITE_BUSY|database (?:is|table is) locked|timed out|timeout/i.test(message);
}
