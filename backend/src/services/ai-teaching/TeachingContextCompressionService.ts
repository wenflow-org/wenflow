import type { TeachingSessionMessage } from './TeachingSessionRepository';

// 压缩窗口默认 40k token（约 160k 字符 ≈ 百轮级对话触发；此前 1M 实际永不触发）。
// 触发比 0.7、保留最近 12 条；均可用 env 覆盖。
const DEFAULT_CONTEXT_WINDOW_TOKENS = Number(process.env.TEACHING_CONTEXT_WINDOW_TOKENS || 40_000);
const DEFAULT_COMPRESSION_TRIGGER_RATIO = Number(process.env.TEACHING_CONTEXT_COMPRESSION_RATIO || 0.7);
const DEFAULT_RECENT_MESSAGES_TO_KEEP = Number(process.env.TEACHING_CONTEXT_RECENT_MESSAGES || 12);

export interface TeachingContextCompressionResult {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  compressed: boolean;
  recap: string | null;
  estimatedTokens: number;
  triggerTokens: number;
}

function estimateMessageTokens(content: string): number {
  const normalized = content || '';
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message.content) + 6, 0);
}

function buildRecap(messages: TeachingSessionMessage[]): string {
  const userMessages = messages.filter((message) => message.role === 'user');
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const recentAnalyses = assistantMessages
    .map((message) => message.analysis as Record<string, any> | undefined)
    .filter(Boolean)
    .slice(-4);

  const confusionPoints = Array.from(new Set(
    recentAnalyses.flatMap((analysis) => Array.isArray(analysis?.confusionPoints) ? analysis!.confusionPoints.map(String) : [])
  )).slice(0, 5);

  const summaryParts = [
    `此前课堂已进行 ${Math.max(0, messages.length - DEFAULT_RECENT_MESSAGES_TO_KEEP)} 条历史消息。`,
    userMessages.length > 0 ? `学生已表达 ${userMessages.length} 次观点或问题。` : null,
    assistantMessages.length > 0 ? `教师已进行 ${assistantMessages.length} 次讲解或反馈。` : null,
    confusionPoints.length > 0 ? `历史高频困惑点：${confusionPoints.join('；')}。` : null,
  ].filter(Boolean);

  const highlights = messages
    .slice(0, Math.max(0, messages.length - DEFAULT_RECENT_MESSAGES_TO_KEEP))
    .filter((message) => message.role !== 'system')
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '学生' : '教师'}：${message.content.replace(/\s+/g, ' ').slice(0, 120)}`);

  if (highlights.length > 0) {
    summaryParts.push(`历史关键片段：${highlights.join(' | ')}`);
  }

  return summaryParts.join(' ');
}

export class TeachingContextCompressionService {
  compress(messages: TeachingSessionMessage[]): TeachingContextCompressionResult {
    const normalized = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const estimatedTokens = estimateMessagesTokens(normalized);
    const triggerTokens = Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * DEFAULT_COMPRESSION_TRIGGER_RATIO);

    if (estimatedTokens < triggerTokens || normalized.length <= DEFAULT_RECENT_MESSAGES_TO_KEEP + 2) {
      return {
        messages: normalized,
        compressed: false,
        recap: null,
        estimatedTokens,
        triggerTokens,
      };
    }

    const historicalMessages = messages.slice(0, Math.max(0, messages.length - DEFAULT_RECENT_MESSAGES_TO_KEEP));
    const recentMessages = normalized.slice(-DEFAULT_RECENT_MESSAGES_TO_KEEP);
    const recap = buildRecap(historicalMessages);

    return {
      messages: [
        {
          role: 'system',
          content: `以下是课堂历史摘要，请将其视为已发生上下文而不是本轮要直接复述给学生的文本。${recap}`,
        },
        ...recentMessages,
      ],
      compressed: true,
      recap,
      estimatedTokens,
      triggerTokens,
    };
  }
}

export const teachingContextCompressionService = new TeachingContextCompressionService();
