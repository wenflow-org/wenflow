/**
 * 自动驾驶运行面 · Path 评审与状态（2026-10-24 架构优化批 1：assisted-runtime.ts 再拆分迁出，
 * 处理器逐字未改）。由 assisted-runtime.ts 在同一个 router 实例上按原顺序调用注册。
 */
import type { Router, Request } from 'express';
import { logger } from '../../utils/logger';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import learningService from '../../services/learning/learning.service';
import { findSessionById } from '../../services/virtual-lab/virtual-session.repo';
import { sendVirtualSessionError } from './virtual-session-http';
import { runAssistedSessionMutation } from './virtual-learners.assisted-shared';
import { parseLearningProgress, parseStoryContext } from './virtual-learners.projections';

export function registerAssistedPathRoutes(router: Router): void {
// ===== 原 virtual-learners.ts L2696–L3164 =====
router.post('/sessions/:sessionId/review-path', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.reviewPathProposal(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('Path 评审失败:', error);
    sendVirtualSessionError(res, error, 'Path 评审失败');
  }
});

/**
 * 人工确认接受评审结论（decision=accept 且评审对应当前 Path）。只改评审状态，不启动 Learn。
 * POST /api/admin/virtual-learners/sessions/:sessionId/accept-path
 */
router.post('/sessions/:sessionId/accept-path', async (req: Request, res) => {
  try {
    // force=true：运维强制接受当前 Path（评审为旁路，modify/reject 时不得堵死后续学习）
    const force = req.body?.force === true;
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.acceptPathReview(req.params.sessionId, { force })
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('接受 Path 失败:', error);
    sendVirtualSessionError(res, error, '接受 Path 失败');
  }
});

/**
 * 人工触发：按评审意见重规划 Path（评审保持 pending 直到人工决定）。
 * POST /api/admin/virtual-learners/sessions/:sessionId/replan-path
 */
router.post('/sessions/:sessionId/replan-path', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.replanPathFromReview(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('重规划 Path 失败:', error);
    sendVirtualSessionError(res, error, '重规划 Path 失败');
  }
});

/**
 * 查询路径生成状态（前端轮询用）
 * GET /api/admin/virtual-sessions/:sessionId/path-status
 */
router.get('/sessions/:sessionId/path-status', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;

    const session = await findSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    if (!session.learningPathId) {
      return res.json({
        success: true,
        data: {
          status: session.currentStage === 'path' ? 'generating' : 'not_started',
          learningPathId: null,
          path: null,
          pathContext: null
        }
      });
    }

    const learningPath = await learningService.getLearningPath(session.learningPathId);

    if (!learningPath) {
      return res.json({
        success: true,
        data: {
          status: 'not_found',
          learningPathId: session.learningPathId,
          path: null,
          pathContext: null
        }
      });
    }

    const storyContext = parseStoryContext(session);
    const learningProgress = parseLearningProgress(session);
    const firstMilestone = learningPath.milestones?.[0] || null;
    const firstTask = firstMilestone?.subtasks?.[0] || null;
    const activeTask = learningPath.milestones
      ?.flatMap((milestone, milestoneIndex: number) => (milestone.subtasks || []).map((task, taskIndex: number) => ({
        ...task,
        milestone,
        milestoneIndex,
        taskIndex
      })))
      ?.find((task) => task.id === learningProgress.currentTaskId)
      || null;
    const contextTask = activeTask || firstTask;
    const contextMilestone = activeTask?.milestone || firstMilestone;
    const pathContext = {
      storyContext,
      pathTitle: learningPath.title,
      pathSummary: learningPath.summary || learningPath.description || learningPath.aiPromptTemplate || null,
      subject: learningPath.subject || null,
      currentStageNumber: learningProgress.currentMilestone !== undefined && learningProgress.currentMilestone !== null
        ? Number(learningProgress.currentMilestone) + 1
        : (contextMilestone?.stageNumber || 1),
      currentTaskOrder: learningProgress.currentTaskIdx !== undefined && learningProgress.currentTaskIdx !== null
        ? Number(learningProgress.currentTaskIdx) + 1
        : (contextTask?.order || 1),
      taskProfile: contextTask ? {
        knowledgeType: contextTask.knowledgeType || null,
        cognitiveLevel: contextTask.cognitiveLevel || null,
        displayLabel: contextTask.displayLabel || null,
        coreConcept: contextTask.coreConcept || null,
        learningObjectives: Array.isArray(contextTask.learningObjectives)
          ? contextTask.learningObjectives
          : typeof contextTask.learningObjectives === 'string' && contextTask.learningObjectives.trim()
            ? contextTask.learningObjectives.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
            : [],
        linkedConceptName: contextTask.linkedConceptName || contextTask.coreConcept || null,
      } : null,
      currentMilestoneTitle: contextMilestone?.title || null,
      currentTaskTitle: contextTask?.title || null,
      taskKnowledgeScope: null,
      cognitiveFrame: null,
      teachingStrategyGuidance: null
    };

    // 路径生成重试信号（新发现问题 #2）：让跑数 harness 能把「生成失败」与「还没好」区分开，
    // 失败时立即止损而不是空等 readyTimeoutMs，并在允许时触发有界自愈重试。
    // 与用户侧 PATCH /paths/:pathId/retry 同源（learningService.getPathGenerationRetry）。
    let pathGeneration: {
      pathId: string;
      status: string;
      retryAllowed: boolean;
      retryType: 'core' | 'stageDesign' | null;
      reason: string;
    } | null = null;
    try {
      const retry = await learningService.getPathGenerationRetry(learningPath.id, session.userId);
      pathGeneration = {
        pathId: learningPath.id,
        status: learningPath.status,
        retryAllowed: retry.allowed,
        retryType: retry.retryType,
        reason: retry.reason
      };
    } catch (retryError) {
      logger.warn('[virtual-learners] path-status 读取生成重试状态失败', {
        sessionId,
        learningPathId: learningPath.id,
        error: (retryError as Error).message
      });
    }

    res.json({
      success: true,
      data: {
        status: learningPath.status,
        learningPathId: learningPath.id,
        path: {
          id: learningPath.id,
          title: learningPath.title,
          name: learningPath.name,
          summary: learningPath.summary || null,
          description: learningPath.description,
          subject: learningPath.subject,
          difficulty: learningPath.difficulty,
          estimatedHours: learningPath.estimatedHours,
          totalMilestones: learningPath.totalMilestones,
          completedMilestones: learningPath.completedMilestones,
          status: learningPath.status,
          aiGenerated: learningPath.aiGenerated,
          generationStatus: learningPath.generationStatus || null,
          sceneSummary: learningPath.sceneSummary || null,
          cognitiveDesign: learningPath.cognitiveDesign || null,
          adjustmentPolicy: learningPath.adjustmentPolicy || null,
          adjustmentEvidence: learningPath.adjustmentEvidence || null,
          canStartLearning: learningPath.canStartLearning,
          learningBlockedReason: learningPath.learningBlockedReason || null,
          replanLineage: learningPath.replanLineage || null,
          createdAt: learningPath.createdAt,
          updatedAt: learningPath.updatedAt,
          milestones: learningPath.milestones,
          stages: learningPath.stages || learningPath.milestones,
          totalStages: learningPath.totalStages || learningPath.totalMilestones,
          // 路径体量（goal 层 scope_size 决定）：供前端展示体量徽章 + 里程碑/子任务目标
          planningHints: (learningPath as any).processDetail?.framing?.normalizedInput?.planningHints ?? null
        },
        pathGeneration,
        pathContext
      }
    });
  } catch (error) {
    logger.error('查询路径状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '查询路径状态失败'
    });
  }
});

/**
 * 触发失败的路径生成重试（虚拟实验室自愈入口）。
 * POST /api/admin/virtual-learners/sessions/:sessionId/retry-path-generation
 *
 * 平台既有用户侧重试（PATCH /paths/:pathId/retry）要求 path 属主本人令牌；harness 持管理员
 * 会话，故此处用**模拟会话自身的 userId** 复用同一 learningService 重试逻辑（core / stageDesign）。
 * 有界次数由调用方（harness）控制；单次是否可重试仍由 getPathGenerationRetry 守卫。
 */
router.post('/sessions/:sessionId/retry-path-generation', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.retryPathGeneration(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('重试路径生成失败:', error);
    sendVirtualSessionError(res, error, '重试路径生成失败');
  }
});
}
