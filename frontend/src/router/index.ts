import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { useUserStore } from '../stores/user';
import { hasAdminSession } from '../api/adminApi';
import { getProjectionToken } from '../utils/projection';
import { applyDocumentTheme, readTheme } from '../utils/theme';

function syncThemeForRoute(_path: string) {
  applyDocumentTheme(readTheme());
}

/** 拆页重定向用：去掉 query 里的 tab 键（tab 已映射为目标页面路径） */
function stripTab(to: { query: Record<string, unknown> }): Record<string, unknown> {
  const q: Record<string, unknown> = { ...to.query }
  delete q.tab
  return q
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
    path: '/onboarding',
    name: 'V2Onboarding',
    component: () => import('@/views/v2/V2Onboarding.vue'),
    meta: { title: '开始使用', requiresAuth: true }
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
    path: '/learning-state',
    name: 'V2LearningState',
    component: () => import('@/views/v2/V2LearningState.vue'),
    meta: { title: '学习状态', requiresAuth: true }
  },
  {
    // 用户侧知识图谱**聚合页**（全部路径；学习页里的图谱只看当前路径）
    path: '/knowledge-map',
    name: 'V2KnowledgeMap',
    component: () => import('@/views/v2/V2KnowledgeMap.vue'),
    meta: { title: '知识图谱', requiresAuth: true }
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
    /* P2-32（设计评审 4.2）：页内容已含密码/注销/MCP，页名「设置」名实相符；
       「API 接入」降为页内第一个分区的 H3 名 */
    meta: { title: '设置', requiresAuth: true }
  },
  {
    // 成就 / 学习历史收在个人中心（走 CapabilityShell 分段导航）
    path: '/user/achievements',
    name: 'UserAchievements',
    component: () => import('@/views/v2/V2Achievements.vue'),
    meta: { title: '成就', requiresAuth: true }
  },
  {
    path: '/user/learning-history',
    name: 'UserLearningHistory',
    component: () => import('@/views/v2/V2LearningHistory.vue'),
    meta: { title: '学习历史', requiresAuth: true }
  },
  // 旧个人中心路径 → 正式 /user/* 路径（书签/外链兼容）
  { path: '/profile', redirect: '/user/account' },
  { path: '/settings', redirect: '/user/settings' },
  { path: '/agent-logs', redirect: '/user/agent-logs' },
  // 旧顶层路径 → 个人中心（书签/外链兼容）
  { path: '/achievements', redirect: '/user/achievements' },
  { path: '/learning-history', redirect: '/user/learning-history' },
  {
    path: '/goal-conversation/:conversationId?',
    name: 'V2GoalConversation',
    component: () => import('@/views/v2/V2GoalConversation.vue'),
    meta: { title: '目标规划', requiresAuth: true }
  },
  {
    path: '/library',
    name: 'V2Library',
    component: () => import('@/views/v2/V2Library.vue'),
    meta: { title: '资料库', requiresAuth: true }
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
    redirect: '/user/achievements'
  },
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/admin-redesign/Login.vue'),
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
    // Skill 详情深链兼容（2026-10-15 设计页平铺后收敛）：原独立整页 /admin/skills/:agentId
    // 与独立设计页 /admin/skills?view=skill-design&id= 均退役，能力已平铺进 Skill 详情页
    // /admin/skills?view=skill&id=。旧 ?tab=（protocol/trial/versions/runtime/engineering/routing
    // + 历史别名）映射进详情页独立键 ?skdTab=。
    path: '/admin/skills/:agentId+',
    redirect: (to) => {
      const rawId = to.params.agentId
      const id = Array.isArray(rawId) ? String(rawId[0] ?? '') : String(rawId ?? '')
      const q: Record<string, string> = { view: 'skill', id }
      const tab = typeof to.query.tab === 'string' ? to.query.tab : ''
      if (tab) q.skdTab = tab
      return { path: '/admin/skills', query: q }
    }
  },
  // ===== 旧 URL 别名区 =====
  // 这里只为书签/外链兼容保留重定向：每条一行「旧 → 新」，不写日期与原因；
  // 页面新增、下线、改名的历史统一记在 CHANGELOG.md。
  // 旧版带参数路由 → 新平级页面（参数型无法被 /admin/:page 吸收）
  // 旧深链：people?tab=state → /admin/learner-state
  {
    path: '/admin/learner-models/:userId?',
    redirect: '/admin/learner-state'
  },
  {
    // 旧路径：/admin/users → /admin/people
    path: '/admin/users',
    redirect: '/admin/people'
  },
  {
    path: '/admin/learner-center',
    redirect: '/admin/learner-state'
  },
  {
    // 旧合并宿主：/admin/sessions（tab 映射到对应独立页）
    path: '/admin/sessions',
    redirect: (to) => {
      const tab = typeof to.query.tab === 'string' ? to.query.tab : ''
      if (tab === 'conversations') return { path: '/admin/goal-conversations', query: stripTab(to) }
      if (tab === 'paths') return { path: '/admin/learning-paths', query: stripTab(to) }
      return { path: '/admin/teaching-sessions', query: stripTab(to) }
    }
  },
  {
    // 旧注册表：/admin/agent-registry → 编排图
    path: '/admin/agent-registry/:agentId?',
    redirect: () => ({ path: '/admin/orchestrator', query: { tab: 'topology' } })
  },
  {
    // 旧工作台详情深链：改投 Skill 详情二级页（2026-10-15；与上面 /admin/skills/:agentId 同源）。
    // 原设计页独立形态退役，落点统一为 view=skill（设计能力已平铺进该页）。
    path: '/admin/skill-workbench/:agentId',
    redirect: (to) => ({
      path: '/admin/skills',
      query: { view: 'skill', id: to.params.agentId as string }
    })
  },
  {
    // 旧拓扑页：/admin/topology → 编排图
    path: '/admin/topology',
    redirect: () => ({ path: '/admin/orchestrator', query: { tab: 'topology' } })
  },
  {
    // 旧命名：/admin/prompt-workbench → /admin/skill-workbench
    path: '/admin/prompt-workbench',
    redirect: '/admin/skill-workbench'
  },
  {
    // 会话座舱是二级页（非 URL 页面）：旧深链落到虚拟学习者宿主 + sub-page query，
    // 由 AdminConsole 的 ?view=&id= 契约恢复座舱（view=session = 虚拟会话控制台）
    path: '/admin/virtual-session/:sessionId',
    redirect: (to) => ({ path: '/admin/virtual-learners', query: { view: 'session', id: String(to.params.sessionId) } })
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
    // 旧事件中心：/admin/event-center → 执行日志
    path: '/admin/event-center',
    redirect: '/admin/execution-logs'
  },
  {
    // 直觉 URL → 实际 scene ID（query 透传，如 ?refresh=1 强制刷新）
    path: '/admin/health',
    redirect: (to) => ({ path: '/admin/health-center', query: to.query })
  },
  {
    path: '/admin/traces',
    redirect: '/admin/execution-logs'
  },
  {
    // 旧 Trace 页：/admin/trace-waterfall → 执行日志
    path: '/admin/trace-waterfall',
    redirect: '/admin/execution-logs'
  },
  // 旧批量实验页：/admin/batch-experiments → 虚拟学习者列表
  {
    path: '/admin/batch-experiments',
    redirect: (to) => ({ path: '/admin/virtual-learners', query: to.query })
  },
  {
    path: '/admin/models',
    redirect: '/admin/api-config'
  },
  {
    // 外挂能力 2026-10-19 从「模型与接入」宿主拆回独立页（用户拍板：「拆出来，作为单页，
    // 放到 skill 那边」），/admin/addons 回归为真实场景路径（由 /admin/:page? → AdminConsole
    // 按场景 id 解析，见 manifest「外挂能力」）；此处不再重定向。
    // 旧外部路径 /admin/external-capabilities 是同一个页面的别名，改投本页。
    path: '/admin/external-capabilities',
    redirect: (to) => ({ path: '/admin/addons', query: to.query })
  },
  {
    path: '/admin/orchestration',
    redirect: '/admin/orchestrator'
  },
  {
    // 合并后旧路径兼容：运维工具/数据导出/会话安全 → 运营中心对应 tab
    // （2026-10-16 用户拍板「系统工具」场景解散并入运营中心；深链带 tab 由 OpsHub 恢复子视图）
    path: '/admin/ops-center',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: (to.query.tab as string) || 'tools' } })
  },
  {
    path: '/admin/devtools',
    redirect: () => ({ path: '/admin/ops-hub', query: { tab: 'tools' } })
  },
  {
    path: '/admin/export-data',
    redirect: () => ({ path: '/admin/ops-hub', query: { tab: 'export' } })
  },
  {
    // 旧内容管理 URL → /admin/learning-paths
    path: '/admin/content',
    redirect: '/admin/learning-paths'
  },
  {
    path: '/admin/ops-content',
    redirect: '/admin/learning-paths'
  },
  {
    // 旧公告 / 站内通知 URL → 运营中心宿主 tab
    path: '/admin/announcements',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'announce' } })
  },
  {
    path: '/admin/notifications',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'inapp' } })
  },
  {
    path: '/admin/messages',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'announce' } })
  },
  {
    // 反馈中心折入「运营中心」宿主 tab
    path: '/admin/feedback',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'feedback' } })
  },
  {
    // 成就管理折入「运营中心」宿主 tab
    path: '/admin/ops-achievements',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'achievements' } })
  },
  {
    path: '/admin/achievements',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'achievements' } })
  },
  {
    // 会话安全并入「运营中心」宿主 tab（保留 ?user= 深链筛选）
    path: '/admin/session-security',
    redirect: (to) => ({ path: '/admin/ops-hub', query: { ...to.query, tab: 'security' } })
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
/* #20（跟踪单 #45）：≤1023px 挂着底部 dock 的页面，滚动发生在 .v2-page 容器内部
   （v2.css 把滚动视口收窄到底栏上沿）。window 的 scrollY 恒为 0，Vue Router 的
   savedPosition 因此对这类页面无效——不补这一段，浏览器「后退」会丢失原来的滚动位置。
   键用 history.state 的 position+current（Vue Router/浏览器为每个历史条目提供，单调且稳定）。 */
function dockScroller(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>('.v2-page:has(> .v2nav__dock)');
  if (!el) return null;
  // 桌面档 dock 仍在 DOM（display:none），但 .v2-page 不是滚动容器（overflow:visible）——
  // 只有窄屏 v2.css 把 overflow-y 设成 auto 时才算「容器滚动」。
  return getComputedStyle(el).overflowY === 'auto' ? el : null;
}

function dockScrollKey(): string | null {
  const state = window.history.state as { position?: number; current?: string } | null;
  if (!state || !Number.isFinite(state.position)) return null;
  return `wf:dockScroll:${state.position}:${state.current || ''}`;
}

function saveDockScrollPosition() {
  const el = dockScroller();
  const key = dockScrollKey();
  if (!el || !key) return;
  try {
    sessionStorage.setItem(key, String(el.scrollTop));
  } catch {
    /* 隐私模式/配额满：恢复失败最多回到顶部，不影响导航 */
  }
}

/* 滚动时按「当时的历史条目」记账。不能放在 beforeEach：popstate 已经把 history.state
   切到目标条目，而 DOM 还是旧页面，会把旧页面的位置写到目标条目的键上。 */
let dockScrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', () => {
    if (dockScrollSaveTimer) return;
    dockScrollSaveTimer = setTimeout(() => {
      dockScrollSaveTimer = null;
      saveDockScrollPosition();
    }, 60);
  }, { passive: true, capture: true });
}

/* 回退页的数据是异步拉的：nextTick 时页面可能还没有内容高度，直接写 scrollTop 会被钳回 0。
   在 1.5s 内逐帧重试，直到写入生效（或用户自己滚出非 0 位置）即停。 */
function applyDockScrollTop(el: HTMLElement, top: number) {
  if (!(top > 0)) return;
  const deadline = Date.now() + 1500;
  const attempt = () => {
    if (!el.isConnected || Date.now() > deadline) return;
    el.scrollTop = top;
    if (el.scrollTop === 0) requestAnimationFrame(attempt);
  };
  attempt();
}

/* 等新页面挂载后再判断：目标若是窄屏 dock 页，就把位置写回容器（.v2-page）；
   否则交回 Vue Router 原来的 window 位置（savedPosition / 回顶），非 dock 页行为不变。 */
async function restoreDockScrollPosition(
  fallback: { left: number; top: number }
): Promise<{ left: number; top: number } | void> {
  await nextTick();
  const el = dockScroller();
  if (!el) return fallback;
  const key = dockScrollKey();
  let top = 0;
  if (key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) top = Number(raw) || 0;
    } catch {
      /* 读不到就回顶 */
    }
  }
  applyDockScrollTop(el, top);
}

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (to.path === from.path && to.hash === from.hash) return false;
    if (to.hash) return { el: to.hash };
    return restoreDockScrollPosition(savedPosition ?? { left: 0, top: 0 });
  }
});

router.beforeEach(async (to, _from, next) => {
  /* 退役 tab 老深链（健康检查/漂移/对账）→ 健康中心独立页。
     此前改投写在 Skills.vue 的 query watch 里，要等控制台首屏启动完、Skills 场景挂载后才发生，
     实测 3-5s 内用户先看到的是目标错误的页面；路由级在导航瞬间完成改投（2026-09-29 功能走查）。 */
  if (to.path === '/admin/skills') {
    const retiredTab = typeof to.query.tab === 'string' ? to.query.tab : '';
    if (retiredTab === 'health' || retiredTab === 'drift' || retiredTab === 'recon') {
      const query = { ...to.query };
      delete query.tab;
      next({ path: '/admin/health-center', query });
      return;
    }
  }
  /* 退役 tab 老深链（?tab=addons）→ 外挂能力独立页（2026-10-19 用户拍板从模型与接入拆出）。
     与上面健康中心同款：路由级改投，别等宿主挂载后由 query watch 兜（那样用户会先看到
     目标错误的「接入与模型」页签）。 */
  if (to.path === '/admin/api-config' && to.query.tab === 'addons') {
    const query = { ...to.query };
    delete query.tab;
    next({ path: '/admin/addons', query });
    return;
  }
  document.title = `${to.meta.title || '问流 WenFlow'} - 问流 WenFlow`;
  syncThemeForRoute(to.path);
  const usesAdminSurface = to.path.startsWith('/admin/') && to.path !== '/admin/login';
  document.body.classList.toggle('admin-route', usesAdminSurface);

  /* ISSUE-12:标记缺失时用 HttpOnly cookie 自举恢复会话(标记+档案),有效会话不再误弹登录页。
     管理端不用学习者会话(判据是 hasAdminSession),这里若照常自举,每个管理页导航都会
     打一条注定 401 的 /api/users/me——巡检实测 60 条失败请求全是它。
     #34（2026-10-15 走查）：同族的浪费还在公开页——游客打开 `/`、`/login`、`/register`
     每次整页加载都要探一次注定 401 的 /users/me，控制台留下报错观感，且多一次无意义请求。
     故自举只做在「真的需要会话」的路由上：只有受保护路由（缺会话会被拦，必须知道有没有）；
     公开页一律不探。标记被清但 cookie 仍有效的那类用户，落在公开页不再被自动登入（点一下登录
     即可），一旦走到任何受保护路由即刻自举——ISSUE-12 要保证的「有效会话不误弹登录页」
     仍成立，只让出公开页这一次网络往返。 */
  const isAdminRoute = to.path.startsWith('/admin');
  const hasSession = isAdminRoute
    ? false
    : to.meta.requiresAuth === true
      ? await useUserStore().restoreFromCookie()
      : useUserStore().hasSession;
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

  // 新用户引导：已登录但未完成 onboarding → 强制跳转到引导页（自身除外）
  if (to.meta.requiresAuth && hasSession && to.path !== '/onboarding') {
    try {
      // 审计 #10：档案经 user store 缓存（onboardingCompleted 已知即命中），
      // 完成回写/登录拉取/登出清空沿 store 生命周期失效，高频导航不再重复请求
      const profile = await useUserStore().ensureProfile();
      if (profile?.onboardingCompleted === false) {
        next({ path: '/onboarding', query: { redirect: to.fullPath } });
        return;
      }
    } catch {
      /* 获取 profile 失败不阻塞正常导航 */
    }
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

/* 路由切换后把焦点交给主内容容器（WCAG 2.4.3 / 4.1.3）：
   键盘与读屏用户导航后焦点不再滞留在旧页链接上，新页标题可被立即播报。
   app-main 带 tabindex="-1"（App.vue 预留的 skip-link 落点），
   程序化 focus 不匹配 :focus-visible，不会画出焦点环。 */
router.afterEach((to, from) => {
  if (to.path === from.path) return; // 仅路径变化（hash/query 变更不打断当前阅读）
  nextTick(() => {
    document.getElementById('app-main')?.focus({ preventScroll: true });
  });
});

export default router;
