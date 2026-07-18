import 'dotenv/config';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { dirname } from 'path';
import { resolveSqlitePath } from '../utils/runtime-paths';
import {
  auditSensitivePaths,
  repairSensitivePaths,
  SensitivePath
} from '../services/sensitive-storage-permissions.service';

const apply = process.argv.includes('--apply');
const backendRoot = resolve(__dirname, '..', '..');
const repoRoot = resolve(backendRoot, '..');
const mainDatabasePath = resolveSqlitePath(process.env.DATABASE_URL, resolve(backendRoot, 'prisma'));
const systemDatabasePath = resolveSqlitePath(process.env.SYSTEM_DATABASE_URL, resolve(backendRoot, 'prisma', 'system'));

const paths: SensitivePath[] = [
  { path: resolve(backendRoot, '.env'), kind: 'file' as const },
  { path: resolve(backendRoot, 'prisma'), kind: 'directory' as const },
  ...(mainDatabasePath ? [{ path: dirname(mainDatabasePath), kind: 'directory' as const }] : []),
  ...(systemDatabasePath ? [{ path: dirname(systemDatabasePath), kind: 'directory' as const }] : []),
  ...(mainDatabasePath ? [{ path: mainDatabasePath, kind: 'file' as const }] : []),
  ...(systemDatabasePath ? [{ path: systemDatabasePath, kind: 'file' as const }] : []),
  { path: resolve(backendRoot, 'logs'), kind: 'directory' as const },
  { path: resolve(backendRoot, 'logs', 'combined.log'), kind: 'file' as const },
  { path: resolve(backendRoot, 'logs', 'error.log'), kind: 'file' as const },
  { path: resolve(repoRoot, 'prompt-lab', 'backups'), kind: 'directory' as const }
].filter((target, index, items) => existsSync(target.path)
  && items.findIndex(item => item.path === target.path) === index);

async function main() {
  if (apply) {
    await repairSensitivePaths(paths, { apply: true });
  }
  const findings = await auditSensitivePaths(paths);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'audit',
    findings
  }));
  if (findings.some(finding => finding.status === 'too_open' || finding.status === 'error')) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
