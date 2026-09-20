/**
 * 运行期安全策略装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：敏感存储路径权限审计（.env / 日志 / SQLite 数据库等）与运行时网络策略加载。
 * 注意：本文件位于 src/bootstrap/，backendRoot 需上溯两级。
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';
import { auditSensitivePaths, SensitivePath } from '../services/sensitive-storage-permissions.service';
import { resolveSqlitePath } from '../utils/runtime-paths';
import { refreshRuntimeNetworkPolicy } from '../services/runtime-network-policy.service';
import type { AssertActive } from './seeds';

export async function auditSensitiveStoragePermissions(assertActive: AssertActive): Promise<void> {
  const backendRoot = resolve(__dirname, '..', '..');
  const repoRoot = resolve(backendRoot, '..');
  const mainDatabasePath = resolveSqlitePath(process.env.DATABASE_URL, resolve(backendRoot, 'prisma'));
  const systemDatabasePath = resolveSqlitePath(process.env.SYSTEM_DATABASE_URL, resolve(backendRoot, 'prisma', 'system'));
  const sensitivePaths: SensitivePath[] = [
    { path: resolve(backendRoot, '.env'), kind: 'file' as const },
    { path: resolve(backendRoot, 'logs'), kind: 'directory' as const },
    { path: resolve(backendRoot, 'logs', 'combined.log'), kind: 'file' as const },
    { path: resolve(backendRoot, 'logs', 'error.log'), kind: 'file' as const },
    { path: resolve(repoRoot, 'prompts', 'backups'), kind: 'directory' as const },
    ...(mainDatabasePath ? [{ path: resolve(mainDatabasePath, '..'), kind: 'directory' as const }] : []),
    ...(systemDatabasePath ? [{ path: resolve(systemDatabasePath, '..'), kind: 'directory' as const }] : []),
    ...(mainDatabasePath ? [{ path: mainDatabasePath, kind: 'file' as const }] : []),
    ...(systemDatabasePath ? [{ path: systemDatabasePath, kind: 'file' as const }] : [])
  ].filter((target, index, items) => existsSync(target.path)
    && items.findIndex(item => item.path === target.path) === index);
  const permissionAuditDisabled =
    process.env.SKIP_PERMISSIONS_AUDIT === '1'
    || (process.env.SKIP_PERMISSIONS_AUDIT !== '0' && process.env.NODE_ENV !== 'production');
  if (permissionAuditDisabled) {
    logger.debug('敏感存储权限审计已跳过（dev 默认跳过；设置 SKIP_PERMISSIONS_AUDIT=0 强制启用，=1 强制禁用）');
  } else {
    const permissionFindings = await auditSensitivePaths(sensitivePaths);
    assertActive();
    const unsafePermissions = permissionFindings.filter(finding => finding.status === 'too_open' || finding.status === 'error');
    if (unsafePermissions.length > 0) {
      logger.warn('敏感存储权限审计发现风险，请运行 npm run permissions:audit / permissions:repair', {
        findings: unsafePermissions
      });
    }
  }
}

export async function refreshNetworkPolicyBootstrap(): Promise<void> {
  const networkPolicy = await refreshRuntimeNetworkPolicy();
  logger.info('运行时网络策略加载完成', {
    adminAccessMode: networkPolicy.adminAccessMode,
    allowPrivateNetwork: networkPolicy.allowPrivateNetwork,
    source: networkPolicy.source
  });
}
