import { isAbsolute, resolve } from 'path';

export function resolveSqlitePath(url: string | undefined, schemaDirectory: string): string | null {
  const value = (url || '').trim();
  if (!value.startsWith('file:')) return null;
  let filePath = value.slice(5).split(/[?#]/, 1)[0];
  if (!filePath || filePath === ':memory:') return null;
  filePath = decodeURIComponent(filePath);
  if (/^[A-Za-z]:[\\/]/.test(filePath) || isAbsolute(filePath)) return resolve(filePath);
  return resolve(schemaDirectory, filePath);
}

export function validateRuntimeDatabaseUrls(
  databaseUrl: string | undefined,
  systemDatabaseUrl: string | undefined
): void {
  const main = (databaseUrl || '').trim().replace(/\\/g, '/');
  const system = (systemDatabaseUrl || '').trim().replace(/\\/g, '/');
  if (/^file:\.\/prisma\//i.test(main)) {
    throw new Error('DATABASE_URL 使用了旧嵌套路径；当前本地路径应为 file:./dev.db');
  }
  if (/^file:\.\/(?:prisma\/)?system\.db(?:[?#].*)?$/i.test(system)) {
    throw new Error('SYSTEM_DATABASE_URL 使用了旧歧义路径；当前本地路径应为 file:../system.db');
  }
}
