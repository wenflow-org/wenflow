// 用户状态管理
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { userAPI, type UserProfile, type UpdateProfileData } from '../api/user';
import { authAPI } from '../api/auth';
import api, { USER_SESSION_KEY, hasUserSession } from '../utils/api';

export const useUserStore = defineStore('user', () => {
  const user = ref<UserProfile | null>(null);
  // token 经 HttpOnly Cookie 下发，JS 侧仅保留"已登录"标记（旧 localStorage token 为兼容读取）
  const hasSession = ref(hasUserSession());
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isLoggedIn = computed(() => hasSession.value && !!user.value);
  const userLevel = computed(() => user.value?.level || 1);
  const userXP = computed(() => user.value?.xp || 0);

  function markLoggedIn(profile: UserProfile) {
    hasSession.value = true;
    user.value = profile;
    // 清除历史遗留的 JS 可读 token，统一走 HttpOnly Cookie
    localStorage.removeItem('token');
    localStorage.setItem(USER_SESSION_KEY, '1');
    localStorage.setItem('user', JSON.stringify(profile));
  }

  async function login(name: string, password: string) {
    loading.value = true;
    error.value = null;

    try {
      const response = await authAPI.login({ name, password });

      // auth 接口当前只返回 id/name 的最简用户信息，按 UserProfile 存储（不改变运行时数据）
      markLoggedIn(response.user as UserProfile);

      return response;
    } catch (err: any) {
      error.value = err.message || '登录失败';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function register(name: string, password: string) {
    loading.value = true;
    error.value = null;

    try {
      const response = await authAPI.register({ name, password });

      markLoggedIn(response.user as UserProfile);

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

  function logout() {
    // 通知后端清除 HttpOnly Cookie（失败不阻塞本地登出）
    void api.post('/auth/logout').catch(() => {});

    user.value = null;
    hasSession.value = false;
    error.value = null;

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(USER_SESSION_KEY);
  }

  function initFromStorage() {
    const storedUser = localStorage.getItem('user');
    hasSession.value = hasUserSession();
    if (storedUser && hasSession.value) {
      try {
        user.value = JSON.parse(storedUser);
      } catch (err) {
        localStorage.removeItem('user');
      }
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
    updateProfile,
    logout,
    initFromStorage
  };
});