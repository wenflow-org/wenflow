// API配置管理服务
import { logger } from '../utils/logger';

export interface APIConfig {
  baseURL: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  defaultReasoningModel: string;
  defaultJudgeModel: string;
}

// 默认配置
const defaultConfig: APIConfig = {
  baseURL: process.env.AI_API_URL || 'http://localhost:3000',
  apiKey: process.env.AI_API_KEY || '',
  models: (process.env.AI_API_URL && process.env.AI_API_KEY)
    ? ['deepseek-chat', 'deepseek-think', 'deepseek-coder']
    : [],
  defaultModel: process.env.AI_MODEL || 'deepseek-chat',
  defaultReasoningModel: process.env.AI_MODEL_REASONING || 'deepseek-think',
  defaultJudgeModel: process.env.AI_MODEL_REASONING || 'deepseek-think',
};

// 当前配置
let currentConfig: APIConfig = { ...defaultConfig };

class APIConfigService {
  /**
   * 获取当前配置
   */
  getConfig(): APIConfig {
    return { ...currentConfig };
  }

  /**
   * 更新 API 配置
   */
  updateConfig(newConfig: Partial<APIConfig>): APIConfig {
    currentConfig = {
      ...currentConfig,
      ...newConfig,
    };

    logger.info('API 配置已更新:', {
      baseURL: currentConfig.baseURL,
      models: currentConfig.models,
      defaultModel: currentConfig.defaultModel,
    });

    return this.getConfig();
  }

  /**
   * 重置为默认配置
   */
  resetConfig(): APIConfig {
    currentConfig = { ...defaultConfig };
    logger.info('API 配置已重置为默认值');
    return this.getConfig();
  }

  /**
   * 获取 OpenAI 兼容的客户端配置
   */
  getOpenAIConfig() {
    return {
      baseURL: `${currentConfig.baseURL}/v1`,
      apiKey: currentConfig.apiKey,
    };
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${currentConfig.baseURL}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${currentConfig.apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        logger.info('API 连接测试成功', {
          baseURL: currentConfig.baseURL,
          modelsCount: data.data?.length || 0,
        });
        return true;
      } else {
        logger.error('API 连接测试失败:', response.status, response.statusText);
        return false;
      }
    } catch (error: any) {
      logger.error('API 连接测试错误:', error.message);
      return false;
    }
  }

  /**
   * 获取平台默认配置（不暴露完整 apiKey）
   */
  getPlatformDefault(): {
    endpoint: string;
    apiKeyStatus: string;
    chatModel: string;
    reasoningModel: string;
  } {
    return {
      endpoint: currentConfig.baseURL,
      apiKeyStatus: currentConfig.apiKey ? '已配置' : '未配置',
      chatModel: currentConfig.defaultModel,
      reasoningModel: currentConfig.defaultReasoningModel,
    };
  }
}

export default new APIConfigService();
