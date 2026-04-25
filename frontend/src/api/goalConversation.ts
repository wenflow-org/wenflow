import api from '@/utils/api';

export interface GoalConversationEnvelope {
  userVisible: string;
  internal: {
    core: {
      conversationId?: string | null;
      stage: 'understanding' | 'proposing' | 'ready' | 'completed';
      confidence: number;
      isCompleted: boolean;
      learningPath?: {
        id: string;
        status?: string;
      } | null;
    };
    ext: {
      goalConversation: {
        understanding: Record<string, any>;
        nextQuestions?: string[];
        quickReplies?: Array<{ text: string; icon?: string }>;
        structuredData?: any;
        confirmedProposal?: any;
        confidenceScores?: any;
        collected?: Record<string, any>;
      };
    };
  };
  renderHints: {
    quickReplies?: Array<{ text: string; icon?: string }>;
  };
  schemaVersion: 'agent-output-v1';
  meta: {
    source: string;
    timestamp: string;
  };
}

interface GoalConversationApiResponse {
  success: boolean;
  data: GoalConversationEnvelope;
}

export async function startGoalConversation(text: string): Promise<GoalConversationEnvelope> {
  const response = await api.post('/goal-conversation/start', {
    input: { text }
  }) as GoalConversationApiResponse;

  return response.data;
}

export async function replyGoalConversation(conversationId: string, text: string): Promise<GoalConversationEnvelope> {
  const response = await api.post(`/goal-conversation/${conversationId}/reply`, {
    input: { text }
  }) as GoalConversationApiResponse;

  return response.data;
}

export async function regenerateGoalConversation(conversationId: string, adjustments?: string): Promise<GoalConversationEnvelope> {
  const response = await api.post(`/goal-conversation/${conversationId}/regenerate`, {
    input: { text: adjustments || '' },
    adjustments
  }) as GoalConversationApiResponse;

  return response.data;
}

export async function deleteGoalConversation(conversationId: string): Promise<void> {
  await api.delete(`/goal-conversation/${conversationId}`);
}
