import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { setTestMode } from '../utils/api';

const THEME_STORAGE_KEY = 'wenflow-theme';

function applyDocumentTheme(theme: 'light' | 'dark') {
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  html.classList.toggle('dark', theme === 'dark');
}

function resolveUserTheme(): 'light' | 'dark' {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null;
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function syncThemeForRoute(path: string) {
  if (path.startsWith('/admin')) {
    applyDocumentTheme('light');
    return;
  }

  applyDocumentTheme(resolveUserTheme());
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '首页' }
  },
  {
    path: '/vision',
    name: 'Vision',
    component: () => import('@/views/Vision.vue'),
    meta: { title: '愿景' }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/Register.vue'),
    meta: { title: '注册' }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: '控制台', requiresAuth: true }
  },
  {
    path: '/learning-paths',
    name: 'LearningPaths',
    component: () => import('@/views/LearningPaths.vue'),
    meta: { title: '学习路径', requiresAuth: true }
  },
  {
    path: '/test/learning-paths',
    name: 'TestLearningPaths',
    redirect: '/admin/test/learning-paths',
    meta: { title: '学习路径测试', requiresAuth: true, isTestMode: true }
  },
  {
    path: '/learning-state',
    name: 'LearningState',
    component: () => import('@/views/LearningState.vue'),
    meta: { title: '学习状态', requiresAuth: true }
  },
  {
    path: '/achievements',
    name: 'Achievements',
    component: () => import('@/views/Achievements.vue'),
    meta: { title: '成就系统', requiresAuth: true }
  },
  {
    path: '/learning-path/:id',
    name: 'LearningPathDetail',
    component: () => import('@/views/LearningPathDetail.vue'),
    meta: { title: '学习路径详情', requiresAuth: true }
  },
  {
    path: '/test/learning-path/:id',
    name: 'TestLearningPathDetail',
    redirect: (to) => `/admin/test/learning-path/${to.params.id}`,
    meta: { title: '学习路径详情测试', requiresAuth: true, isTestMode: true }
  },
  {
    path: '/learn/:taskId',
    name: 'LearningPage',
    component: () => import('@/views/LearningPage.vue'),
    meta: { title: '学习中', requiresAuth: true }
  },
  {
    path: '/learn/:taskId/evaluation/:sessionId',
    name: 'LearningEvaluationPage',
    component: () => import('@/views/LearningEvaluationPage.vue'),
    meta: { title: '课程评估', requiresAuth: true }
  },
  {
    path: '/ui-lab',
    name: 'UILabHome',
    redirect: '/admin/ui-lab',
    meta: { title: 'UI Lab 首页', uiLabSceneId: 'home' }
  },
  {
    path: '/ui-lab/vision',
    name: 'UILabVision',
    redirect: '/admin/ui-lab/vision',
    meta: { title: 'UI Lab 愿景', uiLabSceneId: 'vision' }
  },
  {
    path: '/ui-lab/login',
    name: 'UILabLogin',
    redirect: '/admin/ui-lab/login',
    meta: { title: 'UI Lab 登录', uiLabSceneId: 'login' }
  },
  {
    path: '/ui-lab/register',
    name: 'UILabRegister',
    redirect: '/admin/ui-lab/register',
    meta: { title: 'UI Lab 注册', uiLabSceneId: 'register' }
  },
  {
    path: '/ui-lab/dashboard',
    name: 'UILabDashboard',
    redirect: '/admin/ui-lab/dashboard',
    meta: { title: 'UI Lab 学习台', uiLabSceneId: 'dashboard' }
  },
  {
    path: '/ui-lab/planning',
    name: 'UILabPlanning',
    redirect: '/admin/ui-lab/planning',
    meta: { title: 'UI Lab AI 规划', uiLabSceneId: 'requirement' }
  },
  {
    path: '/ui-lab/planning-immersive',
    redirect: '/admin/ui-lab/planning'
  },
  {
    path: '/ui-lab/planning-formal',
    redirect: '/admin/ui-lab/planning'
  },
  {
    path: '/ui-lab/paths',
    name: 'UILabPaths',
    redirect: '/admin/ui-lab/paths',
    meta: { title: 'UI Lab 学习路径', uiLabSceneId: 'paths' }
  },
  {
    path: '/ui-lab/paths/:id',
    name: 'UILabPathDetail',
    redirect: (to) => `/admin/ui-lab/paths/${to.params.id}`,
    meta: { title: 'UI Lab 路径详情', uiLabSceneId: 'path-detail' }
  },
  {
    path: '/ui-lab/state',
    name: 'UILabState',
    redirect: '/admin/ui-lab/state',
    meta: { title: 'UI Lab 学习状态', uiLabSceneId: 'state' }
  },
  {
    path: '/ui-lab/achievements',
    name: 'UILabAchievements',
    redirect: '/admin/ui-lab/achievements',
    meta: { title: 'UI Lab 成就', uiLabSceneId: 'achievements' }
  },
  {
    path: '/ui-lab/learn/:taskId',
    name: 'UILabLearning',
    redirect: (to) => `/admin/ui-lab/learn/${to.params.taskId}`,
    meta: { title: 'UI Lab 学习中', uiLabSceneId: 'learning' }
  },
  {
    path: '/ui-lab/feedback',
    name: 'UILabFeedback',
    redirect: '/admin/ui-lab/feedback',
    meta: { title: 'UI Lab 学习反馈', uiLabSceneId: 'evaluation' }
  },
  {
    path: '/ui-lab/dashboard-legacy',
    redirect: '/admin/ui-lab/dashboard'
  },
  {
    path: '/ui-lab/question-cards',
    name: 'QuestionCardUILab',
    redirect: '/admin/ui-lab/question-cards',
    meta: { title: 'UI Lab 问题卡片' }
  },
  {
    path: '/user',
    redirect: '/user/account',
    meta: { title: '能力中心', requiresAuth: true }
  },
  {
    path: '/user/account',
    name: 'UserAccount',
    component: () => import('@/views/Profile.vue'),
    meta: { title: '账户概览', requiresAuth: true }
  },
  {
    path: '/user/skills',
    redirect: '/user/agent-logs',
    meta: { title: 'Skills 管理', requiresAuth: true }
  },
  {
    path: '/user/agent-logs',
    name: 'UserAgentLogs',
    component: () => import('@/views/user/AgentLogs.vue'),
    meta: { title: '执行日志', requiresAuth: true }
  },
  {
    path: '/user/code-repo',
    redirect: '/user/agent-logs',
    meta: { title: '代码仓库', requiresAuth: true }
  },
  {
    path: '/user/agents',
    redirect: '/user/agent-logs',
    meta: { title: '托管 Agent 选择', requiresAuth: true }
  },
  {
    path: '/user/settings',
    redirect: '/user/agent-logs',
    meta: { title: '能力接入', requiresAuth: true }
  },
  {
    path: '/user/developer',
    redirect: '/user/agent-logs',
    meta: { title: '开发者接入', requiresAuth: true }
  },
  {
    path: '/user/agent-model-settings',
    name: 'UserAgentModelSettings',
    component: () => import('@/views/user/AgentModelSettings.vue'),
    meta: { title: '模型偏好设置', requiresAuth: true }
  },
  {
    path: '/goal-conversation/:conversationId?',
    name: 'GoalConversation',
    component: () => import('@/views/GoalConversation.vue'),
    meta: { title: '目标规划', requiresAuth: true }
  },
  {
    path: '/test/goal-conversation/:conversationId?',
    name: 'GoalConversationTest',
    redirect: (to) => {
      const conversationId = typeof to.params.conversationId === 'string' ? `/${to.params.conversationId}` : '';
      return `/admin/test/goal-full${conversationId}`;
    },
    meta: { title: '目标规划测试', requiresAuth: true }
  },
  {
    path: '/test/goal-full/:conversationId?',
    name: 'TestGoalConversationFull',
    redirect: (to) => {
      const conversationId = typeof to.params.conversationId === 'string' ? `/${to.params.conversationId}` : '';
      return `/admin/test/goal-full${conversationId}`;
    },
    meta: { title: '全量上下文测试', requiresAuth: true, contextMode: 'full', isTestMode: true }
  },
  {
    path: '/docs',
    name: 'DeveloperDocs',
    component: () => import('@/views/DeveloperDocs.vue'),
    meta: { title: '开发者文档' }
  },
  {
    path: '/design-lab',
    name: 'DesignLab',
    component: () => import('@/views/DesignLab.vue'),
    meta: { title: '设计实验室' }
  },
  // 管理平台路由
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/admin/Login.vue'),
    meta: { title: '管理员登录' }
  },
  {
    path: '/admin',
    name: 'AdminLayout',
    component: () => import('@/views/admin/Dashboard.vue'),
    meta: { title: '管理平台', requiresAdminAuth: true },
    redirect: '/admin/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'AdminDashboard',
        component: () => import('@/views/admin/Overview.vue'),
        meta: { title: '数据概览', requiresAdminAuth: true, adminGroup: 'content' }
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/Users.vue'),
        meta: { title: '用户管理', requiresAdminAuth: true, adminGroup: 'content' }
      },
      {
        path: 'learner-models',
        name: 'AdminLearnerModels',
        component: () => import('@/views/admin/LearnerModels.vue'),
        meta: { title: '学习者模型', requiresAdminAuth: true, adminGroup: 'content' }
      },
      {
        path: 'learner-models/:userId',
        name: 'AdminLearnerModelDetail',
        component: () => import('@/views/admin/LearnerModelDetail.vue'),
        meta: { title: '学习者模型详情', requiresAdminAuth: true, adminGroup: 'content' }
      },
      {
        path: 'teaching-sessions',
        name: 'AdminTeachingSessions',
        component: () => import('@/views/admin/TeachingSessions.vue'),
        meta: { title: '教学会话巡检', requiresAdminAuth: true, adminGroup: 'content' }
      },
      {
        path: 'api-config',
        name: 'AdminApiConfig',
        component: () => import('@/views/admin/ApiConfig.vue'),
        meta: { title: 'API 管理', requiresAdminAuth: true, adminGroup: 'system' }
      },
{
        path: 'agent-registry',
        name: 'AdminAgentRegistry',
        component: () => import('@/views/admin/AgentRegistry.vue'),
        meta: { title: 'Agent 注册管理', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'orchestrator-registry',
        name: 'AdminOrchestratorRegistry',
        component: () => import('@/views/admin/OrchestratorRegistry.vue'),
        meta: { title: '编排器管理', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'agent-definitions',
        name: 'AdminAgentDefinitions',
        component: () => import('@/views/admin/AgentDefinitions.vue'),
        meta: { title: '运行时定义', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'orchestrator-definitions',
        name: 'AdminOrchestratorDefinitions',
        component: () => import('@/views/admin/OrchestratorDefinitions.vue'),
        meta: { title: '编排定义', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'ui-lab',
        name: 'AdminUILabHome',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 首页', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'home' }
      },
      {
        path: 'ui-lab/vision',
        name: 'AdminUILabVision',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 愿景', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'vision' }
      },
      {
        path: 'ui-lab/login',
        name: 'AdminUILabLogin',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 登录', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'login' }
      },
      {
        path: 'ui-lab/register',
        name: 'AdminUILabRegister',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 注册', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'register' }
      },
      {
        path: 'ui-lab/dashboard',
        name: 'AdminUILabDashboard',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 学习台', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'dashboard' }
      },
      {
        path: 'ui-lab/planning',
        name: 'AdminUILabPlanning',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab AI 规划', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'requirement' }
      },
      {
        path: 'ui-lab/paths',
        name: 'AdminUILabPaths',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 学习路径', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'paths' }
      },
      {
        path: 'ui-lab/paths/:id',
        name: 'AdminUILabPathDetail',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 路径详情', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'path-detail' }
      },
      {
        path: 'ui-lab/state',
        name: 'AdminUILabState',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 学习状态', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'state' }
      },
      {
        path: 'ui-lab/achievements',
        name: 'AdminUILabAchievements',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 成就', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'achievements' }
      },
      {
        path: 'ui-lab/learn/:taskId',
        name: 'AdminUILabLearning',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 学习中', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'learning' }
      },
      {
        path: 'ui-lab/feedback',
        name: 'AdminUILabFeedback',
        component: () => import('@/views/DemoScenePage.vue'),
        meta: { title: 'UI Lab 学习反馈', requiresAdminAuth: true, adminGroup: 'system', uiLabSceneId: 'evaluation' }
      },
      {
        path: 'ui-lab/question-cards',
        name: 'AdminQuestionCardUILab',
        component: () => import('@/views/QuestionCardDemo.vue'),
meta: { title: 'UI Lab 问题卡片', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'test/dashboard',
        name: 'AdminTestDashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '测试学习台', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
{
        path: 'test/prompt-stability',
        name: 'AdminPromptStability',
        component: () => import('@/views/admin/PromptStability.vue'),
        meta: { title: 'Prompt 稳定性', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'test/goal-full/:conversationId?',
        name: 'AdminTestGoalConversationFull',
        component: () => import('@/views/GoalConversation.vue'),
        meta: { title: '测试目标规划', requiresAdminAuth: true, adminGroup: 'devDebug', contextMode: 'full', isTestMode: true }
      },
      {
        path: 'test/learning-paths',
        name: 'AdminTestLearningPaths',
        component: () => import('@/views/admin/test/TestLearningPaths.vue'),
        meta: { title: '测试学习路径', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'test/learning-path/:id',
        name: 'AdminTestLearningPathDetail',
        component: () => import('@/views/admin/test/TestLearningPathDetail.vue'),
        meta: { title: '测试学习路径详情', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'test/learning-state',
        name: 'AdminTestLearningState',
        component: () => import('@/views/LearningState.vue'),
        meta: { title: '测试学习状态', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
{
        path: 'test/achievements',
        name: 'AdminTestAchievements',
        component: () => import('@/views/Achievements.vue'),
        meta: { title: '测试成就', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'virtual-learners',
        name: 'AdminVirtualLearners',
        component: () => import('@/views/admin/VirtualLearners.vue'),
        meta: { title: '虚拟用户模拟', requiresAdminAuth: true, adminGroup: 'devDebug' }
      },
      {
        path: 'virtual-learners/:profileId',
        name: 'AdminVirtualProfile',
        component: () => import('@/views/admin/VirtualProfile.vue'),
        meta: { title: '角色会话管理', requiresAdminAuth: true, adminGroup: 'devDebug' }
      },
      {
        path: 'virtual-session/:sessionId',
        name: 'AdminVirtualSession',
        component: () => import('@/views/admin/VirtualSession.vue'),
        meta: { title: '模拟会话控制台', requiresAdminAuth: true, adminGroup: 'devDebug' }
      },
      {
        path: 'test/learn/:taskId',
        name: 'AdminTestLearningPage',
        component: () => import('@/views/LearningPage.vue'),
        meta: { title: '测试授课页面', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'test/learn/:taskId/evaluation/:sessionId',
        name: 'AdminTestLearningEvaluationPage',
        component: () => import('@/views/LearningEvaluationPage.vue'),
        meta: { title: '测试课程评估', requiresAdminAuth: true, adminGroup: 'devDebug', isTestMode: true }
      },
      {
        path: 'execution-logs',
        name: 'AdminExecutionLogs',
        component: () => import('@/views/admin/ExecutionLogs.vue'),
        meta: { title: 'Agent 执行日志', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'prompt-call-logs',
        name: 'AdminPromptCallLogs',
        component: () => import('@/views/admin/PromptCallLogs.vue'),
        meta: { title: 'Prompt 调用日志', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'orchestrators',
        name: 'AdminOrchestrators',
        component: () => import('@/views/admin/Orchestrators.vue'),
        meta: { title: '编排器视图', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'manifest-diagnostics',
        name: 'AdminManifestDiagnostics',
        component: () => import('@/views/admin/ManifestDiagnostics.vue'),
        meta: { title: 'Agent 架构诊断(高级)', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'activity-stream',
        name: 'AdminActivityStream',
        component: () => import('@/views/admin/ActivityStream.vue'),
        meta: { title: '活动流', requiresAdminAuth: true, adminGroup: 'monitor' }
},

      {
        path: 'skill-model-configs',
        name: 'AdminSkillModelConfigs',
        component: () => import('@/views/admin/SkillModelConfig.vue'),
        meta: { title: 'Skill 模型配置', requiresAdminAuth: true, adminGroup: 'system' }
      },
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  document.title = `${to.meta.title || '问流 WenFlow'} - 问流 WenFlow`;
  syncThemeForRoute(to.path);
  
  setTestMode(to.meta.isTestMode === true);
  
  const token = localStorage.getItem('token');
  const adminToken = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
  
  // 管理平台路由检查
  if (to.meta.requiresAdminAuth) {
    if (!adminToken) {
      next('/admin/login');
      return;
    }
    next();
    return;
  }
  
  // 普通用户路由检查
  if (to.meta.requiresAuth && !token) {
    next('/login');
    return;
  }
  
  // 已登录用户访问登录/注册页
  if ((to.name === 'Login' || to.name === 'Register') && token) {
    next('/dashboard');
    return;
  }
  
  // 已登录管理员访问管理登录页
  if (to.name === 'AdminLogin' && adminToken) {
    next('/admin/dashboard');
    return;
  }
  
  next();
});

export default router;
