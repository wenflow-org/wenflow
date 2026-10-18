/**
 * 虚拟实验租约协议共享定义（#106 第一批，2026-10-18）
 *
 * 背景：`coordinators/simulation.constants.ts`（assisted 会话租约）与
 * `virtual-lab/blackbox-runner.ts`（黑盒命令租约）原本各自复制了一份
 * TTL / 续租间隔 / 重试退避 / DB_BUSY 判定。两者共用同一张
 * `virtual_experiment_leases` 表，参数分叉会让「改一处漏一处」变成静默的租约语义漂移。
 *
 * 本模块只做**单源化**：值保持现状（TTL 10min、续租 2min、退避 [25,50,100]ms），
 * 不改变任何协议行为。路径生成 run / 教学操作 / finalization 三套租约的权威收敛
 * （TTL 5/2/3min）留待后续批次，避免与本次行为等价改动混在一起。
 */

/** 会话/命令租约 TTL：过期即可被其他执行者抢占 */
export const VIRTUAL_SESSION_LEASE_TTL_MS = 10 * 60 * 1000;

/** 续租间隔：TTL 的 1/5，留足两次续租失败的重试窗口 */
export const VIRTUAL_SESSION_LEASE_RENEW_MS = 2 * 60 * 1000;

/** 续租/抢占遇 DB 忙时的有界重试退避（毫秒） */
export const LEASE_RETRY_DELAYS_MS: number[] = [25, 50, 100];

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
