import { lstat, realpath, stat } from 'fs/promises';
import { join } from 'path';
import sqlite3 from 'sqlite3';
import { resolveSqlitePath, validateRuntimeDatabaseUrls } from '../utils/runtime-paths';
import { closeDatabase, DatabaseRole, executeSql, openDatabase, queryAll } from './sqlite-database';

export interface DatabaseSpaceReport {
  role: DatabaseRole;
  file: string;
  bytes: number;
  pageCount: number;
  pageSize: number;
  freelistPages: number;
  freelistBytes: number;
  /** 空闲页占整库比例（0-1），>0.1 即建议安排 VACUUM */
  freelistRatio: number;
  journalMode: string;
}

export interface VacuumResult {
  role: DatabaseRole;
  before: DatabaseSpaceReport;
  after: DatabaseSpaceReport;
  reclaimedBytes: number;
}

export type VacuumScope = DatabaseRole | 'both';

async function spaceReport(role: DatabaseRole, filePath: string): Promise<DatabaseSpaceReport> {
  const database = await openDatabase(filePath);
  try {
    const [pageRow] = await queryAll<{ page_count: number }>(database, 'PRAGMA page_count');
    const [sizeRow] = await queryAll<{ page_size: number }>(database, 'PRAGMA page_size');
    const [freelistRow] = await queryAll<{ freelist_count: number }>(database, 'PRAGMA freelist_count');
    const [journalRow] = await queryAll<{ journal_mode: string }>(database, 'PRAGMA journal_mode');
    const pageCount = Number(pageRow?.page_count || 0);
    const pageSize = Number(sizeRow?.page_size || 0);
    const freelistPages = Number(freelistRow?.freelist_count || 0);
    const fileStat = await stat(filePath);
    return {
      role,
      file: filePath,
      bytes: fileStat.size,
      pageCount,
      pageSize,
      freelistPages,
      freelistBytes: freelistPages * pageSize,
      freelistRatio: pageCount > 0 ? freelistPages / pageCount : 0,
      journalMode: String(journalRow?.journal_mode || 'unknown').toLowerCase()
    };
  } finally {
    await closeDatabase(database);
  }
}

async function assertPlainFile(filePath: string): Promise<void> {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`数据库必须是普通文件（符号链接/Junction 不允许）: ${filePath}`);
  }
}

/**
 * 对单个库执行 VACUUM 并回收 freelist 碎片页。
 *
 * VACUUM 会整库重写（1.7GB 级别需数秒到数十秒且要求写锁），务必在后端停止的
 * 停写窗口执行；执行前后各做一次 quick_check，并以 TRUNCATE 模式 checkpoint
 * 收缩 -wal 文件。遥测表删除后的空闲页不会自动归还 OS，只有 VACUUM 能缩小文件。
 */
export async function vacuumDatabase(role: DatabaseRole, filePath: string): Promise<VacuumResult> {
  const before = await spaceReport(role, filePath);
  const database = await openDatabase(filePath, sqlite3.OPEN_READWRITE);
  try {
    await executeSql(database, 'VACUUM;');
    // WAL 下 VACUUM 产生的新内容先落 -wal，TRUNCATE checkpoint 把 -wal 收缩回 0
    await executeSql(database, 'PRAGMA wal_checkpoint(TRUNCATE);');
    const check = await queryAll<{ quick_check: string }>(database, 'PRAGMA quick_check');
    if (check.length !== 1 || check[0].quick_check !== 'ok') {
      throw new Error(`${role} 数据库 VACUUM 后 quick_check 未通过`);
    }
  } finally {
    await closeDatabase(database);
  }
  const after = await spaceReport(role, filePath);
  return { role, before, after, reclaimedBytes: Math.max(0, before.bytes - after.bytes) };
}

export interface VacuumOptions {
  backendRoot: string;
  databaseUrl: string | undefined;
  systemDatabaseUrl: string | undefined;
  confirmQuiesced: boolean;
  scope?: VacuumScope;
}

async function resolveDatabasePaths(options: VacuumOptions): Promise<Array<{ role: DatabaseRole; path: string }>> {
  validateRuntimeDatabaseUrls(options.databaseUrl, options.systemDatabaseUrl);
  const candidates: Array<{ role: DatabaseRole; url: string | undefined; schemaDirectory: string }> = [
    { role: 'main', url: options.databaseUrl, schemaDirectory: join(options.backendRoot, 'prisma') },
    { role: 'system', url: options.systemDatabaseUrl, schemaDirectory: join(options.backendRoot, 'prisma', 'system') }
  ];
  const scope = options.scope || 'both';
  const resolved: Array<{ role: DatabaseRole; path: string }> = [];
  for (const candidate of candidates) {
    if (scope !== 'both' && scope !== candidate.role) continue;
    const path = resolveSqlitePath(candidate.url, candidate.schemaDirectory);
    if (!path) throw new Error(`${candidate.role} 库未配置为 SQLite file: 路径`);
    await assertPlainFile(path);
    resolved.push({ role: candidate.role, path: await realpath(path) });
  }
  if (resolved.length === 0) throw new Error('vacuum 范围为空');
  if (resolved.length === 2 && resolved[0].path === resolved[1].path) {
    throw new Error('主库和 System DB 不能指向同一个文件');
  }
  return resolved;
}

export async function databaseSpaceStatus(options: Omit<VacuumOptions, 'confirmQuiesced'>): Promise<DatabaseSpaceReport[]> {
  const paths = await resolveDatabasePaths({ ...options, confirmQuiesced: true });
  const reports: DatabaseSpaceReport[] = [];
  for (const { role, path } of paths) {
    reports.push(await spaceReport(role, path));
  }
  return reports;
}

export async function vacuumDatabases(options: VacuumOptions): Promise<VacuumResult[]> {
  if (!options.confirmQuiesced) {
    throw new Error('VACUUM 要求写锁并整库重写，请确认后端已停止后使用 --confirm-quiesced');
  }
  const paths = await resolveDatabasePaths(options);
  const results: VacuumResult[] = [];
  for (const { role, path } of paths) {
    results.push(await vacuumDatabase(role, path));
  }
  return results;
}
