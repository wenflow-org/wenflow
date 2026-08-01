import api, { AI_REQUEST_TIMEOUT } from '../utils/api';

export interface TeachingSession {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  welcomeMessage: string;
  knowledgePoints?: KnowledgePointStatus[];
  mode?: 'new' | 'resumed';
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
}

export interface CheckpointSubmitResult {
  passed: boolean;
  feedback: string;
  hint?: string;
  nextAction: 'continue' | 'review' | 'retry';
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
  messages: Array<{ role: string; content: string; timestamp: string; analysis?: Record<string, unknown>; strategies?: string[]; knowledgePoint?: string | null; knowledgePoints?: KnowledgePointStatus[]; promptDebug?: Record<string, unknown> | null; peerTriggered?: boolean; peerMessage?: string | null; peerDebug?: Record<string, unknown> | null }>;
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
  evaluationSource?: 'model' | 'ai-fallback' | 'failed';
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
    summary: 'model' | 'fallback';
    evaluation: 'model' | 'ai-fallback' | 'failed';
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
  evaluationSource?: 'model' | 'ai-fallback' | 'failed';
}

export interface ReplanAdvisory {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope: 'none' | 'next_milestone' | 'downstream_path';
  rationale: string;
  reasonCodes: string[];
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
  };
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

const finalizationKey = () => `finalize_${crypto.randomUUID()}`;

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
  async startSession(taskId: string): Promise<TeachingSession> {
    const result = await api.post(`/ai-teaching/tasks/${taskId}/session`, {}, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async sendMessage(sessionId: string, message: string, revision: number): Promise<MessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/messages`, { message, revision }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async sendPeerMessage(sessionId: string, message: string): Promise<PeerMessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/peer/messages`, { message }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async endSession(sessionId: string, revision: number): Promise<{
    wrapup: WrapupArtifact;
    advisory: ReplanAdvisory;
    revision: number;
  }> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/end`, { revision }, { timeout: AI_REQUEST_TIMEOUT });
    return result.data || result;
  },

  async pauseSession(sessionId: string, reason: 'manual' | 'pagehide', revision: number): Promise<number> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/pause`, { reason, revision });
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
    const operationId = finalizationKey();
    let result: FinalizationResult;
    try {
      result = await this.finalizeSession(sessionId, payload, operationId);
    } catch (error) {
      const recovered = await this.getFinalization(sessionId).catch(() => null);
      if (!recovered || (!finalizationStepCompleted(recovered, payload.action) && recovered.status !== 'processing')) {
        if (recovered && error && typeof error === 'object') {
          (error as { finalization?: FinalizationResult }).finalization = recovered;
        }
        throw error;
      }
      result = recovered;
    }

    const deadline = Date.now() + 60_000;
    while (result.status === 'processing' && Date.now() < deadline) {
      await wait(result.pollAfterMs || 1500);
      result = await this.getFinalization(sessionId);
    }
    const targetStep = payload.action === 'end_only'
      ? result.finalization?.sessionClosure
      : payload.action === 'complete_task'
        ? result.finalization?.taskCompletion
        : result.finalization?.reviewCompletion;
    if (!finalizationStepCompleted(result, payload.action) && (targetStep === 'not_started' || targetStep === 'skipped')) {
      result = await this.finalizeSession(sessionId, {
        ...payload,
        revision: result.revision
      }, operationId);
      while (result.status === 'processing' && Date.now() < deadline) {
        await wait(result.pollAfterMs || 1500);
        result = await this.getFinalization(sessionId);
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
  }
};

export default aiTeachingAPI;
