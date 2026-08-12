/**
 * Admin 路由冒烟（真实 router 实例 + 内存历史）：
 * - 新旧 URL 重定向完整性（/admin、/admin/console/:page、已下线页面）
 * - /admin/:page 主路由与 /admin/skills/:agentId 设计页路由解析
 * - requiresAdminAuth 守卫：无会话 → /admin/login 重定向，有会话 → 放行
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});

describe('Admin 主路由解析', () => {
  it('/admin/users → AdminConsole 路由 + page 参数', async () => {
    await router.push('/admin/users');
    expect(router.currentRoute.value.name).toBe('AdminConsole');
    expect(router.currentRoute.value.params.page).toBe('users');
  });

  it('/admin/skills/:agentId → SkillDesignPage 路由（不被 :page 吞掉）', async () => {
    await router.push('/admin/skills/goal-agent');
    expect(router.currentRoute.value.name).toBe('AdminSkillEditor');
    expect(router.currentRoute.value.params.agentId).toEqual(['goal-agent']);
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
