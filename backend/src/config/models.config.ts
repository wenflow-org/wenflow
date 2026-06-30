/**
 * 统一的模型配置模块
 * 
 * 这是模型列表的唯一真实来源（Single Source of Truth）
 * 所有模型相关的配置都应该从这里引用
 * 
 * 更新模型时只需修改这个文件
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
 * 可用模型列表
 */
export const AVAILABLE_MODELS: ModelDefinition[] = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    tier: 'chat',
    provider: 'deepseek',
    supportsThinking: true,
    description: '快速响应，适合日常对话和轻量级任务'
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    tier: 'reasoning',
    provider: 'deepseek',
    supportsThinking: true,
    description: '强大推理能力，适合复杂任务和深度思考'
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek R1',
    tier: 'reasoning',
    provider: 'deepseek',
    supportsThinking: true,
    description: '专注推理的模型，适合逻辑推导和问题解决'
  }
];

/**
 * 默认模型配置
 */
export const DEFAULT_MODELS = {
  chat: 'deepseek-v4-flash',
  reasoning: 'deepseek-v4-pro'
} as const;

/**
 * 按 tier 分组的模型列表
 */
export const MODELS_BY_TIER = {
  chat: AVAILABLE_MODELS.filter(m => m.tier === 'chat'),
  reasoning: AVAILABLE_MODELS.filter(m => m.tier === 'reasoning')
};

/**
 * 模型 ID 映射（用于快速查找）
 */
export const MODEL_MAP = new Map(
  AVAILABLE_MODELS.map(m => [m.id, m])
);

/**
 * 检查是否为支持 Thinking Mode 的模型
 */
export function supportsThinkingMode(modelId: string): boolean {
  const model = MODEL_MAP.get(modelId);
  return model?.supportsThinking ?? false;
}

/**
 * 检查是否为 DeepSeek V4 模型（兼容旧逻辑）
 */
export function isDeepSeekV4Model(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro';
}

/**
 * 检查是否为 DeepSeek 推理模型
 */
export function isReasoningModel(modelId: string): boolean {
  const model = MODEL_MAP.get(modelId);
  return model?.tier === 'reasoning';
}

/**
 * 获取模型的显示标签
 */
export function getModelLabel(modelId: string): string {
  return MODEL_MAP.get(modelId)?.label ?? modelId;
}

/**
 * 验证模型 ID 是否有效
 */
export function isValidModel(modelId: string): boolean {
  return MODEL_MAP.has(modelId);
}

/**
 * 获取所有模型 ID 列表（用于验证和配置）
 */
export function getAllModelIds(): string[] {
  return AVAILABLE_MODELS.map(m => m.id);
}
