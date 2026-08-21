import prisma from '../config/database';
import { logger } from '../utils/logger';
import { DurableEventConsumerRegistry } from './consumer-registry';
import { mapOutboxRecord } from './outbox.repository';

const POLL_INTERVAL_MS = 1000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export class DurableOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  private inFlight: Promise<void> | null = null;
  private readonly owner = process.env.INSTANCE_ID || `outbox-${process.pid}`;

  constructor(private readonly registry: DurableEventConsumerRegistry) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.runTickSafely(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.runTickSafely();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async runTickSafely(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      logger.error('持久事件轮询失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    this.inFlight = this.processBatch();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
      this.running = false;
    }
  }

  private async processBatch(): Promise<void> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - LOCK_TIMEOUT_MS);
    const records = await prisma.domain_event_outbox.findMany({
      where: {
        availableAt: { lte: now },
        OR: [
          { status: 'pending' },
          { status: 'processing', lockedAt: { lte: staleLock } }
        ]
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 20
    });

    const taskUsersSeen = new Set<string>();
    for (const record of records) {
      if (this.stopping) return;
      if (record.eventType === 'task:completed' && record.userId) {
        if (taskUsersSeen.has(record.userId)) continue;
        taskUsersSeen.add(record.userId);
        const oldestUnresolved = await prisma.domain_event_outbox.findFirst({
          where: {
            eventType: 'task:completed',
            userId: record.userId,
            status: { in: ['pending', 'processing'] }
          },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true }
        });
        if (oldestUnresolved?.id !== record.id) continue;
      }
      const claimed = await prisma.domain_event_outbox.updateMany({
        where: {
          id: record.id,
          OR: [
            { status: 'pending' },
            { status: 'processing', lockedAt: { lte: staleLock } }
          ]
        },
        data: { status: 'processing', lockedAt: now, lockOwner: this.owner }
      });
      if (claimed.count !== 1) continue;

      try {
        await this.registry.dispatch(mapOutboxRecord(record));
        await prisma.domain_event_outbox.updateMany({
          where: { id: record.id, status: 'processing', lockOwner: this.owner },
          data: {
            status: 'published',
            processedAt: new Date(),
            lockedAt: null,
            lockOwner: null,
            lastError: null
          }
        });
      } catch (error) {
        const attemptCount = record.attemptCount + 1;
        const dead = record.eventType !== 'task:completed' && attemptCount >= MAX_ATTEMPTS;
        const backoffMs = Math.min(60_000, 1000 * 2 ** Math.min(attemptCount, 6));
        await prisma.domain_event_outbox.updateMany({
          where: { id: record.id, status: 'processing', lockOwner: this.owner },
          data: {
            status: dead ? 'dead' : 'pending',
            attemptCount,
            availableAt: new Date(Date.now() + backoffMs),
            lockedAt: null,
            lockOwner: null,
            lastError: error instanceof Error ? error.message : String(error)
          }
        });
        logger.warn('持久事件消费失败', { eventId: record.id, eventType: record.eventType, attemptCount, dead });
      }
    }
  }
}

/**
 * 死信重置：dead → pending，清零尝试计数并立即可投递。
 * 背景：dead 是无出口终态（worker 不会再拾取），此前没有任何管理手段把
 * 修复后的死信重新入队。运维修复根因后调用本函数重放。
 * @param eventType 可选按事件类型过滤（如 'lesson:completed'）；缺省重置全部死信
 * @returns 重置的事件数
 */
export async function requeueDeadOutboxEvents(eventType?: string): Promise<number> {
  const result = await prisma.domain_event_outbox.updateMany({
    where: {
      status: 'dead',
      ...(eventType ? { eventType } : {})
    },
    data: {
      status: 'pending',
      attemptCount: 0,
      availableAt: new Date(),
      lockedAt: null,
      lockOwner: null
    }
  });
  if (result.count > 0) {
    logger.info('[outbox] 死信已重新入队', { requeued: result.count, eventType: eventType || 'all' });
  }
  return result.count;
}
