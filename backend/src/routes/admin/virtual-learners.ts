/**
 * Admin Virtual Learners API
 * 
 * 虚拟用户模拟管理接口
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import simulationOrchestrator from '../../orchestrators/simulation.orchestrator';
import { getGateway } from '../../gateway';
import type { SimulationAgentInput } from '../../agents/virtual-learner-simulation-agent/types';

const router = express.Router();
const VIRTUAL_USER_PASSWORD = 'VirtualTest123';

router.use(authMiddleware);

/**
 * AI生成画像
 * POST /api/admin/virtual-learners/generate-profile
 */
router.post('/generate-profile', async (req: any, res) => {
  try {
    const { learningGoal, knowledgeLevel, simulationMode, personalityTraits } = req.body;
    
    if (!learningGoal || !knowledgeLevel) {
      return res.status(400).json({
        success: false,
        error: '学习目标和知识水平不能为空'
      });
    }
    
    logger.info('[generate-profile] 开始生成画像', { learningGoal, knowledgeLevel });
    
    const gateway = getGateway();
    const agentInput = {
      type: 'custom' as const,
      goal: `生成学习目标为"${learningGoal}"的虚拟用户画像`,
      metadata: {
        simulationType: 'generate_profile',
        generateProfileInput: {
          learningGoal,
          knowledgeLevel,
          simulationMode,
          personalityTraits
        }
      }
    };
    
    const result = await gateway.executeAgent({
      agentId: 'virtual-learner-simulation-agent',
      input: agentInput,
      context: {
        userId: req.user?.userId,
        metadata: { source: 'admin-generate-profile' }
      }
    });
    
    logger.info('[generate-profile] Gateway返回', { result: JSON.stringify(result).substring(0, 1000) });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error?.message || 'AI生成画像失败'
      });
    }
    
    if (!result.output) {
      return res.status(500).json({
        success: false,
        error: 'AI生成画像失败：未返回输出'
      });
    }
    
    const output = result.output as any;
    if (!output.generatedProfile) {
      return res.status(500).json({
        success: false,
        error: 'AI生成画像失败：未返回画像数据'
      });
    }
    
    logger.info('AI生成画像成功', {
      userId: req.user?.userId,
      learningGoal,
      generatedProfile: output.generatedProfile
    });
    
    res.json({
      success: true,
      data: output.generatedProfile
    });
  } catch (error: any) {
    logger.error('AI生成画像失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成画像失败'
    });
  }
});

/**
 * 创建虚拟用户
 * POST /api/admin/virtual-learners
 */
router.post('/', async (req: any, res) => {
  try {
    const {
      name,
      profile,
      learningGoal,
      knowledgeLevel,
      knownConcepts,
      struggleConcepts,
      simulationMode,
      simulationPrompt,
      simulationModel,
      simulationTemperature,
      personalityTraits,
      tags,
      notes
    } = req.body;
    
    if (!name || !learningGoal) {
      return res.status(400).json({
        success: false,
        error: '名称和学习目标不能为空'
      });
    }
    
    const email = `virtual_${uuidv4().substring(0, 8)}@test.local`;
    const hashedPassword = await bcrypt.hash(VIRTUAL_USER_PASSWORD, 10);
    
    const user = await prisma.users.create({
      data: {
        id: uuidv4(),
        email,
        name,
        password: hashedPassword,
        role: 'user',
        currentLevel: knowledgeLevel || 'beginner',
        isAdmin: false,
        updatedAt: new Date()
      }
    });
    
    await prisma.student_baselines.create({
      data: {
        id: uuidv4(),
        userId: user.id,
        totalXp: 0,
        totalTime: 0,
        totalTasks: 0,
        completedTasks: 0,
        avgRating: 0,
        streakDays: 0
      }
    });
    
    const virtualProfile = await prisma.virtual_learner_profiles.create({
      data: {
        id: uuidv4(),
        userId: user.id,
        profile: JSON.stringify(profile || {}),
        learningGoal,
        knowledgeLevel: knowledgeLevel || 'beginner',
        knownConcepts: knownConcepts ? JSON.stringify(knownConcepts) : null,
        struggleConcepts: struggleConcepts ? JSON.stringify(struggleConcepts) : null,
        simulationMode: simulationMode || 'manual',
        simulationPrompt,
        simulationModel,
        simulationTemperature: simulationTemperature || 0.8,
        personalityTraits: personalityTraits ? JSON.stringify(personalityTraits) : null,
        tags: tags ? JSON.stringify(tags) : null,
        notes
      }
    });
    
    logger.info('创建虚拟用户成功', {
      userId: user.id,
      email,
      name,
      createdBy: req.user?.userId
    });
    
    res.json({
      success: true,
      data: {
        ...virtualProfile,
        email,
        password: VIRTUAL_USER_PASSWORD,
        profile: JSON.parse(virtualProfile.profile),
        knownConcepts: virtualProfile.knownConcepts ? JSON.parse(virtualProfile.knownConcepts) : [],
        struggleConcepts: virtualProfile.struggleConcepts ? JSON.parse(virtualProfile.struggleConcepts) : [],
        personalityTraits: virtualProfile.personalityTraits ? JSON.parse(virtualProfile.personalityTraits) : {},
        tags: virtualProfile.tags ? JSON.parse(virtualProfile.tags) : []
      }
    });
  } catch (error: any) {
    logger.error('创建虚拟用户失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建虚拟用户失败'
    });
  }
});

/**
 * 获取虚拟用户列表
 * GET /api/admin/virtual-learners
 */
router.get('/', async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    
    const [profiles, total] = await Promise.all([
      prisma.virtual_learner_profiles.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true,
              currentLevel: true,
              createdAt: true
            }
          },
          sessions: {
            select: {
              id: true,
              status: true,
              currentStage: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          }
        }
      }),
      prisma.virtual_learner_profiles.count()
    ]);
    
    const formattedProfiles = profiles.map(p => ({
      ...p,
      email: p.users.email,
      userName: p.users.name,
      password: VIRTUAL_USER_PASSWORD,
      profile: JSON.parse(p.profile || '{}'),
      knownConcepts: p.knownConcepts ? JSON.parse(p.knownConcepts) : [],
      struggleConcepts: p.struggleConcepts ? JSON.parse(p.struggleConcepts) : [],
      personalityTraits: p.personalityTraits ? JSON.parse(p.personalityTraits) : {},
      tags: p.tags ? JSON.parse(p.tags) : [],
      sessionCount: p.sessions.length
    }));
    
    res.json({
      success: true,
      data: {
        profiles: formattedProfiles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户列表失败'
    });
  }
});

/**
 * 获取虚拟用户详情
 * GET /api/admin/virtual-learners/:id
 */
router.get('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            currentLevel: true
          }
        },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    res.json({
      success: true,
      data: {
        ...profile,
        email: profile.users.email,
        userName: profile.users.name,
        password: VIRTUAL_USER_PASSWORD,
        profile: JSON.parse(profile.profile || '{}'),
        knownConcepts: profile.knownConcepts ? JSON.parse(profile.knownConcepts) : [],
        struggleConcepts: profile.struggleConcepts ? JSON.parse(profile.struggleConcepts) : [],
        personalityTraits: profile.personalityTraits ? JSON.parse(profile.personalityTraits) : {},
        tags: profile.tags ? JSON.parse(profile.tags) : []
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟用户详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户详情失败'
    });
  }
});

/**
 * 更新虚拟用户画像
 * PUT /api/admin/virtual-learners/:id
 */
router.put('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    const updateData: any = {};
    
    if (req.body.profile) updateData.profile = JSON.stringify(req.body.profile);
    if (req.body.learningGoal) updateData.learningGoal = req.body.learningGoal;
    if (req.body.knowledgeLevel) updateData.knowledgeLevel = req.body.knowledgeLevel;
    if (req.body.knownConcepts) updateData.knownConcepts = JSON.stringify(req.body.knownConcepts);
    if (req.body.struggleConcepts) updateData.struggleConcepts = JSON.stringify(req.body.struggleConcepts);
    if (req.body.simulationMode) updateData.simulationMode = req.body.simulationMode;
    if (req.body.simulationPrompt) updateData.simulationPrompt = req.body.simulationPrompt;
    if (req.body.simulationModel) updateData.simulationModel = req.body.simulationModel;
    if (req.body.simulationTemperature) updateData.simulationTemperature = req.body.simulationTemperature;
    if (req.body.personalityTraits) updateData.personalityTraits = JSON.stringify(req.body.personalityTraits);
    if (req.body.tags) updateData.tags = JSON.stringify(req.body.tags);
    if (req.body.notes) updateData.notes = req.body.notes;
    
    const updated = await prisma.virtual_learner_profiles.update({
      where: { id },
      data: updateData
    });
    
    res.json({
      success: true,
      data: {
        ...updated,
        profile: JSON.parse(updated.profile || '{}'),
        knownConcepts: updated.knownConcepts ? JSON.parse(updated.knownConcepts) : [],
        struggleConcepts: updated.struggleConcepts ? JSON.parse(updated.struggleConcepts) : [],
        personalityTraits: updated.personalityTraits ? JSON.parse(updated.personalityTraits) : {},
        tags: updated.tags ? JSON.parse(updated.tags) : []
      }
    });
  } catch (error: any) {
    logger.error('更新虚拟用户画像失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '更新虚拟用户画像失败'
    });
  }
});

/**
 * 删除虚拟用户
 * DELETE /api/admin/virtual-learners/:id
 */
router.delete('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    await prisma.virtual_learner_profiles.delete({
      where: { id }
    });
    
    await prisma.users.delete({
      where: { id: profile.userId }
    });
    
    logger.info('删除虚拟用户成功', {
      profileId: id,
      userId: profile.userId,
      deletedBy: req.user?.userId
    });
    
    res.json({
      success: true,
      message: '虚拟用户已删除'
    });
  } catch (error: any) {
    logger.error('删除虚拟用户失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除虚拟用户失败'
    });
  }
});

/**
 * 启动模拟会话
 * POST /api/admin/virtual-learners/:id/start-session
 */
router.post('/:id/start-session', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    const session = await prisma.virtual_sessions.create({
      data: {
        id: uuidv4(),
        virtualProfileId: id,
        userId: profile.userId,
        status: 'created',
        currentStage: 'goal',
        logs: '[]',
        stageResults: '{}'
      }
    });
    
    logger.info('启动模拟会话成功', {
      sessionId: session.id,
      profileId: id,
      userId: profile.userId
    });
    
    res.json({
      success: true,
      data: session
    });
  } catch (error: any) {
    logger.error('启动模拟会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '启动模拟会话失败'
    });
  }
});

/**
 * 获取模拟会话详情
 * GET /api/admin/virtual-sessions/:sessionId
 */
router.get('/sessions/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {}
    
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {}
    
    res.json({
      success: true,
      data: {
        ...session,
        logs,
        stageResults,
        profile: {
          ...session.virtual_learner_profiles,
          profile: JSON.parse(session.virtual_learner_profiles.profile || '{}'),
          email: session.virtual_learner_profiles.users.email
        }
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话详情失败'
    });
  }
});

/**
 * 单步模拟（手动模式）
 * POST /api/admin/virtual-sessions/:sessionId/step
 */
router.post('/sessions/:sessionId/step', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    const result = await simulationOrchestrator.executeSingleStep({
      sessionId,
      userId: session.userId,
      mode: 'single-step'
    });
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('单步模拟失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '单步模拟失败'
    });
  }
});

/**
 * 自动循环模拟
 * POST /api/admin/virtual-sessions/:sessionId/auto
 */
router.post('/sessions/:sessionId/auto', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { maxRounds = 20 } = req.body;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    const results = await simulationOrchestrator.executeAutoLoop(
      {
        sessionId,
        userId: session.userId,
        mode: 'auto-loop'
      },
      { maxRounds }
    );
    
    res.json({
      success: true,
      data: {
        results,
        totalRounds: results.length,
        lastResult: results[results.length - 1]
      }
    });
  } catch (error: any) {
    logger.error('自动循环模拟失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '自动循环模拟失败'
    });
  }
});

/**
 * 推进到路径生成阶段
 * POST /api/admin/virtual-sessions/:sessionId/advance-path
 */
router.post('/sessions/:sessionId/advance-path', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const result = await simulationOrchestrator.advanceToPathGeneration(sessionId);
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('推进路径生成失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '推进路径生成失败'
    });
  }
});

/**
 * 获取模拟会话日志
 * GET /api/admin/virtual-sessions/:sessionId/logs
 */
router.get('/sessions/:sessionId/logs', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {}
    
    res.json({
      success: true,
      data: {
        logs,
        totalLogs: logs.length
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话日志失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话日志失败'
    });
  }
});

/**
 * 删除模拟会话
 * DELETE /api/admin/virtual-sessions/:sessionId
 */
router.delete('/sessions/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    if (session.goalConversationId) {
      await prisma.goal_conversations.delete({
        where: { id: session.goalConversationId }
      }).catch(() => {});
    }
    
    if (session.learningPathId) {
      await prisma.learning_paths.delete({
        where: { id: session.learningPathId }
      }).catch(() => {});
    }
    
    await prisma.virtual_sessions.delete({
      where: { id: sessionId }
    });
    
    logger.info('删除模拟会话成功', {
      sessionId,
      userId: session.userId
    });
    
    res.json({
      success: true,
      message: '模拟会话已删除'
    });
  } catch (error: any) {
    logger.error('删除模拟会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除模拟会话失败'
    });
  }
});

export default router;