import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import prisma from './config/database';
import systemPrisma from './config/system-database';
import { initializeAdmin } from './services/auth/init-admin.service';
import { adminApiLimiter, globalApiLimiter } from './middleware/api-rate-limit.middleware';

// EduClaw Gateway
import { createGateway, EduClawGateway } from './gateway';
import { registerOfficialAgents } from './agents';
import { allSkillDefinitions, skillHandlers } from './skills';
import { PURGED_SKILLS } from './skills/retired-skills';
import { validateManifest, listTopLevelAgents } from './services/agent-manifest.service';
import { loadSkillsFile } from './services/skill-registry/skills-file';

import learningService from './services/learning/learning.service';
import { ensureCoreAgentPrompts } from './scripts/seed-core-agent-prompts';
import { bootstrapFieldRoutings } from './services/field-routing-bootstrap.service';
import { seedSkillModelConfigsIfEmpty } from './services/seed-skill-model-configs';
import { dashboardGuidanceSnapshotService } from './services/learner/DashboardGuidanceSnapshotService';
import { DurableEventConsumerRegistry } from './events/consumer-registry';
import { DurableOutboxWorker } from './events/outbox.worker';
import { learnerEvidenceProjector } from './services/learner/LearnerEvidenceProjector';
import { learnerSnapshotRefreshService } from './services/learner/LearnerSnapshotRefreshService';
import { learnerProfileService } from './services/learner/LearnerProfileService';
import { lessonKnowledgeEnrichmentConsumer } from './services/learner/LessonKnowledgeEnrichmentConsumer';
import { reviewCompletedConsumer } from './services/learner/ReviewCompletedConsumer';
import { quickLearnService } from './virtual-lab/quick-learn/quick-learn.service';
import { reconcileTaskCompletionMetric } from './services/metrics/LearningMetricService';
import { refreshRuntimeNetworkPolicy } from './services/runtime-network-policy.service';
import type { Server } from 'http';
import { ReadinessService } from './services/readiness.service';
import { auditSensitivePaths, SensitivePath } from './services/sensitive-storage-permissions.service';
import { resolveSqlitePath, validateRuntimeDatabaseUrls } from './utils/runtime-paths';
import { resolveTrustProxySetting } from './utils/trust-proxy';
import { ApplicationLifecycle, resolveShutdownDeadlineMs } from './services/application-lifecycle.service';
import { backgroundTaskTracker, runBackgroundTask } from './services/background-task-tracker.service';
import { aiTeachingOrchestrator } from './services/ai-teaching/AITeachingCoordinator';
import { aiCapabilityHealthService } from './services/ai-capability-health.service';
import { getRuntimeCapabilityProbeEnabled } from './services/capability-probe-settings.service';
import { logRetentionService } from './services/log-retention.service';
import { startBatchExperimentScheduler } from './services/virtual-lab/batch-experiment.service';
import { auditCleanupService } from './services/audit-cleanup.service';
import { virtualSessionReclaimService } from './virtual-lab/session-reclaim.service';
import { existsSync } from 'fs';
import { resolve } from 'path';

const ENRICHMENT_RETRY_POLL_INTERVAL_MS = 60 * 1000;

// ACP 中间件
import { acpContextMiddleware } from './middleware/acp-context.middleware';
import { adminAuthMiddleware, authMiddleware } from './middleware/auth.middleware';
import { adminMiddleware } from './middleware/admin.middleware';
import { adminAccessRestrictMiddleware } from './middleware/admin-access-restrict.middleware';
import { adminAuditMiddleware } from './middleware/admin-audit.middleware';
import { csrfMiddleware } from './middleware/csrf.middleware';
import { validateSecretEncryptionConfig } from './utils/secret-crypto';
import { validateSafeHttpConfig } from './utils/safe-http';

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

  logger.info('✅ 安全配置检查通过');
validateSecretEncryptionConfig(true);
validateSafeHttpConfig();
validateRuntimeDatabaseUrls(process.env.DATABASE_URL, process.env.SYSTEM_DATABASE_URL);

const app = express();
const PORT = process.env.PORT || 3001;
let outboxWorker: DurableOutboxWorker | null = null;
let enrichmentRetryTimer: NodeJS.Timeout | null = null;
let enrichmentRetryInFlight: Promise<void> | null = null;
let httpServer: Server | null = null;
let gateway: EduClawGateway | null = null;
const lifecycle = new ApplicationLifecycle();
const readinessService = new ReadinessService(prisma, systemPrisma, 2000, () => lifecycle.isDraining());
const shutdownDeadlineMs = resolveShutdownDeadlineMs(process.env.SHUTDOWN_DEADLINE_MS);

app.set('trust proxy', resolveTrustProxySetting(process.env.TRUST_PROXY, process.env.NODE_ENV));

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// HTTP 请求日志（dev 调试用，debug 级别；不记录 body，仅 method/path/status/耗时）
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/', (req, res, next) => {
    if (req.path === '/health' || req.path === '/livez' || req.path === '/readyz') return next();
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.debug(`[http] ${req.method} ${req.originalUrl} → ${res.statusCode} ${Date.now() - startedAt}ms`, {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });
    next();
  });
}

// 应用全局限流到 API 路由（admin 路径由 globalApiLimiter 跳过，走 adminApiLimiter 专属额度）
app.use('/api/', globalApiLimiter);
app.use('/api/admin/', adminApiLimiter);

// 应用 CSRF 保护
app.use('/api/', csrfMiddleware);

// 确保 API 响应使用 UTF-8 编码
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// /health 保留兼容并明确作为 liveness。
const livezHandler = (req: express.Request, res: express.Response) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
};
app.get('/health', livezHandler);
app.get('/livez', livezHandler);
app.get('/readyz', async (req, res) => {
  if (lifecycle.isDraining()) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'draining',
      timestamp: new Date().toISOString()
    });
  }
  const result = await readinessService.check();
  res.status(result.ready ? 200 : 503).json({
    status: result.ready ? 'ready' : 'not_ready',
    checks: result.checks,
    timestamp: new Date().toISOString()
  });
});

// 导入路由
import authRoutes from './routes/auth';
import learningRoutes from './routes/learning';
import userRoutes from './routes/users';
import stateTrackingRoutes from './routes/state-tracking.routes';
import achievementsRoutes from './routes/achievements';
import metricsRoutes from './routes/metrics';
import goalConversationRoutes from './routes/goal-conversation';
import agentsRoutes from './routes/agents';
import adaptiveGuidanceRoutes from './routes/adaptive-guidance.routes';
import adminAuthRoutes from './routes/admin-auth';
import adminApiConfigRoutes from './routes/admin/api-config';
import adminSkillsRoutes from './routes/admin/skills';
import adminFieldRoutingsRoutes from './routes/admin/field-routings';
import adminAgentPromptsRoutes from './routes/admin/agent-prompts';
import adminRuntimeDefinitionsRoutes from './routes/admin/runtime-definitions';
import promptLabRoutes from './routes/prompt-lab';
import adminPromptOpsRoutes from './routes/admin/prompt-ops';
import adminSkillModelConfigsRoutes from './routes/admin/skill-model-configs';
import adminPlatformRoutes from './routes/admin/platform';
import adminGoalConversationsRoutes from './routes/admin/goal-conversations';
import adminUsersRoutes from './routes/admin/users';
import adminSessionsRoutes from './routes/admin/sessions';
import adminAuditLogsRoutes from './routes/admin/audit-logs';
import adminLearnerModelsRoutes from './routes/admin/learner-models';
import adminMemoryTracesRoutes from './routes/admin/memory-traces';
import adminAnnouncementsRoutes from './routes/admin/announcements';
import announcementsRoutes from './routes/announcements';
import adminVirtualLearnersRoutes from './routes/admin/virtual-learners';
import adminSessionConsoleRoutes from './routes/admin/session-console';
import adminVirtualQuickLearnRoutes from './routes/admin/virtual-quick-learn';
import adminBatchExperimentsRoutes from './routes/admin/batch-experiments';
import adminProjectionAccessGrantsRoutes from './routes/admin/projection-access-grants';
import adminFeedbackRoutes from './routes/admin/feedback';
import adminSystemStatusRoutes from './routes/admin/system-status';
import adminMcpRoutes from './routes/admin/mcp';
import adminHealthCenterRoutes from './routes/admin/health-center';
import adminGlossaryRoutes from './routes/admin/glossary';
import adminDevtoolsRoutes from './routes/admin/devtools';
import adminAchievementsRoutes from './routes/admin/achievements';
import adminLearningContentRoutes from './routes/admin/learning-content';
import adminExportRoutes from './routes/admin/export';
import adminTokenCostRoutes from './routes/admin/token-cost';
import adminNotificationsRoutes from './routes/admin/notifications';
import notificationsRoutes from './routes/notifications';
import aiTeachingRoutes from './routes/ai-teaching.routes';
import feedbackRoutes from './routes/feedback';
import configRoutes from './routes/config';

// 用户自定义路由
import userAgentsRoutes from './routes/user-agents';
import userSkillsRoutes from './routes/user-skills';
import userApiConfigRoutes from './routes/user-api-config';
import userAgentModelConfigsRoutes from './routes/user-agent-model-configs';
import userMcpRoutes from './routes/user-mcp';
import userDeveloperRoutes from './routes/user-developer';
import { projectionAccessPolicy, rejectProjectionAccess } from './middleware/projection-access.middleware';

// API路由
app.get('/api', (req, res) => {
  res.json({
    message: 'WenFlow API - Gateway',
    version: '2.0.0',
    architecture: 'Agent-Driven + Dynamic Navigation',
    authentication: 'JWT Bearer Token',
    endpoints: {
      health: '/health',
      liveness: '/livez',
      readiness: '/readyz',
      api: '/api',
      auth: '/api/auth',
      users: '/api/users',
      learning: '/api/learning',
      goalConversation: '/api/goal-conversation',
      state: '/api/state',
      achievements: '/api/achievements',
      metrics: '/api/metrics',
      agents: '/api/agents',
      feedback: '/api/feedback',
      userCustom: {
        agents: '/api/user/agents',
        skills: '/api/user/skills',
        apiConfig: '/api/user/api-config',
        mcp: '/api/user/mcp',
        developer: '/api/user/developer'
      }
    },
agents: {
      'skill:path-planning': '学习路径规划',
      'teaching-agent': 'AI授课编排',
      'skill:learner-model': '学习者画像与状态中心'
    },
    skills: [
      'stage-designer',
      'adaptive-guidance-copy',
      'lesson-knowledge-enricher'
    ]
  });
});

// 路由注册
const dashboardProjectionPolicy = projectionAccessPolicy({
  dashboardReadPaths: [
    '/stats',
    '/paths',
    '/current',
    '/copy',
    '/me',
    '/me/learner-center',
    '/me/sessions',
    '/sessions/active',
    '/sessions/history',
    '/sessions/:sessionId/detail',
    '/tasks/:taskId/evaluation/latest'
  ]
});

const directUserSessionOnly = rejectProjectionAccess('投影视角不允许访问账户、密钥或开发者配置');

// Platform 层路由 - 核心学习功能（平台内部调用）
app.use('/api/learning', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('platform'), learningRoutes);
app.use('/api/state', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('platform'), stateTrackingRoutes);
app.use('/api/achievements', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('platform'), achievementsRoutes);
app.use('/api/metrics', authMiddleware, acpContextMiddleware('platform'), metricsRoutes);
// 用户端公告（登录即可见，无平台策略限制）
app.use('/api/announcements', authMiddleware, announcementsRoutes);

// goal-conversation 路由（用户侧调用）
app.use('/api/goal-conversation', authMiddleware, acpContextMiddleware('user'), goalConversationRoutes);

// 其他路由（保持原有认证）
// 注意：具体路由必须在通用路由之前注册！
app.use('/api/auth', authRoutes);
// 公共配置路由（不需要认证，用于获取模型列表等）
app.use('/api/config', configRoutes);
// 管理员登录路由（应用本地访问限制中间件）
app.use('/api/admin-auth', adminAccessRestrictMiddleware, adminAuthRoutes);
const adminRouteMiddleware = [adminAccessRestrictMiddleware, adminAuthMiddleware, adminMiddleware, adminAuditMiddleware, acpContextMiddleware('admin')];
app.use('/api/admin/api-config', ...adminRouteMiddleware, adminApiConfigRoutes);
app.use('/api/admin/skills', ...adminRouteMiddleware, adminSkillsRoutes);
app.use('/api/admin/field-routings', ...adminRouteMiddleware, adminFieldRoutingsRoutes);
app.use('/api/admin/agent-prompts', ...adminRouteMiddleware, adminAgentPromptsRoutes);
app.use('/api/admin/runtime-definitions', ...adminRouteMiddleware, adminRuntimeDefinitionsRoutes);
app.use('/api/admin/prompt-ops', ...adminRouteMiddleware, adminPromptOpsRoutes);
app.use('/api/admin/skill-model-configs', ...adminRouteMiddleware, adminSkillModelConfigsRoutes);
app.use('/api/admin/users', ...adminRouteMiddleware, adminUsersRoutes);
app.use('/api/admin/sessions', ...adminRouteMiddleware, adminSessionsRoutes);
// 真实会话控制台同构端点：只读 GET，解析 teaching_sessions / goal_conversations（挂独立路径避免与 admin_sessions 冲突）
app.use('/api/admin/session-console', ...adminRouteMiddleware, adminSessionConsoleRoutes);
// 审计日志查询：仅 GET 只读端点，挂载时不经过 adminAuditMiddleware（审计查询本身不入审计，
// 中间件对 GET 同样落库），其余鉴权中间件照常
app.use('/api/admin/audit-logs', adminAccessRestrictMiddleware, adminAuthMiddleware, adminMiddleware, acpContextMiddleware('admin'), adminAuditLogsRoutes);
app.use('/api/admin/announcements', ...adminRouteMiddleware, adminAnnouncementsRoutes);
app.use('/api/admin/mcp', ...adminRouteMiddleware, adminMcpRoutes);
app.use('/api/admin/learner-models', ...adminRouteMiddleware, adminLearnerModelsRoutes);
app.use('/api/admin/memory-traces', ...adminRouteMiddleware, adminMemoryTracesRoutes);
app.use('/api/admin/goal-conversations', ...adminRouteMiddleware, adminGoalConversationsRoutes);
app.use('/api/admin/virtual-learners', ...adminRouteMiddleware, adminVirtualLearnersRoutes);
app.use('/api/admin/virtual-learners', ...adminRouteMiddleware, adminVirtualQuickLearnRoutes);
app.use('/api/admin/batch-experiments', ...adminRouteMiddleware, adminBatchExperimentsRoutes);
app.use('/api/admin/projection-access-grants', ...adminRouteMiddleware, adminProjectionAccessGrantsRoutes);
app.use('/api/admin/feedback', ...adminRouteMiddleware, adminFeedbackRoutes);
app.use('/api/admin/system', ...adminRouteMiddleware, adminSystemStatusRoutes);
app.use('/api/admin/health-center', ...adminRouteMiddleware, adminHealthCenterRoutes);
app.use('/api/admin/glossary', ...adminRouteMiddleware, adminGlossaryRoutes);
// 运维工具（时间推进模拟 / outbox 死信重放）：路由内部自带 /devtools 前缀，直接挂载到 /api/admin
app.use('/api/admin', ...adminRouteMiddleware, adminDevtoolsRoutes);
// 成就管理（成就定义 / 解锁记录 / 发放与撤回）：管理权限 + 审计中间件挂载
app.use('/api/admin/achievements', ...adminRouteMiddleware, adminAchievementsRoutes);
// 内容管理（学习路径治理）：管理权限 + 审计中间件挂载
app.use('/api/admin/learning-content', ...adminRouteMiddleware, adminLearningContentRoutes);
// 数据导出（CSV 下载）：管理权限 + 审计中间件挂载
app.use('/api/admin/export', ...adminRouteMiddleware, adminExportRoutes);
// 站内通知管理（全员/定向推送）：管理权限 + 审计中间件挂载
app.use('/api/admin/notifications', ...adminRouteMiddleware, adminNotificationsRoutes);
app.use('/api/admin/token-cost', ...adminRouteMiddleware, adminTokenCostRoutes);
app.use('/api/admin/prompt-lab', ...adminRouteMiddleware, promptLabRoutes);
app.use('/api/admin', ...adminRouteMiddleware, adminPlatformRoutes);
app.use('/api/users', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('user'), userRoutes);
app.use('/api/agents', authMiddleware, acpContextMiddleware('user'), agentsRoutes);
app.use('/api/adaptive-guidance', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('user'), adaptiveGuidanceRoutes);
app.use('/api/ai-teaching', authMiddleware, dashboardProjectionPolicy, acpContextMiddleware('user'), aiTeachingRoutes);
app.use('/api/notifications', authMiddleware, acpContextMiddleware('user'), notificationsRoutes);
app.use('/api/feedback', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), feedbackRoutes);


// 用户自定义路由
app.use('/api/user/agents', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userAgentsRoutes);
app.use('/api/user/skills', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userSkillsRoutes);
app.use('/api/user/api-config', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userApiConfigRoutes);
app.use('/api/user/agent-model-configs', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userAgentModelConfigsRoutes);
app.use('/api/user/mcp', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userMcpRoutes);
app.use('/api/user/developer', authMiddleware, directUserSessionOnly, acpContextMiddleware('user'), userDeveloperRoutes);

// 错误处理中间件
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // 记录错误日志（包含完整堆栈）
  logger.error('Request error:', {
    message: err.message,
    stack: err.stack,
    status: err.status,
    path: req.path,
    method: req.method
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 生产环境隐藏敏感信息
  if (isProduction) {
    res.status(err.status || 500).json({
      success: false,
      error: {
        message: '服务器错误，请稍后重试',
        code: err.code || 'INTERNAL_ERROR',
        status: err.status || 500
      }
    });
  } else {
    // 开发环境返回详细错误
    res.status(err.status || 500).json({
      success: false,
      error: {
        message: err.message || 'Internal Server Error',
        code: err.code || 'INTERNAL_ERROR',
        status: err.status || 500,
        stack: err.stack
      }
    });
  }
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
  const instance = createGateway(prisma, {
    ai: {
      baseUrl: process.env.AI_API_URL || 'http://localhost:3000',
      apiKey: process.env.AI_API_KEY || '',
      defaultModel: process.env.AI_MODEL || '',
      defaultReasoningModel: process.env.AI_MODEL_REASONING || '',
    }
  });
  gateway = instance;
  
  // 注册所有官方 Agent
  // 启动校验：manifest 必须合法（kind=agent 无 prompt，kind=skill 有 prompt 与 modelConfig）
  const manifestCheck = validateManifest();
  if (manifestCheck.ok === false) {
    logger.error('[startup] Agent manifest 校验失败，终止启动:');
    for (const err of manifestCheck.errors) {
      logger.error('  - ' + err);
    }
    throw new Error('Agent manifest 校验失败');
  }
  const topAgents = listTopLevelAgents();
  logger.info(`[startup] Agent manifest OK · ${topAgents.length} 个顶层 Agent: ${topAgents.map(a => a.id).join(', ')}`);

  // skills.yaml 户口簿校验（P0，SKILLS_YAML_SPEC §2.4 表 A）：F1~F10/F12 任一失败即终止启动
  // （fail-fast，与 field-routing import 期 fail-fast 同风格）。过渡开关 SKILLS_FILE_DISABLED=1
  // 跳过（规格 §5.3 回滚点，仅限一版发布窗口）。
  if (process.env.SKILLS_FILE_DISABLED === '1') {
    logger.info('[startup] skills.yaml 户口簿校验已跳过（SKILLS_FILE_DISABLED=1，过渡回滚点）');
  } else {
    const skillsBook = loadSkillsFile();
    const kindCounts = skillsBook.skills.reduce((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    logger.info(`[startup] skills.yaml 户口簿校验 OK · ${skillsBook.skills.length} 条活跃登记（kind 分布: ${Object.entries(kindCounts).map(([kind, count]) => `${kind}=${count}`).join(' ')})`);
  }

  await registerOfficialAgents({
    registerAgent: async (definition, handler) => {
      return instance.registerAgent(definition, handler);
    }
  });

  // 注册所有核心 Skill
  for (const definition of allSkillDefinitions) {
    const handler = skillHandlers[definition.name];
    if (handler) {
      await instance.registerSkill(definition, handler);
    }
  }

  
  // 加载已有的注册
  await instance.loadRegistrations();
  
  logger.info('✅ EduClaw Gateway initialized');
  
  return instance;
}

async function purgeRetiredSkills() {
  const retiredSkillNames = [...PURGED_SKILLS];
  const retiredAgentIds = retiredSkillNames.map((name) => `skill:${name}`);

  await Promise.all([
    systemPrisma.skill_registrations.deleteMany({ where: { name: { in: retiredSkillNames } } }),
    systemPrisma.skill_model_configs.deleteMany({ where: { skillId: { in: retiredSkillNames } } }),
    prisma.user_skill_configs.deleteMany({ where: { skillName: { in: retiredSkillNames } } }),
    systemPrisma.agent_prompts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    // 2026-08 统一化：退役 skill 的管道/契约残留一并清理（bootstrap 只建不更新，残留行不可达）
    systemPrisma.agent_field_routings.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    systemPrisma.agent_contracts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    // agent-snapshots.md 是自动生成的沙盘说明书（非 prompt 源），误入 agent_prompts 的行一并清理
    systemPrisma.agent_prompts.deleteMany({ where: { agentId: 'agent-snapshots' } })
  ]);

  logger.info('已清理退役 Skill 配置残留', {
    retiredSkillCount: retiredSkillNames.length
  });
}

function assertStartupActive() {
  if (lifecycle.isDraining()) throw new Error('服务已进入关闭流程，终止后续启动');
}

// 启动服务器
export async function startServer() {
  try {
    assertStartupActive();
    logger.info('Connecting to main and System databases...');
    await Promise.all([prisma.$connect(), systemPrisma.$connect()]);
    assertStartupActive();
    logger.info('✅ Main and System databases connected successfully');
    logRetentionService.start(lifecycle);
    auditCleanupService.start(lifecycle);
    virtualSessionReclaimService.start(lifecycle);
    startBatchExperimentScheduler();
    assertStartupActive();

    const backendRoot = resolve(__dirname, '..');
    const repoRoot = resolve(backendRoot, '..');
    const mainDatabasePath = resolveSqlitePath(process.env.DATABASE_URL, resolve(backendRoot, 'prisma'));
    const systemDatabasePath = resolveSqlitePath(process.env.SYSTEM_DATABASE_URL, resolve(backendRoot, 'prisma', 'system'));
    const sensitivePaths: SensitivePath[] = [
      { path: resolve(backendRoot, '.env'), kind: 'file' as const },
      { path: resolve(backendRoot, 'logs'), kind: 'directory' as const },
      { path: resolve(backendRoot, 'logs', 'combined.log'), kind: 'file' as const },
      { path: resolve(backendRoot, 'logs', 'error.log'), kind: 'file' as const },
      { path: resolve(repoRoot, 'prompts', 'backups'), kind: 'directory' as const },
      ...(mainDatabasePath ? [{ path: resolve(mainDatabasePath, '..'), kind: 'directory' as const }] : []),
      ...(systemDatabasePath ? [{ path: resolve(systemDatabasePath, '..'), kind: 'directory' as const }] : []),
      ...(mainDatabasePath ? [{ path: mainDatabasePath, kind: 'file' as const }] : []),
      ...(systemDatabasePath ? [{ path: systemDatabasePath, kind: 'file' as const }] : [])
    ].filter((target, index, items) => existsSync(target.path)
      && items.findIndex(item => item.path === target.path) === index);
    const permissionAuditDisabled =
      process.env.SKIP_PERMISSIONS_AUDIT === '1'
      || (process.env.SKIP_PERMISSIONS_AUDIT !== '0' && process.env.NODE_ENV !== 'production');
    if (permissionAuditDisabled) {
      logger.debug('敏感存储权限审计已跳过（dev 默认跳过；设置 SKIP_PERMISSIONS_AUDIT=0 强制启用，=1 强制禁用）');
    } else {
      const permissionFindings = await auditSensitivePaths(sensitivePaths);
      assertStartupActive();
      const unsafePermissions = permissionFindings.filter(finding => finding.status === 'too_open' || finding.status === 'error');
      if (unsafePermissions.length > 0) {
        logger.warn('敏感存储权限审计发现风险，请运行 npm run permissions:audit / permissions:repair', {
          findings: unsafePermissions
        });
      }
    }
    const networkPolicy = await refreshRuntimeNetworkPolicy();
    assertStartupActive();
    logger.info('运行时网络策略加载完成', {
      adminAccessMode: networkPolicy.adminAccessMode,
      allowPrivateNetwork: networkPolicy.allowPrivateNetwork,
      source: networkPolicy.source
    });

    const promptBootstrap = await ensureCoreAgentPrompts(systemPrisma, 'sync');
    assertStartupActive();
    logger.info('核心 Prompt 文件同步完成（File-as-Truth）', {
      mode: promptBootstrap.mode,
      performed: promptBootstrap.performed,
      reason: promptBootstrap.reason,
      createdCount: promptBootstrap.created?.length || 0,
      updatedCount: promptBootstrap.updated?.length || 0,
      skippedCount: promptBootstrap.skipped?.length || 0,
      missingBeforeCount: promptBootstrap.missingBefore?.length || 0,
      created: promptBootstrap.created,
      updated: promptBootstrap.updated || [],
    });

    const fieldRoutingBootstrap = await bootstrapFieldRoutings({ database: systemPrisma });
    assertStartupActive();
    logger.info('阶段字段路由 seed 完成（V3 §3）', fieldRoutingBootstrap);

    // 初始化管理员账户
    const adminBootstrap = await initializeAdmin();
    assertStartupActive();
    if (adminBootstrap.status === 'created') {
      logger.info('✅ 初始管理员创建成功', {
        adminId: adminBootstrap.adminId,
        name: adminBootstrap.name,
        email: adminBootstrap.email
      });
    } else if (adminBootstrap.status === 'existing') {
      logger.info('✅ 管理员账户已存在，跳过创建', { adminId: adminBootstrap.adminId });
    } else {
      logger.warn('未创建初始管理员：未配置 INIT_ADMIN_PASSWORD');
    }

      // 初始化 EduClaw Gateway
     await purgeRetiredSkills();
      // Seed-if-empty：新库自动写入 flash/pro 分工 + thinking=disabled（代码 truth；已有行跳过，admin 可改）
      await seedSkillModelConfigsIfEmpty(systemPrisma).catch((err) => {
        logger.warn('[startup] skill model config seed 失败（不阻断启动）', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      await initializeGateway();
      assertStartupActive();
      if (process.env.STARTUP_CANARY === '0') {
        logger.debug('[ai-capability] 启动金丝雀探测已跳过（STARTUP_CANARY=0）');
      } else {
        // 启动金丝雀：失败不阻断启动（能力状态由定时探测/首次真实请求校准）。
        // 2026-08-30：此前 await 超时会把 connectionStatus 写为 failed 并拖慢启动。
        await aiCapabilityHealthService.refresh().catch(error => {
          logger.warn('[ai-capability] 启动金丝雀探测失败（不阻断启动）', {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
      {
        const probeEnabled = await getRuntimeCapabilityProbeEnabled();
        await aiCapabilityHealthService.setEnabled(probeEnabled);
        if (!probeEnabled) {
          logger.info('[ai-capability] 探测定时器已禁用（默认关闭 / 连接与安全开关关闭），跳过 start()');
        }
      }
      assertStartupActive();
    
      const durableConsumers = new DurableEventConsumerRegistry();
      durableConsumers.register(['task:completed'], reconcileTaskCompletionMetric);
      // 断链修复 P0-1：复习结果事件消费者（写 learner_evidence + memory_traces，幂等）
      durableConsumers.register(['review:completed'], async (event) => {
        await reviewCompletedConsumer.handle(event);
      });
      durableConsumers.register([
        'goal:understanding:updated',
        'task:completed',
        'lesson:completed',
        'path:created',
        'path:generated',
        'path:adjusted',
        'path:completed'
      ], async (event) => {
        await learnerEvidenceProjector.handle(event);
        await lessonKnowledgeEnrichmentConsumer.handle(event);
        if (!event.userId) return;
        learnerProfileService.clear(event.userId);
        const data = event.data || {};
        await learnerSnapshotRefreshService.refresh({
          userId: event.userId,
          pathId: data.pathId || undefined,
          milestoneId: data.milestoneId || undefined,
          taskId: data.taskId || undefined,
          scope: data.pathId ? (data.taskId ? 'teaching' : 'path') : 'global',
          lastEventId: event.id,
          lastEventAt: event.occurredAt
        });
      });
      outboxWorker = new DurableOutboxWorker(durableConsumers);
      outboxWorker.start();

      // 回收因进程中断等原因遗留的 generating 路径
      await learningService.recoverStaleGeneratingPaths();
      assertStartupActive();

      // 标记因进程中断而遗留的虚拟账号自动学习运行（V1 不续跑）
      await quickLearnService.recoverInterruptedRuns();
      assertStartupActive();

      // 持续自动重试仍在阶段任务生成失败中的路径
      enrichmentRetryTimer = setInterval(() => {
        if (enrichmentRetryInFlight) return;
        const run = backgroundTaskTracker.track('learning.path.recovery-poll', () => learningService.recoverStaleGeneratingPaths()
          .then(() => learningService.retryEligibleFailedPathPreparations())
          .then(() => undefined))
          .catch((error) => {
            logger.warn('路径生成租约恢复与自动重试轮询失败', {
              error: error instanceof Error ? error.message : String(error)
            });
          }).then(() => undefined).finally(() => {
            if (enrichmentRetryInFlight === run) enrichmentRetryInFlight = null;
          });
        enrichmentRetryInFlight = run;
        void run;
      }, ENRICHMENT_RETRY_POLL_INTERVAL_MS);
      enrichmentRetryTimer.unref?.();

      runBackgroundTask('dashboard-guidance.startup-backfill', async () => {
        const result = await dashboardGuidanceSnapshotService.backfillMissingForActiveUsers(200);
        logger.info('首页引导快照回填完成', result);
      });

     assertStartupActive();
     await new Promise<void>((resolveServer, reject) => {
       const onError = (error: Error) => reject(error);
       const server = app.listen(PORT, () => {
         server.off('error', onError);
         resolveServer();
       });
       httpServer = server;
       server.once('error', onError);
     });
     assertStartupActive();
     lifecycle.markReady();
     logger.info(`🚀 Server is running on port ${PORT}`);
     logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
     logger.info(`🤖 EduClaw Gateway: Agent-Driven Architecture`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    await shutdown('startup_failure');
    throw error;
  }

}

// 优雅关闭
export async function shutdown(signal: string) {
  logger.info(`${signal} received. Draining server...`, { shutdownDeadlineMs });
  const report = await lifecycle.shutdown(signal, {
    httpServer,
    stopSchedulers: async () => {
      if (enrichmentRetryTimer) clearInterval(enrichmentRetryTimer);
      enrichmentRetryTimer = null;
      await logRetentionService.stop();
      await auditCleanupService.stop();
      await virtualSessionReclaimService.stop();
      await aiCapabilityHealthService.stop();
    },
    teaching: aiTeachingOrchestrator,
    backgroundTaskTracker,
    outbox: outboxWorker,
    gateway,
    databases: [systemPrisma, prisma]
  }, shutdownDeadlineMs);
  logger.info('Server shutdown completed', report);
  return report;
}

if (require.main === module) {
  const handleSignal = (signal: string) => {
    void shutdown(signal).then(report => {
      process.exit(report.timedOut || report.errors.length > 0 ? 1 : 0);
    }).catch(error => {
      logger.error('Server shutdown failed', { error });
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('uncaughtException', error => {
    logger.error('Uncaught exception, starting controlled shutdown', { error });
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });
  process.on('unhandledRejection', reason => {
    logger.error('Unhandled rejection, starting controlled shutdown', { reason });
    void shutdown('unhandledRejection').finally(() => process.exit(1));
  });
  void startServer().catch(() => process.exit(1));
}

export default app;
