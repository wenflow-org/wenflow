import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import sqlite3 from 'sqlite3';

export type DatabaseRole = 'main' | 'system';

export interface MigrationRecord {
  name: string;
  checksum: string;
}

const DATABASE_RULES: Record<DatabaseRole, {
  requiredTables: string[];
  forbiddenTables: string[];
  migrationDirectory: string[];
}> = {
  main: {
    requiredTables: ['users', 'learning_paths', 'path_generation_runs', 'domain_event_outbox', 'learner_projections'],
    forbiddenTables: ['agent_prompts', 'agent_contracts', 'prompt_eval_cases'],
    migrationDirectory: ['prisma', 'migrations']
  },
  system: {
    requiredTables: ['agent_prompts', 'agent_contracts', 'agent_field_routings', 'prompt_eval_cases'],
    forbiddenTables: ['users', 'learning_paths', 'domain_event_outbox'],
    migrationDirectory: ['prisma', 'system', 'migrations']
  }
};

export function openDatabase(filePath: string, mode = sqlite3.OPEN_READONLY): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, mode, error => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

export function closeDatabase(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

export function queryAll<T = any>(database: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

export function executeSql(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export async function readExpectedMigrations(backendRoot: string, role: DatabaseRole): Promise<MigrationRecord[]> {
  const directory = join(backendRoot, ...DATABASE_RULES[role].migrationDirectory);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const migrations: MigrationRecord[] = [];
  for (const name of entries) {
    const sql = await readFile(join(directory, name, 'migration.sql'));
    migrations.push({ name, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  if (migrations.length === 0) throw new Error(`${role} migration 目录为空`);
  return migrations;
}

export async function validateSqliteDatabase(
  filePath: string,
  role: DatabaseRole,
  backendRoot: string,
  expectedMigrationsOverride?: MigrationRecord[]
): Promise<{ migrations: MigrationRecord[]; journalMode: string }> {
  const database = await openDatabase(filePath);
  try {
    const integrity = await queryAll<any>(database, 'PRAGMA integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error(`${role} 数据库 integrity_check 失败`);
    }
    const foreignKeys = await queryAll(database, 'PRAGMA foreign_key_check');
    if (foreignKeys.length > 0) throw new Error(`${role} 数据库 foreign_key_check 失败`);

    const tables = new Set((await queryAll<any>(
      database,
      "SELECT name FROM sqlite_master WHERE type='table'"
    )).map(row => String(row.name)));
    for (const table of DATABASE_RULES[role].requiredTables) {
      if (!tables.has(table)) throw new Error(`${role} 数据库缺少关键表 ${table}`);
    }
    for (const table of DATABASE_RULES[role].forbiddenTables) {
      if (tables.has(table)) throw new Error(`${role} 数据库包含另一数据库的表 ${table}`);
    }
    if (!tables.has('_prisma_migrations')) throw new Error(`${role} 数据库缺少 migration 历史`);

    const expectedMigrations = expectedMigrationsOverride || await readExpectedMigrations(backendRoot, role);
    const applied = await queryAll<any>(database, `
      SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
      FROM _prisma_migrations
    `);
    if (applied.length !== expectedMigrations.length) {
      throw new Error(`${role} 数据库 migration 数量与当前代码不一致`);
    }
    const appliedByName = new Map(applied.map(row => [row.migration_name, row]));
    for (const expected of expectedMigrations) {
      const actual = appliedByName.get(expected.name);
      if (!actual || actual.checksum !== expected.checksum
        || !actual.finished_at || actual.rolled_back_at || Number(actual.applied_steps_count) <= 0) {
        throw new Error(`${role} 数据库 migration 历史或 checksum 不一致`);
      }
    }
    const journal = await queryAll<any>(database, 'PRAGMA journal_mode');
    return {
      migrations: expectedMigrations,
      journalMode: String(journal[0]?.journal_mode || 'unknown').toLowerCase()
    };
  } finally {
    await closeDatabase(database);
  }
}
