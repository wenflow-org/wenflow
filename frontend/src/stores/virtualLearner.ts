/**
 * virtualLearner store
 * ============================================================
 * 集中缓存虚拟学习者画像 / 故事 / 会话数据，避免多个页面重复请求。
 *
 * - profilesById:     画像缓存（key: profileId）
 * - storiesByProfileId: 故事池缓存（key: profileId）
 * - sessionsBySessionId: 单个 session 详情缓存（key: sessionId）
 *
 * 接入策略：渐进式。重构后的 VirtualProfile / SessionCockpit 优先用；
 * 其它页面（VirtualSession / VirtualStoryOverview）后续按需切。
 *
 * TTL = 30 秒；变更动作（create/update/delete/start session 等）显式 invalidate。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { adminVirtualLearnersApi } from '@/api/adminApi';

const TTL_MS = 30 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export const useVirtualLearnerStore = defineStore('virtualLearner', () => {
  const profilesById = ref<Record<string, CacheEntry<any>>>({});
  const storiesByProfileId = ref<Record<string, CacheEntry<any[]>>>({});
  const sessionsBySessionId = ref<Record<string, CacheEntry<any>>>({});

  function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() - entry.fetchedAt < TTL_MS;
  }

  async function ensureProfile(profileId: string, force = false): Promise<any | null> {
    if (!profileId) return null;
    const cached = profilesById.value[profileId];
    if (!force && isFresh(cached)) return cached.data;
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearner(profileId);
      const data = res.data?.data || null;
      if (data) {
        profilesById.value[profileId] = { data, fetchedAt: Date.now() };
      }
      return data;
    } catch {
      return cached?.data || null;
    }
  }

  async function ensureStories(profileId: string, force = false): Promise<any[]> {
    if (!profileId) return [];
    const cached = storiesByProfileId.value[profileId];
    if (!force && isFresh(cached)) return cached.data;
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(profileId);
      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      storiesByProfileId.value[profileId] = { data, fetchedAt: Date.now() };
      return data;
    } catch {
      return cached?.data || [];
    }
  }

  async function ensureSession(sessionId: string, force = false): Promise<any | null> {
    if (!sessionId) return null;
    const cached = sessionsBySessionId.value[sessionId];
    if (!force && isFresh(cached)) return cached.data;
    try {
      const res = await adminVirtualLearnersApi.getVirtualSession(sessionId);
      const data = res.data?.data || null;
      if (data) {
        sessionsBySessionId.value[sessionId] = { data, fetchedAt: Date.now() };
      }
      return data;
    } catch {
      return cached?.data || null;
    }
  }

  function invalidateProfile(profileId: string) {
    if (!profileId) return;
    delete profilesById.value[profileId];
    delete storiesByProfileId.value[profileId];
  }

  function invalidateSession(sessionId: string) {
    if (!sessionId) return;
    delete sessionsBySessionId.value[sessionId];
  }

  function clear() {
    profilesById.value = {};
    storiesByProfileId.value = {};
    sessionsBySessionId.value = {};
  }

  return {
    profilesById,
    storiesByProfileId,
    sessionsBySessionId,
    ensureProfile,
    ensureStories,
    ensureSession,
    invalidateProfile,
    invalidateSession,
    clear,
  };
});
