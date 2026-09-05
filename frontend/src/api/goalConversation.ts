import api, { AI_REQUEST_TIMEOUT } from '@/utils/api';
import { streamSsePost } from '@/utils/sse';
import type { InteractionMeta } from '@/composables/useInteractionMeta';

export interface GoalUnderstanding {
  surface_goal?: string;
  real_problem?: string;
  motivation?: string;
  urgency?: string;
  background_experience?: string;
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
  /** 前端交互特征（认知负荷量测 · 可选，缺失走 absent 路径） */
  meta?: InteractionMeta;
}

export async function startGoalConversation(
  text: string,
  options: GoalConversationRequestOptions = {}
): Promise<GoalConversationEnvelope> {
  const response = await api.post('/goal-conversation/start', {
    input: { text },
    contextMode: options.contextMode || 'recent',
    ...(options.meta ? { meta: options.meta } : {})
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
    confirmProposal: options.confirmProposal === true,
    ...(options.meta ? { meta: options.meta } : {})
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

/**
 * SSE 流式 Goal 请求（start/reply/regenerate 共用）。
 * goal skill 为 JSON 输出：不产生 delta，final 事件携带完整 envelope。
 * 失败时 reject，错误对象携带来源标记（transport=true 可安全回退非流式；
 * serverError=true 为服务端业务失败；422 恢复信封在 error.data）。
 */
export type GoalStreamAction = 'start' | 'reply' | 'regenerate';

/** 流式回调：后端 SSE 每收到一个 delta（模型输出 token 流）时触发。
    goal skill 为 JSON 输出，delta 为原始模型文本；最终以 final envelope 为准。 */
export interface GoalStreamHandlers {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

async function streamGoalRequest(
  action: GoalStreamAction,
  conversationId: string | null,
  payload: { text?: string; contextMode?: GoalConversationContextMode; confirmProposal?: boolean; adjustments?: string; meta?: InteractionMeta },
  handlers: GoalStreamHandlers = {}
): Promise<GoalConversationEnvelope> {
  const { onDelta, signal } = handlers;
  const url = action === 'start'
    ? '/goal-conversation/start'
    : `/goal-conversation/${conversationId}/${action === 'reply' ? 'reply' : 'regenerate'}`;
  const body: Record<string, unknown> = {};
  if (payload.text !== undefined) {
    body.input = { text: payload.text };
    body.contextMode = payload.contextMode || 'recent';
  }
  if (payload.confirmProposal === true) body.confirmProposal = true;
  if (payload.adjustments !== undefined) body.adjustments = payload.adjustments;
  if (payload.meta !== undefined) body.meta = payload.meta;

  return new Promise<GoalConversationEnvelope>((resolve, reject) => {
    let envelope: GoalConversationEnvelope | null = null;
    let receivedAnything = false;
    let serverError: { code?: string; status?: number; message: string; data?: unknown } | null = null;
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    streamSsePost(url, body, {
      signal,
      onEvent: (event, data) => {
        if (event === 'final') {
          receivedAnything = true;
          envelope = data?.data || data || null;
        } else if (event === 'delta') {
          // 模型输出 token 流：实时上屏（渐进渲染），final 到达后以 envelope 为准替换
          receivedAnything = true;
          if (typeof data?.text === 'string') onDelta?.(data.text);
        } else if (event === 'error') {
          receivedAnything = true;
          serverError = {
            code: data?.code,
            status: data?.status,
            message: data?.message || '处理失败',
            data: data?.data
          };
        }
      }
    }).then(
      () => {
        if (settled) return;
        settled = true;
        if (envelope) resolve(envelope);
        else if (serverError) {
          reject(Object.assign(new Error(serverError.message), {
            code: serverError.code,
            status: serverError.status,
            recoveryEnvelope: serverError.data,
            serverError: true
          }));
        } else {
          reject(new Error('未收到最终结果'));
        }
      },
      (error) => {
        const e = error as { partialStream?: boolean; transport?: boolean };
        if (receivedAnything) e.partialStream = true;
        else e.transport = true;
        settleReject(error);
      }
    );
  });
}

export async function streamStartGoalConversation(
  text: string,
  options: GoalConversationRequestOptions = {},
  handlers: GoalStreamHandlers = {}
): Promise<GoalConversationEnvelope> {
  return streamGoalRequest('start', null, { text, contextMode: options.contextMode, meta: options.meta }, handlers);
}

export async function streamReplyGoalConversation(
  conversationId: string,
  text: string,
  options: GoalConversationRequestOptions = {},
  handlers: GoalStreamHandlers = {}
): Promise<GoalConversationEnvelope> {
  return streamGoalRequest('reply', conversationId, {
    text,
    contextMode: options.contextMode,
    confirmProposal: options.confirmProposal,
    meta: options.meta
  }, handlers);
}

export async function streamRegenerateGoalConversation(
  conversationId: string,
  adjustments?: string,
  handlers: GoalStreamHandlers = {}
): Promise<GoalConversationEnvelope> {
  return streamGoalRequest('regenerate', conversationId, { adjustments }, handlers);
}

export async function deleteGoalConversation(conversationId: string): Promise<void> {
  await api.delete(`/goal-conversation/${conversationId}`);
}
