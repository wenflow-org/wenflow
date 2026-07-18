import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { readExpectedMigrations, validateSqliteDatabase } from '../operations/sqlite-database';

const workspace = resolve(__dirname, '..', '..');
const prismaCli = join(workspace, 'node_modules', 'prisma', 'build', 'index.js');
const tempDir = join(process.env.TEMP || process.env.TMP || workspace, `wenflow-prisma-${randomUUID()}`);
const mainDb = join(tempDir, 'main.db');
const systemDb = join(tempDir, 'system.db');
const mainUrl = `file:${mainDb.replace(/\\/g, '/')}`;
const systemUrl = `file:${systemDb.replace(/\\/g, '/')}`;
const env = { ...process.env, DATABASE_URL: mainUrl, SYSTEM_DATABASE_URL: systemUrl };

function prisma(args: string[]) {
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

function assertMigrationLayout() {
  const targets = [
    {
      directory: join(workspace, 'prisma', 'migrations'),
      requiredBaseline: '20260717000000_main_baseline',
      forbiddenSql: /\b(agent_prompts|agent_contracts|prompt_eval_cases)\b/
    },
    {
      directory: join(workspace, 'prisma', 'system', 'migrations'),
      requiredBaseline: '20260717000000_system_baseline',
      forbiddenSql: /\b(users|learning_paths|domain_event_outbox|projection_access_grants)\b/
    }
  ];

  for (const target of targets) {
    const migrationDirectories = readdirSync(target.directory)
      .filter(name => statSync(join(target.directory, name)).isDirectory())
      .sort();
    if (migrationDirectories.length === 0 || migrationDirectories[0] !== target.requiredBaseline) {
      throw new Error(`${target.directory} must start with ${target.requiredBaseline}`);
    }
    for (const migration of migrationDirectories) {
      const files = readdirSync(join(target.directory, migration));
      if (files.length !== 1 || files[0] !== 'migration.sql') {
        throw new Error(`${migration} must contain exactly one migration.sql`);
      }
      const sql = readFileSync(join(target.directory, migration, 'migration.sql'), 'utf8');
      if (target.forbiddenSql.test(sql)) {
        throw new Error(`${migration} contains tables from the other database`);
      }
    }
  }
}

async function main() {
  assertMigrationLayout();
  mkdirSync(tempDir, { recursive: true });
  try {
    prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
    prisma(['migrate', 'deploy', '--schema', 'prisma/system/schema.prisma']);
    prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
    prisma(['migrate', 'deploy', '--schema', 'prisma/system/schema.prisma']);
    prisma(['migrate', 'status', '--schema', 'prisma/schema.prisma']);
    prisma(['migrate', 'status', '--schema', 'prisma/system/schema.prisma']);
    const mainDiff = prisma([
      'migrate', 'diff',
      '--from-schema-datasource', 'prisma/schema.prisma',
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--script'
    ]).trim();
    const systemDiff = prisma([
      'migrate', 'diff',
      '--from-schema-datasource', 'prisma/system/schema.prisma',
      '--to-schema-datamodel', 'prisma/system/schema.prisma',
      '--script'
    ]).trim();
    if (mainDiff && mainDiff !== '-- This is an empty migration.') throw new Error('main database drift detected');
    if (systemDiff && systemDiff !== '-- This is an empty migration.') throw new Error('system database drift detected');

    await validateSqliteDatabase(mainDb, 'main', workspace);
    await validateSqliteDatabase(systemDb, 'system', workspace);
    const [mainMigrations, systemMigrations] = await Promise.all([
      readExpectedMigrations(workspace, 'main'),
      readExpectedMigrations(workspace, 'system')
    ]);
    console.log(JSON.stringify({
      success: true,
      mainMigrationCount: mainMigrations.length,
      systemMigrationCount: systemMigrations.length
    }));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
