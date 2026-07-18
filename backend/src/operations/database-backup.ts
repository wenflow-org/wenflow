import { createHash, randomUUID } from 'crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import sqlite3 from 'sqlite3';
import { auditSensitivePaths } from '../services/sensitive-storage-permissions.service';
import { getSecretKeyringFingerprint, SecretKeyringFingerprint } from '../utils/secret-crypto';
import { validateSecretEncryptionConfig } from '../utils/secret-crypto';
import { resolveSqlitePath, validateRuntimeDatabaseUrls } from '../utils/runtime-paths';
import {
  closeDatabase,
  DatabaseRole,
  openDatabase,
  sha256File,
  validateSqliteDatabase
} from './sqlite-database';

interface BackupLike {
  step(pages: number, callback: (error: any, done: boolean) => void): void;
  finish(callback: () => void): void;
}

export interface BackupDatabaseManifest {
  role: DatabaseRole;
  file: string;
  sha256: string;
  bytes: number;
  sourceJournalMode: string;
  backupStartedAt: string;
  backupCompletedAt: string;
  migrations: Array<{ name: string; checksum: string }>;
}

export interface DatabaseBackupManifest {
  schemaVersion: 'wenflow-sqlite-backup/v1';
  backupId: string;
  createdAt: string;
  completedAt: string;
  method: 'sqlite-online-backup';
  pairAtomic: false;
  quiescence: 'operator-confirmed';
  databases: BackupDatabaseManifest[];
  keyring: SecretKeyringFingerprint;
}

export interface CreateBackupOptions {
  backendRoot: string;
  projectRoot?: string;
  databaseUrl: string | undefined;
  systemDatabaseUrl: string | undefined;
  outputRoot?: string;
  confirmQuiesced: boolean;
  skipPermissionAudit?: boolean;
}

function sleep(milliseconds: number) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function sameOrInside(root: string, candidate: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const relativePath = relative(normalize(root), normalize(candidate));
  return relativePath === ''
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

function defaultBackupRoot(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'WenFlow', 'backups');
  }
  if (process.env.NODE_ENV === 'production') return '/var/backups/wenflow';
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'wenflow', 'backups');
}

async function ensureSafeOutputRoot(outputRoot: string, projectRoot: string | undefined, sourcePaths: string[]) {
  if (!isAbsolute(outputRoot)) throw new Error('备份目录必须是绝对路径');
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const outputStat = await lstat(outputRoot);
  if (outputStat.isSymbolicLink()) throw new Error('备份目录不能是符号链接或 Junction');
  const canonicalOutput = await realpath(outputRoot);
  if (projectRoot) {
    const canonicalProject = await realpath(projectRoot);
    if (sameOrInside(canonicalProject, canonicalOutput)) throw new Error('备份目录必须位于 Git 工作区之外');
  }
  for (const sourcePath of sourcePaths) {
    if (sameOrInside(dirname(sourcePath), canonicalOutput)) {
      throw new Error('备份目录不能位于源数据库目录内');
    }
  }
  return canonicalOutput;
}

export async function backupSqliteOnline(
  sourcePath: string,
  destinationPath: string,
  options: { deadlineMs?: number; pagesPerStep?: number } = {}
): Promise<void> {
  const database = await openDatabase(sourcePath, sqlite3.OPEN_READONLY);
  const deadline = Date.now() + (options.deadlineMs || 60_000);
  const pagesPerStep = options.pagesPerStep || 256;
  let backup: BackupLike | undefined;
  let backupFinished = false;
  try {
    backup = await new Promise<BackupLike>((resolveBackup, reject) => {
      let instance: BackupLike;
      instance = (database as any).backup(destinationPath, (error: Error | null) => {
        if (error) reject(error);
        else resolveBackup(instance);
      });
    });
    let completed = false;
    while (!completed) {
      if (Date.now() >= deadline) throw new Error('SQLite 在线备份超时');
      try {
        completed = await new Promise<boolean>((resolveStep, reject) => {
          backup!.step(pagesPerStep, (error: any, done: boolean) => {
            if (error) reject(error);
            else resolveStep(done);
          });
        });
      } catch (error: any) {
        if (error?.errno !== sqlite3.BUSY && error?.errno !== sqlite3.LOCKED) throw error;
        await sleep(50);
      }
    }
    await new Promise<void>(resolveFinish => backup!.finish(resolveFinish));
    backupFinished = true;
  } finally {
    if (backup && !backupFinished) {
      await new Promise<void>(resolveFinish => backup!.finish(resolveFinish));
    }
    await closeDatabase(database);
  }
}

async function syncFile(filePath: string) {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function backupOne(
  role: DatabaseRole,
  sourcePath: string,
  destinationPath: string,
  backendRoot: string
): Promise<BackupDatabaseManifest> {
  const source = await validateSqliteDatabase(sourcePath, role, backendRoot);
  const backupStartedAt = new Date().toISOString();
  await backupSqliteOnline(sourcePath, destinationPath);
  await syncFile(destinationPath);
  const backupCompletedAt = new Date().toISOString();
  await validateSqliteDatabase(destinationPath, role, backendRoot);
  const metadata = await stat(destinationPath);
  return {
    role,
    file: basename(destinationPath),
    sha256: await sha256File(destinationPath),
    bytes: metadata.size,
    sourceJournalMode: source.journalMode,
    backupStartedAt,
    backupCompletedAt,
    migrations: source.migrations
  };
}

export async function createDatabaseBackup(options: CreateBackupOptions): Promise<{
  backupDirectory: string;
  manifest: DatabaseBackupManifest;
}> {
  if (!options.confirmQuiesced) {
    throw new Error('双库备份要求停写窗口；请确认后使用 --confirm-quiesced');
  }
  validateSecretEncryptionConfig(true);
  validateRuntimeDatabaseUrls(options.databaseUrl, options.systemDatabaseUrl);
  const mainPath = resolveSqlitePath(options.databaseUrl, join(options.backendRoot, 'prisma'));
  const systemPath = resolveSqlitePath(options.systemDatabaseUrl, join(options.backendRoot, 'prisma', 'system'));
  if (!mainPath || !systemPath) throw new Error('正式备份仅支持两个 SQLite file: 数据库');
  for (const sourcePath of [mainPath, systemPath]) {
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink()) throw new Error('源数据库不能是符号链接或 Junction');
  }
  const [canonicalMain, canonicalSystem] = await Promise.all([realpath(mainPath), realpath(systemPath)]);
  if (canonicalMain === canonicalSystem) throw new Error('主库和 System DB 不能指向同一个文件');
  for (const sourcePath of [canonicalMain, canonicalSystem]) {
    const sourceStat = await lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('源数据库必须是普通文件');
  }

  const outputRoot = await ensureSafeOutputRoot(
    resolve(options.outputRoot || process.env.WENFLOW_BACKUP_DIR || defaultBackupRoot()),
    options.projectRoot,
    [canonicalMain, canonicalSystem]
  );
  if (!options.skipPermissionAudit) {
    const findings = await auditSensitivePaths([{ path: outputRoot, kind: 'directory' }]);
    if (findings.some(finding => finding.status !== 'ok')) {
      throw new Error('备份根目录权限不安全，请先收紧 ACL/mode');
    }
  }

  const createdAt = new Date().toISOString();
  const backupId = `${createdAt.replace(/[-:.]/g, '')}-${randomUUID()}`;
  const staging = join(outputRoot, `.partial-${backupId}`);
  const published = join(outputRoot, backupId);
  await mkdir(staging, { mode: 0o700 });
  try {
    const main = await backupOne('main', canonicalMain, join(staging, 'main.db'), options.backendRoot);
    const system = await backupOne('system', canonicalSystem, join(staging, 'system.db'), options.backendRoot);
    const manifest: DatabaseBackupManifest = {
      schemaVersion: 'wenflow-sqlite-backup/v1',
      backupId,
      createdAt,
      completedAt: new Date().toISOString(),
      method: 'sqlite-online-backup',
      pairAtomic: false,
      quiescence: 'operator-confirmed',
      databases: [main, system],
      keyring: getSecretKeyringFingerprint()
    };
    const manifestPath = join(staging, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await syncFile(manifestPath);
    await rename(staging, published);
    return { backupDirectory: published, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function assertSafeManifest(manifest: any): asserts manifest is DatabaseBackupManifest {
  if (!manifest || manifest.schemaVersion !== 'wenflow-sqlite-backup/v1'
    || manifest.method !== 'sqlite-online-backup' || manifest.pairAtomic !== false
    || !Array.isArray(manifest.databases) || manifest.databases.length !== 2) {
    throw new Error('备份 manifest 格式无效');
  }
  const roles = new Set(manifest.databases.map((database: any) => database.role));
  if (!roles.has('main') || !roles.has('system')) throw new Error('备份 manifest 缺少双库');
  for (const database of manifest.databases) {
    if (!['main.db', 'system.db'].includes(database.file)
      || !/^[a-f0-9]{64}$/.test(database.sha256)
      || !Number.isSafeInteger(database.bytes) || database.bytes <= 0
      || !Array.isArray(database.migrations) || database.migrations.length === 0
      || database.migrations.some((migration: any) =>
        !migration || typeof migration.name !== 'string' || !/^\d{14}_[A-Za-z0-9_-]+$/.test(migration.name)
        || typeof migration.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(migration.checksum))) {
      throw new Error('备份 manifest 数据库条目无效');
    }
  }
  if (!manifest.keyring || manifest.keyring.exported !== false
    || typeof manifest.keyring.currentKeyId !== 'string' || !manifest.keyring.currentKeyId
    || !Array.isArray(manifest.keyring.keys) || manifest.keyring.keys.length === 0
    || manifest.keyring.keys.some((key: any) =>
      !key || typeof key.keyId !== 'string'
      || typeof key.fingerprint !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(key.fingerprint))
    || !manifest.keyring.keys.some((key: any) => key.keyId === manifest.keyring.currentKeyId)) {
    throw new Error('备份 manifest Keyring 指纹无效');
  }
}

function assertKeyringMatches(expected: SecretKeyringFingerprint) {
  const current = getSecretKeyringFingerprint();
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error('当前 Keyring 与备份 manifest 指纹不匹配');
  }
}

export async function verifyDatabaseBackup(
  backupDirectory: string,
  backendRoot: string
): Promise<DatabaseBackupManifest> {
  const canonicalDirectory = await realpath(resolve(backupDirectory));
  const directoryStat = await lstat(canonicalDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('备份路径必须是普通目录');
  const manifestPath = join(canonicalDirectory, 'manifest.json');
  const manifestStat = await stat(manifestPath);
  if (manifestStat.size > 1024 * 1024) throw new Error('备份 manifest 过大');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assertSafeManifest(manifest);
  assertKeyringMatches(manifest.keyring);

  const tempDirectory = await mkdtemp(join(tmpdir(), 'wenflow-backup-verify-'));
  try {
    for (const database of manifest.databases) {
      const source = join(canonicalDirectory, database.file);
      const sourceStat = await lstat(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('备份数据库必须是普通文件');
      if (sourceStat.size !== database.bytes || await sha256File(source) !== database.sha256) {
        throw new Error(`${database.role} 备份校验和不匹配`);
      }
      const isolated = join(tempDirectory, database.file);
      await copyFile(source, isolated);
      const validation = await validateSqliteDatabase(
        isolated,
        database.role,
        backendRoot,
        database.migrations
      );
      if (JSON.stringify(validation.migrations) !== JSON.stringify(database.migrations)) {
        throw new Error(`${database.role} 备份 migration manifest 不一致`);
      }
    }
    return manifest;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
