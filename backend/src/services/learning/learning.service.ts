// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import aiService from '../ai/ai.service';
import stateTrackingService from './state-tracking.service';
import achievementService from '../achievements/achievement.service';
import { updateLearningMetrics } from '../metrics/LearningMetricService';
import learningStateService from './learning-state.service';
import type { AgentInput } from '../../agents/protocol';
import { getEventBus, type LearningEvent } from '../../gateway/event-bus';
import { getRequestContext, runWithContext } from '../../gateway/api-gateway/context';
import { normalizeAgentOutput } from '../../agents/output-normalizer';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { runBackgroundTask } from '../background-task-tracker.service';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { learnerProgressService } from '../learner/LearnerProgressService';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import {
  PATH_GENERATION_LEASE_MS,
  PATH_GENERATION_LEASE_OWNER,
  assertGenerationRunFence,
  assertStageTasksPresent,
  buildGenerationRunStatus,
  calculateStageProgress,
  claimExpiredGenerationRun,
  createAndClaimPathGenerationRun,
  getSafeGenerationErrorMessage,
  isGenerationRunStale,
  resolveGenerationRetry,
  type PathGenerationPhase,
  type PathGenerationRetryType,
  type PersistedPathGenerationRun,
} from './path-generation-status';

// Path 任务画像 Skills
import { executeSkill } from '../../skills';
import { pathSceneFramingDefinition } from '../../skills/path-scene-framing';
import { stageDesignerDefinition } from '../../skills/stage-designer';

interface CreateGoalData {
  userId: string;
  description: string;
  subject?: string;
}

interface GeneratePathData {
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
    };
  };
  systemPromptOverrides?: {
    pathAgent?: string;
  };
}

interface PathReplanRequest {
  pathId: string;
  userId: string;
  triggerSource?: 'goal-conversation' | 'learner-model-agent' | 'skill:learner-model' | 'ai-teaching' | 'teaching-agent' | 'admin' | 'system' | 'api';
  reason?: string;
  mode?: 'new_version' | 'overwrite';
  stageNumber?: number;
  evidence?: Record<string, any>;
  requireConfirmation?: boolean;
}

const STALE_GENERATING_PATH_MINUTES = 15;
const ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES = [1, 5, 15] as const;
const ENRICHMENT_AUTO_RETRY_SCAN_LIMIT = 200;

type PathCoreStep = 'framing' | 'planning' | 'persist' | 'completed';

interface PathGenerationLogPayload {
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

interface PathGenerationStatusPatch {
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

interface ParsedPathGenerationStatus {
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

interface PathSceneFramingNormalizedInput {
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

interface PathSceneFraming {
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

interface GoalToPathHandoffSnapshot {
  source: 'goal';
  mode: 'generate';
  sourceConversationId: string | null;
  existingPathId: string | null;
  rawGoal: string;
  finalUserVisible: string | null;
  visibleSummary: any;
  conversationHistory: Array<{ role: string; content: string }>;
}

interface PathCognitiveConcept {
  id: string;
  name: string;
  role: 'hub' | 'supporting';
  description?: string;
}

interface PathCognitiveDesign {
  cognitiveDomain?: string | null;
  coreConcepts?: PathCognitiveConcept[];
}

const NEW_PATH_TASK_TYPES = ['acquire', 'deconstruct', 'model', 'execute', 'diagnose', 'refine', 'consolidate'] as const;
type NewPathTaskType = typeof NEW_PATH_TASK_TYPES[number];

interface PathAdjustmentPolicy {
  allowedModes: Array<'expand' | 'compress' | 'replan'>;
  recommendedMode?: 'expand' | 'compress' | 'replan' | null;
  triggerSource?: 'learn' | 'ai-teaching' | 'teaching-agent' | 'learner-model-agent' | 'skill:learner-model' | 'system' | null;
}

interface PathAdjustmentEvidence {
  stableConcepts?: string[];
  fragileConcepts?: string[];
  strugglingConcepts?: string[];
  prerequisiteGaps?: string[];
  pacingSignal?: 'fast' | 'slow' | 'balanced' | null;
}

interface NormalizedPathTask {
  title: string;
  description?: string;
  type?: string;
  estimatedMinutes?: number;
  acceptanceCriteria?: string;
  linkedConcept?: string;
}

interface NormalizedPathMilestone {
  stage: number;
  name: string;
  description?: string;
  goal?: string;
  estimatedHours?: number;
  coreConcept?: string | null;
  tasks: NormalizedPathTask[];
}

interface PathNormalizedInputSnapshot {
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

interface PathStageTraceItem {
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

function parsePathSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const summary = parsed?.summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function normalizeConversationHistory(value: any): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((message: any) => ({
      role: typeof message?.role === 'string' ? message.role : 'user',
      content: typeof message?.content === 'string' ? message.content : ''
    }))
    .filter((message: { role: string; content: string }) => message.content);
}

function normalizeConceptText(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildConceptMap(cognitiveDesign: PathCognitiveDesign | null | undefined): Map<string, PathCognitiveConcept> {
  const map = new Map<string, PathCognitiveConcept>();
  const concepts = Array.isArray(cognitiveDesign?.coreConcepts) ? cognitiveDesign!.coreConcepts! : [];
  for (const concept of concepts) {
    if (!concept?.id || !concept?.name) continue;
    map.set(concept.id, concept);
  }
  return map;
}

function resolveTaskConcept(
  linkedConceptId: string | null | undefined,
  cognitiveDesign: PathCognitiveDesign | null | undefined,
  fallbackText?: string | null | undefined
): {
  linkedConceptId: string | null;
  linkedConceptName: string | null;
  linkedConceptDescription: string | null;
  conceptSource: 'linked-concept' | 'fallback-text' | 'missing';
} {
  const conceptId = normalizeConceptText(linkedConceptId);
  const conceptMap = buildConceptMap(cognitiveDesign);
  const concept = conceptId ? conceptMap.get(conceptId) : null;

  if (concept) {
    return {
      linkedConceptId: concept.id,
      linkedConceptName: concept.name,
      linkedConceptDescription: concept.description || null,
      conceptSource: 'linked-concept'
    };
  }

  const fallback = normalizeConceptText(fallbackText);
  if (fallback) {
    return {
      linkedConceptId: conceptId,
      linkedConceptName: fallback,
      linkedConceptDescription: null,
      conceptSource: 'fallback-text'
    };
  }

  return {
    linkedConceptId: conceptId,
    linkedConceptName: null,
    linkedConceptDescription: null,
    conceptSource: 'missing'
  };
}

function resolveMilestoneConcept(
  conceptId: string | null | undefined,
  cognitiveDesign: PathCognitiveDesign | null | undefined,
  fallbackText?: string | null | undefined
): {
  coreConceptId: string | null;
  coreConceptName: string | null;
  coreConceptDescription: string | null;
  conceptSource: 'linked-concept' | 'fallback-text' | 'missing';
} {
  const resolved = resolveTaskConcept(conceptId, cognitiveDesign, fallbackText);
  return {
    coreConceptId: resolved.linkedConceptId,
    coreConceptName: resolved.linkedConceptName,
    coreConceptDescription: resolved.linkedConceptDescription,
    conceptSource: resolved.conceptSource,
  };
}

function inferMilestoneConceptFromTasks(tasks: any[]): string | null {
  const counts = new Map<string, number>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const conceptId = typeof task?.linkedConcept === 'string' && task.linkedConcept.trim()
      ? task.linkedConcept.trim()
      : null;
    if (!conceptId) continue;
    counts.set(conceptId, (counts.get(conceptId) || 0) + 1);
  }

  let winner: string | null = null;
  let maxCount = 0;
  counts.forEach((count, conceptId) => {
    if (count > maxCount) {
      winner = conceptId;
      maxCount = count;
    }
  });
  return winner;
}

function getSceneFramingNormalizedInput(sceneFraming: PathSceneFraming | null | undefined): PathSceneFramingNormalizedInput | null {
  if (!sceneFraming || !sceneFraming.normalizedInput || typeof sceneFraming.normalizedInput !== 'object') {
    return null;
  }
  return sceneFraming.normalizedInput;
}

function isStructuredNormalizedInput(value: any): value is PathSceneFramingNormalizedInput {
  if (!value || typeof value !== 'object') return false;
  return !!(
    value.learnerProfile
    || value.problemSpace
    || value.resources
    || value.successCriteria
    || value.planningHints
  );
}

function resolvePersistedNormalizedInput(parsedTemplate: Record<string, any> | null | undefined): PathSceneFramingNormalizedInput | null {
  const candidate = parsedTemplate?.normalizedInput;
  if (candidate && typeof candidate === 'object') {
    if (candidate.normalizedInput && isStructuredNormalizedInput(candidate.normalizedInput)) {
      return candidate.normalizedInput;
    }
    if (isStructuredNormalizedInput(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveNormalizedInputSnapshot(parsedTemplate: Record<string, any> | null | undefined): PathNormalizedInputSnapshot | null {
  const snapshot = parsedTemplate?.normalizedInputSnapshot;
  if (snapshot && typeof snapshot === 'object') {
    return snapshot as PathNormalizedInputSnapshot;
  }

  const candidate = parsedTemplate?.normalizedInput;
  if (
    candidate
    && typeof candidate === 'object'
    && (
      typeof candidate.description === 'string'
      || typeof candidate.sourceConversationId === 'string'
      || typeof candidate.timePerDay === 'string'
    )
  ) {
    return candidate as PathNormalizedInputSnapshot;
  }

  return null;
}

function getSceneFramingFirstDeliverable(sceneFraming: PathSceneFraming | null | undefined): string | null {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const confirmedProposalDeliverable = typeof normalizedInput?.confirmedProposal?.firstDeliverable === 'string'
    ? normalizedInput.confirmedProposal.firstDeliverable.trim()
    : '';
  if (confirmedProposalDeliverable) return confirmedProposalDeliverable;

  return typeof sceneFraming?.firstDeliverable === 'string' && sceneFraming.firstDeliverable.trim()
    ? sceneFraming.firstDeliverable.trim()
    : null;
}

function getSceneFramingFocusSource(sceneFraming: PathSceneFraming | null | undefined): string[] {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const keyStages = normalizeStringArray(normalizedInput?.confirmedProposal?.keyStages);
  if (keyStages.length > 0) return keyStages;

  return normalizeStringArray(sceneFraming?.planningFocus);
}

function getSceneFramingFallbackDomain(sceneFraming: PathSceneFraming | null | undefined): string | null {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const surfaceGoal = typeof normalizedInput?.learnerProfile?.surfaceGoal === 'string'
    ? normalizedInput.learnerProfile.surfaceGoal.trim()
    : '';
  if (surfaceGoal) return surfaceGoal;

  const realProblem = typeof normalizedInput?.problemSpace?.realProblem === 'string'
    ? normalizedInput.problemSpace.realProblem.trim()
    : '';
  if (realProblem) return realProblem;

  if (typeof sceneFraming?.cognitiveDomain === 'string' && sceneFraming.cognitiveDomain.trim()) {
    return sceneFraming.cognitiveDomain.trim();
  }

  if (typeof sceneFraming?.intent === 'string' && sceneFraming.intent.trim()) {
    return sceneFraming.intent.trim();
  }

  return null;
}

function parsePathCognitiveDesign(raw: string | null): PathCognitiveDesign | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.cognitiveCore || parsed?.cognitiveDesign;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const cognitiveDomain = typeof candidate.cognitiveDomain === 'string' && candidate.cognitiveDomain.trim()
      ? candidate.cognitiveDomain.trim()
      : null;
    const coreConcepts = Array.isArray(candidate.coreConcepts)
      ? candidate.coreConcepts
          .map((concept: any, index: number) => {
            const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
            if (!name) return null;
            const role = concept?.role === 'hub' ? 'hub' : 'supporting';
            const description = typeof concept?.description === 'string' && concept.description.trim()
              ? concept.description.trim()
              : undefined;
            return {
              id: typeof concept?.id === 'string' && concept.id.trim() ? concept.id.trim() : `concept-${index + 1}`,
              name,
              role,
              description,
            } as PathCognitiveConcept;
          })
          .filter(Boolean) as PathCognitiveConcept[]
      : [];

    if (!cognitiveDomain && coreConcepts.length === 0) {
      return null;
    }

    return {
      cognitiveDomain,
      coreConcepts,
    };
  } catch {
    return null;
  }
}

function parsePathMilestoneConceptBindings(raw: string | null): Array<{ stageNumber: number; coreConcept: string | null; title?: string | null }> {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const milestones = Array.isArray(parsed?.taskChain?.milestones)
      ? parsed.taskChain.milestones
      : Array.isArray(parsed?.milestones)
        ? parsed.milestones
        : [];

    return milestones.map((milestone: any, index: number) => ({
      stageNumber: Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1,
      coreConcept: typeof milestone?.coreConcept === 'string' && milestone.coreConcept.trim() ? milestone.coreConcept.trim() : null,
      title: typeof milestone?.title === 'string' && milestone.title.trim() ? milestone.title.trim() : null,
    }));
  } catch {
    return [];
  }
}

function parsePathAdjustmentPolicy(raw: string | null): PathAdjustmentPolicy | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.adjustmentPolicy;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const allowedModes = Array.isArray(candidate.allowedModes)
      ? candidate.allowedModes.filter((mode: any) => mode === 'expand' || mode === 'compress' || mode === 'replan')
      : [];
    const recommendedMode = candidate.recommendedMode === 'expand'
      || candidate.recommendedMode === 'compress'
      || candidate.recommendedMode === 'replan'
      ? candidate.recommendedMode
      : null;
    const triggerSource = candidate.triggerSource === 'learn'
      || candidate.triggerSource === 'ai-teaching'
      || candidate.triggerSource === 'learner-model-agent'
      || candidate.triggerSource === 'skill:learner-model'
      || candidate.triggerSource === 'system'
      ? candidate.triggerSource
      : null;

    if (allowedModes.length === 0 && !recommendedMode && !triggerSource) {
      return null;
    }

    return {
      allowedModes,
      recommendedMode,
      triggerSource,
    };
  } catch {
    return null;
  }
}

function parsePathAdjustmentEvidence(raw: string | null): PathAdjustmentEvidence | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.adjustmentEvidence;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const pacingSignal = candidate.pacingSignal === 'fast'
      || candidate.pacingSignal === 'slow'
      || candidate.pacingSignal === 'balanced'
      ? candidate.pacingSignal
      : null;

    const evidence: PathAdjustmentEvidence = {
      stableConcepts: normalizeStringArray(candidate.stableConcepts),
      fragileConcepts: normalizeStringArray(candidate.fragileConcepts),
      strugglingConcepts: normalizeStringArray(candidate.strugglingConcepts),
      prerequisiteGaps: normalizeStringArray(candidate.prerequisiteGaps),
      pacingSignal,
    };

    if (
      evidence.stableConcepts?.length === 0
      && evidence.fragileConcepts?.length === 0
      && evidence.strugglingConcepts?.length === 0
      && evidence.prerequisiteGaps?.length === 0
      && !evidence.pacingSignal
    ) {
      return null;
    }

    return evidence;
  } catch {
    return null;
  }
}

function buildSceneSummaryFromFraming(
  sceneFraming: PathSceneFraming | null | undefined,
  milestoneCount?: number,
  taskCount?: number,
) {
  if (!sceneFraming) return null;

  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const firstDeliverable = getSceneFramingFirstDeliverable(sceneFraming);
  const focusSource = getSceneFramingFocusSource(sceneFraming);
  const outOfScope = normalizeStringArray(normalizedInput?.confirmedProposal?.outOfScope);
  const legacyExcludedScope = normalizeStringArray(sceneFraming.excludedScope);

  return {
    title: normalizedInput?.problemSpace?.realProblem
      || normalizedInput?.learnerProfile?.surfaceGoal
      || sceneFraming.intent
      || null,
    firstDeliverable,
    targetState: normalizedInput?.successCriteria?.observableResult || sceneFraming.targetState || null,
    planningFocus: focusSource,
    excludedScope: outOfScope.length > 0 ? outOfScope : legacyExcludedScope,
    riskFlags: normalizeStringArray(sceneFraming.riskFlags),
    timeBudget: normalizedInput?.resources?.timeBudget || normalizedInput?.resources?.timePerWeek || sceneFraming.resourceProfile?.timeBudget || null,
    timeHorizon: normalizedInput?.resources?.timeHorizon || sceneFraming.resourceProfile?.timeHorizon || null,
    milestoneCount: typeof milestoneCount === 'number' ? milestoneCount : undefined,
    taskCount: typeof taskCount === 'number' ? taskCount : undefined,
  };
}

function slugifyConceptId(value: string, fallbackIndex: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return normalized ? `concept-${normalized}` : `concept-${fallbackIndex + 1}`;
}

function parsePathGenerationStatus(raw: string | null): ParsedPathGenerationStatus | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const generation = parsed?._generation;

    if (!generation || typeof generation !== 'object') {
      return null;
    }

    const normalizeStageStatus = (value: any) => {
      return value === 'pending' || value === 'processing' || value === 'succeeded' || value === 'failed'
        ? value
        : undefined;
    };

    const normalizeCoreStep = (value: any): PathCoreStep | undefined => {
      return value === 'framing' || value === 'planning' || value === 'persist' || value === 'completed'
        ? value
        : undefined;
    };

    return {
      core: normalizeStageStatus(generation.core),
      coreStep: normalizeCoreStep(generation.coreStep),
      stageDesign: normalizeStageStatus(generation.stageDesign),
      lastError: typeof generation.lastError === 'string' && generation.lastError.trim()
        ? generation.lastError.trim()
        : null,
      sourceConversationId: typeof generation.sourceConversationId === 'string'
        ? generation.sourceConversationId
        : null,
      triggerSource: typeof generation.triggerSource === 'string'
        ? generation.triggerSource
        : null,
      updatedAt: typeof generation.updatedAt === 'string' ? generation.updatedAt : null,
      stageDesignRetryCount: typeof generation.stageDesignRetryCount === 'number'
        ? generation.stageDesignRetryCount
        : 0,
      lastStageDesignRetryAt: typeof generation.lastStageDesignRetryAt === 'string'
        ? generation.lastStageDesignRetryAt
        : null,
      scene: generation.scene && typeof generation.scene === 'object'
        ? generation.scene
        : null
    };
  } catch {
    return null;
  }
}

const DISPLAY_LABEL_MAP: Record<string, Record<string, string>> = {
  factual: {
    remember: '了解基础知识',
    understand: '理解基本概念',
    apply: '应用基础知识',
    analyze: '分析知识结构',
    evaluate: '评估信息准确性',
    create: '构建知识框架'
  },
  conceptual: {
    remember: '记住关键概念',
    understand: '理解核心原理',
    apply: '应用概念解决问题',
    analyze: '深入分析原理',
    evaluate: '评估概念适用性',
    create: '构建概念模型'
  },
  procedural: {
    remember: '记住操作步骤',
    understand: '理解方法原理',
    apply: '动手实践',
    analyze: '分析操作逻辑',
    evaluate: '评估方法效果',
    create: '设计新方法'
  },
  metacognitive: {
    remember: '了解学习策略',
    understand: '理解学习方法',
    apply: '应用学习技巧',
    analyze: '分析学习状态',
    evaluate: '反思学习效果',
    create: '规划学习路径'
  }
};

interface CompleteTaskData {
  taskId: string;
  userId: string;
  actualMinutes?: number;
  subjectiveDifficulty?: number;
  notes?: string;
  rating?: number;
}

function parseJsonSafe(raw: any): any {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripSceneFramingDebugMeta(sceneFraming: any) {
  if (!sceneFraming || typeof sceneFraming !== 'object') return sceneFraming;
  const { _debug, ...rest } = sceneFraming;
  return rest;
}

function isSuspiciousCognitiveDomain(value: string | null | undefined): boolean {
  const text = normalizeConceptText(value);
  if (!text) return false;
  return /(不会|不知道如何|缺少|问题|困难|痛点|恶化|缓解|解决|改善|针对.+功能|围绕.+模块)/.test(text);
}

function isSuspiciousCoreConceptName(value: string | null | undefined): boolean {
  const text = normalizeConceptText(value);
  if (!text) return false;
  return /^(梳理|提炼|整合|记录|分析|学习|设计|绘制|撰写|汇总|复盘|验证)/.test(text);
}

function parseTaskLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()];
    }
  } catch {
    if (raw.trim()) return [raw.trim()];
  }
  return [];
}

function normalizePathTaskType(value: any): NewPathTaskType | 'reading' | 'practice' | 'project' | 'quiz' {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((NEW_PATH_TASK_TYPES as readonly string[]).includes(normalized)) {
    return normalized as NewPathTaskType;
  }
  if (normalized === 'reading' || normalized === 'practice' || normalized === 'project' || normalized === 'quiz') {
    return normalized;
  }
  return 'execute';
}

function buildNormalizedPathInputSnapshot(data: GeneratePathData): PathNormalizedInputSnapshot {
  const conversationHistory = Array.isArray(data.userProfile?.conversationHistory)
    ? data.userProfile.conversationHistory
        .map((message: any) => ({
          role: typeof message?.role === 'string' ? message.role : 'user',
          content: typeof message?.content === 'string' ? message.content : '',
        }))
        .filter((message: { role: string; content: string }) => message.content)
    : [];
  const sceneFramingNormalizedInput = getSceneFramingNormalizedInput(data.userProfile?.pathSceneFraming);
  const orchestratorNormalizedInput = data.userProfile?.normalizedInput && typeof data.userProfile.normalizedInput === 'object'
    ? data.userProfile.normalizedInput as PathSceneFramingNormalizedInput
    : null;

  return {
    source: data.source || (data.sourceConversationId ? 'goal' : 'api'),
    mode: data.mode || 'generate',
    description: data.description,
    subject: data.subject || null,
    deadlineText: data.deadlineText || null,
    sourceConversationId: data.sourceConversationId || null,
    existingPathId: data.existingPathId || null,
    skillLevel: data.userProfile?.skillLevel || data.userProfile?.currentSkillLevel || null,
    timePerDay: data.userProfile?.timePerDay || null,
    confirmedProposal: data.userProfile?.confirmedProposal || null,
    conversationHistory,
    normalizedInput: sceneFramingNormalizedInput || orchestratorNormalizedInput || null,
  };
}

function buildGoalToPathHandoffSnapshot(data: GeneratePathData): GoalToPathHandoffSnapshot | null {
  if (data.source !== 'goal' && !data.sourceConversationId) {
    return null;
  }

  const handoff = data.userProfile?.goalFinalPayload;
  if (handoff && typeof handoff === 'object') {
    return {
      source: 'goal',
      mode: 'generate',
      sourceConversationId: handoff.sourceConversationId || data.sourceConversationId || null,
      existingPathId: handoff.existingPathId || data.existingPathId || null,
      rawGoal: typeof handoff.rawGoal === 'string' ? handoff.rawGoal : data.description,
      finalUserVisible: typeof handoff.finalUserVisible === 'string' ? handoff.finalUserVisible : null,
      visibleSummary: handoff.visibleSummary || null,
      conversationHistory: Array.isArray(handoff.conversationHistory)
        ? handoff.conversationHistory
        : Array.isArray(data.userProfile?.conversationHistory)
          ? data.userProfile.conversationHistory
          : [],
    };
  }

  return {
    source: 'goal',
    mode: 'generate',
    sourceConversationId: data.sourceConversationId || null,
    existingPathId: data.existingPathId || null,
    rawGoal: data.description,
    finalUserVisible: null,
    visibleSummary: null,
    conversationHistory: Array.isArray(data.userProfile?.conversationHistory) ? data.userProfile.conversationHistory : [],
  };
}

function normalizeStageTraceStatus(value: any): 'started' | 'succeeded' | 'failed' | null {
  return value === 'started' || value === 'succeeded' || value === 'failed' ? value : null;
}

function normalizeStageTracePhase(value: any): PathGenerationPhase | null {
  if (value === 'core' || value === 'stageDesign') return value;
  if (value === 'enrichment') return 'stageDesign';
  return null;
}

class LearningService {
  private createGenerationId(prefix: 'pgr' | 'pgsi'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private async createAndClaimGenerationRun(
    pathId: string,
    phase: PathGenerationPhase,
    retryType: PathGenerationRetryType | null = null,
    totalItems = 0
  ): Promise<any> {
    const runId = this.createGenerationId('pgr');
    return createAndClaimPathGenerationRun(prisma, {
      runId,
      pathId,
      phase,
      retryType,
      totalItems
    });
  }

  private async claimQueuedGenerationRun(pathId: string, runId: string): Promise<any | null> {
    const now = new Date();
    const claimed = await prisma.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        phase: 'stageDesign',
        status: 'queued',
        learningPath: { activeGenerationRunId: runId }
      },
      data: {
        status: 'processing',
        leaseOwner: PATH_GENERATION_LEASE_OWNER,
        claimedAt: now,
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
      }
    });
    if (claimed.count !== 1) return null;
    return this.getActiveGenerationRun(pathId, runId);
  }

  private async heartbeatGenerationRun(
    pathId: string,
    runId: string,
    progressPatch: { completedItems?: number; totalItems?: number; progress?: number } = {}
  ): Promise<void> {
    const now = new Date();
    const result = await prisma.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        status: 'processing',
        learningPath: { activeGenerationRunId: runId }
      },
      data: {
        ...progressPatch,
        leaseOwner: PATH_GENERATION_LEASE_OWNER,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
      }
    });
    if (result.count !== 1) throw new Error('GENERATION_RUN_FENCED');
  }

  private startGenerationHeartbeat(pathId: string, runId: string): () => void {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void this.heartbeatGenerationRun(pathId, runId)
        .catch((error) => {
          if (!(error instanceof Error) || error.message !== 'GENERATION_RUN_FENCED') {
            logger.warn('刷新路径生成任务心跳失败', {
              pathId,
              runId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, Math.max(30_000, Math.floor(PATH_GENERATION_LEASE_MS / 3)));
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async failGenerationRun(
    pathId: string,
    runId: string,
    error: unknown,
    errorCode: string,
    retryType: PathGenerationRetryType,
    pathStatus?: 'failed' | 'active'
  ): Promise<boolean> {
    const now = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    return prisma.$transaction(async (tx) => {
      const failed = await tx.path_generation_runs.updateMany({
        where: {
          id: runId,
          learningPathId: pathId,
          status: { in: ['queued', 'processing'] }
        },
        data: {
          status: 'failed',
          retryType,
          retryAllowed: true,
          heartbeatAt: now,
          leaseExpiresAt: now,
          finishedAt: now,
          errorCode,
          errorMessage
        }
      });
      if (failed.count !== 1) return false;

      const updatedPath = await tx.learning_paths.updateMany({
        where: { id: pathId, activeGenerationRunId: runId },
        data: {
          ...(pathStatus ? { status: pathStatus } : {}),
          updatedAt: now
        }
      });
      return updatedPath.count === 1;
    });
  }

  private async getActiveGenerationRun(pathId: string, activeGenerationRunId?: string | null): Promise<any | null> {
    if (!activeGenerationRunId) return null;
    return prisma.path_generation_runs.findFirst({
      where: { id: activeGenerationRunId, learningPathId: pathId }
    });
  }

  private emitLearningEvent(event: LearningEvent, label: string) {
    try {
      void getEventBus().emit(event).catch((error) => {
        logger.warn(`[learning-service] ${label} 事件发送失败`, {
          eventType: event.type,
          userId: event.userId,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    } catch (error) {
      logger.warn(`[learning-service] ${label} 事件总线不可用`, {
        eventType: event.type,
        userId: event.userId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private buildPathProcessDetail(path: any) {
    const parsedTemplate = this.parsePathPromptTemplate(path.aiPromptTemplate || null);
    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate || null);
    const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
      ? parsedTemplate.sceneFraming
      : null;
    const sceneFramingRaw = typeof parsedTemplate?.sceneFramingRaw === 'string'
      ? parsedTemplate.sceneFramingRaw
      : null;
    const sceneFramingInput = parsedTemplate?.sceneFramingInput && typeof parsedTemplate.sceneFramingInput === 'object'
      ? parsedTemplate.sceneFramingInput
      : null;
    const pathAgentInput = parsedTemplate?.pathAgentInput && typeof parsedTemplate.pathAgentInput === 'object'
      ? parsedTemplate.pathAgentInput
      : null;
    const pathAgentRaw = typeof parsedTemplate?.pathAgentRaw === 'string'
      ? parsedTemplate.pathAgentRaw
      : null;
    const stageDesigns = parsedTemplate?.stageDesigns && typeof parsedTemplate.stageDesigns === 'object'
      ? parsedTemplate.stageDesigns
      : null;
    const normalizedInput = resolveNormalizedInputSnapshot(parsedTemplate);
    const goalFinalPayload = parsedTemplate?.goalFinalPayload && typeof parsedTemplate.goalFinalPayload === 'object'
      ? parsedTemplate.goalFinalPayload
      : null;
    const sceneFramingNormalizedInput = getSceneFramingNormalizedInput(sceneFraming) || resolvePersistedNormalizedInput(parsedTemplate);
    const cognitiveDesign = parsePathCognitiveDesign(path.aiPromptTemplate || null);
    const milestoneConceptBindings = parsePathMilestoneConceptBindings(path.aiPromptTemplate || null);
    const milestoneConceptBindingMap = new Map<number, { coreConcept: string | null; title?: string | null }>();
    milestoneConceptBindings.forEach((item) => {
      milestoneConceptBindingMap.set(item.stageNumber, {
        coreConcept: item.coreConcept,
        title: item.title,
      });
    });
    const milestoneConcepts = (path.milestones || []).map((milestone: any, index: number) => {
      const stageNumber = Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1;
      const binding = milestoneConceptBindingMap.get(stageNumber);
      const resolvedMilestoneConcept = resolveMilestoneConcept(
        milestone?.coreConceptId || binding?.coreConcept || null,
        cognitiveDesign,
        milestone?.coreConceptName || binding?.coreConcept || null,
      );
      return {
        milestoneId: milestone.id,
        stageNumber,
        title: milestone.title || milestone.goal || binding?.title || null,
        ...resolvedMilestoneConcept,
      };
    });
    const taskProfiles = (path.milestones || []).flatMap((milestone: any) =>
      (milestone.subtasks || []).map((task: any) => ({
        ...resolveTaskConcept(task.linkedConceptId || task.coreConcept, cognitiveDesign, task.linkedConceptName || task.coreConcept),
        taskId: task.id,
        milestoneId: milestone.id,
        milestoneTitle: milestone.title || milestone.goal || null,
        title: task.title,
        status: task.status,
        knowledgeType: task.knowledgeType || null,
        cognitiveLevel: task.cognitiveLevel || null,
        displayLabel: task.displayLabel || null,
        learningObjectives: parseTaskLearningObjectives(task.learningObjectives),
        coreConcept: normalizeConceptText(task.linkedConceptName || task.coreConcept),
        transferable: task.transferable ?? false,
        annotationConfidence: task.annotationConfidence ?? null,
      }))
    );
    const cognitiveDiagnostics = {
      suspiciousDomain: isSuspiciousCognitiveDomain(cognitiveDesign?.cognitiveDomain),
      suspiciousConcepts: Array.isArray(cognitiveDesign?.coreConcepts)
        ? cognitiveDesign.coreConcepts
            .filter((concept: any) => isSuspiciousCoreConceptName(concept?.name))
            .map((concept: any) => ({ id: concept.id, name: concept.name }))
        : [],
    };

    return {
      source: typeof normalizedInput?.source === 'string'
        ? normalizedInput.source
        : (typeof parsedTemplate?.source === 'string' ? parsedTemplate.source : null),
      mode: typeof normalizedInput?.mode === 'string'
        ? normalizedInput.mode
        : (typeof parsedTemplate?.mode === 'string' ? parsedTemplate.mode : null),
      sourceConversationId: goalFinalPayload?.sourceConversationId || normalizedInput?.sourceConversationId || generationStatus?.sourceConversationId || null,
      goalFinalPayload: {
        provenance: {
          source: goalFinalPayload ? 'persisted-goal-final-payload' : 'missing',
          isBackfilled: false,
          summary: goalFinalPayload
            ? '这份数据是 Goal 阶段最终产出并正式保存的 Path 入口 payload。'
            : '当前路径没有保存 Goal Final Payload。'
        },
        display: {
          description: goalFinalPayload?.rawGoal || null,
          subject: normalizedInput?.subject || null,
          deadlineText: normalizedInput?.deadlineText || null,
          sourceGoal: null,
          skillLevel: normalizedInput?.skillLevel || null,
          timePerDay: normalizedInput?.timePerDay || null,
        },
        rawGoal: goalFinalPayload?.rawGoal || null,
        finalUserVisible: goalFinalPayload?.finalUserVisible || null,
        visibleSummary: goalFinalPayload?.visibleSummary || null,
        conversationHistory: Array.isArray(goalFinalPayload?.conversationHistory)
          ? goalFinalPayload.conversationHistory
          : [],
      },
      normalizedInput: {
        provenance: {
          source: normalizedInput
            ? 'persisted-normalized-input'
            : 'missing',
          isBackfilled: false,
          summary: normalizedInput
            ? '这份数据是 orchestrator 归一化后正式保存的 Path 内部输入。'
            : '当前路径没有保存可用的 normalized input。'
        },
        description: normalizedInput?.description || null,
        subject: normalizedInput?.subject || null,
        deadlineText: normalizedInput?.deadlineText || null,
        sourceConversationId: normalizedInput?.sourceConversationId || null,
        existingPathId: normalizedInput?.existingPathId || null,
        skillLevel: normalizedInput?.skillLevel || null,
        timePerDay: normalizedInput?.timePerDay || null,
        confirmedProposal: normalizedInput?.confirmedProposal || null,
        conversationHistory: Array.isArray(normalizedInput?.conversationHistory)
          ? normalizedInput.conversationHistory
          : [],
        normalizedInput: normalizedInput?.normalizedInput || sceneFramingNormalizedInput || null,
      },
      framing: sceneFraming ? {
        normalizedInput: sceneFramingNormalizedInput || null,
        legacyFrame: {
          version: sceneFraming.version || null,
          intent: sceneFraming.intent || null,
          targetState: sceneFraming.targetState || null,
          firstDeliverable: sceneFraming.firstDeliverable || null,
          cognitiveDomain: sceneFraming.cognitiveDomain || null,
          planningFocus: normalizeStringArray(sceneFraming.planningFocus),
          excludedScope: normalizeStringArray(sceneFraming.excludedScope),
          riskFlags: normalizeStringArray(sceneFraming.riskFlags),
          resourceProfile: {
            timeBudget: sceneFraming.resourceProfile?.timeBudget || null,
            timeHorizon: sceneFraming.resourceProfile?.timeHorizon || null,
            pace: sceneFraming.resourceProfile?.pace || null,
          },
          sourceGoal: sceneFraming.sourceGoal && typeof sceneFraming.sourceGoal === 'object'
            ? sceneFraming.sourceGoal
            : null,
        }
      } : null,
      cognitiveDesign,
      cognitiveDiagnostics,
      adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate || null),
      adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate || null),
      generationTimeline: generationStatus ? {
        core: generationStatus.core || null,
        coreStep: generationStatus.coreStep || null,
        stageDesign: generationStatus.stageDesign || null,
        lastError: generationStatus.lastError || null,
        triggerSource: generationStatus.triggerSource || null,
        updatedAt: generationStatus.updatedAt || null,
        stageDesignRetryCount: generationStatus.stageDesignRetryCount || 0,
        lastStageDesignRetryAt: generationStatus.lastStageDesignRetryAt || null,
      } : null,
      milestoneConcepts,
      taskProfiles,
      stageDesigns,
        raw: {
          goalFinalPayload,
          normalizedInput,
          normalizedInputStructured: sceneFramingNormalizedInput || null,
          sceneFramingInput,
          sceneFramingRaw,
          pathAgentInput,
          pathAgentRaw,
          sceneFraming,
          stageDesigns,
          promptTemplate: parsedTemplate,
          generationStatus,
        },
    };
  }

  private async getPathStageTraces(pathId: string, sourceConversationId?: string | null): Promise<PathStageTraceItem[]> {
    const logs = await prisma.agent_call_logs.findMany({
      where: {
        agentId: 'path-agent',
        sourceEntry: 'platform',
        OR: [
          { metadata: { contains: pathId } },
          ...(sourceConversationId ? [{ metadata: { contains: sourceConversationId } }] : []),
        ],
      },
      orderBy: { calledAt: 'asc' },
      take: 20,
    });

    return logs
      .map((log) => {
        const metadata = parseJsonSafe(log.metadata);
        const input = parseJsonSafe(log.input);
        const output = parseJsonSafe(log.output);
        const phase = normalizeStageTracePhase(metadata?.phase || input?.phase);
        const status = normalizeStageTraceStatus(metadata?.status || input?.status);
        const tracePathId = metadata?.pathId || input?.pathId || null;
        const traceSourceConversationId = metadata?.sourceConversationId || input?.sourceConversationId || null;

        if (tracePathId !== pathId && (!sourceConversationId || traceSourceConversationId !== sourceConversationId)) {
          return null;
        }

        return {
          id: log.id,
          phase,
          status,
          success: !!log.success,
          pathId: tracePathId,
          sourceConversationId: traceSourceConversationId,
          triggerSource: metadata?.triggerSource || input?.triggerSource || null,
          durationMs: log.durationMs || 0,
          error: log.error || null,
          errorCode: log.errorCode || null,
          input,
          output,
          calledAt: log.calledAt.toISOString(),
        } as PathStageTraceItem;
      })
      .filter(Boolean) as PathStageTraceItem[];
  }

  private normalizeCognitiveDesign(
    candidate: PathCognitiveDesign | null | undefined,
    fallbackDomain: string,
    fallbackConceptNames: string[] = []
  ): PathCognitiveDesign {
    const rawConcepts = Array.isArray(candidate?.coreConcepts) ? candidate!.coreConcepts! : [];
    const seenIds = new Set<string>();
    const normalizedConcepts: PathCognitiveConcept[] = [];

    for (let index = 0; index < rawConcepts.length; index += 1) {
      const concept = rawConcepts[index];
      const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
      if (!name) continue;

      let id = typeof concept?.id === 'string' && concept.id.trim()
        ? concept.id.trim()
        : slugifyConceptId(name, index);
      if (seenIds.has(id)) {
        id = `${id}-${index + 1}`;
      }
      seenIds.add(id);

      normalizedConcepts.push({
        id,
        name,
        role: concept?.role === 'hub' ? 'hub' : 'supporting',
        description: typeof concept?.description === 'string' && concept.description.trim()
          ? concept.description.trim()
          : undefined,
      });
    }

    if (normalizedConcepts.length === 0) {
      fallbackConceptNames.slice(0, 4).forEach((name, index) => {
        normalizedConcepts.push({
          id: `concept-${index + 1}`,
          name,
          role: index === 0 ? 'hub' : 'supporting',
          description: index === 0
            ? `优先围绕「${name}」建立第一层可迁移能力。`
            : `作为后续阶段补充，用来支撑「${name}」相关任务推进。`
        });
      });
    }

    const hubIndex = normalizedConcepts.findIndex((concept) => concept.role === 'hub');
    normalizedConcepts.forEach((concept, index) => {
      concept.role = hubIndex === -1
        ? (index === 0 ? 'hub' : 'supporting')
        : (index === hubIndex ? 'hub' : 'supporting');
    });

    return {
      cognitiveDomain: typeof candidate?.cognitiveDomain === 'string' && candidate.cognitiveDomain.trim()
        ? candidate.cognitiveDomain.trim()
        : fallbackDomain,
      coreConcepts: normalizedConcepts,
    };
  }

  private normalizeMilestoneTasks(
    tasks: any[],
    conceptIds: string[]
  ): NormalizedPathTask[] {
    const fallbackConceptId = conceptIds[0];

    return (Array.isArray(tasks) ? tasks : []).map((task: any) => {
      const requestedConceptId = typeof task?.linkedConcept === 'string' ? task.linkedConcept.trim() : '';
      const linkedConcept = requestedConceptId && conceptIds.includes(requestedConceptId)
        ? requestedConceptId
        : fallbackConceptId;

      return {
        title: task?.title || '',
        description: task?.description || '',
        type: normalizePathTaskType(task?.type),
        estimatedMinutes: task?.estimatedMinutes || 30,
        acceptanceCriteria: task?.acceptanceCriteria || '',
        linkedConcept,
      };
    });
  }

  private normalizeMilestonesWithConcepts(milestonesData: any[], cognitiveDesign: PathCognitiveDesign): NormalizedPathMilestone[] {
    const conceptIds = Array.isArray(cognitiveDesign.coreConcepts)
      ? cognitiveDesign.coreConcepts.map((concept) => concept.id)
      : [];
    const fallbackConceptId = conceptIds[0] || null;

    return (Array.isArray(milestonesData) ? milestonesData : []).map((milestone: any, index: number) => {
      const requestedCoreConcept = typeof milestone?.coreConcept === 'string' ? milestone.coreConcept.trim() : '';
      const inferredCoreConcept = inferMilestoneConceptFromTasks(milestone?.tasks || []);
      const coreConcept = requestedCoreConcept && conceptIds.includes(requestedCoreConcept)
        ? requestedCoreConcept
        : inferredCoreConcept && conceptIds.includes(inferredCoreConcept)
          ? inferredCoreConcept
          : fallbackConceptId;
      const tasks = this.normalizeMilestoneTasks(milestone?.tasks || [], conceptIds).map((task) => ({
        ...task,
        linkedConcept: task.linkedConcept || coreConcept || undefined,
      }));

      return {
        ...milestone,
        stage: milestone?.stage || index + 1,
        name: milestone?.name || milestone?.title || `里程碑${index + 1}`,
        description: milestone?.description || '',
        goal: milestone?.goal || '',
        estimatedHours: milestone?.estimatedHours || 0,
        coreConcept,
        tasks,
      };
    });
  }

  private getPathLearningAccessState(
    pathStatus: string | null | undefined,
    aiPromptTemplate: string | null,
    activeRun?: PersistedPathGenerationRun | null,
    aiGenerated = false,
    taskCount = 0
  ) {
    const legacyGenerationStatus = parsePathGenerationStatus(aiPromptTemplate);
    const persistedRunStatus = buildGenerationRunStatus(activeRun);
    const generationStatus = legacyGenerationStatus || persistedRunStatus
      ? {
          ...(legacyGenerationStatus || {}),
          ...(persistedRunStatus || {})
        }
      : null;
    const enrichmentStatus = generationStatus?.stageDesign;

    if (pathStatus !== 'active') {
      if (pathStatus === 'generating') {
        return {
          generationStatus,
          canStartLearning: false,
          learningBlockedReason: '学习路径仍在生成中，请稍候再开始学习。'
        };
      }

      if (pathStatus === 'failed') {
        return {
          generationStatus,
          canStartLearning: false,
          learningBlockedReason: '学习路径生成失败，请先重新生成路径。'
        };
      }
    }

    if (!generationStatus || !enrichmentStatus) {
      const missingGeneratedState = pathStatus === 'active' && aiGenerated && taskCount === 0;
      return {
        generationStatus,
        canStartLearning: pathStatus === 'active' && !missingGeneratedState,
        learningBlockedReason: pathStatus === 'active' && !missingGeneratedState
          ? null
          : missingGeneratedState
            ? '学习路径生成状态缺失，暂不能开始学习，请重试生成。'
          : '学习路径当前不可开始，请稍后再试。'
      };
    }

    if (enrichmentStatus === 'succeeded') {
      return {
        generationStatus,
        canStartLearning: true,
        learningBlockedReason: null
      };
    }

    if (enrichmentStatus === 'failed') {
      return {
        generationStatus,
        canStartLearning: false,
        learningBlockedReason: '阶段任务生成遇到问题，系统会继续尝试，请稍后再开始学习。'
      };
    }

    return {
      generationStatus,
      canStartLearning: false,
      learningBlockedReason: '阶段任务还在生成中，请稍候再开始学习。'
    };
  }

  private getNextEnrichmentRetryDelayMinutes(retryCount: number): number {
    return ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES[
      Math.min(retryCount, ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length - 1)
    ];
  }

  private getEnrichmentRetryReferenceTime(
    path: { updatedAt: Date },
    generationStatus: ParsedPathGenerationStatus | null
  ): number {
    const rawTime = generationStatus?.updatedAt
      || generationStatus?.lastStageDesignRetryAt
      || path.updatedAt?.toISOString?.()
      || path.updatedAt;

    const timestamp = new Date(rawTime).getTime();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  }

  private async queuePathEnrichmentRetry(
    path: {
      id: string;
      userId: string;
      title?: string | null;
      name?: string | null;
      description?: string | null;
      subject?: string | null;
      deadline?: Date | null;
      deadlineText?: string | null;
      aiPromptTemplate?: string | null;
    },
    generationStatus: ParsedPathGenerationStatus | null
  ): Promise<{ retryCount: number; runId: string }> {
    const retryCount = (generationStatus?.stageDesignRetryCount || 0) + 1;
    const retryAt = new Date().toISOString();
    const run = await this.createAndClaimGenerationRun(path.id, 'stageDesign', 'stageDesign');

    await this.updatePathGenerationStatus(path.id, {
      stageDesign: 'processing',
      lastError: null,
      stageDesignRetryCount: retryCount,
      lastStageDesignRetryAt: retryAt,
      updatedAt: retryAt
    }, run.id);

    const analysis = {
      ...this.parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    runBackgroundTask('learning.path.stage-enrichment-retry', () => this.enrichLearningPathWithAnderson(path.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      generationRunId: run.id,
      userProfile: {}
    }, analysis), { pathId: path.id, runId: run.id, userId: path.userId });

    return { retryCount, runId: run.id };
  }

  private generateDisplayLabel(knowledgeType?: string | null, cognitiveLevel?: string | null): string | null {
    if (!knowledgeType || !cognitiveLevel) return null;
    const typeMap = DISPLAY_LABEL_MAP[knowledgeType];
    if (typeMap && typeMap[cognitiveLevel]) {
      return typeMap[cognitiveLevel];
    }
    return null;
  }

  private parsePathPromptTemplate(raw: string | null): Record<string, any> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private buildPathCognitiveDesign(data: GeneratePathData, analysis: any): PathCognitiveDesign {
    const sceneFraming = data.userProfile?.pathSceneFraming as PathSceneFraming | undefined;
    const generatedCognitiveDesign = analysis?.cognitiveDesign && typeof analysis.cognitiveDesign === 'object'
      ? analysis.cognitiveDesign
      : null;
    const confirmedStages = Array.isArray(data.userProfile?.confirmedProposal?.key_stages)
      ? data.userProfile.confirmedProposal.key_stages.filter((item: any) => typeof item === 'string' && item.trim())
      : [];
    const milestoneNames = Array.isArray(analysis?.suggestedMilestones)
      ? analysis.suggestedMilestones
          .map((milestone: any) => milestone?.name || milestone?.title || milestone?.goal)
          .filter((item: any) => typeof item === 'string' && item.trim())
      : [];
    const normalizedSceneInput = getSceneFramingNormalizedInput(sceneFraming);
    const normalizedSceneStages = normalizeStringArray(normalizedSceneInput?.confirmedProposal?.keyStages);
    const focusSource = normalizedSceneStages.length > 0
      ? normalizedSceneStages
      : confirmedStages.length > 0
        ? confirmedStages
        : milestoneNames;

    const generatedCoreConcepts = Array.isArray(generatedCognitiveDesign?.coreConcepts)
      ? generatedCognitiveDesign.coreConcepts
          .map((concept: any, index: number) => {
            const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
            if (!name) return null;
            return {
              id: typeof concept?.id === 'string' && concept.id.trim() ? concept.id.trim() : `concept-${index + 1}`,
              name,
              role: concept?.role === 'hub' ? 'hub' as const : 'supporting' as const,
              description: typeof concept?.description === 'string' && concept.description.trim()
                ? concept.description.trim()
                : undefined,
            };
          })
          .filter(Boolean) as PathCognitiveConcept[]
      : [];

    return this.normalizeCognitiveDesign(
      {
        cognitiveDomain: typeof generatedCognitiveDesign?.cognitiveDomain === 'string' && generatedCognitiveDesign.cognitiveDomain.trim()
          ? generatedCognitiveDesign.cognitiveDomain.trim()
          : getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
        coreConcepts: generatedCoreConcepts,
      },
      getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
      focusSource,
    );
  }

  private buildPathAdjustmentPolicy(): PathAdjustmentPolicy {
    return {
      allowedModes: ['expand', 'compress', 'replan'],
      recommendedMode: null,
      triggerSource: null,
    };
  }

  private buildPathAdjustmentEvidence(data: GeneratePathData): PathAdjustmentEvidence | null {
    const learnerProjection = data.userProfile?.replan?.learnerReplanProjection;
    if (!learnerProjection || typeof learnerProjection !== 'object') {
      return null;
    }

    const stableConcepts = normalizeStringArray(learnerProjection?.mastery?.stableConcepts);
    const fragileConcepts = normalizeStringArray(learnerProjection?.mastery?.fragileConcepts);
    const strugglingConcepts = normalizeStringArray(learnerProjection?.mastery?.strugglingConcepts);
    const prerequisiteGaps = Array.isArray(learnerProjection?.risk?.prerequisiteGaps)
      ? learnerProjection.risk.prerequisiteGaps
          .map((item: any) => typeof item?.label === 'string' ? item.label.trim() : '')
          .filter(Boolean)
      : [];

    const evidence: PathAdjustmentEvidence = {
      stableConcepts,
      fragileConcepts,
      strugglingConcepts,
      prerequisiteGaps,
      pacingSignal: null,
    };

    if (
      stableConcepts.length === 0
      && fragileConcepts.length === 0
      && strugglingConcepts.length === 0
      && prerequisiteGaps.length === 0
    ) {
      return null;
    }

    return evidence;
  }

  private getPathSceneSummary(raw: string | null, fallbackMilestones?: any[]): Record<string, any> | null {
    const generationScene = parsePathGenerationStatus(raw)?.scene;
    if (generationScene && typeof generationScene === 'object') {
      return generationScene;
    }

    const parsed = this.parsePathPromptTemplate(raw);
    const sceneFraming = parsed?.sceneFraming && typeof parsed.sceneFraming === 'object'
      ? parsed.sceneFraming as PathSceneFraming
      : null;
    const milestoneCount = Array.isArray(fallbackMilestones) ? fallbackMilestones.length : undefined;
    const taskCount = Array.isArray(fallbackMilestones)
      ? fallbackMilestones.reduce((sum: number, milestone: any) => sum + ((milestone?.subtasks || []).length), 0)
      : undefined;

    return buildSceneSummaryFromFraming(sceneFraming, milestoneCount, taskCount);
  }

  private async updatePathGenerationStatus(
    pathId: string,
    patch: PathGenerationStatusPatch,
    runId?: string,
    expectedRunStatus: 'processing' | 'failed' = 'processing'
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        if (runId) await assertGenerationRunFence(tx, pathId, runId, expectedRunStatus);
        const existing = await tx.learning_paths.findUnique({
          where: { id: pathId },
          select: { aiPromptTemplate: true }
        });
        if (!existing) return;

        const currentTemplate = this.parsePathPromptTemplate(existing.aiPromptTemplate);
        const currentGeneration = currentTemplate._generation && typeof currentTemplate._generation === 'object'
          ? currentTemplate._generation
          : {};

        await tx.learning_paths.update({
          where: { id: pathId },
          data: {
            aiPromptTemplate: JSON.stringify({
              ...currentTemplate,
              _generation: {
                ...currentGeneration,
                ...patch,
                updatedAt: patch.updatedAt || new Date().toISOString()
              }
            }),
            updatedAt: new Date()
          }
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'GENERATION_RUN_FENCED') throw error;
      logger.warn('更新路径生成状态失败', {
        pathId,
        patch,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async recordPathGenerationStageLog(payload: PathGenerationLogPayload): Promise<void> {
    try {
      await prisma.agent_call_logs.create({
        data: {
          id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          agentId: 'path-agent',
          userId: payload.userId,
          sourceEntry: 'platform',
          input: JSON.stringify({
            phase: payload.phase,
            status: payload.status,
            pathId: payload.pathId || null,
            sourceConversationId: payload.sourceConversationId || null,
            triggerSource: payload.triggerSource || null,
            ...(payload.input || {})
          }),
          output: payload.output ? JSON.stringify(payload.output) : null,
          success: payload.status !== 'failed',
          durationMs: payload.durationMs || 0,
          error: payload.error || null,
          errorCode: payload.errorCode || null,
          calledAt: new Date(),
          metadata: JSON.stringify({
            eventType: 'path-generation-stage',
            executionLayer: 'flow-event',
            phase: payload.phase,
            status: payload.status,
            pathId: payload.pathId || null,
            sourceConversationId: payload.sourceConversationId || null,
            triggerSource: payload.triggerSource || null
          })
        }
      });
    } catch (error) {
      logger.warn('记录路径阶段日志失败', {
        phase: payload.phase,
        status: payload.status,
        pathId: payload.pathId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async recoverStaleGeneratingPaths(): Promise<number> {
    const now = new Date();
    const staleRuns = await prisma.path_generation_runs.findMany({
      where: {
        status: { in: ['queued', 'processing'] },
        OR: [
          { leaseExpiresAt: { lte: now } },
          { status: 'processing', leaseExpiresAt: null }
        ]
      },
      select: {
        id: true,
        learningPathId: true,
        phase: true,
        attempt: true,
        inputSnapshot: true,
        learningPath: { select: { activeGenerationRunId: true } }
      }
    });
    let recoveredRuns = 0;
    for (const run of staleRuns) {
      if (run.learningPath.activeGenerationRunId !== run.id) {
        await prisma.path_generation_runs.updateMany({
          where: { id: run.id, status: { in: ['queued', 'processing'] } },
          data: {
            status: 'cancelled',
            retryAllowed: false,
            leaseExpiresAt: now,
            finishedAt: now,
            errorCode: 'SUPERSEDED',
            errorMessage: '已由新的生成任务接管'
          }
        });
        continue;
      }
      const failed = await claimExpiredGenerationRun(prisma, {
        runId: run.id,
        pathId: run.learningPathId,
        expiredAt: now
      });
      if (failed) {
        await this.updatePathGenerationStatus(run.learningPathId, run.phase === 'stageDesign'
          ? { stageDesign: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }
          : { core: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }, run.id, 'failed');
        if (run.phase === 'core') {
          await prisma.learning_paths.updateMany({
            where: { id: run.learningPathId, activeGenerationRunId: run.id },
            data: { status: 'failed', updatedAt: new Date() }
          });
        }
        recoveredRuns += 1;
        if (run.phase === 'core' && run.inputSnapshot && run.attempt < 3) {
          try {
            const snapshot = JSON.parse(run.inputSnapshot) as GeneratePathData;
            const replacement = await this.createAndClaimGenerationRun(run.learningPathId, 'core', 'core');
            const recoveredInput: GeneratePathData = {
              ...snapshot,
              existingPathId: run.learningPathId,
              generationRunId: replacement.id,
              deadline: snapshot.deadline ? new Date(snapshot.deadline) : undefined
            };
            runBackgroundTask(
              'learning.path.core-recovery',
              () => this.generateLearningPath(recoveredInput),
              { pathId: run.learningPathId, runId: replacement.id }
            );
          } catch (error) {
            logger.warn('核心路径生成输入快照不可恢复', {
              pathId: run.learningPathId,
              runId: run.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    const staleBefore = new Date(Date.now() - STALE_GENERATING_PATH_MINUTES * 60 * 1000);

    const stalePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      select: { id: true }
    });

    const result = await prisma.learning_paths.updateMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      data: {
        status: 'failed',
        updatedAt: new Date()
      }
    });

    if (result.count > 0) {
      logger.warn('发现并回收陈旧 generating 路径', {
        staleMinutes: STALE_GENERATING_PATH_MINUTES,
        recoveredCount: result.count
      });

      await Promise.all(stalePaths.map((path) => this.updatePathGenerationStatus(path.id, {
        core: 'failed',
        lastError: 'GENERATION_TIMEOUT_ORPHANED'
      })));
    }

    return recoveredRuns + result.count;
  }

  async retryEligibleFailedPathPreparations(): Promise<number> {
    const candidatePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'active',
        aiGenerated: true
      },
      select: {
        id: true,
        status: true,
        userId: true,
        title: true,
        name: true,
        description: true,
        subject: true,
        deadline: true,
        deadlineText: true,
        aiPromptTemplate: true,
        activeGenerationRunId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: ENRICHMENT_AUTO_RETRY_SCAN_LIMIT
    });

    let retriedCount = 0;

    for (const path of candidatePaths) {
      const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
      const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
      const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
      if (!retry.allowed || retry.retryType !== 'stageDesign') {
        continue;
      }

      const retryCount = generationStatus.stageDesignRetryCount || 0;
      if (retryCount >= ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length) {
        continue;
      }

      const retryReferenceTime = this.getEnrichmentRetryReferenceTime(path, generationStatus);
      const requiredDelayMs = this.getNextEnrichmentRetryDelayMinutes(retryCount) * 60 * 1000;
      if (Date.now() - retryReferenceTime < requiredDelayMs) {
        continue;
      }

      try {
        await this.queuePathEnrichmentRetry(path, generationStatus);
        retriedCount += 1;
      } catch (error) {
        logger.warn('自动继续生成阶段任务失败', {
          pathId: path.id,
          retryCount,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (retriedCount > 0) {
      logger.info('已触发阶段任务自动继续生成', { retriedCount });
    }

    return retriedCount;
  }

  private normalizeSessionDurationMinutes(session: {
    duration: number | null;
    startTime: Date;
    endTime: Date | null;
  }): number {
    const derivedMinutes = session.endTime
      ? Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000))
      : null;

    if (derivedMinutes !== null) {
      return derivedMinutes;
    }

    const rawDuration = session.duration ?? 0;
    if (rawDuration <= 0) {
      return 0;
    }

    // 历史兼容：部分会话把秒写入 duration，这里兜底转分钟
    return rawDuration > 24 * 60 ? Math.round(rawDuration / 60) : rawDuration;
  }

  private async attachActualMinutesToPath(path: any): Promise<any> {
    const milestones = path?.milestones || [];
    const cognitiveDesign = parsePathCognitiveDesign(path?.aiPromptTemplate || null);
    const milestoneConceptBindings = parsePathMilestoneConceptBindings(path?.aiPromptTemplate || null);
    const milestoneConceptBindingMap = new Map<number, { coreConcept: string | null; title?: string | null }>();
    milestoneConceptBindings.forEach((item) => {
      milestoneConceptBindingMap.set(item.stageNumber, {
        coreConcept: item.coreConcept,
        title: item.title,
      });
    });
    const allSubtasks = milestones.flatMap((milestone: any) => milestone.subtasks || []);
    const taskIds = allSubtasks.map((task: any) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      return path;
    }

    const sessions = await prisma.teaching_sessions.findMany({
      where: {
        userId: path.userId,
        taskId: { in: taskIds },
      },
      select: {
        taskId: true,
        duration: true,
        startTime: true,
        endTime: true,
        wrapup: true,
      },
    });

    const actualMinutesMap = new Map<string, number>();
    const latestSessionAtMap = new Map<string, string>();
    const latestWrapupStatusMap = new Map<string, string | null>();
    sessions.forEach((session) => {
      if (!session.taskId) return;

      const minutes = this.normalizeSessionDurationMinutes(session);
      if (minutes <= 0) return;

      actualMinutesMap.set(session.taskId, (actualMinutesMap.get(session.taskId) || 0) + minutes);

      const sessionAt = (session.endTime || session.startTime)?.toISOString?.() || null;
      const previousAt = latestSessionAtMap.get(session.taskId);
      if (sessionAt && (!previousAt || new Date(sessionAt).getTime() > new Date(previousAt).getTime())) {
        latestSessionAtMap.set(session.taskId, sessionAt);
        try {
          const wrapup = session.wrapup ? JSON.parse(session.wrapup) : null;
          latestWrapupStatusMap.set(session.taskId, wrapup?.status || null);
        } catch {
          latestWrapupStatusMap.set(session.taskId, null);
        }
      }
    });

    return {
      ...path,
      milestones: milestones.map((milestone: any, index: number) => {
        const stageNumber = Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1;
        const milestoneConcept = resolveMilestoneConcept(
          milestone?.coreConceptId || milestoneConceptBindingMap.get(stageNumber)?.coreConcept || null,
          cognitiveDesign,
          milestone?.coreConceptName || milestoneConceptBindingMap.get(stageNumber)?.coreConcept || null,
        );

        return {
          ...milestone,
          coreConceptId: milestoneConcept.coreConceptId,
          coreConceptName: milestoneConcept.coreConceptName,
          coreConceptDescription: milestoneConcept.coreConceptDescription,
          coreConceptSource: milestoneConcept.conceptSource,
          subtasks: (milestone.subtasks || []).map((task: any) => ({
            ...task,
            actualMinutes: actualMinutesMap.get(task.id) ?? null,
            hasTeachingWrapup: latestSessionAtMap.has(task.id),
            latestTeachingSessionAt: latestSessionAtMap.get(task.id) ?? null,
            latestWrapupStatus: latestWrapupStatusMap.get(task.id) ?? null,
          })),
        };
      }),
    };
  }

  async markTaskInProgress(taskId: string, userId: string) {
    const subtask = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                userId: true,
              }
            }
          }
        }
      }
    });

    if (!subtask) {
      throw new Error('任务不存在');
    }

    const pathOwner = subtask.milestones?.learning_paths?.userId;
    if (pathOwner && pathOwner !== userId) {
      throw new Error('无权访问此任务');
    }

    if (subtask.status === 'todo') {
      await prisma.subtasks.update({
        where: { id: taskId },
        data: {
          status: 'in_progress',
          updatedAt: new Date(),
        }
      });
    }
  }

  // 创建学习目标
  async createLearningGoal(data: CreateGoalData) {
    try {
      const goal = await prisma.learning_goals.create({
        data: {
          id: `lg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          title: data.description,
          description: data.description,
          updatedAt: new Date()
        }
      });

      logger.info(`学习目标创建：${goal.id}`);

      return goal;
    } catch (error) {
      logger.error('创建学习目标失败:', error);
      throw error;
    }
  }

  // 创建简单的学习路径
  async createLearningPath(data: {
    userId: string;
    name: string;
    title?: string;
    description?: string;
  }) {
    try {
      const learningPath = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          name: data.name,
          title: data.title || data.name,
          description: data.description || '',
          updatedAt: new Date()
        }
      });

      logger.info(`学习路径创建：${learningPath.id}`);

      return learningPath;
    } catch (error) {
      logger.error('创建学习路径失败:', error);
      throw error;
    }
  }

  // 获取用户的学习目标
  async getLearningGoals(userId: string) {
    try {
      const goals = await prisma.learning_goals.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      return goals;
    } catch (error) {
      logger.error('获取学习目标失败:', error);
      throw error;
    }
  }

  private buildPathAgentInput(data: GeneratePathData): AgentInput {
    const skillLevel = data.userProfile?.skillLevel || data.userProfile?.currentSkillLevel;
    const currentLevel = (skillLevel === 'beginner' || skillLevel === 'intermediate' || skillLevel === 'advanced')
      ? skillLevel as 'beginner' | 'intermediate' | 'advanced'
      : undefined;

    return {
      type: 'standard',
      goal: data.description,
      currentLevel: currentLevel || 'beginner',
      timePerDay: data.userProfile?.timePerDay,
      structuredData: data.userProfile?.structuredData,
      confirmedProposal: data.userProfile?.confirmedProposal,
      confidenceScores: data.userProfile?.confidenceScores,
      conversationHistory: data.userProfile?.conversationHistory,
      metadata: {
        availableTime: data.userProfile?.timePerDay,
        deadline: data.deadline,
        deadlineText: data.deadlineText,
        totalWeeks: data.userProfile?.totalWeeks,
        userId: data.userId,
        replan: data.userProfile?.replan,
        pathSceneFraming: data.userProfile?.pathSceneFraming,
        goalFinalPayload: data.userProfile?.goalFinalPayload || null,
        normalizedInput: data.userProfile?.normalizedInput || null,
        conversationHistory: Array.isArray(data.userProfile?.conversationHistory) ? data.userProfile.conversationHistory : [],
      }
    };
  }

  private async analyzePathWithAgent(data: GeneratePathData): Promise<any> {
    try {
      const { pathAgentHandler } = await import('../../skills/path-planning');
      const agentInput = this.buildPathAgentInput(data);
      const agentContext: any = {
        userId: data.userId,
        metadata: data.systemPromptOverrides?.pathAgent
          ? { pathAgentSystemPromptOverride: data.systemPromptOverrides.pathAgent }
          : undefined
      };

      if (!data.userProfile?.pathSceneFraming) {
        const pathSceneFramingInput = {
          goal: agentInput.goal,
          currentLevel: agentInput.currentLevel,
          timePerDay: agentInput.timePerDay,
          structuredData: agentInput.structuredData,
          confirmedProposal: agentInput.confirmedProposal,
          metadata: agentInput.metadata || {},
        };
        const sceneFramingResult = await executeSkill(pathSceneFramingDefinition, {
          ...pathSceneFramingInput,
        });
        const sceneFraming = stripSceneFramingDebugMeta(sceneFramingResult);
        const sceneFramingRaw = typeof sceneFramingResult?._debug?.rawModelOutput === 'string'
          ? sceneFramingResult._debug.rawModelOutput
          : null;
        data.userProfile = {
          ...(data.userProfile || {}),
          pathSceneFraming: sceneFraming,
          pathSceneFramingRaw: sceneFramingRaw,
          pathSceneFramingInput,
          normalizedInput: getSceneFramingNormalizedInput(sceneFraming) || data.userProfile?.normalizedInput || null,
        };
        agentInput.metadata = {
          ...(agentInput.metadata || {}),
          pathSceneFraming: sceneFraming
        };
      }

      const parentContext = getRequestContext();
      const agentResult = await runWithContext({
        ...parentContext,
        userId: data.userId,
        agentId: 'skill:path-planning',
        action: 'generateLearningPath'
      }, () => pathAgentHandler(agentInput, agentContext));

      const normalizedPathResult = normalizeAgentOutput('skill:path-planning', agentResult);
      const pathPayload =
        normalizedPathResult.internal?.ext?.path?.path
        || normalizedPathResult.internal?.path
        || agentResult.path;

      if (!normalizedPathResult.success || !pathPayload) {
        const agentErrorMessage = typeof normalizedPathResult.error === 'string'
          ? normalizedPathResult.error
          : normalizedPathResult.error?.message;
        throw new Error(agentErrorMessage || 'PATH_AGENT_FAILED');
      }

      const path = pathPayload;
      const taskChainMilestones = Array.isArray(path.milestones)
        ? path.milestones
        : [];
      const pathAgentRaw = typeof (path as any)?._debug?.rawModelOutput === 'string'
        ? (path as any)._debug.rawModelOutput
        : null;
      const pathAgentInput = {
        goal: agentInput.goal,
        currentLevel: agentInput.currentLevel,
        timePerDay: agentInput.timePerDay,
        metadata: agentInput.metadata || {},
        confirmedProposal: agentInput.confirmedProposal || null,
        conversationHistory: Array.isArray(agentInput.conversationHistory) ? agentInput.conversationHistory : [],
      };
      logger.info('PathAgent 调用成功', { userId: data.userId, pathId: path.id });

      return {
        pathName: path.name,
        subject: path.subject || '综合',
        difficulty: data.userProfile?.skillLevel || 'beginner',
        estimatedTotalHours: path.estimatedHours || 0,
        sceneFraming: data.userProfile?.pathSceneFraming || null,
        sceneFramingRaw: data.userProfile?.pathSceneFramingRaw || null,
        sceneFramingInput: data.userProfile?.pathSceneFramingInput || null,
        pathAgentInput,
        pathAgentRaw,
        suggestedMilestones: taskChainMilestones.map((m: any, idx: number) => ({
          stage: m.stageNumber || idx + 1,
          name: m.title,
          coreConcept: typeof m.coreConcept === 'string' ? m.coreConcept : undefined,
          description: m.description,
          goal: m.goal,
          estimatedHours: m.estimatedHours,
          tasks: []
        })),
        cognitiveDesign: path.cognitiveCore || path.cognitiveDesign,
        recommendations: [],
        feasibility: 'high'
      };
    } catch (agentError: any) {
      logger.error('PathAgent 调用失败，终止生成', {
        error: agentError?.message || String(agentError),
        userId: data.userId
      });
      throw new Error(`PATH_GENERATION_FAILED: ${agentError?.message || 'unknown error'}`);
    }
  }

  private async persistGeneratedPath(data: GeneratePathData, analysis: any, milestonesData: any[], runId?: string) {
    const cognitiveDesign = this.buildPathCognitiveDesign(data, analysis);
    const normalizedMilestonesData = this.normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
    const adjustmentPolicy = this.buildPathAdjustmentPolicy();
    const adjustmentEvidence = this.buildPathAdjustmentEvidence(data);
    const generationUpdatedAt = new Date().toISOString();
    const promptTemplatePayload = {
        ...analysis,
        source: data.source || (data.sourceConversationId ? 'goal' : 'api'),
        mode: data.mode || 'generate',
        goalFinalPayload: buildGoalToPathHandoffSnapshot(data),
        normalizedInput: buildNormalizedPathInputSnapshot(data),
        normalizedInputSnapshot: buildNormalizedPathInputSnapshot(data),
        sceneFramingInput: analysis.sceneFramingInput || data.userProfile?.pathSceneFramingInput || null,
        sceneFramingRaw: analysis.sceneFramingRaw || data.userProfile?.pathSceneFramingRaw || null,
        pathAgentInput: analysis.pathAgentInput || null,
        pathAgentRaw: analysis.pathAgentRaw || null,
        suggestedMilestones: normalizedMilestonesData,
        cognitiveDesign,
        adjustmentPolicy,
        adjustmentEvidence,
        _generation: {
          core: 'succeeded',
          coreStep: 'completed',
          stageDesign: 'pending',
          lastError: null,
          sourceConversationId: data.sourceConversationId || null,
          triggerSource: data.sourceConversationId ? 'goal-conversation' : data.source === 'learn' ? 'ai-teaching' : data.source === 'replan' ? 'system' : 'api',
          updatedAt: generationUpdatedAt,
        }
    };

    const learningPath = await prisma.$transaction(async (tx) => {
      let path;
      if (data.existingPathId) {
        if (!runId) throw new Error('GENERATION_RUN_REQUIRED');
        await assertGenerationRunFence(tx, data.existingPathId, runId);
        path = await tx.learning_paths.update({
          where: { id: data.existingPathId },
          data: {
            title: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
            name: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
            description: (data.description && !data.description.includes('\uFFFD'))
              ? data.description
              : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: analysis.subject || '综合',
            status: 'active',
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: normalizedMilestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(promptTemplatePayload),
            updatedAt: new Date()
          }
        });

        await (tx.milestones as any).deleteMany({
          where: { learningPathId: path.id }
        });
      } else {
        path = await tx.learning_paths.create({
          data: {
            id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            title: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
            name: analysis.pathName || `${analysis.subject || '个性化'}学习路径`,
            description: (data.description && !data.description.includes('\uFFFD'))
              ? data.description
              : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: analysis.subject || '综合',
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: normalizedMilestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(promptTemplatePayload),
            status: 'active',
            updatedAt: new Date()
          }
        });
      }

      await tx.path_decompositions.create({
        data: {
          id: `pd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          goal: data.description,
          stages: JSON.stringify(normalizedMilestonesData.map((m: any) => m.name) || []),
          milestones: JSON.stringify(normalizedMilestonesData),
          subtasks: JSON.stringify([]),
          aiAnalysis: JSON.stringify(analysis),
          feasibility: analysis.feasibility,
          difficulty: analysis.difficulty,
          recommendations: JSON.stringify(analysis.recommendations || [])
        }
      });

      for (let i = 0; i < normalizedMilestonesData.length; i++) {
        const milestoneData = normalizedMilestonesData[i];
        const stageNum = milestoneData.stage || i + 1;

        const milestone = await (tx.milestones as any).create({
          data: {
            id: `ms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${i}`,
            learningPathId: path.id,
            stageNumber: stageNum,
            title: milestoneData.name || `里程碑${stageNum}`,
            description: milestoneData.description || '',
            goal: milestoneData.goal || '',
            coreConceptId: typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
            coreConceptName: resolveMilestoneConcept(
              typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
              cognitiveDesign,
              typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
            ).coreConceptName,
            estimatedHours: milestoneData.estimatedHours || 0,
            status: stageNum === 1 ? 'active' : 'locked',
            order: i,
            updatedAt: new Date()
          }
        });

      }

      await tx.learning_paths.update({
        where: { id: path.id },
        data: { totalMilestones: normalizedMilestonesData.length }
      });

      if (runId) {
        await assertGenerationRunFence(tx, path.id, runId);
        await tx.path_generation_runs.update({
          where: { id: runId },
          data: {
            status: 'succeeded',
            retryAllowed: false,
            completedItems: normalizedMilestonesData.length,
            totalItems: normalizedMilestonesData.length,
            progress: 100,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(),
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null
          }
        });

        const stageRunId = this.createGenerationId('pgr');
        await tx.path_generation_runs.create({
          data: {
            id: stageRunId,
            learningPathId: path.id,
            phase: 'stageDesign',
            status: 'queued',
            retryAllowed: false,
            attempt: await tx.path_generation_runs.count({
              where: { learningPathId: path.id, phase: 'stageDesign' }
            }) + 1,
            totalItems: normalizedMilestonesData.length,
            completedItems: 0,
            progress: 0,
            leaseExpiresAt: new Date(Date.now() + PATH_GENERATION_LEASE_MS)
          }
        });
        await tx.learning_paths.update({
          where: { id: path.id },
          data: { activeGenerationRunId: stageRunId, updatedAt: new Date() }
        });
        (path as any).activeGenerationRunId = stageRunId;
      }

      await enqueueDomainEvent(tx, createDomainEvent({
        type: 'path:created',
        aggregateType: 'path',
        aggregateId: path.id,
        userId: data.userId,
        source: 'learning-service',
        data: {
          pathId: path.id,
          title: path.title,
          subject: path.subject,
          milestoneCount: normalizedMilestonesData.length,
          sourceConversationId: data.sourceConversationId || null
        }
      }));

      return path;
    });

    return this.getLearningPath(learningPath.id);
  }

  private async enrichLearningPathWithAnderson(pathId: string, data: GeneratePathData, analysis: any): Promise<void> {
    const startTime = Date.now();
    const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { activeGenerationRunId: true }
    });
    const suppliedRun = path?.activeGenerationRunId
      ? await this.getActiveGenerationRun(pathId, path.activeGenerationRunId)
      : null;
    const run = suppliedRun?.phase === 'stageDesign'
      ? suppliedRun.status === 'queued'
        ? await this.claimQueuedGenerationRun(pathId, suppliedRun.id)
        : suppliedRun
      : await this.createAndClaimGenerationRun(pathId, 'stageDesign');
    if (!run || run.status !== 'processing') throw new Error('GENERATION_RUN_FENCED');
    const runId = run.id;
    const stopHeartbeat = this.startGenerationHeartbeat(pathId, runId);
    let currentStageItemId: string | null = null;

    await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'started',
        input: { goal: data.description }
      });

    await this.updatePathGenerationStatus(pathId, {
      stageDesign: 'processing',
      lastError: null,
      sourceConversationId: data.sourceConversationId || null,
      triggerSource,
      updatedAt: new Date().toISOString()
    }, runId);

    try {
      logger.info('开始阶段任务设计...', { userId: data.userId, pathId });

      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      if (!learningPath) {
        throw new Error('PATH_ENRICHMENT_TARGET_NOT_FOUND');
      }
      if (learningPath.milestones.length === 0) {
        throw new Error('PATH_STAGE_DESIGN_HAS_NO_STAGES');
      }
      await this.heartbeatGenerationRun(pathId, runId, {
        totalItems: learningPath.milestones.length,
        completedItems: 0,
        progress: 0
      });

      const pathCognitiveDesign = parsePathCognitiveDesign(learningPath.aiPromptTemplate || null);
      const parsedTemplate = this.parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
      const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
        ? parsedTemplate.sceneFraming
        : null;
      const normalizedInput = getSceneFramingNormalizedInput(sceneFraming)
        || resolvePersistedNormalizedInput(parsedTemplate)
        || null;
      const stageDesignerBaseInput = {
        cognitiveCore: pathCognitiveDesign,
        normalizedInput,
      };
      const stageDesignRawOutputs: Record<string, any> = {};
      const stageDesignOutputs: Array<{
        milestoneId: string;
        stageNumber: number;
        subtasks: any[];
      }> = [];
      let designedTaskCount = 0;

      for (let stageIndex = 0; stageIndex < learningPath.milestones.length; stageIndex += 1) {
        const milestone = learningPath.milestones[stageIndex];
        const stageStartedAt = new Date();
        currentStageItemId = this.createGenerationId('pgsi');
        await prisma.path_generation_stage_items.create({
          data: {
            id: currentStageItemId,
            runId,
            milestoneId: milestone.id,
            stageNumber: milestone.stageNumber,
            status: 'processing',
            heartbeatAt: stageStartedAt,
            startedAt: stageStartedAt
          }
        });
        await this.heartbeatGenerationRun(
          pathId,
          runId,
          calculateStageProgress(stageIndex, learningPath.milestones.length)
        );
        const stageDesignerInput = {
          milestone: {
            stageNumber: milestone.stageNumber,
            title: milestone.title,
            coreConcept: milestone.coreConceptId || null,
            description: milestone.description || null,
            goal: milestone.goal || null,
            estimatedHours: milestone.estimatedHours || null,
          },
          ...stageDesignerBaseInput,
          repairHints: null,
        };
        const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

        const stageTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
        assertStageTasksPresent(milestone.stageNumber, stageTasks);
        stageDesignRawOutputs[`stage-${milestone.stageNumber}`] = {
          inputPayload: stageDesignerInput,
          rawModelOutput: stageResult?._debug?.rawModelOutput || null,
          extractedJson: stageResult?._debug?.extractedJson || null,
          normalizedOutput: {
            subtasks: stageTasks,
          }
        };
        stageDesignOutputs.push({
          milestoneId: milestone.id,
          stageNumber: milestone.stageNumber,
          subtasks: stageTasks,
        });
        const stageFinishedAt = new Date();
        await prisma.path_generation_stage_items.update({
          where: { id: currentStageItemId },
          data: {
            status: 'succeeded',
            taskCount: stageTasks.length,
            heartbeatAt: stageFinishedAt,
            finishedAt: stageFinishedAt,
            errorCode: null,
            errorMessage: null
          }
        });
        currentStageItemId = null;
        await this.heartbeatGenerationRun(
          pathId,
          runId,
          calculateStageProgress(stageIndex + 1, learningPath.milestones.length)
        );
      }

      await prisma.$transaction(async (tx) => {
        await assertGenerationRunFence(tx, pathId, runId);
        for (const milestone of learningPath.milestones) {
          await tx.subtasks.deleteMany({ where: { milestoneId: milestone.id } });
          const stageOutput = stageDesignOutputs.find((item) => item.milestoneId === milestone.id);
          const stageTasks = stageOutput?.subtasks || [];

          for (let j = 0; j < stageTasks.length; j++) {
            const taskData = stageTasks[j];
            const resolvedConcept = resolveTaskConcept(
              typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
              pathCognitiveDesign,
              typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
            );
            const displayLabel = this.generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
              || (taskData.knowledgeType && taskData.cognitiveLevel ? `${taskData.knowledgeType} + ${taskData.cognitiveLevel}` : null);

            await tx.subtasks.create({
              data: {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${j}`,
                milestoneId: milestone.id,
                userId: data.userId,
                title: taskData.title || `任务${j + 1}`,
                description: taskData.description || '',
                taskType: normalizePathTaskType(taskData.type),
                estimatedMinutes: taskData.estimatedMinutes || 30,
                acceptanceCriteria: taskData.acceptanceHint || '',
                coreConcept: resolvedConcept.linkedConceptName || null,
                linkedConceptId: resolvedConcept.linkedConceptId || null,
                linkedConceptName: resolvedConcept.linkedConceptName || null,
                knowledgeType: taskData.knowledgeType || null,
                cognitiveLevel: taskData.cognitiveLevel || null,
                displayLabel,
                learningObjectives: null,
                transferable: taskData.transferable ?? false,
                annotationConfidence: null,
                order: j,
                status: 'todo',
                updatedAt: new Date()
              }
            });
            designedTaskCount += 1;
          }
        }

        await tx.learning_paths.update({
          where: { id: learningPath.id },
          data: {
            aiPromptTemplate: JSON.stringify({
              ...parsedTemplate,
              stageDesigns: stageDesignRawOutputs,
              _generation: {
                ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
                stageDesign: 'succeeded',
                lastError: null,
                sourceConversationId: data.sourceConversationId || null,
                triggerSource,
                updatedAt: new Date().toISOString()
              }
            }),
            updatedAt: new Date(),
          }
        });
        await tx.path_generation_runs.update({
          where: { id: runId },
          data: {
            status: 'succeeded',
            retryAllowed: false,
            completedItems: learningPath.milestones.length,
            totalItems: learningPath.milestones.length,
            progress: 100,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(),
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null
          }
        });
        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'path:generated',
          aggregateType: 'path',
          aggregateId: pathId,
          userId: data.userId,
          source: 'learning-service',
          data: {
            pathId,
            taskCount: designedTaskCount,
            milestoneCount: learningPath.milestones.length,
            sourceConversationId: data.sourceConversationId || null,
            triggerSource
          }
        }));
      });

      logger.info('阶段任务设计完成', {
        pathId,
        userId: data.userId,
        taskCount: designedTaskCount,
        milestoneCount: learningPath.milestones.length,
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        output: {
          taskCount: designedTaskCount,
          designedStages: learningPath.milestones.length
        }
      });
      dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-created');
    } catch (andersonError: any) {
      logger.warn('阶段任务设计失败，路径保持骨架可用', {
        pathId,
        userId: data.userId,
        error: andersonError?.message || String(andersonError)
      });

      if (currentStageItemId) {
        const failedAt = new Date();
        await prisma.path_generation_stage_items.updateMany({
          where: { id: currentStageItemId, runId, status: 'processing' },
          data: {
            status: 'failed',
            heartbeatAt: failedAt,
            finishedAt: failedAt,
            errorCode: 'PATH_STAGE_DESIGN_ITEM_FAILED',
            errorMessage: andersonError?.message || String(andersonError)
          }
        });
      }
      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: andersonError?.message || String(andersonError),
        errorCode: 'PATH_ENRICHMENT_FAILED'
      });
      try {
        await this.updatePathGenerationStatus(pathId, {
          stageDesign: 'failed',
          lastError: andersonError?.message || String(andersonError),
          sourceConversationId: data.sourceConversationId || null,
          triggerSource,
          updatedAt: new Date().toISOString()
        }, runId);
        await this.failGenerationRun(
          pathId,
          runId,
          andersonError,
          andersonError?.message?.includes('EMPTY_TASKS') ? 'PATH_STAGE_DESIGN_ZERO_TASKS' : 'PATH_ENRICHMENT_FAILED',
          'stageDesign'
        );
      } catch (fenceError) {
        if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
        logger.info('忽略已失效阶段生成任务的迟到失败', { pathId, runId });
      }
    } finally {
      stopHeartbeat();
    }
  }

  private async generateLearningPathCore(data: GeneratePathData) {
    const startTime = Date.now();
    const triggerSource = data.sourceConversationId
      ? 'goal-conversation'
      : data.source === 'learn'
        ? 'ai-teaching'
        : data.source === 'replan'
          ? 'system'
          : 'api';

    const coreRun = data.existingPathId
      ? data.generationRunId
        ? await this.getActiveGenerationRun(data.existingPathId, data.generationRunId)
        : await this.createAndClaimGenerationRun(data.existingPathId, 'core')
      : null;
    if (data.existingPathId && (!coreRun || coreRun.status !== 'processing')) {
      throw new Error('GENERATION_RUN_FENCED');
    }
    const coreRunId = coreRun?.id as string | undefined;

    if (data.existingPathId && coreRunId) {
      await prisma.path_generation_runs.updateMany({
        where: {
          id: coreRunId,
          learningPathId: data.existingPathId,
          status: 'processing'
        },
        data: {
          inputSnapshot: JSON.stringify({
            ...data,
            deadline: data.deadline?.toISOString?.() || data.deadline || null,
            generationRunId: undefined
          })
        }
      });
    }
    const stopHeartbeat = data.existingPathId && coreRunId
      ? this.startGenerationHeartbeat(data.existingPathId, coreRunId)
      : null;

    await this.recordPathGenerationStageLog({
      userId: data.userId,
      pathId: data.existingPathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'core',
      status: 'started',
        input: {
          goal: data.description,
          existingPathId: data.existingPathId || null,
          source: data.source || null,
          mode: data.mode || 'generate',
        }
      });

    if (data.existingPathId) {
      await this.updatePathGenerationStatus(data.existingPathId, {
        core: 'processing',
        stageDesign: 'pending',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, coreRunId);
    }

    try {
      logger.info('开始生成学习路径...', { userId: data.userId, goal: data.description });
      const analysis = await this.analyzePathWithAgent(data);
      if (data.existingPathId && coreRunId) {
        await this.heartbeatGenerationRun(data.existingPathId, coreRunId, { progress: 50 });
      }

      if (!analysis) {
        throw new Error('PATH_GENERATION_FAILED: empty analysis');
      }

      if (!analysis.suggestedMilestones || analysis.suggestedMilestones.length === 0) {
        throw new Error('PATH_GENERATION_FAILED: suggestedMilestones is empty');
      }

      const milestonesData = analysis.suggestedMilestones || [];
      const cognitiveDesign = this.buildPathCognitiveDesign(data, analysis);
      const normalizedMilestonesData = this.normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
      const fullPath = await this.persistGeneratedPath(data, {
        ...analysis,
        cognitiveDesign,
      }, normalizedMilestonesData, coreRunId);
      const duration = Date.now() - startTime;
      const sceneSummary = buildSceneSummaryFromFraming(
        data.userProfile?.pathSceneFraming || null,
        normalizedMilestonesData.length,
        normalizedMilestonesData.reduce((sum: number, milestone: any) => sum + ((milestone?.tasks || []).length), 0)
      );

        logger.info(`学习路径核心生成完成：${fullPath.id}`, {
          userId: data.userId,
          milestoneCount: normalizedMilestonesData.length,
          durationMs: duration
        });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId: fullPath.id,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'core',
        status: 'succeeded',
        durationMs: duration,
        output: {
          pathId: fullPath.id,
          milestoneCount: normalizedMilestonesData.length,
          estimatedHours: fullPath.estimatedHours || analysis.estimatedTotalHours || 0
        }
      });

      if (sceneSummary) {
        const persistedTemplate = this.parsePathPromptTemplate(fullPath.aiPromptTemplate || null);
        await prisma.learning_paths.updateMany({
          where: {
            id: fullPath.id,
            ...(fullPath.activeGenerationRunId ? { activeGenerationRunId: fullPath.activeGenerationRunId } : {})
          },
          data: {
            aiPromptTemplate: JSON.stringify({
              ...persistedTemplate,
              _generation: {
                ...(persistedTemplate._generation || {}),
                scene: sceneSummary
              }
            })
          }
        });
      }

      return { fullPath, analysis };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('生成学习路径失败', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId: data.userId,
        goal: data.description,
        durationMs: duration
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId: data.existingPathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'core',
        status: 'failed',
        durationMs: duration,
        error: error?.message || String(error),
        errorCode: 'PATH_GENERATION_CORE_FAILED'
      });

      if (data.existingPathId) {
        try {
          await this.updatePathGenerationStatus(data.existingPathId, {
            core: 'failed',
            lastError: error?.message || String(error),
            sourceConversationId: data.sourceConversationId || null,
            triggerSource,
            updatedAt: new Date().toISOString()
          }, coreRunId);
          if (coreRunId) {
            await this.failGenerationRun(
              data.existingPathId,
              coreRunId,
              error,
              'PATH_GENERATION_CORE_FAILED',
              'core',
              'failed'
            );
          }
        } catch (fenceError) {
          if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
          logger.info('忽略已失效核心生成任务的迟到失败', { pathId: data.existingPathId, runId: coreRunId });
        }
      }

      throw new Error(`生成学习路径失败：${error?.message || '未知错误'}。请稍后重试或联系支持。`);
    } finally {
      stopHeartbeat?.();
    }
  }

  // 使用 AI 生成学习路径 (阶段化设计)
  async generateLearningPath(data: GeneratePathData) {
    let generationData = data;
    if (!data.existingPathId) {
      const placeholder = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          title: data.description || '个性化学习路径',
          name: data.description || '个性化学习路径',
          description: data.description,
          subject: data.subject || '综合',
          status: 'generating',
          difficulty: data.userProfile?.skillLevel || 'beginner',
          estimatedHours: 0,
          aiGenerated: true,
          deadline: data.deadline || null,
          deadlineText: data.deadlineText || null,
          updatedAt: new Date()
        }
      });
      const run = await this.createAndClaimGenerationRun(placeholder.id, 'core');
      generationData = {
        ...data,
        existingPathId: placeholder.id,
        generationRunId: run.id
      };
    }

    const { fullPath, analysis } = await this.generateLearningPathCore(generationData);

    runBackgroundTask(
      'learning.path.stage-enrichment',
      () => this.enrichLearningPathWithAnderson(fullPath.id, generationData, analysis),
      { pathId: fullPath.id, userId: generationData.userId }
    );
    dashboardGuidanceSnapshotService.refreshInBackground(generationData.userId, 'path-created');

    return fullPath;
  }

  /**
   * 为现有学习路径补充实战任务
   */
  async generateTasksForExistingPath(data: {
    learningPathId: string;
    userId: string;
    description: string;
    userProfile?: any;
  }) {
    try {
const learningPath = await prisma.learning_paths.findUnique({
        where: { id: data.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      if (!learningPath) {
        throw new Error('学习路径不存在');
      }

      for (const milestone of learningPath.milestones) {
        const stageNum = milestone.stageNumber;
        logger.info(`正在为里程碑 ${stageNum} 生成实战任务...`);
        
        const contextualTopic = `总体目标：${data.description} - 当前阶段：${milestone.title || `里程碑${stageNum}`}`;
        
        try {
          const taskResult = await aiService.generateTasksForTopic(
            contextualTopic,
            stageNum,
            data.userProfile
          );

          if (taskResult.success && taskResult.internal?.tasks && taskResult.internal.tasks.length > 0) {
            for (const task of taskResult.internal.tasks) {
              await prisma.subtasks.create({
                data: {
                  id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  milestoneId: milestone.id,
                  userId: data.userId,
                  title: task.title,
                  description: task.description,
                  taskType: normalizePathTaskType(task.type),
                  estimatedMinutes: task.estimatedMinutes || 30,
                  acceptanceCriteria: task.acceptanceCriteria || '',
                  status: 'todo',
                  updatedAt: new Date()
                }
              });
            }
            logger.info(`里程碑 ${stageNum} 实战任务生成完成：${taskResult.internal.tasks.length}个任务`);
          } else {
            logger.warn(`里程碑 ${stageNum} AI 生成任务失败，使用默认任务`);
            await prisma.subtasks.create({
              data: {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                milestoneId: milestone.id,
                userId: data.userId,
                title: milestone.title || `里程碑${stageNum}学习任务`,
                description: milestone.description || milestone.goal || '完成本里程碑学习内容',
                taskType: 'execute',
                estimatedMinutes: 30,
                status: 'todo',
                updatedAt: new Date()
              }
            });
          }
        } catch (taskError) {
          logger.error(`里程碑 ${stageNum} 任务生成失败:`, taskError);
          await prisma.subtasks.create({
            data: {
              id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              milestoneId: milestone.id,
              userId: data.userId,
              title: milestone.title || `里程碑${stageNum}学习任务`,
              description: milestone.description || milestone.goal || '完成本里程碑学习内容',
              taskType: 'execute',
              estimatedMinutes: 30,
              status: 'todo',
              updatedAt: new Date()
            }
          });
        }
      }

      logger.info(`学习路径生成完成：${learningPath.id}`);
      return learningPath;
    } catch (error) {
      logger.error('生成学习路径失败:', error);
      throw error;
    }
  }

// 获取学习路径详情
  async getLearningPath(pathId: string) {
    try {
      const path = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      if (!path) {
        throw new Error('学习路径不存在');
      }

      const pathWithActualMinutes = await this.attachActualMinutesToPath(path);
      const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
      const taskCount = pathWithActualMinutes.milestones.reduce(
        (sum: number, milestone: any) => sum + ((milestone.subtasks || []).length),
        0
      );
      const accessState = this.getPathLearningAccessState(
        path.status,
        path.aiPromptTemplate,
        activeRun,
        path.aiGenerated,
        taskCount
      );
      const processDetail = this.buildPathProcessDetail(pathWithActualMinutes);
      const stageTraces = await this.getPathStageTraces(path.id, processDetail.sourceConversationId || null);

      return {
        ...pathWithActualMinutes,
        summary: parsePathSummary(path.aiPromptTemplate),
        generationStatus: accessState.generationStatus,
        generationRun: buildGenerationRunStatus(activeRun),
        sceneSummary: this.getPathSceneSummary(path.aiPromptTemplate, pathWithActualMinutes.milestones),
        cognitiveDesign: parsePathCognitiveDesign(path.aiPromptTemplate),
        adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate),
        adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate),
        processDetail: {
          ...processDetail,
          stageTraces,
        },
        canStartLearning: accessState.canStartLearning,
        learningBlockedReason: accessState.learningBlockedReason,
        replanLineage: {
          sourcePathId: path.sourcePathId || null,
          replanMode: path.replanMode || null,
          triggerSource: path.replanTriggerSource || null,
          reason: path.replanReason || null,
        },
        milestones: pathWithActualMinutes.milestones,
        stages: pathWithActualMinutes.milestones,
        totalStages: path.totalMilestones
      };
    } catch (error) {
      logger.error('获取学习路径详情失败:', error);
      throw error;
    }
  }

  async getPathGenerationLifecycle(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: {
        id: true,
        userId: true,
        status: true,
        aiGenerated: true,
        aiPromptTemplate: true,
        activeGenerationRunId: true,
        totalMilestones: true,
        updatedAt: true,
        activeGenerationRun: true,
        milestones: {
          select: {
            stageNumber: true,
            subtasks: { select: { id: true } }
          },
          orderBy: { stageNumber: 'asc' }
        }
      }
    });

    if (!path) throw new Error('学习路径不存在');
    if (path.userId !== userId) throw new Error('无权访问此学习路径');

    const run = path.activeGenerationRun;
    const legacy = parsePathGenerationStatus(path.aiPromptTemplate);
    const totalStages = Math.max(path.totalMilestones || 0, path.milestones.length, run?.totalItems || 0);
    const taskCount = path.milestones.reduce((sum, milestone) => sum + milestone.subtasks.length, 0);
    const accessState = this.getPathLearningAccessState(
      path.status,
      path.aiPromptTemplate,
      run,
      path.aiGenerated,
      taskCount
    );
    const stale = isGenerationRunStale(run);
    const retry = resolveGenerationRetry(path.status, legacy, run, path.updatedAt);

    let phase: 'core' | 'stage_design' | 'ready' = 'ready';
    let status: 'queued' | 'processing' | 'stale' | 'failed' | 'ready' = 'ready';

    if (run && run.status !== 'cancelled') {
      if (run.status === 'succeeded' && run.phase === 'stageDesign') {
        phase = 'ready';
        status = 'ready';
      } else {
        phase = run.phase === 'stageDesign' ? 'stage_design' : 'core';
      }
      if (stale) status = 'stale';
      else if (run.status === 'failed') status = 'failed';
      else if (run.status === 'queued') status = 'queued';
      else if (run.status === 'processing') status = 'processing';
      else if (run.status === 'succeeded' && run.phase === 'core') {
        phase = 'stage_design';
        status = 'queued';
      }
    } else if (path.status === 'generating' || path.status === 'failed' || legacy?.core === 'failed') {
      phase = 'core';
      status = path.status === 'failed' || legacy?.core === 'failed' ? 'failed' : 'processing';
    } else if (legacy?.stageDesign === 'failed') {
      phase = 'stage_design';
      status = 'failed';
    } else if (legacy?.stageDesign === 'pending' || legacy?.stageDesign === 'processing') {
      phase = 'stage_design';
      status = 'processing';
    } else if (!accessState.canStartLearning) {
      phase = 'stage_design';
      status = 'stale';
    }

    const lifecycle = phase === 'ready'
      ? 'ready'
      : `${phase}_${status}`;
    const completedStages = phase === 'ready'
      ? totalStages
      : phase === 'stage_design'
        ? Math.min(run?.completedItems || 0, totalStages)
        : 0;
    const currentStageNumber = phase === 'stage_design' && status !== 'ready' && completedStages < totalStages
      ? path.milestones[completedStages]?.stageNumber || completedStages + 1
      : null;

    return {
      lifecycle,
      phase,
      status,
      runId: run?.id || null,
      heartbeatAt: run?.heartbeatAt?.toISOString?.() || legacy?.updatedAt || null,
      retryAllowed: retry.allowed,
      retryType: retry.retryType === 'stageDesign' ? 'stage_design' : retry.retryType,
      completedStages,
      totalStages,
      currentStageNumber,
      errorMessage: getSafeGenerationErrorMessage(
        run?.phase || (phase === 'stage_design' ? 'stageDesign' : phase),
        status,
        run?.errorCode
      ),
      canStartLearning: phase === 'ready' && accessState.canStartLearning
    };
  }

// 获取用户的学习路径列表
  async getUserLearningPaths(userId: string) {
    try {
      const paths = await prisma.learning_paths.findMany({
        where: { userId },
        include: {
          activeGenerationRun: true,
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return paths.map(path => {
        const allTasks = path.milestones.flatMap((m: any) => m.subtasks || []);
        const totalTaskCount = allTasks.length;
        const completedTaskCount = allTasks.filter((t: any) => t.status === 'completed').length;
        const accessState = this.getPathLearningAccessState(
          path.status,
          path.aiPromptTemplate,
          path.activeGenerationRun,
          path.aiGenerated,
          totalTaskCount
        );

        return {
          ...path,
          name: path.title,
          summary: parsePathSummary(path.aiPromptTemplate),
          generationStatus: accessState.generationStatus,
          generationRun: buildGenerationRunStatus(path.activeGenerationRun),
          sceneSummary: this.getPathSceneSummary(path.aiPromptTemplate, path.milestones),
          cognitiveDesign: parsePathCognitiveDesign(path.aiPromptTemplate),
          adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate),
          adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate),
          canStartLearning: accessState.canStartLearning,
          learningBlockedReason: accessState.learningBlockedReason,
          replanLineage: {
            sourcePathId: path.sourcePathId || null,
            replanMode: path.replanMode || null,
            triggerSource: path.replanTriggerSource || null,
            reason: path.replanReason || null,
          },
          totalStages: path.totalMilestones,
          taskSummary: {
            total: totalTaskCount,
            completed: completedTaskCount,
            progress: totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0
          }
        };
      });
    } catch (error) {
      logger.error('获取用户学习路径失败:', error);
      throw error;
    }
  }

// 获取任务详情
  async getTaskDetail(taskId: string, userId?: string) {
    try {
      const subtask = await prisma.subtasks.findUnique({
        where: { id: taskId },
        include: {
          milestones: {
            include: {
              learning_paths: true,
              subtasks: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  order: true,
                },
                orderBy: { order: 'asc' }
              }
            }
          },
          learningContents: true
        }
      });

      if (!subtask) {
        throw new Error('任务不存在');
      }

      const learningPath = subtask.milestones?.learning_paths || null;

      if (userId && learningPath?.userId !== userId) {
        throw new Error('无权访问此任务');
      }

      const accessState = learningPath
        ? this.getPathLearningAccessState(
            learningPath.status,
            learningPath.aiPromptTemplate,
            null,
            learningPath.aiGenerated,
            1
          )
        : {
            generationStatus: null,
            canStartLearning: true,
            learningBlockedReason: null
          };

      const latestTeachingSession = await prisma.teaching_sessions.findFirst({
        where: {
          taskId,
          ...(userId ? { userId } : {}),
          wrapup: { not: null },
        },
        orderBy: { startTime: 'desc' },
        select: {
          startTime: true,
          wrapup: true,
        }
      });

      let latestWrapupStatus: string | null = null;
      if (latestTeachingSession?.wrapup) {
        try {
          latestWrapupStatus = JSON.parse(latestTeachingSession.wrapup)?.status || null;
        } catch {
          latestWrapupStatus = null;
        }
      }

      return {
        ...subtask,
        hasTeachingWrapup: !!latestTeachingSession,
        latestTeachingSessionAt: latestTeachingSession?.startTime?.toISOString?.() || null,
        latestWrapupStatus,
        week: subtask.milestones,
        milestone: subtask.milestones,
        learningPath: learningPath
          ? {
              ...learningPath,
              generationStatus: accessState.generationStatus,
              canStartLearning: accessState.canStartLearning,
              learningBlockedReason: accessState.learningBlockedReason
            }
          : learningPath,
        contents: subtask.learningContents
      };
    } catch (error) {
      logger.error('获取任务详情失败:', error);
      throw error;
    }
  }

  // 获取任务详情（别名，用于路由）
  async getTaskById(taskId: string, userId?: string) {
    return this.getTaskDetail(taskId, userId);
  }

  async retryPathEnrichment(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId }
    });

    if (!path) {
      throw new Error('学习路径不存在');
    }

    if (path.userId !== userId) {
      throw new Error('无权访问此学习路径');
    }

    if (path.status !== 'active') {
      throw new Error('学习路径主结构尚未完成，暂不能继续生成阶段任务');
    }

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
    const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
    if (!retry.allowed || retry.retryType !== 'stageDesign') {
      throw new Error(activeRun?.status === 'succeeded' || generationStatus?.stageDesign === 'succeeded'
        ? '阶段任务已经准备完成，无需重试'
        : '阶段任务仍在生成中，请稍后查看');
    }

    const queued = await this.queuePathEnrichmentRetry(path, generationStatus);

    return {
      accepted: true,
      retryType: 'stageDesign',
      retryCount: queued.retryCount,
      runId: queued.runId
    };
  }

  async getPathGenerationRetry(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({ where: { id: pathId } });
    if (!path) throw new Error('学习路径不存在');
    if (path.userId !== userId) throw new Error('无权访问此学习路径');

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
    return resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
  }

  async claimPathCoreGeneration(pathId: string): Promise<string> {
    const run = await this.createAndClaimGenerationRun(pathId, 'core', 'core');
    return run.id;
  }

  async markActiveGenerationFailed(pathId: string, error: unknown, runId?: string): Promise<void> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { activeGenerationRunId: true }
    });
    const activeRunId = runId || path?.activeGenerationRunId;
    if (!activeRunId || path?.activeGenerationRunId !== activeRunId) return;
    const run = await this.getActiveGenerationRun(pathId, activeRunId);
    if (!run || run.status === 'failed' || run.status === 'succeeded' || run.status === 'cancelled') return;

    try {
      await this.updatePathGenerationStatus(pathId, run.phase === 'stageDesign'
        ? { stageDesign: 'failed', lastError: error instanceof Error ? error.message : String(error) }
        : { core: 'failed', lastError: error instanceof Error ? error.message : String(error) }, activeRunId);
      await this.failGenerationRun(
        pathId,
        activeRunId,
        error,
        run.phase === 'stageDesign' ? 'PATH_ENRICHMENT_FAILED' : 'PATH_GENERATION_CORE_FAILED',
        run.phase === 'stageDesign' ? 'stageDesign' : 'core',
        run.phase === 'core' ? 'failed' : undefined
      );
    } catch (fenceError) {
      if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
    }
  }

  async assertTaskReadyForLearning(taskId: string, userId: string) {
    const task = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                id: true,
                userId: true,
                status: true,
                aiPromptTemplate: true,
                activeGenerationRunId: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    const milestone = task.milestones;
    const learningPath = milestone?.learning_paths;

    if (!learningPath) {
      return;
    }

    if (learningPath.userId !== userId) {
      throw new Error('无权访问此任务');
    }

    // 校验 milestone 是否已解锁
    if (milestone && milestone.status === 'locked') {
      throw new Error('此阶段尚未解锁，请先完成前置阶段');
    }

    const activeRun = await this.getActiveGenerationRun(learningPath.id, learningPath.activeGenerationRunId);
    const accessState = this.getPathLearningAccessState(
      learningPath.status,
      learningPath.aiPromptTemplate,
      activeRun,
      true,
      1
    );

    if (!accessState.canStartLearning) {
      throw new Error(accessState.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    }
  }

  // 删除学习路径
  async deleteLearningPath(pathId: string, userId: string) {
    try {
      // 验证路径存在且属于当前用户
      const path = await prisma.learning_paths.findUnique({
        where: { id: pathId }
      });

      if (!path) {
        throw new Error('学习路径不存在');
      }

      if (path.userId !== userId) {
        throw new Error('无权删除此学习路径');
      }

      // 删除路径（级联删除里程碑和子任务）
      await prisma.learning_paths.delete({
        where: { id: pathId }
      });

      dashboardGuidanceSnapshotService.refreshInBackground(userId, 'path-deleted');

      logger.info(`学习路径删除：${pathId}`);
    } catch (error) {
      logger.error('删除学习路径失败:', error);
      throw error;
    }
  }

  // 预留：基于已学内容重调学习路径（默认 new_version）
  private resolveStageReplanTarget(path: any, requestedStageNumber?: number | null) {
    if (requestedStageNumber) {
      return path.milestones.find((milestone: any) => milestone.stageNumber === requestedStageNumber) || null;
    }

    const activeMilestone = path.milestones.find((milestone: any) => {
      const tasks = milestone.subtasks || [];
      return tasks.length === 0 || tasks.some((task: any) => task.status !== 'completed');
    });

    return activeMilestone || path.milestones[0] || null;
  }

  private async redesignMilestoneTasks(
    path: any,
    milestone: any,
    data: PathReplanRequest,
    learnerReplanProjection: any,
    runId: string
  ) {
    const parsedTemplate = this.parsePathPromptTemplate(path.aiPromptTemplate || null);
    const pathCognitiveDesign = parsePathCognitiveDesign(path.aiPromptTemplate || null);
    const normalizedInput = getSceneFramingNormalizedInput(parsedTemplate?.sceneFraming)
      || resolvePersistedNormalizedInput(parsedTemplate)
      || null;
    const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
      ? parsedTemplate.sceneFraming
      : null;
    const completedTasks = (milestone.subtasks || []).filter((task: any) => task.status === 'completed');

    const stageDesignerInput = {
      milestone: {
        stageNumber: milestone.stageNumber,
        title: milestone.title,
        coreConcept: milestone.coreConceptId || null,
        description: milestone.description || null,
        goal: milestone.goal || null,
        estimatedHours: milestone.estimatedHours || null,
      },
      cognitiveCore: pathCognitiveDesign,
      normalizedInput,
      repairHints: {
        reason: data.reason || null,
        triggerSource: data.triggerSource || null,
        evidence: data.evidence || null,
        learnerReplanProjection,
        preserveCompletedTasks: completedTasks.map((task: any) => ({ id: task.id, title: task.title })),
      },
    };
    const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

    const newTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
    assertStageTasksPresent(milestone.stageNumber, newTasks);

    await prisma.$transaction(async (tx) => {
      await assertGenerationRunFence(tx, path.id, runId);
      await tx.subtasks.deleteMany({
        where: {
          milestoneId: milestone.id,
          status: { not: 'completed' },
        }
      });

      for (let index = 0; index < newTasks.length; index += 1) {
        const taskData = newTasks[index];
        const resolvedConcept = resolveTaskConcept(
          typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
          pathCognitiveDesign,
          typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
        );
        const displayLabel = this.generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
          || (taskData.knowledgeType && taskData.cognitiveLevel ? `${taskData.knowledgeType} + ${taskData.cognitiveLevel}` : null);

        await tx.subtasks.create({
          data: {
            id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${index}`,
            milestoneId: milestone.id,
            userId: data.userId,
            title: taskData.title || `任务${index + 1}`,
            description: taskData.description || '',
            taskType: normalizePathTaskType(taskData.type),
            estimatedMinutes: taskData.estimatedMinutes || 30,
            acceptanceCriteria: taskData.acceptanceHint || '',
            coreConcept: resolvedConcept.linkedConceptName || null,
            linkedConceptId: resolvedConcept.linkedConceptId || null,
            linkedConceptName: resolvedConcept.linkedConceptName || null,
            knowledgeType: taskData.knowledgeType || null,
            cognitiveLevel: taskData.cognitiveLevel || null,
            displayLabel,
            learningObjectives: null,
            transferable: taskData.transferable ?? false,
            annotationConfidence: null,
            order: completedTasks.length + index,
            status: 'todo',
            updatedAt: new Date(),
          }
        });
      }

      await tx.learning_paths.update({
        where: { id: path.id },
        data: {
          aiPromptTemplate: JSON.stringify({
            ...parsedTemplate,
            stageDesigns: {
              ...(parsedTemplate?.stageDesigns && typeof parsedTemplate.stageDesigns === 'object' ? parsedTemplate.stageDesigns : {}),
              [`stage-${milestone.stageNumber}`]: {
                inputPayload: stageDesignerInput,
                rawModelOutput: stageResult?._debug?.rawModelOutput || null,
                extractedJson: stageResult?._debug?.extractedJson || null,
                normalizedOutput: {
                  subtasks: newTasks,
                },
                redesignedAt: new Date().toISOString(),
                redesignReason: data.reason || null,
              }
            },
            _generation: {
              ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
              stageDesign: 'succeeded',
              lastError: null,
              triggerSource: data.triggerSource || 'api',
              updatedAt: new Date().toISOString(),
            }
          }),
          updatedAt: new Date(),
        }
      });
      await tx.path_generation_runs.update({
        where: { id: runId },
        data: {
          status: 'succeeded',
          retryAllowed: false,
          totalItems: 1,
          completedItems: 1,
          progress: 100,
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      await enqueueDomainEvent(tx, createDomainEvent({
        type: 'path:adjusted',
        aggregateType: 'path',
        aggregateId: path.id,
        userId: data.userId,
        source: 'learning-service',
        data: {
          pathId: path.id,
          milestoneId: milestone.id,
          stageNumber: milestone.stageNumber,
          redesignedTaskCount: newTasks.length,
          preservedCompletedTaskCount: completedTasks.length,
          reason: data.reason || null,
          triggerSource: data.triggerSource || 'api'
        }
      }));
    });

    return {
      pathId: path.id,
      redesignedStageNumber: milestone.stageNumber,
      redesignedTaskCount: newTasks.length,
      preservedCompletedTaskCount: completedTasks.length,
    };
  }

  async requestPathReplan(data: PathReplanRequest) {
    const requestedMode = data.mode || 'new_version';
    const mode = requestedMode === 'new_version' ? 'overwrite' : requestedMode;
    const triggerSource = data.triggerSource || 'api';

    const path = await prisma.learning_paths.findUnique({
      where: { id: data.pathId },
      include: {
        milestones: {
          include: {
            subtasks: true
          }
        }
      }
    });

    if (!path) {
      throw new Error('学习路径不存在');
    }

    if (path.userId !== data.userId) {
      throw new Error('无权访问此学习路径');
    }

    const completedTaskIds = path.milestones
      .flatMap((milestone: any) => milestone.subtasks || [])
      .filter((task: any) => task.status === 'completed')
      .map((task: any) => task.id);

    const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
      userId: data.userId,
      pathId: data.pathId,
      scope: 'path',
    });
    const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);
    const replanSignal = learnerSnapshot.replanSignal;
    const targetMilestone = this.resolveStageReplanTarget(path, data.stageNumber || null);

    if (replanSignal?.shouldSuggest && data.requireConfirmation !== false) {
      return {
        enabled: false,
        status: 'awaiting-confirmation',
        signal: replanSignal,
        request: {
          pathId: data.pathId,
          userId: data.userId,
          triggerSource,
          mode,
          requestedMode,
          stageNumber: targetMilestone?.stageNumber || null,
          reason: data.reason || replanSignal.rationale || '',
          evidence: {
            ...(data.evidence || {}),
            learnerReplanProjection,
            replanSignal,
          }
        }
      };
    }

    if (!targetMilestone) {
      throw new Error('当前路径没有可重设计的阶段');
    }

    const currentMilestoneTitle = learnerReplanProjection?.path.currentPosition.milestoneTitle || '';
    const stableConcepts = learnerReplanProjection?.mastery.stableConcepts || [];
    const fragileConcepts = learnerReplanProjection?.mastery.fragileConcepts || [];
    const strugglingConcepts = learnerReplanProjection?.mastery.strugglingConcepts || [];
    const prerequisiteGaps = learnerReplanProjection?.risk.prerequisiteGaps?.map((item) => item.label) || [];

    const run = await this.createAndClaimGenerationRun(data.pathId, 'stageDesign', 'stageDesign', 1);
    const stopHeartbeat = this.startGenerationHeartbeat(data.pathId, run.id);
    let redesignResult;
    try {
      await this.updatePathGenerationStatus(data.pathId, {
        stageDesign: 'processing',
        lastError: null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, run.id);
      redesignResult = await this.redesignMilestoneTasks(path, targetMilestone, data, {
        ...learnerReplanProjection,
        summary: {
          currentMilestoneTitle,
          stableConcepts,
          fragileConcepts,
          strugglingConcepts,
          prerequisiteGaps,
          freezeCompletedTaskIds: completedTaskIds,
        }
      }, run.id);
    } catch (error) {
      try {
        await this.updatePathGenerationStatus(data.pathId, {
          stageDesign: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          triggerSource,
          updatedAt: new Date().toISOString()
        }, run.id);
        await this.failGenerationRun(
          data.pathId,
          run.id,
          error,
          error instanceof Error && error.message.includes('EMPTY_TASKS')
            ? 'PATH_STAGE_DESIGN_ZERO_TASKS'
            : 'PATH_ENRICHMENT_FAILED',
          'stageDesign'
        );
      } catch (fenceError) {
        if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
      }
      throw error;
    } finally {
      stopHeartbeat();
    }

    dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-replanned');

    return {
      enabled: true,
      status: 'redesigned-stage',
      policy: {
        immutableLearned: true,
        freezeCompletedTaskIds: completedTaskIds,
        defaultMode: 'overwrite'
      },
      request: {
        pathId: data.pathId,
        userId: data.userId,
        triggerSource,
        mode,
        requestedMode,
        stageNumber: targetMilestone.stageNumber,
        reason: data.reason || '',
        evidence: {
          ...(data.evidence || {}),
          learnerReplanProjection,
          replanSignal,
        }
      },
      result: {
        pathId: data.pathId,
        runId: run.id,
        redesignedStageNumber: redesignResult.redesignedStageNumber,
        redesignedTaskCount: redesignResult.redesignedTaskCount,
        preservedCompletedTaskCount: redesignResult.preservedCompletedTaskCount,
        mode,
        requestedMode,
      }
    };
  }

  // 完成任务
  async completeTask(data: CompleteTaskData) {
    try {
      const subtask = await prisma.subtasks.findUnique({
        where: { id: data.taskId },
        include: {
          milestones: {
            include: {
              learning_paths: {
                select: { userId: true }
              }
            }
          }
        }
      });

      if (!subtask) {
        throw new Error('任务不存在');
      }

      if (subtask.userId !== data.userId || subtask.milestones?.learning_paths?.userId !== data.userId) {
        throw new Error('无权访问此任务');
      }

      const completedAt = new Date();
      const completionResult = await prisma.$transaction(async (tx) => {
        const completion = await tx.subtasks.updateMany({
          where: {
            id: data.taskId,
            userId: data.userId,
            status: { not: 'completed' }
          },
          data: {
            status: 'completed',
            completedAt,
            rating: data.rating
          }
        });
        if (completion.count === 0) return null;

        await tx.users.update({
          where: { id: data.userId },
          data: { xp: { increment: 50 } }
        });

        const pathId = subtask.milestones?.learningPathId || null;
        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'task:completed',
          aggregateType: 'task',
          aggregateId: data.taskId,
          userId: data.userId,
          source: 'learning-service',
          occurredAt: completedAt,
          data: {
            taskId: data.taskId,
            taskTitle: subtask.title,
            pathId,
            milestoneId: subtask.milestoneId,
            actualMinutes: data.actualMinutes || null,
            subjectiveDifficulty: data.subjectiveDifficulty || null,
            rating: data.rating || null,
            linkedConceptName: subtask.linkedConceptName || subtask.coreConcept || null
          }
        }));

        if (pathId) {
          const remainingMilestoneTasks = await tx.subtasks.count({
            where: {
              milestoneId: subtask.milestoneId,
              status: { not: 'completed' }
            }
          });
          if (remainingMilestoneTasks === 0) {
            await tx.milestones.updateMany({
              where: { id: subtask.milestoneId, status: { not: 'completed' } },
              data: { status: 'completed', completedAt, updatedAt: completedAt }
            });
            const nextMilestone = await tx.milestones.findFirst({
              where: {
                learningPathId: pathId,
                stageNumber: { gt: subtask.milestones.stageNumber },
                status: 'locked'
              },
              orderBy: { stageNumber: 'asc' }
            });
            if (nextMilestone) {
              await tx.milestones.update({
                where: { id: nextMilestone.id },
                data: { status: 'active', unlockedAt: nextMilestone.unlockedAt || completedAt, updatedAt: completedAt }
              });
            }
            const completedMilestones = await tx.milestones.count({
              where: { learningPathId: pathId, status: 'completed' }
            });
            await tx.learning_paths.update({
              where: { id: pathId },
              data: { completedMilestones, updatedAt: completedAt }
            });
          }

          const remainingTasks = await tx.subtasks.count({
            where: {
              milestones: { learningPathId: pathId },
              status: { not: 'completed' }
            }
          });
          if (remainingTasks === 0) {
            const completedMilestones = await tx.milestones.count({ where: { learningPathId: pathId, status: 'completed' } });
            const completedPath = await tx.learning_paths.updateMany({
              where: { id: pathId, status: { not: 'completed' } },
              data: { status: 'completed', completedMilestones, updatedAt: completedAt }
            });
            if (completedPath.count === 1) {
              await enqueueDomainEvent(tx, createDomainEvent({
                type: 'path:completed',
                aggregateType: 'path',
                aggregateId: pathId,
                userId: data.userId,
                source: 'learning-service',
                occurredAt: completedAt,
                data: { pathId, completedByTaskId: data.taskId }
              }));
            }
          }
        }

        return tx.subtasks.findUnique({ where: { id: data.taskId } });
      });

      if (!completionResult) {
        const completedTask = await prisma.subtasks.findUnique({ where: { id: data.taskId } });
        return { task: completedTask || subtask, learningReport: undefined, alreadyCompleted: true };
      }

      const updatedSubtask = completionResult;

      // 更新学习指标 (LSS/KTL/LF/LSB)
      let learningMetrics: Awaited<ReturnType<typeof updateLearningMetrics>> | null = null;
      try {
        learningMetrics = await updateLearningMetrics({
          userId: data.userId,
          taskId: data.taskId,
          durationMinutes: data.actualMinutes || 30,
          subjectiveDifficulty: data.subjectiveDifficulty,
          completed: true,
          notes: data.notes
        });
        logger.info('学习指标已更新', { userId: data.userId });
      } catch (error) {
        logger.warn('更新学习指标失败（不影响任务完成）', error);
      }

      if (learningMetrics) {
        this.emitLearningEvent({
          type: 'learning:completed',
          source: 'learning-service',
          userId: data.userId,
          data: {
            taskId: data.taskId,
            pathId: subtask.milestones?.learningPathId || null,
            milestoneId: subtask.milestoneId,
            lss: learningMetrics.lss,
            ktl: learningMetrics.ktl,
            lf: learningMetrics.lf,
            lsb: learningMetrics.lsb,
          }
        }, 'task-completed')
      }

      // 检查成就达成
      try {
        await achievementService.triggerAchievementCheck(data.userId, 'task_completed');
      } catch (error) {
        logger.warn('检查成就失败（不影响任务完成）:', error);
      }

      // 基于学习者状态中心生成学习报告
      let learningReport: { reasoning?: string; suggestion?: string; recommendations?: string[] } | undefined;
      
      try {
        const progressResult = await learnerProgressService.evaluateTaskCompletion(data.userId, {
          taskTitle: subtask.title,
          timeSpent: data.actualMinutes || 30,
          subjectiveDifficulty: data.subjectiveDifficulty,
          difficulty: subtask.estimatedMinutes ? Math.min(subtask.estimatedMinutes / 30, 10) : 5
        });

        await learnerProgressService.emitSignals(data.userId, [progressResult.signal]);

        learningReport = {
          reasoning: progressResult.metrics?.reasoning,
          suggestion: progressResult.metrics?.suggestion,
          recommendations: progressResult.recommendations
        };
      } catch (error) {
        logger.warn('生成学习报告失败（不影响任务完成）:', error);
      }

      logger.info(`任务完成：${subtask.id}`, { userId: data.userId });

      runBackgroundTask('learner-snapshot.task-completed', () => learnerSnapshotRefreshService.refresh({
        userId: data.userId,
        pathId: subtask.milestones?.learningPathId || undefined,
        taskId: data.taskId,
        milestoneId: subtask.milestoneId,
        scope: 'teaching',
      }), { userId: data.userId, taskId: data.taskId });
      dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'task-completed');

      return {
        task: updatedSubtask,
        learningReport
      };
    } catch (error) {
      logger.error('完成任务失败:', error);
      throw error;
    }
  }

  // 获取学习进度统计
  async getLearningStats(userId: string) {
    try {
      const user = await prisma.users.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('用户不存在');
      }

      const subtasks = await prisma.subtasks.findMany({
        where: { userId }
      });

      const totalPaths = await prisma.learning_paths.count({
        where: {
          userId,
          status: {
            not: 'failed'
          }
        }
      });

      const completedSubtasks = subtasks.filter(t => t.status === 'completed');
      const inProgressSubtasks = subtasks.filter(t => t.status === 'in_progress');
      const todoSubtasks = subtasks.filter(t => t.status === 'todo');

      const totalEstimatedMinutes = subtasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
      const sessions = await prisma.teaching_sessions.findMany({
        where: { userId },
        select: {
          duration: true,
          startTime: true,
          endTime: true,
        },
      });
      const totalMinutes = sessions.reduce((sum, session) => sum + this.normalizeSessionDurationMinutes(session), 0);
      const activeLearningDays = new Set(
        sessions.map((session) => session.startTime.toISOString().split('T')[0])
      ).size;
      const avgDailyMinutes = activeLearningDays > 0
        ? Number((totalMinutes / activeLearningDays).toFixed(1))
        : 0;

      // 获取学习状态指标
      const currentState = await stateTrackingService.getCurrentState(userId);
      const suggestion = currentState ? stateTrackingService.generateSuggestion(currentState) : null;
      const displayState = currentState || null;

      return {
        user: {
          id: user.id,
          name: user.name,
          xp: user.xp,
          level: Math.floor(Math.sqrt(user.xp / 100)) + 1
        },
        subtasks: {
          total: subtasks.length,
          completed: completedSubtasks.length,
          inProgress: inProgressSubtasks.length,
          todo: todoSubtasks.length
        },
        tasks: {
          total: subtasks.length,
          completed: completedSubtasks.length,
          inProgress: inProgressSubtasks.length,
          todo: todoSubtasks.length,
          completionRate: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0
        },
        paths: {
          total: totalPaths
        },
        time: {
          totalMinutes,
          totalCompleted: totalMinutes,
          totalEstimated: totalEstimatedMinutes,
          activeLearningDays,
          avgDailyMinutes,
          progress: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0,
          completionRate: subtasks.length > 0 ? (completedSubtasks.length / subtasks.length * 100).toFixed(1) : '0'
        },
        state: displayState,
        suggestion
      };
    } catch (error) {
      logger.error('获取学习统计失败:', error);
      throw error;
    }
  }
}

export default new LearningService();
