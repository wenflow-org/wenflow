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
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../../skills/virtual-learner-scenario-designer';
import { executeSkill } from '../../skills';
import learningService from '../../services/learning/learning.service';

const router = express.Router();
const VIRTUAL_USER_PASSWORD = 'VirtualTest123';

const DEFAULT_SCENARIO_CANDIDATE_DOMAINS = [
  '番茄工作法与时间管理',
  '课堂复盘与总结',
  '需求拆解',
  '向上汇报表达',
  'SQL 基础查询',
  'Python 基础',
  'Excel 数据处理',
  '英语口语表达',
  '备考规划',
  '个人记账与财务整理',
  '亲子沟通',
  '演讲与公开表达',
  '阅读方法',
  '健身习惯建立',
  '写作与结构表达',
  '短视频脚本表达',
  '面试回答组织',
  '家庭信息整理',
  '情绪记录与自我觉察',
  '基础营养与饮食规划',
];

const DEFAULT_SCENARIO_CANDIDATE_PERSONAS = [
  '销售主管，常被临时消息打断',
  '运营专员，最近要独立做复盘',
  '产品经理，方案总是越写越散',
  '教培老师，课后复盘全凭感觉',
  '求职转行者，自学总在开头放弃',
  '大三学生，备考节奏很乱',
  '二胎妈妈，想重新建立学习时间',
  '门店店长，排班和复盘都很碎片化',
  '客服组长，沟通记录难以整理',
  '自由职业设计师，项目切换频繁',
  '财务助理，月末报表压力大',
  '社区工作者，信息整理任务很多',
  '短视频创作者，选题和复盘混乱',
  '大学辅导员，事务多且优先级难排',
  '高中英语老师，想提升讲后总结质量',
  '全职妈妈，想恢复规律学习或锻炼',
  '兼职插画师，在家接稿兼顾家庭事务',
  '大学生，想提升公开表达或面试能力',
  '自由职业写作者，长期拖延交稿',
  '行政助理，日常任务碎片化严重',
];

function pickTopLabels(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function parseJson<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getStoryPool(profile: any) {
  const profileData = parseJson<any>(profile?.profile, {});
  const storyPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
  return storyPool.filter((story: any) => story && typeof story === 'object');
}

function pickStoryFromPool(profile: any, storyId?: string, storyIndex?: number) {
  const stories = getStoryPool(profile);
  if (!stories.length) return null;

  if (storyId) {
    const matched = stories.find((story: any) => story.id === storyId);
    if (matched) return matched;
  }

  if (Number.isFinite(storyIndex)) {
    const index = Math.max(0, Math.min(stories.length - 1, Number(storyIndex)));
    return stories[index];
  }

  return stories[0];
}

function parseStoryContext(session: any) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.story || null;
  } catch {
    return null;
  }
}

function parseLearningProgress(session: any) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.learning || {};
  } catch {
    return {};
  }
}

function parseStageResults(session: any) {
  try {
    return JSON.parse(session.stageResults || '{}');
  } catch {
    return {};
  }
}

function parseLogs(session: any) {
  try {
    const logs = JSON.parse(session.logs || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function buildSessionBindings(session: any) {
  const stageResults = parseStageResults(session);
  const learningState = stageResults.learning || {};

  return {
    goalConversationId: session.goalConversationId || null,
    learningPathId: session.learningPathId || null,
    teachingSessionId: learningState.teachingSessionId || null,
    currentTaskId: learningState.currentTaskId || null,
  };
}

function buildSessionSummary(session: any) {
  const storyContext = parseStoryContext(session);
  const stageResults = parseStageResults(session);
  const learningProgress = stageResults.learning || {};
  const logs = parseLogs(session);
  const roundCount = logs.filter((log: any) => log?.phase === 'virtual-reply' || log?.phase === 'learning-reply').length;

  return {
    id: session.id,
    status: session.status,
    currentStage: session.currentStage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    storyContext,
    roundCount,
    bindings: buildSessionBindings(session),
    currentTaskTitle: learningProgress.currentTaskTitle || null,
    currentMilestoneTitle: learningProgress.currentMilestoneTitle || null,
  };
}

async function buildRecentScenarioHints() {
  const recentProfiles = await prisma.virtual_learner_profiles.findMany({
    take: 12,
    orderBy: { createdAt: 'desc' },
    select: {
      profile: true,
      learningGoal: true,
      notes: true,
    },
  });

  const occupations = recentProfiles
    .map((item) => parseJson<any>(item.profile, {}).occupation)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  const domains = recentProfiles
    .map((item) => {
      const notes = item.notes || '';
      const matched = notes.match(/(?:^|\n)domain:\s*(.+)$/m);
      return matched?.[1]?.trim() || '';
    })
    .filter(Boolean);

  const goals = recentProfiles
    .map((item) => item.learningGoal || '')
    .filter(Boolean);

  const topOccupations = pickTopLabels(occupations, 4);
  const topDomains = pickTopLabels(domains, 4);
  const topGoals = pickTopLabels(goals, 3);

  const hints: string[] = [
    '请优先避免与最近样本重复的职业、问题来源和主题组合。',
    '如果最近样本里教师或时间管理类已经偏多，请主动切换到其他角色背景与问题来源。',
  ];

  for (const item of topOccupations) {
    hints.push(`最近高频职业：${item.label}（${item.count} 次），这次尽量换职业背景。`);
  }

  for (const item of topDomains) {
    hints.push(`最近高频主题：${item.label}（${item.count} 次），这次尽量换主题。`);
  }

  for (const item of topGoals) {
    hints.push(`最近高频目标表达：${item.label}（${item.count} 次），避免复述相似表述。`);
  }

  return hints;
}

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
 * AI生成虚拟学习者实验场景
 * POST /api/admin/virtual-learners/generate-scenario
 */
router.post('/generate-scenario', async (req: any, res) => {
  try {
    const {
      preferredDomains,
      preferredGoalTypes,
      preferredLevels,
      preferredMotivations,
      avoidDomains,
      candidateDomains,
      candidatePersonas,
    } = req.body || {};

    const recentScenarioHints = await buildRecentScenarioHints();

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredDomains,
      preferredGoalTypes,
      preferredLevels,
      preferredMotivations,
      avoidDomains,
      candidateDomains: Array.isArray(candidateDomains) && candidateDomains.length ? candidateDomains : DEFAULT_SCENARIO_CANDIDATE_DOMAINS,
      candidatePersonas: Array.isArray(candidatePersonas) && candidatePersonas.length ? candidatePersonas : DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentScenarioHints,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('AI生成虚拟学习者场景失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成虚拟学习者场景失败',
    });
  }
});

router.post('/generate-persona', async (req: any, res) => {
  try {
    const { preferredLevels, candidatePersonas, existingPersonaSeed } = req.body || {};
    const recentScenarioHints = await buildRecentScenarioHints();

    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels,
      candidatePersonas: Array.isArray(candidatePersonas) && candidatePersonas.length ? candidatePersonas : DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentPersonaHints: recentScenarioHints,
      existingPersonaSeed,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('AI生成虚拟学习者身份失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成虚拟学习者身份失败',
    });
  }
});

router.post('/:id/draft-profile', async (req: any, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const existingProfile = parseJson<any>(profile.profile, {});
    const existingTraits = parseJson<any>(profile.personalityTraits, {});
    const gateway = getGateway();

    const result = await gateway.executeAgent({
      agentId: 'virtual-learner-simulation-agent',
      input: {
        type: 'custom' as const,
        goal: `增强学习目标为"${profile.learningGoal}"的虚拟用户画像`,
        metadata: {
          simulationType: 'generate_profile',
          generateProfileInput: {
            learningGoal: profile.learningGoal,
            knowledgeLevel: profile.knowledgeLevel || 'beginner',
            simulationMode: profile.simulationMode || 'ai',
            personalityTraits: existingTraits,
            existingProfile,
          }
        }
      },
      context: {
        userId: req.user?.userId,
        metadata: { source: 'admin-draft-profile', virtualProfileId: id }
      }
    });

    const output = result.output as any;
    if (!result.success || !output?.generatedProfile) {
      return res.status(500).json({ success: false, error: result.error?.message || '增强画像生成失败' });
    }

    res.json({
      success: true,
      data: {
        generatedProfile: output.generatedProfile,
      }
    });
  } catch (error: any) {
    logger.error('增强画像生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强画像生成失败' });
  }
});

router.post('/:id/draft-stories', async (req: any, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const profileData = parseJson<any>(profile.profile, {});
    const existingStoryPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const recentScenarioHints = await buildRecentScenarioHints();

    logger.info('[admin-draft-stories] 开始生成故事草稿', {
      virtualProfileId: id,
      profileUserId: profile.userId,
      knowledgeLevel: profile.knowledgeLevel || 'beginner',
      existingStoryPoolCount: existingStoryPool.length,
      hasExistingPersonaSeed: !!profileData && Object.keys(profileData).length > 0,
      requestedStoryCount: 3,
    });

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredLevels: [profile.knowledgeLevel || 'beginner'],
      preferredMotivations: profileData?.motivationType ? [profileData.motivationType] : undefined,
      candidateDomains: DEFAULT_SCENARIO_CANDIDATE_DOMAINS,
      candidatePersonas: DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentScenarioHints,
      existingPersonaSeed: profileData,
      existingStoryPool,
      targetStoryCount: 3,
    });

    logger.info('[admin-draft-stories] 故事草稿生成完成', {
      virtualProfileId: id,
      generatedStoryCount: Array.isArray(result?.stories) ? result.stories.length : 0,
      storyTitles: Array.isArray(result?.stories) ? result.stories.slice(0, 3).map((story: any) => story?.title || '未命名故事') : [],
      systemPromptVersion: result?._debug?.systemPromptVersion || null,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('增强故事生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强故事生成失败' });
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
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: '名称不能为空'
      });
    }

    const normalizedLearningGoal = typeof learningGoal === 'string' ? learningGoal.trim() : '';
    const normalizedKnowledgeLevel = typeof knowledgeLevel === 'string' && knowledgeLevel.trim()
      ? knowledgeLevel.trim()
      : 'beginner';
    
    const email = `virtual_${uuidv4().substring(0, 8)}@test.local`;
    const hashedPassword = await bcrypt.hash(VIRTUAL_USER_PASSWORD, 10);
    
    const user = await prisma.users.create({
      data: {
        id: uuidv4(),
        email,
        name,
        password: hashedPassword,
        role: 'user',
        currentLevel: normalizedKnowledgeLevel,
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
        learningGoal: normalizedLearningGoal,
        knowledgeLevel: normalizedKnowledgeLevel,
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
              createdAt: true,
              updatedAt: true
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
        tags: profile.tags ? JSON.parse(profile.tags) : [],
        sessions: Array.isArray(profile.sessions) ? profile.sessions.map((session: any) => buildSessionSummary(session)) : []
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
    const { storyId, storyIndex } = req.body || {};
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }

    const story = pickStoryFromPool(profile, storyId, storyIndex);
    const storyContext = story
      ? {
          storyId: story.id || null,
          title: story.title || '故事',
          sourceType: story.sourceType || null,
          outline: story.storyOutline || story.outline || '',
          triggerEvent: story.triggerEvent || '',
          visibleOpening: story.visibleOpening || '',
          hiddenDetails: Array.isArray(story.hiddenDetails) ? story.hiddenDetails : [],
          misdiagnosis: story.misdiagnosis || '',
          pressurePoints: Array.isArray(story.pressurePoints) ? story.pressurePoints : [],
          behaviorHooks: Array.isArray(story.behaviorHooks) ? story.behaviorHooks : [],
          goalSeed: story.goalSeed || null,
          disclosurePlan: story.disclosurePlan || null,
        }
      : null;

    const stageResults = storyContext
      ? JSON.stringify({
          story: storyContext,
          learnerContext: parseJson<any>(profile.profile, {}),
        })
      : '{}';

    const session = await prisma.virtual_sessions.create({
      data: {
        id: uuidv4(),
        virtualProfileId: id,
        userId: profile.userId,
        status: 'created',
        currentStage: 'goal',
        logs: '[]',
        stageResults,
      }
    });
    
    logger.info('启动模拟会话成功', {
      sessionId: session.id,
      profileId: id,
      userId: profile.userId
    });
    
    res.json({
      success: true,
      data: {
        ...session,
        storyContext,
      }
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
          email: session.virtual_learner_profiles.users.email,
          userName: session.virtual_learner_profiles.users.name
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
 * 获取模拟会话上下文
 * GET /api/admin/virtual-learners/sessions/:sessionId/context
 */
router.get('/sessions/:sessionId/context', async (req: any, res) => {
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

    const storyContext = parseStoryContext(session);
    const bindings = buildSessionBindings(session);
    const stageResults = parseStageResults(session);

    res.json({
      success: true,
      data: {
        virtualSession: buildSessionSummary(session),
        profile: {
          id: session.virtual_learner_profiles.id,
          userId: session.virtual_learner_profiles.userId,
          email: session.virtual_learner_profiles.users.email,
          userName: session.virtual_learner_profiles.users.name,
          learningGoal: session.virtual_learner_profiles.learningGoal,
          knowledgeLevel: session.virtual_learner_profiles.knowledgeLevel,
          profile: parseJson<any>(session.virtual_learner_profiles.profile, {}),
        },
        storyContext,
        bindings,
        currentStage: session.currentStage,
        status: session.status,
        stageResults,
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话上下文失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话上下文失败'
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
 * 兜底重试：推进到路径生成阶段
 * 仅在 goalConversationService 自动触发的 path 生成失败时由前端调用
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
 * 查询路径生成状态（前端轮询用）
 * GET /api/admin/virtual-sessions/:sessionId/path-status
 */
router.get('/sessions/:sessionId/path-status', async (req: any, res) => {
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
      ?.flatMap((milestone: any, milestoneIndex: number) => (milestone.subtasks || []).map((task: any, taskIndex: number) => ({
        ...task,
        milestone,
        milestoneIndex,
        taskIndex
      })))
      ?.find((task: any) => task.id === learningProgress.currentTaskId)
      || null;
    const contextTask = activeTask || firstTask;
    const contextMilestone = activeTask?.milestone || firstMilestone;
    const coreConcept = contextTask?.coreConcept || contextTask?.displayLabel || contextTask?.title || null;

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
        coreConcept,
        learningObjectives: Array.isArray(contextTask.learningObjectives)
          ? contextTask.learningObjectives
          : typeof contextTask.learningObjectives === 'string' && contextTask.learningObjectives.trim()
            ? contextTask.learningObjectives.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
            : [],
        linkedConceptName: coreConcept,
      } : null,
        taskKnowledgeScope: contextTask ? {
        primaryConcepts: coreConcept ? [coreConcept] : [],
        prerequisiteConcepts: [],
        supportingConcepts: contextTask.displayLabel ? [contextTask.displayLabel] : [],
      } : null,
      cognitiveFrame: contextTask ? {
        currentCoreConcept: coreConcept ? { name: coreConcept } : null,
        targetRelation: contextTask.description || learningPath.summary || learningPath.description || null,
        milestoneIntent: contextMilestone?.description || null,
        transferGoal: contextTask.displayLabel || contextTask.title || null,
        neighboringConcepts: contextTask.displayLabel ? [contextTask.displayLabel] : [],
      } : null,
      teachingStrategyGuidance: contextTask ? {
        explanationStyle: contextTask.cognitiveLevel === 'advanced' ? 'concept-first' : 'step-by-step',
        interactionPattern: contextTask.taskType === 'quiz' ? 'question-response' : 'guided-practice',
        targetDepth: contextTask.cognitiveLevel || 'balanced',
        preferredStrategies: contextTask.taskType ? [contextTask.taskType] : ['guided-practice'],
        responseConstraints: storyContext?.visibleOpening ? ['先围绕故事中的真实场景解释，再给抽象总结'] : ['先从当前任务切入，再回到整体路径'],
        coreConcept,
        storyPressurePoints: Array.isArray(storyContext?.pressurePoints) ? storyContext.pressurePoints : [],
        storyBehaviorHooks: Array.isArray(storyContext?.behaviorHooks) ? storyContext.behaviorHooks : [],
      } : null
    };

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
          totalStages: learningPath.totalStages || learningPath.totalMilestones
        },
        pathContext
      }
    });
  } catch (error: any) {
    logger.error('查询路径状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '查询路径状态失败'
    });
  }
});

/**
 * 开始 Learning 阶段
 * POST /api/admin/virtual-sessions/:sessionId/start-learning
 */
router.post('/sessions/:sessionId/start-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId } = req.body || {};
    
    const result = await simulationOrchestrator.startLearningPhase(sessionId, { taskId });
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('开始学习阶段失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '开始学习阶段失败'
    });
  }
});

/**
 * 执行单步学习
 * POST /api/admin/virtual-sessions/:sessionId/learning-step
 */
router.post('/sessions/:sessionId/learning-step', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const result = await simulationOrchestrator.executeLearningStep(sessionId);
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('执行学习步骤失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '执行学习步骤失败'
    });
  }
});

/**
 * 自动学习（完成整个路径或指定里程碑数）
 * POST /api/admin/virtual-sessions/:sessionId/auto-learning
 */
router.post('/sessions/:sessionId/auto-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { maxMilestones = 10 } = req.body;
    
    const result = await simulationOrchestrator.executeAutoLearning(sessionId, {
      maxMilestones
    });
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('自动学习失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '自动学习失败'
    });
  }
});

router.post('/sessions/:sessionId/restart-path', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await simulationOrchestrator.advanceToPathGeneration(sessionId);

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('重新开始路径失败:', error);
    res.status(500).json({ success: false, error: error.message || '重新开始路径失败' });
  }
});

router.post('/sessions/:sessionId/restart-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId } = req.body || {};
    const result = await simulationOrchestrator.startLearningPhase(sessionId, { taskId });

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('重新开始学习失败:', error);
    res.status(500).json({ success: false, error: error.message || '重新开始学习失败' });
  }
});

router.post('/sessions/:sessionId/stop-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await simulationOrchestrator.emergencyStopLearning(sessionId, 'admin-emergency-stop');

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('紧急停止学习失败:', error);
    res.status(500).json({ success: false, error: error.message || '紧急停止学习失败' });
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
