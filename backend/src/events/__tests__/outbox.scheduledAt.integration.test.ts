/* eslint-disable @typescript-eslint/no-explicit-any -- DB 集成桩：临时库句柄/原始行无类型导出 */
/**
 * #106② outbox `scheduledAt` 拆列：定向集成测试。
 *
 * 全程使用**临时 SQLite 库**（自带 baseline + 新迁移，走 prisma db execute 应用真实迁移文件），
 * 绝不触达 dev.db / 其它表；与仓库既有 DB 集成用例同口径默认跳过。
 *
 * 覆盖：
 *  ① 写入侧：显式排期落列；未来 occurredAt 自动成排期；普通事件 scheduledAt = NULL；
 *  ② 拾取门：排期未到点不被拾取、到点被拾取、普通事件立即可拾取（真时钟，非 mock）；
 *  ③ 迁移回填：存量「availableAt 在未来」的未决行保留原排期；普通历史行行为不变。
 *
 * 跑法：RUN_DB_INTEGRATION_TESTS=1 npx jest src/events/__tests__/outbox.scheduledAt.integration.test.ts --runInBand
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const workspace = join(__dirname, '..', '..', '..');
const prismaCli = join(workspace, 'node_modules', 'prisma', 'build', 'index.js');
const baselineSql = join(workspace, 'prisma', 'migrations', '20260717000000_main_baseline', 'migration.sql');
const scheduledSql = join(workspace, 'prisma', 'migrations', '20261019010830_outbox_scheduled_at', 'migration.sql');

function dbUrl(file: string): string {
  return `file:${file.split('\\').join('/')}`;
}

/** 用 prisma 自己的 db execute 应用迁移文件（不建 shadow、不写 _prisma_migrations，仅 DDL/回填本身）。 */
function applySql(url: string, file: string): void {
  try {
    execFileSync(
      process.execPath,
      [prismaCli, 'db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'],
      { cwd: workspace, env: { ...process.env, DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error: any) {
    throw new Error(`db execute ${file} 失败: ${String(error?.stderr || error?.stdout || error?.message || error)}`);
  }
}

/** 建一个临时库：先 baseline，再（可选）应用 scheduledAt 迁移，返回库 URL。 */
function createTempDb(root: string, name: string, withScheduledAt: boolean): string {
  const file = join(root, `${name}.db`);
  const url = dbUrl(file);
  applySql(url, baselineSql);
  if (withScheduledAt) applySql(url, scheduledSql);
  return url;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runIntegration('outbox scheduledAt 拆列（临时库集成）', () => {
  jest.setTimeout(180_000);

  let tmpRoot: string;
  let dbA: string;
  let dbB: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'wenflow-outbox-scheduled-'));
    dbA = createTempDb(tmpRoot, 'gate', true);
    dbB = createTempDb(tmpRoot, 'backfill', false);
  });

  afterAll(async () => {
    // Windows 下查询引擎句柄释放有延迟：尽力清理（临时目录，失败不污染仓库也不判失败）
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
        return;
      } catch {
        await sleep(400);
      }
    }
  });

  describe('拾取门与写入侧', () => {
    let prisma: PrismaClient;
    let worker: any;
    let enqueueDomainEvent: typeof import('../outbox.repository').enqueueDomainEvent;
    let createDomainEvent: typeof import('../contracts').createDomainEvent;
    const dispatched: string[] = [];

    beforeAll(async () => {
      process.env.DATABASE_URL = dbA;
      jest.resetModules();
      prisma = new PrismaClient({ datasources: { db: { url: dbA } } });
      ({ enqueueDomainEvent } = await import('../outbox.repository'));
      ({ createDomainEvent } = await import('../contracts'));
      const { DurableOutboxWorker } = await import('../outbox.worker');
      worker = new DurableOutboxWorker({
        dispatch: async (event: any) => { dispatched.push(event.id); }
      } as any);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('写入侧：排期显式落列 / 未来 occurredAt 自动成排期 / 普通事件 NULL', async () => {
      const now = Date.now();
      const future = new Date(now + 60 * 60 * 1000);

      await enqueueDomainEvent(prisma, createDomainEvent({
        id: 'sched-explicit', type: 'task:completed', aggregateType: 'task', aggregateId: 't-explicit',
        userId: 'sched-user-a', source: 'test', occurredAt: new Date(now - 1000), data: {},
        scheduledAt: future
      }));
      await enqueueDomainEvent(prisma, createDomainEvent({
        id: 'sched-derived', type: 'task:completed', aggregateType: 'task', aggregateId: 't-derived',
        userId: 'sched-user-b', source: 'test', occurredAt: future, data: {}
      }));
      await enqueueDomainEvent(prisma, createDomainEvent({
        id: 'sched-plain', type: 'task:completed', aggregateType: 'task', aggregateId: 't-plain',
        userId: 'sched-user-c', source: 'test', occurredAt: new Date(now - 1000), data: {}
      }));

      const rows = await prisma.domain_event_outbox.findMany({ where: { id: { in: ['sched-explicit', 'sched-derived', 'sched-plain'] } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get('sched-explicit')?.scheduledAt?.getTime()).toBe(future.getTime());
      expect(byId.get('sched-derived')?.scheduledAt?.getTime()).toBe(future.getTime());
      expect(byId.get('sched-plain')?.scheduledAt).toBeNull();
      // 技术门不再直抄 occurredAt：排期事件入队即 technically available，延后由 scheduledAt 承担
      expect(byId.get('sched-derived')!.availableAt.getTime()).toBeLessThan(future.getTime());
    });

    it('拾取门：未到点不被拾取；普通事件立即可拾取；到点后被拾取（真时钟）', async () => {
      const now = Date.now();
      const due = new Date(now - 60_000);
      const soon = new Date(now + 1500);

      await enqueueDomainEvent(prisma, createDomainEvent({
        id: 'gate-not-due', type: 'task:completed', aggregateType: 'task', aggregateId: 't-1',
        userId: 'gate-user-1', source: 'test', occurredAt: due, data: {}, scheduledAt: soon
      }));
      await enqueueDomainEvent(prisma, createDomainEvent({
        id: 'gate-plain', type: 'task:completed', aggregateType: 'task', aggregateId: 't-2',
        userId: 'gate-user-2', source: 'test', occurredAt: due, data: {}
      }));

      await worker.runOnce();
      const afterFirst = new Map((await prisma.domain_event_outbox.findMany({
        where: { id: { in: ['gate-not-due', 'gate-plain'] } }
      })).map((row) => [row.id, row]));
      expect(afterFirst.get('gate-not-due')?.status).toBe('pending');
      expect(afterFirst.get('gate-plain')?.status).toBe('published');
      expect(dispatched).toContain('gate-plain');
      expect(dispatched).not.toContain('gate-not-due');

      await sleep(2000);
      await worker.runOnce();
      const afterDue = await prisma.domain_event_outbox.findUnique({ where: { id: 'gate-not-due' } });
      expect(afterDue?.status).toBe('published');
      expect(dispatched).toContain('gate-not-due');
    });
  });

  describe('迁移回填（存量行为等价）', () => {
    it('未来可用行保留原排期；普通历史行保持立即可用', async () => {
      const prisma = new PrismaClient({ datasources: { db: { url: dbB } } });
      try {
        const now = Date.now();
        const future = now + 3 * 24 * 60 * 60 * 1000;
        const past = now - 60_000;
        // 旧实现口径：availableAt 直抄 occurredAt（未来模拟日 / 普通行）
        await prisma.$executeRawUnsafe(
          `INSERT INTO domain_event_outbox (id,eventType,schemaVersion,aggregateType,aggregateId,userId,source,payload,status,attemptCount,availableAt,occurredAt,createdAt,updatedAt)
           VALUES ('legacy-future','task:completed',1,'task','t-f','u-f','test','{}','pending',0,?,?,?,?)`,
          future, future, past, past
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO domain_event_outbox (id,eventType,schemaVersion,aggregateType,aggregateId,userId,source,payload,status,attemptCount,availableAt,occurredAt,createdAt,updatedAt)
           VALUES ('legacy-normal','task:completed',1,'task','t-n','u-n','test','{}','pending',0,?,?,?,?)`,
          past, past, past, past
        );

        applySql(dbB, scheduledSql);

        const rows = await prisma.domain_event_outbox.findMany({
          where: { id: { in: ['legacy-future', 'legacy-normal'] } }
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        // 保留原排期：未来行 scheduledAt = 原 availableAt，仍在原日期可处理
        expect(byId.get('legacy-future')?.scheduledAt?.getTime()).toBe(future);
        expect(byId.get('legacy-normal')?.scheduledAt).toBeNull();
        // 新门两条件对存量行与旧门逐一等价
        const gateRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM domain_event_outbox
           WHERE status='pending' AND availableAt <= ? AND (scheduledAt IS NULL OR scheduledAt <= ?)`,
          Date.now(), Date.now()
        );
        expect(gateRows.map((row) => row.id)).toEqual(['legacy-normal']);
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
