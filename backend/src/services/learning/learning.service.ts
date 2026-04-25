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

// Anderson 框架 Skills
import { executeSkill } from '../../skills';
import { goalTypeIdentifierDefinition } from '../../skills/goal-type-identifier';
import { batchAndersonLabelerDefinition } from '../../skills/batch-anderson-labeler';

interface CreateGoalData {
  userId: string;
  description: string;
  subject?: string;
}

interface GeneratePathData {
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
  enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string;
  enrichmentRetryCount?: number;
  lastEnrichmentRetryAt?: string | null;
}

interface ParsedPathGenerationStatus {
  core?: 'pending' | 'processing' | 'succeeded' | 'failed';
  enrichment?: 'pending' | 'processing' | 'succeeded' | 'failed';
  lastError?: string | null;
  sourceConversationId?: string | null;
  triggerSource?: string | null;
  updatedAt?: string | null;
  enrichmentRetryCount?: number;
  lastEnrichmentRetryAt?: string | null;
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

    return {
      core: normalizeStageStatus(generation.core),
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

class LearningService {
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
      },
    });

    const actualMinutesMap = new Map<string, number>();
    sessions.forEach((session) => {
      if (!session.taskId) return;

      const minutes = this.normalizeSessionDurationMinutes(session);
      if (minutes <= 0) return;

      actualMinutesMap.set(session.taskId, (actualMinutesMap.get(session.taskId) || 0) + minutes);
    });

    return {
      ...path,
      milestones: milestones.map((milestone: any) => ({
        ...milestone,
        subtasks: (milestone.subtasks || []).map((task: any) => ({
          ...task,
          actualMinutes: actualMinutesMap.get(task.id) ?? null,
        })),
      })),
    };
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
        replan: data.userProfile?.replan
      }
    };
  }

  private async analyzePathWithAgent(data: GeneratePathData): Promise<any> {
    try {
      const { pathAgentHandler } = await import('../../agents/path-agent');
      const agentInput = this.buildPathAgentInput(data);
      const agentContext = { userId: data.userId };

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
            acceptanceCriteria: t.acceptanceCriteria || ''
          }))
        })),
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
              : (milestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: analysis.subject || '综合',
            status: 'active',
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: milestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(analysis),
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
              : (milestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: analysis.subject || '综合',
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: milestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(analysis),
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
          stages: JSON.stringify(milestonesData.map((m: any) => m.name) || []),
          milestones: JSON.stringify(milestonesData),
          subtasks: JSON.stringify(milestonesData.flatMap((m: any) => m.tasks || []) || []),
          aiAnalysis: JSON.stringify(analysis),
          feasibility: analysis.feasibility,
          difficulty: analysis.difficulty,
          recommendations: JSON.stringify(analysis.recommendations || [])
        }
      });

      for (let i = 0; i < milestonesData.length; i++) {
        const milestoneData = milestonesData[i];
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
        data: { totalMilestones: milestonesData.length }
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
      logger.info('开始 Anderson 后处理...', { userId: data.userId, pathId });

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

      logger.info('Anderson 后处理完成', {
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
      logger.warn('Anderson 后处理失败，路径保持可用', {
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
    const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';

    await this.recordPathGenerationStageLog({
      userId: data.userId,
      pathId: data.existingPathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'core',
      status: 'started',
      input: {
        goal: data.description,
        existingPathId: data.existingPathId || null
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
      const fullPath = await this.persistGeneratedPath(data, analysis, milestonesData);
      const duration = Date.now() - startTime;

      logger.info(`学习路径核心生成完成：${fullPath.id}`, {
        userId: data.userId,
        milestoneCount: milestonesData.length,
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
          milestoneCount: milestonesData.length,
          estimatedHours: fullPath.estimatedHours || analysis.estimatedTotalHours || 0
        }
      });

      await this.updatePathGenerationStatus(fullPath.id, {
        core: 'succeeded',
        enrichment: 'pending',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
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

      return {
        ...pathWithActualMinutes,
        summary: parsePathSummary(path.aiPromptTemplate),
        generationStatus: accessState.generationStatus,
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

      return {
        ...subtask,
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

      const totalMinutes = subtasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);

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
