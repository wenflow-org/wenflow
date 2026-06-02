// API配置管理服务 - 持久化版本
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { getAPIGateway } from '../gateway/api-gateway';

const prisma = new PrismaClient();

export interface APIConfig {
  apiUrl: string;
  apiKey: string;
  availableModels: string[];
  defaultModel: string;
  defaultReasoningModel: string;
  defaultEvaluationModel: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  reasoningEndpoint?: string;
  lightEndpoint?: string;
  chatModels?: string[];
  reasoningModels?: string[];
  lightModels?: string[];
}

const defaultConfig: APIConfig = {
  apiUrl: process.env.AI_API_URL || '',
  apiKey: process.env.AI_API_KEY || '',
  availableModels: [],
  defaultModel: process.env.AI_MODEL || '',
  defaultReasoningModel: process.env.AI_MODEL_REASONING || '',
  defaultEvaluationModel: process.env.AI_MODEL_REASONING || '',
  defaultTemperature: 0.7,
  defaultMaxTokens: 2048,
  reasoningEndpoint: undefined,
  lightEndpoint: undefined,
  chatModels: [],
  reasoningModels: [],
  lightModels: [],
};

class APIConfigService {
  /**
   * 获取当前配置（从数据库读取）
   */
  async getConfig(): Promise<APIConfig> {
    try {
      const dbConfig = await prisma.platform_api_configs.findUnique({
        where: { id: 'platform' },
      });

      if (dbConfig) {
        return {
          apiUrl: dbConfig.apiUrl || defaultConfig.apiUrl,
          apiKey: dbConfig.apiKey || defaultConfig.apiKey,
          availableModels: dbConfig.availableModels 
            ? dbConfig.availableModels.split(',').filter(m => m.trim()) 
            : defaultConfig.availableModels,
          defaultModel: dbConfig.defaultModel || defaultConfig.defaultModel,
          defaultReasoningModel: dbConfig.defaultReasoningModel || defaultConfig.defaultReasoningModel,
          defaultEvaluationModel: dbConfig.defaultEvaluationModel || defaultConfig.defaultEvaluationModel,
          defaultTemperature: dbConfig.defaultTemperature ?? defaultConfig.defaultTemperature,
          defaultMaxTokens: dbConfig.defaultMaxTokens ?? defaultConfig.defaultMaxTokens,
          reasoningEndpoint: dbConfig.reasoningEndpoint || undefined,
          lightEndpoint: dbConfig.lightEndpoint || undefined,
          chatModels: dbConfig.chatModels ? JSON.parse(dbConfig.chatModels) : [],
          reasoningModels: dbConfig.reasoningModels ? JSON.parse(dbConfig.reasoningModels) : [],
          lightModels: dbConfig.lightModels ? JSON.parse(dbConfig.lightModels) : [],
        };
      }

      return defaultConfig;
    } catch (error) {
      logger.error('获取 API 配置失败:', error);
      return defaultConfig;
    }
  }

  /**
   * 更新 API 配置（保存到数据库）
   */
  async updateConfig(newConfig: Partial<APIConfig>): Promise<APIConfig> {
    try {
      const currentConfig = await this.getConfig();
      const mergedConfig = {
        ...currentConfig,
        ...newConfig,
      };

      await prisma.platform_api_configs.upsert({
        where: { id: 'platform' },
        update: {
          apiUrl: mergedConfig.apiUrl,
          apiKey: mergedConfig.apiKey,
          availableModels: mergedConfig.availableModels.join(',') || null,
          defaultModel: mergedConfig.defaultModel,
          defaultReasoningModel: mergedConfig.defaultReasoningModel,
          defaultEvaluationModel: mergedConfig.defaultEvaluationModel,
          defaultTemperature: mergedConfig.defaultTemperature,
          defaultMaxTokens: mergedConfig.defaultMaxTokens,
          reasoningEndpoint: mergedConfig.reasoningEndpoint || null,
          lightEndpoint: mergedConfig.lightEndpoint || null,
          chatModels: mergedConfig.chatModels ? JSON.stringify(mergedConfig.chatModels) : null,
          reasoningModels: mergedConfig.reasoningModels ? JSON.stringify(mergedConfig.reasoningModels) : null,
          lightModels: mergedConfig.lightModels ? JSON.stringify(mergedConfig.lightModels) : null,
          updatedAt: new Date(),
        },
        create: {
          id: 'platform',
          apiUrl: mergedConfig.apiUrl,
          apiKey: mergedConfig.apiKey,
          availableModels: mergedConfig.availableModels.join(',') || null,
          defaultModel: mergedConfig.defaultModel,
          defaultReasoningModel: mergedConfig.defaultReasoningModel,
          defaultEvaluationModel: mergedConfig.defaultEvaluationModel,
          defaultTemperature: mergedConfig.defaultTemperature,
          defaultMaxTokens: mergedConfig.defaultMaxTokens,
          reasoningEndpoint: mergedConfig.reasoningEndpoint || null,
          lightEndpoint: mergedConfig.lightEndpoint || null,
          chatModels: mergedConfig.chatModels ? JSON.stringify(mergedConfig.chatModels) : null,
          reasoningModels: mergedConfig.reasoningModels ? JSON.stringify(mergedConfig.reasoningModels) : null,
          lightModels: mergedConfig.lightModels ? JSON.stringify(mergedConfig.lightModels) : null,
        },
      });

      logger.info('API 配置已保存到数据库:', {
        apiUrl: mergedConfig.apiUrl,
        availableModels: mergedConfig.availableModels.length,
        defaultModel: mergedConfig.defaultModel,
      });
      getAPIGateway().invalidateCache();

      return mergedConfig;
    } catch (error) {
      logger.error('保存 API 配置失败:', error);
      throw error;
    }
  }

  /**
   * 重置为默认配置
   */
  async resetConfig(): Promise<APIConfig> {
    try {
      await prisma.platform_api_configs.delete({
        where: { id: 'platform' },
      });

      logger.info('API 配置已重置为默认值');
      getAPIGateway().invalidateCache();
      return defaultConfig;
    } catch (error) {
      logger.error('重置 API 配置失败:', error);
      return defaultConfig;
    }
  }

  /**
   * 获取 OpenAI 兼容的客户端配置
   */
  async getOpenAIConfig() {
    const config = await this.getConfig();
    return {
      baseURL: `${config.apiUrl}/v1`,
      apiKey: config.apiKey,
    };
  }

  /**
   * 测试 API 连接
   */
  async testConnection(testUrl?: string, testKey?: string): Promise<{ 
    success: boolean; 
    models?: string[]; 
    error?: string;
    modelsCount?: number;
  }> {
    const config = await this.getConfig();
    const url = testUrl || config.apiUrl;
    const key = testKey || config.apiKey;

    if (!url || !key) {
      return { 
        success: false, 
        error: '服务地址或 API Key 未配置' 
      };
    }

    try {
      const response = await fetch(`${url}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        const models = data.data?.map(m => m.id) || [];
        
        logger.info('API 连接测试成功', {
          url: url,
          modelsCount: models.length,
        });

        // 更新连接状态到数据库（使用 upsert 确保记录存在）
        await prisma.platform_api_configs.upsert({
          where: { id: 'platform' },
          update: {
            connectionStatus: 'connected',
            lastCheckedAt: new Date(),
            availableModels: models.join(','),
          },
          create: {
            id: 'platform',
            apiUrl: url,
            apiKey: key,
            availableModels: models.join(','),
            connectionStatus: 'connected',
            lastCheckedAt: new Date(),
          },
        });

        return { 
          success: true, 
          models,
          modelsCount: models.length 
        };
      } else {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        logger.error('API 连接测试失败:', errorMsg);

        await prisma.platform_api_configs.upsert({
          where: { id: 'platform' },
          update: {
            connectionStatus: 'failed',
            lastCheckedAt: new Date(),
          },
          create: {
            id: 'platform',
            apiUrl: url,
            apiKey: key,
            connectionStatus: 'failed',
            lastCheckedAt: new Date(),
          },
        });

        return { 
          success: false, 
          error: errorMsg 
        };
      }
    } catch (error: any) {
      logger.error('API 连接测试错误:', error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * 获取平台默认配置（不暴露完整 apiKey）
   */
  async getPlatformDefault(): Promise<{
    endpoint: string;
    apiKeyStatus: string;
    chatModel: string;
    reasoningModel: string;
    evaluationModel: string;
    availableModels: string[];
    connectionStatus: string;
  }> {
    const config = await this.getConfig();
    const dbConfig = await prisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
    });

    return {
      endpoint: config.apiUrl,
      apiKeyStatus: config.apiKey ? '已配置' : '未配置',
      chatModel: config.defaultModel,
      reasoningModel: config.defaultReasoningModel,
      evaluationModel: config.defaultEvaluationModel,
      availableModels: config.availableModels,
      connectionStatus: dbConfig?.connectionStatus || 'unknown',
    };
  }
}

export default new APIConfigService();
