/**
 * 思考字段构造策略（能力驱动 + 预算分离）。
 *
 * 设计依据：doc/MODEL_GATEWAY_DESIGN.md §4.4
 * - 只有模型能力声明 `supportsThinking` 才发 `thinking`
 * - `reasoning_effort` 按逐模型声明的挡位放行：注册表里 `reasoningEfforts` 写的是哪个词，
 *   发出去的就是哪个词（平台不翻译、不改写、不按自己的词表卡）。上游各家强度词表并不一致
 *   （有的 minimal/low/medium/high，有的只有 low/high，有的用自家词），所以「认哪些词」
 *   这件事只能在注册表里逐模型声明；没声明的那一档静默丢。
 * - 开启思考时把「输出预算」与「推理预留」分离：
 *   最终 max_tokens = 声明输出 + reasoningReserveTokens（不超过模型硬上限）
 *
 * 纯函数，不访问 DB、不改入参，便于单测与在 admin「生效配置」中复用预览。
 */
import { getModelDefinition } from '../../config/models.config';

export type ThinkingMode = 'enabled' | 'disabled' | null | undefined;
export type ReasoningEffort = string | null | undefined;

export interface ThinkingPolicyInput {
  modelId: string;
  thinkingMode?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  /** 调用方已声明的输出预算 */
  maxTokens?: number;
}

export interface ThinkingPolicyResult {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoningEffort?: string;
  /** 预算分离后的最终 max_tokens；未变化时该字段不出现 */
  maxTokens?: number;
}

export function buildThinkingPolicy(input: ThinkingPolicyInput): ThinkingPolicyResult {
  const model = getModelDefinition(input.modelId);
  const result: ThinkingPolicyResult = {};

  // 模型不支持思考：thinking / reasoning_effort 一律不发
  if (!model?.supportsThinking) return result;

  if (input.thinkingMode === 'enabled' || input.thinkingMode === 'disabled') {
    result.thinking = { type: input.thinkingMode };
  }

  // 挡位放行：既要模型声明了支持，也要这一档确实落在它声明的集合里
  const declaredEfforts = model.reasoningEfforts ?? [];
  if (
    input.thinkingMode !== 'disabled'
    && input.reasoningEffort
    && declaredEfforts.includes(input.reasoningEffort)
  ) {
    result.reasoningEffort = input.reasoningEffort;
  }

  // 预算分离：思考开启时为推理预留额外 token，避免推理吃光输出预算导致 content 为空
  if (result.thinking?.type === 'enabled' && typeof input.maxTokens === 'number') {
    const reserve = model.reasoningReserveTokens ?? 0;
    if (reserve > 0) {
      const desired = input.maxTokens + reserve;
      result.maxTokens = model.maxOutputTokens !== undefined
        ? Math.min(desired, model.maxOutputTokens)
        : desired;
    }
  }

  return result;
}
