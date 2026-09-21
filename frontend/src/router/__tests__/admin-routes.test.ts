/**
 * Admin 路由冒烟（真实 router 实例 + 内存历史）：
 * - 新旧 URL 重定向完整性（/admin、/admin/console/:page、已下线页面）
 * - /admin/:page 主路由与 /admin/skills/:agentId 设计页路由解析
 * - requiresAdminAuth 守卫：无会话 → /admin/login 重定向，有会话 → 放行
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import router from '../index';
import { ADMIN_SESSION_KEY } from '@/api/adminApi';

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

  it('/admin/topology → /admin/orchestrator?tab=topology（阶段 2D 拓扑降级并入编排页兼容重定向）', async () => {
    await router.push('/admin/topology');
    expect(router.currentRoute.value.path).toBe('/admin/orchestrator');
    expect(router.currentRoute.value.query.tab).toBe('topology');
  });

  it('/admin/agent-registry/:id → /admin/orchestrator?tab=topology（旧注册表路由兼容）', async () => {
    await router.push('/admin/agent-registry/goal-agent');
    expect(router.currentRoute.value.path).toBe('/admin/orchestrator');
    expect(router.currentRoute.value.query.tab).toBe('topology');
  });

  it('/admin/skill-workbench/:agentId → 设计页（旧工作台详情深链兼容）', async () => {
    await router.push('/admin/skill-workbench/goal-agent');
    expect(router.currentRoute.value.name).toBe('AdminSkillEditor');
    expect(router.currentRoute.value.params.agentId).toEqual(['goal-agent']);
  });

  it('导航收敛旧 URL 重定向（2026-09-04：同域双子视图合并为单页 tab）', async () => {
    await router.push('/admin/users');
    expect(router.currentRoute.value.path).toBe('/admin/people');
    expect(router.currentRoute.value.query.tab).toBe('account');
    await router.push('/admin/learner-center');
    expect(router.currentRoute.value.path).toBe('/admin/people');
    expect(router.currentRoute.value.query.tab).toBe('state');
    await router.push('/admin/learner-models/u1');
    expect(router.currentRoute.value.path).toBe('/admin/people');
    expect(router.currentRoute.value.query.tab).toBe('state');
    await router.push('/admin/teaching-sessions');
    expect(router.currentRoute.value.path).toBe('/admin/sessions');
    expect(router.currentRoute.value.query.tab).toBe('teaching');
    await router.push('/admin/goal-conversations');
    expect(router.currentRoute.value.path).toBe('/admin/sessions');
    await router.push('/admin/content');
    expect(router.currentRoute.value.path).toBe('/admin/sessions');
    expect(router.currentRoute.value.query.tab).toBe('paths');
    await router.push('/admin/ops-content');
    expect(router.currentRoute.value.path).toBe('/admin/sessions');
    expect(router.currentRoute.value.query.tab).toBe('paths');
    await router.push('/admin/announcements');
    expect(router.currentRoute.value.path).toBe('/admin/ops-hub');
    expect(router.currentRoute.value.query.tab).toBe('announce');
    await router.push('/admin/notifications');
    expect(router.currentRoute.value.path).toBe('/admin/ops-hub');
    expect(router.currentRoute.value.query.tab).toBe('inapp');
    await router.push('/admin/token-cost');
    expect(router.currentRoute.value.path).toBe('/admin/execution-logs');
    expect(router.currentRoute.value.query.tab).toBe('cost');
  });

  it('导航一级收敛（阶段 1）：退役场景 URL 重定向到对应宿主 + tab', async () => {
    const cases: Array<[string, string, string]> = [
      ['/admin/feedback', '/admin/ops-hub', 'feedback'],
      ['/admin/ops-achievements', '/admin/ops-hub', 'achievements'],
      ['/admin/achievements', '/admin/ops-hub', 'achievements'],
      ['/admin/messages', '/admin/ops-hub', 'announce'],
      ['/admin/announcements', '/admin/ops-hub', 'announce'],
      ['/admin/notifications', '/admin/ops-hub', 'inapp'],
      ['/admin/addons', '/admin/api-config', 'addons'],
      ['/admin/external-capabilities', '/admin/api-config', 'addons'],
      ['/admin/session-security', '/admin/ops-center', 'security'],
    ];
    for (const [from, toPath, tab] of cases) {
      await router.push(from);
      expect(router.currentRoute.value.path, `${from} 未重定向到 ${toPath}`).toBe(toPath);
      expect(router.currentRoute.value.query.tab, `${from} tab 应为 ${tab}`).toBe(tab);
    }
  });

  it('退役场景深链保留业务 query（会话安全 ?user= 透传）', async () => {
    await router.push('/admin/session-security?user=admin');
    expect(router.currentRoute.value.path).toBe('/admin/ops-center');
    expect(router.currentRoute.value.query.tab).toBe('security');
    expect(router.currentRoute.value.query.user).toBe('admin');
  });
});

describe('Admin 主路由解析', () => {
  it('/admin/users → /admin/people?tab=account（用户与学习者 · 账号 tab）', async () => {
    await router.push('/admin/users');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('people');
    expect(router.currentRoute.value.query.tab).toBe('account');
  });

  it('/admin/skills/:agentId → SkillDesignPage 路由（不被 :page 吞掉）', async () => {
    await router.push('/admin/skills/goal-agent');
    expect(router.currentRoute.value.name).toBe('AdminSkillEditor');
    expect(router.currentRoute.value.params.agentId).toEqual(['goal-agent']);
  });

  it('/admin/skill-workbench → AdminConsole 场景（Skill 工作台，旧 :agentId? 路由不再吞单段路径）', async () => {
    await router.push('/admin/skill-workbench');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('skill-workbench');
  });

  it('/admin/health-center → /admin/skills?tab=health（健康中心折入 Skill 宿主）', async () => {
    await router.push('/admin/health-center?refresh=1');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('skills');
    expect(router.currentRoute.value.query.tab).toBe('health');
    expect(router.currentRoute.value.query.refresh).toBe('1');
  });

  it('/admin/health → /admin/skills?tab=health（直觉 URL 兼容）', async () => {
    await router.push('/admin/health');
    expect(router.currentRoute.value.params.page).toBe('skills');
    expect(router.currentRoute.value.query.tab).toBe('health');
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
});
