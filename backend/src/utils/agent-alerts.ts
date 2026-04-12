/**
 * Agent 监控告警工具
 * 用于检测 Agent 运行异常并发送告警
 */

import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export interface AlertConfig {
  errorRateThreshold: number; // 错误率阈值（默认 10%）
  latencyThreshold: number; // 延迟阈值（毫秒，默认 5000ms）
  checkInterval: number; // 检查间隔（毫秒，默认 300000ms = 5 分钟）
  alertCooldown: number; // 告警冷却时间（毫秒，默认 600000ms = 10 分钟）
}

export interface AlertRecord {
  agentId: string;
  alertType: 'HIGH_ERROR_RATE' | 'HIGH_LATENCY' | 'LOW_THROUGHPUT' | 'SYSTEM_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  metrics: any;
  timestamp: Date;
}

const defaultConfig: AlertConfig = {
  errorRateThreshold: 0.1, // 10% 错误率
  latencyThreshold: 5000, // 5 秒延迟
  checkInterval: 300000, // 5 分钟检查一次
  alertCooldown: 600000 // 10 分钟冷却时间
};

// 记录上次告警时间，避免重复告警
const lastAlertTime: Map<string, number> = new Map();

export class AgentAlerts {
  private config: AlertConfig;

  constructor(config?: Partial<AlertConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * 检查高错误率
   */
  async checkHighErrorRate(agentId?: string): Promise<AlertRecord | null> {
    try {
      const oneHourAgo = new Date(Date.now() - 3600000);

      const where: any = {
        calledAt: { gte: oneHourAgo }
      };

      if (agentId) {
        where.agentId = agentId;
      }

      const stats = await prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where,
        _count: true
      });

      for (const stat of stats) {
        const totalCalls = stat._count;
        
        // 获取成功次数
        const successCount = await prisma.agent_call_logs.count({
          where: { ...where, agentId: stat.agentId, success: true }
        });
        
        const errorRate = 1 - (successCount / totalCalls);

        if (errorRate > this.config.errorRateThreshold && totalCalls >= 5) {
          const alertKey = `ERROR_RATE_${stat.agentId}`;
          
          // 检查冷却时间
          if (this.isInCooldown(alertKey)) {
            return null;
          }

          const severity = errorRate > 0.3 ? 'CRITICAL' : errorRate > 0.2 ? 'HIGH' : 'MEDIUM';
          
          const alert: AlertRecord = {
            agentId: stat.agentId,
            alertType: 'HIGH_ERROR_RATE',
            severity,
            message: `${stat.agentId} 错误率过高：${(errorRate * 100).toFixed(1)}% (${totalCalls} 次调用中失败 ${totalCalls - successCount} 次)`,
            metrics: {
              totalCalls,
              successCalls: successCount,
              errorRate,
              timeWindow: '1h'
            },
            timestamp: new Date()
          };

          this.logAlert(alert);
          this.setAlertCooldown(alertKey);

          return alert;
        }
      }

      return null;
    } catch (error) {
      logger.error('[AgentAlerts] 检查错误率失败', error);
      return null;
    }
  }

  /**
   * 检查高延迟
   */
  async checkHighLatency(agentId?: string): Promise<AlertRecord | null> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 300000);

      const where: any = {
        calledAt: { gte: fiveMinutesAgo }
      };

      if (agentId) {
        where.agentId = agentId;
      }

      const recentCalls = await prisma.agent_call_logs.findMany({
        where,
        orderBy: { calledAt: 'desc' },
        take: 20
      });

      if (recentCalls.length < 3) {
        return null; // 样本太少
      }

      const avgLatency = recentCalls.reduce((sum, call) => sum + call.durationMs, 0) / recentCalls.length;

      if (avgLatency > this.config.latencyThreshold) {
        const alertKey = `HIGH_LATENCY_${agentId || 'ALL'}`;
        
        if (this.isInCooldown(alertKey)) {
          return null;
        }

        const severity = avgLatency > 10000 ? 'HIGH' : avgLatency > 7000 ? 'MEDIUM' : 'LOW';

        const alert: AlertRecord = {
          agentId: agentId || 'ALL',
          alertType: 'HIGH_LATENCY',
          severity,
          message: `Agent 响应延迟过高：平均 ${avgLatency.toFixed(0)}ms（阈值 ${this.config.latencyThreshold}ms）`,
          metrics: {
            avgLatency,
            maxLatency: Math.max(...recentCalls.map(c => c.durationMs)),
            minLatency: Math.min(...recentCalls.map(c => c.durationMs)),
            sampleSize: recentCalls.length,
            timeWindow: '5m'
          },
          timestamp: new Date()
        };

        this.logAlert(alert);
        this.setAlertCooldown(alertKey);

        return alert;
      }

      return null;
    } catch (error) {
      logger.error('[AgentAlerts] 检查延迟失败', error);
      return null;
    }
  }

  /**
   * 检查低吞吐量（调用量骤降）
   */
  async checkLowThroughput(agentId?: string): Promise<AlertRecord | null> {
    try {
      const now = Date.now();
      const last30Minutes = new Date(now - 1800000);
      const previous30Minutes = new Date(now - 3600000);

      const where: any = {
        calledAt: { gte: last30Minutes }
      };

      if (agentId) {
        where.agentId = agentId;
      }

      const [currentCalls, previousCalls] = await Promise.all([
        prisma.agent_call_logs.count({ where }),
        prisma.agent_call_logs.count({
          where: {
            ...where,
            calledAt: { gte: previous30Minutes, lte: last30Minutes }
          }
        })
      ]);

      // 如果当前调用量少于之前的 30% 且之前有足够调用
      if (previousCalls >= 10 && currentCalls < previousCalls * 0.3) {
        const alertKey = `LOW_THROUGHPUT_${agentId || 'ALL'}`;
        
        if (this.isInCooldown(alertKey)) {
          return null;
        }

        const alert: AlertRecord = {
          agentId: agentId || 'ALL',
          alertType: 'LOW_THROUGHPUT',
          severity: 'MEDIUM',
          message: `Agent 调用量骤降：当前 30 分钟 ${currentCalls} 次，之前 ${previousCalls} 次`,
          metrics: {
            currentCalls,
            previousCalls,
            dropRate: 1 - (currentCalls / previousCalls),
            timeWindow: '30m'
          },
          timestamp: new Date()
        };

        this.logAlert(alert);
        this.setAlertCooldown(alertKey);

        return alert;
      }

      return null;
    } catch (error) {
      logger.error('[AgentAlerts] 检查吞吐量失败', error);
      return null;
    }
  }

  /**
   * 记录系统级错误
   */
  async logSystemError(agentId: string, error: string, errorCode?: string): Promise<void> {
    const alert: AlertRecord = {
      agentId,
      alertType: 'SYSTEM_ERROR',
      severity: 'HIGH',
      message: `系统错误：${error}`,
      metrics: {
        errorCode,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.logAlert(alert);
  }

  /**
   * 获取所有告警记录
   */
  async getRecentAlerts(limit: number = 50): Promise<AlertRecord[]> {
    // 这里可以从数据库读取，目前先返回空数组
    // 后续可以创建 agent_alerts 表来存储
    return [];
  }

  /**
   * 检查所有告警
   */
  async checkAllAlerts(): Promise<AlertRecord[]> {
    const alerts: (AlertRecord | null)[] = await Promise.all([
      this.checkHighErrorRate(),
      this.checkHighLatency(),
      this.checkLowThroughput()
    ]);

    return alerts.filter((alert): alert is AlertRecord => alert !== null);
  }

  /**
   * 检查是否在冷却时间
   */
  private isInCooldown(alertKey: string): boolean {
    const lastTime = lastAlertTime.get(alertKey);
    if (!lastTime) return false;

    const now = Date.now();
    return now - lastTime < this.config.alertCooldown;
  }

  /**
   * 设置告警冷却
   */
  private setAlertCooldown(alertKey: string): void {
    lastAlertTime.set(alertKey, Date.now());
  }

  /**
   * 记录告警到日志
   */
  private logAlert(alert: AlertRecord): void {
    const logMessage = `[告警] ${alert.severity} - ${alert.agentId} - ${alert.alertType}: ${alert.message}`;
    
    switch (alert.severity) {
      case 'CRITICAL':
      case 'HIGH':
        logger.error(logMessage, alert.metrics);
        break;
      case 'MEDIUM':
        logger.warn(logMessage, alert.metrics);
        break;
      case 'LOW':
        logger.info(logMessage, alert.metrics);
        break;
    }

    // TODO: 发送到外部告警系统（如钉钉、企业微信、Slack 等）
    // await this.sendExternalAlert(alert);
  }

  /**
   * 发送外部告警（待实现）
   */
  private async sendExternalAlert(alert: AlertRecord): Promise<void> {
    // TODO: 实现外部告警通知
    // 可以集成钉钉机器人、企业微信、Slack Webhook 等
  }
}

// 导出单例实例
export const agentAlerts = new AgentAlerts();

export default agentAlerts;
