import { execFile } from 'child_process';
import { lstat, chmod } from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SensitivePath {
  path: string;
  kind: 'file' | 'directory';
}

export interface PermissionFinding {
  path: string;
  status: 'ok' | 'missing' | 'too_open' | 'error';
  details?: string;
}

export function isWindowsAclTooOpen(output: string): boolean {
  return /Authenticated Users|BUILTIN\\Users|Everyone|\*S-1-5-11|\*S-1-5-32-545/i.test(output);
}

export function isPosixModeTooOpen(mode: number, kind: SensitivePath['kind']): boolean {
  const expected = kind === 'directory' ? 0o700 : 0o600;
  return (mode & ~expected) !== 0;
}

export async function auditSensitivePaths(
  paths: SensitivePath[],
  platform = process.platform
): Promise<PermissionFinding[]> {
  const findings: PermissionFinding[] = [];
  for (const target of paths) {
    try {
      const stat = await lstat(target.path);
      if (stat.isSymbolicLink()) {
        findings.push({ path: target.path, status: 'error', details: 'symbolic link is not allowed' });
        continue;
      }
      if (platform === 'win32') {
        const { stdout } = await execFileAsync('icacls.exe', [target.path], { windowsHide: true });
        const tooOpen = isWindowsAclTooOpen(stdout);
        findings.push({ path: target.path, status: tooOpen ? 'too_open' : 'ok' });
      } else {
        const mode = stat.mode & 0o777;
        const expected = target.kind === 'directory' ? 0o700 : 0o600;
        findings.push({
          path: target.path,
          status: isPosixModeTooOpen(mode, target.kind) ? 'too_open' : 'ok',
          details: `mode=${mode.toString(8).padStart(3, '0')}`
        });
      }
    } catch (error: any) {
      findings.push({
        path: target.path,
        status: error?.code === 'ENOENT' ? 'missing' : 'error',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return findings;
}

export async function repairSensitivePaths(
  paths: SensitivePath[],
  options: { apply: boolean; platform?: NodeJS.Platform; windowsAccount?: string }
): Promise<void> {
  if (!options.apply) throw new Error('权限修复必须显式使用 --apply');
  const platform = options.platform || process.platform;
  for (const target of paths) {
    const stat = await lstat(target.path);
    if (stat.isSymbolicLink()) throw new Error(`拒绝修改符号链接: ${target.path}`);
    if (platform === 'win32') {
      const account = options.windowsAccount || process.env.WENFLOW_SERVICE_ACCOUNT || process.env.USERNAME;
      if (!account) throw new Error('无法确定 Windows 服务账户');
      const modify = target.kind === 'directory' ? '(OI)(CI)M' : 'M';
      const full = target.kind === 'directory' ? '(OI)(CI)F' : 'F';
      await execFileAsync('icacls.exe', [
        target.path,
        '/grant:r',
        `${account}:${modify}`,
        `*S-1-5-18:${full}`,
        `*S-1-5-32-544:${full}`,
        ...(target.kind === 'directory' ? ['/T'] : [])
      ], { windowsHide: true });
      await execFileAsync('icacls.exe', [
        target.path,
        '/inheritance:r',
        ...(target.kind === 'directory' ? ['/T'] : [])
      ], { windowsHide: true });
      await execFileAsync('icacls.exe', [
        target.path,
        '/remove:g',
        '*S-1-5-11',
        '*S-1-5-32-545',
        ...(target.kind === 'directory' ? ['/T'] : [])
      ], { windowsHide: true });
    } else {
      await chmod(target.path, target.kind === 'directory' ? 0o700 : 0o600);
    }
  }
}
