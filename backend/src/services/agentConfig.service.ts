/**
 * Agent Prompt 配置服务
 * 支持从数据库读取版本化的 Prompt 配置
 * 用于 Platform 层 Agent 读取 Lab 层管理的 Prompt
 */

import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import { AgentLogger } from '../utils/agent-logger';
import { agentAlerts } from '../utils/agent-alerts';

export interface PromptConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  model: string;
  version: number;
}

export interface AgentOverrideConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  apiKey?: string;
  systemPrompt?: string;
}

export interface AgentConfigStore {
  [agentName: string]: AgentOverrideConfig;
}

export interface AgentCallMetrics {
  agentId: string;
  userId: string;
  promptVersion: number;
  duration: number;
  tokensUsed: number;
  success: boolean;
  error?: string;
  input?: any;
  output?: any;
  studentState?: {
    frustration: number;
    problemClarity: number;
    strategy: string;
    [key: string]: any;
  };
  quality?: {
    score: number;
    latency: number;
    userSatisfaction?: number;
  };
}

/**
 * AgentConfigService 类
 * 用于从 AgentPrompt 表读取版本化的 Prompt 配置
 */
export class AgentConfigService {
  /**
   * 记录 Agent 调用日志
   */
  async recordAgentCall(metrics: AgentCallMetrics): Promise<void> {
    try {
      await prisma.agent_call_logs.create({
        data: {
          id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          agentId: metrics.agentId,
          userId: metrics.userId,
          input: metrics.input ? JSON.stringify(metrics.input) : null,
          output: metrics.output ? JSON.stringify(metrics.output) : null,
          success: metrics.success,
          durationMs: metrics.duration,
          tokensUsed: metrics.tokensUsed,
          error: metrics.error,
          calledAt: new Date(),
          metadata: JSON.stringify({
            promptVersion: metrics.promptVersion,
            studentState: metrics.studentState,
            quality: metrics.quality
          })
        }
      });

      // 同时记录到日志系统
      AgentLogger.logPerformance({
        agentId: metrics.agentId,
        action: 'prompt_execution',
        duration: metrics.duration,
        tokensUsed: metrics.tokensUsed,
        success: metrics.success,
        promptVersion: metrics.promptVersion
      });

      // 如果失败，记录告警
      if (!metrics.success && metrics.error) {
        await agentAlerts.logSystemError(metrics.agentId, metrics.error, 'EXECUTION_ERROR');
      }
    } catch (error) {
      logger.error('记录 Agent 调用日志失败', error);
    }
  }

  /**
   * 获取当前活跃的 Prompt 配置
   */
  async getActivePrompt(agentId: string): Promise<PromptConfig | null> {
    try {
      const prompt = await prisma.agent_prompts.findFirst({
        where: {
          agentId,
          status: 'ACTIVE'
        },
        orderBy: {
          version: 'desc'
        }
      });

      if (!prompt) {
        logger.warn(`No active prompt found for agent: ${agentId}`);
        return null;
      }

      return {
        systemPrompt: prompt.systemPrompt,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        model: prompt.model,
        version: prompt.version
      };
    } catch (error) {
      logger.error(`获取活跃 Prompt 失败：${agentId}`, error);
      return null;
    }
  }

  /**
   * 获取特定版本的 Prompt
   */
  async getPromptByVersion(agentId: string, version: number): Promise<PromptConfig | null> {
    try {
      const prompt = await prisma.agent_prompts.findUnique({
        where: {
          agentId_version: {
            agentId,
            version
          }
        }
      });

      return prompt ? {
        systemPrompt: prompt.systemPrompt,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        model: prompt.model,
        version: prompt.version
      } : null;
    } catch (error) {
      logger.error(`获取特定版本 Prompt 失败：${agentId} v${version}`, error);
      return null;
    }
  }

  /**
   * 更新使用统计（调用 AI 后更新）
   * @deprecated 使用 recordAgentCall 替代
   */
  async updateStats(agentId: string, version: number, latency: number, success: boolean): Promise<void> {
    try {
      const prompt = await prisma.agent_prompts.findUnique({
        where: {
          agentId_version: { agentId, version }
        }
      });

      if (!prompt) return;

      const newUseCount = prompt.useCount + 1;
      const newAvgLatency = ((prompt.avgLatency || 0) * prompt.useCount + latency) / newUseCount;
      const newSuccessRate = ((prompt.successRate || 0) * prompt.useCount + (success ? 1 : 0)) / newUseCount;

      await prisma.agent_prompts.update({
        where: {
          agentId_version: { agentId, version }
        },
        data: {
          useCount: newUseCount,
          avgLatency: newAvgLatency,
          successRate: newSuccessRate
        }
      });

      logger.debug(`Prompt 统计已更新：${agentId} v${version}`, {
        useCount: newUseCount,
        avgLatency: newAvgLatency,
        successRate: newSuccessRate
      });
    } catch (error) {
      logger.error(`更新 Prompt 统计失败：${agentId} v${version}`, error);
    }
  }

  /**
   * 记录策略选择日志
   */
  static logStrategySelection(data: {
    userId: string;
    sessionId: string;
    studentState: any;
    selectedStrategy: string;
    strategyReason: string;
  }): void {
    AgentLogger.logStrategySelection({
      userId: data.userId,
      sessionId: data.sessionId,
      studentState: data.studentState,
      selectedStrategy: data.selectedStrategy,
      strategyReason: data.strategyReason
    });
  }

  /**
   * 记录内容生成日志
   */
  static logContentGeneration(data: {
    userId: string;
    sessionId: string;
    strategy: string;
    uiType: string;
    difficulty: number;
    duration: number;
    qualityScore: number;
    tokensUsed?: number;
  }): void {
    AgentLogger.logContentGeneration({
      userId: data.userId,
      sessionId: data.sessionId,
      strategy: data.strategy,
      uiType: data.uiType,
      difficulty: data.difficulty,
      duration: data.duration,
      qualityScore: data.qualityScore,
      tokensUsed: data.tokensUsed
    });
  }

  /**
   * 记录错误日志
   */
  static logError(data: {
    userId: string;
    sessionId: string;
    error: string;
    stack?: string;
    errorCode?: string;
  }): void {
    AgentLogger.logError({
      userId: data.userId,
      sessionId: data.sessionId,
      error: data.error,
      stack: data.stack,
      errorCode: data.errorCode
    });
  }
}

// 导出单例实例
export const agentConfigService = new AgentConfigService();

// ==================== 以下保持向后兼容 ====================

/**
 * 从数据库获取某个 Agent 的配置（从 AgentLabConfig 表）
 */
export async function getAgentConfig(agentName: string): Promise<AgentOverrideConfig | null> {
  try {
    const config = await prisma.agent_lab_configs.findUnique({
      where: { agentName }
    });

    if (!config) return null;

    return {
      model: config.model || undefined,
      temperature: config.temperature || undefined,
      maxTokens: config.maxTokens || undefined,
      baseURL: config.baseURL || undefined,
      apiKey: config.apiKey || undefined,
      systemPrompt: config.systemPrompt || undefined
    };
  } catch (error) {
    logger.error(`获取 Agent 配置失败：${agentName}`, error);
    return null;
  }
}

/**
 * 获取所有 Agent 配置
 */
export async function getAllAgentConfigs(): Promise<AgentConfigStore> {
  try {
    const configs = await prisma.agent_lab_configs.findMany();

    const result: AgentConfigStore = {};
    configs.forEach(config => {
      result[config.agentName] = {
        model: config.model || undefined,
        temperature: config.temperature || undefined,
        maxTokens: config.maxTokens || undefined,
        baseURL: config.baseURL || undefined,
        apiKey: config.apiKey || undefined,
        systemPrompt: config.systemPrompt || undefined
      };
    });

    return result;
  } catch (error) {
    logger.error('获取所有 Agent 配置失败', error);
    return {};
  }
}

/**
 * 更新某个 Agent 的配置
 */
export async function updateAgentConfig(
  agentName: string,
  config: Partial<AgentOverrideConfig>
): Promise<AgentOverrideConfig | null> {
  try {
    // 清理空值
    const cleanConfig: any = {};
    Object.entries(config).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        cleanConfig[key] = value;
      }
    });

    // 如果配置为空，删除记录
    if (Object.keys(cleanConfig).length === 0) {
      await prisma.agent_lab_configs.deleteMany({
        where: { agentName }
      });
      return null;
    }

    // 更新或创建配置
    const updated = await prisma.agent_lab_configs.upsert({
      where: { agentName },
      update: cleanConfig,
      create: {
        agentName,
        ...cleanConfig
      }
    });

    logger.info(`Agent 配置已更新：${agentName}`, cleanConfig);

    return {
      model: updated.model || undefined,
      temperature: updated.temperature || undefined,
      maxTokens: updated.maxTokens || undefined,
      baseURL: updated.baseURL || undefined,
      apiKey: updated.apiKey || undefined,
      systemPrompt: updated.systemPrompt || undefined
    };
  } catch (error) {
    logger.error(`更新 Agent 配置失败：${agentName}`, error);
    return null;
  }
}

/**
 * 删除某个 Agent 的配置（恢复使用平台默认）
 */
export async function deleteAgentConfig(agentName: string): Promise<void> {
  try {
    await prisma.agent_lab_configs.deleteMany({
      where: { agentName }
    });
    logger.info(`Agent 配置已删除：${agentName}`);
  } catch (error) {
    logger.error(`删除 Agent 配置失败：${agentName}`, error);
  }
}

/**
 * 清空所有 Agent 配置
 */
export async function clearAllAgentConfigs(): Promise<void> {
  try {
    await prisma.agent_lab_configs.deleteMany();
    logger.info('所有 Agent 配置已清空');
  } catch (error) {
    logger.error('清空 Agent 配置失败', error);
  }
}

/**
 * 获取 Agent 实际使用的模型
 * 优先级：Agent 独立配置 > 平台默认
 */
export async function getEffectiveModel(
  agentName: string,
  platformDefaultModel: string
): Promise<string> {
  const agentConfig = await getAgentConfig(agentName);
  return agentConfig?.model || platformDefaultModel;
}

export default {
  getAgentConfig,
  getAllAgentConfigs,
  updateAgentConfig,
  deleteAgentConfig,
  clearAllAgentConfigs,
  getEffectiveModel,
  // 新增 Prompt 配置服务
  agentConfigService,
  // 新增日志方法
  logStrategySelection: AgentConfigService.logStrategySelection,
  logContentGeneration: AgentConfigService.logContentGeneration,
  logError: AgentConfigService.logError
};