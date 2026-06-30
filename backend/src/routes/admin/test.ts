/**
 * ???????????? API
 *
 * ???????????????
 */

import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import pathCoordinator, { type GoalPathRequest } from '../../coordinators/path.coordinator';
import { buildGoalPathVisibleSummary } from '../../services/learning/goal-path-visible-summary';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/admin/test/replay-path
 *
 * ?? Goal ?????????????????????????????????????????
 *
 * Body:
 *   goalConversationId: string  ?? Goal ?????? ID
 *   systemPromptOverride?: string ?? ????????? skill:path-planning ?? system prompt
 *
 * Returns:
 *   ??????? learning_path ?? id
 */
router.post('/replay-path', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { goalConversationId, systemPromptOverrides } = req.body || {};

    if (!goalConversationId || typeof goalConversationId !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: '??? goalConversationId ????' }
      });
    }

    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: goalConversationId }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: 'Goal ????????????' }
      });
    }

    let collectedData: any = {};
    try {
      collectedData = typeof conversation.collectedData === 'string'
        ? JSON.parse(conversation.collectedData)
        : conversation.collectedData || {};
    } catch {
      collectedData = {};
    }

    const rawGoal = conversation.description || collectedData?.understanding?.surface_goal || '?????????';

    const visibleSummary = buildGoalPathVisibleSummary({
      understanding: collectedData.understanding || {},
      confirmedProposal: collectedData.confirmedProposal || null,
      collected: collectedData.collected || {}
    });

    const messages = typeof conversation.messages === 'string'
      ? JSON.parse(conversation.messages || '[]')
      : conversation.messages || [];

    const conversationHistory = Array.isArray(messages)
      ? messages.map((m: any) => ({ role: m.role || 'user', content: m.content || '' }))
      : [];

    const pathRequest: GoalPathRequest = {
      userId,
      sourceConversationId: goalConversationId,
      source: 'goal',
      rawGoal,
      visibleSummary,
      conversationHistory,
      ...(systemPromptOverrides ? { systemPromptOverrides } : {})
    };

    logger.info('[admin-test] replay-path start', {
      userId,
      goalConversationId,
      rawGoal: rawGoal.slice(0, 80)
    });

    const pathResult = await pathCoordinator.generateFromGoal(pathRequest);

    const learningPathId = pathResult?.path?.id || pathResult?.id;

    logger.info('[admin-test] replay-path complete', {
      userId,
      goalConversationId,
      newPathId: learningPathId
    });

    res.json({
      success: true,
      data: {
        pathId: learningPathId,
        path: pathResult?.path || pathResult
      }
    });
  } catch (error: any) {
    logger.error('[admin-test] replay-path failed', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      success: false,
      error: { message: error?.message || '????????????' }
    });
  }
});

/**
 * GET /api/admin/test/compare-paths?pathA=xxx&pathB=yyy
 *
 * ???????????????????
 *
 * Returns:
 *   pathA, pathB ?? ??????????????????? milestones ?? subtasks??
 */
router.get('/compare-paths', async (req: Request, res: Response) => {
  try {
    const { pathA, pathB } = req.query;

    if (!pathA || !pathB || typeof pathA !== 'string' || typeof pathB !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: '??? pathA ?? pathB ????' }
      });
    }

    const [pathDataA, pathDataB] = await Promise.all([
      prisma.learning_paths.findUnique({
        where: { id: pathA },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: { orderBy: { order: 'asc' } }
            }
          }
        }
      }),
      prisma.learning_paths.findUnique({
        where: { id: pathB },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: { orderBy: { order: 'asc' } }
            }
          }
        }
      })
    ]);

    if (!pathDataA) {
      return res.status(404).json({
        success: false,
        error: { message: `?? ${pathA} ??????` }
      });
    }

    if (!pathDataB) {
      return res.status(404).json({
        success: false,
        error: { message: `?? ${pathB} ??????` }
      });
    }

    res.json({
      success: true,
      data: {
        pathA: pathDataA,
        pathB: pathDataB
      }
    });
  } catch (error: any) {
    logger.error('[admin-test] compare-paths failed', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      success: false,
      error: { message: error?.message || '?????????????' }
    });
  }
});

/**
 * GET /api/admin/test/agent-prompts/:agentId/versions
 *
 * ?????? agent ?????? prompt ???
 */
router.get('/agent-prompts/:agentId/versions', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: { message: '??? agentId ????' }
      });
    }

    const acceptableIds = [agentId];
    if (agentId.startsWith('skill:')) {
      acceptableIds.push(agentId.replace(':', '.'));
    }

    const versions = await systemPrisma.agent_prompts.findMany({
      where: {
        agentId: { in: acceptableIds }
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        agentId: true,
        version: true,
        status: true,
        name: true,
        description: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        model: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: { versions }
    });
  } catch (error: any) {
    logger.error('[admin-test] get-prompt-versions failed', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      success: false,
      error: { message: error?.message || '?????????' }
    });
  }
});

export default router;
