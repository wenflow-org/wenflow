import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getPlatformSettings, updatePlatformSettings } from '../../services/platform-settings.service';
import { getAgentCatalog, isOfficialAgent } from '../../services/agent-catalog.service';
import {
  getAgentManifest,
  getCanonicalAgentId,
  getMonitoringGroupMappings,
  getOrchestratorRelations,
  isManifestOrchestrator,
  listAgentManifest
} from '../../services/agent-manifest.service';
import { getGateway } from '../../gateway';
import {
  DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG,
  getPathOrchestratorInputConfig,
  savePathOrchestratorInputConfig
} from '../../services/orchestratorConfig.service';
import pathOrchestrator from '../../orchestrators/path.orchestrator';

const router = express.Router();
router.use(authMiddleware);

const AGENT_NAME_TO_IDS: Record<string, string[]> = getMonitoringGroupMappings();

const MONITORED_AGENT_ORDER = [
  'RequirementCollection',
  'PathPlanning',
  'Teaching',
  'TeachingOrchestration',
  'LearningCompanion',
  'SessionWrapup'
];

const AGENT_ID_TO_NAME = Object.entries(AGENT_NAME_TO_IDS).reduce((acc, [name, ids]) => {
  for (const id of ids) {
    acc[id] = name;
  }
  return acc;
}, {} as Record<string, string>);

const ORCHESTRATOR_RELATIONS = getOrchestratorRelations();

const inferRuntimeRole = (agentId: string, type?: string | null) => {
  const typeText = String(type || '').toLowerCase();
  if (typeText.includes('orchestrator')) return 'orchestrator';
  if (isManifestOrchestrator(agentId)) return 'orchestrator';
  if (agentId.endsWith('-orchestrator')) return 'orchestrator';
  return 'agent';
};

const ensureAdmin = async (userId?: string) => {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  });
  return !!operator?.isAdmin;
};

type OutputContractBucket = 'v1' | 'legacy' | 'mixed' | 'unknown';

const LEGACY_OUTPUT_KEYS = ['goalConversation', 'path', 'progress', 'output'];

const parseOutputPayload = (raw: string | null): any | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const classifyOutputContract = (payload: any): OutputContractBucket => {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }

  const hasLegacy = LEGACY_OUTPUT_KEYS.some((key) => payload[key] !== undefined);
  const hasV1 =
    payload.schemaVersion === 'agent-output-v1' ||
    (typeof payload.userVisible === 'string' && payload.internal && typeof payload.internal === 'object');

  if (hasV1 && hasLegacy) return 'mixed';
  if (hasV1) return 'v1';
  if (hasLegacy) return 'legacy';
  return 'unknown';
};

const summarizeOutputContracts = (rows: Array<{ output: string | null }>) => {
  const summary = {
    sampleSize: rows.length,
    v1: 0,
    legacy: 0,
    mixed: 0,
    unknown: 0
  };

  for (const row of rows) {
    const bucket = classifyOutputContract(parseOutputPayload(row.output));
    summary[bucket] += 1;
  }

  return summary;
};

router.get('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const settings = await getPlatformSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '获取设置失败', status: 500 }
    });
  }
});

router.put('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const { registrationEnabled } = req.body;
    if (typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { message: 'registrationEnabled 必须是布尔值', status: 400 }
      });
    }

    const settings = await updatePlatformSettings({ registrationEnabled });
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '更新设置失败', status: 500 }
    });
  }
});

/**
 * Agent Manifest 一致性诊断
 * GET /api/admin/manifest/diagnostics
 */
router.get('/manifest/diagnostics', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const manifest = listAgentManifest();
    const canonicalManifestIds = new Set(
      manifest.filter(item => item.kind !== 'alias').map(item => item.id)
    );

    const infrastructureIds = new Set([
      'api-gateway',
      'gateway',
      'system-call',
      'arena-service',
      'ai-service'
    ]);

    const [registrations, modelConfigs, logGroups, catalog, agentCallOutputSamples, arenaOutputSamples] = await Promise.all([
      prisma.agent_registrations.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          updatedAt: true
        }
      }),
      prisma.agent_model_configs.findMany({
        orderBy: { agentId: 'asc' },
        select: {
          agentId: true,
          enabled: true,
          updatedAt: true
        }
      }),
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        _count: { _all: true }
      }),
      getAgentCatalog(),
      prisma.agent_call_logs.findMany({
        where: { output: { not: null } },
        orderBy: { calledAt: 'desc' },
        take: 500,
        select: { output: true }
      }),
      prisma.arena_agent_logs.findMany({
        where: { output: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { output: true }
      })
    ]);

    const agentCallContractCounts = summarizeOutputContracts(agentCallOutputSamples);
    const arenaContractCounts = summarizeOutputContracts(arenaOutputSamples);

    const registrationIds = registrations.map(item => item.id);
    const modelConfigIds = modelConfigs.map(item => item.agentId);
    const calledAgentIds = logGroups.map(item => item.agentId);
    const catalogIds = Object.keys(catalog || {});

    const missingRegistrations = Array.from(canonicalManifestIds).filter(
      id => !registrationIds.includes(id)
    );

    const unknownRegistrations = registrationIds.filter(id => {
      const canonicalId = getCanonicalAgentId(id);
      return !canonicalManifestIds.has(canonicalId);
    });

    const aliasRegistrations = registrationIds
      .map(id => ({ id, canonicalId: getCanonicalAgentId(id) }))
      .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

    const unknownModelConfigs = modelConfigIds.filter(id => {
      const canonicalId = getCanonicalAgentId(id);
      return !canonicalManifestIds.has(canonicalId);
    });

    const aliasModelConfigs = modelConfigIds
      .map(id => ({ id, canonicalId: getCanonicalAgentId(id) }))
      .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

    const unknownLogAgents = calledAgentIds.filter(id => {
      if (infrastructureIds.has(id)) {
        return false;
      }
      const canonicalId = getCanonicalAgentId(id);
      return !canonicalManifestIds.has(canonicalId);
    });

    const aliasLogAgents = logGroups
      .map(item => ({
        id: item.agentId,
        canonicalId: getCanonicalAgentId(item.agentId),
        calls: item._count._all
      }))
      .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

    const catalogOnly = catalogIds.filter(id => !canonicalManifestIds.has(id));

    res.json({
      success: true,
      data: {
        summary: {
          manifestTotal: canonicalManifestIds.size,
          registrationTotal: registrations.length,
          modelConfigTotal: modelConfigs.length,
          calledAgentTotal: calledAgentIds.length,
          catalogTotal: catalogIds.length,
          outputContractSampleSize: agentCallContractCounts.sampleSize,
          arenaOutputContractSampleSize: arenaContractCounts.sampleSize,
          driftCount:
            missingRegistrations.length +
            unknownRegistrations.length +
            unknownModelConfigs.length +
            unknownLogAgents.length +
            catalogOnly.length
        },
        outputContracts: {
          agentCallLogs: agentCallContractCounts,
          arenaAgentLogs: arenaContractCounts
        },
        drift: {
          missingRegistrations,
          unknownRegistrations,
          aliasRegistrations,
          unknownModelConfigs,
          aliasModelConfigs,
          unknownLogAgents,
          aliasLogAgents,
          catalogOnly
        },
        samples: {
          registrations,
          modelConfigs,
          calledAgents: logGroups
        }
      }
    });
  } catch (error: any) {
    console.error('获取 manifest 诊断失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 manifest 诊断失败',
        status: 500
      }
    });
  }
});

/**
 * 获取平台概览数据
 * GET /api/admin/overview/stats
 */
router.get('/overview/stats', async (req: Request, res: Response) => {
  try {
    // 获取今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 获取昨日统计
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last24HoursStart = new Date(Date.now() - 24 * 3600000);

    const timeoutErrorSignals = [
      'timeout',
      'timed out',
      'etimedout',
      'deadline exceeded',
      'request timeout',
      'socket hang up'
    ];

    const isTimeoutLog = (log: { errorCode: string | null; error: string | null }) => {
      const errorCode = String(log.errorCode || '').toLowerCase();
      const errorMessage = String(log.error || '').toLowerCase();
      return timeoutErrorSignals.some(signal =>
        errorCode.includes(signal) || errorMessage.includes(signal)
      );
    };

    // 并行查询所有统计数据
    const [
      totalUsers,
      newUsersToday,
      activeUsersToday,
      totalPaths,
      activePaths,
      totalTasks,
      completedTasks,
      totalConversations,
      activeConversations,
      totalAgentLogs,
      platformStats,
      agentCallsToday,
      agentSuccessToday,
      agentTimeoutToday,
      activeAgents24h,
      recentAgentLogs24h,
      wrapupLogs
    ] = await Promise.all([
      // 总用户数
      prisma.users.count(),
      
      // 今日新增用户
      prisma.users.count({
        where: {
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),
      
      // 今日活跃用户（有学习会话）
      prisma.teaching_sessions.findMany({
        where: {
          startTime: {
            gte: today,
            lt: tomorrow,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
      
      // 总学习路径数
      prisma.learning_paths.count(),
      
      // 活跃学习路径（有未完成的任务）
      prisma.learning_paths.findMany({
        where: {
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
      
      // 总任务数
      prisma.subtasks.count(),
      
      // 已完成任务数
      prisma.subtasks.count({
        where: {
          status: 'completed',
        },
      }),
      
      // 总对话数
      prisma.goal_conversations.count(),
      
      // 活跃对话
      prisma.goal_conversations.count({
        where: {
          status: 'active',
        },
      }),
      
      // Agent 调用统计 (使用 agentCallLog 表)
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        _count: true,
      }),
      
      // 最近的 platform stats
      prisma.platform_stats.findMany({
        take: 7,
        orderBy: { date: 'desc' },
      }),

      // 今日 Agent 调用数
      prisma.agent_call_logs.count({
        where: {
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),

      // 今日 Agent 成功调用
      prisma.agent_call_logs.count({
        where: {
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
          success: true,
        },
      }),

      // 今日超时调用（按 error/errorCode 关键字识别）
      prisma.agent_call_logs.count({
        where: {
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
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
      }),

      // 最近 24h 活跃 Agent 数
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where: {
          calledAt: { gte: new Date(Date.now() - 24 * 3600000) }
        }
      }),

      // 最近 24h 调用趋势
      prisma.agent_call_logs.findMany({
        where: {
          calledAt: { gte: last24HoursStart }
        },
        select: {
          calledAt: true,
          success: true,
          errorCode: true,
          error: true
        }
      }),

      prisma.agent_call_logs.findMany({
        where: { agentId: 'session-wrapup-agent' },
        orderBy: { calledAt: 'desc' },
        take: 200,
        select: { output: true }
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
        const summarySource = parsed?.sources?.summary || parsed?.summarySource;
        const evaluationSource = parsed?.sources?.evaluation || parsed?.evaluationSource;
        wrapupSourceStats.sampleSize += 1;
        if (summarySource === 'model') wrapupSourceStats.summaryModel += 1;
        if (summarySource === 'fallback') wrapupSourceStats.summaryFallback += 1;
        if (evaluationSource === 'model') wrapupSourceStats.evaluationModel += 1;
        if (evaluationSource === 'ai-fallback') wrapupSourceStats.evaluationAiFallback += 1;
        if (evaluationSource === 'failed') wrapupSourceStats.evaluationFailed += 1;
      } catch {
        continue;
      }
    }

    // 计算活跃用户数
    const activeUsersCount = activeUsersToday.length;
    
    // 计算活跃路径数
    const activePathsCount = activePaths.length;

    // 计算 Agent 成功率 (使用 agentCallLog 的 success 字段)
    const agentStats = {
      total: totalAgentLogs.reduce((sum, s) => sum + s._count, 0),
      success: totalAgentLogs.find(s => s.success === true)?._count || 0,
      error: totalAgentLogs.find(s => s.success === false)?._count || 0,
    };
    
    const agentSuccessRate = agentStats.total > 0 
      ? agentStats.success / agentStats.total 
      : 1.0;

    const agentTodaySuccessRate = agentCallsToday > 0
      ? (agentSuccessToday / agentCallsToday)
      : 1.0;

    const hourKeys: string[] = [];
    const hourlyTrendMap: Record<string, { total: number; error: number; timeout: number }> = {};

    for (let i = 23; i >= 0; i -= 1) {
      const d = new Date();
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() - i);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
      hourKeys.push(key);
      hourlyTrendMap[key] = { total: 0, error: 0, timeout: 0 };
    }

    for (const log of recentAgentLogs24h) {
      const d = new Date(log.calledAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
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

    const hourlyTrend = hourKeys.map(key => {
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

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersCount,
          activeRate: totalUsers > 0 ? (activeUsersCount / totalUsers * 100).toFixed(1) : 0,
        },
        learning: {
          totalPaths,
          activePaths: activePathsCount,
          totalTasks,
          completedTasks,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(1) : 0,
        },
        conversations: {
          total: totalConversations,
          active: activeConversations,
        },
        agents: {
          totalCalls: agentStats.total,
          successRate: (agentSuccessRate * 100).toFixed(1),
          failedCalls: agentStats.error,
          activeAgents24h: activeAgents24h.length,
          todayCalls: agentCallsToday,
          todaySuccessRate: (agentTodaySuccessRate * 100).toFixed(1),
          todayTimeouts: agentTimeoutToday,
          last24h: hourlyTrend,
          wrapup: wrapupSourceStats,
        },
        platformStats,
      },
    });
  } catch (error: any) {
    console.error('获取平台概览失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取平台数据失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取 Agent 注册列表
 * GET /api/admin/agents/registry
 */
router.get('/agents/registry', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const [catalog, registrations, callGroups, successGroups] = await Promise.all([
      getAgentCatalog(),
      prisma.agent_registrations.findMany({
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        _count: { _all: true },
        _avg: { durationMs: true },
        _max: { calledAt: true }
      }),
      prisma.agent_call_logs.groupBy({
        by: ['agentId', 'success'],
        _count: { _all: true }
      })
    ]);

    const callMap = new Map<string, { total: number; avgDuration: number; lastActivity: Date | null }>();
    for (const group of callGroups) {
      callMap.set(group.agentId, {
        total: group._count._all,
        avgDuration: Math.round(group._avg.durationMs || 0),
        lastActivity: group._max.calledAt || null
      });
    }

    const successMap = new Map<string, { success: number; failed: number }>();
    for (const group of successGroups) {
      const current = successMap.get(group.agentId) || { success: 0, failed: 0 };
      if (group.success) {
        current.success += group._count._all;
      } else {
        current.failed += group._count._all;
      }
      successMap.set(group.agentId, current);
    }

    const manifestEntries = listAgentManifest().filter(item => item.kind !== 'alias');
    const registrationMap = new Map(registrations.map(item => [item.id, item]));
    const allAgentIds = manifestEntries.map(item => item.id);

    const agents = allAgentIds.map(agentId => {
      const registration = registrationMap.get(agentId);
      const manifest = manifestEntries.find(item => item.id === agentId);
      const callStats = callMap.get(agentId);
      const successStats = successMap.get(agentId) || { success: 0, failed: 0 };
      const totalCalls = callStats?.total ?? registration?.callCount ?? 0;
      const successRate = totalCalls > 0
        ? Number(((successStats.success / totalCalls) * 100).toFixed(1))
        : Number((((registration?.successRate ?? 1)) * 100).toFixed(1));

      const lifecycleStatus = catalog[agentId]?.status || (isOfficialAgent(agentId) ? 'published' : 'draft');

      return {
        agentId,
        name: registration?.name || manifest?.name || agentId,
        type: registration?.type || manifest?.category || 'custom',
        role: inferRuntimeRole(agentId, registration?.type),
        kind: manifest?.kind || 'agent',
        aliases: manifest?.aliases || [],
        category: registration?.category || manifest?.category,
        description: registration?.description || manifest?.description,
        version: registration?.version || '1.0.0',
        endpoint: registration?.endpoint,
        lifecycleStatus,
        isOfficial: isOfficialAgent(agentId),
        callCount: totalCalls,
        successRate,
        avgDuration: callStats?.avgDuration || 0,
        lastActivity: callStats?.lastActivity || null,
        status: totalCalls === 0 ? 'idle' : (successRate >= 90 ? 'healthy' : (successRate >= 75 ? 'warning' : 'error')),
        updatedAt: registration?.updatedAt
      };
    }).sort((a, b) => a.agentId.localeCompare(b.agentId));

    const summary = {
      total: agents.length,
      active24h: agents.filter(item => item.lastActivity && (Date.now() - new Date(item.lastActivity).getTime()) <= 24 * 3600000).length,
      neverCalled: agents.filter(item => item.callCount === 0).length,
      unhealthy: agents.filter(item => item.callCount > 0 && item.successRate < 75).length
    };

    res.json({
      success: true,
      data: {
        summary,
        agents
      }
    });
  } catch (error: any) {
    console.error('获取 Agent 注册列表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 注册列表失败',
        status: 500
      }
    });
  }
});

/**
 * 获取 Agent 设计详情（输入/输出 Schema + 运行契约）
 * GET /api/admin/agents/design/:agentId
 */
router.get('/agents/design/:agentId', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const requestedAgentId = String(req.params.agentId || '').trim();
    const canonicalAgentId = getCanonicalAgentId(requestedAgentId);

    const gateway = getGateway();
    const registration = gateway.getAgent(canonicalAgentId);
    const manifest = getAgentManifest(canonicalAgentId);

    if (!registration && !manifest) {
      return res.status(404).json({
        success: false,
        error: { message: `Agent ${requestedAgentId} 不存在`, status: 404 }
      });
    }

    const [callSamples, arenaSamples] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where: { agentId: canonicalAgentId },
        orderBy: { calledAt: 'desc' },
        take: 3,
        select: {
          id: true,
          input: true,
          output: true,
          success: true,
          calledAt: true,
          durationMs: true,
          error: true
        }
      }),
      prisma.arena_agent_logs.findMany({
        where: { agentName: canonicalAgentId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          input: true,
          output: true,
          status: true,
          createdAt: true,
          durationMs: true,
          error: true
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        agentId: canonicalAgentId,
        requestedAgentId,
        basic: {
          name: registration?.definition.name || manifest?.name || canonicalAgentId,
          version: registration?.definition.version || '1.0.0',
          type: registration?.definition.type || manifest?.category || 'custom',
          category: registration?.definition.category || manifest?.category || 'custom',
          description: registration?.definition.description || manifest?.description || ''
        },
        runtime: {
          role: inferRuntimeRole(canonicalAgentId, registration?.definition.type),
          kind: manifest?.kind || 'agent',
          runtimeEnabled: manifest?.runtimeEnabled ?? true,
          userVisible: manifest?.userVisible ?? false,
          monitoringGroup: manifest?.monitoringGroup || null,
          ioContractVersion: manifest?.ioContractVersion || 'legacy',
          aliases: manifest?.aliases || [],
          promptManagement: {
            mode: canonicalAgentId === 'ai-teaching-agent'
              ? 'orchestrator-no-direct-prompt'
              : canonicalAgentId === 'tutor-agent'
                ? 'legacy-service'
                : 'agent-prompt',
            note: canonicalAgentId === 'ai-teaching-agent'
              ? '该编排器本身不直接持有单一 System Prompt，教学主输出由 teaching-turn-agent、skill:peer-reinforcement、session-wrapup-agent 等运行节点提供。'
              : canonicalAgentId === 'tutor-agent'
                ? '该名称当前更像旧服务概念，不是已注册的独立 runtime agent。若需要 Prompt 管理，应先确认真实运行 ID。'
                : null
          }
        },
        definition: {
          capabilities: registration?.definition.capabilities || [],
          subscribes: registration?.definition.subscribes || [],
          publishes: registration?.definition.publishes || [],
          inputSchema: registration?.definition.inputSchema || null,
          outputSchema: registration?.definition.outputSchema || null
        },
        samples: {
          agentCallLogs: callSamples.map((item) => ({
            id: item.id,
            calledAt: item.calledAt,
            success: item.success,
            durationMs: item.durationMs,
            error: item.error,
            input: parseOutputPayload(item.input),
            output: parseOutputPayload(item.output)
          })),
          arenaAgentLogs: arenaSamples.map((item) => ({
            id: item.id,
            calledAt: item.createdAt,
            success: item.status === 'success',
            durationMs: item.durationMs,
            error: item.error,
            input: parseOutputPayload(item.input),
            output: parseOutputPayload(item.output)
          }))
        }
      }
    });
  } catch (error: any) {
    console.error('获取 Agent 设计详情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 设计详情失败',
        status: 500
      }
    });
  }
});

/**
 * 获取编排器与成员 Agent 关系
 * GET /api/admin/orchestrators/relations
 */
router.get('/orchestrators/relations', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const allMemberIds = Array.from(new Set(Object.values(AGENT_NAME_TO_IDS).flat().map(getCanonicalAgentId)));
    const registrations = await prisma.agent_registrations.findMany({
      where: { id: { in: allMemberIds } },
      select: { id: true, name: true, type: true }
    });

    const registrationMap = new Map(registrations.map(item => [item.id, item]));

    const manifestMap = new Map(listAgentManifest().map(item => [item.id, item]));

    const orchestrators = ORCHESTRATOR_RELATIONS.map((relation) => {
      const orchestratorId = relation.orchestratorId;
      const group = relation.group;
      const memberAgentIds = relation.members || [];
      const members = memberAgentIds.map((agentId) => {
        const canonicalId = getCanonicalAgentId(agentId);
        const registration = registrationMap.get(canonicalId);
        const manifestEntry = manifestMap.get(canonicalId);
        return {
          agentId: canonicalId,
          name: registration?.name || manifestEntry?.name || canonicalId,
          role: inferRuntimeRole(agentId, registration?.type)
        };
      });

      return {
        orchestratorId,
        group,
        members
      };
    });

    res.json({
      success: true,
      data: {
        orchestrators
      }
    });
  } catch (error: any) {
    console.error('获取编排器关系失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取编排器关系失败',
        status: 500
      }
    });
  }
});

router.get('/orchestrator-members/:orchestratorId', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const { orchestratorId } = req.params;
    const relation = ORCHESTRATOR_RELATIONS.find((item) => item.orchestratorId === orchestratorId);

    if (!relation) {
      return res.status(404).json({
        success: false,
        error: { message: '编排器不存在' }
      });
    }

    const manifestMap = new Map(listAgentManifest().map(item => [item.id, item]));
    const memberIds = Array.from(new Set((relation.members || []).map(getCanonicalAgentId)));
    const registrations = await prisma.agent_registrations.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, type: true }
    });
    const registrationMap = new Map(registrations.map(item => [item.id, item]));

    const members = memberIds.map((memberId, index) => {
      const registration = registrationMap.get(memberId);
      const manifest = manifestMap.get(memberId);
      return {
        agentId: memberId,
        name: registration?.name || manifest?.name || memberId,
        role: inferRuntimeRole(memberId, registration?.type),
        enabled: true,
        order: index,
        callCount: 0
      };
    });

    res.json({
      success: true,
      data: {
        orchestratorId,
        members
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        message: error.message || '获取编排器成员失败',
        status: 500
      }
    });
  }
});

router.get('/orchestrators/:orchestratorId/config', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const { orchestratorId } = req.params;
    if (orchestratorId !== 'path-orchestrator') {
      return res.status(404).json({ success: false, error: { message: '当前仅支持路径编排器配置' } });
    }

    const config = await getPathOrchestratorInputConfig();

    res.json({
      success: true,
      data: {
        orchestratorId,
        config,
        defaults: DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG,
        availableSourcePaths: {
          descriptionSources: ['understanding.real_problem', 'rawGoal'],
          subjectSources: ['structuredData.subject', 'collected.subject'],
          skillLevelSources: ['understanding.background.current_level', 'collected.level'],
          timePerDaySources: ['understanding.background.available_time', 'collected.timePerDay', 'understanding.available_resources.time_budget'],
          deadlineTextSources: ['understanding.available_resources.time_horizon', 'understanding.deadline_text'],
          flags: ['includeStructuredData', 'includeConfirmedProposal', 'includeConfidenceScores', 'includeConversationHistory']
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '获取编排器配置失败', status: 500 } });
  }
});

router.put('/orchestrators/:orchestratorId/config', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const { orchestratorId } = req.params;
    if (orchestratorId !== 'path-orchestrator') {
      return res.status(404).json({ success: false, error: { message: '当前仅支持路径编排器配置' } });
    }

    const config = await savePathOrchestratorInputConfig(req.body || {});
    res.json({ success: true, data: { orchestratorId, config } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '保存编排器配置失败', status: 500 } });
  }
});

router.get('/orchestrators/:orchestratorId/data-contract', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const { orchestratorId } = req.params;
    if (orchestratorId !== 'path-orchestrator') {
      return res.status(404).json({ success: false, error: { message: '当前仅支持路径编排器数据契约' } });
    }

    res.json({
      success: true,
      data: {
        orchestratorId,
        entryPayload: {
          name: 'goalFinalPayload',
          description: 'Goal 阶段最终产出并正式交给 Path 的入口对象。',
          fields: [
            { key: 'sourceConversationId', description: 'Goal 会话关联 ID。' },
            { key: 'rawGoal', description: '用户原始目标表述。' },
            { key: 'stage', description: 'Goal 最终确认时的阶段。' },
            { key: 'confidence', description: 'Goal 阶段对当前收敛结果的置信度。' },
            { key: 'finalUserVisible', description: 'Goal 最后一次面向用户的确认文本。' },
            { key: 'understanding', description: 'Goal 阶段结构化理解结果。' },
            { key: 'collected', description: 'Goal 聚合后的补充收集信息。' },
            { key: 'structuredData', description: 'Goal 附带的更强结构化数据。' },
            { key: 'confirmedProposal', description: '用户已确认的方向、交付物和阶段。' },
            { key: 'confidenceScores', description: '关键维度的置信分数。' },
            { key: 'conversationHistory', description: '全部可见消息，上下文辅助证据。' }
          ]
        },
        derivedInput: {
          name: 'normalizedInput',
          description: 'Path orchestrator 基于字段接入配置生成的运行输入。',
          fields: [
            { key: 'description', description: '供 Path 规划使用的主问题描述。' },
            { key: 'subject', description: '如能识别则接入的主题字段。' },
            { key: 'deadlineText', description: '时间窗口的文本表达。' },
            { key: 'sourceConversationId', description: '保留 Goal 会话关联。' },
            { key: 'existingPathId', description: '重试或覆盖时沿用的路径 ID。' },
            { key: 'skillLevel', description: '当前水平信号。' },
            { key: 'timePerDay', description: '时间投入信号。' },
            { key: 'structuredData', description: '按开关决定是否透传。' },
            { key: 'confirmedProposal', description: '按开关决定是否透传。' },
            { key: 'confidenceScores', description: '按开关决定是否透传。' },
            { key: 'conversationHistory', description: '全部可见消息，上下文运行证据。' }
          ]
        },
        framingContract: {
          name: 'pathSceneFraming',
          description: 'Path 清洗层输出的标准结构，供下游直接以 normalizedInput 作为主输入消费。',
          fields: [
            { key: 'normalizedInput', description: '清洗后的主输入结构，不含编排控制字段。' }
          ]
        },
        outputContract: {
          name: 'Path Output',
          description: 'Path 主流程最终持久化输出的核心结构。',
          fields: [
            { key: 'pathName', description: '最终路径名称。' },
            { key: 'subject', description: '最终路径主题。' },
            { key: 'taskChain', description: '用户可见的阶段与任务主体结构。' },
            { key: 'cognitiveCore', description: '隐藏认知结构与核心概念。' },
            { key: 'suggestedMilestones', description: '兼容现有系统的阶段与任务结构快照。' },
            { key: 'cognitiveDesign', description: '兼容现有系统的认知设计镜像。' },
            { key: 'adjustmentPolicy', description: '后续 expand/compress/replan 策略。' },
            { key: 'adjustmentEvidence', description: '支持后续调整的证据字段。' }
          ]
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '获取编排器数据契约失败', status: 500 } });
  }
});

router.post('/orchestrators/:orchestratorId/config-preview', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const { orchestratorId } = req.params;
    if (orchestratorId !== 'path-orchestrator') {
      return res.status(404).json({ success: false, error: { message: '当前仅支持路径编排器预览' } });
    }

    const sample = req.body?.sampleGoalFinalPayload;
    if (!sample || typeof sample !== 'object') {
      return res.status(400).json({ success: false, error: { message: '缺少 sampleGoalFinalPayload' } });
    }

    const normalized = await pathOrchestrator.previewNormalizedGoalInput({
      userId: req.user?.userId || 'admin-preview',
      source: 'goal',
      mode: 'generate',
      sourceConversationId: sample.sourceConversationId,
      existingPathId: sample.existingPathId,
      rawGoal: sample.rawGoal || '',
      understanding: sample.understanding || {},
      collected: sample.collected || {},
      structuredData: sample.structuredData || null,
      confirmedProposal: sample.confirmedProposal || null,
      confidenceScores: sample.confidenceScores || null,
      conversationHistory: Array.isArray(sample.conversationHistory) ? sample.conversationHistory : [],
      finalUserVisible: sample.finalUserVisible || null,
      stage: sample.stage || null,
      confidence: typeof sample.confidence === 'number' ? sample.confidence : undefined,
    });

    res.json({
      success: true,
      data: {
        orchestratorId,
        normalizedInput: {
          description: normalized.description,
          subject: normalized.subject || null,
          deadlineText: normalized.deadlineText || null,
          sourceConversationId: normalized.sourceConversationId || null,
          existingPathId: normalized.existingPathId || null,
          skillLevel: normalized.userProfile?.skillLevel || null,
          timePerDay: normalized.userProfile?.timePerDay || null,
          structuredData: normalized.userProfile?.structuredData || null,
          confirmedProposal: normalized.userProfile?.confirmedProposal || null,
          confidenceScores: normalized.userProfile?.confidenceScores || null,
          conversationHistory: normalized.userProfile?.conversationHistory || [],
          normalizedInput: normalized.userProfile?.normalizedInput || null
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '生成配置预览失败', status: 500 } });
  }
});

/**
 * 获取 Agent 运行状态
 * GET /api/admin/agents/status
 */
router.get('/agents/status', async (req: Request, res: Response) => {
  try {
    // 获取所有有记录的 Agent ID
    const agentIdsWithLogs = await prisma.agent_call_logs.groupBy({
      by: ['agentId'],
      _count: true,
    });

    // 如果没有日志数据，返回默认的 Agent 列表
    if (agentIdsWithLogs.length === 0) {
      const defaultAgents = [
        { name: 'RequirementCollection', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'PathPlanning', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'Teaching', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'TeachingOrchestration', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'LearningCompanion', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'SessionWrapup', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
      ];
      return res.json({
        success: true,
        data: { agents: defaultAgents },
      });
    }

    const rawStatuses = await Promise.all(
      agentIdsWithLogs.map(async ({ agentId }) => {
        const agentName = AGENT_ID_TO_NAME[agentId];
        if (!agentName || !MONITORED_AGENT_ORDER.includes(agentName)) {
          return null;
        }
        
        // 获取最近的执行日志
        const recentLogs = await prisma.agent_call_logs.findMany({
          where: { agentId },
          orderBy: { calledAt: 'desc' },
          take: 20,
        });

        // 计算统计数据
        const totalCalls = recentLogs.length;
        const successCalls = recentLogs.filter(log => log.success === true).length;
        const errorCalls = recentLogs.filter(log => log.success === false).length;
        const avgDuration = totalCalls > 0
          ? recentLogs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / totalCalls
          : 0;

        // 最后活跃时间
        const lastActivity = recentLogs.length > 0 ? recentLogs[0].calledAt : null;
        
        // 最后状态
        const lastStatus = recentLogs.length > 0 
          ? (recentLogs[0].success ? 'success' : 'error')
          : 'idle';

        return {
          name: agentName,
          agentId,
          status: lastStatus,
          totalCalls,
          successCalls,
          errorCalls,
          successRate: totalCalls > 0 ? (successCalls / totalCalls * 100).toFixed(1) : 100,
          avgDuration: Math.round(avgDuration),
          lastActivity,
        };
      })
    );

    const merged = new Map<string, {
      name: string;
      status: string;
      totalCalls: number;
      successCalls: number;
      errorCalls: number;
      avgDurationWeighted: number;
      lastActivity: Date | null;
    }>();

    for (const item of rawStatuses) {
      if (!item) continue;

      const existing = merged.get(item.name);
      if (!existing) {
        merged.set(item.name, {
          name: item.name,
          status: item.status,
          totalCalls: item.totalCalls,
          successCalls: item.successCalls,
          errorCalls: item.errorCalls,
          avgDurationWeighted: item.avgDuration * item.totalCalls,
          lastActivity: item.lastActivity
        });
        continue;
      }

      const latestStatus = !existing.lastActivity || (item.lastActivity && item.lastActivity > existing.lastActivity)
        ? item.status
        : existing.status;

      merged.set(item.name, {
        name: item.name,
        status: latestStatus,
        totalCalls: existing.totalCalls + item.totalCalls,
        successCalls: existing.successCalls + item.successCalls,
        errorCalls: existing.errorCalls + item.errorCalls,
        avgDurationWeighted: existing.avgDurationWeighted + (item.avgDuration * item.totalCalls),
        lastActivity: !existing.lastActivity || (item.lastActivity && item.lastActivity > existing.lastActivity)
          ? item.lastActivity
          : existing.lastActivity
      });
    }

    const agentStatuses = MONITORED_AGENT_ORDER.map(name => {
      const data = merged.get(name);
      if (!data) {
        return {
          name,
          status: 'idle',
          totalCalls: 0,
          successCalls: 0,
          errorCalls: 0,
          successRate: '100.0',
          avgDuration: 0,
          lastActivity: null
        };
      }

      const avgDuration = data.totalCalls > 0 ? Math.round(data.avgDurationWeighted / data.totalCalls) : 0;
      const successRate = data.totalCalls > 0 ? (data.successCalls / data.totalCalls * 100).toFixed(1) : '100.0';

      return {
        name: data.name,
        status: data.status,
        totalCalls: data.totalCalls,
        successCalls: data.successCalls,
        errorCalls: data.errorCalls,
        successRate,
        avgDuration,
        lastActivity: data.lastActivity
      };
    });

    res.json({
      success: true,
      data: {
        agents: agentStatuses,
      },
    });
  } catch (error: any) {
    console.error('获取 Agent 状态失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 状态失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取 Agent 执行日志列表
 * GET /api/admin/agents/logs
 */
router.get('/agents/logs', async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      agentName,
      agentId,
      traceId,
      sessionId,
      status,
      keyword,
      timeRange
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const timeoutErrorSignals = [
      'timeout',
      'timed out',
      'etimedout',
      'deadline exceeded',
      'request timeout',
      'socket hang up'
    ];

    const buildTimeoutCondition = () => ({
      OR: [
        { errorCode: { contains: 'TIMEOUT' } },
        ...timeoutErrorSignals.map(signal => ({ error: { contains: signal } }))
      ]
    });

    // Agent Name 到 Agent ID 的映射（反向查找）
    const monitoredAgentIds = Array.from(new Set(Object.values(AGENT_NAME_TO_IDS).flat()));

    const where: any = {
      agentId: { in: monitoredAgentIds },
      AND: [] as any[]
    };

    if (agentName) {
      const agentIds = AGENT_NAME_TO_IDS[agentName as string];
      if (agentIds) {
        where.agentId = { in: agentIds };
      } else {
        where.agentId = agentName;
      }
    }

    if (agentId) {
      const requestedAgentId = String(agentId);
      const canonicalAgentId = getCanonicalAgentId(requestedAgentId);
      const manifestEntry = getAgentManifest(canonicalAgentId);
      const candidateIds = Array.from(new Set([
        canonicalAgentId,
        ...(manifestEntry?.aliases || [])
      ]));

      where.agentId = candidateIds.length === 1
        ? candidateIds[0]
        : { in: candidateIds };
    }

    if (traceId) {
      where.AND.push({ traceId: { contains: String(traceId) } });
    }

    if (sessionId) {
      where.AND.push({ metadata: { contains: String(sessionId) } });
    }
    if (status) {
      if (status === 'success') {
        where.AND.push({ success: true });
      } else if (status === 'error') {
        where.AND.push({ success: false });
        where.AND.push({ NOT: buildTimeoutCondition() });
      } else if (status === 'timeout') {
        where.AND.push({ success: false });
        where.AND.push(buildTimeoutCondition());
      }
    }

    // 时间范围筛选
    if (timeRange && timeRange !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      switch (timeRange) {
        case 'today':
          where.calledAt = { gte: today };
          break;
        case 'yesterday': {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          where.calledAt = { gte: yesterday, lt: today };
          break;
        }
        case 'week': {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          where.calledAt = { gte: weekAgo };
          break;
        }
        case 'month': {
          const monthAgo = new Date(today);
          monthAgo.setDate(monthAgo.getDate() - 30);
          where.calledAt = { gte: monthAgo };
          break;
        }
      }
    }

    // 关键词搜索（搜索 input, output, error 字段）
    if (keyword) {
      const searchTerm = String(keyword);
      where.AND.push({
        OR: [
          { input: { contains: searchTerm } },
          { output: { contains: searchTerm } },
          { error: { contains: searchTerm } },
        ]
      });
    }

    if (!where.AND.length) {
      delete where.AND;
    }

    const buildStatusLabel = (log: { success: boolean; errorCode: string | null; error: string | null }) => {
      if (log.success) return 'success';

      const errorCode = String(log.errorCode || '').toLowerCase();
      const errorMessage = String(log.error || '').toLowerCase();
      const isTimeout = timeoutErrorSignals.some(signal =>
        errorCode.includes(signal) || errorMessage.includes(signal)
      );

      return isTimeout ? 'timeout' : 'error';
    };

    const extractSessionIdFromMetadata = (metadata: string | null) => {
      if (!metadata) return null;
      try {
        const parsed = JSON.parse(metadata);
        return parsed?.requestContext?.sessionId || parsed?.sessionId || null;
      } catch {
        return null;
      }
    };

    const extractPathPhaseInfo = (metadata: string | null) => {
      if (!metadata) {
        return {
          phase: null,
          phaseStatus: null,
          pathId: null,
          sourceConversationId: null,
          triggerSource: null
        };
      }

      try {
        const parsed = JSON.parse(metadata);
        return {
          phase: parsed?.phase || null,
          phaseStatus: parsed?.status || null,
          pathId: parsed?.pathId || null,
          sourceConversationId: parsed?.sourceConversationId || null,
          triggerSource: parsed?.triggerSource || null
        };
      } catch {
        return {
          phase: null,
          phaseStatus: null,
          pathId: null,
          sourceConversationId: null,
          triggerSource: null
        };
      }
    };

    const parseMetadata = (metadata: string | null): Record<string, any> => {
      if (!metadata) return {};
      try {
        return JSON.parse(metadata);
      } catch {
        return {};
      }
    };

    const inferExecutionIdentity = (log: {
      agentId: string;
      callerAgent: string | null;
      metadata: string | null;
    }) => {
      const parsed = parseMetadata(log.metadata);
      const providerId = typeof parsed.providerId === 'string' ? parsed.providerId : null;
      const metadataActorType = typeof parsed.actorType === 'string' ? parsed.actorType : null;
      const metadataActorId = typeof parsed.actorId === 'string' ? parsed.actorId : null;
      const skillId = typeof parsed.skillId === 'string' ? parsed.skillId : null;
      const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : null;
      const layer = typeof parsed.executionLayer === 'string'
        ? parsed.executionLayer
        : (typeof parsed.layer === 'string' ? parsed.layer : null);

      const providerActorType = providerId?.startsWith('skill:')
        ? 'skill'
        : providerId?.startsWith('agent:')
          ? 'agent'
          : null;
      const providerActorId = providerId?.includes(':') ? providerId.split(':').slice(1).join(':') : null;

      const actorType = metadataActorType
        || (skillId ? 'skill' : null)
        || providerActorType
        || (agentId && agentId !== 'api-gateway' ? 'agent' : null)
        || (log.agentId !== 'api-gateway' ? 'agent' : 'system');

      const actorId = metadataActorId
        || skillId
        || providerActorId
        || agentId
        || log.agentId;

      const executionLayer = layer === 'api-gateway-v2'
        ? 'api-gateway'
        : (layer || (actorType === 'skill' ? 'skill' : actorType === 'agent' ? 'agent' : 'system'));

      const invokerId = typeof parsed.invokerId === 'string'
        ? parsed.invokerId
        : (log.callerAgent || null);
      const invokerType = typeof parsed.invokerType === 'string'
        ? parsed.invokerType
        : (log.callerAgent ? 'agent' : null);

      return {
        parsed,
        executionLayer,
        actorType,
        actorId,
        invokerId,
        invokerType,
        providerId,
        providerType: typeof parsed.providerType === 'string' ? parsed.providerType : null,
        routeSource: typeof parsed.routeSource === 'string' ? parsed.routeSource : null,
        statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : null,
        attempts: typeof parsed.attempts === 'number' ? parsed.attempts : null,
        maxRetries: typeof parsed.maxRetries === 'number' ? parsed.maxRetries : null,
        messageCount: typeof parsed.messageCount === 'number' ? parsed.messageCount : null,
        finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : null,
      };
    };

    const [logs, total, successCount, timeoutCount, errorCount] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { calledAt: 'desc' },
      }),
      prisma.agent_call_logs.count({ where }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: true
        }
      }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: false,
          AND: [
            ...(where.AND || []),
            buildTimeoutCondition()
          ]
        }
      }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: false,
          AND: [
            ...(where.AND || []),
            { NOT: buildTimeoutCondition() }
          ]
        }
      }),
    ]);

    // 转换日志格式以兼容前端
    const formattedLogs = logs.map(log => {
      const phaseInfo = extractPathPhaseInfo(log.metadata);
      const identity = inferExecutionIdentity(log);
      return {
        id: log.id,
        agentName: AGENT_ID_TO_NAME[log.agentId] || log.agentId,
        agentId: log.agentId,
        sourceEntry: log.sourceEntry || 'platform',
        callerAgent: log.callerAgent,
        action: 'invoke',
        status: buildStatusLabel(log),
        input: log.input,
        output: log.output,
        error: log.error,
        traceId: log.traceId,
        sessionId: extractSessionIdFromMetadata(log.metadata),
        durationMs: log.durationMs,
        createdAt: log.calledAt,
        metadata: log.metadata,
        executionLayer: identity.executionLayer,
        actorType: identity.actorType,
        actorId: identity.actorId,
        invokerId: identity.invokerId,
        invokerType: identity.invokerType,
        providerId: identity.providerId,
        providerType: identity.providerType,
        routeSource: identity.routeSource,
        statusCode: identity.statusCode,
        attempts: identity.attempts,
        maxRetries: identity.maxRetries,
        messageCount: identity.messageCount,
        finishReason: identity.finishReason,
        phase: phaseInfo.phase,
        phaseStatus: phaseInfo.phaseStatus,
        pathId: phaseInfo.pathId,
        sourceConversationId: phaseInfo.sourceConversationId,
        triggerSource: phaseInfo.triggerSource,
      };
    });

    res.json({
      success: true,
      data: {
        logs: formattedLogs,
        stats: {
          total,
          success: successCount,
          timeout: timeoutCount,
          error: errorCount
        },
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error: any) {
    console.error('获取 Agent 日志失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 日志失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取目标对话列表
 * GET /api/admin/conversations
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [conversations, total] = await Promise.all([
      prisma.goal_conversations.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          status: true,
          stage: true,
          description: true,
          messages: true,
          collectedData: true,
          completedAt: true,
          learningPathId: true,
          createdAt: true,
          updatedAt: true,
          users: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.goal_conversations.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error: any) {
    console.error('获取对话列表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取对话列表失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取对话详情
 * GET /api/admin/conversations/:id
 */
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.goal_conversations.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: {
          message: '对话不存在',
          status: 404,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error: any) {
    console.error('获取对话详情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取对话详情失败',
        status: 500,
      },
    });
  }
});

/**
 * GET /api/admin/stats
 * 平台统计数据的别名端点（兼容旧版）
 */
router.get('/stats', async (req: Request, res: Response) => {
  // 重定向到 /overview/stats - 直接调用逻辑
  res.redirect('/api/admin/overview/stats');
});

/**
 * GET /api/admin/activity
 * 获取最近活动日志
 */
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // 最近的学习会话
    const recentSessions = await prisma.teaching_sessions.findMany({
      take: limit,
      orderBy: { startTime: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    const sessionTaskIds = Array.from(new Set(recentSessions.map((session) => session.taskId).filter(Boolean)));
    const sessionTasks = sessionTaskIds.length > 0
      ? await prisma.subtasks.findMany({
          where: { id: { in: sessionTaskIds } },
          select: { id: true, title: true },
        })
      : [];
    const sessionTaskMap = new Map(sessionTasks.map((task) => [task.id, task]));

    // 最近注册的用户
    const recentUsers = await prisma.users.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    // 最近完成的任务
    const completedTasks = await prisma.subtasks.findMany({
      take: 20,
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    res.json({
      success: true,
      data: {
        recentSessions: recentSessions.map((session) => ({
          ...session,
          user: session.users
            ? {
                id: session.users.id,
                email: session.users.email,
                name: session.users.name,
              }
            : null,
          task: sessionTaskMap.get(session.taskId)
            ? {
                id: session.taskId,
                title: sessionTaskMap.get(session.taskId)?.title,
              }
            : null,
        })),
        recentUsers,
        completedTasks
      }
    });
  } catch (error: any) {
    console.error('获取活动日志失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取活动日志失败',
        status: 500
      }
    });
  }
});

/**
 * GET /api/admin/teaching-sessions
 * 教学会话调试视图：聚焦 wrapup / advisory
 */
router.get('/teaching-sessions', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const userId = (req.query.userId as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const onlyWithAdvisory = String(req.query.onlyWithAdvisory || '') === 'true';

    const where: any = {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
      ...(onlyWithAdvisory ? { advisory: { not: null } } : {}),
    };

    const [total, sessions] = await Promise.all([
      prisma.teaching_sessions.count({ where }),
      prisma.teaching_sessions.findMany({
        where,
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          users: {
            select: { id: true, name: true, email: true }
          }
        }
      })
    ]);

    const items = sessions.map((session) => {
      const wrapup = session.wrapup ? JSON.parse(session.wrapup) : null;
      const advisory = session.advisory ? JSON.parse(session.advisory) : null;
      const messages = session.messages ? JSON.parse(session.messages) : [];
      const knowledgePoints = session.knowledgeState ? JSON.parse(session.knowledgeState) : [];

      return {
        id: session.id,
        userId: session.userId,
        userName: session.users?.name || null,
        email: session.users?.email || null,
        taskId: session.taskId,
        learningPathId: session.learningPathId,
        milestoneId: session.milestoneId,
        subject: session.subject,
        topic: session.topic,
        taskType: session.taskType,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        messageCount: Array.isArray(messages) ? messages.filter((m: any) => m?.role === 'user').length : 0,
        knowledgePointCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
        wrapup,
        advisory,
      };
    });

    res.json({
      success: true,
      data: {
        page,
        limit,
        total,
        items,
      }
    });
  } catch (error: any) {
    console.error('获取教学会话调试数据失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取教学会话调试数据失败',
        status: 500
      }
    });
  }
});

/**
 * 获取学生状态基线
 * GET /platform/student-state
 */
router.get('/student-state', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).query.userId as string;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 userId 参数' }
      });
    }
    
    const { studentBaselineService } = await import('../../services/student-baseline.service');
    const baselineStats = await studentBaselineService.getBaselineStats(userId);
    
    res.json({
      success: true,
      data: baselineStats
    });
  } catch (error: any) {
    console.error('获取学生状态基线失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取学生状态基线失败' }
    });
  }
});

export default router;
