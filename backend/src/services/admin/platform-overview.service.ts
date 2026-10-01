import prisma from '../../config/database';
import { hourKeyOf, startOfHour, dayKeyOf, addDaysToDayKey, startOfDay } from '../time/day-boundary';
import { REAL_USER_WHERE } from './real-user-where';
import { classifyFailureCategory, isTimeoutLog } from './failure-classification';

/**
 * 平台概览统计（GET /api/admin/overview/stats 的数据层）。
 * 由 routes/admin/platform.ts 下沉：computeOverviewStats 全量聚合 + 24h 脉搏分桶纯函数。
 */
export interface HourlyTrendBucket {
  time: string;
  label: string;
  total: number;
  error: number;
  timeout: number;
}

/**
 * 24h 脉搏全量聚合（P0-1：替代 take:50 抽样）。
 * 桶窗口与查询窗口同源：windowStart = 当前整点 - 23h，覆盖 [windowStart, now] 恰好 24 个整点桶，
 * 「总数 = 各小时之和」恒成立；窗口外（含未来时间戳）的日志一律不计入。
 * 所有键用本地时间生成，与查询 where（gte windowStart）对齐，避免抽样/错位导致的静默失真。
 */
export function buildHourlyTrend(
  logs: Array<{
    calledAt: Date | string;
    success: boolean;
    /** 7d 趋势行只取 calledAt+success（覆盖索引）；超时分类由失败行覆盖层完成，本字段可缺 */
    errorCode?: string | null;
    errorCategory?: string | null;
  }>,
  windowStart: Date,
  now: Date = new Date()
): HourlyTrendBucket[] {
  const hourKeys: string[] = [];
  const hourlyTrendMap: Record<string, { total: number; error: number; timeout: number }> = {};

  for (let i = 23; i >= 0; i -= 1) {
    // 小时桶按**应用时区**（day-boundary），不再用机器本地时区
    const d = new Date(startOfHour(now).getTime() - i * 3600000);
    const key = hourKeyOf(d);
    hourKeys.push(key);
    hourlyTrendMap[key] = { total: 0, error: 0, timeout: 0 };
  }

  for (const log of logs) {
    const d = new Date(log.calledAt);
    if (d.getTime() < windowStart.getTime() || d.getTime() > now.getTime()) continue;

    const key = hourKeyOf(d);
    if (!hourlyTrendMap[key]) continue;

    hourlyTrendMap[key].total += 1;
    if (!log.success) {
      if (isTimeoutLog(log)) {
        hourlyTrendMap[key].timeout += 1;
      } else {
        hourlyTrendMap[key].error += 1;
      }
    }
  }

  return hourKeys.map(key => {
    const [year, month, day, hour] = key.split('-').map(Number);
    const d = new Date(year, month - 1, day, hour);
    const point = hourlyTrendMap[key];
    return {
      time: d.toISOString(),
      label: `${String(hour).padStart(2, '0')}:00`,
      total: point.total,
      error: point.error,
      timeout: point.timeout
    };
  });
}

/* ===== 全量累计计数（长缓存子层） =====
 * agent_call_logs 的「全历史调用总数/成功率」是两个全表 groupBy（9 万行宽行扫描，实测各 ~550ms），
 * 而累计口径天然变化极慢。拆出 10 分钟 TTL 子缓存：60s 主缓存过期重算时不再每次付这两笔全表扫；
 * fresh=1（总览手动刷新）与进程重启照常绕过。 */
const ALL_TIME_CACHE_TTL_MS = 10 * 60 * 1000;
let allTimeCache: { payload: { total: number; success: number; totalAll: number }; cachedAt: number } | null = null;
let allTimeInflight: Promise<{ total: number; success: number; totalAll: number }> | null = null;

export function clearOverviewAllTimeCache(): void {
  allTimeCache = null;
  allTimeInflight = null;
}

async function computeAllTimeCallStats(realUserScope: { userId: { in: string[] } }, businessExecutionWhere: object, force = false): Promise<{ total: number; success: number; totalAll: number }> {
  if (!force && allTimeCache && Date.now() - allTimeCache.cachedAt < ALL_TIME_CACHE_TTL_MS) {
    return allTimeCache.payload;
  }
  if (allTimeInflight) return allTimeInflight;
  const computation = (async () => {
    const [realGroups, allGroups] = await Promise.all([
      // Agent 调用统计（真实用户口径：按 userId 归属过滤）
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: { ...businessExecutionWhere, ...realUserScope },
        _count: true,
      }),
      // Agent 调用统计全量（含虚拟/测试账号与孤儿行，前端副口径标注）
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: businessExecutionWhere,
        _count: true,
      }),
    ]);
    return {
      total: realGroups.reduce((sum, s) => sum + s._count, 0),
      success: realGroups.find((s) => s.success === true)?._count || 0,
      totalAll: allGroups.reduce((sum, s) => sum + s._count, 0),
    };
  })();
  allTimeInflight = computation;
  try {
    const payload = await computation;
    allTimeCache = { payload, cachedAt: Date.now() };
    return payload;
  } finally {
    if (allTimeInflight === computation) allTimeInflight = null;
  }
}

export async function computeOverviewStats(force = false): Promise<unknown> {
    // 获取今日统计（**应用时区本地日**，与学习侧日界同口径）
    const today = startOfDay(new Date());
    const tomorrow = new Date(today.getTime() + 86400000);
    const nowTs = Date.now();
    const sevenDaysAgo = new Date(nowTs - 7 * 86400000);
    const rolling24hStart = new Date(nowTs - 24 * 3600000);

    // 脉搏窗口与桶窗口同源：当前整点 - 23h（[start, now] 恰好 24 个整点桶），
    // 保证「24h 总数 = 各小时之和」恒成立；活跃 Agent 统计仍用严格 24h 滚动窗口。
    const trendWindowStart = new Date(startOfHour(new Date()).getTime() - 23 * 3600000);

    const businessExecutionWhere = {
      OR: [
        { executionLayer: null },
        { executionLayer: { not: 'api-gateway' } }
      ]
    };
    // 生产统计排除虚拟学习者与测试/审计账号：见模块级 REAL_USER_WHERE

    // 调用/token 口径（R5）：agent_call_logs / llm_execution_attempts 按 userId 归属过滤，
    // 只统计真实用户（虚拟/测试账号 userId 不在集合内 → 自动剔除；空 userId 孤儿行同样剔除）。
    // 全量口径保留为 *All 副指标，前端标注「含虚拟/测试」，保证诚实展示且可对比。
    // 性能批 2026-10-01：扫描合并后 real/virtual 分桶改端内 Set 判定（行级单扫无法带 SQL in 过滤）
    const realUserSet = new Set(
      (await prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } })).map((u) => u.id)
    );
    // 虚拟/测试账号 = 全部用户 − 真实用户（差集互补，口径严格无遗漏），供「虚拟调用」独立指标；
    // userId 为 NULL 的孤儿行不落入任何口径的「今日虚拟」计数（与原 SQL in 语义一致）
    const virtualUserSet = new Set(
      (await prisma.users.findMany({ select: { id: true } })).map((u) => u.id).filter((id) => !realUserSet.has(id))
    );

    // 并行查询所有统计数据。
    // 性能批 2026-10-01：原 11 次 agent_call_logs 查询（今日 5 count + 24h groupBy + 7d 双 groupBy
    // + 失败行/趋势行两次 findMany + skill groupBy）与 3 次 llm_execution_attempts 查询
    // （双 aggregate + models groupBy）各合并为**一次 7d 窗口行级拉取**，real/virtual/All 口径
    // 全部端内 Set 分桶聚合——实测重算 21-26s 的主要构成就是这 14 次重复窗口扫描。
    const [
      totalUsers,
      newUsersToday,
      activeUsersToday,
      totalPaths,
      failedPaths,
      activePaths,
      totalTasks,
      completedTasks,
      totalConversations,
      completedConversations,
      activeConversations,
      allTimeStats,
      agentScan7d,
      llmScan7d,
      wrapupLogs,
      newUsers7dRows,
      activeUsers7dRows
    ] = await Promise.all([
      // 总用户数（不含虚拟学习者）
      prisma.users.count({
        where: REAL_USER_WHERE,
      }),
      
      // 今日新增用户（不含虚拟学习者）
      prisma.users.count({
        where: {
          ...REAL_USER_WHERE,
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),
      
      // 今日活跃用户（有学习会话，不含虚拟学习者）
      prisma.teaching_sessions.findMany({
        where: {
          users: REAL_USER_WHERE,
          startTime: {
            gte: today,
            lt: tomorrow,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
      
      // 总学习路径数（不含虚拟学习者/测试账号）
      prisma.learning_paths.count({
        where: { users: REAL_USER_WHERE },
      }),

      // 生成失败的学习路径数（断点归因用，不含虚拟学习者/测试账号）
      prisma.learning_paths.count({
        where: { users: REAL_USER_WHERE, status: 'failed' },
      }),
      
      // 活跃学习路径（有未完成的任务，不含虚拟学习者）
      prisma.learning_paths.findMany({
        where: {
          users: REAL_USER_WHERE,
          milestones: {
            some: {
              subtasks: {
                some: {
                  status: {
                    in: ['todo', 'in_progress'],
                  },
                },
              },
            },
          },
        },
        select: { id: true },
      }),
      
      // 总任务数（不含虚拟学习者/测试账号）
      // 口径修复：subtasks.users 关系建在 usersId 上，而生产创建路径只写 userId（usersId 全为 null），
      // 用 users 关系过滤会恒为 0 → 漏斗「任务/完成」永久 0。改为按 userId 归属过滤（与调用/token 同源）。
      prisma.subtasks.count({
        where: { userId: { in: [...realUserSet] } },
      }),
      
      // 已完成任务数（不含虚拟学习者/测试账号）
      prisma.subtasks.count({
        where: {
          userId: { in: [...realUserSet] },
          status: 'completed',
        },
      }),
      
      // 总对话数（不含虚拟学习者/测试账号）
      prisma.goal_conversations.count({
        where: { users: REAL_USER_WHERE },
      }),

      // 完成澄清的对话数（漏斗"目标"口径，不含虚拟学习者/测试账号）
      prisma.goal_conversations.count({
        where: { users: REAL_USER_WHERE, status: 'completed' },
      }),
      
      // 活跃对话（不含虚拟学习者）
      prisma.goal_conversations.count({
        where: {
          users: REAL_USER_WHERE,
          status: 'active',
        },
      }),
      
      // 全量累计调用数（长缓存子层：两个全表 groupBy 拆到 10 分钟 TTL，见 computeAllTimeCallStats）
      computeAllTimeCallStats({ userId: { in: [...realUserSet] } }, businessExecutionWhere, force),

      /* ===== 单扫 1：agent_call_logs 近 7 天全量行（含虚拟/测试/孤儿，端内分桶） =====
       * 消费方：今日 5 计数 / activeAgents24h / trend7d / topSkills / last24h 脉搏（含超时覆盖）/
       * calls7d 与 calls7dAll / 失败归因行。select 按消费方并集取最小列集；
       * 不 orderBy——所有消费方都按时间键分桶，与行序无关（省一次 3 万行排序）。 */
      prisma.agent_call_logs.findMany({
        where: { ...businessExecutionWhere, calledAt: { gte: sevenDaysAgo } },
        select: {
          calledAt: true,
          success: true,
          userId: true,
          agentId: true,
          errorCategory: true,
          errorCode: true,
          error: true,
        },
      }),

      /* ===== 单扫 2：llm_execution_attempts 近 7 天全量行（端内分桶） =====
       * 消费方：totalTokens7d / totalTokens7dAll / calls 双口径（_count）/ models7d 分布。 */
      prisma.llm_execution_attempts.findMany({
        where: { startedAt: { gte: sevenDaysAgo } },
        select: { userId: true, resolvedModel: true, totalTokens: true },
      }),

      // wrapup 来源分布抽样（200 → 50：仅用于 wrapupSourceStats 比例估算；真实用户口径）
      prisma.agent_call_logs.findMany({
        where: { agentId: 'skill:session-wrapup', userId: { in: [...realUserSet] } },
        orderBy: { calledAt: 'desc' },
        take: 50,
        select: { output: true }
      }),

      // G2 总览「用户增长」：近 7 天新增注册（真实用户）
      prisma.users.findMany({
        where: { ...REAL_USER_WHERE, createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),

      // G3 总览「用户增长」：近 7 天活跃用户（教学会话 startTime 按天去重）
      prisma.teaching_sessions.findMany({
        where: { users: REAL_USER_WHERE, startTime: { gte: sevenDaysAgo } },
        select: { startTime: true, userId: true },
      })
    ]);

    const wrapupSourceStats = {
      sampleSize: 0,
      summaryModel: 0,
      summaryFallback: 0,
      evaluationModel: 0,
      evaluationAiFallback: 0,
      evaluationFailed: 0,
    };

    for (const log of wrapupLogs) {
      if (!log.output) continue;
      try {
        const parsed = JSON.parse(log.output);
        // 仅接受 agent-output-v1（当前唯一 schema；历史上不存在旧格式输出，
        // sources/summarySource 等顶层字段从未被序列化过，见 git 7b2d58e）
        if (parsed?.schemaVersion !== 'agent-output-v1') continue;
        const ok = parsed?.success !== false;
        wrapupSourceStats.sampleSize += 1;
        // 总结来源：success=true（handler 在 model 路径置 true，否则 false）= 模型产出
        if (ok) wrapupSourceStats.summaryModel += 1;
        else wrapupSourceStats.summaryFallback += 1;
        // 评估来源：success=true = model；失败/不可用 = failed。
        // ai-fallback 已退役（8fe993d），不再产出，evaluationAiFallback 恒 0
        if (ok) wrapupSourceStats.evaluationModel += 1;
        else wrapupSourceStats.evaluationFailed += 1;
      } catch {
        continue;
      }
    }

    // 计算活跃用户数
    const activeUsersCount = activeUsersToday.length;

    /* ===== 单扫端内聚合（性能批 2026-10-01）=====
     * 扫描行含虚拟/测试/孤儿（userId NULL）行，逐行 Set 判定归属后分桶，
     * 三口径语义与合并前的 SQL where 逐一对应：
     * - All 口径 = 扫描全集（execFilter + 7d 窗口）
     * - 真实口径 = userId ∈ realUserSet（原 realUserScope）
     * - 虚拟口径 = userId ∈ virtualUserSet 且非空（原 in virtualUserIds，空集时空转）
     */
    type AgentScanRow = {
      calledAt: Date;
      success: boolean;
      userId: string | null;
      agentId: string | null;
      errorCategory: string | null;
      errorCode: string | null;
      error: string | null;
    };
    const agentRows = agentScan7d as AgentScanRow[];
    const todayStartTs = today.getTime();
    const tomorrowTs = tomorrow.getTime();
    const rolling24hTs = rolling24hStart.getTime();

    // 今日超时判定：合并前是 SQL LIKE 计数（errorCode 含 TIMEOUT / error 含 5 类超时文本，
    // SQLite LIKE 对 ASCII 大小写不敏感 → 端内 toLowerCase 比对同语义）。
    // 注意它与 24h 趋势覆盖层的 isTimeoutLog（errorCategory/errorCode 维度）是并存的两套口径，
    // 合并前后各自用途不变，互不替代。
    const isTodayTimeoutText = (row: { errorCode: string | null; error: string | null }) => {
      if (String(row.errorCode || '').toLowerCase().includes('timeout')) return true;
      const text = String(row.error || '').toLowerCase();
      return ['timeout', 'timed out', 'etimedout', 'deadline exceeded', 'request timeout'].some((s) =>
        text.includes(s)
      );
    };

    // Pass 1（全集）：All/虚拟口径计数 + 真实行收集
    const realRows: AgentScanRow[] = [];
    let agent7dAllTotal = 0;
    let todayCallsAll = 0;
    let todayCallsVirtual = 0;
    for (const row of agentRows) {
      agent7dAllTotal += 1;
      const ts = new Date(row.calledAt).getTime();
      if (ts >= todayStartTs && ts < tomorrowTs) {
        todayCallsAll += 1;
        if (row.userId != null && virtualUserSet.has(row.userId)) todayCallsVirtual += 1;
      }
      if (row.userId != null && realUserSet.has(row.userId)) realRows.push(row);
    }

    /* ===== G1/G4 前置：趋势桶 + TopSkill 表（真实口径 pass 2 一并产出） ===== */
    const dayKey = (d: Date | string) => dayKeyOf(new Date(d));
    const trendMap = new Map<string, { calls: number; failed: number }>();
    const todayKey = dayKeyOf(new Date());
    for (let i = 6; i >= 0; i--) {
      trendMap.set(addDaysToDayKey(todayKey, -i), { calls: 0, failed: 0 });
    }
    const skillMap = new Map<string, { calls: number; failed: number }>();
    const activeAgentIds = new Set<string>();
    const realFailureRows: AgentScanRow[] = [];
    let agent7dTotal = 0;
    let todayCalls = 0;
    let todaySuccess = 0;
    let todayTimeouts = 0;
    // KPI 趋势基线：昨日同时刻窗口 = [昨日 00:00, 昨日 00:00 + 今日已流逝时长)，
    // 与「今日自然日（进行中）」等长对照——不与昨日全日直接比（部分窗口 vs 全日必然失真）
    let todayCallsBaseline = 0;
    const baselineStartTs = todayStartTs - 86400000;
    const baselineEndTs = baselineStartTs + Math.max(0, nowTs - todayStartTs);
    for (const row of realRows) {
      agent7dTotal += 1;
      const ts = new Date(row.calledAt).getTime();
      if (ts >= todayStartTs && ts < tomorrowTs) {
        todayCalls += 1;
        if (row.success) todaySuccess += 1;
        else if (isTodayTimeoutText(row)) todayTimeouts += 1;
      }
      if (ts >= baselineStartTs && ts < baselineEndTs) todayCallsBaseline += 1;
      if (ts >= rolling24hTs) activeAgentIds.add(String(row.agentId ?? ''));
      const bucket = trendMap.get(dayKey(row.calledAt));
      if (bucket) {
        bucket.calls += 1;
        if (!row.success) bucket.failed += 1;
      }
      const skillKey = String(row.agentId ?? '');
      const skill = skillMap.get(skillKey) || { calls: 0, failed: 0 };
      skill.calls += 1;
      if (!row.success) skill.failed += 1;
      skillMap.set(skillKey, skill);
      if (!row.success) realFailureRows.push(row);
    }
    const trend7d = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));
    const topSkills = [...skillMap.entries()]
      .map(([agentId, v]) => ({ agentId, ...v }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5);

    const newUsersMap = new Map<string, number>();
    for (const u of newUsers7dRows) {
      const k = dayKey(u.createdAt);
      newUsersMap.set(k, (newUsersMap.get(k) || 0) + 1);
    }
    const activeMap = new Map<string, Set<string>>();
    for (const s of activeUsers7dRows) {
      const k = dayKey(s.startTime);
      if (!activeMap.has(k)) activeMap.set(k, new Set());
      activeMap.get(k)!.add(s.userId);
    }
    const growth7d = [...trendMap.keys()].map((date) => ({
      date,
      newUsers: newUsersMap.get(date) || 0,
      activeUsers: activeMap.get(date)?.size || 0,
    }));

    // KPI 趋势基线（昨日同时刻窗口）：新增注册 / 活跃用户（去重）
    let newTodayBaseline = 0;
    const activeBaselineSet = new Set<string>();
    for (const u of newUsers7dRows) {
      const ts = new Date(u.createdAt).getTime();
      if (ts >= baselineStartTs && ts < baselineEndTs) newTodayBaseline += 1;
    }
    for (const s of activeUsers7dRows) {
      const ts = new Date(s.startTime).getTime();
      if (ts >= baselineStartTs && ts < baselineEndTs) activeBaselineSet.add(s.userId);
    }
    const activeTodayBaseline = activeBaselineSet.size;
    
    // 计算活跃路径数
    const activePathsCount = activePaths.length;

    // 计算 Agent 成功率（全量累计口径来自 10 分钟长缓存子层）
    const agentStats = {
      total: allTimeStats.total,
      success: allTimeStats.success,
      error: allTimeStats.total - allTimeStats.success,
    };
    // 全量口径（含虚拟/测试账号）：仅作副指标，前端标注「含虚拟/测试」
    const agentStatsAll = {
      total: allTimeStats.totalAll,
    };
    
    const agentSuccessRate = agentStats.total > 0 
      ? agentStats.success / agentStats.total 
      : 1.0;

    const agentTodaySuccessRate = todayCalls > 0
      ? ((todaySuccess / todayCalls) * 100).toFixed(1)
      : null;

    // 全量聚合：每行必落 24 桶之一，总数=各小时和；高峰小时在聚合内直接给出（不再前端从抽样推断）。
    // total/success 用真实口径 7d 行（realRows，原 agentLogs7dRows）；
    // 超时分类从真实口径失败行（realFailureRows，带 error 字段）过滤出 24h 窗口覆盖——
    // 24h 失败行 ⊆ 7d 失败行（同口径），不为 24h 脉搏单独拉行。
    const timeoutByHour = new Map<string, number>();
    for (const row of realFailureRows) {
      const ts = new Date(row.calledAt).getTime();
      if (ts < trendWindowStart.getTime() || ts > nowTs) continue;
      if (!isTimeoutLog(row)) continue;
      const key = hourKeyOf(new Date(row.calledAt));
      timeoutByHour.set(key, (timeoutByHour.get(key) || 0) + 1);
    }
    const hourlyTrend = buildHourlyTrend(realRows, trendWindowStart);
    // 桶序与 buildHourlyTrend 同源：hourlyTrend[i] = hourKeyOf(当前整点 - (23-i)h)
    const trendBucketStart = startOfHour(new Date());
    for (let i = 0; i < hourlyTrend.length; i += 1) {
      const timeouts = timeoutByHour.get(hourKeyOf(new Date(trendBucketStart.getTime() - (23 - i) * 3600000))) || 0;
      if (!timeouts) continue;
      // buildHourlyTrend 把窗口内失败行全部计入 error（7d 行无 error 字段）；超时部分从 error 转入 timeout
      const bucket = hourlyTrend[i];
      bucket.timeout = timeouts;
      bucket.error = Math.max(0, bucket.error - timeouts);
    }
    const last24hTotal = hourlyTrend.reduce((sum, b) => sum + b.total, 0);
    const peakBucket = hourlyTrend.reduce(
      (best, b) => (b.total > (best?.total || 0) ? b : best),
      undefined as HourlyTrendBucket | undefined
    );
    const last24hPeak = last24hTotal > 0 && peakBucket ? peakBucket.label : '—';

    /* 近 7 天 LLM 用量与失败归因（单扫 2 端内聚合） */
    let usageTokens7d = 0;
    let usageTokens7dAll = 0;
    let usageCalls7d = 0;
    let usageCalls7dAll = 0;
    const modelMap = new Map<string, { calls: number; tokens: number }>();
    for (const row of llmScan7d as Array<{ userId: string | null; resolvedModel: string | null; totalTokens: number | null }>) {
      const tokens = Number(row.totalTokens || 0);
      usageCalls7dAll += 1;
      usageTokens7dAll += tokens;
      // 真实口径分桶（原 aggregate/groupBy 的 realUserScope）；孤儿行（userId NULL）只入全量口径
      if (row.userId == null || !realUserSet.has(row.userId)) continue;
      usageCalls7d += 1;
      usageTokens7d += tokens;
      // 模型分布只收真实口径（原 models7d groupBy 口径），空名/'null' 剔除
      const model = String(row.resolvedModel || '');
      if (!model || model === 'null') continue;
      const m = modelMap.get(model) || { calls: 0, tokens: 0 };
      m.calls += 1;
      m.tokens += tokens;
      modelMap.set(model, m);
    }
    const models7d = [...modelMap.entries()]
      .map(([model, v]) => ({ model, calls: v.calls, tokens: v.tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
    // 失败归因（调用级：与「失败 N」同源行，分类见 classifyFailureCategory，
    // 归因之和恒等于失败总数——失败数即本行集长度）
    const failureCategoryCounts = new Map<string, number>();
    for (const row of realFailureRows) {
      const cat = classifyFailureCategory(row);
      failureCategoryCounts.set(cat, (failureCategoryCounts.get(cat) || 0) + 1);
    }
    const failures7d = [...failureCategoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const usage = {
      calls7d: agent7dTotal,
      failed7d: realFailureRows.length,
      totalTokens7d: usageTokens7d,
      models7d,
      failures7d,
      // 全量副口径（含虚拟/测试账号）：totalTokens7dAll / calls7dAll 供前端标注「含虚拟/测试」
      totalTokens7dAll: usageTokens7dAll,
      calls7dAll: agent7dAllTotal,
    };

    return {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersCount,
          activeRate: totalUsers > 0 ? (activeUsersCount / totalUsers * 100).toFixed(1) : '0.0',
          // KPI 趋势基线（昨日同时刻窗口）：新增注册 / 活跃用户
          newTodayBaseline,
          activeTodayBaseline,
          // G2/G3：近 7 天每日新增注册 / 活跃用户（总览「用户增长」卡）
          growth7d,
        },
        learning: {
          totalPaths,
          failedPaths,
          activePaths: activePathsCount,
          totalTasks,
          completedTasks,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(1) : '0.0',
        },
        conversations: {
          total: totalConversations,
          completed: completedConversations,
          active: activeConversations,
        },
        agents: {
          totalCalls: agentStats.total,
          successRate: (agentSuccessRate * 100).toFixed(1),
          failedCalls: agentStats.error,
          activeAgents24h: activeAgentIds.size,
          todayCalls: todayCalls,
          todaySuccessRate: agentTodaySuccessRate,
          todayTimeouts: todayTimeouts,
          // KPI 趋势基线（昨日同时刻窗口）：今日调用对照
          todayCallsBaseline,
          last24h: hourlyTrend,
          last24hTotal,
          last24hPeak,
          wrapup: wrapupSourceStats,
          // 全量副口径（含虚拟/测试账号）：前端标注「含虚拟/测试」
          totalCallsAll: agentStatsAll.total,
          todayCallsAll: todayCallsAll,
          // 虚拟/测试账号独立口径（前端「虚拟调用」卡，与真实调用并列区分）
          todayCallsVirtual: todayCallsVirtual,
          // G1/G4：近 7 天每日调用趋势 / Top Skill 活跃榜（总览新增卡）
          trend7d,
          topSkills,
        },
        usage,
    };
}
