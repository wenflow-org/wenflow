import prisma from '../../config/database';
import { learnerSnapshotService } from './LearnerSnapshotService';
import { buildNonVirtualUserWhere, isTestAccountUser } from '../../utils/test-account';
import type { LearnerSnapshot } from '../../agents/learner-model-agent/types';

/**
 * 内存快照缓存条数上限（#176-2）。
 *
 * 此前只有 5 分钟 TTL，**没有容量上限、没有失效入口**：每个 (user, scope, path,
 * milestone, task) 组合都留下一条，删除只发生在「同 key 过期」和列表分支的顺带清理，
 * 长跑进程里只增不减。这里按 LRU 封顶。
 *
 * TODO(#176-2)：具体条数属容量口径（单条快照 payload 数十 KB），待产品确认；
 * 当前取 1000，约与列表窗口上限（2000）同量级、避免一次整页预热把自己全淘汰。
 */
export const LEARNER_SNAPSHOT_CACHE_MAX_ENTRIES = 1000;

export interface LearnerSnapshotRefreshInput {
  userId: string;
  pathId?: string;
  milestoneId?: string;
  taskId?: string;
  scope?: 'global' | 'path' | 'teaching';
  lastEventId?: string;
  lastEventAt?: Date;
}

export class LearnerSnapshotRefreshService {
  private cache = new Map<string, { snapshot: LearnerSnapshot; cachedAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  /** 列表路径可接受的投影陈旧度：60 分钟（2026-10-04，原 10 分钟在 500 窗口下每页加载都全量重建） */
  private static readonly LIST_PROJECTION_FRESH_MS = 60 * 60 * 1000;

  /** 缓存键前缀（buildKey 的第 0 段），invalidate 按 `前缀 + userId + ':'` 精确匹配用户 */
  private static readonly CACHE_KEY_PREFIX = 'learner-snapshot-v1';

  /**
   * 失效水位（#176-2 复核）：`userId → invalidate 时刻`。**早于该时刻落地**的快照一律不许再被读出——
   * 无论它躺在内存缓存里，还是躺在 `learner_projections` 的持久化窗口里。
   *
   * 只删内存键是不够的（复核实测）：`getLatest` 在内存未命中后会回落到持久化投影的 10 分钟窗口，
   * 把那行**由旧画像算出**的载荷重新读出并写回内存，于是「主动失效」在最要紧的场景里近乎空转——
   * `learner-model-agent/index.ts:196-197` 的 `updateProfile` 清了画像 + 图快照，**并没有**接着 refresh
   * 任何键；此后任意读路径（`TeachingContextBuilder.ts:74`、`admin/learner-models.ts:76,141`）拿到的
   * 仍是旧画像拼出的快照，最长 10 分钟。
   *
   * 事件驱动的那几处（`learner-event-consumer.ts:54`、`schedulers.ts:97`、`LessonKnowledgeEnrichmentConsumer.ts:52`）
   * 是「invalidate + 只 refresh 一个键」，同一用户其它作用域键（path / teaching / global）同样只剩这条水位兜着。
   *
   * 仅在进程内维护：与内存缓存同生命周期（重启后两者一起丢，不存在「内存没了但水位还在」的错配）。
   */
  private invalidatedAt = new Map<string, number>();
  /** 水位表的用户数上限：只记住最近失效的用户，避免长跑进程里只增不减（与缓存同口径） */
  private static readonly INVALIDATION_MAX_USERS = 2000;

  /**
   * 该时刻落地的快照是否已失效（严格早于水位）。
   * 用 `<` 而非 `<=`：invalidate 与随后的 refresh 可能落在同一毫秒，那不是「失效前落地的」。
   */
  private isInvalidated(userId: string, at: number): boolean {
    const mark = this.invalidatedAt.get(userId);
    return mark !== undefined && at < mark;
  }

  /** LRU 读：命中即移到队尾（Map 保持插入序，淘汰从队首取最久未用） */
  private cacheGet(key: string): { snapshot: LearnerSnapshot; cachedAt: number } | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  /** LRU 写：超出条数上限时淘汰队首（最久未用） */
  private cacheSet(key: string, snapshot: LearnerSnapshot): void {
    this.cache.delete(key);
    this.cache.set(key, { snapshot, cachedAt: Date.now() });
    while (this.cache.size > LEARNER_SNAPSHOT_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /**
   * 主动失效（#176-2）：画像/证据变化后清掉该用户的**所有作用域**缓存键，并抬高失效水位，
   * 让持久化投影里那行旧载荷也读不出来。此前只能等 5 分钟 TTL 或读路径自愈，调用方
   * （learnerProfileService.clear 的调用点）清了画像缓存却留着由旧画像算出的快照。
   */
  invalidate(userId?: string): void {
    const mark = Date.now();
    if (!userId) {
      this.cache.clear();
      this.invalidatedAt.clear();
      return;
    }
    const prefix = `${LearnerSnapshotRefreshService.CACHE_KEY_PREFIX}:${userId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    this.invalidatedAt.delete(userId);
    this.invalidatedAt.set(userId, mark);
    while (this.invalidatedAt.size > LearnerSnapshotRefreshService.INVALIDATION_MAX_USERS) {
      const oldest = this.invalidatedAt.keys().next().value;
      if (oldest === undefined) break;
      this.invalidatedAt.delete(oldest);
    }
  }

  async refresh(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    if (input.lastEventId) {
      const existing = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
      // 去重按事件 id 比对，但**画像类变更不产生事件 id**：invalidate 之后同一 lastEventId 的那行
      // 载荷仍是旧画像算出来的，不能再短路返回（否则 refresh 也读回陈旧值）。
      const dedupable = existing !== null && !this.isInvalidated(input.userId, existing.generatedAt.getTime());
      if (dedupable && existing.lastEventId === input.lastEventId) {
        try {
          const snapshot = JSON.parse(existing.payload) as LearnerSnapshot;
          this.cacheSet(key, snapshot);
          return snapshot;
        } catch {
          // Rebuild malformed projections from source facts.
        }
      }
    }

    const snapshot = await learnerSnapshotService.getSnapshot({
      userId: input.userId,
      learningPathId: input.pathId,
      milestoneId: input.milestoneId,
      taskId: input.taskId,
      mode: input.scope,
    });

    await prisma.learner_projections.upsert({
      where: { projectionKey: key },
      create: {
        id: `lsp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: key,
        userId: input.userId,
        scope: input.scope || snapshot.scope.mode,
        pathId: input.pathId || null,
        milestoneId: input.milestoneId || null,
        taskId: input.taskId || null,
        version: 1,
        payload: JSON.stringify(snapshot),
        lastEventId: input.lastEventId || null,
        lastEventAt: input.lastEventAt || null,
        generatedAt: new Date(snapshot.freshness.generatedAt)
      },
      update: {
        version: { increment: 1 },
        payload: JSON.stringify(snapshot),
        lastEventId: input.lastEventId || undefined,
        lastEventAt: input.lastEventAt || undefined,
        generatedAt: new Date(snapshot.freshness.generatedAt)
      }
    });
    this.cacheSet(key, snapshot);
    return snapshot;
  }

  async getLatest(input: LearnerSnapshotRefreshInput): Promise<LearnerSnapshot> {
    const key = this.buildKey(input);
    const entry = this.cacheGet(key);
    // 失效水位：#176-2 复核抓到的空转——只删内存键时，下面那段持久化回落会把旧载荷读回来并重新入缓存。
    if (
      entry &&
      Date.now() - entry.cachedAt < LearnerSnapshotRefreshService.CACHE_TTL_MS &&
      !this.isInvalidated(input.userId, entry.cachedAt)
    ) {
      return entry.snapshot;
    }
    this.cache.delete(key);
    const persisted = await prisma.learner_projections.findUnique({ where: { projectionKey: key } });
    if (
      persisted &&
      Date.now() - persisted.generatedAt.getTime() < 10 * 60 * 1000 &&
      !this.isInvalidated(input.userId, persisted.generatedAt.getTime())
    ) {
      try {
        const snapshot = JSON.parse(persisted.payload) as LearnerSnapshot;
        this.cacheSet(key, snapshot);
        return snapshot;
      } catch {
        // Rebuild malformed projections from source facts.
      }
    }
    return this.refresh(input);
  }

  async listForAdmin(params?: {
    userId?: string;
    pathId?: string;
    staleOnly?: boolean;
    riskOnly?: boolean;
    /** 按 id 直查虚拟账号时置 true（学习者详情），不是页面视角 */
    includeTest?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params?.page || 1));
    // 窗口上限 500 → 2000（2026-10-10 用户反馈「有多少加载多少」：842 个账号被 500 截成两半，
    // 管理端搜索/翻页够不到后一半）。默认仍 20，天花板防滥用；冷缓存整页重建量大，
    // 配套 stillMissing 分批消费的既有机制不变。
    const limit = Math.max(1, Math.min(2000, Number(params?.limit || 20)));

    // 软删用户不进入管理端快照列表（列表与总数口径一致）。
    // 默认 = 全部非虚拟账号（2026-10-21 拍板：测试账号只是行内备注）；
    // includeTest=true 是按 id 直查虚拟账号（学习者详情），不删数据只改默认视图。
    // 2026-10-31 外部评审 P2-7：纯管理员账号（isAdmin）不是学习主体，不该出现在
    // 学习状态列表里、更不该对「未开始」的管理员发学习提醒——默认视图排除；
    // includeTest 按 id 直查不受影响（学习者详情仍可打开任何账号）。
    const userWhere = {
      ...(params?.includeTest
        ? { deletedAt: null }
        : { ...(await buildNonVirtualUserWhere({ deletedAt: null })), isAdmin: false }),
      ...(params?.userId ? { id: params.userId } : {}),
    };
    const total = await prisma.users.count({ where: userWhere });

    const users = await prisma.users.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        /** 审核 #11：身份标记要与 Users.vue 同源——虚拟学习者（紫「虚拟」）与测试账号
            （琥珀「测试」）是两类人；isTestAccountUser 对 /^virtual_/ 也返回 true，
            只靠它会把虚拟学习者渲染成「测试账号」。 */
        isVirtualLearner: true,
        /* 列表的「当前进度」列只展示一条路径（take: 1，按 updatedAt 取最近更新的活跃路径）。
           2026-11-01 外部评审 P1：多路径学员在这里只看到其中一条，而同一屏的「学习路径」列表
           显示他有 2 条在学——读者会以为丢数据。这里同时取活跃路径**总数**，
           前端在有第二条时给出「共 N 条路径学习中」的角标，把「这是其中一条」说清楚。 */
        _count: {
          select: { learning_paths: { where: { status: 'active' } } },
        },
        learning_paths: {
          // 锚点路径：行的快照口径只认 active（非 active 会被伪造成 currentPath，#205）。
          // 「有路径但无 active」时的路径身份（pathTitle）由下方 fallbackTitleByUser 单独补——
          // 不靠放宽这里的 where + take N（那会让更新的归档路径把 active 挤出窗口，静默降级为 global）。
          where: params?.pathId ? { id: params.pathId } : { status: 'active' },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // #205：无 active 路径的用户，行内「路径」此前恒空（active-only 过滤）。这里单独取一次「最近的非
    // abandoned 路径」仅用于展示身份，不参与快照锚定。独立取值（而非放宽上面的嵌套 where）保证不会
    // 漏掉 active 路径，也把「身份」与「锚点」两件事分开。
    const usersWithoutPath = users.filter((user) => user.learning_paths.length === 0).map((user) => user.id);
    const fallbackTitleByUser = new Map<string, string>();
    if (usersWithoutPath.length > 0) {
      const fallbackPaths = await prisma.learning_paths.findMany({
        where: { userId: { in: usersWithoutPath }, status: { not: 'abandoned' } },
        orderBy: { updatedAt: 'desc' },
        select: { userId: true, title: true },
      });
      for (const row of fallbackPaths) {
        if (row.title && !fallbackTitleByUser.has(row.userId)) fallbackTitleByUser.set(row.userId, row.title);
      }
    }

    // 批量取快照：先命中模块缓存，再按 projectionKey in [...] 批量读 learner_projections，
    // 避免每用户逐个 getLatest 重建（原实现每页 100 用户 ≈1300+ 查询）。
    const entries = Array.from(users, (user) => {
      // 快照锚点只认 status='active' 的路径（含调用方显式 pathId——非 active 会被伪造成 currentPath，
      // #205）；无 active 路径时走 global 口径，路径身份仅由 fallbackTitleByUser 补展示。
      const path = user.learning_paths[0] || null;
      const anchored = path?.status === 'active' ? path : null;
      return {
        user,
        path,
        anchored,
        key: this.buildKey({
          userId: user.id,
          pathId: anchored?.id,
          scope: anchored?.id ? 'path' : 'global',
        }),
      };
    });

    const snapshotsByUser = new Map<string, LearnerSnapshot>();
    const refreshQueue: typeof entries = [];

    for (const entry of entries) {
      const cached = this.cacheGet(entry.key);
      if (cached && Date.now() - cached.cachedAt < LearnerSnapshotRefreshService.CACHE_TTL_MS) {
        snapshotsByUser.set(entry.user.id, cached.snapshot);
      } else {
        if (cached) this.cache.delete(entry.key);
        refreshQueue.push(entry);
      }
    }

    if (refreshQueue.length > 0) {
      // 列表路径的投影保鲜窗 60 分钟（2026-10-04）：原 10 分钟导致解锁 500 窗口后
      // 每次页面加载都触发数百人全量重建（实测把 agents/logs 挤过 30s 超时 → 壳层判死全域空）。
      // 列表消费的是趋势/疲劳/置信度这类缓变信号，60 分钟陈旧度可接受；重建仍只针对真缺失。
      const persisted = await prisma.learner_projections.findMany({
        where: {
          projectionKey: { in: refreshQueue.map((entry) => entry.key) },
          generatedAt: { gte: new Date(Date.now() - LearnerSnapshotRefreshService.LIST_PROJECTION_FRESH_MS) },
        },
        select: { projectionKey: true, payload: true },
      });
      const rowByKey = new Map(persisted.map((row) => [row.projectionKey, row]));
      const stillMissing: typeof entries = [];
      for (const entry of refreshQueue) {
        const row = rowByKey.get(entry.key);
        if (row) {
          try {
            const snapshot = JSON.parse(row.payload) as LearnerSnapshot;
            this.cacheSet(entry.key, snapshot);
            snapshotsByUser.set(entry.user.id, snapshot);
            continue;
          } catch {
            // 投影损坏：按未命中处理，走重建。
          }
        }
        stillMissing.push(entry);
      }
      // 仅未命中（缓存过期且无新鲜投影）才重建。
      // 分批消费（16/批）：窗口解锁到 500 后冷缓存一页可达数百人，无界 Promise.all 会让
      // 每人一次的快照构建 + 投影 upsert 同刻轰 SQLite 单写锁（busy/内存双险）。
      if (stillMissing.length > 0) {
        const REBUILD_CHUNK = 16;
        for (let i = 0; i < stillMissing.length; i += REBUILD_CHUNK) {
          await Promise.all(stillMissing.slice(i, i + REBUILD_CHUNK).map(async (entry) => {
            const snapshot = await this.refresh({
              userId: entry.user.id,
              pathId: entry.anchored?.id,
              scope: entry.anchored?.id ? 'path' : 'global',
            });
            snapshotsByUser.set(entry.user.id, snapshot);
          }));
        }
      }
    }

    const snapshots = entries.map(({ user, path, anchored }) => {
      const snapshot = snapshotsByUser.get(user.id);
      if (!snapshot) {
        throw new Error(`学习者快照构建失败: ${user.id}`);
      }
      /* 数据截至（2026-10-23 用户「怎么都是 37 分钟呢」）：
         generatedAt 是**本次快照重建**的时刻——列表页一次请求就会把过期投影整批重建，
         于是全表显示同一分钟，读起来像所有人都在同一刻学习过。运营要的是学习证据最后
         变化的时刻，取自 freshness.basedOn 里最新的那条；一条证据都没有（未开始学习）
         给 null，前端显示「—」，不拿重建时间冒充。 */
      const basedOnTimes = Object.values(snapshot.freshness?.basedOn || {})
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => new Date(value).getTime())
        .filter((time) => Number.isFinite(time));
      const dataUpdatedAt = basedOnTimes.length > 0
        ? new Date(Math.max(...basedOnTimes)).toISOString()
        : null;
      return {
        userId: user.id,
        userName: user.name,
        email: user.email,
        /** 虚拟学习者（审核 #11）：前端按 Users.vue 同款三元区分「虚拟 / 测试」两类身份 */
        isVirtualLearner: user.isVirtualLearner,
        /** 测试/虚拟账号标记（excludeTest 未开启时供前端灰标签展示；开启后恒为 false） */
        isTestAccount: isTestAccountUser(user),
        /** pathId 必须与行的快照口径键一致（前端重算带它，见 LearnerCenter.vue:390/741）：
            只认 active 锚点；无 active 路径时保持 null，避免重算写 path 键而本行读 global 键。 */
        pathId: anchored?.id || null,
        /** 路径身份展示（#205）：无 active 路径时回退到最近的非 abandoned 路径名，
            不再让「有路径但无 active」的用户显示空白路径。 */
        pathTitle: path?.title || fallbackTitleByUser.get(user.id) || null,
        /** 在学路径总数（列表列只展示其中最近更新的一条，>1 时前端标「共 N 条」） */
        activePathCount: user._count?.learning_paths ?? (path ? 1 : 0),
        /** 快照重建时刻（排查用；列表的「数据更新」列读 dataUpdatedAt） */
        generatedAt: snapshot.freshness.generatedAt,
        dataUpdatedAt,
        confidence: snapshot.freshness.confidence,
        recentTrend: snapshot.dynamicState.recentTrend,
        fatigueRisk: snapshot.dynamicState.fatigueRisk,
        currentMilestone: snapshot.knowledgeMemory.currentPath?.currentPosition.milestoneTitle || null,
        currentTask: snapshot.knowledgeMemory.currentPath?.currentPosition.taskTitle || null,
        masteredConcepts: snapshot.knowledgeMemory.globalSignals.masteredConcepts.slice(0, 5),
        fragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts.slice(0, 5),
        strugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts.slice(0, 5),
      };
    });

    const filtered = snapshots.filter((item) => {
      if (params?.staleOnly) {
        /* 陈旧判定读 dataUpdatedAt（学习证据最后变化时刻），不再读 generatedAt（#176-2）：
           列表一次请求会把过期投影整批重建，generatedAt 是**本次重建**时刻，于是
           「刚被重建过的老用户」看起来最新、被 staleOnly 过滤掉，而真正长期没学习的
           反而被藏在后面——正是这个筛选器要抓的人。
           dataUpdatedAt 为 null（无任何学习证据/未开始）视为**最陈旧**，不能被当成最新。 */
        const updatedAtMs = item.dataUpdatedAt ? new Date(item.dataUpdatedAt).getTime() : null;
        const isFresh = updatedAtMs !== null
          && Number.isFinite(updatedAtMs)
          && Date.now() - updatedAtMs < 10 * 60 * 1000;
        if (isFresh) return false;
      }
      if (params?.riskOnly) {
        if (item.fatigueRisk === 'low' && item.fragileConcepts.length === 0 && item.strugglingConcepts.length === 0) {
          return false;
        }
      }
      return true;
    });

    return {
      page,
      limit,
      total,
      items: filtered,
    };
  }

  /**
   * 目标/路径域证据时间线（learner-models 详情/证据端点）：
   * 按 evidenceType 白名单取最近 N 条，occurredAt 倒序。
   */
  async listDomainEvidence(userId: string, evidenceTypes: string[], take: number) {
    const rows = await prisma.learner_evidence.findMany({
      where: {
        userId,
        evidenceType: { in: evidenceTypes },
      },
      orderBy: { occurredAt: 'desc' },
      take,
      select: {
        id: true,
        evidenceType: true,
        confidence: true,
        occurredAt: true,
        pathId: true,
        taskId: true,
        sessionId: true,
        payload: true,
      },
    });
    /* 2026-11-01 外部评审 P1（学习动态读起来像重复事件）：learner_evidence 是幂等投影，
       但删 learning_paths 时不清它的历史行（只清会话软指针），于是**已删除路径**的事件
       仍留在时间线上——同一学员重生成过路径时，就会看到两条「路径创建 + 路径生成」，
       而且都没有可区分的信息。这里在读侧把指向已不存在路径的行滤掉（不删数据，
       保留排查余地）；没有 pathId 的行（目标域证据）不受影响。 */
    const pathIds = [...new Set(rows.map((r) => r.pathId).filter((id): id is string => !!id))];
    if (!pathIds.length) return rows;
    const alive = await prisma.learning_paths.findMany({
      where: { id: { in: pathIds } },
      select: { id: true },
    });
    const aliveSet = new Set(alive.map((p) => p.id));
    return rows.filter((r) => !r.pathId || aliveSet.has(r.pathId));
  }

  /** 目标用户是否虚拟学习者（learner-models 默认视图准入判断） */
  async isVirtualLearner(userId: string): Promise<boolean> {
    const target = await prisma.users.findUnique({
      where: { id: userId },
      select: { isVirtualLearner: true },
    });
    return !!target?.isVirtualLearner;
  }

  private buildKey(input: LearnerSnapshotRefreshInput) {
    return [
      'learner-snapshot-v1',
      input.userId,
      input.scope || (input.taskId ? 'teaching' : input.pathId ? 'path' : 'global'),
      input.pathId || 'global',
      input.milestoneId || 'none',
      input.taskId || 'none'
    ].join(':');
  }
}

export const learnerSnapshotRefreshService = new LearnerSnapshotRefreshService();
