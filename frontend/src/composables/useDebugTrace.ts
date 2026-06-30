import { ref, watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  adminApi,
  adminSkillWorkbenchApi,
  adminRuntimeDefinitionsApi,
  adminFieldRoutingsApi,
  adminDevtoolsApi,
} from '@/api/adminApi';
import api from '@/utils/api';
import { useDebugStore } from '@/stores/debug';
import { isTestMode } from '@/utils/debugMode';

const ROUTE_SKILL_MAP: Record<string, string[]> = {
  AdminTestDashboard: ['adaptive-guidance-copy'],
  AdminTestGoalConversationFull: ['goal-conversation', 'goal-understanding-composer', 'goal-profile-inference'],
  AdminTestLearningPaths: ['path-scene-framing', 'path-planning', 'stage-designer'],
  AdminTestLearningPathDetail: ['path-scene-framing', 'path-planning', 'stage-designer'],
  AdminTestLearningState: ['learner-model', 'learning-pattern-distiller'],
  AdminTestAchievements: [],
  AdminTestLearningPage: ['teaching-turn', 'peer-reinforcement'],
  AdminTestLearningEvaluationPage: ['session-wrapup'],
};

export interface SkillChainItem {
  skillId: string;
  parentAgent?: string;
  callCount?: number;
  successRate?: number;
  activePromptVersion?: number;
  promptDrift?: boolean;
}

export function useDebugTrace() {
  const route = useRoute();
  const debugStore = useDebugStore();

  const skillChain = ref<SkillChainItem[]>([]);
  const recentPromptCalls = ref<any[]>([]);
  const traceLogs = ref<any[]>([]);
  const fieldRoutings = ref<any[]>([]);
  const manifestDiagnostics = ref<any>(null);
  const eventHistory = ref<any[]>([]);
  const routeSpecificData = ref<Record<string, any>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // 统一从 axios response 中拆出业务数据：优先 response.data.data，其次 response.data
  function unwrap<T = any>(resp: any): T {
    if (resp && typeof resp === 'object' && 'data' in resp) {
      const inner = resp.data;
      if (inner && typeof inner === 'object' && 'data' in inner) return inner.data as T;
      return inner as T;
    }
    return resp as T;
  }

  async function loadSkillChain() {
    const skillIds = ROUTE_SKILL_MAP[route.name as string] || [];
    if (skillIds.length === 0) {
      skillChain.value = [];
      return;
    }

    const results: SkillChainItem[] = [];
    for (const skillId of skillIds) {
      try {
        const meta: any = unwrap(await adminSkillWorkbenchApi.getMeta(skillId));
        if (meta) {
          const promptVersions = meta.promptVersions || [];
          const activeVersion = promptVersions.find((v: any) => v.status === 'ACTIVE');
          results.push({
            skillId,
            parentAgent: meta.parentAgent?.name || meta.parentAgent,
            callCount: meta.stats?.totalCalls ?? meta.stats?.callCount,
            successRate: meta.stats?.successRate,
            activePromptVersion: activeVersion?.version,
            promptDrift: meta.promptDrift,
          });
        } else {
          results.push({ skillId });
        }
      } catch {
        results.push({ skillId });
      }
    }
    skillChain.value = results;
  }

  async function loadRecentPromptCalls() {
    const skillIds = ROUTE_SKILL_MAP[route.name as string] || [];
    if (skillIds.length === 0) {
      recentPromptCalls.value = [];
      return;
    }
    try {
      const data: any = unwrap(await adminRuntimeDefinitionsApi.getPromptCallLogs({ limit: 5 }));
      recentPromptCalls.value = data?.logs || data || [];
    } catch {
      recentPromptCalls.value = [];
    }
  }

  async function loadTraceLogs() {
    if (!debugStore.currentTraceId) {
      traceLogs.value = [];
      return;
    }
    try {
      const data: any = unwrap(await adminApi.getLogs({ traceId: debugStore.currentTraceId, limit: 50 }));
      traceLogs.value = data?.logs || data || [];
    } catch {
      traceLogs.value = [];
    }
  }

  async function loadFieldRoutings() {
    try {
      const data: any = unwrap(await adminFieldRoutingsApi.getStages());
      fieldRoutings.value = data?.stages || data || [];
    } catch {
      fieldRoutings.value = [];
    }
  }

  async function loadManifestDiagnostics() {
    try {
      manifestDiagnostics.value = unwrap(await adminApi.getManifestDiagnostics());
    } catch {
      manifestDiagnostics.value = null;
    }
  }

  async function loadEventHistory() {
    try {
      const data: any = unwrap(await adminDevtoolsApi.getDebugEvents({ limit: 20 }));
      eventHistory.value = data?.events || data || [];
    } catch {
      eventHistory.value = [];
    }
  }

  async function loadRouteSpecificData() {
    const routeName = route.name as string;
    const data: Record<string, any> = {};
    try {
      if (routeName === 'AdminTestLearningPathDetail' && route.params.id) {
        const path: any = await api.get(`/learning/paths/${route.params.id}`);
        data.processDetail = path?.processDetail || path?.data?.processDetail || null;
      } else if (routeName === 'AdminTestLearningPaths') {
        const paths: any = await api.get('/learning/paths');
        data.paths = (paths?.paths || paths?.data?.paths || paths || []).slice(0, 5);
      } else if (routeName === 'AdminTestLearningState') {
        const state: any = await api.get('/state/current');
        data.currentState = state?.data || state;
      } else if (routeName === 'AdminTestDashboard') {
        const stats: any = await api.get('/learning/stats');
        data.stats = stats?.data || stats;
      }
    } catch {
      // 忽略
    }
    routeSpecificData.value = data;
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      await Promise.allSettled([
        loadSkillChain(),
        loadRecentPromptCalls(),
        loadTraceLogs(),
        loadFieldRoutings(),
        loadManifestDiagnostics(),
        loadEventHistory(),
        loadRouteSpecificData(),
      ]);
    } catch (e: any) {
      error.value = e?.message || '刷新失败';
    } finally {
      loading.value = false;
    }
  }

  function startPolling(intervalMs = 5000) {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!isTestMode.value) return;
      loadRecentPromptCalls();
      loadTraceLogs();
      loadEventHistory();
    }, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  watch(
    () => route.name,
    () => {
      if (isTestMode.value) refresh();
      else {
        skillChain.value = [];
        recentPromptCalls.value = [];
        traceLogs.value = [];
        fieldRoutings.value = [];
        manifestDiagnostics.value = null;
        eventHistory.value = [];
        routeSpecificData.value = {};
      }
    },
    { immediate: true }
  );

  watch(
    () => isTestMode.value,
    (enabled) => {
      if (enabled) refresh();
      else stopPolling();
    }
  );

  watch(
    () => debugStore.currentTraceId,
    () => {
      if (isTestMode.value) loadTraceLogs();
    }
  );

  onUnmounted(() => {
    stopPolling();
  });

  return {
    skillChain,
    recentPromptCalls,
    traceLogs,
    fieldRoutings,
    manifestDiagnostics,
    eventHistory,
    routeSpecificData,
    loading,
    error,
    refresh,
    startPolling,
    stopPolling,
  };
}
