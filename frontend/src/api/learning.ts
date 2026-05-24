// 学习API
import api from '../utils/api';

export interface LearningGoal {
  id: string;
  userId: string;
  description: string;
  subject?: string;
  status: number;
  progress: number;
  learningPathId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningPath {
  id: string;
  userId: string;
  name: string;
  title?: string;
  description: string;
  summary?: string;
  subject?: string;
  deadline?: string;
  deadlineText?: string;
  totalStages?: number;
  estimatedHours?: number;
  aiGenerated: boolean;
  weeks: Week[];
  stages?: Stage[];
  milestones?: Stage[];
  createdAt: string;
  updatedAt: string;
  generationStatus?: {
    core?: 'pending' | 'processing' | 'succeeded' | 'failed';
    coreStep?: 'framing' | 'planning' | 'persist' | 'completed';
    enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
    lastError?: string | null;
    sourceConversationId?: string | null;
    triggerSource?: string | null;
    updatedAt?: string | null;
    enrichmentRetryCount?: number;
    lastEnrichmentRetryAt?: string | null;
    scene?: Record<string, any> | null;
  } | null;
  sceneSummary?: {
    title?: string;
    firstDeliverable?: string;
    targetState?: string;
    planningFocus?: string[];
    excludedScope?: string[];
    riskFlags?: string[];
    timeBudget?: string | null;
    timeHorizon?: string | null;
    milestoneCount?: number;
    taskCount?: number;
  } | null;
  cognitiveDesign?: {
    cognitiveDomain?: string | null;
    coreConcepts?: Array<{
      id: string;
      name: string;
      role?: 'hub' | 'supporting';
      description?: string;
    }>;
  } | null;
  adjustmentPolicy?: {
    allowedModes?: Array<'expand' | 'compress' | 'replan'>;
    recommendedMode?: 'expand' | 'compress' | 'replan' | null;
    triggerSource?: 'learn' | 'ai-teaching' | 'learner-model-agent' | 'system' | null;
  } | null;
  adjustmentEvidence?: {
    stableConcepts?: string[];
    fragileConcepts?: string[];
    strugglingConcepts?: string[];
    prerequisiteGaps?: string[];
    pacingSignal?: 'fast' | 'slow' | 'balanced' | null;
  } | null;
  canStartLearning?: boolean;
  learningBlockedReason?: string | null;
  replanLineage?: {
    sourcePathId?: string | null;
    replanMode?: string | null;
    triggerSource?: string | null;
    reason?: string | null;
  } | null;
}

export interface Week {
  id: string;
  weekNumber: number;
  title?: string;
  description?: string;
  tasks: Task[];
}

export interface Stage {
  id: string;
  stageNumber: number;
  title?: string;
  description?: string;
  goal?: string;
  estimatedHours?: number;
  status?: string;
  subtasks: Task[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  taskType?: string;
  status?: string;
  completionRate?: number;
  estimatedMinutes?: number;
  acceptanceCriteria?: string;
  actualMinutes?: number;
  hasTeachingWrapup?: boolean;
  latestTeachingSessionAt?: string | null;
  latestWrapupStatus?: 'complete' | 'summary-only' | null;
  displayLabel?: string | null;
  knowledgeType?: string | null;
  cognitiveLevel?: string | null;
  learningObjectives?: string[] | string | null;
  coreConcept?: string | null;
  learningPath?: {
    id: string;
    name: string;
    subject?: string;
    canStartLearning?: boolean;
    learningBlockedReason?: string | null;
    generationStatus?: LearningPath['generationStatus'];
  };
}

export interface LearningStats {
  user: {
    id: string;
    name: string;
    xp: number;
    level: number;
  };
  paths?: {
    total: number;
  };
  subtasks?: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
  };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
    completionRate: number;
  };
  time: {
    totalMinutes?: number;
    totalEstimated: number;
    totalCompleted: number;
    activeLearningDays?: number;
    avgDailyMinutes?: number;
    progress: number;
    completionRate?: string;
  };
  state?: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  } | null;
  suggestion?: {
    level?: string;
    message?: string;
    action?: string;
  } | null;
}

export interface AdaptiveGuidanceCopy {
  headline: string;
  subtitle: string;
  todayActions: Array<{ title: string; desc: string; action: string; to?: string }>;
  pathHint: string;
  nextStep: string;
  paceHint: string;
  emptyStateCopy: string;
  warningCopy: string;
}

export const learningAPI = {
  // 创建学习目标
  async createGoal(data: { description: string; subject?: string }): Promise<LearningGoal> {
    const response = await api.post('/learning/goals', data);
    return response.data;
  },

  // 获取学习目标列表
  async getGoals(): Promise<LearningGoal[]> {
    const response = await api.get('/learning/goals');
    return response.data;
  },

  // 生成学习路径
  async generatePath(data: {
    description: string;
    subject?: string;
    userProfile?: {
      skillLevel?: string;
      learningStyle?: string;
      timePerDay?: string;
    };
  }): Promise<{ learningPath: LearningPath; weeks: Week[]; totalTasks: number }> {
    const response = await api.post('/learning/paths/generate', data);
    return response.data;
  },

  // 获取学习路径列表
  async getPaths(): Promise<LearningPath[]> {
    const response = await api.get('/learning/paths');
    return response.data;
  },

  // 获取学习路径详情
  async getPathDetail(id: string): Promise<LearningPath> {
    const response = await api.get(`/learning/paths/${id}`);
    return response.data;
  },

  // 重新生成学习路径
  async regeneratePath(pathId: string): Promise<{ message?: string }> {
    const response = await api.post(`/learning/paths/${pathId}/regenerate`);
    return response.data;
  },

  async retryPathEnrichment(pathId: string): Promise<{ message?: string }> {
    const response = await api.post(`/learning/paths/${pathId}/retry-stage-design`);
    return response.data;
  },

  // 完成任务
  async completeTask(taskId: string, data: {
    actualMinutes?: number;
    subjectiveDifficulty?: number;
    notes?: string;
  }): Promise<Task> {
    const response = await api.post(`/learning/tasks/${taskId}/complete`, data);
    return response.data;
  },

  // 获取学习统计
  async getStats(): Promise<LearningStats> {
    const response = await api.get('/learning/stats');
    return response.data;
  },

  // 获取当前学习状态
  async getCurrentState() {
    const response = await api.get('/state/current');
    return (response as any)?.data ?? null;
  },

  async getAdaptiveGuidance(view: 'dashboard' | 'path-list' | 'path-detail', pathId?: string): Promise<AdaptiveGuidanceCopy | null> {
    const query = pathId ? `?view=${encodeURIComponent(view)}&pathId=${encodeURIComponent(pathId)}` : `?view=${encodeURIComponent(view)}`;
    const response = await api.get(`/adaptive-guidance/copy${query}`);
    return response.data || null;
  }
};
