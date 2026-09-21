import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sqlite3 from 'sqlite3';
import { closeDatabase, executeSql, openDatabase } from '../sqlite-database';
import { DatabaseSpaceReport, vacuumDatabase, vacuumDatabases } from '../database-vacuum';

function runSql(database: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, params, error => error ? reject(error) : resolve());
  });
}

/** 造一个带碎片的库：批量写入后全量删除，页留在 freelist 而不归还 OS */
async function createBloatyDatabase(filePath: string): Promise<void> {
  const database = await openDatabase(filePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  try {
    await executeSql(database, 'CREATE TABLE bloat (id INTEGER PRIMARY KEY, payload TEXT);');
    const padding = 'x'.repeat(200);
    for (let batch = 0; batch < 20; batch += 1) {
      const values: string[] = [];
      for (let index = 0; index < 200; index += 1) {
        values.push(`(${batch * 200 + index}, '${padding}')`);
      }
      await executeSql(database, `INSERT INTO bloat (id, payload) VALUES ${values.join(',')};`);
    }
    await executeSql(database, 'DELETE FROM bloat;');
  } finally {
    await closeDatabase(database);
  }
}

describe('database-vacuum', () => {
  let tempRoot: string;
  let mainPath: string;
  let systemPath: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'wenflow-vacuum-'));
    mainPath = join(tempRoot, 'dev.db');
    systemPath = join(tempRoot, 'system.db');
    await createBloatyDatabase(mainPath);
    await createBloatyDatabase(systemPath);
    envBackup.DATABASE_URL = process.env.DATABASE_URL;
    envBackup.SYSTEM_DATABASE_URL = process.env.SYSTEM_DATABASE_URL;
    process.env.DATABASE_URL = `file:${mainPath}`;
    process.env.SYSTEM_DATABASE_URL = `file:${systemPath}`;
  });

  afterAll(async () => {
    process.env.DATABASE_URL = envBackup.DATABASE_URL;
    process.env.SYSTEM_DATABASE_URL = envBackup.SYSTEM_DATABASE_URL;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('spaceReport 识别碎片（freelist > 0）', async () => {
    const { databaseSpaceStatus } = await import('../database-vacuum');
    const reports: DatabaseSpaceReport[] = await databaseSpaceStatus({
      backendRoot: join(__dirname, '..', '..'),
      databaseUrl: process.env.DATABASE_URL,
      systemDatabaseUrl: process.env.SYSTEM_DATABASE_URL
    });
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.freelistPages).toBeGreaterThan(0);
      expect(report.freelistRatio).toBeGreaterThan(0);
      expect(report.freelistRatio).toBeLessThanOrEqual(1);
    }
  });

  it('vacuumDatabase 回收 freelist 并通过 quick_check', async () => {
    const result = await vacuumDatabase('main', mainPath);
    expect(result.before.freelistPages).toBeGreaterThan(0);
    expect(result.after.freelistPages).toBe(0);
    expect(result.after.bytes).toBeLessThan(result.before.bytes);
    expect(result.reclaimedBytes).toBeGreaterThan(0);
  });

  it('vacuumDatabases 未确认停写窗口时拒绝执行', async () => {
    await expect(vacuumDatabases({
      backendRoot: join(__dirname, '..', '..'),
      databaseUrl: process.env.DATABASE_URL,
      systemDatabaseUrl: process.env.SYSTEM_DATABASE_URL,
      confirmQuiesced: false
    })).rejects.toThrow('--confirm-quiesced');
  });

  it('vacuumDatabases 按 scope 双库执行并归零碎片', async () => {
    const results = await vacuumDatabases({
      backendRoot: join(__dirname, '..', '..'),
      databaseUrl: process.env.DATABASE_URL,
      systemDatabaseUrl: process.env.SYSTEM_DATABASE_URL,
      confirmQuiesced: true,
      scope: 'both'
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.after.freelistPages).toBe(0);
    }
  });
});
