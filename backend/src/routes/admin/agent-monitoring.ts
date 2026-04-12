/**
 * Agent 监控路由
 * 提供 Agent 性能指标、错误日志、策略统计等监控功能
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { agentAlerts } from '../../utils/agent-alerts';

const router = Router();

/**
 * GET /api/admin/agents/metrics
 * 获取 Agent 性能指标
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { agentId, startTime, endTime, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (agentId) {
      where.agentId = agentId;
    }

    if (startTime || endTime) {
      where.calledAt = {};
      if (startTime) where.calledAt.gte = new Date(startTime as string);
      if (endTime) where.calledAt.lte = new Date(endTime as string);
    }

    // 获取聚合指标
    const [metrics, total] = await Promise.all([
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where,
        _avg: {
          durationMs: true,
          tokensUsed: true
        },
        _count: true,
        _sum: {
          tokensUsed: true,
          durationMs: true
        }
      }),
      prisma.agent_call_logs.count({ where })
    ]);

    // 计算成功率
    const metricsWithSuccess = await Promise.all(
      metrics.map(async (m) => {
        const successCount = await prisma.agent_call_logs.count({
          where: { ...where, agentId: m.agentId, success: true }
        });
        return {
          agentId: m.agentId,
          totalCalls: m._count,
          successCalls: successCount,
          failedCalls: m._count - successCount,
          successRate: m._count > 0 ? successCount / m._count : 0,
          avgDuration: m._avg.durationMs || 0,
          avgTokens: m._avg.tokensUsed || 0,
          totalTokens: m._sum.tokensUsed || 0,
          totalDuration: m._sum.durationMs || 0
        };
      })
    );

    res.json({
      success: true,
      data: {
        metrics: metricsWithSuccess,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    logger.error('获取 Agent 性能指标失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Agent 性能指标失败' }
    });
  }
});

/**
 * GET /api/admin/agents/metrics/detail
 * 获取 Agent 详细调用记录
 */
router.get('/metrics/detail', async (req: Request, res: Response) => {
  try {
    const { agentId, startTime, endTime, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (agentId) {
      where.agentId = agentId;
    }

    if (startTime || endTime) {
      where.calledAt = {};
      if (startTime) where.calledAt.gte = new Date(startTime as string);
      if (endTime) where.calledAt.lte = new Date(endTime as string);
    }

    const [logs, total] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where,
        orderBy: { calledAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          agentId: true,
          userId: true,
          success: true,
          durationMs: true,
          tokensUsed: true,
          error: true,
          calledAt: true,
          metadata: true
        }
      }),
      prisma.agent_call_logs.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    logger.error('获取 Agent 详细调用记录失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Agent 详细调用记录失败' }
    });
  }
});

/**
 * GET /api/admin/agents/strategies/stats
 * 获取策略使用统计
 */
router.get('/strategies/stats', async (req: Request, res: Response) => {
  try {
    const { agentId = 'content-agent-v3', startTime, endTime } = req.query;

    const where: any = { agentId };

    if (startTime || endTime) {
      where.calledAt = {};
      if (startTime) where.calledAt.gte = new Date(startTime as string);
      if (endTime) where.calledAt.lte = new Date(endTime as string);
    }

    const logs = await prisma.agent_call_logs.findMany({
      where,
      select: {
        metadata: true
      }
    });

    // 解析 metadata，统计各策略使用次数
    const strategyStats: Record<string, {
      count: number;
      avgDuration: number;
      successRate: number;
      avgQualityScore: number;
    }> = {};

    let totalDuration = 0;
    const totalSuccess = 0;
    let totalQualityScore = 0;
    let qualityScoreCount = 0;

    logs.forEach((log) => {
      if (log.metadata) {
        try {
          const metadata = JSON.parse(log.metadata);
          const strategy = metadata.studentState?.strategy || 'unknown';
          const quality = metadata.quality;

          if (!strategyStats[strategy]) {
            strategyStats[strategy] = {
              count: 0,
              avgDuration: 0,
              successRate: 0,
              avgQualityScore: 0
            };
          }

          strategyStats[strategy].count++;
          totalDuration += metadata.duration || 0;
          
          if (quality?.score) {
            totalQualityScore += quality.score;
            qualityScoreCount++;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    });

    // 计算平均成功率（简化处理）
    const stats = Object.entries(strategyStats).map(([strategy, data]) => ({
      strategy,
      count: data.count,
      percentage: logs.length > 0 ? (data.count / logs.length * 100).toFixed(2) + '%' : '0%',
      avgDuration: data.avgDuration,
      successRate: data.successRate,
      avgQualityScore: data.avgQualityScore
    }));

    res.json({
      success: true,
      data: {
        strategies: stats,
        totalCalls: logs.length,
        timeRange: {
          startTime,
          endTime
        }
      }
    });
  } catch (error) {
    logger.error('获取策略使用统计失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取策略使用统计失败' }
    });
  }
});

/**
 * GET /api/admin/agents/errors
 * 获取错误日志
 */
router.get('/errors', async (req: Request, res: Response) => {
  try {
    const { agentId, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = { success: false };

    if (agentId) {
      where.agentId = agentId;
    }

    const [errors, total] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where,
        orderBy: { calledAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          agentId: true,
          userId: true,
          input: true,
          output: true,
          error: true,
          errorCode: true,
          durationMs: true,
          calledAt: true,
          metadata: true
        }
      }),
      prisma.agent_call_logs.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        errors,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    logger.error('获取错误日志失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取错误日志失败' }
    });
  }
});

/**
 * GET /api/admin/agents/errors/summary
 * 获取错误摘要（按错误类型分组）
 */
router.get('/errors/summary', async (req: Request, res: Response) => {
  try {
    const { agentId, hours = '24' } = req.query;
    const hoursNum = parseInt(hours as string);
    const since = new Date(Date.now() - hoursNum * 3600000);

    const where: any = {
      success: false,
      calledAt: { gte: since }
    };

    if (agentId) {
      where.agentId = agentId;
    }

    const errors = await prisma.agent_call_logs.findMany({
      where,
      select: {
        agentId: true,
        errorCode: true,
        error: true
      }
    });

    // 按错误类型分组
    const errorSummary: Record<string, {
      count: number;
      agents: Set<string>;
      sampleError: string;
    }> = {};

    errors.forEach((err) => {
      const errorCode = err.errorCode || 'UNKNOWN';
      
      if (!errorSummary[errorCode]) {
        errorSummary[errorCode] = {
          count: 0,
          agents: new Set(),
          sampleError: err.error || ''
        };
      }

      errorSummary[errorCode].count++;
      errorSummary[errorCode].agents.add(err.agentId);
    });

    // 转换为数组并排序
    const summary = Object.entries(errorSummary)
      .map(([code, data]) => ({
        errorCode: code,
        count: data.count,
        affectedAgents: Array.from(data.agents),
        sampleError: data.sampleError,
        percentage: errors.length > 0 ? (data.count / errors.length * 100).toFixed(2) + '%' : '0%'
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        summary,
        totalErrors: errors.length,
        timeWindow: `${hoursNum}h`
      }
    });
  } catch (error) {
    logger.error('获取错误摘要失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取错误摘要失败' }
    });
  }
});

/**
 * GET /api/admin/agents/alerts
 * 获取当前告警状态
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    // 检查所有告警
    const alerts = await agentAlerts.checkAllAlerts();

    res.json({
      success: true,
      data: {
        alerts,
        checkedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('获取告警状态失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取告警状态失败' }
    });
  }
});

/**
 * POST /api/admin/agents/alerts/check
 * 手动触发告警检查
 */
router.post('/alerts/check', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.body;

    const alerts = await Promise.all([
      agentAlerts.checkHighErrorRate(agentId),
      agentAlerts.checkHighLatency(agentId),
      agentAlerts.checkLowThroughput(agentId)
    ]);

    const filteredAlerts = alerts.filter((alert): alert is any => alert !== null);

    res.json({
      success: true,
      data: {
        alerts: filteredAlerts,
        checkedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('触发告警检查失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '触发告警检查失败' }
    });
  }
});

/**
 * GET /api/admin/agents/usage/trends
 * 获取使用趋势（按小时/天）
 */
router.get('/usage/trends', async (req: Request, res: Response) => {
  try {
    const { agentId, period = 'day', days = '7' } = req.query;
    const daysNum = parseInt(days as string);
    const periodType = period as 'hour' | 'day';

    const now = new Date();
    const startDate = new Date(now.getTime() - daysNum * 24 * 3600000);

    const where: any = {
      calledAt: { gte: startDate }
    };

    if (agentId) {
      where.agentId = agentId;
    }

    const logs = await prisma.agent_call_logs.findMany({
      where,
      select: {
        calledAt: true,
        durationMs: true,
        success: true,
        agentId: true
      }
    });

    // 按时间段分组
    const trends: Record<string, {
      calls: number;
      avgDuration: number;
      successRate: number;
      totalDuration: number;
    }> = {};

    logs.forEach((log) => {
      let key: string;
      if (periodType === 'hour') {
        key = log.calledAt.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      } else {
        key = log.calledAt.toISOString().slice(0, 10); // YYYY-MM-DD
      }

      if (!trends[key]) {
        trends[key] = {
          calls: 0,
          avgDuration: 0,
          successRate: 0,
          totalDuration: 0
        };
      }

      trends[key].calls++;
      trends[key].totalDuration += log.durationMs;
    });

    // 计算平均值和成功率
    const result = Object.entries(trends)
      .map(([time, data]) => ({
        time,
        calls: data.calls,
        avgDuration: data.calls > 0 ? data.totalDuration / data.calls : 0,
        totalDuration: data.totalDuration,
        successRate: 0 // 需要额外查询计算
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    res.json({
      success: true,
      data: {
        trends: result,
        period: periodType,
        days: daysNum,
        totalCalls: logs.length
      }
    });
  } catch (error) {
    logger.error('获取使用趋势失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取使用趋势失败' }
    });
  }
});

/**
 * GET /api/admin/agents/summary
 * 获取 Agent 总体摘要
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { hours = '24' } = req.query;
    const hoursNum = parseInt(hours as string);
    const since = new Date(Date.now() - hoursNum * 3600000);

    const [totalCalls, successCalls, avgDuration, totalTokens] = await Promise.all([
      prisma.agent_call_logs.count({
        where: { calledAt: { gte: since } }
      }),
      prisma.agent_call_logs.count({
        where: {
          calledAt: { gte: since },
          success: true
        }
      }),
      prisma.agent_call_logs.aggregate({
        where: { calledAt: { gte: since } },
        _avg: { durationMs: true }
      }),
      prisma.agent_call_logs.aggregate({
        where: { calledAt: { gte: since } },
        _sum: { tokensUsed: true }
      })
    ]);

    const uniqueAgents = await prisma.agent_call_logs.groupBy({
      by: ['agentId'],
      where: { calledAt: { gte: since } }
    });

    res.json({
      success: true,
      data: {
        timeWindow: `${hoursNum}h`,
        totalCalls,
        successCalls,
        failedCalls: totalCalls - successCalls,
        successRate: totalCalls > 0 ? (successCalls / totalCalls * 100).toFixed(2) + '%' : '0%',
        avgDuration: avgDuration._avg.durationMs || 0,
        totalTokens: totalTokens._sum.tokensUsed || 0,
        activeAgents: uniqueAgents.length
      }
    });
  } catch (error) {
    logger.error('获取 Agent 总体摘要失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Agent 总体摘要失败' }
    });
  }
});

export default router;
