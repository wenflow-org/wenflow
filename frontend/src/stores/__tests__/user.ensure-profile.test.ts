/**
 * user store ensureProfile/markOnboardingCompleted 单测（审计 #10 路由守卫档案缓存）：
 * - 缓存命中：完整档案（onboardingCompleted 已知）不发请求；无会话直接返回 null
 * - 缓存未命中：拉取并缓存，再次调用零请求；并发调用共享一次在途请求
 * - markLoggedIn 的部分档案（id/name）不视为有效缓存
 * - onboarding 完成回写：user.onboardingCompleted 置真并持久化 localStorage
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getProfile, hasUserSessionMock } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  hasUserSessionMock: vi.fn(() => false),
}));

vi.mock('@/api/user', () => ({
  userAPI: { getProfile, updateProfile: vi.fn() },
}));
vi.mock('@/api/auth', () => ({
  authAPI: { login: vi.fn(), register: vi.fn() },
}));
vi.mock('@/utils/api', () => ({
  default: { post: vi.fn(), get: vi.fn() },
  USER_SESSION_KEY: 'wenflow_session',
  hasUserSession: hasUserSessionMock,
}));

import { useUserStore } from '../user';

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
