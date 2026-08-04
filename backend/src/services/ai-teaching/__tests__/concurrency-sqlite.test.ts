import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import sqlite3 from 'sqlite3';
import {
  closeDatabase,
  executeSql,
  openDatabase,
  queryAll,
} from '../../../operations/sqlite-database';

jest.setTimeout(30000);

const backendRoot = resolve(__dirname, '..', '..', '..', '..');
const migrationNames = [
  '20260717000000_main_baseline',
  '20260717010000_blackbox_command_journal',
  '20260719000000_teaching_session_concurrency',
  '20260719010000_learning_state_serialization',
  '20260719020000_path_generation_rollback_snapshot',
];

function run(database: sqlite3.Database, sql: string, params: any[] = []): Promise<number> {
  return new Promise((resolveRun, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolveRun(this.changes);
    });
  });
}

async function applyMigration(database: sqlite3.Database, name: string): Promise<void> {
  const sql = await readFile(join(backendRoot, 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
  await executeSql(database, sql);
}

async function openWritableDatabase(filePath: string): Promise<sqlite3.Database> {
  const database = await openDatabase(filePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  await executeSql(database, 'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return database;
}

async function createMigratedDatabase(filePath: string): Promise<sqlite3.Database> {
  const database = await openWritableDatabase(filePath);
  for (const migration of migrationNames) {
    await applyMigration(database, migration);
  }
  return database;
}

async function insertUser(database: sqlite3.Database, userId = 'user-1'): Promise<void> {
  await run(database, `
    INSERT INTO users (id, email, name, password, updatedAt)
    VALUES (?, ?, '测试用户', 'hash', CURRENT_TIMESTAMP)
  `, [userId, `${userId}@example.com`]);
}

async function insertFinalizingSession(
  database: sqlite3.Database,
  sessionId: string,
  taskId: string,
  operationId: string
): Promise<void> {
  await run(database, `
    INSERT INTO teaching_sessions (
      id, userId, taskId, subject, topic, status, messages, knowledgeState,
      revision, openKey, operationId, operationKind, operationLeaseExpiresAt, updatedAt
    ) VALUES (?, 'user-1', ?, '测试', '并发', 'finalizing', '[]', '[]', 1, ?, ?, 'finalize:active', datetime('now', '+30 minutes'), CURRENT_TIMESTAMP)
  `, [sessionId, taskId, `user-1:${taskId}`, operationId]);
}

async function insertActiveSession(database: sqlite3.Database, sessionId: string, taskId: string): Promise<void> {
  await run(database, `
    INSERT INTO teaching_sessions (
      id, userId, taskId, subject, topic, status, messages, knowledgeState,
      teachingState, revision, openKey, updatedAt
    ) VALUES (?, 'user-1', ?, '测试', '并发结束', 'active', '[]', '[]', ?, 1, ?, CURRENT_TIMESTAMP)
  `, [
    sessionId,
    taskId,
    JSON.stringify({
      classroomContext: { stage: 'wrapup' },
      classroomEventHistory: [{ type: 'ready-to-close' }]
    }),
    `user-1:${taskId}`
  ]);
}

async function claimSessionFinalization(
  database: sqlite3.Database,
  sessionId: string,
  operationId: string
): Promise<boolean> {
  await executeSql(database, 'BEGIN IMMEDIATE;');
  try {
    const rows = await queryAll<any>(database, `
      SELECT revision, status, operationId, operationLeaseExpiresAt, teachingState
      FROM teaching_sessions WHERE id = ?
    `, [sessionId]);
    const current = rows[0];
    if (!current) throw new Error('SESSION_NOT_FOUND');
    const leaseActive = current.operationId
      && current.operationLeaseExpiresAt
      && new Date(`${current.operationLeaseExpiresAt}Z`).getTime() > Date.now();
    if (leaseActive) {
      await executeSql(database, 'COMMIT;');
      return false;
    }
    const state = JSON.parse(current.teachingState || '{}');
    state.finalization = {
      sessionClosure: 'processing',
      taskCompletion: 'not_started',
      reviewCompletion: 'not_started',
      lastAction: 'end_only',
      lastOperationId: operationId,
      lastRequestedAt: new Date().toISOString()
    };
    const claimed = await run(database, `
      UPDATE teaching_sessions
      SET status = 'finalizing', teachingState = ?, operationId = ?,
          operationKind = 'finalize:end_only', operationLeaseExpiresAt = datetime('now', '+30 minutes'),
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND revision = ? AND status = ?
        AND (operationId IS NULL OR operationLeaseExpiresAt <= CURRENT_TIMESTAMP)
    `, [JSON.stringify(state), operationId, sessionId, current.revision, current.status]);
    await executeSql(database, 'COMMIT;');
    return claimed === 1;
  } catch (error) {
    await executeSql(database, 'ROLLBACK;');
    throw error;
  }
}

async function commitFinalization(
  database: sqlite3.Database,
  input: {
    sessionId: string;
    operationId: string;
    metricId: string;
    sourceKey: string;
    eventId: string;
    expectedRevision: number;
  }
): Promise<boolean> {
  await executeSql(database, 'BEGIN IMMEDIATE;');
  try {
    const claimed = await run(database, `
      UPDATE users
      SET learningStateRevision = learningStateRevision + 1
      WHERE id = 'user-1' AND learningStateRevision = ?
    `, [input.expectedRevision]);
    if (claimed !== 1) {
      await executeSql(database, 'ROLLBACK;');
      return false;
    }

    await run(database, `
      DELETE FROM learning_metrics WHERE sourceKey = ?
    `, [input.sourceKey]);
    await run(database, `
      INSERT INTO learning_metrics (
        id, sourceKey, userId, metricType, value, lss, ktl, lf, lsb, metadata, calculatedAt
      ) VALUES (?, ?, 'user-1', 'learning_state', 1, 1, 1, 1, 0, '{"version":"state-v2","committed":true}', CURRENT_TIMESTAMP)
    `, [input.metricId, input.sourceKey]);

    const completed = await run(database, `
      UPDATE teaching_sessions
      SET status = 'completed', wrapup = '{"status":"complete"}', openKey = NULL,
          operationId = NULL, operationKind = NULL, operationLeaseExpiresAt = NULL,
          revision = revision + 1, endTime = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'finalizing' AND operationId = ?
    `, [input.sessionId, input.operationId]);
    if (completed !== 1) throw new Error('SESSION_FENCE_FAILED');

    await run(database, `
      INSERT INTO domain_event_outbox (
        id, eventType, aggregateType, aggregateId, userId, source, payload, updatedAt
      ) VALUES (?, 'lesson:completed', 'lesson', ?, 'user-1', 'test', '{}', CURRENT_TIMESTAMP)
    `, [input.eventId, input.sessionId]);
    await executeSql(database, 'COMMIT;');
    return true;
  } catch (error) {
    await executeSql(database, 'ROLLBACK;');
    throw error;
  }
}

describe('Teaching SQLite concurrency and migrations', () => {
  let directory: string;
  let databasePath: string;
  const databases: sqlite3.Database[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wenflow-teaching-concurrency-'));
    databasePath = join(directory, 'main.db');
  });

  afterEach(async () => {
    await Promise.all(databases.splice(0).map(database => closeDatabase(database)));
    await rm(directory, { recursive: true, force: true });
  });

  it('backfills canonical metric identities and discards orphan legacy closure rows', async () => {
    const database = await openWritableDatabase(databasePath);
    databases.push(database);
    await applyMigration(database, migrationNames[0]);
    await applyMigration(database, migrationNames[1]);
    await insertUser(database);

    await run(database, `
      INSERT INTO teaching_sessions (id, userId, taskId, subject, topic, status, wrapup, teachingState, endTime, updatedAt)
      VALUES
        ('session-complete', 'user-1', 'task-1', '测试', '完成', 'completed', '{"status":"complete"}', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('session-active', 'user-1', 'task-2', '测试', '进行中', 'active', NULL, '{}', NULL, CURRENT_TIMESTAMP),
        ('session-reset', 'user-1', 'task-3', '测试', '重置', 'completed', NULL, '{"sessionArtifacts":{"resetAt":"2026-07-19T00:00:00.000Z"}}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    await run(database, `
      INSERT INTO learning_metrics (id, userId, metricType, value, metadata, calculatedAt)
      VALUES
        ('metric-old', 'user-1', 'learning_state', 1, '{"source":"session-wrapup","sessionId":"session-complete"}', '2026-07-19T00:00:00.000Z'),
        ('metric-new', 'user-1', 'learning_state', 2, '{"source":"session-wrapup","sessionId":"session-complete"}', '2026-07-19T01:00:00.000Z'),
        ('metric-orphan', 'user-1', 'learning_state', 3, '{"source":"session-wrapup","sessionId":"session-active"}', '2026-07-19T02:00:00.000Z')
    `);

    for (const migration of migrationNames.slice(2)) {
      await applyMigration(database, migration);
    }

    const metrics = await queryAll<any>(database, `
      SELECT id, sourceKey FROM learning_metrics ORDER BY id
    `);
    expect(metrics).toEqual([{
      id: 'metric-new',
      sourceKey: 'session-wrapup:session-complete'
    }]);
    const reset = await queryAll<any>(database, `
      SELECT status, openKey FROM teaching_sessions WHERE id = 'session-reset'
    `);
    expect(reset[0]).toEqual({ status: 'discarded', openKey: null });

    await expect(run(database, `
      INSERT INTO teaching_sessions (
        id, userId, taskId, subject, topic, status, openKey, updatedAt
      ) VALUES ('duplicate-open', 'user-1', 'task-2', '测试', '重复', 'active', 'user-1:task-2', CURRENT_TIMESTAMP)
    `)).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT' });
  });

  it('serializes different session metrics with a per-user CAS and allows a recomputed retry', async () => {
    const setup = await createMigratedDatabase(databasePath);
    databases.push(setup);
    await insertUser(setup);
    await insertFinalizingSession(setup, 'session-1', 'task-1', 'operation-1');
    await insertFinalizingSession(setup, 'session-2', 'task-2', 'operation-2');

    const first = await openWritableDatabase(databasePath);
    const second = await openWritableDatabase(databasePath);
    databases.push(first, second);
    const attempts = await Promise.all([
      commitFinalization(first, {
        sessionId: 'session-1', operationId: 'operation-1', metricId: 'metric-1',
        sourceKey: 'session-wrapup:session-1', eventId: 'event-1', expectedRevision: 0
      }),
      commitFinalization(second, {
        sessionId: 'session-2', operationId: 'operation-2', metricId: 'metric-2',
        sourceKey: 'session-wrapup:session-2', eventId: 'event-2', expectedRevision: 0
      })
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);

    const losingSession = attempts[0]
      ? { database: second, sessionId: 'session-2', operationId: 'operation-2', metricId: 'metric-2', sourceKey: 'session-wrapup:session-2', eventId: 'event-2' }
      : { database: first, sessionId: 'session-1', operationId: 'operation-1', metricId: 'metric-1', sourceKey: 'session-wrapup:session-1', eventId: 'event-1' };
    await expect(commitFinalization(losingSession.database, {
      ...losingSession,
      expectedRevision: 1
    })).resolves.toBe(true);

    const state = await queryAll<any>(setup, `
      SELECT learningStateRevision FROM users WHERE id = 'user-1'
    `);
    const metrics = await queryAll<any>(setup, `
      SELECT COUNT(*) AS count FROM learning_metrics WHERE sourceKey LIKE 'session-wrapup:%'
    `);
    const sessions = await queryAll<any>(setup, `
      SELECT COUNT(*) AS count FROM teaching_sessions WHERE status = 'completed' AND wrapup IS NOT NULL
    `);
    expect(state[0].learningStateRevision).toBe(2);
    expect(metrics[0].count).toBe(2);
    expect(sessions[0].count).toBe(2);
  });

  it('同一课堂的两个并发 Finalization 只有一个获得 operation lease', async () => {
    const setup = await createMigratedDatabase(databasePath);
    databases.push(setup);
    await insertUser(setup);
    await insertActiveSession(setup, 'session-1', 'task-1');

    const first = await openWritableDatabase(databasePath);
    const second = await openWritableDatabase(databasePath);
    databases.push(first, second);
    const claims = await Promise.all([
      claimSessionFinalization(first, 'session-1', 'finalize-a'),
      claimSessionFinalization(second, 'session-1', 'finalize-b')
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const session = await queryAll<any>(setup, `
      SELECT status, operationId, operationKind, teachingState
      FROM teaching_sessions WHERE id = 'session-1'
    `);
    expect(session[0]).toEqual(expect.objectContaining({
      status: 'finalizing',
      operationKind: 'finalize:end_only'
    }));
    expect(['finalize-a', 'finalize-b']).toContain(session[0].operationId);
    expect(JSON.parse(session[0].teachingState)).toEqual(expect.objectContaining({
      classroomContext: { stage: 'wrapup' },
      classroomEventHistory: [{ type: 'ready-to-close' }],
      finalization: expect.objectContaining({
        sessionClosure: 'processing',
        lastOperationId: session[0].operationId
      })
    }));
  });

  it('rolls back metric and revision changes when the session operation fence fails', async () => {
    const database = await createMigratedDatabase(databasePath);
    databases.push(database);
    await insertUser(database);
    await insertFinalizingSession(database, 'session-1', 'task-1', 'operation-1');

    await expect(commitFinalization(database, {
      sessionId: 'session-1',
      operationId: 'wrong-operation',
      metricId: 'metric-1',
      sourceKey: 'session-wrapup:session-1',
      eventId: 'event-1',
      expectedRevision: 0
    })).rejects.toThrow('SESSION_FENCE_FAILED');

    const state = await queryAll<any>(database, `
      SELECT learningStateRevision FROM users WHERE id = 'user-1'
    `);
    const metrics = await queryAll<any>(database, `
      SELECT COUNT(*) AS count FROM learning_metrics WHERE sourceKey = 'session-wrapup:session-1'
    `);
    const session = await queryAll<any>(database, `
      SELECT status, operationId FROM teaching_sessions WHERE id = 'session-1'
    `);
    expect(state[0].learningStateRevision).toBe(0);
    expect(metrics[0].count).toBe(0);
    expect(session[0]).toEqual({ status: 'finalizing', operationId: 'operation-1' });
  });
});
