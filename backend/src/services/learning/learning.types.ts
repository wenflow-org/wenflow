// 学习服务 - 模块级类型声明（自 learning.service.ts 抽离，行为保持不变）
import type { PathGenerationPhase } from './path-generation-status';
import { NEW_PATH_TASK_TYPES } from './learning.constants';

export interface CreateGoalData {
  userId: string;
  description: string;
  subject?: string;
}

export interface GeneratePathData {
  source?: 'goal' | 'learn' | 'replan' | 'api';
  mode?: 'generate' | 'expand' | 'compress' | 'replan';
  userId: string;
  description: string;
  subject?: string;
  deadline?: Date;
  deadlineText?: string;
  sourceConversationId?: string;
  existingPathId?: string;
  generationRunId?: string;
  createdPlaceholder?: boolean;
  userProfile?: {
    skillLevel?: string;
    currentSkillLevel?: string;
    learningStyle?: string;
    timePerDay?: string;
    learningGoal?: string;
    cognitiveProfile?: {
      metacognition_level?: string;
      thinking_style?: string;
      prior_knowledge_structure?: string;
      confusion_pattern?: string;
      self_assessment_accuracy?: string;
    };
    emotionalProfile?: {
      motivation_trigger?: string;
      urgency_level?: string;
      confidence_level?: string;
    };
    problemContext?: any;
    priorKnowledge?: any[];
    daysPerWeek?: number;
    totalWeeks?: number;
    structuredData?: any;
    confirmedProposal?: any;
    confidenceScores?: any;
    conversationHistory?: Array<{ role: string; content: string }>;
    normalizedInput?: any;
    goalFinalPayload?: GoalToPathHandoffSnapshot;
    pathSceneFraming?: any;
    pathSceneFramingInput?: any;
    pathSceneFramingRaw?: string | null;
    replan?: {
      mode?: 'new_version' | 'overwrite';
      triggerSource?: string;
      sourcePathId?: string;
      learnerReplanProjection?: any;
      freezeCompletedTaskIds?: string[];
      /** 显式整条重建（用户主动选择「重新来一遍」）：放行 replace-path 的已完成任务保护 */
      forceReplace?: boolean;
      /** path-reviewer 评审失败后的重规划指令（自动重规划闭环注入，非用户侧） */
      reviewerFeedback?: string;
    };
  };
  systemPromptOverrides?: {
    pathAgent?: string;
  };
}

export interface PathReplanRequest {
  pathId: string;
  userId: string;
  triggerSource?: 'goal-conversation' | 'learner-model-agent' | 'skill:learner-model' | 'ai-teaching' | 'teaching-agent' | 'admin' | 'system' | 'api';
  reason?: string;
  mode?: 'new_version' | 'overwrite';
  stageNumber?: number;
  /** 后续阶段重排：从该未学阶段（含）起连续重排到末尾。缺省 = 当前活动阶段（单阶段，原行为）。 */
  fromStageNumber?: number;
  evidence?: Record<string, any>;
  requireConfirmation?: boolean;
  /** 预览模式：只产出诊断建议（signal/projection）并返回 awaiting-confirmation，
   *  无论 shouldSuggest 与否都不执行；供「AI 诊断 → 用户确认后再调整」的两段式交互使用。 */
  previewOnly?: boolean;
}

export type PathCoreStep = 'framing' | 'planning' | 'persist' | 'completed';

export interface PathGenerationLogPayload {
  userId: string;
  phase: PathGenerationPhase;
  status: 'started' | 'succeeded' | 'failed';
  pathId?: string;
  sourceConversationId?: string;
  triggerSource?: string;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
}

export interface PathGenerationStatusPatch {
  core?: 'pending' | 'processing' | 'succeeded' | 'failed';
  coreStep?: PathCoreStep;
  stageDesign?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string;
  stageDesignRetryCount?: number;
  lastStageDesignRetryAt?: string | null;
  scene?: Record<string, any> | null;
}

export interface ParsedPathGenerationStatus {
  core?: 'pending' | 'processing' | 'succeeded' | 'failed';
  coreStep?: PathCoreStep;
  stageDesign?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string | null;
  stageDesignRetryCount?: number;
  lastStageDesignRetryAt?: string | null;
  scene?: Record<string, any> | null;
}

export interface PathSceneFramingNormalizedInput {
  version?: string | null;
  learnerProfile?: {
    surfaceGoal?: string | null;
    currentBaseline?: {
      level?: string | null;
      evidence?: string | null;
    };
    motivation?: string | null;
    urgency?: string | null;
    backgroundExperience?: string | null;
    painPoints?: string[];
    learningSignal?: string | null;
    constraintsAndBoundaries?: string[];
  };
  problemSpace?: {
    realProblem?: string | null;
    scenario?: string | null;
    currentPainPoint?: string | null;
  };
  resources?: {
    timeBudget?: string | null;
    timeBudgetCadence?: string | null;
    timePerWeek?: string | null;
    timePerSession?: string | null;
    timeHorizon?: string | null;
    deadlineText?: string | null;
  };
  successCriteria?: {
    observableResult?: string | null;
    acceptanceCheck?: string | null;
  };
  confirmedProposal?: {
    learningDirection?: string | null;
    firstDeliverable?: string | null;
    keyStages?: string[];
    outOfScope?: string[];
  } | null;
  planningHints?: {
    paceSignal?: 'compact' | 'standard' | 'extended' | null;
    milestoneRange?: [number, number] | number[];
    conceptRange?: [number, number] | number[];
    subtasksPerStageRange?: [number, number] | number[];
    subtaskMinutesRange?: [number, number] | number[];
    maxWeeks?: number | null;
  } | null;
}

export interface PathSceneFraming {
  normalizedInput?: PathSceneFramingNormalizedInput;
  intent?: string;
  targetState?: string;
  firstDeliverable?: string;
  cognitiveDomain?: string;
  planningFocus?: string[];
  excludedScope?: string[];
  resourceProfile?: {
    timeBudget?: string;
    timeHorizon?: string;
    pace?: string;
  };
  riskFlags?: string[];
  sourceGoal?: {
    surfaceGoal?: string;
    realProblem?: string;
    motivation?: string;
    urgency?: string;
  };
}

export interface GoalToPathHandoffSnapshot {
  source: 'goal';
  mode: 'generate';
  sourceConversationId: string | null;
  existingPathId: string | null;
  rawGoal: string;
  finalUserVisible: string | null;
  visibleSummary: any;
  conversationHistory: Array<{ role: string; content: string }>;
  /** 前置知识探测结果（goal 层透传，供 prerequisiteTree.knownConcepts 校准） */
  prerequisiteCheckResults?: Array<{ probeId?: string; targetConcept?: string; userAnswer?: string; isCorrect?: boolean }> | null;
}

export interface PathCognitiveConcept {
  id: string;
  name: string;
  role: 'hub' | 'supporting';
  description?: string;
}

export interface PathCognitiveDesign {
  cognitiveDomain?: string | null;
  coreConcepts?: PathCognitiveConcept[];
  /** RPKT 前提知识缺口链（可选，path-planning 产出；供 stage-designer/kc-mapper/path-reviewer 消费） */
  prerequisiteTree?: unknown;
  /** CLT 认知负荷画像（可选，path-planning 产出；供 stage-designer 按 loadTarget 调整子任务设计） */
  loadProfile?: unknown;
}

export type NewPathTaskType = typeof NEW_PATH_TASK_TYPES[number];

export interface PathAdjustmentPolicy {
  allowedModes: Array<'expand' | 'compress' | 'replan'>;
  recommendedMode?: 'expand' | 'compress' | 'replan' | null;
  triggerSource?: 'learn' | 'ai-teaching' | 'teaching-agent' | 'learner-model-agent' | 'skill:learner-model' | 'system' | null;
}

export interface PathAdjustmentEvidence {
  stableConcepts?: string[];
  fragileConcepts?: string[];
  strugglingConcepts?: string[];
  prerequisiteGaps?: string[];
  pacingSignal?: 'fast' | 'slow' | 'balanced' | null;
}

export interface NormalizedPathTask {
  title: string;
  description?: string;
  type?: string;
  estimatedMinutes?: number;
  acceptanceCriteria?: string;
  linkedConcept?: string;
}

export interface NormalizedPathMilestone {
  stage: number;
  name: string;
  description?: string;
  goal?: string;
  estimatedHours?: number;
  coreConcept?: string | null;
  tasks: NormalizedPathTask[];
}

export interface PathNormalizedInputSnapshot {
  source: 'goal' | 'learn' | 'replan' | 'api';
  mode: 'generate' | 'expand' | 'compress' | 'replan';
  description: string;
  subject: string | null;
  deadlineText: string | null;
  sourceConversationId: string | null;
  existingPathId: string | null;
  skillLevel: string | null;
  timePerDay: string | null;
  confirmedProposal: any;
  conversationHistory: Array<{ role: string; content: string }>;
  normalizedInput: PathSceneFramingNormalizedInput | null;
}

export interface PathStageTraceItem {
  id: string;
  phase: PathGenerationPhase | null;
  status: 'started' | 'succeeded' | 'failed' | null;
  success: boolean;
  pathId: string | null;
  sourceConversationId: string | null;
  triggerSource: string | null;
  durationMs: number;
  error: string | null;
  errorCode: string | null;
  input: Record<string, any> | null;
  output: Record<string, any> | null;
  calledAt: string;
}

export interface CompleteTaskData {
  taskId: string;
  userId: string;
  actualMinutes?: number;
  subjectiveDifficulty?: number;
  notes?: string;
  rating?: number;
}
