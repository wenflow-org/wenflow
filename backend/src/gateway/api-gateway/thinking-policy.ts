/**
 * 思考字段构造策略（能力驱动 + 预算分离）。
 *
 * 设计依据：doc/MODEL_GATEWAY_DESIGN.md §4.4
 * - 只有模型能力声明 `supportsThinking` 才发 `thinking`
 * - 只有声明 `supportsReasoningEffort` 才发 `reasoning_effort`
 * - 开启思考时把「输出预算」与「推理预留」分离：
 *   最终 max_tokens = 声明输出 + reasoningReserveTokens（不超过模型硬上限）
 *
 * 纯函数，不访问 DB、不改入参，便于单测与在 admin「生效配置」中复用预览。
 */
import { getModelDefinition } from '../../config/models.config';

export type ThinkingMode = 'enabled' | 'disabled' | null | undefined;
export type ReasoningEffort = 'low' | 'high' | 'max' | null | undefined;

export interface ThinkingPolicyInput {
  modelId: string;
  thinkingMode?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  /** 调用方已声明的输出预算 */
  maxTokens?: number;
}

export interface ThinkingPolicyResult {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoningEffort?: 'low' | 'high' | 'max';
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

  if (
    input.thinkingMode !== 'disabled'
    && model.supportsReasoningEffort
    && (input.reasoningEffort === 'low'
      || input.reasoningEffort === 'high'
      || input.reasoningEffort === 'max')
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
