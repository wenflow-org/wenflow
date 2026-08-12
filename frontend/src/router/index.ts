import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { hasUserSession } from '../utils/api';
import { hasAdminSession } from '../api/adminApi';
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
    component: () => import('@/views/HomeNext.vue'),
    meta: { title: '首页' }
  },
  {
    path: '/vision',
    name: 'Vision',
    component: () => import('@/views/VisionNext.vue'),
    meta: { title: '愿景' }
  },
  // 新稿预览地址 → 正式路径
  {
    path: '/next',
    redirect: '/'
  },
  {
    path: '/next/vision',
    redirect: '/vision'
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/v2/V2Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/v2/V2Register.vue'),
    meta: { title: '注册' }
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/v2/V2ResetPassword.vue'),
    meta: { title: '找回密码' }
  },
  {
    path: '/dashboard',
    name: 'V2Dashboard',
    component: () => import('@/views/v2/V2Dashboard.vue'),
    meta: { title: '学习台', requiresAuth: true }
  },
  {
    path: '/learning-paths',
    name: 'V2LearningPaths',
    component: () => import('@/views/v2/V2LearningPaths.vue'),
    meta: { title: '学习路径', requiresAuth: true }
  },
  {
    path: '/learning-history',
    name: 'V2LearningHistory',
    component: () => import('@/views/v2/V2LearningHistory.vue'),
    meta: { title: '学习历史', requiresAuth: true }
  },
  {
    path: '/learning-state',
    name: 'V2LearningState',
    component: () => import('@/views/v2/V2LearningState.vue'),
    meta: { title: '学习状态', requiresAuth: true }
  },
  {
    path: '/achievements',
    name: 'V2Achievements',
    component: () => import('@/views/v2/V2Achievements.vue'),
    meta: { title: '成就', requiresAuth: true }
  },
  {
    path: '/learning-path/:id',
    name: 'V2LearningPathDetail',
    component: () => import('@/views/v2/V2LearningPathDetail.vue'),
    meta: { title: '学习路径详情', requiresAuth: true }
  },
  {
    path: '/learn/:taskId',
    name: 'V2LearningPage',
    component: () => import('@/views/v2/V2LearningPage.vue'),
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
    meta: { title: '账户', requiresAuth: true }
  },
  {
    path: '/user/agent-logs',
    name: 'UserAgentLogs',
    component: () => import('@/views/user/AgentLogs.vue'),
    meta: { title: '调用日志', requiresAuth: true }
  },
  {
    path: '/user/settings',
    name: 'UserSettings',
    component: () => import('@/views/user/Settings.vue'),
    meta: { title: 'API 接入', requiresAuth: true }
  },
  {
    path: '/goal-conversation/:conversationId?',
    name: 'V2GoalConversation',
    component: () => import('@/views/v2/V2GoalConversation.vue'),
    meta: { title: '目标规划', requiresAuth: true }
  },
  {
    path: '/docs',
    name: 'DeveloperDocs',
    component: () => import('@/views/DeveloperDocs.vue'),
    meta: { title: '开发者文档' }
  },
  // ===== /v2 已上线：旧地址全部重定向到正式路径 =====
  {
    path: '/v2',
    redirect: '/dashboard'
  },
  {
    path: '/v2/dashboard',
    redirect: '/dashboard'
  },
  {
    path: '/v2/goal-conversation/:conversationId?',
    redirect: (to) => ({ path: `/goal-conversation/${to.params.conversationId || ''}`, query: to.query })
  },
  {
    path: '/v2/learning-paths',
    redirect: (to) => ({ path: '/learning-paths', query: to.query })
  },
  {
    path: '/v2/learning-path/:id',
    redirect: (to) => ({ path: `/learning-path/${to.params.id}`, query: to.query })
  },
  {
    path: '/v2/learn/:taskId',
    redirect: (to) => ({ path: `/learn/${to.params.taskId}`, query: to.query })
  },
  {
    path: '/v2/learning-state',
    redirect: '/learning-state'
  },
  {
    path: '/v2/achievements',
    redirect: '/achievements'
  },
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/admin/Login.vue'),
    meta: { title: '管理员登录' }
  },
  {
    path: '/admin',
    redirect: '/admin/overview'
  },
  // 旧版 /admin/console/:page → 新平级 URL（书签/外链兼容）
  {
    path: '/admin/console/:page?',
    redirect: (to) => ({ path: `/admin/${(to.params.page as string) || 'overview'}` })
  },
  {
    // Prompt 二级设计页（Skill 级编辑台：检视/试运行/运行时/工程，重设计版）
    // agentId 必填：避免 /admin/skills（Skill 目录）被可选参数吞入设计页
    path: '/admin/skills/:agentId+',
    name: 'AdminSkillEditor',
    component: () => import('@/views/admin-redesign/SkillDesignPage.vue'),
    meta: { title: 'Prompt 设计', requiresAdminAuth: true }
  },
  // 旧版带参数路由 → 新平级页面（参数型无法被 /admin/:page 吸收，保留重定向）
  {
    path: '/admin/learner-models/:userId?',
    redirect: '/admin/learner-center'
  },
  {
    path: '/admin/agent-registry/:agentId?',
    redirect: '/admin/topology'
  },
  {
    path: '/admin/skill-workbench/:agentId?',
    redirect: (to) => ({ path: to.params.agentId ? `/admin/skills/${to.params.agentId}` : '/admin/skills' })
  },
  {
    path: '/admin/virtual-session/:sessionId',
    redirect: '/admin/virtual-learners'
  },
  {
    // 旧深链兜底：虚拟学习者子页（原 :pathMatch 捕获，至少一段避免空匹配自循环）→ 列表页
    path: '/admin/virtual-learners/:pathMatch(.*)+',
    redirect: '/admin/virtual-learners'
  },
  {
    // Prompt 调用已并入执行日志（同 traceId 关联契约维度）
    path: '/admin/prompt-call-logs',
    redirect: '/admin/execution-logs'
  },
  {
    // 事件中心下线：路径生成事件无业务消费价值，统一入口走执行日志
    path: '/admin/event-center',
    redirect: '/admin/execution-logs'
  },
  {
    // 管理控制台：/admin/:page 反映当前页面（深链/前进后退），动态段置于静态路由之后
    path: '/admin/:page?',
    name: 'AdminConsole',
    component: () => import('@/views/admin-redesign/AdminConsole.vue'),
    meta: { title: '管理控制台', requiresAdminAuth: true }
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
  const usesAdminSurface = to.path.startsWith('/admin/') && to.path !== '/admin/login';
  document.body.classList.toggle('admin-route', usesAdminSurface);

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
    next('/admin/overview');
    return;
  }
  
  next();
});

export default router;
