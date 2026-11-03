/**
 * Admin 路由冒烟（真实 router 实例 + 内存历史）：
 * - 新旧 URL 重定向完整性（/admin、/admin/console/:page、已下线页面）
 * - /admin/:page 主路由与 /admin/skills/:agentId 设计页路由解析
 * - requiresAdminAuth 守卫：无会话 → /admin/login 重定向，有会话 → 放行
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import router from '../index';
import { ADMIN_SESSION_KEY, adminAuthApi, hasAdminSession } from '@/api/adminApi';

function setAdminSession(on: boolean) {
  if (on) {
    localStorage.setItem(ADMIN_SESSION_KEY, '1');
    sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
  } else {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

beforeEach(() => {
  /* 路由守卫 router.beforeEach 内会调用 useUserStore().restoreFromCookie()(ISSUE-12
     会话自举),测试裸驱动 router 时需先挂 active pinia(restoreFromCookie 自带
     try/catch,接口失败优雅返回 false,不产生网络副作用) */
  setActivePinia(createPinia());
  setAdminSession(true);
});

afterEach(() => {
  setAdminSession(false);
});

describe('Admin 路由重定向', () => {
  it('/admin 解析到 AdminConsole 路由（无 page 参数，组件内回退 overview）', async () => {
    // 注：/admin/:page?（可选参数）在 vue-router 评分中先于静态 /admin 命中，
    // 静态 redirect 记录不生效——由 AdminConsole 组件自身回退 overview（冒烟测试覆盖）
    await router.push('/admin');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('');
  });

  it('/admin/console/:page → 新平级 URL（书签/外链兼容）', async () => {
    await router.push('/admin/console/skills');
    expect(router.currentRoute.value.path).toBe('/admin/skills');
  });

  it('/admin/console（无 page）→ /admin/overview', async () => {
    await router.push('/admin/console');
    expect(router.currentRoute.value.path).toBe('/admin/overview');
  });

  it('已下线页面重定向到执行日志', async () => {
    await router.push('/admin/event-center');
    expect(router.currentRoute.value.path).toBe('/admin/execution-logs');
    await router.push('/admin/prompt-call-logs');
    expect(router.currentRoute.value.path).toBe('/admin/execution-logs');
  });

  it('/admin/prompt-workbench → /admin/skill-workbench（阶段 2B N1 改名兼容重定向）', async () => {
    await router.push('/admin/prompt-workbench');
    expect(router.currentRoute.value.path).toBe('/admin/skill-workbench');
  });

  it('/admin/topology → /admin/orchestrator（旧拓扑页改投总览，不再带 ?tab=topology 掉进某阶段旅程）', async () => {
    await router.push('/admin/topology');
    expect(router.currentRoute.value.path).toBe('/admin/orchestrator');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it('/admin/agent-registry/:id → /admin/orchestrator（旧注册表路由兼容，不带页签）', async () => {
    await router.push('/admin/agent-registry/goal-agent');
    expect(router.currentRoute.value.path).toBe('/admin/orchestrator');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it('/admin/skill-workbench/:agentId → Skill 详情二级页（旧工作台详情深链兼容；设计页已平铺）', async () => {
    await router.push('/admin/skill-workbench/goal-agent');
    expect(router.currentRoute.value.path).toBe('/admin/skills');
    expect(router.currentRoute.value.query).toMatchObject({ view: 'skill', id: 'goal-agent' });
  });

  it('导航收敛旧 URL 重定向（2026-09-04 合并 + 2026-09-29 学习会话拆回独立页 + 2026-10-04 学习状态拆出独立页）', async () => {
    await router.push('/admin/users');
    expect(router.currentRoute.value.path).toBe('/admin/people');
    // 2026-10-04 学习状态拆页后 People 回归单视图，tab=account / tab=state 一律就地归零（People.vue 同口径）
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    await router.push('/admin/learner-center');
    expect(router.currentRoute.value.path).toBe('/admin/learner-state');
    await router.push('/admin/learner-models/u1');
    expect(router.currentRoute.value.path).toBe('/admin/learner-state');
    // 2026-09-29 拆页：教学会话/目标对话/学习路径各自成场景，旧合并 URL /admin/sessions 反向重定向
    await router.push('/admin/sessions');
    expect(router.currentRoute.value.path).toBe('/admin/teaching-sessions');
    await router.push('/admin/sessions?tab=conversations');
    expect(router.currentRoute.value.path).toBe('/admin/goal-conversations');
    await router.push('/admin/sessions?tab=paths');
    expect(router.currentRoute.value.path).toBe('/admin/learning-paths');
    await router.push('/admin/content');
    expect(router.currentRoute.value.path).toBe('/admin/learning-paths');
    await router.push('/admin/ops-content');
    expect(router.currentRoute.value.path).toBe('/admin/learning-paths');
    await router.push('/admin/announcements');
    expect(router.currentRoute.value.path).toBe('/admin/ops-hub');
    expect(router.currentRoute.value.query.tab).toBe('announce');
    await router.push('/admin/notifications');
    expect(router.currentRoute.value.path).toBe('/admin/ops-hub');
    expect(router.currentRoute.value.query.tab).toBe('inapp');
    // 2026-09-29 拆页：token-cost 旧重定向退役，成本分析独立成场景
    await router.push('/admin/token-cost');
    expect(router.currentRoute.value.path).toBe('/admin/token-cost');
  });

  it('导航一级收敛（阶段 1）：退役场景 URL 重定向到对应宿主 + tab', async () => {
    const cases: Array<[string, string, string]> = [
      ['/admin/feedback', '/admin/ops-hub', 'feedback'],
      ['/admin/ops-achievements', '/admin/ops-hub', 'achievements'],
      ['/admin/achievements', '/admin/ops-hub', 'achievements'],
      ['/admin/messages', '/admin/ops-hub', 'announce'],
      ['/admin/announcements', '/admin/ops-hub', 'announce'],
      ['/admin/notifications', '/admin/ops-hub', 'inapp'],
      // 2026-10-19：「外挂能力」从「模型与接入」宿主拆回独立页 —— /admin/addons 不再是重定向，
      // 而是真实场景路径（下面单独断言）；旧外部别名 /admin/external-capabilities 改投本页。
      // 2026-11-01：运维工具/数据导出/会话安全/访问与注册 从运营中心迁入「系统设置」
      ['/admin/session-security', '/admin/system-settings', 'security'],
      ['/admin/ops-center', '/admin/system-settings', 'tools'],
      ['/admin/devtools', '/admin/system-settings', 'tools'],
      ['/admin/export-data', '/admin/system-settings', 'export'],
    ];
    for (const [from, toPath, tab] of cases) {
      await router.push(from);
      expect(router.currentRoute.value.path, `${from} 未重定向到 ${toPath}`).toBe(toPath);
      expect(router.currentRoute.value.query.tab, `${from} tab 应为 ${tab}`).toBe(tab);
    }
  });

  it('外挂能力拆回独立页（2026-10-19）：/admin/addons 是真实场景路径，旧别名与 ?tab=addons 改投', async () => {
    // 真实路径不再重定向（由 /admin/:page? → AdminConsole 按场景 id 解析）
    await router.push('/admin/addons');
    expect(router.currentRoute.value.path).toBe('/admin/addons');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    // 旧外部别名
    await router.push('/admin/external-capabilities');
    expect(router.currentRoute.value.path).toBe('/admin/addons');
    // 老书签：宿主页签键改投独立页，且不残留 tab（否则落到 api-config 的默认页签）
    await router.push('/admin/api-config?tab=addons');
    expect(router.currentRoute.value.path).toBe('/admin/addons');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it('退役场景深链保留业务 query（会话安全 ?user= 透传）', async () => {
    await router.push('/admin/session-security?user=admin');
    expect(router.currentRoute.value.path).toBe('/admin/system-settings');
    expect(router.currentRoute.value.query.tab).toBe('security');
    expect(router.currentRoute.value.query.user).toBe('admin');
  });

  it('改名/拆页后的旧深链仍在路由层改投：api-config?tab=security / skills?tab=prompt-eval', async () => {
    await router.push('/admin/api-config?tab=security');
    expect(router.currentRoute.value.path).toBe('/admin/system-settings');
    expect(router.currentRoute.value.query.tab).toBe('access');

    /* Prompt 评估 2026-11-01 下线：?tab=prompt-eval 落回 Skill 目录（tab 键与页内键 peTab 都清掉，
       否则会在已下线的页签上留一个空壳或把无效内层键带给宿主页） */
    await router.push('/admin/skills?tab=prompt-eval&peTab=runs');
    expect(router.currentRoute.value.path).toBe('/admin/skills');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(router.currentRoute.value.query.peTab).toBeUndefined();
  });

  it('模型与接入并入系统设置（2026-11-01）：/admin/api-config 与 /admin/models 落到首页签', async () => {
    await router.push('/admin/models');
    expect(router.currentRoute.value.path).toBe('/admin/system-settings');
    expect(router.currentRoute.value.query.tab).toBe('api');

    // 旧页签键（model / registry / runtime / access…）都只是「打开这一页」，一律回到首页签
    for (const legacy of ['model', 'registry', 'connection', 'overview', 'runtime', 'model-routing']) {
      await router.push(`/admin/api-config?tab=${legacy}`);
      expect(router.currentRoute.value.path, `tab=${legacy}`).toBe('/admin/system-settings');
      expect(router.currentRoute.value.query.tab, `tab=${legacy}`).toBe('api');
    }

    // virtual 是迁出去的页签：直接到虚拟学习者，不在本页停一下
    await router.push('/admin/api-config?tab=virtual');
    expect(router.currentRoute.value.path).toBe('/admin/virtual-learners');
    expect(router.currentRoute.value.query.tab).toBeUndefined();

    // 无 tab 参数同样落首页签
    await router.push('/admin/api-config');
    expect(router.currentRoute.value.path).toBe('/admin/system-settings');
    expect(router.currentRoute.value.query.tab).toBe('api');
  });

  it('运营中心四个系统页签的老深链改投系统设置（2026-11-01 拆页）', async () => {
    for (const t of ['tools', 'export', 'security', 'access']) {
      await router.push(`/admin/ops-hub?tab=${t}`);
      expect(router.currentRoute.value.path, `tab=${t}`).toBe('/admin/system-settings');
      expect(router.currentRoute.value.query.tab, `tab=${t}`).toBe(t);
    }
    // 内容运营五页签仍留在运营中心
    for (const t of ['todo', 'feedback', 'achievements', 'announce', 'inapp']) {
      await router.push(`/admin/ops-hub?tab=${t}`);
      expect(router.currentRoute.value.path, `tab=${t}`).toBe('/admin/ops-hub');
    }
  });

  it('已下线场景 /admin/prompt-eval 本身也改投 Skill 目录', async () => {
    await router.push('/admin/prompt-eval');
    expect(router.currentRoute.value.path).toBe('/admin/skills');
  });

  it('访问与注册独立页深链改投系统设置 access 页签', async () => {
    await router.push('/admin/access-control?foo=bar');
    expect(router.currentRoute.value.path).toBe('/admin/system-settings');
    expect(router.currentRoute.value.query.tab).toBe('access');
    expect(router.currentRoute.value.query.foo).toBe('bar');
  });

  it('/admin/memory-review?userId= → 学习者详情「记忆调度」页签（路由级改投，页面不必先挂载转发）', async () => {
    await router.push('/admin/memory-review?userId=user_abc');
    expect(router.currentRoute.value.path).toBe('/admin/learner-state');
    expect(router.currentRoute.value.query).toMatchObject({ view: 'learner', id: 'user_abc', tab: 'memory-ops' });
    expect(router.currentRoute.value.query.userId).toBeUndefined();
  });

  it('/admin/ops-hub?status= 只认当前页签枚举，非法值丢弃（反馈的 new 落到公告会筛成空表）', async () => {
    await router.push('/admin/ops-hub?tab=announce&status=new');
    expect(router.currentRoute.value.path).toBe('/admin/ops-hub');
    expect(router.currentRoute.value.query.tab).toBe('announce');
    expect(router.currentRoute.value.query.status).toBeUndefined();

    await router.push('/admin/ops-hub?tab=announce&status=published');
    expect(router.currentRoute.value.query.status).toBe('published');

    await router.push('/admin/ops-hub?tab=feedback&status=new');
    expect(router.currentRoute.value.query.status).toBe('new');
  });
});

describe('Admin 主路由解析', () => {
  it('/admin/users → /admin/people（2026-10-04 学习状态拆页后单视图，tab 归零）', async () => {
    await router.push('/admin/users');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('people');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it('/admin/skills/:agentId → Skill 详情二级页重定向（2026-10-15：设计页平铺后收敛；?tab= 映射进 ?skdTab=）', async () => {
    await router.push('/admin/skills/goal-agent');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.path).toBe('/admin/skills');
    expect(router.currentRoute.value.query).toMatchObject({ view: 'skill', id: 'goal-agent' });
    // 旧页签参数映射进详情页独立键（不与列表 ?tab= 串键）
    await router.push('/admin/skills/goal-agent?tab=versions');
    expect(router.currentRoute.value.query.skdTab).toBe('versions');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it('/admin/skill-workbench → AdminConsole 场景（Skill 工作台，旧 :agentId? 路由不再吞单段路径）', async () => {
    await router.push('/admin/skill-workbench');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('skill-workbench');
  });

  it('/admin/health-center → 健康中心独立场景（2026-09-29 从 Skill 宿主 tab 释放）', async () => {
    await router.push('/admin/health-center?refresh=1');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('health-center');
    expect(router.currentRoute.value.query.refresh).toBe('1');
  });

  it('/admin/health → /admin/health-center（直觉 URL 兼容，query 透传）', async () => {
    await router.push('/admin/health?refresh=1');
    expect(router.currentRoute.value.params.page).toBe('health-center');
    expect(router.currentRoute.value.query.refresh).toBe('1');
  });

  it('/admin/batch-experiments → /admin/virtual-learners（批量实验 2026-10-04 下线，旧深链兼容）', async () => {
    await router.push('/admin/batch-experiments?includeTest=true');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('virtual-learners');
    expect(router.currentRoute.value.query.includeTest).toBe('true');
  });

  it('未知 page 仍解析到 AdminConsole（组件内回退 overview）', async () => {
    await router.push('/admin/bogus-page');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('bogus-page');
  });
});

describe('Admin 鉴权守卫', () => {
  it('无会话访问受保护页 → 重定向 /admin/login 并携带 redirect', async () => {
    setAdminSession(false);
    await router.push('/admin/overview');
    expect(router.currentRoute.value.path).toBe('/admin/login');
    expect(router.currentRoute.value.query.redirect).toBe('/admin/overview');
  });

  it('有会话访问受保护页 → 放行', async () => {
    await router.push('/admin/overview');
    expect(router.currentRoute.value.path).toBe('/admin/overview');
  });

  it('有会话标记访问登录页且后端确认会话有效 → 弹回 /admin/overview（原行为保留）', async () => {
    // 先落一个非登录路由：同路由重复 push 不触发守卫，测试间需真实导航
    await router.push('/admin/overview');
    const getMeSpy = vi.spyOn(adminAuthApi, 'getMe').mockResolvedValue({ status: 200 } as never);
    try {
      await router.push('/admin/login');
      expect(router.currentRoute.value.path).toBe('/admin/overview');
      expect(hasAdminSession()).toBe(true);
    } finally {
      getMeSpy.mockRestore();
    }
  });

  it('有会话标记访问登录页但后端返回 403（会话已吊销）→ 清标记放行登录页（错误门死锁出口）', async () => {
    await router.push('/admin/overview');
    // http.ts 错误归一化形态：{ message, status, response }（无 response.data 依赖）
    const getMeSpy = vi.spyOn(adminAuthApi, 'getMe').mockRejectedValue({ message: '会话已吊销或过期', status: 403 });
    try {
      await router.push('/admin/login');
      expect(router.currentRoute.value.path).toBe('/admin/login');
      expect(hasAdminSession()).toBe(false);
    } finally {
      getMeSpy.mockRestore();
      setAdminSession(true);
    }
  });

  it('有会话标记访问登录页但后端 401（Token 过期）→ 清标记放行登录页', async () => {
    await router.push('/admin/overview');
    const getMeSpy = vi.spyOn(adminAuthApi, 'getMe').mockRejectedValue({ message: 'Token 已过期', status: 401 });
    try {
      await router.push('/admin/login');
      expect(router.currentRoute.value.path).toBe('/admin/login');
      expect(hasAdminSession()).toBe(false);
    } finally {
      getMeSpy.mockRestore();
      setAdminSession(true);
    }
  });

  it('有会话标记访问登录页但网络故障（无 status）→ 维持弹回 overview（不因抖动误送登录页）', async () => {
    await router.push('/admin/overview');
    const getMeSpy = vi.spyOn(adminAuthApi, 'getMe').mockRejectedValue({ message: '网络错误，请检查连接' });
    try {
      await router.push('/admin/login');
      expect(router.currentRoute.value.path).toBe('/admin/overview');
      expect(hasAdminSession()).toBe(true);
    } finally {
      getMeSpy.mockRestore();
    }
  });
});
