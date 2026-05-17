import api from '@/utils/api';
import type { GoalConversationEnvelope } from '@/api/goalConversation';

interface TestGoalConversationApiResponse {
  success: boolean;
  data: GoalConversationEnvelope;
}

export async function startTestGoalConversation(text: string): Promise<GoalConversationEnvelope> {
  const response = await api.post('/test/goal-conversation/start', {
    input: { text }
  }) as TestGoalConversationApiResponse;

  return response.data;
}

export async function replyTestGoalConversation(sessionId: string, text: string): Promise<GoalConversationEnvelope> {
  const response = await api.post(`/test/goal-conversation/${sessionId}/reply`, {
    input: { text }
  }) as TestGoalConversationApiResponse;

  return response.data;
}

export async function getTestGoalConversation(sessionId: string): Promise<GoalConversationEnvelope> {
  const response = await api.get(`/test/goal-conversation/${sessionId}`) as TestGoalConversationApiResponse;

  return response.data;
}

export async function deleteTestGoalConversation(sessionId: string): Promise<void> {
  await api.delete(`/test/goal-conversation/${sessionId}`);
}
