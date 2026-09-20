/**
 * 路径生成主流程（core）（架构审计 §5 行动 #2：learning.service.ts 拆分——生成域）
 *
 * 职责：path-agent 分析（含定帧输入与学习者证据注入）→ 路径评审（path-reviewer，
 * best-effort 含一次自动重规划）→ 骨架落库（persistGeneratedPath，建 stageDesign 排队 run）
 * → generateLearningPath 入口（占位路径 + core run + 后台 enrichment 派发），
 * 以及 core 重试的原子认领（claimPathCoreGeneration）与主动失败标记（markActiveGenerationFailed）。
 * 行为与拆分前 learning.service 同名方法逐一等价。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import { executeSkill } from '../../../skills';
import { pathAgentDefinition } from '../../../skills/path-planning';
import { pathReviewerDefinition } from '../../../skills/path-reviewer';
import type { AgentInput } from '../../../agents/protocol';
import { normalizeAgentOutput } from '../../../agents/output-normalizer';
import { buildFramedNormalizedInput } from '../path-planning-hints';
import { normalizePathDifficulty } from '../path-difficulty';
import { buildPathReviewerGoalContext } from '../path-reviewer-context';
import {
  assertGenerationRunFence,
  PATH_GENERATION_LEASE_MS,
  type PathGenerationRollbackSnapshotV1,
} from '../path-generation-status';
import { assertPathMutationSafe, isPathMutationConflictError } from '../path-mutation-safety';
import {
  buildGoalToPathHandoffSnapshot,
  buildNormalizedPathInputSnapshot,
  buildSceneSummaryFromFraming,
  cleanPathTitle,
  getSceneFramingFallbackDomain,
  getSceneFramingNormalizedInput,
  inferMilestoneConceptFromTasks,
  normalizePathTaskType,
  normalizeStringArray,
  parsePathPromptTemplate,
  resolveMilestoneConcept,
  resolvePathSubject,
  slugifyConceptId,
} from '../learning.helpers';
import type {
  GeneratePathData,
  PathAdjustmentEvidence,
  PathAdjustmentPolicy,
  PathCognitiveConcept,
  PathCognitiveDesign,
  PathSceneFraming,
  NormalizedPathTask,
  NormalizedPathMilestone,
} from '../learning.types';
import { createDomainEvent } from '../../../events/contracts';
import { enqueueDomainEvent } from '../../../events/outbox.repository';
import { learnerSnapshotRefreshService } from '../../learner/LearnerSnapshotRefreshService';
import { learnerProjectionService } from '../../learner/LearnerProjectionService';
import { dashboardGuidanceSnapshotService } from '../../learner/DashboardGuidanceSnapshotService';
import { runBackgroundTask } from '../../background-task-tracker.service';
import { getLearningPath } from '../queries/path-views.queries';
import {
  createAndClaimGenerationRun,
  createGenerationId,
  failGenerationRun,
  getActiveGenerationRun,
  heartbeatGenerationRun,
  recordPathGenerationStageLog,
  restorePathAfterMutationConflict,
  startGenerationHeartbeat,
  updatePathGenerationStatus,
} from './run-lifecycle';
import { enrichLearningPathWithAnderson } from './stage-enrichment';

function normalizeCognitiveDesign(
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
    ...(candidate?.prerequisiteTree ? { prerequisiteTree: candidate.prerequisiteTree } : {}),
    ...(candidate?.loadProfile ? { loadProfile: candidate.loadProfile } : {}),
  };
}


function normalizeMilestoneTasks(
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


function normalizeMilestonesWithConcepts(milestonesData: any[], cognitiveDesign: PathCognitiveDesign): NormalizedPathMilestone[] {
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
    const tasks = normalizeMilestoneTasks(milestone?.tasks || [], conceptIds).map((task) => ({
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

function buildPathCognitiveDesign(data: GeneratePathData, analysis: any): PathCognitiveDesign {
  const sceneFraming = (analysis?.sceneFraming as PathSceneFraming | undefined)
    || (data.userProfile?.pathSceneFraming as PathSceneFraming | undefined);
  const generatedCognitiveDesignRaw = analysis?.cognitiveCore || analysis?.cognitiveDesign;
  const generatedCognitiveDesign = generatedCognitiveDesignRaw && typeof generatedCognitiveDesignRaw === 'object'
    ? generatedCognitiveDesignRaw
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

  return normalizeCognitiveDesign(
    {
      cognitiveDomain: typeof generatedCognitiveDesign?.cognitiveDomain === 'string' && generatedCognitiveDesign.cognitiveDomain.trim()
        ? generatedCognitiveDesign.cognitiveDomain.trim()
        : getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
      coreConcepts: generatedCoreConcepts,
      prerequisiteTree: (generatedCognitiveDesign as any)?.prerequisiteTree ?? undefined,
      loadProfile: (generatedCognitiveDesign as any)?.loadProfile ?? undefined,
    },
    getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
    focusSource,
  );
}


function buildPathAdjustmentPolicy(): PathAdjustmentPolicy {
  return {
    allowedModes: ['expand', 'compress', 'replan'],
    recommendedMode: null,
    triggerSource: null,
  };
}


function buildPathAdjustmentEvidence(data: GeneratePathData): PathAdjustmentEvidence | null {
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

function buildPathAgentInput(data: GeneratePathData): AgentInput {
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
      goalFinalPayload: data.userProfile?.goalFinalPayload || null,
      normalizedInput: data.userProfile?.normalizedInput || null,
      conversationHistory: Array.isArray(data.userProfile?.conversationHistory) ? data.userProfile.conversationHistory : [],
    }
  };
}


async function analyzePathWithAgent(data: GeneratePathData): Promise<any> {
  try {
    const agentInput = buildPathAgentInput(data);
    const agentContext: any = {
      userId: data.userId,
      metadata: data.systemPromptOverrides?.pathAgent
        ? { pathAgentSystemPromptOverride: data.systemPromptOverrides.pathAgent }
        : undefined
    };

    // path 输入定帧：skill:path-scene-framing 已移除（LLM 环节信息零增量、输出被 seed 覆盖），
    // normalizedInput 由确定性 buildFramedNormalizedInput 清洗并附加 planningHints。
    // API/裸输入模式（无结构化 normalizedInput）用最小兜底结构，保证 planningHints 不缺失。
    const framedNormalizedInput = buildFramedNormalizedInput(data.userProfile?.normalizedInput || null)
      || buildFramedNormalizedInput({
        version: '1.0',
        learnerProfile: { surfaceGoal: data.description },
        problemSpace: { realProblem: data.description },
        resources: { timeBudget: data.userProfile?.timePerDay || null },
      });
    if (framedNormalizedInput) {
      // 学习者学习证据回注（仅新建路径）：同一个学习者第二次建路径时，之前踩过的坑要影响首版难度，
      // 否则首版是"盲排"。无学习历史 → 不注入（冷启动行为不变）。best-effort，失败不影响生成。
      try {
        const snapshot = await learnerSnapshotRefreshService.refresh({
          userId: data.userId,
          scope: 'global',
        });
        const planningProjection = learnerProjectionService.toPlanningProjection(snapshot);
        if (planningProjection) {
          framedNormalizedInput.learnerLearningContext = planningProjection;
          logger.info('[path-generation] 注入学习者学习证据（首版难度校准）', {
            userId: data.userId,
            fragile: planningProjection.fragileConcepts.length,
            struggling: planningProjection.strugglingConcepts.length,
            blocked: planningProjection.blockedFoundations.length,
          });
        }
      } catch (error) {
        logger.warn('[path-generation] 学习者学习证据注入失败（按盲排生成）', {
          userId: data.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      data.userProfile = {
        ...(data.userProfile || {}),
        normalizedInput: framedNormalizedInput,
      };
      agentInput.metadata = {
        ...(agentInput.metadata || {}),
        normalizedInput: framedNormalizedInput,
      };
    }

    const agentResult = await executeSkill(pathAgentDefinition, {
      input: agentInput,
      context: agentContext,
    });

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
      difficulty: normalizePathDifficulty(data.userProfile?.skillLevel),
      estimatedTotalHours: path.estimatedHours || 0,
      // AI 生成的路径简短摘要（path-planning 输出），随 aiPromptTemplate 持久化，
      // 供列表接口 parsePathSummary 读取、前端卡片展示
      summary: typeof path.summary === 'string' && path.summary.trim() ? path.summary.trim() : null,
      sceneFraming: framedNormalizedInput ? { normalizedInput: framedNormalizedInput } : null,
      sceneFramingRaw: null,
      sceneFramingInput: null,
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
      cognitiveCore: path.cognitiveCore || path.cognitiveDesign,
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


async function persistGeneratedPath(data: GeneratePathData, analysis: any, milestonesData: any[], runId?: string) {
  const cognitiveDesign = buildPathCognitiveDesign(data, analysis);
  const normalizedMilestonesData = normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
  const adjustmentPolicy = buildPathAdjustmentPolicy();
  const adjustmentEvidence = buildPathAdjustmentEvidence(data);
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
      cognitiveCore: cognitiveDesign,
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

  // subject 兜底：path-planning 的 analysis.subject 可能是目标原文（其 analyzeInput 用 input.goal），
  // 过长会污染教学 prompt / 管理端列表 / Dashboard 副标题，超阈值时用清洗后的路径名兜底。
  const pathTitle = cleanPathTitle(analysis.pathName || `${analysis.subject || '个性化'}学习路径`);
  const pathSubject = resolvePathSubject(analysis.subject, pathTitle);

  const learningPath = await withTransaction(async (tx) => {
    let path;
    if (data.existingPathId) {
      if (!runId) throw new Error('GENERATION_RUN_REQUIRED');
      await assertGenerationRunFence(tx, data.existingPathId, runId);
      const lockedPath = await tx.learning_paths.updateMany({
        where: { id: data.existingPathId, activeGenerationRunId: runId },
        data: { updatedAt: new Date() }
      });
      if (lockedPath.count !== 1) throw new Error('GENERATION_RUN_FENCED');
      await assertPathMutationSafe(tx, data.existingPathId, 'replace-path', {
        allowCompleted: (data.userProfile as any)?.replan?.forceReplace === true,
      });
      path = await tx.learning_paths.update({
        where: { id: data.existingPathId },
        data: {
          title: pathTitle,
          name: pathTitle,
          description: (data.description && !data.description.includes('\uFFFD'))
            ? data.description
            : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
          subject: pathSubject,
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

      // G1 数据质量修复（孤儿清理）：重建里程碑前清除本路径旧 run 遗留的 stage items。
      // path_generation_stage_items.milestoneId 无 FK（schema 仅 cascade runId），
      // 旧 run 的 stage items 在 milestones.deleteMany 后 milestoneId 悬空成孤儿。
      // 仅清理非当前 run 的 items；当前 core run 不产 stage items，stageDesign run 才会。
      await tx.path_generation_stage_items.deleteMany({
        where: {
          run: { learningPathId: path.id },
          ...(runId ? { runId: { not: runId } } : {})
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
          title: pathTitle,
          name: pathTitle,
          description: (data.description && !data.description.includes('\uFFFD'))
            ? data.description
            : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
          subject: pathSubject,
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

      const stageRunId = createGenerationId('pgr');
      const stageRollbackSnapshot: PathGenerationRollbackSnapshotV1 = {
        version: 1,
        path: {
          activeGenerationRunId: runId,
          aiPromptTemplate: path.aiPromptTemplate,
          status: path.status,
          restoreStatus: false
        },
        supersededRun: null
      };
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
          rollbackSnapshot: JSON.stringify(stageRollbackSnapshot),
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

  return getLearningPath(learningPath.id);
}


async function generateLearningPathCore(data: GeneratePathData) {
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
      ? await getActiveGenerationRun(data.existingPathId, data.generationRunId)
      : null
    : null;
  if (data.existingPathId && (!coreRun || coreRun.status !== 'processing')) {
    throw new Error(data.generationRunId ? 'GENERATION_RUN_FENCED' : 'GENERATION_RUN_REQUIRED');
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
    ? startGenerationHeartbeat(data.existingPathId, coreRunId)
    : null;

  await recordPathGenerationStageLog({
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
    await updatePathGenerationStatus(data.existingPathId, {
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
    let analysis = await analyzePathWithAgent(data);
    // 路径评审（CIDDP 五维度）：best-effort，不阻断路径生成
    let pathReview: any = null;
    try {
      const reviewResult = await executeSkill(pathReviewerDefinition, {
        pathPlan: {
          name: analysis.pathName,
          summary: analysis.summary,
          cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign,
          milestones: analysis.suggestedMilestones,
          estimatedHours: analysis.estimatedTotalHours,
        },
        // 目标上下文（含 successCriteria——yaml 声明且 Practicality 评分要用，此前漏传，§3.19 P1⑥）
        goalContext: buildPathReviewerGoalContext({
          description: (data as any).description,
          confirmedProposal: (data as any).confirmedProposal,
          learnerProfile: (data as any).userProfile?.learnerProfile,
          analysis,
        }),
        prerequisiteTree: ((analysis.cognitiveCore || analysis.cognitiveDesign) as any)?.prerequisiteTree,
      });
      if (reviewResult?.success && reviewResult?.output) {
        pathReview = reviewResult.output;
        if (pathReview.passed === false && pathReview.replanInstructions) {
          logger.info('[path-reviewer] 路径未通过评审，触发一次自动重规划', {
            score: pathReview.score,
            replanInstructions: pathReview.replanInstructions,
          });
          try {
            const replanData: GeneratePathData = {
              ...data,
              source: 'replan',
              mode: 'replan',
              userProfile: {
                ...(data.userProfile || {}),
                replan: {
                  ...(data.userProfile?.replan || {}),
                  triggerSource: 'path-reviewer',
                  reviewerFeedback: pathReview.replanInstructions,
                },
              },
            };
            const replannedAnalysis = await analyzePathWithAgent(replanData);
            if (replannedAnalysis?.suggestedMilestones?.length) {
              analysis = replannedAnalysis;
              pathReview = { ...pathReview, replanned: true };
              logger.info('[path-reviewer] 自动重规划完成，采用重规划结果', {
                score: pathReview.score,
                replanInstructions: pathReview.replanInstructions,
              });
            } else {
              logger.warn('[path-reviewer] 重规划结果为空，保留原路径', { score: pathReview.score });
            }
          } catch (replanError) {
            logger.warn('[path-reviewer] 自动重规划失败（best-effort，保留原路径）', {
              error: replanError instanceof Error ? replanError.message : String(replanError),
            });
          }
        }
      }
    } catch (reviewError) {
      logger.warn('[path-reviewer] 评审调用失败（best-effort，不阻断生成）', {
        error: reviewError instanceof Error ? reviewError.message : String(reviewError),
      });
    }
    if (data.existingPathId && coreRunId) {
      await heartbeatGenerationRun(data.existingPathId, coreRunId, { progress: 50 });
    }

    if (!analysis) {
      throw new Error('PATH_GENERATION_FAILED: empty analysis');
    }

    if (!analysis.suggestedMilestones || analysis.suggestedMilestones.length === 0) {
      throw new Error('PATH_GENERATION_FAILED: suggestedMilestones is empty');
    }

    const milestonesData = analysis.suggestedMilestones || [];
    const cognitiveDesign = buildPathCognitiveDesign(data, analysis);
    const normalizedMilestonesData = normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
    const fullPath = await persistGeneratedPath(data, {
      ...analysis,
      cognitiveDesign,
      pathReview,
    }, normalizedMilestonesData, coreRunId);
    const duration = Date.now() - startTime;
    const sceneSummary = buildSceneSummaryFromFraming(
      analysis.sceneFraming || data.userProfile?.pathSceneFraming || null,
      normalizedMilestonesData.length,
      normalizedMilestonesData.reduce((sum: number, milestone: any) => sum + ((milestone?.tasks || []).length), 0)
    );

      logger.info(`学习路径核心生成完成：${fullPath.id}`, {
        userId: data.userId,
        milestoneCount: normalizedMilestonesData.length,
        durationMs: duration
      });

    await recordPathGenerationStageLog({
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
      const persistedTemplate = parsePathPromptTemplate(fullPath.aiPromptTemplate || null);
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
    if (data.existingPathId && coreRunId) {
      if (isPathMutationConflictError(error)) {
        await restorePathAfterMutationConflict(data.existingPathId, coreRunId, error);
        throw error;
      }
      if (!data.createdPlaceholder) {
        await restorePathAfterMutationConflict(data.existingPathId, coreRunId, error, {
          runStatus: 'failed',
          retryAllowed: true,
          errorCode: 'PATH_GENERATION_CORE_FAILED'
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.error('生成学习路径失败', {
      error: error?.message || String(error),
      stack: error?.stack,
      userId: data.userId,
      goal: data.description,
      durationMs: duration
    });

    await recordPathGenerationStageLog({
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

    if (data.existingPathId && data.createdPlaceholder) {
      try {
        await updatePathGenerationStatus(data.existingPathId, {
          core: 'failed',
          lastError: error?.message || String(error),
          sourceConversationId: data.sourceConversationId || null,
          triggerSource,
          updatedAt: new Date().toISOString()
        }, coreRunId);
        if (coreRunId) {
          await failGenerationRun(
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
export async function generateLearningPath(data: GeneratePathData) {
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
        difficulty: normalizePathDifficulty(data.userProfile?.skillLevel),
        estimatedHours: 0,
        aiGenerated: true,
        deadline: data.deadline || null,
        deadlineText: data.deadlineText || null,
        updatedAt: new Date()
      }
    });
    const run = await createAndClaimGenerationRun(placeholder.id, 'core', null, 0, undefined, null);
    generationData = {
      ...data,
      existingPathId: placeholder.id,
      generationRunId: run.id,
      createdPlaceholder: true
    };
  }

  const { fullPath, analysis } = await generateLearningPathCore(generationData);

  const stageRunId = fullPath.activeGenerationRunId;
  if (!stageRunId) throw new Error('GENERATION_RUN_REQUIRED');
  runBackgroundTask(
    'learning.path.stage-enrichment',
    () => enrichLearningPathWithAnderson(fullPath.id, stageRunId, generationData, analysis),
    { pathId: fullPath.id, runId: stageRunId, userId: generationData.userId }
  );
  dashboardGuidanceSnapshotService.refreshInBackground(generationData.userId, 'path-created');

  return fullPath;
}


export async function claimPathCoreGeneration(
  pathId: string,
  expectedActiveGenerationRunId?: string | null,
  options: { allowCompleted?: boolean } = {}
): Promise<string> {
  const run = await createAndClaimGenerationRun(
    pathId,
    'core',
    'core',
    0,
    'replace-path',
    expectedActiveGenerationRunId,
    options.allowCompleted ? { allowCompleted: true } : {}
  );
  return run.id;
}


export async function markActiveGenerationFailed(pathId: string, error: unknown, runId?: string): Promise<void> {
  const path = await prisma.learning_paths.findUnique({
    where: { id: pathId },
    select: { activeGenerationRunId: true }
  });
  const activeRunId = runId || path?.activeGenerationRunId;
  if (!activeRunId || path?.activeGenerationRunId !== activeRunId) return;
  const run = await getActiveGenerationRun(pathId, activeRunId);
  if (!run || run.status === 'failed' || run.status === 'succeeded' || run.status === 'cancelled') return;

  try {
    await updatePathGenerationStatus(pathId, run.phase === 'stageDesign'
      ? { stageDesign: 'failed', lastError: error instanceof Error ? error.message : String(error) }
      : { core: 'failed', lastError: error instanceof Error ? error.message : String(error) }, activeRunId);
    await failGenerationRun(
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

