import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { setTestMode, hasUserSession } from '../utils/api';
import { hasAdminSession } from '../api/adminApi';
import { setDebugMode } from '../utils/debugMode';
import { getProjectionToken } from '../utils/projection';

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

function syncThemeForRoute(_path: string) {
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
    meta: { title: '学习台', requiresAuth: true }
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
    meta: { title: '成就', requiresAuth: true }
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
    path: '/user',
    redirect: '/user/account',
    meta: { title: '个人中心', requiresAuth: true }
  },
  {
    path: '/user/account',
    name: 'UserAccount',
    component: () => import('@/views/Profile.vue'),
    meta: { title: '账户概览', requiresAuth: true }
  },
  {
    path: '/user/skills',
    name: 'UserSkills',
    component: () => import('@/views/user/Skills.vue'),
    meta: { title: 'Skill 管理', requiresAuth: true }
  },
  {
    path: '/user/agent-logs',
    name: 'UserAgentLogs',
    component: () => import('@/views/user/AgentLogs.vue'),
    meta: { title: '调用日志', requiresAuth: true }
  },
  {
    path: '/user/code-repo',
    redirect: '/user/developer',
    meta: { title: '开发者接入', requiresAuth: true }
  },
  {
    path: '/user/agents',
    name: 'UserAgents',
    component: () => import('@/views/user/AgentCustomization.vue'),
    meta: { title: 'AI 助手', requiresAuth: true }
  },
  {
    path: '/user/settings',
    name: 'UserSettings',
    component: () => import('@/views/user/Settings.vue'),
    meta: { title: 'API 接入', requiresAuth: true }
  },
  {
    path: '/user/developer',
    name: 'UserDeveloperAccess',
    component: () => import('@/views/user/DeveloperAccess.vue'),
    meta: { title: '开发者接入', requiresAuth: true }
  },
  {
    path: '/user/agent-model-settings',
    name: 'UserAgentModelSettings',
    component: () => import('@/views/user/AgentModelSettings.vue'),
    meta: { title: '高级模型', requiresAuth: true }
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
  {
    path: '/redesign-lab',
    name: 'RedesignLab',
    component: () => import('@/views/redesign/RedesignLab.vue'),
    meta: { title: '重设计稿 · 学习台与目标规划' }
  },
  {
    path: '/admin-redesign-lab',
    name: 'AdminRedesignLab',
    component: () => import('@/views/admin-redesign/AdminRedesignLab.vue'),
    meta: { title: '重设计稿 · Admin 风格探索' }
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
        meta: { title: '数据概览', requiresAdminAuth: true, adminGroup: 'overview' }
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/Users.vue'),
        meta: { title: '用户管理', requiresAdminAuth: true, adminGroup: 'ops' }
      },
      {
        path: 'learner-center',
        name: 'AdminLearnerCenter',
        component: () => import('@/views/admin/LearnerCenter.vue'),
        meta: { title: '学习者中心', requiresAdminAuth: true, adminGroup: 'ops' }
      },
      {
        path: 'learner-models',
        redirect: '/admin/learner-center?tab=models'
      },
      {
        path: 'learner-models/:userId',
        name: 'AdminLearnerModelDetail',
        component: () => import('@/views/admin/LearnerModelDetail.vue'),
        meta: { title: '学习者模型详情', requiresAdminAuth: true, adminGroup: 'ops' }
      },
      {
        path: 'teaching-sessions',
        redirect: '/admin/learner-center?tab=sessions'
      },
      {
        path: 'api-config',
        name: 'AdminApiConfig',
        component: () => import('@/views/admin/ApiConfig.vue'),
        meta: { title: '连接与安全', requiresAdminAuth: true, adminGroup: 'system' }
      },
      {
        path: 'skills',
        name: 'AdminAgentRegistry',
        component: () => import('@/views/admin/AgentRegistry.vue'),
        meta: { title: 'Skill 目录', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'skills/:agentId',
        name: 'AdminAgentEditor',
        component: () => import('@/views/admin/AgentEditor.vue'),
        meta: { title: 'Skill 编辑', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'agents/topology',
        name: 'AdminAgentTopology',
        component: () => import('@/views/admin/AgentTopology.vue'),
        meta: { title: 'Agent 拓扑', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'orchestrator-definitions',
        alias: 'agent-definitions',
        name: 'AdminOrchestratorDefinitions',
        component: () => import('@/views/admin/OrchestratorDefinitions.vue'),
        meta: { title: '编排结构', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'test/dashboard',
        name: 'AdminTestDashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '测试学习台', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'test/skill-prompt-preview',
        redirect: '/admin/skills'
      },
      {
        path: 'test/prompt-stability',
        redirect: '/admin/skills'
      },
      // 旧路径兼容重定向
      { path: 'agent-registry',          redirect: '/admin/skills' },
      { path: 'agent-registry/:agentId', redirect: (to) => `/admin/skills/${to.params.agentId}` },
      { path: 'skill-workbench',          redirect: '/admin/skills' },
      { path: 'skill-workbench/:agentId', redirect: (to) => `/admin/skills/${to.params.agentId}` },
      {
        path: 'test/goal-full/:conversationId?',
        name: 'AdminTestGoalConversationFull',
        component: () => import('@/views/GoalConversation.vue'),
        meta: { title: '测试目标规划', requiresAdminAuth: true, adminGroup: 'lab', contextMode: 'full', isTestMode: true }
      },
      {
        path: 'test/learning-paths',
        name: 'AdminTestLearningPaths',
        component: () => import('@/views/LearningPaths.vue'),
        meta: { title: '测试学习路径', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'test/learning-path/:id',
        name: 'AdminTestLearningPathDetail',
        component: () => import('@/views/LearningPathDetail.vue'),
        meta: { title: '测试学习路径详情', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'test/learning-state',
        name: 'AdminTestLearningState',
        component: () => import('@/views/LearningState.vue'),
        meta: { title: '测试学习状态', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
{
        path: 'test/achievements',
        name: 'AdminTestAchievements',
        component: () => import('@/views/Achievements.vue'),
        meta: { title: '测试成就', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'virtual-learners',
        name: 'AdminVirtualLearners',
        component: () => import('@/views/admin/VirtualLearners.vue'),
        meta: { title: '虚拟学习者', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'regression-lab',
        name: 'AdminRegressionLab',
        redirect: '/admin/agents/topology',
        meta: { title: '回归实验台', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-learners/:profileId/stories/:storyId',
        name: 'AdminVirtualStoryOverview',
        component: () => import('@/views/admin/VirtualProfile.vue'),
        meta: { title: '学情概览', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-learners/:profileId/stories/:storyId/goal',
        name: 'AdminVirtualStoryGoal',
        redirect: (to) => `/admin/virtual-learners/${to.params.profileId}/stories/${to.params.storyId}`,
        meta: { title: 'Goal 学情', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-learners/:profileId/stories/:storyId/path',
        name: 'AdminVirtualStoryPath',
        redirect: (to) => `/admin/virtual-learners/${to.params.profileId}/stories/${to.params.storyId}`,
        meta: { title: 'Path 学情', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-learners/:profileId/stories/:storyId/learn',
        name: 'AdminVirtualStoryLearn',
        redirect: (to) => `/admin/virtual-learners/${to.params.profileId}/stories/${to.params.storyId}`,
        meta: { title: 'Learn 学情', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-learners/:profileId',
        name: 'AdminVirtualProfile',
        component: () => import('@/views/admin/VirtualProfile.vue'),
        meta: { title: '画像', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'virtual-session/:sessionId',
        name: 'AdminVirtualSession',
        component: () => import('@/views/admin/SessionCockpit.vue'),
        meta: { title: '模拟会话控制台', requiresAdminAuth: true, adminGroup: 'lab' }
      },
      {
        path: 'test/learn/:taskId',
        name: 'AdminTestLearningPage',
        component: () => import('@/views/LearningPage.vue'),
        meta: { title: '测试授课页面', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'test/learn/:taskId/evaluation/:sessionId',
        name: 'AdminTestLearningEvaluationPage',
        component: () => import('@/views/LearningEvaluationPage.vue'),
        meta: { title: '测试课程评估', requiresAdminAuth: true, adminGroup: 'lab', isTestMode: true }
      },
      {
        path: 'execution-logs',
        name: 'AdminExecutionLogs',
        component: () => import('@/views/admin/ExecutionLogs.vue'),
        meta: { title: '执行日志', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'path-generation-events',
        name: 'AdminPathGenerationEvents',
        component: () => import('@/views/admin/PathGenerationEvents.vue'),
        meta: { title: '流程事件', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'prompt-call-logs',
        name: 'AdminPromptCallLogs',
        component: () => import('@/views/admin/PromptCallLogs.vue'),
        meta: { title: 'Prompt 调用日志', requiresAdminAuth: true, adminGroup: 'monitor' }
      },
      {
        path: 'skill-model-configs',
        name: 'AdminSkillModelConfigs',
        component: () => import('@/views/admin/SkillModelConfig.vue'),
        meta: { title: '外挂能力组件', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'prompt-lab',
        name: 'AdminPromptLab',
        component: () => import('@/views/admin/PromptInspector.vue'),
        meta: { title: 'Prompt 检视与 Dry Run', requiresAdminAuth: true, adminGroup: 'ai' }
      },
      {
        path: 'skill-manager',
        redirect: '/admin/skills',
      },
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在' }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path === from.path && to.hash === from.hash) return false;
    if (to.hash) return { el: to.hash };
    return { left: 0, top: 0 };
  }
});

router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || '问流 WenFlow'} - 问流 WenFlow`;
  syncThemeForRoute(to.path);
  const usesAdminSurface = to.path.startsWith('/admin/')
    && to.path !== '/admin/login'
    && !to.path.startsWith('/admin/test/');
  document.body.classList.toggle('admin-route', usesAdminSurface);
  
  setTestMode(to.meta.isTestMode === true);
  setDebugMode(to.meta.isTestMode === true);
  if (!to.meta.isTestMode) {
    import('@/stores/debug').then(({ useDebugStore }) => {
      const debugStore = useDebugStore();
      debugStore.clear();
    });
  }
  
  const hasSession = hasUserSession();
  const projectionToken = getProjectionToken();
  const adminSession = hasAdminSession();

  // 管理平台路由检查
  if (to.meta.requiresAdminAuth) {
    if (!adminSession) {
      next({ path: '/admin/login', query: { redirect: to.fullPath } });
      return;
    }
    next();
    return;
  }

  // 普通用户路由检查
  if (to.meta.requiresAuth && !hasSession && !projectionToken) {
    next({ path: '/login', query: { redirect: to.fullPath } });
    return;
  }

  // 已登录用户访问登录/注册页
  if ((to.name === 'Login' || to.name === 'Register') && (hasSession || projectionToken)) {
    next('/dashboard');
    return;
  }

  // 已登录管理员访问管理登录页
  if (to.name === 'AdminLogin' && adminSession) {
    next('/admin/dashboard');
    return;
  }
  
  next();
});

export default router;
