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
import { getReplanPriorityText, getReplanRecommendationText, getReplanScopeText } from '@/utils/replanSignal';

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

function formatDebugJson(value: any, emptyText = '当前没有可用数据。') {
  if (value === null || value === undefined || value === '') return emptyText;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeDashboardMetrics(metrics: any) {
  if (!metrics) return null;
  return {
    lss: Number((Number(metrics.lss || 0) * 10).toFixed(2)),
    ktl: Number((Number(metrics.ktl || 0) * 10).toFixed(2)),
    lf: Number((Number(metrics.lf || 0) * 10).toFixed(2)),
    lsb: Number((Number(metrics.lsb || 0) * 10).toFixed(2)),
  };
}

function getPathStages(path: any) {
  return path?.milestones || path?.weeks || [];
}

function normalizeTaskList(stage: any): any[] {
  if (!stage) return [];
  return 'subtasks' in stage ? stage.subtasks || [] : stage.tasks || [];
}

function getPathDisplayState(path: any) {
  const enrichmentStatus = path?.generationStatus?.stageDesign || null;
  if (!path) return 'attention';
  if (path.status === 'failed') return 'attention';
  if (path.status === 'generating') return 'generating';
  if (enrichmentStatus === 'failed') return 'attention';
  if (enrichmentStatus === 'processing' || enrichmentStatus === 'pending') return 'generating';
  return 'active';
}

function getPrimaryActionTask(path: any) {
  const stages = getPathStages(path);
  const activeStage = stages.find((stage: any) => normalizeTaskList(stage).some((task: any) => task.status !== 'completed')) || stages[0] || null;
  const tasks = normalizeTaskList(activeStage);
  return tasks.find((task: any) => task.status === 'todo')
    || tasks.find((task: any) => task.status === 'in_progress')
    || null;
}

function buildDashboardDebugData(stats: any, paths: any[], adaptiveGuidance: any, currentState: any, learnerCenter: any) {
  const latestPath = paths.length > 0
    ? [...paths].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0]
    : null;
  const activePaths = paths.filter((path) => getPathDisplayState(path) === 'active');
  const primaryPath = activePaths.find((path) => Boolean(getPrimaryActionTask(path))) || activePaths[0] || null;
  const debugFocusPath = primaryPath || latestPath || null;
  const debugActionTask = getPrimaryActionTask(debugFocusPath);
  const debugGoalConversationId = typeof debugFocusPath?.generationStatus?.sourceConversationId === 'string'
    ? debugFocusPath.generationStatus.sourceConversationId.trim()
    : '';
  const stageCount = getPathStages(debugFocusPath).length;
  const pathState = getPathDisplayState(debugFocusPath);
  const coreStep = debugFocusPath?.generationStatus?.coreStep;
  const stageDesign = debugFocusPath?.generationStatus?.stageDesign;

  let debugPathStageLabel = '还没有测试路径';
  let debugPathStageDescription = '先去创建一个测试目标，首页才会出现最近链路的可观察状态。';

  if (debugFocusPath) {
    if (pathState === 'attention') {
      debugPathStageLabel = '需要处理';
    } else if (debugFocusPath.canStartLearning && stageCount > 0) {
      debugPathStageLabel = '可开始 Learn';
    } else if (coreStep === 'framing') {
      debugPathStageLabel = '主路径生成中';
    } else if (coreStep === 'planning') {
      debugPathStageLabel = '主路径拆解中';
    } else if (coreStep === 'persist') {
      debugPathStageLabel = '主路径落成中';
    } else if (coreStep === 'completed' && (stageDesign === 'processing' || stageDesign === 'pending')) {
      debugPathStageLabel = '阶段任务补充中';
    } else if (pathState === 'generating') {
      debugPathStageLabel = '生成中';
    } else {
      debugPathStageLabel = '已就绪';
    }

    if (debugFocusPath.canStartLearning && stageCount > 0) {
      debugPathStageDescription = '里程碑和 task 已准备完成，可以直接进入 Learn。';
    } else if (coreStep === 'framing') {
      debugPathStageDescription = '正在从 Goal 结果收敛真实问题、约束与首个交付物。';
    } else if (coreStep === 'planning') {
      debugPathStageDescription = '正在把 Goal 结果拆成学习路径主结构。';
    } else if (coreStep === 'persist') {
      debugPathStageDescription = '正在写入路径主结构，准备切换到阶段任务生成。';
    } else if (coreStep === 'completed' && (stageDesign === 'processing' || stageDesign === 'pending')) {
      debugPathStageDescription = debugFocusPath.learningBlockedReason || '主路径已完成，系统正在补充每个阶段的具体 task。';
    } else {
      debugPathStageDescription = debugFocusPath.learningBlockedReason || '当前没有额外调试说明。';
    }
  }

  const adaptiveDebug = adaptiveGuidance?.debug || null;
  const learnerMetrics = normalizeDashboardMetrics(learnerCenter?.dynamicState?.metrics);
  const metricSource = learnerMetrics || currentState || null;
  const control = learnerCenter?.learningControlState || null;
  const signal = learnerCenter?.replanSignal || null;

  return {
    overview: {
      title: debugFocusPath ? '最近一条测试链路' : '还没有测试链路',
      lead: debugPathStageDescription,
      sourceBadge: !adaptiveGuidance
        ? '冷数据 fallback'
        : adaptiveDebug?.cached ? '热数据快照 · fallback 生成' : '热数据快照 · model 生成',
      sourceNote: !adaptiveGuidance
        ? '当前 /api/adaptive-guidance/copy 返回 null，页面正在使用默认冷数据。'
        : formatDateTime(adaptiveDebug?.generatedAt)
          ? `当前页面命中后台首页快照，生成时间：${formatDateTime(adaptiveDebug?.generatedAt)}`
          : '当前页面命中后台首页快照。',
      cards: [
        {
          label: '最近路径',
          value: debugFocusPath?.name || debugFocusPath?.title || '暂无',
          meta: debugFocusPath?.id || '先创建一个测试目标'
        },
        {
          label: 'Goal 来源',
          value: debugGoalConversationId ? `会话 ${debugGoalConversationId.slice(0, 16)}...` : '暂无',
          meta: debugGoalConversationId ? '可直接跳回测试目标规划' : '当前路径没有回溯到测试 Goal 会话'
        },
        {
          label: 'Path 状态',
          value: debugPathStageLabel,
          meta: debugPathStageDescription
        },
        {
          label: 'Learn 入口',
          value: debugActionTask?.title || '暂无可继续任务',
          meta: debugActionTask ? '路径已给出当前最值得先推进的 task。' : '若仍在生成中，请先观察 Path 阶段。'
        }
      ],
      steps: [
        {
          label: 'Goal',
          value: debugGoalConversationId ? '已收口' : '待创建',
          desc: debugGoalConversationId ? '已拿到可追踪的测试 Goal 会话。' : '先从测试目标规划页开始。',
          tone: debugFocusPath ? 'done' : 'idle'
        },
        {
          label: 'Path',
          value: debugPathStageLabel,
          desc: debugPathStageDescription,
          tone: !debugFocusPath ? 'idle' : pathState === 'attention' ? 'attention' : pathState === 'generating' ? 'active' : 'done'
        },
        {
          label: 'Learn',
          value: debugFocusPath?.canStartLearning && stageCount > 0 ? '可进入' : '未就绪',
          desc: debugFocusPath?.canStartLearning && stageCount > 0 ? '可以直接点击继续，进入当前 task。' : '等 Path 真正 ready 后再开始 Learn。',
          tone: debugFocusPath?.canStartLearning && stageCount > 0 ? 'done' : 'idle'
        }
      ],
      links: {
        goal: debugGoalConversationId ? `/admin/test/goal-full/${debugGoalConversationId}` : '/admin/test/goal-full',
        path: debugFocusPath?.id ? `/admin/test/learning-path/${debugFocusPath.id}` : '/admin/test/learning-paths',
        state: '/admin/test/learning-state',
        promptLogs: debugFocusPath?.id
          ? { path: '/admin/prompt-call-logs', query: { pathId: debugFocusPath.id, limit: '100' } }
          : '/admin/prompt-call-logs',
        executionLogs: debugFocusPath?.id
          ? { path: '/admin/execution-logs', query: { pathId: debugFocusPath.id, sourceEntry: 'platform', timeRange: 'all' } }
          : '/admin/execution-logs'
      }
    },
    snapshots: {
      skillMeta: [
        { label: 'skillId', value: adaptiveDebug?.skillId || 'adaptive-guidance-copy' },
        { label: 'systemPromptVersion', value: adaptiveDebug?.systemPromptVersion !== null && adaptiveDebug?.systemPromptVersion !== undefined ? `v${adaptiveDebug.systemPromptVersion}` : '当前未返回' },
        { label: 'model', value: adaptiveDebug?.model || '当前未返回' },
        { label: 'duration', value: adaptiveDebug?.durationMs !== undefined ? `${adaptiveDebug.durationMs} ms` : '当前未返回' },
        { label: 'source', value: adaptiveDebug ? (adaptiveDebug.cached ? 'snapshot-fallback' : 'snapshot-model') : '当前没有后台快照' },
        { label: 'generatedAt', value: adaptiveDebug?.generatedAt || '当前没有后台快照' },
      ],
      outputItems: [
        adaptiveGuidance?.copy?.nextStep ? { label: 'nextStep', value: adaptiveGuidance.copy.nextStep } : null,
        adaptiveGuidance?.copy?.pathHint ? { label: 'pathHint', value: adaptiveGuidance.copy.pathHint } : null,
        adaptiveGuidance?.copy?.paceHint ? { label: 'paceHint', value: adaptiveGuidance.copy.paceHint } : null,
        adaptiveGuidance?.copy?.warningCopy ? { label: 'warningCopy', value: adaptiveGuidance.copy.warningCopy } : null,
      ].filter(Boolean),
      metricCards: metricSource ? [
        { label: 'LSS 学习压力', value: Number(metricSource.lss || 0).toFixed(2), note: '当前即时压力' },
        { label: 'KTL 知识掌握', value: Number(metricSource.ktl || 0).toFixed(2), note: '长期掌握负荷' },
        { label: 'LF 学习疲劳', value: Number(metricSource.lf || 0).toFixed(2), note: '当前疲劳程度' },
        { label: 'LSB 状态平衡', value: Number(metricSource.lsb || 0).toFixed(2), note: '掌握与疲劳平衡值' },
      ] : [],
      controlItems: control ? [
        { label: 'paceMode', value: control.paceMode },
        { label: 'conceptLoad', value: control.conceptLoad },
        { label: 'reviewPriority', value: control.reviewPriority },
        { label: 'challengeLevelCap', value: control.challengeLevelCap },
        { label: 'checkpointNeed', value: control.checkpointNeed },
        { label: 'avoidNewConcepts', value: control.shouldAvoidNewConcepts ? 'true' : 'false' },
        { label: 'preferConsolidation', value: control.shouldPreferConsolidation ? 'true' : 'false' },
        { label: 'offerBreak', value: control.shouldOfferBreak ? 'true' : 'false' },
      ] : [],
      signalItems: signal ? [
        { label: 'shouldSuggest', value: signal.shouldSuggest ? 'true' : 'false' },
        { label: 'priority', value: getReplanPriorityText(signal.priority) },
        { label: 'recommendation', value: getReplanRecommendationText(signal.recommendation) },
        { label: 'scope', value: getReplanScopeText(signal.scope) },
        { label: 'reasonCodes', value: Array.isArray(signal.reasonCodes) && signal.reasonCodes.length ? signal.reasonCodes.join('、') : '无' },
        { label: 'rationale', value: signal.rationale || '无' },
      ] : [],
      jsonCards: [
        { key: 'copy', title: 'Adaptive Copy JSON', badge: 'dashboard output', content: formatDebugJson(adaptiveGuidance?.copy) },
        { key: 'summary', title: 'Learner Summary JSON', badge: 'rule summary', content: formatDebugJson(adaptiveGuidance?.summary) },
        { key: 'payload', title: 'User Payload', badge: 'skill input', content: formatDebugJson(adaptiveDebug?.userPayload, adaptiveGuidance ? '首页快照模式未保存 userPayload。' : '当前没有后台首页快照。') },
        { key: 'raw', title: 'rawModelOutput', badge: 'llm raw', content: formatDebugJson(adaptiveDebug?.rawModelOutput, adaptiveGuidance ? '首页快照模式未保存 rawModelOutput。' : '当前没有后台首页快照。') },
        { key: 'normalized', title: 'normalizedOutput', badge: 'skill output', content: formatDebugJson(adaptiveDebug?.normalizedOutput, adaptiveGuidance ? '首页快照模式未保存 normalizedOutput。' : '当前没有后台首页快照。') },
        { key: 'learner-center', title: 'Learner Center JSON', badge: 'current snapshot', content: formatDebugJson(learnerCenter, '当前还没有 learner-center 快照。') },
        { key: 'state', title: 'Current State JSON', badge: 'metrics snapshot', content: formatDebugJson(currentState, '当前还没有 metrics state 快照。') },
      ],
      rawHint: !adaptiveGuidance
        ? '当前没有后台首页快照，页面正在使用冷数据 fallback。完成一次学习行为后，后台会自动回填。'
        : adaptiveDebug?.userPayload || adaptiveDebug?.rawModelOutput || adaptiveDebug?.normalizedOutput
          ? ''
          : '当前首页使用的是后台快照。快照只保留摘要调试元信息，不保留 userPayload 和 rawModelOutput。'
    }
  };
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
        const [statsResp, pathsResp, adaptiveResp, currentStateResp, learnerCenterResp] = await Promise.allSettled([
          api.get('/learning/stats'),
          api.get('/learning/paths'),
          api.get('/adaptive-guidance/copy'),
          api.get('/state/current'),
          api.get('/users/me/learner-center', { params: { scope: 'global' } }),
        ]);

        const stats = statsResp.status === 'fulfilled' ? (statsResp.value?.data || statsResp.value) : null;
        const paths = pathsResp.status === 'fulfilled'
          ? ((pathsResp.value?.paths || pathsResp.value?.data?.paths || pathsResp.value?.data || pathsResp.value || []) as any[])
          : [];
        const adaptiveGuidance = adaptiveResp.status === 'fulfilled' ? (adaptiveResp.value?.data || adaptiveResp.value || null) : null;
        const currentState = currentStateResp.status === 'fulfilled' ? (currentStateResp.value?.data || currentStateResp.value || null) : null;
        const learnerCenter = learnerCenterResp.status === 'fulfilled' ? (learnerCenterResp.value?.data || learnerCenterResp.value || null) : null;

        data.stats = stats;
        data.paths = paths.slice(0, 5);
        data.dashboardDebug = buildDashboardDebugData(stats, paths, adaptiveGuidance, currentState, learnerCenter);
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
