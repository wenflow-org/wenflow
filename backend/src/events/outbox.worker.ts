import prisma from '../config/database';
import { logger } from '../utils/logger';
import { DurableEventConsumerRegistry } from './consumer-registry';
import { mapOutboxRecord } from './outbox.repository';
import { setOutboxWakeListener } from './outbox-wake';
import { runWithContext, getRequestContext } from '../gateway/api-gateway/context';
import type { DurableEventType } from './contracts';

/** 出库行类型：从 findMany 返回值推导，随 schema 单一真相源演进，不手抄字段。 */
type OutboxRow = Awaited<ReturnType<typeof prisma.domain_event_outbox.findMany>>[number];

/** 兜底轮询区间（架构优化批 #5）：空闲指数退避 1s→30s；入队唤醒/有产出时复位到下限 */
const POLL_MIN_MS = 1000;
const POLL_MAX_MS = 30_000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/**
 * 需要「同用户队头保护」的事件类型。
 *
 * 学习者线对顺序敏感：快照刷新按 `lastEventId` 幂等、证据按累加投影，若同一用户的后一个事件
 * 先于前一个事件被消费，旧事件回填会覆盖新状态（画像回退）。此前只有 `task:completed` 有这层保护，
 * `lesson:completed` / `path:*` / `goal:understanding:updated` 都没有——同一用户连上两节课时，
 * 前一课若退避重投，后一课会被提前消费。
 *
 * #145：这里**刻意不含** `lesson:knowledge-enrichment`——课后增强是一次 10–20s 的 LLM 调用，
 * 它的失败不该让该用户的后续学习者线事件一起排队等退避（有序保护只约束「顺序敏感的投影/刷新」，
 * 增强是旁路产物，由独立泳道按自己的尝试计数重试）。
 */
const ORDERED_EVENT_TYPES = new Set([
  'task:completed',
  'lesson:completed',
  'goal:understanding:updated',
  'path:created',
  'path:generated',
  'path:adjusted',
  'path:completed'
]);

/**
 * 单条 worker 实例的取数/处理选项（#144）。
 *
 * 一个进程里可以并存多条泳道（各自是独立的 worker 实例、各自持锁轮询）：
 * - 主泳道：串行（concurrency=1），承载学习者线等有序事件，队头保护语义不变；
 * - 增强泳道：只拾取 `lesson:knowledge-enrichment`，并发执行 LLM，不占主泳道的批处理时间。
 *
 * 互斥：`includeEventTypes` / `excludeEventTypes` 只用于**划分**泳道，避免两条泳道抢同一行。
 */
export interface DurableOutboxWorkerOptions {
  /** 只拾取这些事件类型（缺省 = 全部） */
  includeEventTypes?: ReadonlySet<DurableEventType>;
  /** 排除这些事件类型（缺省 = 不排除） */
  excludeEventTypes?: ReadonlySet<DurableEventType>;
  /**
   * 批内并发度（缺省 1 = 串行，保持原有批内顺序与队头语义）。
   * >1 只允许用在**不含** `ORDERED_EVENT_TYPES` 的泳道上（构造期校验）。
   */
  concurrency?: number;
  /** 是否自行注册入队唤醒（缺省 true；作为从泳道时由主泳道统一转发唤醒） */
  ownsWakeListener?: boolean;
}

export class DurableOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private started = false;
  private stopping = false;
  private inFlight: Promise<void> | null = null;
  private nextDelayMs = POLL_MIN_MS;
  private lastTickProductive = false;
  private readonly owner = process.env.INSTANCE_ID || `outbox-${process.pid}`;
  private readonly eventTypeFilter: { in: string[] } | { notIn: string[] } | null;
  private readonly concurrency: number;
  private readonly ownsWakeListener: boolean;
  /** 同一进程内的从泳道：主泳道负责把入队唤醒转发给它，关闭时一并停掉 */
  private readonly secondaries: DurableOutboxWorker[] = [];

  constructor(
    private readonly registry: DurableEventConsumerRegistry,
    options: DurableOutboxWorkerOptions = {}
  ) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`outbox worker concurrency 必须是正整数，收到 ${concurrency}`);
    }
    if (concurrency > 1 && options.includeEventTypes) {
      const ordered = [...options.includeEventTypes].filter((type) => ORDERED_EVENT_TYPES.has(type));
      if (ordered.length > 0) {
        // 并发泳道不实现「同用户只放行队首」：有序事件必须留在串行主泳道。
        throw new Error(`outbox worker 并发泳道不得承载有序事件类型：${ordered.join(', ')}`);
      }
    }
    this.concurrency = concurrency;
    this.ownsWakeListener = options.ownsWakeListener !== false;
    this.eventTypeFilter = options.includeEventTypes
      ? { in: [...options.includeEventTypes] }
      : options.excludeEventTypes
        ? { notIn: [...options.excludeEventTypes] }
        : null;
  }

  /**
   * 挂一条从泳道：主泳道 start/stop 时一并驱动（唤醒也由主泳道转发）。
   * 若主泳道已在运行（attachSecondary 允许在 start 之后调用），补挂的从泳道立即启动。
   */
  attachSecondary(worker: DurableOutboxWorker): void {
    this.secondaries.push(worker);
    if (this.started && !this.stopping) worker.start();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.nextDelayMs = POLL_MIN_MS;
    // 入队侧唤醒（outbox-wake）：tick 已在跑则跳过本轮（互斥闸兜底），并把退避复位到下限
    if (this.ownsWakeListener) {
      setOutboxWakeListener(() => {
        this.wake();
        for (const secondary of this.secondaries) secondary.wake();
      });
    }
    // #146 收尾：从泳道必须有自己的定时器轮询，不能只靠主泳道转发的入队 wake()——
    // 增强泳道失败后只把 availableAt 推到未来（dispatchAndSettle 的退避重投），
    // 若从泳道没有自身轮询，就没有任何 tick 会来重拾这行：它会长期停在 pending，
    // 既走不到 8 次尝试后的死信分支，也不会出现在 /api/admin/devtools/outbox/dead。
    for (const secondary of this.secondaries) secondary.start();
    // 首轮同步启动（保持旧行为：start 后立即消费一次，不等第一个间隔）
    void this.runTickSafely().finally(() => this.scheduleNext());
  }

  /** 入队唤醒（主泳道转发给从泳道）：把退避拍回下限并立刻跑一轮 */
  wake(): void {
    if (this.stopping) return;
    this.nextDelayMs = POLL_MIN_MS;
    void this.runTickSafely();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopping = true;
    if (this.ownsWakeListener) setOutboxWakeListener(null);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await Promise.all([this.inFlight, ...this.secondaries.map((secondary) => secondary.stop())]);
  }

  /** 自适应调度：空闲翻倍（封顶 POLL_MAX_MS），有产出（claimed>0）复位到下限 */
  private scheduleNext(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runTickSafely().finally(() => this.scheduleNext());
    }, this.nextDelayMs);
    this.timer.unref?.();
  }

  /** 供测试/运维直接驱动一轮 */
  async runOnce(): Promise<void> {
    await this.runDetachedFromRequest(() => this.tick());
  }

  /**
   * 与「触发入队的那个请求」脱钩后再跑本轮消费。
   *
   * 2026-11-01 实测：`notifyOutboxActivity` 的防抖定时器**继承入队方的 ALS 上下文**，
   * 于是被唤醒的后台消费带着那次 HTTP 请求的 `abortSignal`（`acp-context.middleware` 把
   * `res.once('close')` 绑到了它上面）。结课响应一关闭，信号即中止，消费链里的技能调用
   * 在 `executor` 入口就被判 `CALLER_ABORTED`——两节课各出现一次
   * `[outbox] 持久事件消费者失败（Skill execution aborted by caller）`，
   * 只能靠退避重投补上（课后知识增强因此晚一轮落地）。
   *
   * 后台消费的寿命不该绑在某个请求上：保留身份字段（userId / sourceEntry / traceId，
   * 执行日志仍能归因），只摘掉 abortSignal；上下文用拷贝，避免回写污染原请求的 store。
   */
  private runDetachedFromRequest<T>(fn: () => Promise<T>): Promise<T> {
    const inherited = getRequestContext();
    if (!inherited.abortSignal) return fn();
    const { abortSignal: _detached, ...rest } = inherited;
    void _detached;
    return runWithContext(rest, fn);
  }

  private async runTickSafely(): Promise<void> {
    try {
      await this.runDetachedFromRequest(() => this.tick());
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
      // 自适应退避：本轮拾取到事件 → 复位下限（队列可能还有）；空转 → 翻倍封顶 30s。
      // 唤醒路径（outbox-wake）也会把 nextDelayMs 拍回下限——即使唤醒先于事务提交扑空，
      // 兜底 tick 仍在 1s 内到达（与旧固定轮询同量级）。
      this.nextDelayMs = this.lastTickProductive
        ? POLL_MIN_MS
        : Math.min(POLL_MAX_MS, this.nextDelayMs * 2);
    }
  }

  /**
   * 拾取门（#106②，2026-10-19 拆列后）——可拾取 = 三条同时成立：
   *
   *   1. `availableAt <= now`：技术可用（入队即当时刻；失败重投 = 退避到期）；
   *   2. `scheduledAt IS NULL OR scheduledAt <= now`：业务排期（NULL = 无排期立即可用；
   *      模拟日历按未来模拟日写入的事件在这里被延后）；
   *   3. `status='pending'` 或 `status='processing'` 且锁已过期（崩溃/卡死回收）。
   *
   * 为什么是两条时间门而不是只看 scheduledAt：退避重投的行排期是 NULL，必须靠 availableAt 挡住；
   * 为什么不是只看 availableAt（旧门）：旧实现的 availableAt 直抄 occurredAt，「发生时间」被当成了
   * 「排期」——occurredAt 语义一变（模拟日历/迟到事件）排期就静默跟着变。
   *
   * 存量等价性：迁移已把未决未来行的原可用时刻回填到 scheduledAt（保留原排期），其余行 NULL；
   * 因此对迁移前写入的所有行，本门与旧门 `availableAt <= now` 逐一等价。
   */
  private async processBatch(): Promise<void> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - LOCK_TIMEOUT_MS);
    this.lastTickProductive = false;
    const records = await prisma.domain_event_outbox.findMany({
      where: {
        availableAt: { lte: now },
        AND: [
          { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }
        ],
        OR: [
          { status: 'pending' },
          { status: 'processing', lockedAt: { lte: staleLock } }
        ],
        // 泳道划分（#144）：主泳道排除增强事件，增强泳道只拾取增强事件——两条泳道不抢同一行。
        ...(this.eventTypeFilter ? { eventType: this.eventTypeFilter } : {})
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 20
    });

    if (this.concurrency <= 1) {
      // 串行主泳道：claim 与 dispatch 逐条交替，批内顺序与队头语义与旧实现逐行一致。
      const orderedUsersSeen = new Set<string>();
      for (const record of records) {
        if (this.stopping) return;
        if (!(await this.passesSameUserHeadGate(record, orderedUsersSeen))) continue;
        if (!(await this.claim(record, staleLock))) continue;
        this.lastTickProductive = true;
        await this.dispatchAndSettle(record);
      }
      return;
    }

    // 并发泳道（仅限不含有序事件的类型，构造期已校验）：先整批 claim，再用并发池跑 LLM，
    // 让「第 N 个用户的课后增强」不必等前面 N-1 个 LLM 跑完。
    const claimed: OutboxRow[] = [];
    for (const record of records) {
      if (this.stopping) break;
      if (!(await this.claim(record, staleLock))) continue;
      this.lastTickProductive = true;
      claimed.push(record);
    }
    let cursor = 0;
    const laneCount = Math.min(this.concurrency, claimed.length);
    await Promise.all(Array.from({ length: laneCount }, async () => {
      while (!this.stopping) {
        const index = cursor;
        cursor += 1;
        if (index >= claimed.length) return;
        await this.dispatchAndSettle(claimed[index]);
      }
    }));
  }

  /**
   * 同用户队头保护：同一用户只放行**最老的那条未终结**有序事件。
   *
   * 只对主泳道的串行路径生效（并发泳道不得承载有序事件）。学习者线对顺序敏感：
   * 快照刷新按 `lastEventId` 幂等回写，后到事件若先消费，会用更旧的事件回填画像。
   */
  private async passesSameUserHeadGate(record: OutboxRow, orderedUsersSeen: Set<string>): Promise<boolean> {
    if (!ORDERED_EVENT_TYPES.has(record.eventType) || !record.userId) return true;
    // 同用户只放行队首——**跨类型也算序**（18 号报告 N7）：学习者的快照刷新按 `lastEventId`
    // 幂等回写，若「后到的 task:completed」先于「更早的 lesson:completed」消费，
    // 会用更旧的事件回填画像。此前按 `eventType:userId` 分键，跨类型仍可乱序。
    if (orderedUsersSeen.has(record.userId)) return false;
    orderedUsersSeen.add(record.userId);
    const oldestUnresolved = await prisma.domain_event_outbox.findFirst({
      where: {
        userId: record.userId,
        eventType: { in: [...ORDERED_EVENT_TYPES] },
        status: { in: ['pending', 'processing'] }
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true }
    });
    return oldestUnresolved?.id === record.id;
  }

  /** 抢锁：只有把这一行从 pending（或锁过期的 processing）推进到 processing 成功的 worker 才有权消费 */
  private async claim(record: OutboxRow, staleLock: Date): Promise<boolean> {
    const claimed = await prisma.domain_event_outbox.updateMany({
      where: {
        id: record.id,
        OR: [
          { status: 'pending' },
          { status: 'processing', lockedAt: { lte: staleLock } }
        ]
      },
      data: { status: 'processing', lockedAt: new Date(), lockOwner: this.owner }
    });
    return claimed.count === 1;
  }

  /** 消费一条已抢到锁的事件，落 published；失败按既有退避/死信策略回写 */
  private async dispatchAndSettle(record: OutboxRow): Promise<void> {
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
      // 所有事件类型统一在 MAX_ATTEMPTS 后入死信（含 task:completed）：
      // 原豁免会让一条毒事件永久阻塞同用户后续所有 task:completed（队头无限重试）。
      // 死信不再是终点——可通过 POST /api/admin/devtools/outbox/requeue-dead 重放。
      const dead = attemptCount >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60_000, 1000 * 2 ** Math.min(attemptCount, 6));
      await prisma.domain_event_outbox.updateMany({
        where: { id: record.id, status: 'processing', lockOwner: this.owner },
        data: {
          status: dead ? 'dead' : 'pending',
          attemptCount,
          // 重试只后移技术门；scheduledAt（业务排期）不动——能走到这里说明排期已过，且排期约束
          // 不受消费失败影响（#106②）。
          availableAt: new Date(Date.now() + backoffMs),
          lockedAt: null,
          lockOwner: null,
          lastError: error instanceof Error ? error.message : String(error)
        }
      });
      if (dead) {
        // 死信是运维必须介入的终态：用 error 级别，便于日志告警规则直接命中。
        logger.error('[outbox] 持久事件进入死信，需人工处理', {
          eventId: record.id,
          eventType: record.eventType,
          userId: record.userId,
          attemptCount,
          lastError: error instanceof Error ? error.message : String(error),
        });
      } else {
        logger.warn('持久事件消费失败', { eventId: record.id, eventType: record.eventType, attemptCount, dead });
      }
    }
  }
}

/**
 * 死信根因分类（重放闸门）：已知「重放只会再烧 8 次」的毒丸，必须先修数据/代码。
 * 目前覆盖 FSRS 非法状态（Invalid memory state / difficulty / stability 越界）。
 */
export function classifyDeadLetterRootCause(lastError: string | null | undefined): string | null {
  const message = typeof lastError === 'string' ? lastError.trim() : '';
  if (!message) return null;
  if (/invalid memory state/i.test(message)) return 'INVALID_FSRS_STATE';
  if (/(difficulty|stability)/i.test(message) && /(out of range|invalid|must be|非法|越界)/i.test(message)) {
    return 'INVALID_FSRS_STATE';
  }
  return null;
}

/**
 * 死信清单（运维查看）：count + 最近 50 条 dead 行（occurredAt 升序）。
 * 供 GET /api/admin/devtools/outbox/dead 消费；DB 访问从 routes 收敛到本模块。
 */
export async function getDeadOutboxSummary() {
  const deadCount = await prisma.domain_event_outbox.count({ where: { status: 'dead' } });
  const rows = await prisma.domain_event_outbox.findMany({
    where: { status: 'dead' },
    orderBy: [{ occurredAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      eventType: true,
      userId: true,
      aggregateId: true,
      attemptCount: true,
      lastError: true,
      occurredAt: true
    }
  });
  const items = rows.map((row) => {
    const rootCause = classifyDeadLetterRootCause(row.lastError);
    return {
      ...row,
      rootCause,
      blocked: rootCause !== null,
    };
  });
  return { deadCount, items };
}

/**
 * 死信重置：dead → pending，清零尝试计数并清技术门（availableAt=now）。
 * 背景：dead 是无出口终态（worker 不会再拾取），此前没有任何管理手段把
 * 修复后的死信重新入队。运维修复根因后调用本函数重放。
 *
 * 根因闸门（2026-10-22 审计 P1-5）：若死信带已知毒丸根因（如非法 FSRS 状态），
 * 默认拒绝重放（否则再烧 8 次回死信）；运维确认根因已修复后用 force=true 放行。
 *
 * #106②：`scheduledAt`（业务排期）刻意不清——排期是业务约束，不由运维重放解除；
 * 且死信只可能产生于「已被拾取过 8 次」的行，其排期早已到点，当前行为不受影响。
 */
export async function requeueDeadOutboxEvents(
  eventType?: string,
  options: { force?: boolean } = {}
): Promise<number> {
  if (!options.force) {
    const blocked = await prisma.domain_event_outbox.findMany({
      where: {
        status: 'dead',
        ...(eventType ? { eventType } : {}),
        lastError: { not: null },
      },
      select: { id: true, lastError: true },
    });
    const poisoned = blocked.filter((row) => classifyDeadLetterRootCause(row.lastError) !== null);
    if (poisoned.length > 0) {
      const error = new Error(
        `存在 ${poisoned.length} 条已知根因死信（如非法 FSRS 状态），重放会再次进入死信；先修复根因，或确认后使用 force=true`
      );
      (error as Error & { code?: string }).code = 'OUTBOX_DEAD_LETTER_ROOT_CAUSE';
      throw error;
    }
  }

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
    logger.info('[outbox] 死信已重新入队', { requeued: result.count, eventType: eventType || 'all', force: options.force === true });
  }
  return result.count;
}
