// 学习API
import api, { AI_REQUEST_TIMEOUT } from '../utils/api';
import type { ReplanSignalLike } from '@/utils/replanSignal';

export type GenerationLifecycle =
  | 'core_queued'
  | 'core_processing'
  | 'core_stale'
  | 'core_failed'
  | 'stage_design_queued'
  | 'stage_design_processing'
  | 'stage_design_stale'
  | 'stage_design_failed'
  | 'ready';

export type GenerationPhase = 'core' | 'stage_design' | 'ready';
export type GenerationRunStatus = 'queued' | 'processing' | 'stale' | 'failed' | 'ready';
export type GenerationRetryType = 'core' | 'stage_design' | null;

export interface GenerationLifecycleDTO {
  lifecycle: GenerationLifecycle;
  phase: GenerationPhase;
  status: GenerationRunStatus;
  runId: string | null;
  heartbeatAt: string | null;
  retryAllowed: boolean;
  retryType: GenerationRetryType;
  completedStages: number;
  totalStages: number;
  currentStageNumber: number | null;
  errorMessage: string | null;
  canStartLearning: boolean;
}

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
  status?: string;
  weeks: Week[];
  stages?: Stage[];
  milestones?: Stage[];
  createdAt: string;
  updatedAt: string;
  generationStatus?: {
    lifecycle?: GenerationLifecycle;
    phase?: GenerationPhase | 'stageDesign' | 'enrichment';
    status?: GenerationRunStatus | 'pending' | 'succeeded' | 'completed';
    runId?: string | null;
    heartbeatAt?: string | null;
    retryAllowed?: boolean;
    retryType?: GenerationRetryType | 'stageDesign' | 'enrichment';
    completedStages?: number;
    totalStages?: number;
    currentStageNumber?: number | null;
    errorMessage?: string | null;
    canStartLearning?: boolean;
    core?: 'pending' | 'processing' | 'succeeded' | 'failed';
    coreStep?: 'framing' | 'planning' | 'persist' | 'completed';
    stageDesign?: 'pending' | 'processing' | 'succeeded' | 'failed';
    enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
    lastError?: string | null;
    sourceConversationId?: string | null;
    triggerSource?: string | null;
    updatedAt?: string | null;
    enrichmentRetryCount?: number;
    stageDesignRetryCount?: number;
    lastEnrichmentRetryAt?: string | null;
    lastStageDesignRetryAt?: string | null;
    scene?: ({ firstDeliverable?: string } & Record<string, unknown>) | null;
  } | null;
  generationLifecycle?: GenerationLifecycleDTO | null;
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

export interface LearnerStateSummary {
  global: {
    stateLevel: 'recover' | 'caution' | 'balanced' | 'strong';
    pressureLevel: 'low' | 'medium' | 'high';
    fatigueLevel: 'low' | 'medium' | 'high';
    trendLevel: 'improving' | 'stable' | 'declining';
    pacingLevel: 'slow' | 'moderate' | 'fast';
    hasWarnings: boolean;
    warningLevel: 'none' | 'info' | 'warning' | 'critical';
    primaryAction: 'continue-learning' | 'learning-state' | 'achievements' | 'create-goal' | 'path-detail';
  };
  path?: {
    pathId?: string;
    title?: string;
    progressPercent: number;
    stageTitle?: string;
    taskTitle?: string;
    hasPrerequisiteGaps: boolean;
    hasFragileConcepts: boolean;
    hasStrugglingConcepts: boolean;
    recommendedAction: 'continue-current-task' | 'review-prerequisites' | 'slow-down' | 'open-path';
  } | null;
}

export interface AdaptiveGuidancePayload {
  copy: AdaptiveGuidanceCopy;
  summary: LearnerStateSummary;
  debug?: {
    skillId: string;
    model: string | null;
    systemPromptVersion: number | null;
    durationMs: number;
    cached: boolean;
    generatedAt?: string | null;
    userPayload?: string;
    rawModelOutput?: string;
    normalizedOutput?: AdaptiveGuidanceCopy | null;
  } | null;
}

export interface PathReplanRequest {
  triggerSource?: 'goal-conversation' | 'learner-model-agent' | 'ai-teaching' | 'admin' | 'system' | 'api';
  reason?: string;
  mode?: 'new_version' | 'overwrite';
  stageNumber?: number;
  /** 后续阶段重排：从该未学阶段（含）起连续重排到路径末尾；缺省 = 当前活动阶段（单阶段） */
  fromStageNumber?: number;
  evidence?: Record<string, unknown>;
  requireConfirmation?: boolean;
  /** 预览模式：只产出诊断建议（awaiting-confirmation），不执行；确认后去掉再调一次才真正调整 */
  previewOnly?: boolean;
  /** 调整前刚「一键清场」放弃的课堂 id（放行其已完成记录被覆盖，用于放弃→重排闭环） */
  clearedSessionIds?: string[];
}

export interface PathReplanResponse {
  enabled: boolean;
  status: string;
  signal?: ReplanSignalLike | null;
  request?: PathReplanRequest | null;
  policy?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
}

const lifecycleValues = new Set<GenerationLifecycle>([
  'core_queued',
  'core_processing',
  'core_stale',
  'core_failed',
  'stage_design_queued',
  'stage_design_processing',
  'stage_design_stale',
  'stage_design_failed',
  'ready'
]);

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);

const asOptionalString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const asNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const normalizePhase = (value: unknown): GenerationPhase | null => {
  if (value === 'core') return 'core';
  if (value === 'stage_design' || value === 'stageDesign' || value === 'enrichment') {
    return 'stage_design';
  }
  if (value === 'ready') return 'ready';
  return null;
};

const normalizeRunStatus = (value: unknown): GenerationRunStatus | null => {
  if (value === 'queued' || value === 'pending') return 'queued';
  if (value === 'processing') return 'processing';
  if (value === 'stale') return 'stale';
  if (value === 'failed') return 'failed';
  if (value === 'ready' || value === 'succeeded' || value === 'completed') return 'ready';
  return null;
};

const lifecycleFromPhaseStatus = (
  phase: GenerationPhase | null,
  status: GenerationRunStatus | null
): GenerationLifecycle | null => {
  if (phase === 'ready' || status === 'ready') return 'ready';
  if (!phase || !status) return null;
  if (phase === 'core') return `core_${status}` as GenerationLifecycle;
  if (phase === 'stage_design') {
    return `stage_design_${status}` as GenerationLifecycle;
  }
  return null;
};

const getLifecycleParts = (lifecycle: GenerationLifecycle): {
  phase: GenerationPhase;
  status: GenerationRunStatus;
} => {
  if (lifecycle === 'ready') return { phase: 'ready', status: 'ready' };
  if (lifecycle.startsWith('stage_design_')) {
    return {
      phase: 'stage_design',
      status: lifecycle.replace('stage_design_', '') as GenerationRunStatus
    };
  }
  return {
    phase: 'core',
    status: lifecycle.replace('core_', '') as GenerationRunStatus
  };
};

const deriveLegacyLifecycle = (
  source: Record<string, unknown>,
  raw: Record<string, unknown>
): GenerationLifecycle => {
  const pathStatus = source.status;
  const coreStatus = normalizeRunStatus(raw.core);
  const stageDesignStatus = normalizeRunStatus(raw.stageDesign ?? raw.enrichment);

  if (pathStatus === 'generating') {
    if (coreStatus === 'failed') return 'core_failed';
    return coreStatus === 'queued' ? 'core_queued' : 'core_processing';
  }

  if (pathStatus === 'failed') return 'core_failed';

  if (stageDesignStatus === 'queued') return 'stage_design_queued';
  if (stageDesignStatus === 'processing') return 'stage_design_processing';
  if (stageDesignStatus === 'failed') return 'stage_design_failed';

  if (pathStatus === 'active' && source.canStartLearning === false) {
    return 'stage_design_processing';
  }

  if (coreStatus === 'queued') return 'core_queued';
  if (coreStatus === 'processing') return 'core_processing';
  if (coreStatus === 'failed') return 'core_failed';

  return 'ready';
};

/**
 * 将新 lifecycle DTO 与旧路径状态统一成稳定的前端模型。
 * stale 只接受后端明确状态，不再根据前端本地时间推断。
 */
export const normalizeGenerationLifecycle = (value: unknown): GenerationLifecycleDTO => {
  const source = asRecord(value);
  const nestedLifecycle = asRecord(source.generationLifecycle);
  const persistedRun = asRecord(source.generationRun);
  const legacyStatus = asRecord(source.generationStatus);
  const coreRunWaitingForStages = persistedRun.phase === 'core'
    && normalizeRunStatus(persistedRun.status) === 'ready'
    && normalizeRunStatus(legacyStatus.stageDesign ?? legacyStatus.enrichment) !== 'ready';
  const raw = Object.keys(nestedLifecycle).length > 0
    ? nestedLifecycle
    : (Object.keys(persistedRun).length > 0 && !coreRunWaitingForStages
        ? persistedRun
    : (lifecycleValues.has(source.lifecycle as GenerationLifecycle) || source.phase || source.runId
        ? source
        : legacyStatus));

  const explicitLifecycle = lifecycleValues.has(raw.lifecycle as GenerationLifecycle)
    ? raw.lifecycle as GenerationLifecycle
    : null;
  const phaseStatusLifecycle = lifecycleFromPhaseStatus(
    normalizePhase(raw.phase),
    normalizeRunStatus(raw.status)
  );
  const lifecycle = explicitLifecycle || phaseStatusLifecycle || deriveLegacyLifecycle(source, raw);
  const { phase, status } = getLifecycleParts(lifecycle);

  const stages = Array.isArray(source.milestones)
    ? source.milestones
    : (Array.isArray(source.stages) ? source.stages : (Array.isArray(source.weeks) ? source.weeks : []));
  const totalStages = asNonNegativeInteger(
    raw.totalStages ?? raw.totalItems ?? source.totalStages ?? source.totalMilestones ?? source.totalWeeks,
    stages.length
  );
  const completedStagesFallback = lifecycle === 'ready'
    ? totalStages
    : stages.filter((stage) => {
        const record = asRecord(stage);
        const tasks = Array.isArray(record.subtasks) ? record.subtasks : record.tasks;
        return Array.isArray(tasks) && tasks.length > 0;
      }).length;
  const completedStages = Math.min(
    totalStages || Number.MAX_SAFE_INTEGER,
    asNonNegativeInteger(raw.completedStages ?? raw.completedItems, completedStagesFallback)
  );
  const explicitCanStart = typeof raw.canStartLearning === 'boolean'
    ? raw.canStartLearning
    : (typeof source.canStartLearning === 'boolean' ? source.canStartLearning : null);
  const retryTypeValue = normalizePhase(raw.retryType);
  const defaultRetryType = status === 'failed' || status === 'stale'
    ? (phase === 'stage_design' ? 'stage_design' : 'core')
    : null;
  const retryType = retryTypeValue === 'ready' ? null : (retryTypeValue || defaultRetryType);

  return {
    lifecycle,
    phase,
    status,
    runId: asOptionalString(raw.runId),
    heartbeatAt: asOptionalString(raw.heartbeatAt ?? raw.updatedAt),
    retryAllowed: typeof raw.retryAllowed === 'boolean'
      ? raw.retryAllowed
      : (status === 'failed' || status === 'stale'),
    retryType,
    completedStages: totalStages > 0 ? Math.min(completedStages, totalStages) : completedStages,
    totalStages,
    currentStageNumber: asNonNegativeInteger(raw.currentStageNumber, 0) || null,
    errorMessage: asOptionalString(raw.errorMessage ?? raw.lastError)
      || ((status === 'failed' || status === 'stale')
        ? asOptionalString(source.learningBlockedReason)
        : null),
    canStartLearning: explicitCanStart ?? lifecycle === 'ready'
  };
};

export const mergeGenerationLifecycle = (
  path: LearningPath,
  lifecycleValue: unknown
): LearningPath => {
  const generationLifecycle = normalizeGenerationLifecycle(lifecycleValue);
  // stage_design 阶段失败也应映射为 failed（此前只处理 core，导致 stage_design 失败
  // 时 path.status 仍为 active，Dashboard 等消费方把失败路径当「进行中」）
  const nextStatus = generationLifecycle.phase === 'core'
    ? (generationLifecycle.status === 'failed' ? 'failed' : 'generating')
    : (generationLifecycle.status === 'failed' || generationLifecycle.status === 'stale'
      ? 'failed'
      : (path.status === 'completed' ? 'completed' : 'active'));

  return {
    ...path,
    status: nextStatus,
    canStartLearning: generationLifecycle.canStartLearning,
    learningBlockedReason: generationLifecycle.errorMessage
      || (generationLifecycle.lifecycle === 'ready' ? null : path.learningBlockedReason),
    generationLifecycle
  };
};

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
    const response = await api.post('/learning/paths/generate', data, { timeout: AI_REQUEST_TIMEOUT });
    return response.data;
  },

  // 获取学习路径列表
  async getPaths(): Promise<LearningPath[]> {
    const response = await api.get('/learning/paths');
    return (response.data || []).map((path: LearningPath) => ({
      ...path,
      generationLifecycle: normalizeGenerationLifecycle(path)
    }));
  },

  // 获取学习路径详情
  async getPathDetail(id: string): Promise<LearningPath> {
    const response = await api.get(`/learning/paths/${id}`);
    return {
      ...response.data,
      generationLifecycle: normalizeGenerationLifecycle(response.data)
    };
  },

  async getPathGenerationStatus(id: string): Promise<GenerationLifecycleDTO> {
    const response = await api.get(`/learning/paths/${id}/generation-status`);
    return normalizeGenerationLifecycle(response?.data ?? response);
  },

  async requestPathReplan(pathId: string, data: PathReplanRequest): Promise<PathReplanResponse> {
    const response = await api.post(`/learning/paths/${pathId}/replan`, data, { timeout: AI_REQUEST_TIMEOUT });
    return response.data;
  },

  // 重新生成学习路径（支持用户侧补充说明 adjustments）
  // mode: 'rebuild-all' = 整条重建（显式声明覆盖当前规划，有学习进度时后端放行）
  // fromStageNumber: 从该未学阶段起重排剩余阶段（保留已学内容）
  // clearedSessionIds: 本次调整前刚「一键清场」放弃的课堂 id（放行其已完成记录被覆盖）
  async regeneratePath(
    pathId: string,
    adjustments?: string,
    options?: { mode?: 'rebuild-all'; fromStageNumber?: number; clearedSessionIds?: string[] }
  ): Promise<{ message?: string; data?: any }> {
    const response = await api.post(
      `/learning/paths/${pathId}/regenerate`,
      adjustments || options
        ? {
            adjustments: adjustments ?? undefined,
            ...(options?.mode ? { mode: options.mode } : {}),
            ...(options?.fromStageNumber ? { fromStageNumber: options.fromStageNumber } : {}),
            ...(options?.clearedSessionIds?.length ? { clearedSessionIds: options.clearedSessionIds } : {}),
          }
        : undefined,
      { timeout: AI_REQUEST_TIMEOUT }
    );
    return response.data;
  },

  async retryPathEnrichment(pathId: string): Promise<{ message?: string }> {
    const response = await api.post(`/learning/paths/${pathId}/retry-stage-design`, undefined, { timeout: AI_REQUEST_TIMEOUT });
    return response.data;
  },

  /** 一键清场：把路径调整范围内未结束课堂按放弃收尾；返回 cleared/failed/remaining */
  async abandonOpenSessions(
    pathId: string,
    options?: { fromStageNumber?: number; stageNumber?: number; sessionIds?: string[] }
  ): Promise<{ success: boolean; data?: any; message?: string; error?: any }> {
    const response = await api.post(
      `/learning/paths/${pathId}/abandon-open-sessions`,
      options || {},
      { timeout: AI_REQUEST_TIMEOUT }
    );
    return response.data;
  },

  async retryPathGeneration(pathId: string): Promise<{ message?: string }> {
    const response = await api.patch(`/learning/paths/${pathId}/retry`, undefined, { timeout: AI_REQUEST_TIMEOUT });
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
    return (response as { data?: unknown } | null)?.data ?? null;
  },

  async getAdaptiveGuidance(): Promise<AdaptiveGuidancePayload | null> {
    const response = await api.get('/adaptive-guidance/copy');
    return response.data || null;
  }
};
