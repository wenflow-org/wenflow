import api, { AI_REQUEST_TIMEOUT } from '../utils/api';
import { streamSsePost } from '../utils/sse';
import type { InteractionMeta } from '../composables/useInteractionMeta';

export interface TeachingSession {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  welcomeMessage: string;
  knowledgePoints?: KnowledgePointStatus[];
  mode?: 'new' | 'resumed' | 'review';
  revision: number;
  opening?: {
    message: string;
    question: string;
    quickReplies: Array<{ text: string }>;
    mode: 'self-assess' | 'predict' | 'example-first';
  };
}

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface CheckpointOption {
  id: string;
  text: string;
}

export interface Checkpoint {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'short_answer';
  title: string;
  question: string;
  options?: CheckpointOption[];
  allowSkip?: boolean;
  contextHint?: string;
}

export interface CheckpointSubmitPayload {
  selectedOptionIds?: string[];
  answerText?: string;
  /** 跳过检查点：清除待处理检查点并记录历史，不触发教学回合 */
  skip?: boolean;
}

export interface CheckpointSubmitResult {
  passed: boolean;
  feedback: string;
  hint?: string;
  nextAction: 'continue' | 'review';
  revision: number;
}

export interface MessageResult {
  aiResponse: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: string;
    confusionPoints: string[];
    engagement: string;
    emotionalState: string;
    loadIndex?: number;
    loadBasis?: string;
  };
  state: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  };
  strategies: string[];
  knowledgePoint: string | null;
  knowledgePoints: KnowledgePointStatus[];
  isCompletion: boolean;
  shouldConfirmEnd?: boolean;
  endReason?: 'completion-candidate' | 'learner-requested-end' | null;
  peerTriggered: boolean;
  autoEnded?: boolean;
  recovered?: boolean;
  wrapup?: WrapupArtifact | null;
  advisory?: ReplanAdvisory | null;
  peerMessage?: string | null;
  peerStrategy?: string | null;
  peerFollowUpQuestions?: string[];
  peerDebug?: Record<string, unknown> | null;
  checkpoint?: Checkpoint | null;
  promptDebug?: Record<string, unknown> | null;
  /** 统一运行契约观测字段（不驱动 UI 结束逻辑） */
  runtimeEnvelope?: {
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
  } | null;
  completionAlignment?: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither';
  envelopeCompletionSignal?: boolean;
  lastBusinessPhase?: string | null;
  revision: number;
}

export interface PeerMessageResult {
  peerResponse: string;
  peerStrategy?: string | null;
  peerFollowUpQuestions?: string[];
}

export interface LearningState {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  suggestion: string;
}

export interface SessionHistoryItem {
  id: string;
  subject: string;
  topic: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: string;
  messageCount: number;
}

export interface ActiveSessionInfo {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  messageCount: number;
}

export interface SessionDetail {
  id: string;
  subject: string;
  topic: string;
  taskId?: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: string;
  messages: Array<{ role: string; content: string; timestamp: string; analysis?: Record<string, unknown>; strategies?: string[]; knowledgePoint?: string | null; knowledgePoints?: KnowledgePointStatus[]; promptDebug?: Record<string, unknown> | null; peerTriggered?: boolean; peerMessage?: string | null; peerStrategy?: string | null; peerFollowUpQuestions?: string[]; peerDebug?: Record<string, unknown> | null; peer?: boolean }>;
  state: Record<string, unknown> | null;
  knowledgePoints?: KnowledgePointStatus[];
  wrapup?: WrapupArtifact | null;
  advisory?: ReplanAdvisory | null;
  pendingCheckpoint?: Checkpoint | null;
  revision: number;
}

export interface SessionEvaluation {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  sessionLss?: number;
  sessionKtl?: number;
  sessionLf?: number;
  confidence?: number;
  evaluationSource?: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  messageCount: number;
  avgUnderstanding: number;
  avgCognitiveLevel?: string;
  duration: number;
}

export interface WrapupProgressDelta {
  newlyMastered: string[];
  movedToReview: string[];
  stillLearning: string[];
  unchangedMastered: string[];
}

export interface WrapupEvidence {
  turnCount: number;
  avgUnderstanding: number | null;
  avgEngagement: number | null;
  dominantCognitiveLevel: string | null;
  lastCognitiveLevel: string | null;
  topConfusionPoints: string[];
  emotionalSignals: {
    positive: number;
    neutral: number;
    frustrated: number;
    confused: number;
  };
  completionCandidateSeen: boolean;
}

export interface WrapupArtifact {
  status: 'complete' | 'summary-only';
  sources: {
    summary: 'model' | 'fallback' | 'timeout-fallback';
    evaluation: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  };
  summary: SessionSummary;
  evaluation: (SessionEvaluation & {
    sessionLss?: number;
    sessionKtl?: number;
    sessionLf?: number;
    confidence?: number;
    reasoning?: string;
  }) | null;
  progress: WrapupProgressDelta;
  evidence: WrapupEvidence;
  stateUpdate?: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  } | null;
  duration?: number;
  summarySource?: 'model' | 'fallback';
  evaluationSource?: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
}

export interface ReplanAdvisory {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope: 'none' | 'next_milestone' | 'downstream_path';
  rationale: string;
  reasonCodes: string[];
  /** LLM 归因（阈值召回之后补的「为什么」）；未启用/失败时为 null */
  attribution?: {
    primaryReasonCode: string;
    reason: string;
    claim: string;
    expect: string;
    checkOn: 'next_lesson' | 'next_task';
    evidenceRefs: string[];
    thresholdRecommendation: string;
  } | null;
  ui: {
    title: string;
    body: string;
    options: Array<{
      key: string;
      label: string;
      description: string;
    }>;
  };
}

export interface SessionSummary {
  topicSummary: string;
  knowledgeSummary: string;
  practiceAdvice: string;
  learningEvaluation: string;
  knowledgeItems?: Array<{
    name: string;
    status: string;
    progress: number;
    evidence: string;
  }>;
  keyTakeaways?: string[];
  actionPlan?: string[];
  evaluationHighlights?: {
    strengths: string[];
    improvements: string[];
  } | null;
  metricInterpretation?: {
    session: string;
    longTerm: string;
  };
  summaryVersion?: 'v2';
}

export interface TaskEvaluationDetail {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  endTime: string | null;
  duration: number;
  messageCount: number;
  knowledgePoints: KnowledgePointStatus[];
  wrapup: WrapupArtifact;
  advisory?: ReplanAdvisory | null;
}

export type FinalizeAction = 'end_only' | 'complete_task' | 'complete_review';

export interface SessionFinalizationState {
  sessionClosure: 'not_started' | 'processing' | 'completed' | 'failed' | 'skipped';
  taskCompletion: 'not_started' | 'processing' | 'completed' | 'failed' | 'skipped';
  reviewCompletion: 'not_started' | 'processing' | 'completed' | 'failed' | 'skipped';
  lastAction: FinalizeAction;
  lastOperationId: string;
  lastRequestedAt: string;
  lastCompletedAt?: string;
  lastErrorCode?: string;
}

export interface FinalizationResult {
  operationId: string;
  status: 'processing' | 'completed' | 'failed' | 'not_started';
  pollAfterMs?: number;
  revision: number;
  session?: { id: string; status: string; mode: string };
  taskCompletion?: { status: 'completed' | 'skipped'; alreadyCompleted: boolean };
  finalization?: SessionFinalizationState | null;
  wrapup?: WrapupArtifact | null;
  advisory?: ReplanAdvisory | null;
  reviewItems?: unknown[];
  projectionStatus?: 'pending' | 'not_started';
}

function finalizationKey() {
  // crypto.randomUUID 仅安全上下文（HTTPS/localhost）可用，非安全上下文需兜底
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `finalize_${crypto.randomUUID()}`;
  }
  return `finalize_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const finalizationStepCompleted = (result: FinalizationResult, action: FinalizeAction) => {
  if (action === 'end_only') {
    return result.session?.status === 'completed'
      && result.finalization?.sessionClosure === 'completed';
  }
  if (action === 'complete_task') {
    return result.finalization?.taskCompletion === 'completed';
  }
  return result.finalization?.reviewCompletion === 'completed';
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export const aiTeachingAPI = {
  async startSession(taskId: string, mode?: 'tutor' | 'review'): Promise<TeachingSession> {
    const result = await api.post(
      `/ai-teaching/tasks/${taskId}/session`,
      mode ? { mode } : {},
      { timeout: AI_REQUEST_TIMEOUT }
    );
    return result.data || result;
  },

  /** 到期复习清单（复习闭环） */
  async getReviewDue(): Promise<Array<{ conceptKey: string; label: string; retention: number; reason: string; estimatedMinutes: number }>> {
    const result = await api.get('/ai-teaching/review/due');
    return result.data?.items || [];
  },

  /** 开始复习课（mode=review，knowledgeState 注入到期复习点） */
  async startReviewSession(taskId: string): Promise<TeachingSession> {
    const result = await api.post('/ai-teaching/review/sessions', { taskId }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async sendMessage(sessionId: string, message: string, revision: number, meta?: InteractionMeta): Promise<MessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/messages`, { message, revision, ...(meta ? { meta } : {}) }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  /**
   * SSE 流式发送消息：delta 事件逐段回调 onDelta，final 事件返回完整 MessageResult。
   * 失败时 reject，错误对象携带来源标记：
   * - transport=true：连接层失败且未收到任何内容，调用方可安全重发（非流式）
   * - serverError=true：服务端业务失败（event: error），不可重发
   * - partialStream=true：已收到部分内容后断连，不可重发
   */
  async streamSendMessage(
    sessionId: string,
    message: string,
    revision: number,
    handlers: { onDelta: (text: string) => void; onRestart?: () => void; signal?: AbortSignal },
    meta?: InteractionMeta
  ): Promise<MessageResult> {
    return new Promise<MessageResult>((resolve, reject) => {
      let result: MessageResult | null = null;
      let receivedAnything = false;
      let serverError: { code?: string; status?: number; message: string } | null = null;
      let settled = false;
      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      streamSsePost(`/ai-teaching/sessions/${sessionId}/messages`, { message, revision, ...(meta ? { meta } : {}) }, {
        signal: handlers.signal,
        onEvent: (event, data) => {
          if (event === 'delta' && typeof data?.text === 'string') {
            receivedAnything = true;
            handlers.onDelta(data.text);
          } else if (event === 'restart') {
            receivedAnything = true;
            handlers.onRestart?.();
          } else if (event === 'final') {
            receivedAnything = true;
            result = data?.data || data || null;
          } else if (event === 'error') {
            receivedAnything = true;
            serverError = {
              code: data?.code,
              status: data?.status,
              message: data?.message || '生成失败'
            };
          }
        }
      }).then(
        () => {
          if (settled) return;
          settled = true;
          if (result) resolve(result);
          else if (serverError) {
            reject(Object.assign(new Error(serverError.message), {
              code: serverError.code,
              status: serverError.status,
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
  },

  /**
   * 恢复续讲（resume-continue）：无学生新输入，后端直接跑一个纯续讲回合，
   * 返回 AI 自然接续的开场白。不落库伪用户消息、不污染对话历史。
   */
  async streamContinueSession(
    sessionId: string,
    revision: number,
    handlers: { onDelta: (text: string) => void; onRestart?: () => void; signal?: AbortSignal }
  ): Promise<MessageResult> {
    return new Promise<MessageResult>((resolve, reject) => {
      let result: MessageResult | null = null;
      let receivedAnything = false;
      let serverError: { code?: string; status?: number; message: string } | null = null;
      let settled = false;
      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      streamSsePost(`/ai-teaching/sessions/${sessionId}/continue`, { revision }, {
        signal: handlers.signal,
        onEvent: (event, data) => {
          if (event === 'delta' && typeof data?.text === 'string') {
            receivedAnything = true;
            handlers.onDelta(data.text);
          } else if (event === 'restart') {
            receivedAnything = true;
            handlers.onRestart?.();
          } else if (event === 'final') {
            receivedAnything = true;
            result = data?.data || data || null;
          } else if (event === 'error') {
            receivedAnything = true;
            serverError = {
              code: data?.code,
              status: data?.status,
              message: data?.message || '恢复续讲失败'
            };
          }
        }
      }).then(
        () => {
          if (settled) return;
          settled = true;
          if (result) resolve(result);
          else if (serverError) {
            reject(Object.assign(new Error(serverError.message), {
              code: serverError.code,
              status: serverError.status,
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
  },

  async sendPeerMessage(sessionId: string, message: string): Promise<PeerMessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/peer/messages`, { message }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  /**
   * SSE 流式伴学消息：final 事件返回完整结果；
   * 失败标记与 streamSendMessage 一致（transport 可安全回退，serverError 不可）。
   */
  async streamSendPeerMessage(
    sessionId: string,
    message: string,
    handlers: { signal?: AbortSignal }
  ): Promise<PeerMessageResult> {
    return new Promise<PeerMessageResult>((resolve, reject) => {
      let result: PeerMessageResult | null = null;
      let receivedAnything = false;
      let serverError: { code?: string; status?: number; message: string } | null = null;
      let settled = false;
      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      streamSsePost(`/ai-teaching/sessions/${sessionId}/peer/messages`, { message }, {
        signal: handlers.signal,
        onEvent: (event, data) => {
          if (event === 'final') {
            receivedAnything = true;
            result = data?.data || data || null;
          } else if (event === 'error') {
            receivedAnything = true;
            serverError = {
              code: data?.code,
              status: data?.status,
              message: data?.message || '生成失败'
            };
          }
        }
      }).then(
        () => {
          if (settled) return;
          settled = true;
          if (result) resolve(result);
          else if (serverError) {
            reject(Object.assign(new Error(serverError.message), {
              code: serverError.code,
              status: serverError.status,
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
  },

  async endSession(sessionId: string, revision: number): Promise<{
    wrapup: WrapupArtifact;
    advisory: ReplanAdvisory;
    revision: number;
  }> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/end`, { revision }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async pauseSession(sessionId: string, reason: 'manual' | 'pagehide' | 'hidden', revision: number): Promise<number> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/pause`, { reason, revision });
    return result.data?.revision;
  },

  async resumeSession(sessionId: string, revision: number): Promise<number> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/resume`, { revision });
    return result.data?.revision;
  },

  async finalizeSession(
    sessionId: string,
    payload: {
      action: FinalizeAction;
      revision: number;
      actualMinutes?: number;
      subjectiveDifficulty?: number;
      reason?: 'manual-end' | 'learner-abandoned' | 'task-completed';
    },
    operationId = finalizationKey()
  ): Promise<FinalizationResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/finalize`, payload, {
      timeout: AI_REQUEST_TIMEOUT,
      headers: { 'Idempotency-Key': operationId }
    });
    return result.data || result;
  },

  async getFinalization(sessionId: string): Promise<FinalizationResult> {
    const result = await api.get(`/ai-teaching/sessions/${sessionId}/finalization`);
    return result.data || result;
  },

  async finalizeSessionReliably(
    sessionId: string,
    payload: {
      action: FinalizeAction;
      revision: number;
      actualMinutes?: number;
      subjectiveDifficulty?: number;
      reason?: 'manual-end' | 'learner-abandoned' | 'task-completed';
    }
  ): Promise<FinalizationResult> {
    let result: FinalizationResult;
    try {
      result = await this.finalizeSession(sessionId, payload, finalizationKey());
    } catch (error) {
      const recovered = await this.getFinalization(sessionId).catch(() => null);
      // 连结算状态都拿不到：无法安全补偿，原样抛出。
      if (!recovered) throw error;
      // 首次失败但服务端已有结算状态：落到下方统一的「未完成则换新 key 补一次」补偿。
      // P1 修复：原实现在这里只要步骤未完成且非 processing 就直接 throw，
      // 导致下面那段换新 Idempotency-Key 的补偿分支永远不可达（用户点了也白点）。
      result = recovered;
    }

    const deadline = Date.now() + 60_000;
    const pollUntilSettled = async (initial: FinalizationResult): Promise<FinalizationResult> => {
      let current = initial;
      while (current.status === 'processing' && Date.now() < deadline) {
        await wait(current.pollAfterMs || 1500);
        current = await this.getFinalization(sessionId);
      }
      return current;
    };
    result = await pollUntilSettled(result);

    if (!finalizationStepCompleted(result, payload.action)) {
      const targetStep = payload.action === 'end_only'
        ? result.finalization?.sessionClosure
        : payload.action === 'complete_task'
          ? result.finalization?.taskCompletion
          : result.finalization?.reviewCompletion;
      if (targetStep === 'not_started' || targetStep === 'skipped') {
        // 此重试携带「服务端当前 revision」——属于不同的课堂结束请求，必须换新的 Idempotency-Key。
        // 复用同一 key + 变更 revision 会被后端以 FINALIZATION_IDEMPOTENCY_KEY_REUSED(409) 拒绝。
        result = await this.finalizeSession(sessionId, {
          ...payload,
          revision: result.revision
        }, finalizationKey());
        result = await pollUntilSettled(result);
      }
    }
    if (!finalizationStepCompleted(result, payload.action)) {
      const error = new Error(result.finalization?.lastErrorCode || '课堂结束处理尚未完成');
      (error as Error & { finalization?: FinalizationResult }).finalization = result;
      throw error;
    }
    return result;
  },

  async resetSession(sessionId: string, revision: number): Promise<number> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/reset`, { revision });
    return result.data?.revision;
  },

  async getState(): Promise<LearningState | null> {
    const result = await api.get('/ai-teaching/state');
    return result.data || null;
  },

  async getTrends(days = 7): Promise<Array<{ timestamp: string; lss: number; ktl: number; lf: number; lsb: number }>> {
    const result = await api.get(`/ai-teaching/trends?days=${days}`);
    return result.data || [];
  },

  async getActiveSessions(taskId?: string): Promise<ActiveSessionInfo[]> {
    const url = taskId 
      ? `/ai-teaching/sessions/active?taskId=${taskId}`
      : '/ai-teaching/sessions/active';
    const result = await api.get(url);
    return result.data || [];
  },

  async getHistory(): Promise<SessionHistoryItem[]> {
    const result = await api.get('/ai-teaching/sessions/history');
    return result.data || [];
  },

  async getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
    const result = await api.get(`/ai-teaching/sessions/${sessionId}/detail`);
    return result.data || null;
  },

  async getLatestTaskEvaluation(taskId: string): Promise<TaskEvaluationDetail | null> {
    const result = await api.get(`/ai-teaching/tasks/${taskId}/evaluation/latest`);
    return result.data || null;
  },

  async submitCheckpoint(sessionId: string, checkpointId: string, payload: CheckpointSubmitPayload, revision: number): Promise<CheckpointSubmitResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/checkpoints/${checkpointId}/submit`, { ...payload, revision }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  /**
   * SSE 流式提交检查点（走查 B-1）。
   *
   * 与非流式版的差别：服务端先推 `judgement` —— **代码裁决**的对错（纯计算、
   * 立即可得），随后才跑教学回合并把导师讲解用 `delta` 逐段推来，最后 `final`。
   * 动因：对错本可立即告知，此前却要等一整个教学回合（实测 60–80s）才知道。
   *
   * 失败语义与 streamSendMessage 一致：`transport=true` 表示连接层失败且**未收到任何内容**
   * （调用方可安全回退到非流式重发）；`serverError=true` 为服务端业务失败（不可重发）。
   */
  async streamSubmitCheckpoint(
    sessionId: string,
    checkpointId: string,
    payload: CheckpointSubmitPayload,
    revision: number,
    handlers: {
      onJudgement?: (judgement: { passed: boolean; judgedBy: string; detail: string | null }) => void;
      onDelta?: (text: string) => void;
      onRestart?: () => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<CheckpointSubmitResult> {
    return new Promise<CheckpointSubmitResult>((resolve, reject) => {
      let result: CheckpointSubmitResult | null = null;
      let serverError: string | null = null;
      let receivedAnything = false;
      let settled = false;
      streamSsePost(
        `/ai-teaching/sessions/${sessionId}/checkpoints/${checkpointId}/submit/stream`,
        { ...payload, revision },
        {
          signal: handlers.signal,
          onEvent: (event, data) => {
            if (event === 'judgement') {
              receivedAnything = true;
              const j = (data?.judgement ?? data) as { passed: boolean; judgedBy: string; detail: string | null };
              handlers.onJudgement?.(j);
            } else if (event === 'delta' && typeof data?.text === 'string') {
              receivedAnything = true;
              handlers.onDelta?.(data.text);
            } else if (event === 'restart') {
              receivedAnything = true;
              handlers.onRestart?.();
            } else if (event === 'final') {
              receivedAnything = true;
              result = (data?.data ?? data) as CheckpointSubmitResult;
            } else if (event === 'error') {
              serverError = String(data?.message || '提交失败');
            } else if (event === 'done') {
              if (settled) return;
              settled = true;
              if (serverError) {
                reject(Object.assign(new Error(serverError), { serverError: true }));
                return;
              }
              if (result) {
                resolve(result);
                return;
              }
              reject(Object.assign(new Error('提交失败'), { serverError: true }));
            }
          },
        }
      ).catch((error) => {
        if (settled) return;
        settled = true;
        reject(Object.assign(error instanceof Error ? error : new Error('提交失败'), {
          transport: !receivedAnything,
        }));
      });
    });
  }
};

export default aiTeachingAPI;
