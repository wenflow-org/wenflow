import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import prisma from './config/database';
import { initializeAdmin } from './services/auth/init-admin.service';

// EduClaw Gateway
import { createGateway } from './gateway';
import { registerOfficialAgents, registerAllPlugins } from './agents';
import { allSkillDefinitions, skillHandlers } from './skills';

import { createAgentCollaborationService } from './services/agent-collaboration.service';
import { learnerModelAgent } from './agents/learner-model-agent';
import { getEventBus } from './gateway/event-bus';
import learningService from './services/learning/learning.service';

const ENRICHMENT_RETRY_POLL_INTERVAL_MS = 60 * 1000;

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

// 全局 API 限流
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: { message: '请求过于频繁，请稍后重试' }
  },
  standardHeaders: true,
  legacyHeaders: false
});

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
app.use('/api/', globalLimiter);

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
import agentsRoutes from './routes/agents';
import skillsRoutes from './routes/skills';
import pluginRoutes from './routes/plugins';
import adminAuthRoutes from './routes/admin-auth';
import adminApiConfigRoutes from './routes/admin/api-config';
import adminAgentModelConfigsRoutes from './routes/admin/agent-model-configs';
import adminPlatformRoutes from './routes/admin/platform';
import adminGoalConversationsRoutes from './routes/admin/goal-conversations';
import adminUsersRoutes from './routes/admin/users';
import adminLearnerModelsRoutes from './routes/admin/learner-models';
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
      'progress-agent': '进度追踪'
    },
    skills: [
      'pdf-parser',
      'text-structure-analyzer',
      'time-estimator',
      'content-generation',
      'quiz-generation',
      'retrieval',
      'answer-generation',
      'code-explainer',
      'exercise-generator',
      'error-pattern',
      'web-extractor',
      'image-analyzer',
      'memory-search',
      'smart-search'
    ]
  });
});

// 路由注册
// Platform 层路由 - 核心学习功能
app.use('/api/learning', authMiddleware, acpContextMiddleware('platform'), learningRoutes);
app.use('/api/state', authMiddleware, acpContextMiddleware('platform'), stateTrackingRoutes);
app.use('/api/achievements', authMiddleware, acpContextMiddleware('platform'), achievementsRoutes);
app.use('/api/reports', authMiddleware, acpContextMiddleware('platform'), reportRoutes);
app.use('/api/metrics', authMiddleware, acpContextMiddleware('platform'), metricsRoutes);

// goal-conversation 路由（需要认证）
app.use('/api/goal-conversation', authMiddleware, acpContextMiddleware('platform'), goalConversationRoutes);

// 其他路由（保持原有认证）
// 注意：具体路由必须在通用路由之前注册！
app.use('/api/auth', authRoutes);
app.use('/api/admin-auth/login', adminAccessRestrictMiddleware, adminAuthRoutes);
app.use('/api/admin-auth', adminAuthRoutes);
app.use('/api/admin/api-config', authMiddleware, adminApiConfigRoutes);
app.use('/api/admin/agent-model-configs', authMiddleware, adminAgentModelConfigsRoutes);
app.use('/api/admin/users', authMiddleware, adminUsersRoutes);
app.use('/api/admin/learner-models', authMiddleware, adminLearnerModelsRoutes);
app.use('/api/admin/goal-conversations', authMiddleware, adminGoalConversationsRoutes);  // 具体路由
app.use('/api/admin', authMiddleware, adminPlatformRoutes);  // 通用路由 - 必须在最后
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/agents', authMiddleware, agentsRoutes);
app.use('/api/skills', authMiddleware, skillsRoutes);
app.use('/api/plugins', authMiddleware, pluginRoutes);
app.use('/api/ai-teaching', authMiddleware, aiTeachingRoutes);
app.use('/api/feedback', authMiddleware, feedbackRoutes);
app.use('/api/ab-testing', authMiddleware, abTestingRoutes);


// 用户自定义路由
app.use('/api/user/code-repo', authMiddleware, userCodeRepoRoutes);
app.use('/api/user/agents', authMiddleware, userAgentsRoutes);
app.use('/api/user/skills', authMiddleware, userSkillsRoutes);
app.use('/api/user/api-config', authMiddleware, userApiConfigRoutes);
app.use('/api/user/agent-model-configs', authMiddleware, userAgentModelConfigsRoutes);
app.use('/api/user/mcp', authMiddleware, userMcpRoutes);
app.use('/api/user/developer', authMiddleware, userDeveloperRoutes);

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
  
  learnerModelAgent.setupEventListeners(eventBus);
  
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
    await initializeGateway();
    
     // 初始化 Agent 协作服务
     await initializeAgentCollaboration();

      // 回收因进程中断等原因遗留的 generating 路径
      await learningService.recoverStaleGeneratingPaths();

      // 持续自动重试仍在准备失败中的路径
      setInterval(() => {
        void learningService.retryEligibleFailedPathPreparations().catch((error) => {
          logger.warn('自动继续准备学习内容轮询失败', {
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
