/**
 * user store ensureProfile/markOnboardingCompleted 单测（审计 #10 路由守卫档案缓存）：
 * - 缓存命中：完整档案（onboardingCompleted 已知）不发请求；无会话直接返回 null
 * - 缓存未命中：拉取并缓存，再次调用零请求；并发调用共享一次在途请求
 * - markLoggedIn 的部分档案（id/name）不视为有效缓存
 * - onboarding 完成回写：user.onboardingCompleted 置真并持久化 localStorage
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getProfile, authLogin, apiPost, hasUserSessionMock } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  authLogin: vi.fn(),
  apiPost: vi.fn(),
  hasUserSessionMock: vi.fn(() => false),
}));

vi.mock('@/api/user', () => ({
  userAPI: { getProfile, updateProfile: vi.fn() },
}));
vi.mock('@/api/auth', () => ({
  authAPI: { login: authLogin, register: vi.fn() },
}));
vi.mock('@/utils/api', () => ({
  default: { post: apiPost, get: vi.fn() },
  USER_SESSION_KEY: 'wenflow_session',
  hasUserSession: hasUserSessionMock,
}));

import { useUserStore } from '../user';
import { recentGoalsKey, setRecentGoalsStorage } from '@/utils/sessionCleanup';

const FULL_PROFILE = {
  id: 'u_1',
  name: '测试用户',
  level: 2,
  xp: 120,
  onboardingCompleted: true,
};

describe('user store：守卫档案缓存', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    hasUserSessionMock.mockReturnValue(false);
  });

  it('无会话：直接返回 null 且不发请求', async () => {
    const store = useUserStore();
    await expect(store.ensureProfile()).resolves.toBeNull();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('首次未缓存：拉取并缓存；再次调用命中缓存零请求', async () => {
    hasUserSessionMock.mockReturnValue(true);
    getProfile.mockResolvedValue({ ...FULL_PROFILE });
    const store = useUserStore();
    store.hasSession = true;

    await expect(store.ensureProfile()).resolves.toMatchObject({ id: 'u_1' });
    expect(getProfile).toHaveBeenCalledTimes(1);
    // 第二次导航：缓存命中
    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: true });
    expect(getProfile).toHaveBeenCalledTimes(1);
    // 档案已持久化（initFromStorage 启动水合同样可命中）
    expect(JSON.parse(localStorage.getItem('user') || '{}').id).toBe('u_1');
  });

  it('并发调用共享一次在途请求', async () => {
    hasUserSessionMock.mockReturnValue(true);
    let release!: (v: unknown) => void;
    getProfile.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const store = useUserStore();
    store.hasSession = true;

    const p1 = store.ensureProfile();
    const p2 = store.ensureProfile();
    release({ ...FULL_PROFILE });
    await expect(p1).resolves.toMatchObject({ id: 'u_1' });
    await expect(p2).resolves.toMatchObject({ id: 'u_1' });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('登录切换账号后只读新账号命名空间，保留两边互不串用的最近会话', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u_old', name: '旧账号' }));
    localStorage.setItem('wenflow_session', '1');
    setRecentGoalsStorage('u_old', JSON.stringify([{ id: 'gc_old', preview: '旧会话', at: 1 }]));
    setRecentGoalsStorage('u_new', JSON.stringify([{ id: 'gc_new', preview: '新账号自己的会话', at: 2 }]));
    localStorage.setItem('wf_goal_recent', JSON.stringify([{ id: 'gc_legacy', preview: '归属不明', at: 3 }]));
    hasUserSessionMock.mockReturnValue(true);
    authLogin.mockResolvedValue({ user: { id: 'u_new', name: '新账号' } });
    getProfile.mockResolvedValue({ ...FULL_PROFILE, id: 'u_new', name: '新账号' });
    const store = useUserStore();

    await store.login('新账号', 'password');

    expect(store.user?.id).toBe('u_new');
    expect(JSON.parse(localStorage.getItem(recentGoalsKey('u_new')) || '[]')[0].id).toBe('gc_new');
    expect(JSON.parse(localStorage.getItem(recentGoalsKey('u_old')) || '[]')[0].id).toBe('gc_old');
    expect(localStorage.getItem('wf_goal_recent')).toBeNull();
  });

  it('登出会删除所有账号的最近会话列表', async () => {
    setRecentGoalsStorage('u_1', JSON.stringify([{ id: 'gc_1', preview: 'one', at: 1 }]));
    setRecentGoalsStorage('u_2', JSON.stringify([{ id: 'gc_2', preview: 'two', at: 2 }]));
    localStorage.setItem('wf_goal_recent', '[]');
    apiPost.mockResolvedValue({});
    const store = useUserStore();
    store.user = { id: 'u_1', name: '测试用户' } as never;
    store.hasSession = true;

    await expect(store.logout()).resolves.toBe(true);

    expect(localStorage.getItem(recentGoalsKey('u_1'))).toBeNull();
    expect(localStorage.getItem(recentGoalsKey('u_2'))).toBeNull();
    expect(localStorage.getItem('wf_goal_recent')).toBeNull();
  });

  it('markLoggedIn 的部分档案（onboardingCompleted 未知）不视为有效缓存', async () => {
    hasUserSessionMock.mockReturnValue(true);
    getProfile.mockResolvedValue({ ...FULL_PROFILE });
    const store = useUserStore();
    store.hasSession = true;
    // 模拟登录动作写入的部分档案（auth 接口只返回 id/name）
    store.user = { id: 'u_1', name: '测试用户' } as never;

    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: true });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('onboarding 完成回写：置真并持久化，后续守卫判定直接命中', async () => {
    const pending = { ...FULL_PROFILE, onboardingCompleted: false };
    getProfile.mockResolvedValue(pending);
    hasUserSessionMock.mockReturnValue(true);
    const store = useUserStore();
    store.hasSession = true;

    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: false });
    store.markOnboardingCompleted();
    expect(store.user?.onboardingCompleted).toBe(true);
    expect(JSON.parse(localStorage.getItem('user') || '{}').onboardingCompleted).toBe(true);
    // 回写后守卫再读：命中缓存且不再拉取（不会被拉回引导页）
    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: true });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('false 档案缓存过期（>5min）后重拉——他端已完成引导时本端能自愈（走查 2026-09-27）', async () => {
    const pending = { ...FULL_PROFILE, onboardingCompleted: false };
    getProfile.mockResolvedValue(pending);
    hasUserSessionMock.mockReturnValue(true);
    const store = useUserStore();
    store.hasSession = true;

    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: false });
    expect(getProfile).toHaveBeenCalledTimes(1);
    // 窗口内：缓存命中零请求
    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: false });
    expect(getProfile).toHaveBeenCalledTimes(1);

    // 模拟时间流逝：缓存时间戳退回 6 分钟前（与 localStorage 同源，走 initFromStorage 口径）
    localStorage.setItem('user_fetched_at', String(Date.now() - 6 * 60 * 1000));
    store.initFromStorage();
    // 服务端已改回 true：过期后的重拉拿到新状态，不再弹回引导页
    getProfile.mockResolvedValue({ ...FULL_PROFILE });
    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: true });
    expect(getProfile).toHaveBeenCalledTimes(2);
    // 拉到 completed 档案后恢复长期缓存
    await expect(store.ensureProfile()).resolves.toMatchObject({ onboardingCompleted: true });
    expect(getProfile).toHaveBeenCalledTimes(2);
  });

  it('拉取失败：返回 null 不抛出（守卫导航不被阻塞）', async () => {
    hasUserSessionMock.mockReturnValue(true);
    getProfile.mockRejectedValue(new Error('boom'));
    const store = useUserStore();
    store.hasSession = true;
    await expect(store.ensureProfile()).resolves.toBeNull();
    // 失败不残留 in-flight：后续调用可重试
    getProfile.mockResolvedValue({ ...FULL_PROFILE });
    await expect(store.ensureProfile()).resolves.toMatchObject({ id: 'u_1' });
    expect(getProfile).toHaveBeenCalledTimes(2);
  });
});
