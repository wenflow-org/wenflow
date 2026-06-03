import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import prisma from './config/database';
import { initializeAdmin } from './services/auth/init-admin.service';
import { globalApiLimiter } from './middleware/api-rate-limit.middleware';

// EduClaw Gateway
import { createGateway } from './gateway';
import { registerOfficialAgents, registerAllPlugins } from './agents';
import { allSkillDefinitions, skillHandlers } from './skills';

import { createAgentCollaborationService } from './services/agent-collaboration.service';
import { getEventBus } from './gateway/event-bus';
import learningService from './services/learning/learning.service';
import { learnerOrchestrator } from './orchestrators/learner.orchestrator';

const ENRICHMENT_RETRY_POLL_INTERVAL_MS = 60 * 1000;
const RETIRED_SKILLS = [
  'pdf-parser',
  'time-estimator',
  'quiz-generation',
  'exercise-generator',
  'content-generation',
  'error-pattern',
  'code-explainer',
  'answer-generation',
  'batch-anderson-labeler',
  'goal-type-identifier',
  'task-profile-builder'
] as const;

// ACP 中间件
import { acpContextMiddleware } from './middleware/acp-context.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { adminAccessRestrictMiddleware } from './middleware/admin-access-restrict.middleware';
import { csrfMiddleware } from './middleware/csrf.middleware';

// 加载环境变量
dotenv.config();

// 强制安全配置检查
const requiredEnvVars = ['JWT_SECRET'];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ 缺少必要的环境变量: ${envVar}`);
    console.error('请在 .env 文件中配置该变量');
    process.exit(1);
  }
});

// JWT_SECRET 安全性检查
if (process.env.JWT_SECRET === 'your-secret-key-change-in-production' ||
    process.env.JWT_SECRET?.length < 32) {
  console.error('❌ JWT_SECRET 不安全：');
  console.error('  - 请勿使用默认值');
  console.error('  - 密钥长度至少32位');
  console.error('  - 建议使用随机生成：openssl rand -base64 32');
  process.exit(1);
}

console.log('✅ 安全配置检查通过');

const app = express();
const PORT = process.env.PORT || 3001;

const trustProxyEnv = (process.env.TRUST_PROXY || '').trim().toLowerCase();
if (trustProxyEnv === 'true') {
  app.set('trust proxy', true);
} else if (trustProxyEnv === 'false') {
  app.set('trust proxy', false);
} else if (/^\d+$/.test(trustProxyEnv)) {
  app.set('trust proxy', Number(trustProxyEnv));
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 中间件
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", process.env.AI_API_URL || ''],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
  },
}));

// 额外安全头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS 安全配置
const corsOptions = {
  origin: process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 应用全局限流到 API 路由
app.use('/api/', globalApiLimiter);

// 应用 CSRF 保护
app.use('/api/', csrfMiddleware);

// 确保 API 响应使用 UTF-8 编码
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 导入路由
import authRoutes from './routes/auth';
import learningRoutes from './routes/learning';
import userRoutes from './routes/users';
import stateTrackingRoutes from './routes/state-tracking.routes';
import achievementsRoutes from './routes/achievements';
import reportRoutes from './routes/reports';
import metricsRoutes from './routes/metrics';
import goalConversationRoutes from './routes/goal-conversation';
import testGoalConversationRoutes from './routes/test-goal-conversation';
import agentsRoutes from './routes/agents';
import skillsRoutes from './routes/skills';
import adaptiveGuidanceRoutes from './routes/adaptive-guidance.routes';
import pluginRoutes from './routes/plugins';
import adminAuthRoutes from './routes/admin-auth';
import adminApiConfigRoutes from './routes/admin/api-config';
import adminSkillsRoutes from './routes/admin/skills';
import adminAgentModelConfigsRoutes from './routes/admin/agent-model-configs';
import adminAgentPromptsRoutes from './routes/admin/agent-prompts';
import adminPromptStabilityRoutes from './routes/admin/prompt-stability';
import adminRuntimeDefinitionsRoutes from './routes/admin/runtime-definitions';
import adminSkillModelConfigsRoutes from './routes/admin/skill-model-configs';
import adminPlatformRoutes from './routes/admin/platform';
import adminGoalConversationsRoutes from './routes/admin/goal-conversations';
import adminUsersRoutes from './routes/admin/users';
import adminLearnerModelsRoutes from './routes/admin/learner-models';
import adminVirtualLearnersRoutes from './routes/admin/virtual-learners';
import adminDevtoolsRoutes from './routes/admin/devtools';
import aiTeachingRoutes from './routes/ai-teaching.routes';
import feedbackRoutes from './routes/feedback';
import abTestingRoutes from './routes/ab-testing';

// 用户自定义路由
import userCodeRepoRoutes from './routes/user-code-repo';
import userAgentsRoutes from './routes/user-agents';
import userSkillsRoutes from './routes/user-skills';
import userApiConfigRoutes from './routes/user-api-config';
import userAgentModelConfigsRoutes from './routes/user-agent-model-configs';
import userMcpRoutes from './routes/user-mcp';
import userDeveloperRoutes from './routes/user-developer';

// API路由
app.get('/api', (req, res) => {
  res.json({
    message: 'WenFlow API - Gateway',
    version: '2.0.0',
    architecture: 'Agent-Driven + Dynamic Navigation',
    authentication: 'JWT Bearer Token',
    endpoints: {
      health: '/health',
      api: '/api',
      auth: '/api/auth',
      users: '/api/users',
      learning: '/api/learning',
      goalConversation: '/api/goal-conversation',
      testGoalConversation: '/api/test/goal-conversation',
      state: '/api/state',
      achievements: '/api/achievements',
      reports: '/api/reports',
      metrics: '/api/metrics',
      agents: '/api/agents',
      skills: '/api/skills',
      feedback: '/api/feedback',
      userCustom: {
        codeRepo: '/api/user/code-repo',
        agents: '/api/user/agents',
        skills: '/api/user/skills',
        apiConfig: '/api/user/api-config',
        mcp: '/api/user/mcp',
        developer: '/api/user/developer'
      }
    },
agents: {
      'path-agent': '学习路径规划',
      'ai-teaching-agent': 'AI授课编排',
      'learner-model-agent': '学习者画像与状态中心'
    },
    skills: [
      'text-structure-analyzer',
      'retrieval',
      'web-extractor',
      'image-analyzer',
      'memory-search',
      'smart-search',
      'path-scene-framing',
      'stage-designer',
      'adaptive-guidance-copy',
      'goal-profile-inference',
      'learning-pattern-distiller',
      'session-knowledge-distiller',
      'dialogue-concept-extractor'
    ]
  });
});

// 路由注册
// Platform 层路由 - 核心学习功能（平台内部调用）
app.use('/api/learning', authMiddleware, acpContextMiddleware('platform'), learningRoutes);
app.use('/api/state', authMiddleware, acpContextMiddleware('platform'), stateTrackingRoutes);
app.use('/api/achievements', authMiddleware, acpContextMiddleware('platform'), achievementsRoutes);
app.use('/api/reports', authMiddleware, acpContextMiddleware('platform'), reportRoutes);
app.use('/api/metrics', authMiddleware, acpContextMiddleware('platform'), metricsRoutes);

// goal-conversation 路由（用户侧调用）
app.use('/api/goal-conversation', authMiddleware, acpContextMiddleware('user'), goalConversationRoutes);
app.use('/api/test/goal-conversation', authMiddleware, acpContextMiddleware('test'), testGoalConversationRoutes);

// 其他路由（保持原有认证）
// 注意：具体路由必须在通用路由之前注册！
app.use('/api/auth', authRoutes);
app.use('/api/admin-auth', adminAuthRoutes);
app.use('/api/admin/api-config', authMiddleware, acpContextMiddleware('admin'), adminApiConfigRoutes);
app.use('/api/admin/skills', authMiddleware, acpContextMiddleware('admin'), adminSkillsRoutes);
app.use('/api/admin/agent-model-configs', authMiddleware, acpContextMiddleware('admin'), adminAgentModelConfigsRoutes);
app.use('/api/admin/agent-prompts', authMiddleware, acpContextMiddleware('admin'), adminAgentPromptsRoutes);
app.use('/api/admin/prompt-stability', authMiddleware, acpContextMiddleware('admin'), adminPromptStabilityRoutes);
app.use('/api/admin/runtime-definitions', authMiddleware, acpContextMiddleware('admin'), adminRuntimeDefinitionsRoutes);
app.use('/api/admin/skill-model-configs', authMiddleware, acpContextMiddleware('admin'), adminSkillModelConfigsRoutes);
app.use('/api/admin/users', authMiddleware, acpContextMiddleware('admin'), adminUsersRoutes);
app.use('/api/admin/learner-models', authMiddleware, acpContextMiddleware('admin'), adminLearnerModelsRoutes);
app.use('/api/admin/goal-conversations', authMiddleware, acpContextMiddleware('admin'), adminGoalConversationsRoutes);
app.use('/api/admin/virtual-learners', authMiddleware, acpContextMiddleware('admin'), adminVirtualLearnersRoutes);
app.use('/api/admin', authMiddleware, acpContextMiddleware('admin'), adminDevtoolsRoutes);
app.use('/api/admin', authMiddleware, acpContextMiddleware('admin'), adminPlatformRoutes);
app.use('/api/users', authMiddleware, acpContextMiddleware('user'), userRoutes);
app.use('/api/agents', authMiddleware, acpContextMiddleware('user'), agentsRoutes);
app.use('/api/skills', authMiddleware, acpContextMiddleware('user'), skillsRoutes);
app.use('/api/adaptive-guidance', authMiddleware, acpContextMiddleware('user'), adaptiveGuidanceRoutes);
app.use('/api/plugins', authMiddleware, acpContextMiddleware('user'), pluginRoutes);
app.use('/api/ai-teaching', authMiddleware, acpContextMiddleware('user'), aiTeachingRoutes);
app.use('/api/feedback', authMiddleware, acpContextMiddleware('user'), feedbackRoutes);
app.use('/api/ab-testing', authMiddleware, acpContextMiddleware('user'), abTestingRoutes);


// 用户自定义路由
app.use('/api/user/code-repo', authMiddleware, acpContextMiddleware('user'), userCodeRepoRoutes);
app.use('/api/user/agents', authMiddleware, acpContextMiddleware('user'), userAgentsRoutes);
app.use('/api/user/skills', authMiddleware, acpContextMiddleware('user'), userSkillsRoutes);
app.use('/api/user/api-config', authMiddleware, acpContextMiddleware('user'), userApiConfigRoutes);
app.use('/api/user/agent-model-configs', authMiddleware, acpContextMiddleware('user'), userAgentModelConfigsRoutes);
app.use('/api/user/mcp', authMiddleware, acpContextMiddleware('user'), userMcpRoutes);
app.use('/api/user/developer', authMiddleware, acpContextMiddleware('user'), userDeveloperRoutes);

// 错误处理中间件
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    status: err.status
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({
    success: false,
    error: {
      message: isProduction ? '服务器错误，请稍后重试' : (err.message || 'Internal Server Error'),
      code: err.code || 'INTERNAL_ERROR',
      status: err.status || 500,
      ...(isProduction ? {} : { stack: err.stack })
    }
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Not Found',
      status: 404
    }
  });
});

/**
 * 初始化 EduClaw Gateway
 */
async function initializeGateway() {
  logger.info('Initializing EduClaw Gateway...');
  
  // 创建 Gateway
  const gateway = createGateway(prisma, {
    ai: {
      baseUrl: process.env.AI_API_URL || 'http://localhost:3000',
      apiKey: process.env.AI_API_KEY || '',
      defaultModel: process.env.AI_MODEL || '',
      defaultReasoningModel: process.env.AI_MODEL_REASONING || '',
    },
    eventBus: {
      persistEvents: true,
    }
  });
  
  // 注册所有官方 Agent
  await registerOfficialAgents({
    registerAgent: async (definition, handler) => {
      return gateway.registerAgent(definition, handler);
    }
  });

  // 注册新的 Agent 插件系统
  registerAllPlugins();

  // 注册所有核心 Skill
  for (const definition of allSkillDefinitions) {
    const handler = skillHandlers[definition.name];
    if (handler) {
      await gateway.registerSkill(definition, handler);
    }
  }
  
  // 加载已有的注册
  await gateway.loadRegistrations();
  
  logger.info('✅ EduClaw Gateway initialized');
  
  return gateway;
}

async function purgeRetiredSkills() {
  const retiredSkillNames = [...RETIRED_SKILLS];
  const retiredAgentIds = retiredSkillNames.map((name) => `skill:${name}`);

  await Promise.all([
    prisma.skill_registrations.deleteMany({ where: { name: { in: retiredSkillNames } } }),
    prisma.skill_model_configs.deleteMany({ where: { skillId: { in: retiredSkillNames } } }),
    prisma.user_skill_configs.deleteMany({ where: { skillName: { in: retiredSkillNames } } }),
    prisma.agent_prompts.deleteMany({ where: { agentId: { in: retiredAgentIds } } })
  ]);

  logger.info('已清理退役 Skill 配置残留', {
    retiredSkillCount: retiredSkillNames.length
  });
}

/**
 * 初始化 Agent 协作服务
 */
async function initializeAgentCollaboration() {
  logger.info('Initializing Agent Collaboration Service...');
  
  const eventBus = getEventBus();
  
  const service = createAgentCollaborationService({
    enableAutoAdjustment: true,
    adjustmentCooldown: 300000,
    minSignalsForAdjustment: 2,
    profileUpdateInterval: 60000
  });
  
  service.start();
  
  learnerOrchestrator.setupEventListeners(eventBus);
  
  logger.info('✅ Agent Collaboration Service started');
  
  return service;
}

// 启动服务器
async function startServer() {
  try {
    // 测试数据库连接
    logger.info('Connecting to database...');
    await prisma.$connect();
    logger.info('✅ Database connected successfully');

    // 初始化管理员账户
    await initializeAdmin();

     // 初始化 EduClaw Gateway
    await purgeRetiredSkills();
     await initializeGateway();
    
     // 初始化 Agent 协作服务
     await initializeAgentCollaboration();

      // 回收因进程中断等原因遗留的 generating 路径
      await learningService.recoverStaleGeneratingPaths();

      // 持续自动重试仍在阶段任务生成失败中的路径
      setInterval(() => {
        void learningService.retryEligibleFailedPathPreparations().catch((error) => {
          logger.warn('自动继续生成阶段任务轮询失败', {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }, ENRICHMENT_RETRY_POLL_INTERVAL_MS);

     app.listen(PORT, () => {
      logger.info(`🚀 Server is running on port ${PORT}`);
      logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
      logger.info(`🤖 EduClaw Gateway: Agent-Driven Architecture`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Closing server gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Closing server gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();

export default app;
