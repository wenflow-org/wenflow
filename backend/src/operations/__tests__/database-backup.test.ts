import { createHash, randomBytes } from 'crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sqlite3 from 'sqlite3'
import {
  backupSqliteOnline,
  createDatabaseBackup,
  verifyDatabaseBackup
} from '../database-backup'
import {
  closeDatabase,
  executeSql,
  openDatabase,
  queryAll
} from '../sqlite-database'

const MAIN_TABLES = ['users', 'learning_paths', 'path_generation_runs', 'domain_event_outbox', 'learner_projections']
const SYSTEM_TABLES = ['agent_prompts', 'agent_contracts', 'agent_field_routings', 'prompt_eval_cases']

describe('database backup', () => {
  let workspace: string
  let backendRoot: string
  let projectRoot: string
  let backupRoot: string
  let mainPath: string
  let systemPath: string
  let previousKeys: string | undefined
  let previousCurrentKey: string | undefined
  const key = randomBytes(32).toString('base64')

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'wenflow-db-backup-'))
    backendRoot = join(workspace, 'backend')
    projectRoot = join(workspace, 'project')
    backupRoot = join(workspace, 'external-backups')
    mainPath = join(workspace, 'data', 'main.db')
    systemPath = join(workspace, 'data', 'system.db')
    await mkdir(projectRoot)
    await mkdir(join(workspace, 'data'))
    await createFixtureDatabase('main', mainPath, backendRoot)
    await createFixtureDatabase('system', systemPath, backendRoot)
    previousKeys = process.env.SECRET_ENCRYPTION_KEYS
    previousCurrentKey = process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    process.env.SECRET_ENCRYPTION_KEYS = `v1:${key}`
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'v1'
  })

  afterEach(async () => {
    if (previousKeys === undefined) delete process.env.SECRET_ENCRYPTION_KEYS
    else process.env.SECRET_ENCRYPTION_KEYS = previousKeys
    if (previousCurrentKey === undefined) delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    else process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = previousCurrentKey
    await rm(workspace, { recursive: true, force: true })
  })

  it('Online Backup 包含尚未 checkpoint 的 WAL 已提交数据', async () => {
    const source = join(workspace, 'wal-source.db')
    const rawCopy = join(workspace, 'raw-copy.db')
    const onlineCopy = join(workspace, 'online-copy.db')
    const writer = await openDatabase(source, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE)
    try {
      await executeSql(writer, `
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        CREATE TABLE wal_probe (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        PRAGMA wal_checkpoint(TRUNCATE);
      `)
      const hashBefore = await fileHash(source)
      await executeSql(writer, "INSERT INTO wal_probe VALUES ('sentinel', 'committed-only-in-wal')")
      expect(await fileHash(source)).toBe(hashBefore)
      expect((await stat(`${source}-wal`)).size).toBeGreaterThan(32)

      await copyFile(source, rawCopy)
      const rawDatabase = await openDatabase(rawCopy)
      try {
        expect((await queryAll<any>(rawDatabase, "SELECT COUNT(*) AS count FROM wal_probe WHERE id='sentinel'"))[0].count)
          .toBe(0)
      } finally {
        await closeDatabase(rawDatabase)
      }

      await backupSqliteOnline(source, onlineCopy)
      const backupDatabase = await openDatabase(onlineCopy)
      try {
        expect((await queryAll<any>(backupDatabase, "SELECT COUNT(*) AS count FROM wal_probe WHERE id='sentinel'"))[0].count)
          .toBe(1)
      } finally {
        await closeDatabase(backupDatabase)
      }
    } finally {
      await closeDatabase(writer)
    }
  })

  it('创建并隔离验证双库备份，manifest 不包含 Key 原文', async () => {
    const result = await createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: `file:${mainPath}`,
      systemDatabaseUrl: `file:${systemPath}`,
      outputRoot: backupRoot,
      confirmQuiesced: true,
      skipPermissionAudit: true
    })

    expect(result.manifest.pairAtomic).toBe(false)
    expect(result.manifest.databases.map(database => database.role)).toEqual(['main', 'system'])
    const manifestText = await readFile(join(result.backupDirectory, 'manifest.json'), 'utf8')
    expect(manifestText).not.toContain(key)
    expect(manifestText).not.toContain('SECRET_ENCRYPTION_KEYS')
    await expect(verifyDatabaseBackup(result.backupDirectory, backendRoot)).resolves.toEqual(result.manifest)
  })

  it('不确认停写时拒绝执行，篡改备份后验证失败', async () => {
    await expect(createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: `file:${mainPath}`,
      systemDatabaseUrl: `file:${systemPath}`,
      outputRoot: backupRoot,
      confirmQuiesced: false,
      skipPermissionAudit: true
    })).rejects.toThrow('停写')

    const result = await createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: `file:${mainPath}`,
      systemDatabaseUrl: `file:${systemPath}`,
      outputRoot: backupRoot,
      confirmQuiesced: true,
      skipPermissionAudit: true
    })
    await writeFile(join(result.backupDirectory, 'main.db'), 'tampered')
    await expect(verifyDatabaseBackup(result.backupDirectory, backendRoot)).rejects.toThrow('校验和')
  })

  it('缺少持久化 Keyring 时拒绝创建正式备份', async () => {
    delete process.env.SECRET_ENCRYPTION_KEYS
    delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    await expect(createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: `file:${mainPath}`,
      systemDatabaseUrl: `file:${systemPath}`,
      outputRoot: backupRoot,
      confirmQuiesced: true,
      skipPermissionAudit: true
    })).rejects.toThrow('SECRET_ENCRYPTION_KEYS')
  })

  it('新增代码 migration 后仍可按 manifest 验证历史备份', async () => {
    const result = await createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: `file:${mainPath}`,
      systemDatabaseUrl: `file:${systemPath}`,
      outputRoot: backupRoot,
      confirmQuiesced: true,
      skipPermissionAudit: true
    })
    const futureMigration = join(backendRoot, 'prisma', 'migrations', '20990101000000_future')
    await mkdir(futureMigration, { recursive: true })
    await writeFile(join(futureMigration, 'migration.sql'), '-- future migration\n')

    await expect(verifyDatabaseBackup(result.backupDirectory, backendRoot)).resolves.toEqual(result.manifest)
  })
})

async function fileHash(filePath: string) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function createFixtureDatabase(role: 'main' | 'system', filePath: string, backendRoot: string) {
  const migrationName = role === 'main' ? '20260717000000_main_baseline' : '20260717000000_system_baseline'
  const migrationDirectory = role === 'main'
    ? join(backendRoot, 'prisma', 'migrations', migrationName)
    : join(backendRoot, 'prisma', 'system', 'migrations', migrationName)
  await mkdir(migrationDirectory, { recursive: true })
  const migrationSql = role === 'main' ? '-- main fixture\n' : '-- system fixture\n'
  await writeFile(join(migrationDirectory, 'migration.sql'), migrationSql)
  const checksum = createHash('sha256').update(migrationSql).digest('hex')
  const tables = role === 'main' ? MAIN_TABLES : SYSTEM_TABLES
  const database = await openDatabase(filePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE)
  try {
    await executeSql(database, `
      CREATE TABLE _prisma_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        finished_at DATETIME,
        migration_name TEXT NOT NULL,
        logs TEXT,
        rolled_back_at DATETIME,
        started_at DATETIME NOT NULL,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      );
      ${tables.map(table => `CREATE TABLE ${table} (id TEXT PRIMARY KEY);`).join('\n')}
      INSERT INTO _prisma_migrations (
        id, checksum, finished_at, migration_name, started_at, applied_steps_count
      ) VALUES ('migration-id', '${checksum}', CURRENT_TIMESTAMP, '${migrationName}', CURRENT_TIMESTAMP, 1);
    `)
  } finally {
    await closeDatabase(database)
  }
}
