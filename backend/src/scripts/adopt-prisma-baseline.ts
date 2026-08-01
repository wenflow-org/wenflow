import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import sqlite3 from 'sqlite3';
import 'dotenv/config';
import { DatabaseRole, MigrationRecord, readExpectedMigrations } from '../operations/sqlite-database';

const apply = process.argv.includes('--apply');
const workspace = resolve(__dirname, '..', '..');
const prismaCli = join(workspace, 'node_modules', 'prisma', 'build', 'index.js');

interface DatabaseTarget {
  name: DatabaseRole;
  schema: string;
  urlEnv: 'DATABASE_URL' | 'SYSTEM_DATABASE_URL';
}

const targets: DatabaseTarget[] = [
  {
    name: 'main',
    schema: 'prisma/schema.prisma',
    urlEnv: 'DATABASE_URL'
  },
  {
    name: 'system',
    schema: 'prisma/system/schema.prisma',
    urlEnv: 'SYSTEM_DATABASE_URL'
  }
];

export interface AppliedMigrationRecord {
  migration_name: string;
  checksum: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

export function validateMigrationHistory(
  databaseName: DatabaseRole,
  history: AppliedMigrationRecord[],
  expectedMigrations: MigrationRecord[]
) {
  const seen = new Set<string>();
  for (const row of history) {
    if (!row.finished_at || row.rolled_back_at) {
      throw new Error(`${databaseName} 数据库存在失败或回滚 migration，拒绝 baseline`);
    }
    if (seen.has(row.migration_name)) {
      throw new Error(`${databaseName} 数据库存在重复 migration 记录，拒绝 baseline`);
    }
    seen.add(row.migration_name);
  }

  const expectedPrefix = expectedMigrations.slice(0, history.length);
  if (history.length > expectedMigrations.length
    || history.some((row, index) => row.migration_name !== expectedPrefix[index]?.name)) {
    throw new Error(`${databaseName} 数据库存在旧或分叉 migration 历史，拒绝自动 baseline`);
  }

  for (let index = 0; index < history.length; index += 1) {
    if (history[index].checksum !== expectedPrefix[index].checksum) {
      throw new Error(`${databaseName} 数据库 migration checksum 与当前仓库不一致，拒绝 baseline`);
    }
  }

  return {
    appliedMigrations: history.map(row => row.migration_name),
    missingMigrations: expectedMigrations.slice(history.length).map(migration => migration.name)
  };
}

function runPrisma(args: string[], env: NodeJS.ProcessEnv) {
  try {
    return execFileSync(process.execPath, [prismaCli, ...args], {
      cwd: workspace,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error: any) {
    const details = String(error?.stderr || error?.stdout || error?.message || error).trim();
    throw new Error(`prisma ${args.join(' ')} failed: ${details}`);
  }
}

function sqlitePath(url: string, schemaPath: string): string {
  if (!url.startsWith('file:')) throw new Error('baseline 工具当前只支持 SQLite file: URL');
  const value = url.slice(5);
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) return value;
  return resolve(workspace, schemaPath, '..', value);
}

function queryAll(dbPath: string, sql: string): Promise<any[]> {
  return new Promise((resolveQuery, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, openError => {
      if (openError) return reject(openError);
      db.all(sql, (queryError, rows) => {
        db.close();
        if (queryError) reject(queryError);
        else resolveQuery(rows);
      });
    });
  });
}

async function inspect(target: DatabaseTarget) {
  const url = (process.env[target.urlEnv] || '').trim();
  if (!url) throw new Error(`${target.urlEnv} 未配置`);
  const dbPath = sqlitePath(url, target.schema);
  const env = { ...process.env, [target.urlEnv]: url };

  const integrity = await queryAll(dbPath, 'PRAGMA integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error(`${target.name} 数据库 integrity_check 失败`);
  }
  const foreignKeys = await queryAll(dbPath, 'PRAGMA foreign_key_check');
  if (foreignKeys.length > 0) throw new Error(`${target.name} 数据库存在外键错误`);

  const migrationTable = await queryAll(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'"
  );
  const history = migrationTable.length
    ? await queryAll(dbPath, `
        SELECT migration_name, checksum, finished_at, rolled_back_at
        FROM _prisma_migrations
        ORDER BY started_at, migration_name
      `)
    : [];
  const expectedMigrations = await readExpectedMigrations(workspace, target.name);
  const migrationHistory = validateMigrationHistory(target.name, history, expectedMigrations);

  const diff = runPrisma([
    'migrate', 'diff',
    '--from-schema-datasource', target.schema,
    '--to-schema-datamodel', target.schema,
    '--script'
  ], env).trim();
  if (diff && diff !== '-- This is an empty migration.') {
    throw new Error(`${target.name} 数据库与当前 Schema 存在 drift，拒绝 baseline`);
  }

  if (apply) {
    for (const migration of migrationHistory.missingMigrations) {
      runPrisma(['migrate', 'resolve', '--schema', target.schema, '--applied', migration], env);
    }
  }

  return {
    database: target.name,
    path: dbPath,
    existingMigrationCount: history.length,
    appliedMigrations: apply
      ? expectedMigrations.map(migration => migration.name)
      : migrationHistory.appliedMigrations,
    resolvedMigrations: apply ? migrationHistory.missingMigrations : [],
    missingMigrations: apply ? [] : migrationHistory.missingMigrations,
    migrationHistoryReady: migrationHistory.missingMigrations.length === 0 || apply,
    mode: apply ? 'apply' : 'audit'
  };
}

async function main() {
  const results = [];
  for (const target of targets) results.push(await inspect(target));
  console.log(JSON.stringify({ success: true, results }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
