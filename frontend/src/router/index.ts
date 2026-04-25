import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '首页' }
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
    path: '/learn/:taskId',
    name: 'LearningPage',
    component: () => import('@/views/LearningPage.vue'),
    meta: { title: '学习中', requiresAuth: true }
  },
  {
    path: '/demo/question-cards',
    name: 'QuestionCardDemo',
    component: () => import('@/views/QuestionCardDemo.vue'),
    meta: { title: '问题卡片演示' }
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
    path: '/goal-conversation',
    name: 'GoalConversation',
    component: () => import('@/views/GoalConversation.vue'),
    meta: { title: '目标规划', requiresAuth: true }
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
        meta: { title: '数据概览', requiresAdminAuth: true }
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/Users.vue'),
        meta: { title: '用户管理', requiresAdminAuth: true }
      },
      {
        path: 'learner-models',
        name: 'AdminLearnerModels',
        component: () => import('@/views/admin/LearnerModels.vue'),
        meta: { title: '学习者模型', requiresAdminAuth: true }
      },
      {
        path: 'learner-models/:userId',
        name: 'AdminLearnerModelDetail',
        component: () => import('@/views/admin/LearnerModelDetail.vue'),
        meta: { title: '学习者模型详情', requiresAdminAuth: true }
      },
      {
        path: 'teaching-sessions',
        name: 'AdminTeachingSessions',
        component: () => import('@/views/admin/TeachingSessions.vue'),
        meta: { title: '教学会话调试', requiresAdminAuth: true }
      },
      {
        path: 'api-config',
        name: 'AdminApiConfig',
        component: () => import('@/views/admin/ApiConfig.vue'),
        meta: { title: 'API 管理', requiresAdminAuth: true }
      },
      {
        path: 'agents',
        redirect: '/admin/agent-registry'
      },
      {
        path: 'agent-registry',
        name: 'AdminAgentRegistry',
        component: () => import('@/views/admin/AgentRegistry.vue'),
        meta: { title: 'Agent 注册管理', requiresAdminAuth: true }
      },
      {
        path: 'conversations',
        redirect: '/admin/dashboard'
      },
      {
        path: 'execution-logs',
        name: 'AdminExecutionLogs',
        component: () => import('@/views/admin/ExecutionLogs.vue'),
        meta: { title: 'Agent 执行日志', requiresAdminAuth: true }
      },
      {
        path: 'orchestrators',
        name: 'AdminOrchestrators',
        component: () => import('@/views/admin/Orchestrators.vue'),
        meta: { title: '编排器视图', requiresAdminAuth: true }
      },
      {
        path: 'manifest-diagnostics',
        name: 'AdminManifestDiagnostics',
        component: () => import('@/views/admin/ManifestDiagnostics.vue'),
        meta: { title: '架构诊断', requiresAdminAuth: true }
      },

      {
        path: 'sandbox',
        redirect: '/admin/dashboard'
      },
      {
        path: 'debug-sandbox',
        redirect: '/admin/dashboard'
      },
      {
        path: 'debug-sandbox/:id',
        redirect: '/admin/dashboard'
      },
      {
        path: 'arena',
        redirect: '/admin/dashboard'
      },
      {
        path: 'arena/:id',
        redirect: '/admin/dashboard'
      },
      {
        path: 'student-state',
        redirect: '/admin/dashboard'
      },
      {
        path: 'skills',
        redirect: '/admin/dashboard'
      },
      {
        path: 'agent-lab',
        redirect: '/admin/dashboard'
      },
      {
        path: 'agent-model-configs',
        name: 'AdminAgentModelConfigs',
        component: () => import('@/views/admin/AgentModelConfig.vue'),
        meta: { title: 'Agent 模型配置', requiresAdminAuth: true }
      },
      {
        path: 'class-test',
        name: 'AdminClassTest',
        component: () => import('@/views/ClassTest.vue'),
        meta: { title: 'AI 授课测试', requiresAdminAuth: true }
      }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  document.title = `${to.meta.title || '问流 WenFlow'} - 问流 WenFlow`;
  
  const token = localStorage.getItem('token');
  const adminToken = localStorage.getItem('admin_token');
  
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
