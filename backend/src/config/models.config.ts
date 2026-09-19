/**
 * 统一的模型配置模块
 * 
 * 这是模型列表的唯一真实来源（Single Source of Truth）
 * 所有模型相关的配置都应该从这里引用
 * 
 * 更新模型时只需修改这个文件
 */

/**
 * 模型单价（USD / 1M tokens）。
 *
 * ⚠️ 这是**占位结构**：数值必须来自【财务权威单价源】。
 * - 不要凭经验估算，也不要把厂商页面临时价当权威值。
 * - 三个字段都可选；某字段未配置（undefined）表示"该口径金额未知"，
 *   成本计算器会返回 `usd: null / pricingKnown: false`，**不会**用 0 冒充成本。
 * - 仅改价时才更新此表；首版不含 `effectiveFrom`，调价历史见
 *   `doc/UPGRADE_DIRECTION_20Q.md` §2 Q20 / §7（后续可增量迁到系统库 `model_pricing`）。
 */
export interface ModelPricing {
  /** 未命中缓存的输入 token 单价（USD / 1M tokens） */
  inputPer1M?: number;
  /** 命中 KV 前缀缓存的输入 token 单价（USD / 1M tokens）；缺省时按 inputPer1M 全价计（不折扣） */
  cachedInputPer1M?: number;
  /** 输出 token 单价（USD / 1M tokens） */
  outputPer1M?: number;
}

export interface ModelDefinition {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';
  provider: 'deepseek' | 'agnes';
  supportsThinking?: boolean;
  /** 输出 token 上限（上游硬限制）；resolve-llm-call-params 的全局 maxTokens floor 按此封顶 */
  maxOutputTokens?: number;
  /**
   * 可选单价（USD / 1M tokens），只影响只读成本核算，**不影响模型选择/路由行为**。
   * 默认留空 = 金额未知；权威价格落地后再逐模型补齐。
   */
  pricing?: ModelPricing;
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
    maxOutputTokens: 131072,
    description: '快速响应，适合日常对话和轻量级任务'
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    tier: 'reasoning',
    provider: 'deepseek',
    supportsThinking: true,
    maxOutputTokens: 131072,
    description: '强大推理能力，适合复杂任务和深度思考'
  },
  {
    id: 'agnes-3.0-flash',
    label: 'Agnes 3.0 Flash',
    tier: 'chat',
    provider: 'agnes',
    supportsThinking: false,
    maxOutputTokens: 65536,
    description: '轻量快速模型，TPS 高，适合现阶段 skill 高频调用（暂代 deepseek 作为 skill 调用模型）'
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
 * 获取模型的输出 token 上限（上游硬限制）；未知模型返回 null（由调用方决定默认 floor）。
 */
export function getModelMaxOutputTokens(modelId: string): number | null {
  return MODEL_MAP.get(modelId)?.maxOutputTokens ?? null;
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
