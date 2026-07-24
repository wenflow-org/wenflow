import api, { AI_REQUEST_TIMEOUT } from '@/utils/api';

export interface GoalUnderstanding {
  surface_goal?: string;
  real_problem?: string;
  motivation?: string;
  urgency?: string;
  background?: {
    current_level?: string;
    expected_time?: string;
    available_time?: string;
    constraints?: string[];
    strengths?: string[];
  };
  pain_points?: string;
  current_baseline?: {
    level?: string;
    evidence?: string;
  };
  available_resources?: {
    time_budget?: string;
    time_horizon?: string;
    time_per_session?: string;
  };
  success_criteria?: {
    observable_result?: string;
    acceptance_check?: string;
    time_window?: string;
  };
  constraints_and_boundaries?: string[];
}

/** 统一运行契约 envelope（与后端 RuntimeEnvelope 对齐） */
export interface GoalRuntimeEnvelope {
  artifact?: unknown;
  businessState?: {
    domain?: string;
    phase?: string;
    status?: string;
    confidence?: number;
    isTerminal?: boolean;
    nextAction?: string | null;
    reason?: string | null;
  };
  contextUpdate?: {
    mode?: string;
    stateOwner?: string;
    nextState?: unknown | null;
  };
}

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
        understanding: GoalUnderstanding;
        nextQuestions?: string[];
        quickReplies?: Array<{ text: string; icon?: string }>;
        structuredData?: Record<string, unknown> | null;
        confirmedProposal?: Record<string, unknown> | null;
        confidenceScores?: Record<string, unknown> | null;
        collected?: Record<string, unknown>;
      };
    };
  };
  /** 后端透传；存在时 stage/confidence 可优先取 businessState */
  runtimeEnvelope?: GoalRuntimeEnvelope | null;
  renderHints: {
    quickReplies?: Array<{ text: string; icon?: string }>;
  };
  schemaVersion: 'agent-output-v1';
  meta: {
    source: string;
    timestamp: string;
    debug?: Record<string, unknown>;
    messages?: Array<{
      role: 'user' | 'ai';
      content: string;
      time: string;
    }>;
  };
}

interface GoalConversationApiResponse {
  success: boolean;
  data: GoalConversationEnvelope;
}

export type GoalConversationContextMode = 'recent' | 'full';

interface GoalConversationRequestOptions {
  contextMode?: GoalConversationContextMode;
  confirmProposal?: boolean;
}

export async function startGoalConversation(
  text: string,
  options: GoalConversationRequestOptions = {}
): Promise<GoalConversationEnvelope> {
  const response = await api.post('/goal-conversation/start', {
    input: { text },
    contextMode: options.contextMode || 'recent'
  }, { timeout: AI_REQUEST_TIMEOUT }) as GoalConversationApiResponse;

  return response.data;
}

export async function replyGoalConversation(
  conversationId: string,
  text: string,
  options: GoalConversationRequestOptions = {}
): Promise<GoalConversationEnvelope> {
  const response = await api.post(`/goal-conversation/${conversationId}/reply`, {
    input: { text },
    contextMode: options.contextMode || 'recent',
    confirmProposal: options.confirmProposal === true
  }, { timeout: AI_REQUEST_TIMEOUT }) as GoalConversationApiResponse;

  return response.data;
}

export async function getGoalConversation(conversationId: string): Promise<GoalConversationEnvelope> {
  const response = await api.get(`/goal-conversation/${conversationId}`) as GoalConversationApiResponse;

  return response.data;
}

export async function regenerateGoalConversation(conversationId: string, adjustments?: string): Promise<GoalConversationEnvelope> {
  const response = await api.post(`/goal-conversation/${conversationId}/regenerate`, {
    input: { text: adjustments || '' },
    adjustments
  }, { timeout: AI_REQUEST_TIMEOUT }) as GoalConversationApiResponse;

  return response.data;
}

export async function deleteGoalConversation(conversationId: string): Promise<void> {
  await api.delete(`/goal-conversation/${conversationId}`);
}
