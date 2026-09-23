/**
 * API 路由注册（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：集中注册全部业务路由与挂载顺序。约定：
 * - 具体路由必须在通用路由之前注册（/api/admin 平台路由在 devtools/platform 之前）；
 * - admin 路由统一走五重中间件链（access-restrict + auth + role + audit + acp-context）；
 * - 投影视角（dashboardProjectionPolicy / directUserSessionOnly）限制账户与密钥类端点。
 */
import type express from 'express';
import authRoutes from '../routes/auth';
import learningRoutes from '../routes/learning';
import userRoutes from '../routes/users';
import stateTrackingRoutes from '../routes/state-tracking.routes';
import achievementsRoutes from '../routes/achievements';
import metricsRoutes from '../routes/metrics';
import goalConversationRoutes from '../routes/goal-conversation';
import materialsRoutes from '../routes/materials.routes';
import agentsRoutes from '../routes/agents';
import adaptiveGuidanceRoutes from '../routes/adaptive-guidance.routes';
import adminAuthRoutes from '../routes/admin-auth';
import adminApiConfigRoutes from '../routes/admin/api-config';
import adminSkillsRoutes from '../routes/admin/skills';
import adminFieldRoutingsRoutes from '../routes/admin/field-routings';
import adminAgentPromptsRoutes from '../routes/admin/agent-prompts';
import adminRuntimeDefinitionsRoutes from '../routes/admin/runtime-definitions';
import promptLabRoutes from '../routes/prompt-lab';
import adminPromptOpsRoutes from '../routes/admin/prompt-ops';
import adminSkillModelConfigsRoutes from '../routes/admin/skill-model-configs';
import adminPlatformRoutes from '../routes/admin/platform';
import adminGoalConversationsRoutes from '../routes/admin/goal-conversations';
import adminUsersRoutes from '../routes/admin/users';
import adminSessionsRoutes from '../routes/admin/sessions';
import adminAuditLogsRoutes from '../routes/admin/audit-logs';
import adminLearnerModelsRoutes from '../routes/admin/learner-models';
import adminMemoryTracesRoutes from '../routes/admin/memory-traces';
import adminMemoryReviewRoutes from '../routes/admin/memory-review';
import adminAnnouncementsRoutes from '../routes/admin/announcements';
import announcementsRoutes from '../routes/announcements';
import adminVirtualLearnersRoutes from '../routes/admin/virtual-learners';
import adminModelRegistryRoutes from '../routes/admin/model-registry';
import adminSessionConsoleRoutes from '../routes/admin/session-console';
import adminVirtualQuickLearnRoutes from '../routes/admin/virtual-quick-learn';
import adminBatchExperimentsRoutes from '../routes/admin/batch-experiments';
import adminProjectionAccessGrantsRoutes from '../routes/admin/projection-access-grants';
import adminFeedbackRoutes from '../routes/admin/feedback';
import adminSystemStatusRoutes from '../routes/admin/system-status';
import adminMcpRoutes from '../routes/admin/mcp';
import adminHealthCenterRoutes from '../routes/admin/health-center';
import adminGlossaryRoutes from '../routes/admin/glossary';
import adminDevtoolsRoutes from '../routes/admin/devtools';
import adminAchievementsRoutes from '../routes/admin/achievements';
import adminLearningContentRoutes from '../routes/admin/learning-content';
import adminExportRoutes from '../routes/admin/export';
import adminTokenCostRoutes from '../routes/admin/token-cost';
import adminNotificationsRoutes from '../routes/admin/notifications';
import notificationsRoutes from '../routes/notifications';
import aiTeachingRoutes from '../routes/ai-teaching.routes';
import feedbackRoutes from '../routes/feedback';
import configRoutes from '../routes/config';

// 用户自定义路由
import userAgentsRoutes from '../routes/user-agents';
import userSkillsRoutes from '../routes/user-skills';
import userApiConfigRoutes from '../routes/user-api-config';
import userAgentModelConfigsRoutes from '../routes/user-agent-model-configs';
import userMcpRoutes from '../routes/user-mcp';
import userDeveloperRoutes from '../routes/user-developer';
import { acpContextMiddleware } from '../middleware/acp-context.middleware';
import { adminAuthMiddleware, authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { adminAccessRestrictMiddleware } from '../middleware/admin-access-restrict.middleware';
import { adminAuditMiddleware } from '../middleware/admin-audit.middleware';
import { projectionAccessPolicy, rejectProjectionAccess } from '../middleware/projection-access.middleware';

export function registerRoutes(app: express.Express): void {
  // API 文档入口
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

  // 上传资料路由（用户侧调用；只支持文本型文档，扫描件/老格式在接口层拒收并告知）
  app.use('/api/materials', authMiddleware, acpContextMiddleware('user'), materialsRoutes);

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
  app.use('/api/admin/memory-review', ...adminRouteMiddleware, adminMemoryReviewRoutes);
  app.use('/api/admin/goal-conversations', ...adminRouteMiddleware, adminGoalConversationsRoutes);
  app.use('/api/admin/virtual-learners', ...adminRouteMiddleware, adminVirtualLearnersRoutes);
  app.use('/api/admin/model-registry', ...adminRouteMiddleware, adminModelRegistryRoutes);
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
}
