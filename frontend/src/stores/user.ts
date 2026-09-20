// 用户状态管理
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { userAPI, type UserProfile, type UpdateProfileData } from '../api/user';
import { authAPI } from '../api/auth';
import api, { USER_SESSION_KEY, hasUserSession } from '../utils/api';
import {
  clearUserLocalState,
  currentUserId,
  dropLegacyGoalConversationStorage,
  migrateLegacyGoalConversationStorage,
  removeGoalConversationStorage
} from '../utils/sessionCleanup';
import { toast } from '../utils/toast';

export const useUserStore = defineStore('user', () => {
  const user = ref<UserProfile | null>(null);
  // token 经 HttpOnly Cookie 下发，JS 侧仅保留"已登录"标记（旧 localStorage token 为兼容读取）
  const hasSession = ref(hasUserSession());
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isLoggedIn = computed(() => hasSession.value && !!user.value);
  const userLevel = computed(() => user.value?.level || 1);
  const userXP = computed(() => user.value?.xp || 0);

  function markLoggedIn(profile: Pick<UserProfile, 'id' | 'name'>) {
    // 切号（未登出直接换账号）：清掉上个账号的目标会话缓存，避免新账号看到残留
    const previousId = currentUserId();
    if (previousId && previousId !== profile.id) {
      removeGoalConversationStorage(previousId);
    }
    // 旧版未作用域缓存无法本地核实归属：登录动作一律丢弃，绝不迁移给新账号
    dropLegacyGoalConversationStorage();
    hasSession.value = true;
    user.value = profile as UserProfile;
    localStorage.setItem(USER_SESSION_KEY, '1');
    localStorage.setItem('user', JSON.stringify(profile));
  }

  async function login(name: string, password: string, remember = true) {
    loading.value = true;
    error.value = null;

    try {
      const response = await authAPI.login({ name, password, remember });

      // auth 接口当前只返回 id/name 的最简用户信息，随后立即拉取完整档案
      markLoggedIn(response.user);
      await fetchProfile().catch(() => {});

      return response;
    } catch (err: any) {
      error.value = err.message || '登录失败';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function register(name: string, password: string, remember = true) {
    loading.value = true;
    error.value = null;

    try {
      const response = await authAPI.register({ name, password, remember });

      markLoggedIn(response.user);
      await fetchProfile().catch(() => {});

      return response;
    } catch (err: any) {
      error.value = err.message || '注册失败';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchProfile() {
    if (!hasSession.value) return;

    loading.value = true;
    error.value = null;

    try {
      const profile = await userAPI.getProfile();
      user.value = profile;
      localStorage.setItem('user', JSON.stringify(profile));
    } catch (err: any) {
      error.value = err.message || '获取用户信息失败';
      if (err.status === 401) {
        logout();
      }
    } finally {
      loading.value = false;
    }
  }

  /* 守卫专用档案读取（审计 #10：路由守卫不再每次导航都请求 profile）。
     缓存命中条件是 onboardingCompleted 已知——markLoggedIn 只写 id/name 部分档案，
     未水合完整档案前不算有效缓存；并发导航共享同一次在途请求。 */
  let ensureProfileInFlight: Promise<UserProfile | null> | null = null;
  async function ensureProfile(): Promise<UserProfile | null> {
    if (!hasSession.value) return null;
    if (user.value && user.value.onboardingCompleted !== undefined) return user.value;
    if (ensureProfileInFlight) return ensureProfileInFlight;
    ensureProfileInFlight = (async () => {
      try {
        const profile = await userAPI.getProfile();
        user.value = profile;
        localStorage.setItem('user', JSON.stringify(profile));
        return profile;
      } catch {
        // 与守卫原语义一致：获取失败不阻塞导航（401 由 api 实例拦截器统一处理）
        return null;
      } finally {
        ensureProfileInFlight = null;
      }
    })();
    return ensureProfileInFlight;
  }

  /** onboarding 完成回写缓存（页面直连 /users/me/onboarding 后必须调用，否则守卫缓存会把用户拉回引导页） */
  function markOnboardingCompleted() {
    if (!user.value) return;
    user.value = { ...user.value, onboardingCompleted: true };
    localStorage.setItem('user', JSON.stringify(user.value));
  }

  async function updateProfile(data: UpdateProfileData) {
    loading.value = true;
    error.value = null;

    try {
      const updated = await userAPI.updateProfile(data);
      user.value = updated;
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    } catch (err: any) {
      error.value = err.message || '更新失败';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    // 本地状态先行清理（登出必须清空全部用户域数据，防止下个用户恢复上人对话/投影）
    user.value = null;
    hasSession.value = false;
    error.value = null;
    clearUserLocalState();

    // 通知后端清除 HttpOnly Cookie；失败时提示（此时 Cookie 仍有效，避免"假登出"）
    try {
      await api.post('/auth/logout');
    } catch {
      toast.error('登出失败，请检查网络后重试');
    }
  }

  function initFromStorage() {
    const storedUser = localStorage.getItem('user');
    hasSession.value = hasUserSession();
    if (storedUser && hasSession.value) {
      try {
        user.value = JSON.parse(storedUser);
        // 升级一次性迁移：启动时无切号动作，残留旧键必属当前登录用户，归到其作用域键
        if (user.value?.id) migrateLegacyGoalConversationStorage(user.value.id);
      } catch (err) {
        localStorage.removeItem('user');
        dropLegacyGoalConversationStorage();
      }
    } else {
      // 未登录：旧版未作用域缓存不再保留，避免下个账号在登录页/页面看到残留
      dropLegacyGoalConversationStorage();
    }
  }

  return {
    user,
    hasSession,
    loading,
    error,
    isLoggedIn,
    userLevel,
    userXP,
    login,
    register,
    fetchProfile,
    ensureProfile,
    markOnboardingCompleted,
    updateProfile,
    logout,
    initFromStorage
  };
});