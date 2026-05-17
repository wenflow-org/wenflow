<template>
  <div class="test-paths-page">
    <header class="test-paths-header" :class="{ 'test-paths-header--scrolled': scrolled }">
      <div class="test-paths-header__inner">
        <button type="button" class="test-paths-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="test-paths-brand__logo" />
          <span>测试学习路径</span>
        </button>

        <nav class="test-paths-nav" aria-label="测试站点导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths" class="is-active">测试学习路径</router-link>
          <router-link to="/admin/test/learning-state">测试学习状态</router-link>
          <router-link to="/admin/test/achievements">测试成就</router-link>
        </nav>

        <div class="test-paths-header__actions">
          <router-link to="/admin/test/goal-full" class="test-paths-btn test-paths-btn--primary">新建测试目标</router-link>
        </div>
      </div>
    </header>

    <main class="test-paths-shell">
      <transition name="slide-down">
        <el-alert
          v-if="showGeneratingAlert"
          title="测试路径正在生成，通常 1-3 分钟完成。"
          type="info"
          :closable="true"
          show-icon
          class="test-paths-alert"
          @close="showGeneratingAlert = false"
        />
      </transition>

      <section v-if="goalScenePath" class="test-paths-scene-card" :class="`test-paths-scene-card--${goalSceneState}`">
        <div>
          <span class="test-paths-eyebrow">Goal -> Path Scene</span>
          <h1>{{ goalSceneTitle }}</h1>
          <p>{{ goalSceneDescription }}</p>
        </div>

        <div class="test-paths-scene-card__meta">
          <div class="test-paths-step-grid">
            <span
              v-for="step in goalSceneSteps"
              :key="step.key"
              class="test-paths-step"
              :class="{
                'test-paths-step--active': step.active,
                'test-paths-step--done': step.done
              }"
            >{{ step.label }}</span>
          </div>

          <div v-if="goalSceneHighlights.length > 0" class="test-paths-chip-row">
            <span v-for="item in goalSceneHighlights" :key="item" class="test-paths-chip">{{ item }}</span>
          </div>

          <div class="test-paths-scene-card__actions">
            <button v-if="goalScenePath.id && goalSceneState === 'ready'" class="test-paths-btn test-paths-btn--primary" @click="goToPathDetail(goalScenePath.id)">查看这版路径</button>
            <button class="test-paths-btn test-paths-btn--ghost" @click="loadPaths">刷新状态</button>
          </div>
        </div>
      </section>

      <section class="test-paths-hero">
        <div>
          <span class="test-paths-eyebrow">测试工作台</span>
          <h2>查看测试路径、scene 状态和内容准备情况。</h2>
          <p>这里承接 goal -> path 的测试链路，重点观察路径主结构、内容准备和失败重试状态。</p>
        </div>
        <div class="test-paths-hero__actions">
          <button v-if="primaryPath" class="test-paths-btn test-paths-btn--primary" @click="continuePath(primaryPath)">继续学习</button>
          <router-link to="/admin/test/goal-full" class="test-paths-btn test-paths-btn--ghost">创建测试目标</router-link>
        </div>
      </section>

      <section class="test-paths-filter-row">
        <button
          v-for="item in pathFilterChips"
          :key="item.key"
          type="button"
          class="test-paths-filter-chip"
          :class="{ 'test-paths-filter-chip--active': activePathFilter === item.key }"
          @click="activePathFilter = item.key"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.count }}</strong>
        </button>
      </section>

      <section v-if="visiblePaths.length > 0" class="test-paths-grid">
        <article
          v-for="path in visiblePaths"
          :key="path.id"
          class="test-path-card"
          :class="[
            `test-path-card--${getPathDisplayState(path)}`,
            { 'test-path-card--scene': goalScenePath?.id === path.id }
          ]"
        >
          <div class="test-path-card__status-row">
            <span class="test-path-state-pill" :class="`test-path-state-pill--${getPathDisplayState(path)}`">{{ getPathStateLabel(path) }}</span>
            <span v-if="path.generationStatus?.coreStep" class="test-path-state-pill test-path-state-pill--soft">{{ getCoreStepLabel(path) }}</span>
          </div>

          <div class="test-path-card__head">
            <strong>{{ getPathTitle(path) }}</strong>
            <button type="button" class="test-paths-btn test-paths-btn--inline" @click="goToPathDetail(path.id)">详情</button>
          </div>

          <p>{{ getPathSummary(path) }}</p>

          <div class="test-path-kv-list">
            <div class="test-path-kv"><span>sourceConversationId</span><strong>{{ path.generationStatus?.sourceConversationId || '--' }}</strong></div>
            <div class="test-path-kv"><span>core</span><strong>{{ path.generationStatus?.core || '--' }}</strong></div>
            <div class="test-path-kv"><span>enrichment</span><strong>{{ path.generationStatus?.enrichment || '--' }}</strong></div>
            <div class="test-path-kv"><span>可开始学习</span><strong>{{ path.canStartLearning === false ? '否' : '是' }}</strong></div>
          </div>

          <div v-if="path.sceneSummary" class="test-path-scene-summary">
            <span class="test-paths-eyebrow">Scene Summary</span>
            <p v-if="path.sceneSummary.firstDeliverable">首个产出：{{ path.sceneSummary.firstDeliverable }}</p>
            <div v-if="Array.isArray(path.sceneSummary.planningFocus) && path.sceneSummary.planningFocus.length > 0" class="test-paths-chip-row">
              <span v-for="item in path.sceneSummary.planningFocus" :key="item" class="test-paths-chip">{{ item }}</span>
            </div>
          </div>

          <div class="test-path-card__actions-row">
            <button v-if="getPathDisplayState(path) === 'attention'" class="test-paths-btn test-paths-btn--ghost" :disabled="retryingPathId === path.id" @click="retryPathGeneration(path)">重试</button>
            <button v-else class="test-paths-btn test-paths-btn--primary" @click="continuePath(path)">继续学习</button>
            <button class="test-paths-btn test-paths-btn--ghost" @click="confirmRegenerate(path)">重新生成</button>
            <button class="test-paths-btn test-paths-btn--ghost" @click="confirmDelete(path)">删除</button>
          </div>
        </article>
      </section>

      <section v-else-if="!loading" class="test-paths-empty">
        <span class="test-paths-eyebrow">还没有测试路径</span>
        <h2>先创建一个测试目标。</h2>
        <router-link to="/admin/test/goal-full" class="test-paths-btn test-paths-btn--primary">创建测试目标</router-link>
      </section>
    </main>

    <el-dialog v-model="showDeleteDialog" title="确认删除" width="400px" :close-on-click-modal="false">
      <p>确定删除测试路径 <strong>{{ pathToDelete?.name || pathToDelete?.title }}</strong> 吗？</p>
      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="deletePath">确认删除</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRegenerateDialog" title="重新生成测试路径" width="420px" :close-on-click-modal="false">
      <p>将基于当前测试目标重新生成路径结构。</p>
      <template #footer>
        <el-button @click="showRegenerateDialog = false">取消</el-button>
        <el-button type="primary" :loading="regenerating" @click="regeneratePath">确认重新生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import request from '@/utils/request';
import { learningAPI } from '@/api/learning';
import { toast } from '@/utils/toast';

const router = useRouter();
const route = useRoute();

const scrolled = ref(false);
const loading = ref(true);
const paths = ref<any[]>([]);
const deleting = ref(false);
const showDeleteDialog = ref(false);
const pathToDelete = ref<any>(null);
const regenerating = ref(false);
const showRegenerateDialog = ref(false);
const pathToRegenerate = ref<any>(null);
const retryingPathId = ref<string | null>(null);
const showGeneratingAlert = ref(false);
const activePathFilter = ref<'all' | 'active' | 'generating' | 'attention'>('all');

const GENERATION_TIMEOUT_SECONDS = 240;
const notifiedTimeoutIds = new Set<string>();

const isPathTimeout = (path: any) => {
  if (!path.createdAt) return false;
  return (Date.now() - new Date(path.createdAt).getTime()) / 1000 > GENERATION_TIMEOUT_SECONDS;
};

const generatingPaths = computed(() => paths.value.filter((p: any) => p.status === 'generating'));
const enrichingPaths = computed(() => paths.value.filter((p: any) => {
  const enrichmentStatus = p?.generationStatus?.enrichment;
  return p.status === 'active' && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing');
}));
const timeoutPaths = computed(() => generatingPaths.value.filter((p: any) => isPathTimeout(p)));

const getPathTitle = (path: any) => path.name || path.title || '未命名路径';
const getPathSummary = (path: any) => path.summary || path.description || '这里会显示路径摘要。';
const getPathStages = (path: any) => path?.milestones || path?.weeks || [];
const normalizeTaskList = (stage: any) => stage?.subtasks || stage?.tasks || [];
const getActiveStage = (path: any) => getPathStages(path).find((stage: any) => normalizeTaskList(stage).some((task: any) => task.status !== 'completed')) || getPathStages(path)[0] || null;
const getPrimaryActionTask = (path: any) => {
  const tasks = normalizeTaskList(getActiveStage(path));
  return tasks.find((task: any) => task.status === 'todo') || tasks.find((task: any) => task.status === 'in_progress') || null;
};
const getPathContinueTarget = (path: any) => {
  const nextTask = getPrimaryActionTask(path);
  if (nextTask?.id) return `/admin/test/learn/${nextTask.id}`;
  return `/admin/test/learning-path/${path.id}`;
};
const getPathDisplayState = (path: any) => {
  if (path.status === 'failed') return 'attention';
  if (path.status === 'generating') return isPathTimeout(path) ? 'attention' : 'generating';
  if (path?.generationStatus?.enrichment === 'failed') return 'attention';
  if (path?.generationStatus?.enrichment === 'processing' || path?.generationStatus?.enrichment === 'pending') return 'generating';
  return 'active';
};
const getPathStateLabel = (path: any) => {
  const state = getPathDisplayState(path);
  if (state === 'generating') return '生成中';
  if (state === 'attention') return '待处理';
  return '进行中';
};
const getCoreStepLabel = (path: any) => {
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return '方向收敛';
  if (step === 'planning') return '任务拆解';
  if (step === 'persist') return '路径落成';
  if (step === 'completed') return '主结构完成';
  return '路径生成';
};

const sortedPaths = computed(() => {
  const priority = { active: 0, generating: 1, attention: 2 } as const;
  return [...paths.value].sort((a, b) => {
    const stateDiff = priority[getPathDisplayState(a)] - priority[getPathDisplayState(b)];
    if (stateDiff !== 0) return stateDiff;
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  });
});

const primaryPath = computed(() => sortedPaths.value.find((path: any) => getPathDisplayState(path) === 'active') || null);
const pathFilterChips = computed(() => {
  const list = sortedPaths.value;
  return [
    { key: 'all', label: '全部', count: list.length },
    { key: 'active', label: '进行中', count: list.filter((path: any) => getPathDisplayState(path) === 'active').length },
    { key: 'generating', label: '生成中', count: list.filter((path: any) => getPathDisplayState(path) === 'generating').length },
    { key: 'attention', label: '待处理', count: list.filter((path: any) => getPathDisplayState(path) === 'attention').length }
  ];
});
const visiblePaths = computed(() => activePathFilter.value === 'all' ? sortedPaths.value : sortedPaths.value.filter((path: any) => getPathDisplayState(path) === activePathFilter.value));

const goalSourceConversationId = computed(() => {
  const raw = route.query.conversationId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
});
const goalSceneCandidates = computed(() => {
  if (!(route.query.from === 'goal' && route.query.auto === '1')) return [];
  const exactConversationId = goalSourceConversationId.value;
  const list = sortedPaths.value;
  if (exactConversationId) {
    const matched = list.filter((path: any) => path?.generationStatus?.sourceConversationId === exactConversationId);
    if (matched.length > 0) return matched;
  }
  return list.filter((path: any) => Boolean(path?.generationStatus?.sourceConversationId || path.status === 'generating'));
});
const goalScenePath = computed(() => goalSceneCandidates.value[0] || null);
const goalSceneState = computed<'processing' | 'ready' | 'attention'>(() => {
  const path = goalScenePath.value;
  if (!path) return 'processing';
  const displayState = getPathDisplayState(path);
  if (displayState === 'attention') return 'attention';
  if (displayState === 'active' && path?.generationStatus?.enrichment === 'succeeded') return 'ready';
  if (displayState === 'active') return 'processing';
  return 'processing';
});
const goalSceneTitle = computed(() => {
  const path = goalScenePath.value;
  if (!path) return '正在生成你的第一版完整测试路径';
  if (goalSceneState.value === 'attention') return '这版测试路径需要你重试或继续观察';
  if (goalSceneState.value === 'ready') return '这版完整测试路径已经准备好了';
  return `当前步骤：${getCoreStepLabel(path)}`;
});
const goalSceneDescription = computed(() => {
  const path = goalScenePath.value;
  if (!path) return '这里会显示 goal -> path 场景状态、阶段和内容准备情况。';
  if (goalSceneState.value === 'attention') return path.learningBlockedReason || path.summary || '当前生成遇到问题，可以刷新状态或直接重试。';
  if (goalSceneState.value === 'ready') return path.summary || '你现在可以直接查看完整任务级路径。';
  const scene = path.sceneSummary || path.generationStatus?.scene || {};
  const firstDeliverable = scene.firstDeliverable ? `先拿到「${scene.firstDeliverable}」` : '先收敛第一版可交付结果';
  return `${firstDeliverable}，期间会按时间投入拆成完整任务级路径。`;
});
const goalSceneHighlights = computed(() => {
  const path = goalScenePath.value;
  if (!path) return [];
  const scene = path.sceneSummary || path.generationStatus?.scene || {};
  return [
    scene.timeBudget ? `时间投入：${scene.timeBudget}` : '',
    scene.timeHorizon ? `周期：${scene.timeHorizon}` : '',
    typeof scene.milestoneCount === 'number' && scene.milestoneCount > 0 ? `${scene.milestoneCount} 个阶段` : '',
    typeof scene.taskCount === 'number' && scene.taskCount > 0 ? `${scene.taskCount} 个任务` : '',
  ].filter(Boolean);
});
const goalSceneSteps = computed(() => {
  const path = goalScenePath.value;
  const coreStep = path?.generationStatus?.coreStep;
  const coreStatus = path?.generationStatus?.core;
  const enrichmentStatus = path?.generationStatus?.enrichment;
  return [
    { key: 'framing', label: '方向收敛', active: coreStep === 'framing', done: coreStep !== 'framing' && !!coreStep },
    { key: 'planning', label: '任务拆解', active: coreStep === 'planning', done: coreStep === 'persist' || coreStep === 'completed' || coreStatus === 'succeeded' },
    { key: 'persist', label: '路径落成', active: coreStep === 'persist', done: coreStatus === 'succeeded' },
    { key: 'enrichment', label: '内容准备', active: enrichmentStatus === 'pending' || enrichmentStatus === 'processing', done: enrichmentStatus === 'succeeded' }
  ];
});

let pollingTimer: number | null = null;
const startPolling = () => {
  if (pollingTimer) return;
  pollingTimer = window.setInterval(async () => {
    if (generatingPaths.value.length > 0 || enrichingPaths.value.length > 0) {
      timeoutPaths.value.forEach((timeoutPath: any) => {
        if (!notifiedTimeoutIds.has(timeoutPath.id)) {
          toast.warning('测试路径生成时间较长，可以稍后刷新或直接重试');
          notifiedTimeoutIds.add(timeoutPath.id);
        }
      });
      try {
        const response = await request.get('/learning/paths');
        const newPaths = response.data.data;
        paths.value = newPaths;
        if (!newPaths.some((p: any) => p.status === 'generating' || (p.status === 'active' && (p?.generationStatus?.enrichment === 'pending' || p?.generationStatus?.enrichment === 'processing')))) {
          stopPolling();
        }
      } catch (error) {
        console.error('轮询更新失败:', error);
      }
    }
  }, 3000);
};
const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
};

const handleScroll = () => { scrolled.value = window.scrollY > 20; };
const loadPaths = async () => {
  loading.value = true;
  try {
    const response = await request.get('/learning/paths');
    paths.value = response.data.data;
  } catch (error: any) {
    console.error('加载测试学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '加载测试学习路径失败');
  } finally {
    loading.value = false;
  }
};
const confirmRegenerate = (path: any) => {
  pathToRegenerate.value = path;
  showRegenerateDialog.value = true;
};
const confirmDelete = (path: any) => {
  pathToDelete.value = path;
  showDeleteDialog.value = true;
};
const deletePath = async () => {
  if (!pathToDelete.value) return;
  deleting.value = true;
  try {
    await request.delete(`/learning/paths/${pathToDelete.value.id}`);
    toast.success('测试学习路径已删除');
    showDeleteDialog.value = false;
    pathToDelete.value = null;
    await loadPaths();
  } catch (error: any) {
    console.error('删除测试学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '删除测试学习路径失败');
  } finally {
    deleting.value = false;
  }
};
const regeneratePath = async () => {
  if (!pathToRegenerate.value) return;
  regenerating.value = true;
  try {
    await learningAPI.regeneratePath(pathToRegenerate.value.id);
    toast.success('已开始重新生成测试学习路径');
    showRegenerateDialog.value = false;
    if (!pollingTimer) startPolling();
    await loadPaths();
  } catch (error: any) {
    console.error('重新生成测试学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '重新生成测试学习路径失败');
  } finally {
    regenerating.value = false;
    pathToRegenerate.value = null;
  }
};
const goToPathDetail = (id: string) => { router.push(`/admin/test/learning-path/${id}`); };
const continuePath = (path: any) => {
  if (!path?.id) return;
  router.push(getPathContinueTarget(path));
};
const retryPathGeneration = async (path: any) => {
  if (!path.description) {
    toast.error('路径描述缺失，请通过测试目标页重新创建');
    return;
  }
  retryingPathId.value = path.id;
  try {
    await request.patch(`/learning/paths/${path.id}/retry`);
    toast.success('已开始重新生成测试学习路径');
    if (!pollingTimer) startPolling();
    await loadPaths();
  } catch (error: any) {
    console.error('重试生成失败:', error);
    toast.error(error.response?.data?.error?.message || '重试生成失败，请稍后重试');
  } finally {
    retryingPathId.value = null;
  }
};

onMounted(() => {
  if (route.query.from === 'goal' && route.query.auto === '1') {
    showGeneratingAlert.value = true;
    setTimeout(() => { showGeneratingAlert.value = false; }, 5000);
  }
  loadPaths().then(() => {
    if (generatingPaths.value.length > 0 || enrichingPaths.value.length > 0) {
      startPolling();
    }
  });
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  stopPolling();
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
.test-paths-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
  color: #172033;
}

.test-paths-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.test-paths-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
}

.test-paths-header__inner,
.test-paths-shell {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.test-paths-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.test-paths-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 900;
  color: #172033;
  cursor: pointer;
}

.test-paths-brand__logo {
  height: 52px;
}

.test-paths-nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.test-paths-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: #66758d;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.test-paths-nav a.is-active,
.test-paths-nav a.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.test-paths-header__actions {
  display: flex;
  gap: 10px;
}

.test-paths-shell {
  padding: 28px 0 80px;
}

.test-paths-alert,
.test-paths-scene-card,
.test-paths-hero,
.test-path-card,
.test-paths-empty {
  border-radius: 24px;
}

.test-paths-alert {
  margin-bottom: 14px;
}

.test-paths-scene-card,
.test-paths-hero,
.test-path-card,
.test-paths-empty {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
}

.test-paths-scene-card {
  display: grid;
  gap: 18px;
  padding: 24px 26px;
  margin-bottom: 16px;
}

.test-paths-scene-card--processing {
  background: linear-gradient(135deg, rgba(113, 128, 255, 0.12), rgba(86, 178, 255, 0.08));
}

.test-paths-scene-card--ready {
  background: linear-gradient(135deg, rgba(84, 199, 137, 0.12), rgba(113, 128, 255, 0.08));
}

.test-paths-scene-card--attention {
  background: linear-gradient(135deg, rgba(255, 170, 100, 0.16), rgba(255, 110, 110, 0.08));
}

.test-paths-eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-paths-scene-card h1,
.test-paths-hero h2,
.test-paths-empty h2 {
  margin: 10px 0 8px;
  font-size: clamp(26px, 3vw, 36px);
  line-height: 1.12;
}

.test-paths-scene-card p,
.test-paths-hero p,
.test-path-card p,
.test-paths-empty p {
  margin: 0;
  color: #66758d;
  line-height: 1.7;
  font-size: 14px;
}

.test-paths-scene-card__meta {
  display: grid;
  gap: 14px;
}

.test-paths-step-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.test-paths-step {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 0.9rem;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.6);
  color: #66758d;
  font-size: 13px;
  font-weight: 800;
}

.test-paths-step--active {
  border-color: rgba(31, 87, 204, 0.26);
  background: rgba(52, 120, 246, 0.14);
  color: #1f57cc;
}

.test-paths-step--done {
  border-color: rgba(34, 197, 94, 0.24);
  background: rgba(34, 197, 94, 0.12);
  color: #14532d;
}

.test-paths-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.test-paths-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
  font-size: 12px;
  font-weight: 700;
}

.test-paths-scene-card__actions,
.test-paths-hero__actions,
.test-path-card__actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.test-paths-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 24px 26px;
  margin-bottom: 16px;
}

.test-paths-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}

.test-paths-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.92);
  color: #66758d;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.test-paths-filter-chip--active {
  border-color: rgba(52, 120, 246, 0.18);
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
}

.test-paths-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
}

.test-path-card {
  display: grid;
  gap: 14px;
  min-height: 280px;
  padding: 22px;
}

.test-path-card--scene {
  border-color: rgba(99, 102, 241, 0.24);
  box-shadow: 0 18px 50px rgba(99, 102, 241, 0.08);
}

.test-path-card__status-row,
.test-path-card__head,
.test-path-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.test-path-state-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
}

.test-path-state-pill--active {
  background: rgba(34, 197, 94, 0.12);
  color: #166534;
}

.test-path-state-pill--generating {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.test-path-state-pill--attention {
  background: rgba(249, 115, 22, 0.12);
  color: #c2410c;
}

.test-path-state-pill--soft {
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
}

.test-path-card__head strong {
  font-size: 20px;
  line-height: 1.3;
}

.test-path-kv-list {
  display: grid;
  gap: 8px;
}

.test-path-kv span {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-path-kv strong {
  color: #172033;
  font-size: 13px;
}

.test-path-scene-summary {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.04);
}

.test-paths-empty {
  padding: 56px 28px;
  display: grid;
  justify-items: center;
  gap: 12px;
}

.test-paths-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #172033;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.test-paths-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  color: #fff;
}

.test-paths-btn--inline {
  min-height: 32px;
  padding-inline: 12px;
}

@media (max-width: 1180px) {
  .test-paths-header__inner,
  .test-paths-shell {
    width: min(100% - 32px, 1280px);
  }

  .test-paths-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .test-paths-header__inner,
  .test-paths-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .test-paths-nav {
    flex-wrap: wrap;
  }

  .test-paths-step-grid,
  .test-paths-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .test-paths-header__inner,
  .test-paths-shell {
    width: calc(100% - 24px);
  }

  .test-paths-scene-card,
  .test-paths-hero,
  .test-path-card,
  .test-paths-empty {
    padding: 18px;
    border-radius: 20px;
  }

  .test-paths-nav {
    display: none;
  }
}
</style>
