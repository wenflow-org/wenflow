// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import aiService from '../ai/ai.service';
import stateTrackingService from './state-tracking.service';
import achievementService from '../achievements/achievement.service';
import { updateLearningMetrics } from '../metrics/LearningMetricService';
import { progressAgentHandler } from '../../agents/progress-agent';
import type { AgentInput, AgentContext } from '../../agents/protocol';
import { runWithContext } from '../../gateway/api-gateway/context';
import { normalizeAgentOutput } from '../../agents/output-normalizer';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';

// Path 任务画像 Skills
import { executeSkill } from '../../skills';
import { goalTypeIdentifierDefinition } from '../../skills/goal-type-identifier';
import { batchAndersonLabelerDefinition } from '../../skills/batch-anderson-labeler';
import { pathSceneFramingDefinition } from '../../skills/path-scene-framing';

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
    pathSceneFraming?: any;
    replan?: {
      mode?: 'new_version' | 'overwrite';
      triggerSource?: string;
      sourcePathId?: string;
      learnerReplanProjection?: any;
      freezeCompletedTaskIds?: string[];
    };
  };
}

interface PathReplanRequest {
  pathId: string;
  userId: string;
  triggerSource?: 'goal-conversation' | 'progress-agent' | 'ai-teaching' | 'admin' | 'system' | 'api';
  reason?: string;
  mode?: 'new_version' | 'overwrite';
  evidence?: Record<string, any>;
}

const STALE_GENERATING_PATH_MINUTES = 15;
const ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES = [1, 5, 15] as const;
const ENRICHMENT_AUTO_RETRY_SCAN_LIMIT = 200;

type PathGenerationPhase = 'core' | 'enrichment';
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
  enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string;
  enrichmentRetryCount?: number;
  lastEnrichmentRetryAt?: string | null;
  scene?: Record<string, any> | null;
}

interface ParsedPathGenerationStatus {
  core?: 'pending' | 'processing' | 'succeeded' | 'failed';
  coreStep?: PathCoreStep;
  enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string | null;
  enrichmentRetryCount?: number;
  lastEnrichmentRetryAt?: string | null;
  scene?: Record<string, any> | null;
}

interface PathSceneFraming {
  version: 'goal-path-scene-v1';
  intent: string;
  targetState: string;
  firstDeliverable: string;
  cognitiveDomain?: string;
  planningFocus: string[];
  excludedScope: string[];
  resourceProfile: {
    timeBudget?: string;
    timeHorizon?: string;
    pace?: string;
  };
  riskFlags: string[];
  sourceGoal: {
    surfaceGoal?: string;
    realProblem?: string;
    motivation?: string;
    urgency?: string;
  };
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

interface PathAdjustmentPolicy {
  allowedModes: Array<'expand' | 'compress' | 'replan'>;
  recommendedMode?: 'expand' | 'compress' | 'replan' | null;
  triggerSource?: 'learn' | 'ai-teaching' | 'progress-agent' | 'system' | null;
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

interface PathProcessInputSnapshot {
  source: 'goal' | 'learn' | 'replan' | 'api';
  mode: 'generate' | 'expand' | 'compress' | 'replan';
  description: string;
  subject: string | null;
  deadlineText: string | null;
  sourceConversationId: string | null;
  existingPathId: string | null;
  skillLevel: string | null;
  timePerDay: string | null;
  structuredData: any;
  confirmedProposal: any;
  confidenceScores: any;
  conversationHistoryPreview: Array<{ role: string; content: string }>;
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

function parsePathCognitiveDesign(raw: string | null): PathCognitiveDesign | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.cognitiveDesign;

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
      || candidate.triggerSource === 'progress-agent'
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

  return {
    title: sceneFraming.intent,
    firstDeliverable: sceneFraming.firstDeliverable,
    targetState: sceneFraming.targetState,
    planningFocus: sceneFraming.planningFocus || [],
    excludedScope: sceneFraming.excludedScope || [],
    riskFlags: sceneFraming.riskFlags || [],
    timeBudget: sceneFraming.resourceProfile?.timeBudget || null,
    timeHorizon: sceneFraming.resourceProfile?.timeHorizon || null,
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
      enrichment: normalizeStageStatus(generation.enrichment),
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
      enrichmentRetryCount: typeof generation.enrichmentRetryCount === 'number'
        ? generation.enrichmentRetryCount
        : 0,
      lastEnrichmentRetryAt: typeof generation.lastEnrichmentRetryAt === 'string'
        ? generation.lastEnrichmentRetryAt
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

function buildProcessInputSnapshot(data: GeneratePathData): PathProcessInputSnapshot {
  const previewHistory = Array.isArray(data.userProfile?.conversationHistory)
    ? data.userProfile.conversationHistory
        .slice(-6)
        .map((message: any) => ({
          role: typeof message?.role === 'string' ? message.role : 'user',
          content: typeof message?.content === 'string' ? message.content.slice(0, 500) : '',
        }))
        .filter((message: { role: string; content: string }) => message.content)
    : [];

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
    structuredData: data.userProfile?.structuredData || null,
    confirmedProposal: data.userProfile?.confirmedProposal || null,
    confidenceScores: data.userProfile?.confidenceScores || null,
    conversationHistoryPreview: previewHistory,
  };
}

function normalizeStageTraceStatus(value: any): 'started' | 'succeeded' | 'failed' | null {
  return value === 'started' || value === 'succeeded' || value === 'failed' ? value : null;
}

function normalizeStageTracePhase(value: any): PathGenerationPhase | null {
  return value === 'core' || value === 'enrichment' ? value : null;
}

class LearningService {
  private buildPathProcessDetail(path: any) {
    const parsedTemplate = this.parsePathPromptTemplate(path.aiPromptTemplate || null);
    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate || null);
    const processInput = parsedTemplate?.processInput && typeof parsedTemplate.processInput === 'object'
      ? parsedTemplate.processInput
      : null;
    const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
      ? parsedTemplate.sceneFraming
      : null;
    const fallbackSourceGoal = sceneFraming?.sourceGoal && typeof sceneFraming.sourceGoal === 'object'
      ? sceneFraming.sourceGoal
      : null;
    const fallbackDescription = processInput?.description
      || path.description
      || fallbackSourceGoal?.surfaceGoal
      || fallbackSourceGoal?.realProblem
      || null;
    const fallbackSubject = processInput?.subject
      || path.subject
      || null;
    const fallbackSkillLevel = processInput?.skillLevel
      || parsedTemplate?.difficulty
      || path.difficulty
      || null;
    const taskProfiles = (path.milestones || []).flatMap((milestone: any) =>
      (milestone.subtasks || []).map((task: any) => ({
        taskId: task.id,
        milestoneId: milestone.id,
        milestoneTitle: milestone.title || milestone.goal || null,
        title: task.title,
        status: task.status,
        knowledgeType: task.knowledgeType || null,
        cognitiveLevel: task.cognitiveLevel || null,
        displayLabel: task.displayLabel || null,
        learningObjectives: parseTaskLearningObjectives(task.learningObjectives),
        coreConcept: task.coreConcept || null,
        transferable: task.transferable ?? false,
        annotationConfidence: task.annotationConfidence ?? null,
      }))
    );

    return {
      source: typeof processInput?.source === 'string'
        ? processInput.source
        : (typeof parsedTemplate?.source === 'string' ? parsedTemplate.source : null),
      mode: typeof processInput?.mode === 'string'
        ? processInput.mode
        : (typeof parsedTemplate?.mode === 'string' ? parsedTemplate.mode : null),
      sourceConversationId: processInput?.sourceConversationId || generationStatus?.sourceConversationId || null,
      goalInput: {
        description: fallbackDescription,
        subject: fallbackSubject,
        deadlineText: processInput?.deadlineText || path.deadlineText || null,
        sourceGoal: fallbackSourceGoal,
        skillLevel: fallbackSkillLevel,
        timePerDay: processInput?.timePerDay || null,
        structuredData: processInput?.structuredData || null,
        confirmedProposal: processInput?.confirmedProposal || null,
        confidenceScores: processInput?.confidenceScores || null,
        conversationHistoryPreview: Array.isArray(processInput?.conversationHistoryPreview)
          ? processInput.conversationHistoryPreview
          : [],
      },
      framing: sceneFraming ? {
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
      } : null,
      cognitiveDesign: parsePathCognitiveDesign(path.aiPromptTemplate || null),
      adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate || null),
      adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate || null),
      generationTimeline: generationStatus ? {
        core: generationStatus.core || null,
        coreStep: generationStatus.coreStep || null,
        enrichment: generationStatus.enrichment || null,
        lastError: generationStatus.lastError || null,
        triggerSource: generationStatus.triggerSource || null,
        updatedAt: generationStatus.updatedAt || null,
        enrichmentRetryCount: generationStatus.enrichmentRetryCount || 0,
        lastEnrichmentRetryAt: generationStatus.lastEnrichmentRetryAt || null,
      } : null,
      taskProfiles,
      raw: {
        processInput,
        promptTemplate: parsedTemplate,
        generationStatus,
      },
    };
  }

  private async getPathStageTraces(pathId: string, sourceConversationId?: string | null): Promise<PathStageTraceItem[]> {
    const logs = await prisma.agent_call_logs.findMany({
      where: {
        agentId: 'path-orchestrator',
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
        type: task?.type || 'practice',
        estimatedMinutes: task?.estimatedMinutes || 30,
        acceptanceCriteria: task?.acceptanceCriteria || '',
        linkedConcept,
      };
    });
  }

  private normalizeMilestonesWithConcepts(milestonesData: any[], cognitiveDesign: PathCognitiveDesign) {
    const conceptIds = Array.isArray(cognitiveDesign.coreConcepts)
      ? cognitiveDesign.coreConcepts.map((concept) => concept.id)
      : [];

    return (Array.isArray(milestonesData) ? milestonesData : []).map((milestone: any, index: number) => ({
      ...milestone,
      stage: milestone?.stage || index + 1,
      name: milestone?.name || milestone?.title || `里程碑${index + 1}`,
      description: milestone?.description || '',
      goal: milestone?.goal || '',
      estimatedHours: milestone?.estimatedHours || 0,
      tasks: this.normalizeMilestoneTasks(milestone?.tasks || [], conceptIds)
    }));
  }

  private getPathLearningAccessState(pathStatus: string | null | undefined, aiPromptTemplate: string | null) {
    const generationStatus = parsePathGenerationStatus(aiPromptTemplate);
    const enrichmentStatus = generationStatus?.enrichment;

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
      return {
        generationStatus,
        canStartLearning: pathStatus === 'active',
        learningBlockedReason: pathStatus === 'active'
          ? null
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
        learningBlockedReason: '学习内容准备遇到问题，系统会继续尝试，请稍后再开始学习。'
      };
    }

    return {
      generationStatus,
      canStartLearning: false,
      learningBlockedReason: '学习内容还在准备中，请稍候再开始学习。'
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
      || generationStatus?.lastEnrichmentRetryAt
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
  ): Promise<number> {
    const retryCount = (generationStatus?.enrichmentRetryCount || 0) + 1;
    const retryAt = new Date().toISOString();

    await this.updatePathGenerationStatus(path.id, {
      enrichment: 'pending',
      lastError: null,
      enrichmentRetryCount: retryCount,
      lastEnrichmentRetryAt: retryAt,
      updatedAt: retryAt
    });

    const analysis = {
      ...this.parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    void this.enrichLearningPathWithAnderson(path.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      userProfile: {}
    }, analysis);

    return retryCount;
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
    const planningFocus = Array.isArray(sceneFraming?.planningFocus) ? sceneFraming.planningFocus : [];
    const focusSource = planningFocus.length > 0
      ? planningFocus
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
          : sceneFraming?.cognitiveDomain || sceneFraming?.intent || analysis?.subject || data.description,
        coreConcepts: generatedCoreConcepts,
      },
      sceneFraming?.cognitiveDomain || sceneFraming?.intent || analysis?.subject || data.description,
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

  private async updatePathGenerationStatus(pathId: string, patch: PathGenerationStatusPatch): Promise<void> {
    try {
      const existing = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        select: { aiPromptTemplate: true }
      });

      if (!existing) return;

      const currentTemplate = this.parsePathPromptTemplate(existing.aiPromptTemplate);
      const currentGeneration = currentTemplate._generation && typeof currentTemplate._generation === 'object'
        ? currentTemplate._generation
        : {};

      await prisma.learning_paths.update({
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
    } catch (error) {
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
          agentId: 'path-orchestrator',
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
    const staleBefore = new Date(Date.now() - STALE_GENERATING_PATH_MINUTES * 60 * 1000);

    const stalePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'generating',
        updatedAt: { lt: staleBefore }
      },
      select: { id: true }
    });

    const result = await prisma.learning_paths.updateMany({
      where: {
        status: 'generating',
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
        enrichment: 'failed',
        lastError: 'GENERATION_TIMEOUT_ORPHANED'
      })));
    }

    return result.count;
  }

  async retryEligibleFailedPathPreparations(): Promise<number> {
    const candidatePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'active',
        aiGenerated: true
      },
      select: {
        id: true,
        userId: true,
        title: true,
        name: true,
        description: true,
        subject: true,
        deadline: true,
        deadlineText: true,
        aiPromptTemplate: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: ENRICHMENT_AUTO_RETRY_SCAN_LIMIT
    });

    let retriedCount = 0;

    for (const path of candidatePaths) {
      const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);

      if (generationStatus?.enrichment !== 'failed') {
        continue;
      }

      const retryCount = generationStatus.enrichmentRetryCount || 0;
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
        logger.warn('自动继续准备学习内容失败', {
          pathId: path.id,
          retryCount,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (retriedCount > 0) {
      logger.info('已触发学习内容自动继续准备', { retriedCount });
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
      milestones: milestones.map((milestone: any) => ({
        ...milestone,
        subtasks: (milestone.subtasks || []).map((task: any) => ({
          ...task,
          actualMinutes: actualMinutesMap.get(task.id) ?? null,
          hasTeachingWrapup: latestSessionAtMap.has(task.id),
          latestTeachingSessionAt: latestSessionAtMap.get(task.id) ?? null,
          latestWrapupStatus: latestWrapupStatusMap.get(task.id) ?? null,
        })),
      })),
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
        pathSceneFraming: data.userProfile?.pathSceneFraming
      }
    };
  }

  private async analyzePathWithAgent(data: GeneratePathData): Promise<any> {
    try {
      const { pathAgentHandler } = await import('../../agents/path-agent');
      const agentInput = this.buildPathAgentInput(data);
      const agentContext = { userId: data.userId };

      if (!data.userProfile?.pathSceneFraming) {
        const sceneFraming = await executeSkill(pathSceneFramingDefinition, {
          goal: agentInput.goal,
          currentLevel: agentInput.currentLevel,
          timePerDay: agentInput.timePerDay,
          structuredData: agentInput.structuredData,
          confirmedProposal: agentInput.confirmedProposal,
          metadata: agentInput.metadata || {},
        });
        data.userProfile = {
          ...(data.userProfile || {}),
          pathSceneFraming: sceneFraming
        };
        agentInput.metadata = {
          ...(agentInput.metadata || {}),
          pathSceneFraming: sceneFraming
        };
      }

      const agentResult = await runWithContext({
        userId: data.userId,
        agentId: 'path-agent',
        action: 'generateLearningPath'
      }, () => pathAgentHandler(agentInput, agentContext));

      const normalizedPathResult = normalizeAgentOutput('path-agent', agentResult);
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
      logger.info('PathAgent 调用成功', { userId: data.userId, pathId: path.id });

      return {
        pathName: path.name,
        subject: path.subject || '综合',
        difficulty: data.userProfile?.skillLevel || 'beginner',
        estimatedTotalHours: path.estimatedHours || 0,
        sceneFraming: data.userProfile?.pathSceneFraming || null,
        suggestedMilestones: (path.milestones || []).map((m: any, idx: number) => ({
          stage: m.stageNumber || idx + 1,
          name: m.title,
          description: m.description,
          goal: m.goal,
          estimatedHours: m.estimatedHours,
          tasks: (m.subtasks || []).map((t: any) => ({
            title: t.title,
            description: t.description || '',
            type: t.type || 'practice',
            estimatedMinutes: t.estimatedMinutes || 30,
            acceptanceCriteria: t.acceptanceCriteria || '',
            linkedConcept: typeof t.linkedConcept === 'string' ? t.linkedConcept : undefined,
          }))
        })),
        cognitiveDesign: path.cognitiveDesign,
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

  private async persistGeneratedPath(data: GeneratePathData, analysis: any, milestonesData: any[]) {
    const cognitiveDesign = this.buildPathCognitiveDesign(data, analysis);
    const normalizedMilestonesData = this.normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
    const adjustmentPolicy = this.buildPathAdjustmentPolicy();
    const adjustmentEvidence = this.buildPathAdjustmentEvidence(data);
    const promptTemplatePayload = {
      ...analysis,
      source: data.source || (data.sourceConversationId ? 'goal' : 'api'),
      mode: data.mode || 'generate',
      processInput: buildProcessInputSnapshot(data),
      suggestedMilestones: normalizedMilestonesData,
      cognitiveDesign,
      adjustmentPolicy,
      adjustmentEvidence,
    };

    const learningPath = await prisma.$transaction(async (tx) => {
      let path;
      if (data.existingPathId) {
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
          subtasks: JSON.stringify(normalizedMilestonesData.flatMap((m: any) => m.tasks || []) || []),
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
            estimatedHours: milestoneData.estimatedHours || 0,
            status: stageNum === 1 ? 'active' : 'locked',
            order: i,
            updatedAt: new Date()
          }
        });

        if (milestoneData.tasks && milestoneData.tasks.length > 0) {
          for (let j = 0; j < milestoneData.tasks.length; j++) {
            const taskData = milestoneData.tasks[j];
            await (tx.subtasks as any).create({
              data: {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${i}_${j}`,
                milestoneId: milestone.id,
                userId: data.userId,
                title: taskData.title || `任务${j + 1}`,
                description: taskData.description || '',
                taskType: taskData.type || 'practice',
                estimatedMinutes: taskData.estimatedMinutes || 30,
                acceptanceCriteria: taskData.acceptanceCriteria || '',
                coreConcept: typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
                order: j,
                status: 'todo',
                updatedAt: new Date()
              }
            });
          }
        }
      }

      await tx.learning_paths.update({
        where: { id: path.id },
          data: { totalMilestones: normalizedMilestonesData.length }
      });

      return path;
    });

    return this.getLearningPath(learningPath.id);
  }

  private async enrichLearningPathWithAnderson(pathId: string, data: GeneratePathData, analysis: any): Promise<void> {
    const startTime = Date.now();
    const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';

    await this.recordPathGenerationStageLog({
      userId: data.userId,
      pathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'enrichment',
      status: 'started',
      input: { goal: data.description }
    });

    await this.updatePathGenerationStatus(pathId, {
      enrichment: 'processing',
      lastError: null,
      sourceConversationId: data.sourceConversationId || null,
      triggerSource,
      updatedAt: new Date().toISOString()
    });

    try {
      logger.info('开始任务画像后处理...', { userId: data.userId, pathId });

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

      const goalAnalysisResult = await executeSkill(goalTypeIdentifierDefinition, {
        goal: data.description,
        context: JSON.stringify(data.userProfile || {}),
        domain: analysis.subject
      });

      const allTasks = learningPath.milestones.flatMap((milestone: any, milestoneIndex: number) =>
        (milestone.subtasks || []).map((task: any, taskIndex: number) => ({
          id: task.id,
          taskId: task.id,
          milestoneIndex,
          taskIndex,
          title: task.title,
          description: task.description || '',
          type: task.taskType || 'practice',
          stageGoal: milestone.goal || milestone.title
        }))
      );

      if (allTasks.length === 0) {
        await this.recordPathGenerationStageLog({
          userId: data.userId,
          pathId,
          sourceConversationId: data.sourceConversationId,
          triggerSource,
          phase: 'enrichment',
          status: 'succeeded',
          durationMs: Date.now() - startTime,
          output: { taskCount: 0, labeledCount: 0 }
        });
        await this.updatePathGenerationStatus(pathId, {
          enrichment: 'succeeded',
          lastError: null,
          sourceConversationId: data.sourceConversationId || null,
          triggerSource,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      const labelerResult = await executeSkill(batchAndersonLabelerDefinition, {
        tasks: allTasks,
        goalType: goalAnalysisResult.goalType,
        knowledgeDistribution: goalAnalysisResult.knowledgeDistribution,
        cognitiveFocus: goalAnalysisResult.cognitiveFocus
      });

      const taskLabels = labelerResult.labels || [];

      for (const label of taskLabels) {
        if (label.knowledgeType && label.cognitiveLevel) {
          label.displayLabel = this.generateDisplayLabel(label.knowledgeType, label.cognitiveLevel)
            || `${label.knowledgeType} + ${label.cognitiveLevel}`;
        }
      }

      await prisma.$transaction(async (tx) => {
        for (const label of taskLabels) {
          const taskId = label.taskId || label.id;
          if (!taskId) continue;
          await tx.subtasks.update({
            where: { id: taskId },
            data: {
              knowledgeType: label.knowledgeType || null,
              cognitiveLevel: label.cognitiveLevel || null,
              displayLabel: label.displayLabel || null,
              learningObjectives: label.learningObjectives ? JSON.stringify(label.learningObjectives) : null,
              coreConcept: label.coreConcept || null,
              transferable: label.transferable ?? false,
              annotationConfidence: label.confidence || null,
              updatedAt: new Date()
            }
          });
        }
      });

      logger.info('任务画像后处理完成', {
        pathId,
        userId: data.userId,
        taskCount: allTasks.length,
        labeledCount: taskLabels.length
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'enrichment',
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        output: {
          taskCount: allTasks.length,
          labeledCount: taskLabels.length,
          goalType: goalAnalysisResult.goalType
        }
      });
      await this.updatePathGenerationStatus(pathId, {
        enrichment: 'succeeded',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      });
    } catch (andersonError: any) {
      logger.warn('任务画像后处理失败，路径保持可用', {
        pathId,
        userId: data.userId,
        error: andersonError?.message || String(andersonError)
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'enrichment',
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: andersonError?.message || String(andersonError),
        errorCode: 'PATH_ENRICHMENT_FAILED'
      });
      await this.updatePathGenerationStatus(pathId, {
        enrichment: 'failed',
        lastError: andersonError?.message || String(andersonError),
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      });
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
        enrichment: 'pending',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      });
    }

    try {
      logger.info('开始生成学习路径...', { userId: data.userId, goal: data.description });
      const analysis = await this.analyzePathWithAgent(data);

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
      }, normalizedMilestonesData);
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

      await this.updatePathGenerationStatus(fullPath.id, {
        core: 'succeeded',
        enrichment: 'pending',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        scene: sceneSummary,
        updatedAt: new Date().toISOString()
      });

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
        await this.updatePathGenerationStatus(data.existingPathId, {
          core: 'failed',
          enrichment: 'failed',
          lastError: error?.message || String(error),
          sourceConversationId: data.sourceConversationId || null,
          triggerSource,
          updatedAt: new Date().toISOString()
        });
      }

      throw new Error(`生成学习路径失败：${error?.message || '未知错误'}。请稍后重试或联系支持。`);
    }
  }

  // 使用 AI 生成学习路径 (阶段化设计)
  async generateLearningPath(data: GeneratePathData) {
    const { fullPath, analysis } = await this.generateLearningPathCore(data);

    void this.enrichLearningPathWithAnderson(fullPath.id, data, analysis);
    void learnerSnapshotRefreshService.refresh({
      userId: data.userId,
      pathId: fullPath.id,
      scope: 'path',
    });

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
                  taskType: task.type || 'practice',
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
                taskType: 'practice',
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
              taskType: 'practice',
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
      const accessState = this.getPathLearningAccessState(path.status, path.aiPromptTemplate);
      const processDetail = this.buildPathProcessDetail(pathWithActualMinutes);
      const stageTraces = await this.getPathStageTraces(path.id, processDetail.sourceConversationId || null);

      return {
        ...pathWithActualMinutes,
        summary: parsePathSummary(path.aiPromptTemplate),
        generationStatus: accessState.generationStatus,
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

// 获取用户的学习路径列表
  async getUserLearningPaths(userId: string) {
    try {
      const paths = await prisma.learning_paths.findMany({
        where: { userId },
        include: {
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
        const accessState = this.getPathLearningAccessState(path.status, path.aiPromptTemplate);

        return {
          ...path,
          name: path.title,
          summary: parsePathSummary(path.aiPromptTemplate),
          generationStatus: accessState.generationStatus,
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
              learning_paths: true
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
        ? this.getPathLearningAccessState(learningPath.status, learningPath.aiPromptTemplate)
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
      throw new Error('学习路径主结构尚未完成，暂不能继续准备');
    }

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);

    if (generationStatus?.enrichment === 'processing') {
      throw new Error('学习内容仍在准备中，请稍后查看');
    }

    const retryCount = await this.queuePathEnrichmentRetry(path, generationStatus);

    return {
      accepted: true,
      retryCount
    };
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
                aiPromptTemplate: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    const learningPath = task.milestones?.learning_paths;

    if (!learningPath) {
      return;
    }

    if (learningPath.userId !== userId) {
      throw new Error('无权访问此任务');
    }

    const accessState = this.getPathLearningAccessState(learningPath.status, learningPath.aiPromptTemplate);

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

      logger.info(`学习路径删除：${pathId}`);
    } catch (error) {
      logger.error('删除学习路径失败:', error);
      throw error;
    }
  }

  // 预留：基于已学内容重调学习路径（默认 new_version）
  async requestPathReplan(data: PathReplanRequest) {
    const mode = data.mode || 'new_version';
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

    const learnerSnapshot = await learnerSnapshotRefreshService.getLatest({
      userId: data.userId,
      pathId: data.pathId,
      scope: 'path',
    });
    const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);

    if (mode === 'overwrite') {
      return {
        enabled: false,
        status: 'not_enabled',
        policy: {
          immutableLearned: true,
          freezeCompletedTaskIds: completedTaskIds,
          defaultMode: 'new_version'
        },
        request: {
          pathId: data.pathId,
          userId: data.userId,
          triggerSource,
          mode,
          reason: data.reason || '',
          evidence: {
            ...(data.evidence || {}),
            learnerReplanProjection,
          }
        }
      };
    }

    const currentMilestoneTitle = learnerReplanProjection?.path.currentPosition.milestoneTitle || '';
    const stableConcepts = learnerReplanProjection?.mastery.stableConcepts || [];
    const fragileConcepts = learnerReplanProjection?.mastery.fragileConcepts || [];
    const strugglingConcepts = learnerReplanProjection?.mastery.strugglingConcepts || [];
    const prerequisiteGaps = learnerReplanProjection?.risk.prerequisiteGaps?.map((item) => item.label) || [];

    const replanDescriptionParts = [
      path.description || path.title || path.name || '个性化学习路径',
      data.reason ? `重调原因：${data.reason}` : null,
      currentMilestoneTitle ? `当前推进阶段：${currentMilestoneTitle}` : null,
      stableConcepts.length > 0 ? `已稳定掌握：${stableConcepts.join('、')}` : null,
      fragileConcepts.length > 0 ? `掌握不稳：${fragileConcepts.join('、')}` : null,
      strugglingConcepts.length > 0 ? `持续吃力：${strugglingConcepts.join('、')}` : null,
      prerequisiteGaps.length > 0 ? `需补前置：${prerequisiteGaps.join('、')}` : null,
    ].filter(Boolean);

    const replanUserProfile = {
      skillLevel: learnerSnapshot.profile.learning.ktl >= 6 ? 'advanced' : learnerSnapshot.profile.learning.ktl >= 3 ? 'intermediate' : 'beginner',
      currentSkillLevel: learnerSnapshot.profile.learning.ktl >= 6 ? 'advanced' : learnerSnapshot.profile.learning.ktl >= 3 ? 'intermediate' : 'beginner',
      timePerDay: path.deadlineText || undefined,
      totalWeeks: undefined,
      replan: {
        mode,
        triggerSource,
        sourcePathId: data.pathId,
        learnerReplanProjection,
        freezeCompletedTaskIds: completedTaskIds,
      },
      structuredData: {
        learner: {
          thinkingStyle: learnerSnapshot.profile.cognitive.thinkingStyle,
          preferredStyle: learnerSnapshot.profile.preferences.preferredStyle,
          confidenceLevel: learnerSnapshot.profile.emotional.confidenceLevel,
        },
        replan: {
          mode,
          triggerSource,
          currentPathId: data.pathId,
          freezeCompletedTaskIds: completedTaskIds,
          learnerReplanProjection,
        }
      },
      confirmedProposal: {
        learning_direction: path.title || path.name,
        key_stages: path.milestones.map((milestone: any) => milestone.title).filter(Boolean),
        learning_style: learnerSnapshot.profile.preferences.theoryVsPractice,
      },
      confidenceScores: {
        understanding: learnerSnapshot.freshness.confidence,
        learnerModel: learnerSnapshot.freshness.confidence,
      },
      conversationHistory: [
        {
          role: 'system',
          content: `本次为基于学习者模型的路径重调。冻结已完成任务：${completedTaskIds.join(', ') || '无'}。`
        },
        {
          role: 'user',
          content: replanDescriptionParts.join('\n')
        }
      ]
    };

    const newPath = await this.generateLearningPath({
      userId: data.userId,
      description: replanDescriptionParts.join('\n'),
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      userProfile: replanUserProfile,
    });

    return {
      enabled: true,
      status: 'created',
      policy: {
        immutableLearned: true,
        freezeCompletedTaskIds: completedTaskIds,
        defaultMode: 'new_version'
      },
      request: {
        pathId: data.pathId,
        userId: data.userId,
        triggerSource,
        mode,
        reason: data.reason || '',
        evidence: {
          ...(data.evidence || {}),
          learnerReplanProjection,
        }
      },
      result: {
        newPathId: newPath.id,
        sourcePathId: data.pathId,
        mode,
      }
    };
  }

  // 完成任务
  async completeTask(data: CompleteTaskData) {
    try {
      const subtask = await prisma.subtasks.findUnique({
        where: { id: data.taskId }
      });

      if (!subtask) {
        throw new Error('任务不存在');
      }

      // 更新任务状态
      const updatedSubtask = await prisma.subtasks.update({
        where: { id: data.taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          rating: data.rating
        }
      });

      // 更新学习指标 (LSS/KTL/LF/LSB)
      try {
        await updateLearningMetrics({
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

      // 更新用户 XP
      const XP_PER_TASK = 50;
      await prisma.users.update({
        where: { id: data.userId },
        data: {
          xp: { increment: XP_PER_TASK }
        }
      });

      // 检查成就达成
      try {
        await achievementService.triggerAchievementCheck(data.userId, 'task_completed');
      } catch (error) {
        logger.warn('检查成就失败（不影响任务完成）:', error);
      }

      // 调用 progress-agent 生成学习报告
      let learningReport: { reasoning?: string; suggestion?: string; recommendations?: string[] } | undefined;
      
      try {
        const agentInput: AgentInput = {
          type: 'standard',
          goal: 'task_completion_analysis',
          metadata: {
            action: 'task_complete',
            taskId: data.taskId,
            data: {
              taskTitle: subtask.title,
              timeSpent: data.actualMinutes || 30,
              subjectiveDifficulty: data.subjectiveDifficulty,
              difficulty: subtask.estimatedMinutes ? Math.min(subtask.estimatedMinutes / 30, 10) : 5
            }
          }
        };

        const agentContext: AgentContext = {
          userId: data.userId
        };

        const result = await progressAgentHandler(agentInput, agentContext);
        const normalizedProgressResult = normalizeAgentOutput('progress-agent', result);
        const progressPayload = normalizedProgressResult.internal?.progress || result.progress;

        if (normalizedProgressResult.success && progressPayload) {
          learningReport = {
            reasoning: progressPayload.metrics?.reasoning,
            suggestion: progressPayload.metrics?.suggestion,
            recommendations: progressPayload.recommendations
          };
        }
      } catch (error) {
        logger.warn('生成学习报告失败（不影响任务完成）:', error);
      }

      logger.info(`任务完成：${subtask.id}`, { userId: data.userId });

      void learnerSnapshotRefreshService.refresh({
        userId: data.userId,
        taskId: data.taskId,
        milestoneId: subtask.milestoneId,
        scope: 'teaching',
      });

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
        state: currentState,
        suggestion
      };
    } catch (error) {
      logger.error('获取学习统计失败:', error);
      throw error;
    }
  }
}

export default new LearningService();
