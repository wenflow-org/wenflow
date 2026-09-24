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
    errorCode: string | null;
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

export async function computeOverviewStats(): Promise<unknown> {
    // 获取今日统计（**应用时区本地日**，与学习侧日界同口径）
    const today = startOfDay(new Date());

    const tomorrow = new Date(startOfDay(new Date()).getTime() + 86400000);

    // 获取昨日统计
    const yesterday = new Date(startOfDay(new Date()).getTime() - 86400000);
    const last24HoursStart = new Date(Date.now() - 24 * 3600000);

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
    const realUserIds = (
      await prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } })
    ).map((u) => u.id);
    const realUserScope = { userId: { in: realUserIds } };
    // 虚拟/测试账号 = 全部用户 − 真实用户（差集互补，口径严格无遗漏），供「虚拟调用」独立指标
    const allUserIds = (await prisma.users.findMany({ select: { id: true } })).map((u) => u.id);
    const virtualUserIds = allUserIds.filter((id) => !realUserIds.includes(id));

    // 并行查询所有统计数据
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
      totalAgentLogs,
      totalAgentLogsAll,
      agentCallsToday,
      agentCallsTodayAll,
      agentCallsTodayVirtual,
      agentSuccessToday,
      agentTimeoutToday,
      activeAgents24h,
      recentAgentLogs24h,
      wrapupLogs,
      usageTokens7d,
      usageTokens7dAll,
      usageCalls7d,
      usageCalls7dAll,
      usageModels7d,
      usageFailuresRows,
      agentLogs7dRows,
      newUsers7dRows,
      activeUsers7dRows,
      agentSkillAgg7d
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
        where: { ...realUserScope },
      }),
      
      // 已完成任务数（不含虚拟学习者/测试账号）
      prisma.subtasks.count({
        where: {
          ...realUserScope,
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
      
      // Agent 调用统计（真实用户口径：按 userId 归属过滤；全量见 totalAgentLogsAll）
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

      // 今日 Agent 调用数（真实用户口径；全量见 agentCallsTodayAll）
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),

      // 今日 Agent 调用数全量（含虚拟/测试）
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),

      // 今日虚拟/测试账号调用数（真实口径之外的分母，前端单独成卡与真实调用并列区分）
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
          userId: { in: virtualUserIds },
        },
      }),

      // 今日 Agent 成功调用
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
          success: true,
        },
      }),

      // 今日超时调用（按 errorCode/errorCategory 识别）。
      // 保守保留 LIKE 查询：现代 gateway 行带 errorCategory=provider_timeout / errorCode=ATTEMPT_TIMEOUT，
      // 但旧平台与 skill 行只有 error/errorCode 文本信号（无 errorCategory 列值），
      // 且 error 字段可能包含 'timed out' 等 errorCode 不含的信号，故不做枚举化改造。
      prisma.agent_call_logs.count({
        where: {
          AND: [
            businessExecutionWhere,
            realUserScope,
            {
              calledAt: { gte: today, lt: tomorrow },
              success: false,
              OR: [
                { errorCode: { contains: 'TIMEOUT' } },
                { error: { contains: 'timeout' } },
                { error: { contains: 'timed out' } },
                { error: { contains: 'etimedout' } },
                { error: { contains: 'deadline exceeded' } },
                { error: { contains: 'request timeout' } }
              ]
            }
          ]
        }
      }),

      // 最近 24h 活跃 Agent 数
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: new Date(Date.now() - 24 * 3600000) }
        }
      }),

      // 最近 24h 调用趋势（P0-1：全量聚合，无 take 截断；时间窗 where 限定 [trendWindowStart, now]，
      // calledAt 已有索引 @@index([calledAt])；窄 select 避免拉取 error 全文，orderBy 保证聚合顺序稳定）
      prisma.agent_call_logs.findMany({
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: trendWindowStart }
        },
        orderBy: { calledAt: 'asc' },
        select: {
          calledAt: true,
          success: true,
          errorCode: true,
          errorCategory: true
        }
      }),

      // wrapup 来源分布抽样（200 → 50：仅用于 wrapupSourceStats 比例估算；真实用户口径）
      prisma.agent_call_logs.findMany({
        where: { agentId: 'skill:session-wrapup', ...realUserScope },
        orderBy: { calledAt: 'desc' },
        take: 50,
        select: { output: true }
      }),

      // 近 7 天 LLM 用量聚合（真实用户口径，token 总量；全量见 usageTokens7dAll）
      prisma.llm_execution_attempts.aggregate({
        where: { ...realUserScope, startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _sum: { totalTokens: true },
        _count: true,
      }),

      // 近 7 天 LLM 用量全量（含虚拟/测试账号，前端副口径标注）
      prisma.llm_execution_attempts.aggregate({
        where: { startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _sum: { totalTokens: true },
        _count: true,
      }),

      // 近 7 天调用与失败数（真实用户口径；全量见 usageCalls7dAll）
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) }
        },
        _count: true,
      }),

      // 近 7 天调用与失败数全量（含虚拟/测试）
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: {
          ...businessExecutionWhere,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) }
        },
        _count: true,
      }),

      // 近 7 天模型用量分布（按解析后的模型名，真实用户口径）
      prisma.llm_execution_attempts.groupBy({
        by: ['resolvedModel'],
        where: { ...realUserScope, startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _sum: { totalTokens: true },
        _count: true,
      }),

      // 近 7 天失败归因（调用级：与「失败 N」同表同口径，分类见 classifyFailureCategory，
      // 老行 errorCategory 为空时按 errorCode/error 启发式归并，保证归因之和恒等于失败总数）
      prisma.agent_call_logs.findMany({
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) },
          success: false,
        },
        orderBy: { calledAt: 'desc' },
        select: { errorCategory: true, errorCode: true, error: true },
      }),

      // G1 总览「近 7 天调用趋势」：行级拉取在端内按本地自然日聚合
      // （SQLite date() 按 UTC 分组会与本地日错位，端内聚合保证「今日=00:00 起」口径一致）
      prisma.agent_call_logs.findMany({
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        orderBy: { calledAt: 'asc' },
        select: { calledAt: true, success: true },
      }),

      // G2 总览「用户增长」：近 7 天新增注册（真实用户）
      prisma.users.findMany({
        where: { ...REAL_USER_WHERE, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        select: { createdAt: true },
      }),

      // G3 总览「用户增长」：近 7 天活跃用户（教学会话 startTime 按天去重）
      prisma.teaching_sessions.findMany({
        where: { users: REAL_USER_WHERE, startTime: { gte: new Date(Date.now() - 7 * 86400000) } },
        select: { startTime: true, userId: true },
      }),

      // G4 总览「Top Skill」：近 7 天按 agentId×success 聚合
      prisma.agent_call_logs.groupBy({
        by: ['agentId', 'success'],
        where: {
          ...businessExecutionWhere,
          ...realUserScope,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        _count: true,
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

    /* ===== G1-G4：总览新增模块（近 7 天趋势 / 用户增长 / Top Skill） ===== */
    const dayKey = (d: Date | string) => dayKeyOf(new Date(d));
    const trendMap = new Map<string, { calls: number; failed: number }>();
    const todayKey = dayKeyOf(new Date());
    for (let i = 6; i >= 0; i--) {
      trendMap.set(addDaysToDayKey(todayKey, -i), { calls: 0, failed: 0 });
    }
    for (const row of agentLogs7dRows) {
      const bucket = trendMap.get(dayKey(row.calledAt));
      if (!bucket) continue;
      bucket.calls += 1;
      if (!row.success) bucket.failed += 1;
    }
    const trend7d = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));

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

    const skillMap = new Map<string, { calls: number; failed: number }>();
    for (const row of agentSkillAgg7d) {
      const cur = skillMap.get(row.agentId) || { calls: 0, failed: 0 };
      cur.calls += row._count;
      if (!row.success) cur.failed += row._count;
      skillMap.set(row.agentId, cur);
    }
    const topSkills = [...skillMap.entries()]
      .map(([agentId, v]) => ({ agentId, ...v }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5);
    
    // 计算活跃路径数
    const activePathsCount = activePaths.length;

    // 计算 Agent 成功率 (使用 agentCallLog 的 success 字段)
    const agentStats = {
      total: totalAgentLogs.reduce((sum, s) => sum + s._count, 0),
      success: totalAgentLogs.find(s => s.success === true)?._count || 0,
      error: totalAgentLogs.find(s => s.success === false)?._count || 0,
    };
    // 全量口径（含虚拟/测试账号）：仅作副指标，前端标注「含虚拟/测试」
    const agentStatsAll = {
      total: totalAgentLogsAll.reduce((sum, s) => sum + s._count, 0),
    };
    
    const agentSuccessRate = agentStats.total > 0 
      ? agentStats.success / agentStats.total 
      : 1.0;

    const agentTodaySuccessRate = agentCallsToday > 0
      ? ((agentSuccessToday / agentCallsToday) * 100).toFixed(1)
      : null;

    // 全量聚合：每行必落 24 桶之一，总数=各小时和；高峰小时在聚合内直接给出（不再前端从抽样推断）
    const hourlyTrend = buildHourlyTrend(recentAgentLogs24h, trendWindowStart);
    const last24hTotal = hourlyTrend.reduce((sum, b) => sum + b.total, 0);
    const peakBucket = hourlyTrend.reduce(
      (best, b) => (b.total > (best?.total || 0) ? b : best),
      undefined as HourlyTrendBucket | undefined
    );
    const last24hPeak = last24hTotal > 0 && peakBucket ? peakBucket.label : '—';

    /* 近 7 天 LLM 用量与失败归因 */
    const sum7d = (usageTokens7d as { _sum?: { totalTokens?: number | null } })._sum || {};
    const sum7dAll = (usageTokens7dAll as { _sum?: { totalTokens?: number | null } })._sum || {};
    const calls7dTotal = usageCalls7d.reduce((acc, g) => acc + g._count, 0);
    const calls7dTotalAll = usageCalls7dAll.reduce((acc, g) => acc + g._count, 0);
    // 失败数 = 失败归因行数（同一查询源，二者恒等，消除「失败 234 vs 归因 168」双口径）
    const calls7dFailed = usageFailuresRows.length;
    const models7d = (usageModels7d || [])
      .filter(g => g.resolvedModel && g.resolvedModel !== 'null')
      .map(g => ({
        model: String(g.resolvedModel),
        calls: g._count,
        tokens: g._sum.totalTokens || 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
    const failureCategoryCounts = new Map<string, number>();
    for (const row of usageFailuresRows) {
      const cat = classifyFailureCategory(row);
      failureCategoryCounts.set(cat, (failureCategoryCounts.get(cat) || 0) + 1);
    }
    const failures7d = [...failureCategoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const usage = {
      calls7d: calls7dTotal,
      failed7d: calls7dFailed,
      totalTokens7d: Number(sum7d.totalTokens || 0),
      models7d,
      failures7d,
      // 全量副口径（含虚拟/测试账号）：totalTokens7dAll / calls7dAll 供前端标注「含虚拟/测试」
      totalTokens7dAll: Number(sum7dAll.totalTokens || 0),
      calls7dAll: calls7dTotalAll,
    };

    return {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersCount,
          activeRate: totalUsers > 0 ? (activeUsersCount / totalUsers * 100).toFixed(1) : '0.0',
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
          activeAgents24h: activeAgents24h.length,
          todayCalls: agentCallsToday,
          todaySuccessRate: agentTodaySuccessRate,
          todayTimeouts: agentTimeoutToday,
          last24h: hourlyTrend,
          last24hTotal,
          last24hPeak,
          wrapup: wrapupSourceStats,
          // 全量副口径（含虚拟/测试账号）：前端标注「含虚拟/测试」
          totalCallsAll: agentStatsAll.total,
          todayCallsAll: agentCallsTodayAll,
          // 虚拟/测试账号独立口径（前端「虚拟调用」卡，与真实调用并列区分）
          todayCallsVirtual: agentCallsTodayVirtual,
          // G1/G4：近 7 天每日调用趋势 / Top Skill 活跃榜（总览新增卡）
          trend7d,
          topSkills,
        },
        usage,
    };
}
