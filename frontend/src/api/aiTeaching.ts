import api from '../utils/api';

export interface TeachingSession {
  sessionId: string;
  subject: string;
  topic: string;
  startTime: string;
  welcomeMessage: string;
}

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
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
  peerMessage?: string;
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
  evaluationSource?: 'model';
  messageCount: number;
  avgUnderstanding: number;
  avgCognitiveLevel?: string;
  duration: number;
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
  summary: SessionSummary;
  summarySource?: 'model' | 'fallback';
  evaluation: SessionEvaluation & {
    evaluationSource?: 'model';
  };
}

export const aiTeachingAPI = {
  async startSession(subject: string, topic: string, difficulty = 5, taskId?: string): Promise<TeachingSession> {
    const result = await api.post('/ai-teaching/sessions', { subject, topic, difficulty, taskId });
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
    evaluation?: SessionEvaluation;
    summary?: SessionSummary;
    summarySource?: 'model' | 'fallback';
    duration?: number;
  }> {
    const result = await api.post(`/ai-teaching/sessions/${sessionId}/end`);
    return result.data || result;
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
  }
};

export default aiTeachingAPI;
