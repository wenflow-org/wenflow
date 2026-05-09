import api from '../utils/api';

export interface TeachingSession {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  welcomeMessage: string;
  mode?: 'new' | 'resumed';
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
  peerTriggered: boolean;
  peerMessage?: string | null;
  checkpoint?: Checkpoint | null;
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
  messages: Array<{ role: string; content: string; timestamp: string }>;
  state: any;
  knowledgePoints?: KnowledgePointStatus[];
  wrapup?: WrapupArtifact | null;
  advisory?: ReplanAdvisory | null;
  pendingCheckpoint?: Checkpoint | null;
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

export const aiTeachingAPI = {
  async startSession(taskId: string, options?: { forceNew?: boolean }): Promise<TeachingSession> {
    const result = await api.post(`/ai-teaching/tasks/${taskId}/session`, { forceNew: !!options?.forceNew });
    return result.data || result;
  },

  async sendMessage(sessionId: string, message: string): Promise<MessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/messages`, { message });
    return result.data || result;
  },

  async sendPeerMessage(sessionId: string, message: string): Promise<PeerMessageResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/peer/messages`, { message });
    return result.data || result;
  },

  async endSession(sessionId: string): Promise<{
    wrapup: WrapupArtifact;
    advisory: ReplanAdvisory;
  }> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/end`);
    return result.data || result;
  },

  async pauseSession(sessionId: string, reason: 'manual' | 'pagehide' = 'manual'): Promise<void> {
    await api.post(`/ai-teaching/sessions/${sessionId}/pause`, { reason });
  },

  async resetSession(sessionId: string): Promise<void> {
    await api.post(`/ai-teaching/sessions/${sessionId}/reset`);
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

  async submitCheckpoint(sessionId: string, checkpointId: string, payload: CheckpointSubmitPayload): Promise<CheckpointSubmitResult> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/checkpoints/${checkpointId}/submit`, payload);
    return result.data || result;
  }
};

export default aiTeachingAPI;
