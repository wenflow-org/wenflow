/**
 * Chat Completions 协议适配器（2026-10-21 抽出）。
 *
 * 现状：chat 协议目前只有一种线上形态（OpenAI-compatible），但「供应商差异」散在
 * executor 的私有方法里，另外 4 处连通性探针各自重写 URL 整形。本模块把这些
 * **纯函数**集中：
 *
 * - URL 整形（3 种输入形态）
 * - 认证头（Bearer）
 * - 能力 → 请求体字段（thinking / reasoning_effort / max_tokens）
 * - 流式参数（usage 只在首趟请求）
 *
 * 抽出的目的不是支持第二种协议（Responses / Messages 还没有调用方），而是让
 * 「同一份能力声明最终生成什么请求体」有唯一可断言的点：executor 与探针共用，
 * 新增供应商时改这一处而不是五处。
 */
import type { ThinkingPolicyResult } from './thinking-policy';

/** 已在路径里带 /chat/completions 的保持原样；以 /v1 结尾补后缀；其余补 /v1/chat/completions。 */
export function resolveChatCompletionsUrl(endpoint: string): string {
  const normalizedEndpoint = (endpoint || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalizedEndpoint)) return normalizedEndpoint;
  if (/\/v1$/i.test(normalizedEndpoint)) return `${normalizedEndpoint}/chat/completions`;
  return `${normalizedEndpoint}/v1/chat/completions`;
}

/** 统一的认证头。密钥为空时不带 Authorization（探针/本地端点场景）。 */
export function buildChatAuthHeaders(apiKey: string | null | undefined): Record<string, string> {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * 把思考策略写回请求体。
 *
 * 约定（见 doc/MODEL_GATEWAY_DESIGN.md §4.4）：
 * - 策略给出 thinking → 覆盖；
 * - 策略给出 reasoningEffort → 覆盖；
 * - 策略给出 maxTokens → 写回（预算收敛）；
 * - 策略字段为空 = 不触碰请求体里已有的值。
 */
export function applyThinkingPolicyToBody(
  body: Record<string, unknown>,
  policy: ThinkingPolicyResult
): void {
  if (policy.thinking) body.thinking = policy.thinking;
  if (policy.reasoningEffort) body.reasoning_effort = policy.reasoningEffort;
  if (policy.maxTokens !== undefined) body.max_tokens = policy.maxTokens;
}

/** 首趟流式请求带 usage 汇总；重试趟不带（部分上游对 stream_options 报 400）。 */
export function buildStreamOptions(includeUsage: boolean): Record<string, unknown> | null {
  return includeUsage ? { stream_options: { include_usage: true } } : null;
}

/** 非流式请求必须剥离流式字段，否则上游可能返回 SSE（executor 兼容分支的纯函数形态）。 */
export function stripStreamFields(body: Record<string, unknown>): void {
  if (!body || body.stream === true) return;
  delete body.stream_options;
}
