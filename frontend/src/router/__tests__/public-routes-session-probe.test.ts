/**
 * 公开路由不再探 /users/me（#34 走查，2026-10-15）：
 *
 * 缺陷：路由守卫对非 admin 路由无条件 `await useUserStore().restoreFromCookie()`，
 * 未登录访客打开公开页（`/`、`/login`、`/register`）每次整页加载都会打一条注定 401 的
 * `GET /api/users/me`，浏览器控制台留下报错观感，且多一次无意义请求。
 *
 * 修法：自举只做在「真的需要会话」的路由上——受保护路由（缺会话会被拦，必须知道有没有），
 * 以及登录/注册页的「已登录则改投首页」判断（本地标记已在时 restoreFromCookie 首行即短路）。
 * 本测试钉住「公开页零 getProfile 调用」与「受保护路由照旧自举」两侧。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getProfileMock } = vi.hoisted(() => ({ getProfileMock: vi.fn() }));

vi.mock('@/api/user', () => ({
  userAPI: {
    getProfile: getProfileMock,
  },
}));
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

import router from '../index';
import { USER_SESSION_KEY } from '@/utils/api';

function clearSessionMarker() {
  localStorage.removeItem(USER_SESSION_KEY);
  localStorage.removeItem('user');
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearSessionMarker();
  getProfileMock.mockReset();
  getProfileMock.mockRejectedValue(new Error('401 Unauthorized'));
});

afterEach(() => {
  clearSessionMarker();
});

describe('公开路由不探 /users/me（#34）', () => {
  it('游客打开 / 不打 getProfile', async () => {
    await router.push('/');
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it('游客打开 /register 不打 getProfile', async () => {
    await router.push('/register');
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it('受保护路由照旧自举（缺会话被拦到 /login 且带 redirect）', async () => {
    await router.push('/learning-state');
    expect(getProfileMock).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/learning-state');
  });
});
