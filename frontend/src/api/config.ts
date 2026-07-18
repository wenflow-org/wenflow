import request from '@/utils/api';

/**
 * 模型定义接口
 */
export interface ModelDefinition {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';
  provider: 'deepseek';
  supportsThinking?: boolean;
  description?: string;
}

/**
 * 模型配置响应
 */
export interface AvailableModelsResponse {
  models: ModelDefinition[];
  defaults: {
    chat: string;
    reasoning: string;
  };
  byTier: {
    chat: ModelDefinition[];
    reasoning: ModelDefinition[];
  };
}

/**
 * 获取所有可用模型
 */
export async function getAvailableModels() {
  return request<AvailableModelsResponse>({
    url: '/config/available-models',
    method: 'get'
  });
}

/**
 * 获取所有模型 ID
 */
export async function getModelIds() {
  return request<string[]>({
    url: '/config/model-ids',
    method: 'get'
  });
}
