// 用户状态管理
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { userAPI, type UserProfile, type UpdateProfileData } from '../api/user';
import { authAPI } from '../api/auth';

export const useUserStore = defineStore('user', () => {
  const user = ref<UserProfile | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isLoggedIn = computed(() => !!token.value && !!user.value);
  const userLevel = computed(() => user.value?.level || 1);
  const userXP = computed(() => user.value?.xp || 0);

  async function login(name: string, password: string) {
    loading.value = true;
    error.value = null;

    try {
      const response = await authAPI.login({ name, password });

      token.value = response.token;
      user.value = response.user;

      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));

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

      token.value = response.token;
      user.value = response.user;

      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));

      return response;
    } catch (err: any) {
      error.value = err.message || '注册失败';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchProfile() {
    if (!token.value) return;

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
    user.value = null;
    token.value = null;
    error.value = null;

    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  function initFromStorage() {
    const storedUser = localStorage.getItem('user');
    if (storedUser && token.value) {
      try {
        user.value = JSON.parse(storedUser);
      } catch (err) {
        localStorage.removeItem('user');
      }
    }
  }

  return {
    user,
    token,
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