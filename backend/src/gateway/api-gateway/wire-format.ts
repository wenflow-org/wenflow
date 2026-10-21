/**
 * Wire format 契约层（2026-10-20 抽出）。
 *
 * 目的：把「一条逻辑会话最终以什么消息数组发给上游」从 executor 里独立出来，
 * 变成不依赖数据库/网络/配置文件的纯函数，从而可以：
 * - 用 golden test 锁定 `[system, history, user]` 与折叠形态的逐字节差异；
 * - 为未来的 ConversationAdapter（Chat Completions / Responses / Messages）留出单一改写点。
 *
 * 本模块只做**渲染**，不决定策略来源：调用方传入「是否折叠」的布尔值。
 * 策略解析（环境覆盖 → 通道能力）见 resolveSystemPromptFoldPolicy。
 */
import type { ChatContentPart, ChatMessageContent, ChatRequest } from './types';

export type WireMessage = ChatRequest['messages'][number];

/**
 * system 折叠策略（纯函数）。
 *
 * 解析顺序：`LLM_SYSTEM_PROMPT_FOLD` 显式覆盖（'0' 关 / '1' 开）→ 通道能力声明。
 * 通道声明为「支持 system」时保留原生角色；否则折叠进首条 user。
 */
export function resolveSystemPromptFoldPolicy(
  providerSupports: boolean,
  envValue: string | undefined = process.env.LLM_SYSTEM_PROMPT_FOLD
): boolean {
  const override = String(envValue ?? '').trim();
  if (override === '0') return false;
  if (override === '1') return true;
  return !providerSupports;
}

/**
 * 按策略渲染最终 wire messages：
 * - foldSystem=false → 原样返回（引用不变）；
 * - foldSystem=true  → system 文本合并进首条 user（见 foldSystemMessagesIntoUser）。
 */
export function renderWireMessages(messages: WireMessage[], options: { foldSystem: boolean }): WireMessage[] {
  return options.foldSystem ? foldSystemMessagesIntoUser(messages) : messages;
}

/**
 * 把 `role:'system'` 消息内容折叠进首条 user 消息（上游不支持 system 角色时的兼容层）。
 *
 * 背景（2026-09-22 实测）：平台当前聚合网关会静默丢弃 system 消息，导致 skill 的
 * 系统提示词从未到达模型；折叠进 user 消息后同一约束被模型完美遵从。
 *
 * 语义：
 * - 无 system 消息 → 原样返回（引用不变，避免无谓拷贝）；
 * - 多条 system → 按顺序以空行拼接；
 * - 有 user 消息 → system 文本前置到**首条** user 消息，用分隔线隔开，保留原 user 内容与其余消息顺序；
 * - 无 user 消息（只有 system/assistant）→ 生成一条 user 消息承载 system 文本；
 * - 首条 user 是内容块数组（多模态）→ 在首个文本块前插入 system 文本块，图片块原样保留（#123）。
 */
export function foldSystemMessagesIntoUser(messages: WireMessage[]): WireMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  // 只折叠**纯文本** system 消息：内容块数组形态的 system 不在此兼容层处理（当前无此调用方）
  const systems = messages.filter((m) => m?.role === 'system' && typeof m?.content === 'string' && m.content.trim());
  if (systems.length === 0) return messages;

  const systemText = systems.map((m) => String(m.content)).join('\n\n');
  const rest = messages.filter((m) => m?.role !== 'system');
  const firstUserIndex = rest.findIndex((m) => m?.role === 'user');
  if (firstUserIndex === -1) {
    return [{ role: 'user', content: systemText }, ...rest];
  }
  const merged = [...rest];
  merged[firstUserIndex] = {
    ...merged[firstUserIndex],
    content: mergeSystemTextIntoContent(systemText, merged[firstUserIndex].content),
  };
  return merged;
}

/**
 * 把 system 文本合并进目标内容（2026-10-18 #123 多模态兼容）：
 * - string：前置文本 + 分隔线（原行为不变）；
 * - 内容块数组（含图片）：在**首个文本块**前插入 system 文本块——绝不能走字符串拼接，
 *   否则数组会被 `String()` 成 `[object Object]`，图片块与用户正文一起丢失。
 */
export function mergeSystemTextIntoContent(
  systemText: string,
  content: ChatMessageContent | undefined
): ChatMessageContent {
  if (typeof content === 'string') {
    return `${systemText}\n\n---\n${content}`;
  }
  if (!Array.isArray(content)) {
    return `${systemText}\n\n---\n`;
  }
  const parts = [...content];
  const prefix: ChatContentPart = { type: 'text', text: `${systemText}\n\n---` };
  const firstTextIndex = parts.findIndex((part) => part?.type === 'text');
  if (firstTextIndex === -1) return [prefix, ...parts];
  parts.splice(firstTextIndex, 0, prefix);
  return parts;
}
