import api, { AI_REQUEST_TIMEOUT } from '@/utils/api';
import { streamSsePost } from '@/utils/sse';
import type { InteractionMeta } from '@/composables/useInteractionMeta';

export interface GoalUnderstanding {
  surface_goal?: string;
  real_problem?: string;
  /** 本次进入的确定度（2026-11-17）：exploratory=只抛主题、深度/用途未定。 */
  entry_state?: 'focused' | 'exploratory';
  /** 内容分型（goal 模型判定的 intent_type）。 */
  intent_type?: string;
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
  /** 用户自述的具体使用场景（未提供时为空；用于判断 real_problem 是用户事实还是系统推断） */
  scenario?: string;
  current_baseline?: {
    level?: string;
    evidence?: string;
  };
  available_resources?: {
    time_budget?: string;
    time_horizon?: string;
    time_per_session?: string;
  };
  time_dimensions?: {
    sessionsLengthMin?: number | null;
    sessionsLengthSource?: 'explicit' | 'estimated' | 'default';
    objectiveScopeHours?: number | null;
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

/**
 * 会话终局类型（与后端 goal-conversation.exit.ts 对齐）：
 * - path_bound：已绑定学习路径，终局不可再聊；
 * - hard_blocked：分诊硬阻断，回复补充说明可重判；
 * - answer_only：模型一句话直答收口，没有路径，可继续补充目标；
 * - no_path：历史遗留/异常无路径终局（同样按可继续补充处理）。
 */
export type GoalTerminalKind = 'path_bound' | 'hard_blocked' | 'answer_only' | 'no_path';

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
      /** 分诊硬阻断终局（completed 且无路径，2026-11-05 P0）：前端据此展示阻断说明而非「路径已创建」 */
      hardBlocked?: boolean;
      /** 显式、持久的终局类型：恢复/重开 UI 的唯一判据，不再用「completed + 无路径」猜 */
      terminalKind?: GoalTerminalKind | null;
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

/** 前置自测作答（2026-11-02）：面板内本地作答，随「确认」一次性提交给后端确定性判分 */
export interface GoalProbeAnswer {
  probeId: string;
  userAnswer: string;
  targetConcept?: string;
}

interface GoalConversationRequestOptions {
  contextMode?: GoalConversationContextMode;
  confirmProposal?: boolean;
  /** 前置自测作答（仅确认时携带） */
  probeAnswers?: GoalProbeAnswer[];
  /** 前端交互特征（认知负荷量测 · 可选，缺失走 absent 路径） */
  meta?: InteractionMeta;
  /**
   * 显式挂载资料 id 列表（资料跟路径生成走）：undefined=未声明；数组（含 []）=显式口径
   * ——路径生成只使用这些资料，[] 表示零注入。整包覆盖会话挂载列表。
   */
  materialIds?: string[];
}

export async function startGoalConversation(
  text: string,
  options: GoalConversationRequestOptions = {}
): Promise<GoalConversationEnvelope> {
  const response = await api.post('/goal-conversation/start', {
    input: { text },
    contextMode: options.contextMode || 'recent',
    ...(options.materialIds !== undefined ? { materialIds: options.materialIds } : {}),
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
    // JSON（非流式）通道必须与 SSE 同权携带前置自测作答：传输层回退时
    // 此前只带 confirmProposal，作答会在无提示的情况下丢失，后端判分键随之缺失。
    ...(options.probeAnswers?.length ? { probeAnswers: options.probeAnswers } : {}),
    ...(options.materialIds !== undefined ? { materialIds: options.materialIds } : {}),
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
  /** 服务端心跳注释行到达（传输层活动，喂上层停滞看门狗） */
  onActivity?: () => void;
  signal?: AbortSignal;
}

async function streamGoalRequest(
  action: GoalStreamAction,
  conversationId: string | null,
  payload: { text?: string; contextMode?: GoalConversationContextMode; confirmProposal?: boolean; probeAnswers?: GoalProbeAnswer[]; adjustments?: string; meta?: InteractionMeta; materialIds?: string[] },
  handlers: GoalStreamHandlers = {}
): Promise<GoalConversationEnvelope> {
  const { onDelta, onActivity, signal } = handlers;
  const url = action === 'start'
    ? '/goal-conversation/start'
    : `/goal-conversation/${conversationId}/${action === 'reply' ? 'reply' : 'regenerate'}`;
  const body: Record<string, unknown> = {};
  if (payload.text !== undefined) {
    body.input = { text: payload.text };
    body.contextMode = payload.contextMode || 'recent';
  }
  if (payload.confirmProposal === true) body.confirmProposal = true;
  if (payload.probeAnswers?.length) body.probeAnswers = payload.probeAnswers;
  if (payload.materialIds !== undefined) body.materialIds = payload.materialIds;
  if (payload.adjustments !== undefined) body.adjustments = payload.adjustments;
  if (payload.meta !== undefined) body.meta = payload.meta;

  return new Promise<GoalConversationEnvelope>((resolve, reject) => {
    let envelope: GoalConversationEnvelope | null = null;
    let receivedAnything = false;
    let serverError: { code?: string; status?: number; message: string; data?: unknown; details?: unknown } | null = null;
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    streamSsePost(url, body, {
      signal,
      onActivity,
      // 空闲窗放宽到 5 分钟：sse.ts 的空闲超时修复接线后此参数首次真实生效，而目标回合
      // （尤其首条消息触发规划）出首个字节可以远超 60s——按默认会误杀慢回合。服务端 15s
      // 心跳注释行经 onActivity 喂上层看门狗后，此处只兜「连心跳都断了」的真死连接；
      // 连接阶段另有 sse.ts 的 30s 连接超时兜底（请求未达服务端的黑洞场景，#129）。
      idleTimeoutMs: 300_000,
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
          // 恢复信封**只在 422/结构化输出错误**时成立（对齐后端 `resolveGoalError`）。
          // 其余错误（如 409 路径变更冲突）的 data 是 `{ details }` 这类业务细节：若把它当恢复
          // 信封喂给 `applyEnvelope`，会按"缺字段"把目标对话重置、且不弹任何提示（18 号复核报告 P1-6）。
          const isRecoveryEnvelope = data?.status === 422 || data?.code === 'STRUCTURED_OUTPUT_INVALID';
          serverError = {
            code: data?.code,
            status: data?.status,
            message: data?.message || '处理失败',
            data: isRecoveryEnvelope ? data?.data : undefined,
            details: data?.data?.details
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
            conflictDetails: serverError.details,
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
  return streamGoalRequest('start', null, {
    text,
    contextMode: options.contextMode,
    meta: options.meta,
    materialIds: options.materialIds
  }, handlers);
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
    probeAnswers: options.probeAnswers,
    meta: options.meta,
    materialIds: options.materialIds
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
