/**
 * Goal 首轮状态机守卫（2026-11-17，真机 gc_1794926822072_rpp3pu7）。
 *
 * 用户只抛一个宽泛主题时，模型可能在首轮就脑补学情 + 出 2 阶段方案 + stage=proposing，
 * 界面于是同时出现追问胶囊和底部确认条。产品口径：exploratory 首轮只做「用途 + 基础」
 * 校准，stage 必须是 understanding、confirmedProposal 必须为空；第 2 轮再提案。
 *
 * 这里只拦「首轮且已 proposing / 已有方案」的越级，正常澄清回合不动。
 */

export interface GoalResponseLike {
  internal?: {
    core?: { stage?: string };
    ext?: {
      goalConversation?: {
        understanding?: { entry_state?: string };
        confirmedProposal?: unknown;
      };
    };
  };
  runtimeEnvelope?: {
    businessState?: { phase?: string };
    contextUpdate?: { nextState?: Record<string, unknown> | null };
  };
}

function effectiveStage(aiResponse: GoalResponseLike): string {
  const phase = aiResponse?.runtimeEnvelope?.businessState?.phase;
  if (typeof phase === 'string' && phase) return phase;
  return String(aiResponse?.internal?.core?.stage || '');
}

export function forceExploratoryFirstTurnClarification(aiResponse: GoalResponseLike): boolean {
  const ext = aiResponse?.internal?.ext?.goalConversation;
  if (ext?.understanding?.entry_state !== 'exploratory') return false;
  const stage = effectiveStage(aiResponse);
  const hasProposal = !!ext?.confirmedProposal;
  if (stage !== 'proposing' && !hasProposal) return false;

  if (aiResponse.runtimeEnvelope?.businessState) {
    aiResponse.runtimeEnvelope.businessState.phase = 'understanding';
  }
  const nextState = aiResponse.runtimeEnvelope?.contextUpdate?.nextState;
  if (nextState && typeof nextState === 'object') {
    nextState.stage = 'understanding';
    nextState.confirmedProposal = null;
  }
  if (aiResponse.internal?.core) {
    aiResponse.internal.core.stage = 'understanding';
  }
  if (ext) {
    ext.confirmedProposal = null;
  }
  return true;
}

/** 当前已落库的用户消息数（含本轮；用于「至少 1 轮校准后才可提案」的状态机判断）。 */
export function countGoalUserMessages(data: unknown): number {
  const messages = Array.isArray((data as { messages?: unknown[] })?.messages)
    ? (data as { messages: unknown[] }).messages
    : [];
  return messages.filter((m) => (m as { role?: string })?.role === 'user').length;
}
