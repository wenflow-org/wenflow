<template>
  <div class="learning-paths-page paths-upgrade">
    <div class="paths-bg-layer">
      <div class="paths-bg-orb paths-bg-orb--1"></div>
      <div class="paths-bg-orb paths-bg-orb--2"></div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="dashboard-header" :class="{ 'dashboard-header--scrolled': scrolled }">
      <div class="header-container">
<button type="button" class="brand" @click="router.push(dashboardPath)">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="应用导航">
          <router-link :to="dashboardPath" class="nav-item">学习台</router-link>
          <router-link :to="goalConversationPath" class="nav-item">目标规划</router-link>
          <router-link :to="learningPathsBasePath" class="nav-item nav-item--active">学习路径</router-link>
          <router-link :to="learningStatePath" class="nav-item">学习状态</router-link>
          <router-link :to="achievementsPath" class="nav-item">成就</router-link>
        </nav>

        <div class="header-right">
          <router-link :to="goalConversationPath" class="header-cta">规划新目标</router-link>
          <ThemeSwitcher />
          <MobileSiteMenu
            :user-name="userStore.user?.name || '同学'"
            :user-initial="userInitial"
            :nav-items="headerNavItems"
            :primary-action="{ label: '规划新目标', to: goalConversationPath }"
            @logout="handleLogout"
          />
          <el-dropdown>
            <button type="button" class="user-chip">
              <span>{{ userInitial }}</span>
              <strong>{{ userStore.user?.name || '同学' }}</strong>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/user')">
                  <el-icon><User /></el-icon>
                  个人中心
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  <el-icon><Switch /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="main-content paths-main">
      <div class="content-container paths-shell">
        <transition name="slide-down">
          <el-alert
            v-if="showGeneratingAlert"
            title="学习路径正在生成，通常 1-3 分钟完成。"
            type="info"
            :closable="true"
            show-icon
            class="generating-alert"
            @close="showGeneratingAlert = false"
          />
        </transition>

        <section v-if="showGoalSceneBanner" class="paths-scene-banner glass-card" :class="`paths-scene-banner--${goalSceneState}`">
          <div class="paths-scene-banner__copy">
            <span class="pill">从目标生成</span>
            <h2>{{ goalSceneTitle }}</h2>
            <p>{{ goalSceneDescription }}</p>
          </div>

          <div class="paths-scene-banner__actions paths-scene-banner__actions--single">
            <button
              v-if="goalScenePath?.id && goalSceneState === 'ready'"
              type="button"
              class="btn btn-primary"
              @click="goToPathDetail(goalScenePath.id)"
            >查看这版路径</button>
            <button
              v-else
              type="button"
              class="btn btn-ghost"
              @click="loadPaths"
            >刷新状态</button>
          </div>
        </section>

        <section class="paths-hero glass-card">
          <div class="paths-hero__copy">
            <span class="pill">路径总览</span>
            <h1>{{ pathsHeroTitle }}</h1>
            <p>{{ pathsHeroSubtitle }}</p>
          </div>
          <div class="paths-hero__actions">
            <button v-if="primaryPath" type="button" class="btn btn-primary" @click="continuePath(primaryPath)">{{ getPathPrimaryActionLabel(primaryPath) }}</button>
            <router-link :to="goalConversationPath" class="btn btn-ghost">规划新目标</router-link>
          </div>
        </section>

        <section class="paths-filter-row" aria-label="学习路径筛选">
          <button
            v-for="item in pathFilterChips"
            :key="item.key"
            type="button"
            class="paths-filter-chip"
            :class="{ 'paths-filter-chip--active': activePathFilter === item.key }"
            @click="setPathFilter(item.key)"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.count }}</strong>
          </button>
        </section>

        <section class="paths-section">
          <div class="paths-content" :aria-busy="loading || pollingInFlight">
            <p class="sr-only" aria-live="polite">{{ pathsLiveMessage }}</p>
            <div v-if="loading && paths.length === 0" class="paths-grid paths-grid--upgraded" aria-label="正在加载学习路径">
              <article v-for="index in 3" :key="`path-skeleton-${index}`" class="path-overview-card path-overview-card--skeleton glass-card" aria-hidden="true">
                <span class="path-skeleton path-skeleton--pill"></span>
                <span class="path-skeleton path-skeleton--title"></span>
                <span class="path-skeleton path-skeleton--copy"></span>
                <span class="path-skeleton path-skeleton--copy path-skeleton--copy-short"></span>
                <div class="path-skeleton-stage-row">
                  <span v-for="stageIndex in 3" :key="stageIndex" class="path-skeleton path-skeleton--stage"></span>
                </div>
                <span class="path-skeleton path-skeleton--button"></span>
              </article>
            </div>

            <div v-else-if="visiblePaths.length > 0" class="paths-grid paths-grid--upgraded">
              <article
                v-for="path in visiblePaths"
                :key="path.id"
                class="path-overview-card glass-card"
                :aria-busy="isLifecycleBusy(path)"
                :aria-label="`${getPathTitle(path)}，${getLifecycleLabel(path)}`"
                :class="[
                  `path-overview-card--${getPathDisplayState(path)}`,
                  {
                    'path-overview-card--primary': primaryPath?.id === path.id,
                    'path-overview-card--scene': goalScenePath?.id === path.id
                  }
                ]"
              >
                <div class="path-overview-card__status-row">
                  <span class="path-state-pill" :class="getLifecyclePillClass(path)">{{ getLifecycleLabel(path) }}</span>
                  <span v-if="getLifecycle(path).phase === 'stage_design'" class="path-state-pill path-state-pill--soft">主结构已完成</span>
                </div>

                <div class="path-overview-card__head">
                  <strong>{{ getPathTitle(path) }}</strong>
                  <el-dropdown trigger="click" @command="(cmd: string) => handleCommand(cmd, path)">
                    <button type="button" class="more-btn" aria-label="路径更多操作" @click.stop>
                      <el-icon><More /></el-icon>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="regenerate">
                          <el-icon><Refresh /></el-icon>
                          <span>重新生成路径</span>
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" class="delete-item">
                          <el-icon><Delete /></el-icon>
                          <span>删除路径</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>

                <p class="path-overview-card__summary">{{ getCardSummary(path) }}</p>

                <div class="path-overview-card__phase" :class="`path-overview-card__phase--${getLifecycle(path).phase}`">
                  <template v-if="getLifecycle(path).phase === 'core'">
                    <div class="path-overview-card__phase-copy">
                      <span>路径主结构</span>
                      <strong>{{ getCoreStepLabel(path) }}</strong>
                    </div>
                    <span v-if="isLifecycleBusy(path)" class="path-activity-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  </template>
                  <template v-else-if="getLifecycle(path).phase === 'stage_design'">
                    <div class="path-overview-card__phase-copy">
                      <span>阶段任务准备</span>
                      <strong>{{ getStageDesignProgressText(path) }}</strong>
                    </div>
                    <div class="path-stage-skeleton" aria-label="路径阶段骨架">
                      <span
                        v-for="stage in getStageSkeleton(path)"
                        :key="stage.key"
                        class="path-stage-skeleton__item"
                        :class="{ 'path-stage-skeleton__item--done': stage.done, 'path-stage-skeleton__item--current': stage.current }"
                        :title="stage.title"
                      >{{ stage.number }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="path-overview-card__next-task">
                      <span>当前任务</span>
                      <strong>{{ getPathNextTaskLabel(path) }}</strong>
                    </div>
                  </template>
                </div>

                <div class="path-overview-card__stats">
                  <span>阶段：{{ getPathCurrentStage(path) }} / {{ getPathStageCount(path) }}</span>
                  <span>预计投入：{{ getPathEstimatedHours(path) }} 小时</span>
                </div>

                <div class="path-overview-card__progress-block" :class="{ 'path-overview-card__progress-block--muted': getLifecycle(path).lifecycle !== 'ready' }">
                  <div class="path-overview-card__progress-top">
                    <strong>{{ getLifecycle(path).lifecycle === 'ready' ? `${getPathProgress(path)}%` : getGenerationProgressLabel(path) }}</strong>
                    <span>{{ getLifecycle(path).lifecycle === 'ready' ? '学习进度' : '生成状态' }}</span>
                  </div>
                  <div v-if="getLifecycle(path).lifecycle === 'ready'" class="path-overview-card__progress-bar" aria-hidden="true">
                    <div class="path-overview-card__progress-fill" :style="{ width: `${getPathProgress(path)}%` }"></div>
                  </div>
                  <div v-else class="path-overview-card__status-line" aria-hidden="true">
                    <span :class="{ 'path-overview-card__status-line-marker--busy': isLifecycleBusy(path) }"></span>
                  </div>
                </div>

                <div class="path-overview-card__actions-row">
                  <button
                    v-if="canRetryPath(path)"
                    type="button"
                    class="btn btn-primary"
                    :disabled="retryingPathId === path.id"
                    @click="retryPathGeneration(path)"
                  >{{ getRetryButtonLabel(path) }}</button>
                  <button
                    v-else-if="getLifecycle(path).lifecycle === 'ready' && getLifecycle(path).canStartLearning"
                    type="button"
                    class="btn btn-primary"
                    @click="continuePath(path)"
                  >{{ getPathPrimaryActionLabel(path) }}</button>
                  <button v-else type="button" class="btn btn-ghost" @click="refreshPathStatus(path)">刷新状态</button>
                  <button type="button" class="btn btn-ghost" @click="goToPathDetail(path.id)">查看详情</button>
                </div>
              </article>
            </div>

            <section v-else-if="!loading" class="paths-empty-state glass-card">
              <span class="pill">{{ loadError ? '加载失败' : activePathFilter === 'all' ? '开始第一条路径' : '当前筛选无结果' }}</span>
              <h2>{{ emptyStateTitle }}</h2>
              <p>{{ emptyStateDescription }}</p>
              <button v-if="loadError" type="button" class="btn btn-primary" @click="loadPaths">重新加载</button>
              <button v-else-if="activePathFilter !== 'all'" type="button" class="btn btn-primary" @click="activePathFilter = 'all'">查看全部路径</button>
              <router-link v-else :to="goalConversationPath" class="btn btn-primary">规划第一个目标</router-link>
            </section>
          </div>
        </section>
      </div>
      <AppMiniFooter />
    </main>

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="showDeleteDialog"
      title="确认删除"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="!deleting"
      :show-close="!deleting"
      class="delete-dialog"
    >
      <el-alert
        title="注意"
        type="warning"
        :closable="false"
        show-icon
        class="delete-alert"
      >
        删除学习路径将永久删除此路径及其所有数据，包括学习记录、任务进度等。此操作不可恢复。
      </el-alert>

      <p class="delete-confirm-text">
        确定删除学习路径 <strong class="delete-path-name">{{ pathToDelete?.name }}</strong> 吗？
      </p>

      <template #footer>
        <el-button :disabled="deleting" @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" @click="deletePath" :loading="deleting">
          确认删除
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showRegenerateDialog"
      title="重新生成学习路径"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="!regenerating"
      :show-close="!regenerating"
      class="delete-dialog"
    >
      <el-alert
        title="将覆盖当前路径"
        type="info"
        :closable="false"
        show-icon
        class="delete-alert"
      >
        将删除当前路径结构及其任务，并生成一套新的阶段与任务。当前任务进度会被新任务替换，请确认后再继续。
      </el-alert>

      <p class="delete-confirm-text">
        确定重新生成学习路径 <strong class="delete-path-name">{{ pathToRegenerate?.name || pathToRegenerate?.title }}</strong> 吗？
      </p>

      <template #footer>
        <el-button :disabled="regenerating" @click="showRegenerateDialog = false">取消</el-button>
        <el-button type="primary" @click="regeneratePath" :loading="regenerating">
          确认重新生成
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import {
  Delete,
  More,
  User,
  Switch,
  Refresh
} from '@element-plus/icons-vue';
import request from '../utils/api';
import { useUserStore } from '../stores/user';
import {
  learningAPI,
  mergeGenerationLifecycle,
  normalizeGenerationLifecycle,
  type GenerationLifecycleDTO,
  type LearningPath,
  type Task
} from '../api/learning';
import MobileSiteMenu from '../components/MobileSiteMenu.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import AppMiniFooter from '../components/AppMiniFooter.vue';

// 后端列表/详情接口可能额外返回、但 LearningPath 未声明的字段
type LearningPathRecord = LearningPath & {
  totalMilestones?: number;
  currentStage?: number;
  currentMilestoneIndex?: number;
  currentMilestoneOrder?: number;
  totalEstimatedHours?: number;
  hours?: number;
  progress?: number;
  progressPercentage?: number;
  completionRate?: number;
};

// 路径的阶段可能以 milestones/stages/weeks 任一形式返回
type PathStageLike = {
  id?: string;
  stageNumber?: number;
  weekNumber?: number;
  title?: string;
  subtasks?: Task[];
  tasks?: Task[];
};

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const goalConversationPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/goal-full' : '/test/goal-full';
  }
  return '/goal-conversation';
});
const learningPathsBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-paths' : '/test/learning-paths';
  }
  return '/learning-paths';
});
const dashboardPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/dashboard' : '/dashboard';
  }
  return '/dashboard';
});
const learningStatePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-state' : '/learning-state';
  }
  return '/learning-state';
});
const achievementsPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/achievements' : '/achievements';
  }
  return '/achievements';
});

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const headerNavItems = computed(() => [
  { label: '学习台', to: dashboardPath.value, matchPrefixes: ['/dashboard', '/admin/test/dashboard'] },
  { label: '目标规划', to: goalConversationPath.value, matchPrefixes: ['/goal-conversation', '/test/goal-full', '/admin/test/goal-full'] },
  {
    label: '学习路径',
    to: learningPathsBasePath.value,
    matchPrefixes: ['/learning-paths', '/learning-path/', '/test/learning-paths', '/test/learning-path/', '/admin/test/learning-paths', '/admin/test/learning-path/']
  },
  { label: '学习状态', to: learningStatePath.value, matchPrefixes: ['/learning-state', '/admin/test/learning-state'] },
  { label: '成就', to: achievementsPath.value, matchPrefixes: ['/achievements', '/admin/test/achievements'] }
])
const scrolled = ref(false);
const loading = ref(true);
const loadError = ref('');
const paths = ref<LearningPathRecord[]>([]);
const deleting = ref(false);
const showDeleteDialog = ref(false);
const pathToDelete = ref<LearningPathRecord | null>(null);
const regenerating = ref(false);
const showRegenerateDialog = ref(false);
const pathToRegenerate = ref<LearningPathRecord | null>(null);
const retryingPathId = ref<string | null>(null);
const showGeneratingAlert = ref(false);
const activePathFilter = ref<'all' | 'active' | 'completed' | 'generating' | 'attention'>('all');
const pathOrder = ref<string[]>([]);
const pathsLiveMessage = ref('');
const announcedLifecycle = new Map<string, string>();

const getLifecycle = (path: LearningPathRecord): GenerationLifecycleDTO => normalizeGenerationLifecycle(path);

const isLifecycleBusy = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path).lifecycle;
  return lifecycle === 'core_queued'
    || lifecycle === 'core_processing'
    || lifecycle === 'stage_design_queued'
    || lifecycle === 'stage_design_processing';
};

const generatingPaths = computed(() => paths.value.filter((path) => isLifecycleBusy(path)));

const getPathTitle = (path: LearningPathRecord) => path.name || path.title || '未命名路径';

const getPathSummary = (path: LearningPathRecord) => {
  return path.summary || path.description || '暂未生成路径说明。';
};

const getPathStages = (path: LearningPathRecord): PathStageLike[] => path?.milestones || path?.weeks || [];

const normalizeTaskList = (stage?: PathStageLike | null): Task[] => stage?.subtasks || stage?.tasks || [];

const getActiveStage = (path: LearningPathRecord) => {
  const stages = getPathStages(path);
  if (!stages.length) return null;

  return stages.find((stage) => {
    const tasks = normalizeTaskList(stage);
    return tasks.some((task) => task.status !== 'completed');
  }) || stages[0] || null;
};

const getPrimaryActionTask = (path: LearningPathRecord) => {
  const tasks = normalizeTaskList(getActiveStage(path));
  return tasks.find((task) => task.status === 'in_progress')
    || tasks.find((task) => task.status === 'todo')
    || null;
};

const getPathContinueTarget = (path: LearningPathRecord) => {
  const nextTask = getPrimaryActionTask(path);
  if (nextTask?.id) {
    if (isTestMode.value) {
      return isAdminRoute.value ? `/admin/test/learn/${nextTask.id}` : `/learn/${nextTask.id}`;
    }
    return `/learn/${nextTask.id}`;
  }
  if (isTestMode.value) {
    return isAdminRoute.value ? `/admin/test/learning-path/${path.id}` : `/test/learning-path/${path.id}`;
  }
  return `/learning-path/${path.id}`;
};

const getPathNextTaskLabel = (path: LearningPathRecord) => {
  return getPrimaryActionTask(path)?.title || '进入路径查看安排';
};

const getPathStageCount = (path: LearningPathRecord) => getLifecycle(path).totalStages
  || path.totalMilestones
  || path.totalStages
  || path.milestones?.length
  || path.weeks?.length
  || 0;

const getPathCurrentStage = (path: LearningPathRecord) => {
  const currentStageNumber = getLifecycle(path).currentStageNumber;
  if (currentStageNumber) return currentStageNumber;
  if (typeof path.currentStage === 'number') return path.currentStage;
  if (typeof path.currentMilestoneIndex === 'number') return path.currentMilestoneIndex + 1;
  if (typeof path.currentMilestoneOrder === 'number') return path.currentMilestoneOrder;

  const activeStage = getActiveStage(path);
  if (activeStage) {
    const explicitStageNumber = Number(activeStage.stageNumber || activeStage.weekNumber);
    if (Number.isFinite(explicitStageNumber) && explicitStageNumber > 0) {
      return explicitStageNumber;
    }

    const stages = getPathStages(path);
    const activeIndex = stages.findIndex((stage) => stage === activeStage);
    if (activeIndex >= 0) {
      return activeIndex + 1;
    }
  }

  return getPathStageCount(path) > 0 ? 1 : 0;
};

const getPathEstimatedHours = (path: LearningPathRecord) => {
  const value = path.estimatedHours || path.totalEstimatedHours || path.hours || 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
};

const getPathProgress = (path: LearningPathRecord) => {
  if (typeof path.progress === 'number') return Math.max(0, Math.min(100, Math.round(path.progress)));
  if (typeof path.progressPercentage === 'number') return Math.max(0, Math.min(100, Math.round(path.progressPercentage)));
  if (typeof path.completionRate === 'number') return Math.max(0, Math.min(100, Math.round(path.completionRate * 100)));

  const stages = getPathStages(path);
  const tasks = stages.flatMap((stage) => normalizeTaskList(stage));
  if (tasks.length > 0) {
    const completed = tasks.filter((task) => task.status === 'completed').length;
    return Math.max(0, Math.min(100, Math.round((completed / tasks.length) * 100)));
  }

  const total = getPathStageCount(path);
  const current = getPathCurrentStage(path);
  if (total > 0 && current > 0) {
    return Math.max(0, Math.min(100, Math.round(((current - 1) / total) * 100)));
  }
  return 0;
};

const getPathDisplayState = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.status === 'failed' || lifecycle.status === 'stale') return 'attention';
  if (isLifecycleBusy(path)) return 'generating';
  if (path.status === 'completed' || getPathProgress(path) >= 100) return 'completed';
  return 'active';
};

const getPathStateLabel = (path: LearningPathRecord) => getPathDisplayState(path) === 'completed' ? '已完成' : '进行中';

const getPathPrimaryActionLabel = (path: LearningPathRecord) => {
  if (getPathDisplayState(path) === 'completed') return '查看学习成果';
  return getPrimaryActionTask(path)?.status === 'in_progress' ? '继续当前任务' : '开始下一项任务';
};

const getFailureCopy = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.errorMessage) return lifecycle.errorMessage;
  if (lifecycle.lifecycle === 'core_stale') return '路径主结构长时间没有更新，可以重新生成主结构。';
  if (lifecycle.lifecycle === 'core_failed') return '路径主结构生成失败，可以重新生成。';
  if (lifecycle.lifecycle === 'stage_design_stale') return '阶段任务准备长时间没有更新，可以仅重新准备阶段任务。';
  if (lifecycle.lifecycle === 'stage_design_failed') return '阶段任务准备失败，路径主结构已保留，可以重新准备阶段任务。';
  return '生成状态暂不可用，请稍后刷新。';
};

const getLifecycleLabel = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path).lifecycle;
  const labels: Record<string, string> = {
    core_queued: '主结构排队中',
    core_processing: '主结构生成中',
    core_stale: '主结构停滞',
    core_failed: '主结构失败',
    stage_design_queued: '阶段任务排队中',
    stage_design_processing: '阶段任务准备中',
    stage_design_stale: '阶段任务停滞',
    stage_design_failed: '阶段任务失败',
    ready: getPathStateLabel(path)
  };
  return labels[lifecycle] || '状态更新中';
};

const getLifecyclePillClass = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.status === 'failed' || lifecycle.status === 'stale') return 'path-state-pill--failed';
  if (lifecycle.lifecycle === 'ready') return 'path-state-pill--active';
  return 'path-state-pill--generating';
};

const getCardSummary = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.status === 'failed' || lifecycle.status === 'stale') return getFailureCopy(path);
  if (lifecycle.phase === 'core') return path.description || '正在根据学习目标生成路径标题、阶段与重点。';
  return getPathSummary(path);
};

const getStageDesignProgressText = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.totalStages <= 0) return '正在准备各阶段任务';
  const currentStage = getPathStages(path).find((stage, index) => {
    const stageNumber = Number(stage?.stageNumber || stage?.weekNumber || index + 1);
    return stageNumber === lifecycle.currentStageNumber;
  });
  const currentStageText = currentStage?.title ? `，当前「${currentStage.title}」` : '';
  return `已完成 ${lifecycle.completedStages} / ${lifecycle.totalStages} 个阶段${currentStageText}`;
};

const getStageSkeleton = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  const stages = getPathStages(path);
  const count = Math.max(lifecycle.totalStages, stages.length, 1);
  return Array.from({ length: count }, (_, index) => {
    const stage = stages[index];
    const number = Number(stage?.stageNumber || stage?.weekNumber || index + 1);
    return {
      key: stage?.id || `${path.id}-stage-${index + 1}`,
      number,
      title: stage?.title || `第 ${number} 阶段`,
      done: index < lifecycle.completedStages,
      current: lifecycle.currentStageNumber === number
        || (!lifecycle.currentStageNumber && index === lifecycle.completedStages && lifecycle.completedStages < count)
    };
  });
};

const getGenerationProgressLabel = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.phase === 'stage_design' && lifecycle.totalStages > 0) {
    return `${lifecycle.completedStages}/${lifecycle.totalStages}`;
  }
  if (lifecycle.status === 'failed') return '失败';
  if (lifecycle.status === 'stale') return '停滞';
  return lifecycle.status === 'queued' ? '排队' : '进行中';
};

const canRetryPath = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  return lifecycle.retryAllowed && Boolean(lifecycle.retryType);
};

const getRetryButtonLabel = (path: LearningPathRecord) => (
  getLifecycle(path).retryType === 'stage_design' ? '重新准备阶段任务' : '重新生成主结构'
);

const updatePaths = (nextPaths: LearningPathRecord[]) => {
  const currentIds = new Set(pathOrder.value);
  const newIds = nextPaths
    .filter((path) => !currentIds.has(path.id))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
    .map((path) => path.id);

  if (pathOrder.value.length === 0) {
    pathOrder.value = [...nextPaths]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
      .map((path) => path.id);
  } else if (newIds.length > 0) {
    pathOrder.value = [...newIds, ...pathOrder.value];
  }

  const nextIds = new Set(nextPaths.map((path) => path.id));
  pathOrder.value = pathOrder.value.filter(id => nextIds.has(id));
  paths.value = nextPaths;
};

const announceLifecycleChange = (path: LearningPathRecord, previous: string, next: string) => {
  const announcementKey = `${previous}:${next}`;
  if (previous === next || announcedLifecycle.get(path.id) === announcementKey) return;
  announcedLifecycle.set(path.id, announcementKey);
  pathsLiveMessage.value = `「${getPathTitle(path)}」${getLifecycleLabel(path)}`;
  if (next === 'ready') toast.success(`「${getPathTitle(path)}」已准备完成`);
  if (next === 'core_failed') toast.error(`「${getPathTitle(path)}」主结构生成失败，可以重新生成`);
  if (next === 'stage_design_failed') toast.error(`「${getPathTitle(path)}」阶段任务准备失败，可以单独重试`);
  if (next === 'core_stale') toast.warning(`「${getPathTitle(path)}」主结构生成已停滞`);
  if (next === 'stage_design_stale') toast.warning(`「${getPathTitle(path)}」阶段任务准备已停滞`);
};

const sortedPaths = computed(() => {
  const orderIndex = new Map(pathOrder.value.map((id, index) => [id, index]));
  return [...paths.value].sort((a, b) => {
    const indexA = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const indexB = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return indexA - indexB;
  });
});

const primaryPath = computed(() => {
  const activePaths = sortedPaths.value.filter((path) => getPathDisplayState(path) === 'active');
  return activePaths.find((path) => Boolean(getPrimaryActionTask(path))) || activePaths[0] || null;
});

const pathsHeroTitle = '继续你的学习计划';
const pathsHeroSubtitle = '查看当前任务、路径进度和需要处理的问题。';

const pathFilterChips = computed(() => {
  const list = sortedPaths.value;
  return [
    { key: 'all', label: '全部', count: list.length },
    { key: 'active', label: '进行中', count: list.filter((path) => getPathDisplayState(path) === 'active').length },
    { key: 'completed', label: '已完成', count: list.filter((path) => getPathDisplayState(path) === 'completed').length },
    { key: 'generating', label: '生成中', count: list.filter((path) => getPathDisplayState(path) === 'generating').length },
    { key: 'attention', label: '待重试', count: list.filter((path) => getPathDisplayState(path) === 'attention').length }
  ];
});

const visiblePaths = computed(() => {
  const list = sortedPaths.value;
  if (activePathFilter.value === 'all') return list;
  return list.filter((path) => getPathDisplayState(path) === activePathFilter.value);
});

const setPathFilter = (key: string) => {
  if (key === 'all' || key === 'active' || key === 'completed' || key === 'generating' || key === 'attention') {
    activePathFilter.value = key;
  }
};

const emptyStateTitle = computed(() => {
  if (loadError.value) return '学习路径加载失败';
  if (activePathFilter.value === 'all') return '还没有学习路径';
  if (activePathFilter.value === 'active') return '没有进行中的路径';
  if (activePathFilter.value === 'completed') return '还没有完成的路径';
  if (activePathFilter.value === 'generating') return '没有正在生成的路径';
  return '没有需要重试的路径';
});

const emptyStateDescription = computed(() => {
  if (loadError.value) return loadError.value;
  return activePathFilter.value === 'all'
    ? '先规划一个目标，生成第一条学习路径。'
    : '可以查看其他状态的学习路径。';
});

const POLLING_INTERVAL_MS = 5000;
const POLLING_MAX_BACKOFF_MS = 60000;
let pollingTimer: number | null = null;
const pollingInFlight = ref(false);
let pollingFailureCount = 0;
let pathsRequestInFlight: Promise<LearningPathRecord[]> | null = null;

const hasPollingTargets = (pathList: LearningPathRecord[]) => pathList.some((path) => {
  return isLifecycleBusy(path);
}) || (
  route.query.from === 'goal'
  && route.query.auto === '1'
  && Boolean(goalSourceConversationId.value)
  && !pathList.some((path) => path?.generationStatus?.sourceConversationId === goalSourceConversationId.value)
);

const fetchPathsSingleFlight = () => {
  if (pathsRequestInFlight) return pathsRequestInFlight;
  pathsRequestInFlight = request.get('/learning/paths')
    .then((body) => (body.data || []) as LearningPathRecord[])
    .then((pathList) => pathList.map((path) => ({
      ...path,
      generationLifecycle: normalizeGenerationLifecycle(path)
    })))
    .finally(() => {
      pathsRequestInFlight = null;
    });
  return pathsRequestInFlight;
};

const schedulePolling = (delayMs = POLLING_INTERVAL_MS) => {
  if (document.hidden || !hasPollingTargets(paths.value)) return;
  if (pollingTimer) window.clearTimeout(pollingTimer);
  pollingTimer = window.setTimeout(() => {
    pollingTimer = null;
    void pollPaths();
  }, delayMs);
};

const pollPaths = async () => {
  if (pollingInFlight.value || document.hidden || !hasPollingTargets(paths.value)) return;

  pollingInFlight.value = true;
  try {
    const targetPaths = paths.value.filter((path) => isLifecycleBusy(path));
    if (targetPaths.length === 0) {
      updatePaths(await fetchPathsSingleFlight());
      pollingFailureCount = 0;
      schedulePolling();
      return;
    }
    const results = await Promise.allSettled(
      targetPaths.map(async (path) => ({
        id: path.id,
        lifecycle: await learningAPI.getPathGenerationStatus(path.id)
      }))
    );
    const failedRequests = results.filter(result => result.status === 'rejected').length;
    if (failedRequests === results.length) {
      throw new Error('generation status polling failed');
    }
    const readyTransitions: Array<{ id: string; previous: string }> = [];

    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const index = paths.value.findIndex((path) => path.id === result.value.id);
      if (index < 0) return;
      const previousLifecycle = getLifecycle(paths.value[index]).lifecycle;
      const nextLifecycle = result.value.lifecycle.lifecycle;
      if (previousLifecycle !== nextLifecycle && nextLifecycle === 'ready') {
        readyTransitions.push({ id: result.value.id, previous: previousLifecycle });
        return;
      }
      paths.value[index] = mergeGenerationLifecycle(paths.value[index], result.value.lifecycle);
      announceLifecycleChange(paths.value[index], previousLifecycle, nextLifecycle);
    });

    if (readyTransitions.length > 0) {
      const refreshedPaths = await fetchPathsSingleFlight();
      updatePaths(refreshedPaths);
      readyTransitions.forEach(({ id, previous }) => {
        const refreshedPath = paths.value.find((path) => path.id === id);
        if (refreshedPath) announceLifecycleChange(refreshedPath, previous, getLifecycle(refreshedPath).lifecycle);
      });
    }
    if (failedRequests > 0) {
      pollingFailureCount += 1;
      schedulePolling(Math.min(POLLING_INTERVAL_MS * (2 ** pollingFailureCount), POLLING_MAX_BACKOFF_MS));
    } else {
      pollingFailureCount = 0;
      schedulePolling();
    }
  } catch {
    pollingFailureCount += 1;
    const delay = Math.min(POLLING_INTERVAL_MS * (2 ** pollingFailureCount), POLLING_MAX_BACKOFF_MS);
    schedulePolling(delay);
  } finally {
    pollingInFlight.value = false;
  }
};

const startPolling = () => {
  if (pollingTimer || pollingInFlight.value || document.hidden || !hasPollingTargets(paths.value)) return;
  schedulePolling();
};

const stopPolling = () => {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    stopPolling();
    return;
  }
  if (hasPollingTargets(paths.value)) schedulePolling(0);
};

const handleScroll = () => {
  scrolled.value = window.scrollY > 50;
};

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    userStore.logout();
    toast.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

const loadPaths = async () => {
  if (paths.value.length === 0) loading.value = true;
  loadError.value = '';
  try {
    updatePaths(await fetchPathsSingleFlight());
    pollingFailureCount = 0;
    if (hasPollingTargets(paths.value)) startPolling();
    else stopPolling();
  } catch (error: any) {
    console.error('加载学习路径失败:', error);
    loadError.value = '无法读取学习路径数据，请检查网络或服务状态后重试。';
    toast.error(error.response?.data?.error?.message || '加载学习路径失败');
  } finally {
    loading.value = false;
  }
};

const handleCommand = (command: string, path: LearningPathRecord) => {
  if (command === 'regenerate') {
    confirmRegenerate(path);
  } else if (command === 'delete') {
    confirmDelete(path);
  }
};

const goalSourceConversationId = computed(() => {
  const raw = route.query.conversationId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
});
const showGoalSceneBanner = computed(() => (
  route.query.from === 'goal'
  && route.query.auto === '1'
  && Boolean(goalSourceConversationId.value)
));
const getCoreStepLabel = (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  if (lifecycle.lifecycle === 'core_queued') return '等待开始生成路径主结构';
  if (lifecycle.lifecycle === 'core_stale') return '路径主结构生成已停滞';
  if (lifecycle.lifecycle === 'core_failed') return '路径主结构生成失败';
  if (lifecycle.phase !== 'core') return '路径主结构已完成';
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return '正在确认路径重点';
  if (step === 'planning') return '正在拆解完整任务路径';
  if (step === 'persist') return '正在保存学习路径';
  if (step === 'completed') return '路径主结构已完成';
  return '正在生成路径';
};

const goalSceneCandidates = computed(() => {
  if (!(route.query.from === 'goal' && route.query.auto === '1')) {
    return [];
  }

  const exactConversationId = goalSourceConversationId.value;
  const list = sortedPaths.value;

  if (exactConversationId) {
    return list.filter((path) => path?.generationStatus?.sourceConversationId === exactConversationId);
  }

  return [];
});

const goalScenePath = computed(() => goalSceneCandidates.value[0] || null);

const goalSceneState = computed<'processing' | 'ready' | 'attention'>(() => {
  const path = goalScenePath.value;
  if (!path) return 'processing';
  const displayState = getPathDisplayState(path);
  if (displayState === 'attention') return 'attention';
  if (getLifecycle(path).lifecycle === 'ready') return 'ready';
  return 'processing';
});

const goalSceneTitle = computed(() => {
  const path = goalScenePath.value;
  if (!path) return '正在生成你的第一版学习路径';
  if (goalSceneState.value === 'attention') {
    return '这版路径暂时还没准备好';
  }
  if (goalSceneState.value === 'ready') {
    return '这版学习路径已经准备好了';
  }
  if (getLifecycle(path).phase === 'stage_design') {
    return '路径主结构已完成，正在准备阶段任务';
  }
  return getCoreStepLabel(path);
});

const goalSceneDescription = computed(() => {
  const path = goalScenePath.value;
  if (!path) {
    return '问流正在根据刚确认的目标生成第一版学习路径。';
  }
  if (goalSceneState.value === 'attention') {
    return path.learningBlockedReason || path.summary || '当前生成遇到问题，可以先刷新状态或直接重试。';
  }
  if (goalSceneState.value === 'ready') {
    return path.summary || '你现在可以直接查看路径结构，并按阶段开始推进。';
  }
  const scene: { firstDeliverable?: string } = path.sceneSummary || path.generationStatus?.scene || {};
  const firstDeliverable = scene.firstDeliverable ? `先完成「${scene.firstDeliverable}」` : '先明确第一个可以完成的成果';
  return `${firstDeliverable}，再按你的可用时间拆成具体任务。`;
});

const confirmRegenerate = (path: LearningPathRecord) => {
  pathToRegenerate.value = path;
  showRegenerateDialog.value = true;
};

const confirmDelete = (path: LearningPathRecord) => {
  pathToDelete.value = path;
  showDeleteDialog.value = true;
};

const deletePath = async () => {
  if (!pathToDelete.value) return;

  deleting.value = true;
  try {
    await request.delete(`/learning/paths/${pathToDelete.value.id}`);
    toast.success('学习路径已删除');
    showDeleteDialog.value = false;
    pathToDelete.value = null;
    await loadPaths();
  } catch (error: any) {
    console.error('删除学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '删除学习路径失败');
  } finally {
    deleting.value = false;
  }
};

const regeneratePath = async () => {
  const targetPath = pathToRegenerate.value;
  if (!targetPath) return;

  regenerating.value = true;
  try {
    await learningAPI.regeneratePath(targetPath.id);

    const index = paths.value.findIndex(p => p.id === targetPath.id);
    if (index !== -1) {
      paths.value[index] = mergeGenerationLifecycle(paths.value[index], {
        lifecycle: 'core_queued',
        retryAllowed: false,
        canStartLearning: false
      });
    }

    showRegenerateDialog.value = false;
    pathToRegenerate.value = null;
    toast.success('已开始重新生成学习路径');

    if (!pollingTimer) {
      startPolling();
    }
    schedulePolling(1500);
  } catch (error: any) {
    console.error('重新生成学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '重新生成学习路径失败');
  } finally {
    regenerating.value = false;
  }
};

const goToPathDetail = (id: string) => {
  if (isTestMode.value) {
    router.push(isAdminRoute.value ? `/admin/test/learning-path/${id}` : `/test/learning-path/${id}`);
    return;
  }
  router.push(`/learning-path/${id}`);
};

const continuePath = (path: LearningPathRecord | null) => {
  if (!path?.id) return;
  router.push(getPathContinueTarget(path));
};

const refreshPathStatus = async (path: LearningPathRecord) => {
  if (!path?.id || pollingInFlight.value) return;
  pollingInFlight.value = true;
  try {
    const previousLifecycle = getLifecycle(path).lifecycle;
    const lifecycle = await learningAPI.getPathGenerationStatus(path.id);
    const index = paths.value.findIndex((item) => item.id === path.id);
    if (index >= 0) {
      if (lifecycle.lifecycle === 'ready') {
        updatePaths(await fetchPathsSingleFlight());
      } else {
        paths.value[index] = mergeGenerationLifecycle(paths.value[index], lifecycle);
      }
      const refreshedPath = paths.value.find((item) => item.id === path.id);
      if (refreshedPath) announceLifecycleChange(refreshedPath, previousLifecycle, getLifecycle(refreshedPath).lifecycle);
    }
    pollingFailureCount = 0;
    if (hasPollingTargets(paths.value)) schedulePolling();
  } catch (error: any) {
    toast.error(error.message || '刷新生成状态失败');
  } finally {
    pollingInFlight.value = false;
  }
};

// 重试生成失败的路径
const retryPathGeneration = async (path: LearningPathRecord) => {
  const lifecycle = getLifecycle(path);
  const shouldRetryStageDesign = lifecycle.retryType === 'stage_design';
  if (!shouldRetryStageDesign && !path.description) {
    toast.error('路径描述缺失，请通过目标对话重新创建');
    return;
  }

  retryingPathId.value = path.id;
  try {
    if (shouldRetryStageDesign) {
      await learningAPI.retryPathEnrichment(path.id);
    } else {
      await learningAPI.retryPathGeneration(path.id);
    }
    
    const index = paths.value.findIndex(p => p.id === path.id);
    if (index !== -1) {
      paths.value[index] = mergeGenerationLifecycle(paths.value[index], {
        lifecycle: shouldRetryStageDesign ? 'stage_design_queued' : 'core_queued',
        retryAllowed: false,
        canStartLearning: false,
        completedStages: shouldRetryStageDesign ? lifecycle.completedStages : 0,
        totalStages: lifecycle.totalStages
      });
    }
    
    toast.success(shouldRetryStageDesign ? '已在后台重新准备阶段任务' : '已开始重新生成学习路径');
    
    if (!pollingTimer) {
      startPolling();
    }
    schedulePolling(1500);
  } catch (error: any) {
    console.error('重试生成失败:', error);
    toast.error(error.response?.data?.error?.message || '重试生成失败，请稍后重试');
  } finally {
    retryingPathId.value = null;
  }
};

// 提示自动关闭的定时器句柄，卸载时需清理
let generatingAlertTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  // 检查是否从 goal-conversation 跳转过来
  if (route.query.from === 'goal' && route.query.auto === '1') {
    showGeneratingAlert.value = true;
    // 5秒后自动关闭提示
    generatingAlertTimer = setTimeout(() => {
      showGeneratingAlert.value = false;
      generatingAlertTimer = null;
    }, 5000);
  }

  loadPaths().then(() => {
    // 如果有正在生成或准备中的路径，启动轮询
    if (generatingPaths.value.length > 0) {
      startPolling();
    }
  });

  window.addEventListener('scroll', handleScroll, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  stopPolling();
  if (generatingAlertTimer !== null) {
    clearTimeout(generatingAlertTimer);
    generatingAlertTimer = null;
  }
  window.removeEventListener('scroll', handleScroll);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.learning-paths-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-body);
  position: relative;
  overflow-x: hidden;
  width: 100%;
  max-width: 100vw;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.paths-scene-banner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 1.5rem;
  margin-bottom: 1.25rem;
  padding: 1.5rem;
  border: 1px solid rgba(120, 129, 255, 0.14);
}

.paths-scene-banner--processing {
  background: linear-gradient(135deg, rgba(113, 128, 255, 0.08), rgba(86, 178, 255, 0.06));
}

.paths-scene-banner--ready {
  background: linear-gradient(135deg, rgba(84, 199, 137, 0.12), rgba(113, 128, 255, 0.06));
}

.paths-scene-banner--attention {
  background: linear-gradient(135deg, rgba(255, 170, 100, 0.14), rgba(255, 110, 110, 0.08));
}

.paths-scene-banner__copy h2 {
  margin: 0.6rem 0 0.5rem;
  font-size: 1.55rem;
  line-height: 1.2;
}

.paths-scene-banner__copy p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.paths-scene-banner__actions {
  display: flex;
  justify-content: flex-start;
}

.path-overview-card--scene {
  border-color: rgba(99, 102, 241, 0.24);
  box-shadow: 0 18px 50px rgba(99, 102, 241, 0.08);
}

.animated-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.4;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 800px;
  height: 800px;
  background: var(--gradient-primary);
  top: -300px;
  right: -200px;
}

.gradient-orb-2 {
  width: 600px;
  height: 600px;
  background: var(--gradient-achievement);
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

.failed-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(50px, 50px) scale(1.05);
  }
}

/* ========== 头部导航 ========== */
.dashboard-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid transparent;
  transition: all 0.3s ease;
}

.header-scrolled,
.dashboard-header--scrolled {
  background: rgba(255, 255, 255, 0.95);
  border-bottom-color: var(--border-default);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .dashboard-header {
  background: rgba(26, 37, 47, 0.85);
}

[data-theme="dark"] .header-scrolled {
  background: rgba(26, 37, 47, 0.95);
}

.header-container {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  width: 100%;
  min-width: 0;
}

.header-left .brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}

.brand-icon {
  font-size: 1.75rem;
}

.brand-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-xl);
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.nav-item-active,
.nav-item--active {
  background: var(--color-primary);
  color: white;
}

.nav-item-active:hover,
.nav-item--active:hover {
  background: var(--color-primary);
  color: white;
}

.nav-item-highlight {
  background: var(--gradient-primary);
  color: white;
}

.nav-item-highlight:hover {
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.brand {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
}

.brand-logo {
  height: 40px;
}

.brand {
  width: auto;
  justify-content: flex-start;
  flex: 0 0 auto;
}

.brand-logo {
  height: 56px;
  object-fit: contain;
  display: block;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), #1f57cc);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: var(--text-primary);
}

.user-chip span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
  font-weight: 900;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid var(--border-light);
  transition: border-color 0.2s ease;
}

.user-avatar:hover {
  border-color: var(--color-primary);
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
  font-size: 1rem;
}

.user-name {
  font-weight: 600;
  color: var(--text-primary);
}

/* Dashboard Nav Exact Override */
.dashboard-header {
  z-index: 10;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
  backdrop-filter: blur(18px);
}

.dashboard-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

.header-container {
  width: min(1280px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0;
}

.brand {
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #172033;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.header-nav {
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.nav-item {
  padding: 8px 12px;
  border-radius: 999px;
  color: color-mix(in srgb, #172033 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.nav-item:hover,
.nav-item--active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.header-right {
  gap: 10px;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  font-size: 13px;
  font-weight: 800;
}

.user-chip {
  gap: 8px;
  min-height: 38px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: #172033;
}

.user-chip span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
  font-weight: 900;
}

/* ========== 主内容区 ========== */
.main-content {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 80px;
  overflow-x: hidden;
}

.content-container {
  width: 100%;
  min-width: 0;
}

/* ========== 玻璃卡片 ========== */
.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}

[data-theme="dark"] .glass-card {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ========== 页面标题区 ========== */
.generating-alert {
  margin-bottom: 1rem;
  border-radius: var(--radius-lg);
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.page-header-section {
  padding: 2rem 2.5rem;
  margin-bottom: 2rem;
  width: 100%;
  min-width: 0;
}

.page-header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  width: 100%;
  min-width: 0;
}

.page-title-wrapper {
  flex: 1;
}

.page-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.title-icon {
  font-size: 2rem;
}

.page-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

.page-actions {
  flex-shrink: 0;
}

/* ========== 按钮样式 ========== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1.75rem;
  font-weight: 600;
  font-size: 1rem;
  border-radius: var(--radius-xl);
  text-decoration: none;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  color: white;
  box-shadow: 0 4px 15px rgba(52, 120, 246, 0.28);
}

.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(52, 120, 246, 0.4);
  transform: translateY(-2px);
}

.btn-glow {
  animation: glow 3s ease-in-out infinite;
}

@keyframes glow {
  0%, 100% {
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  }
  50% {
    box-shadow: 0 4px 25px rgba(102, 126, 234, 0.6);
  }
}

/* ========== 路径卡片网格 ========== */
.paths-section {
  margin-bottom: 2rem;
  width: 100%;
  overflow-x: hidden;
}

.paths-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  width: 100%;
  min-width: 0;
}

@media (max-width: 1200px) {
  .paths-scene-banner {
    grid-template-columns: 1fr;
  }

  .paths-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .paths-grid {
    grid-template-columns: 1fr;
  }
}

.path-card-wrapper {
  height: 100%;
  min-width: 0;
  max-width: 100%;
}

.path-card {
  padding: 1.5rem;
  min-height: 280px;
  height: 100%;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: all 0.3s ease;
}

.path-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary-light);
}

/* ========== 路径卡片头部 ========== */
.path-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.path-info-main {
  flex: 1;
  min-width: 0;
}

.path-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.4;
  min-height: 3.5rem;
}

.path-tag {
  font-weight: 500;
}

.path-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.more-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-lg);
  border: none;
  background: var(--bg-muted);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.more-btn:hover {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

/* ========== 路径卡片内容 ========== */
.path-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.path-description {
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  font-size: 0.9375rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 3em;
  word-break: break-word;
  overflow-wrap: break-word;
}

.path-replan-lineage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary-light) 16%, transparent);
  color: var(--color-primary);
  font-size: 12px;
}

.path-stats {
  display: flex;
  gap: 1.5rem;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.stat-icon-bg {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: white;
}

.icon-time {
  background: var(--gradient-warning);
}

.icon-weeks {
  background: var(--gradient-success);
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ========== 路径卡片底部 ========== */
.path-card-footer {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-light);
}

.start-btn {
  width: 100%;
  padding: 0.875rem 1.25rem;
  background: var(--gradient-primary);
  color: white;
  border: none;
  border-radius: var(--radius-xl);
  font-weight: 600;
  font-size: 0.9375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.start-btn:hover {
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  transform: translateY(-1px);
}

/* ========== 空状态 ========== */
.empty-state {
  padding: 4rem 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 0.5rem;
}

.empty-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.empty-desc {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
}

/* ========== 删除对话框 ========== */
.delete-dialog :deep(.el-dialog__header) {
  margin-right: 0;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-light);
}

.delete-alert {
  margin-bottom: 1rem;
}

.delete-confirm-text {
  margin: 1rem 0 0 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.delete-path-name {
  color: var(--color-danger);
}

.delete-item {
  color: var(--color-danger) !important;
}

/* ========== 生成中占位卡片 ========== */
.generating-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  height: 100%;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border: 2px dashed var(--border-light);
}

.generating-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 1.5rem;
  width: 100%;
}

.generating-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--gradient-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: white;
  animation: pulse 2s ease-in-out infinite;
}

.generating-icon .el-icon {
  font-size: 1.5rem;
}

.generating-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.generating-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  max-width: 280px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.generating-progress {
  width: 180px;
  margin-top: 0.25rem;
}

.progress-bar {
  height: 6px;
  background: var(--bg-muted);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: 3px;
}

.failed-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  height: 100%;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(249, 115, 22, 0.06) 100%);
}

.timeout-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  height: 100%;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(245, 158, 11, 0.06) 100%);
}

.timeout-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 0.5rem;
}

.timeout-icon {
  font-size: 2.5rem;
}

.timeout-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.timeout-desc {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 280px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.failed-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 0.5rem;
}

.failed-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.failed-desc {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 280px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.failed-retry-btn {
  margin-top: 0.25rem;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.8; }
}

/* ========== Paths Upgrade ========== */
.paths-upgrade {
  background: linear-gradient(180deg, #f7f9fd 0%, #eef3fb 100%);
}

[data-theme="dark"] .paths-upgrade {
  background: linear-gradient(180deg, #0f172a 0%, #111c31 100%);
}

.paths-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.paths-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.24;
}

.paths-bg-orb--1 {
  top: 140px;
  right: -120px;
  width: 480px;
  height: 480px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.18), transparent 70%);
  animation: float 26s ease-in-out infinite;
}

.paths-bg-orb--2 {
  left: -100px;
  bottom: 80px;
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.14), transparent 70%);
  animation: float 30s ease-in-out infinite reverse;
}

.paths-main {
  padding: 28px 0 80px;
}

.paths-shell {
  max-width: none;
}

.paths-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  padding: 24px 28px;
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 24px;
}

.paths-hero__copy {
  display: grid;
  gap: 8px;
  max-width: 720px;
}

.pill {
  display: inline-flex;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.paths-hero h1 {
  margin: 0;
  font-size: clamp(30px, 3.8vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.04em;
  color: #172033;
}

.paths-hero p,
.path-overview-card p,
.paths-empty-state p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #66758d;
}

.paths-hero__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.92);
  color: #172033;
  border: 1px solid rgba(23, 32, 51, 0.08);
}

.btn-ghost:hover {
  border-color: rgba(52, 120, 246, 0.24);
  color: #1f57cc;
  background: rgba(52, 120, 246, 0.06);
}

.paths-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 18px;
}

.paths-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.9);
  color: #66758d;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.paths-filter-chip strong {
  color: #172033;
}

.paths-filter-chip--active {
  border-color: rgba(52, 120, 246, 0.18);
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
}

.paths-grid--upgraded {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
}

.path-overview-card {
  display: grid;
  grid-template-rows: auto auto minmax(48px, auto) minmax(92px, auto) auto auto auto;
  gap: 14px;
  min-height: 480px;
  padding: 22px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}

.path-overview-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
}

.path-overview-card--primary {
  border-color: rgba(52, 120, 246, 0.14);
  box-shadow: 0 22px 54px rgba(15, 23, 42, 0.06);
}

.path-overview-card--attention {
  background: linear-gradient(180deg, rgba(255, 247, 232, 0.92), rgba(255, 255, 255, 0.96));
  border-color: rgba(245, 158, 11, 0.18);
}

.path-overview-card__status-row,
.path-overview-card__actions-row,
.path-overview-card__head,
.path-overview-card__progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.path-overview-card strong {
  font-size: 22px;
  line-height: 1.3;
  color: #172033;
}

.path-overview-card__head strong {
  flex: 1;
  min-width: 0;
  font-size: 22px;
}

.path-overview-card__summary {
  min-height: 48px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.path-overview-card__phase {
  min-height: 92px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(23, 32, 51, 0.05);
  background: rgba(243, 246, 251, 0.72);
  display: grid;
  align-content: center;
  gap: 12px;
}

.path-overview-card__phase--core {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.path-overview-card__phase-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.path-overview-card__phase-copy span {
  color: #66758d;
  font-size: 12px;
  font-weight: 800;
}

.path-overview-card__phase-copy strong {
  font-size: 15px;
  line-height: 1.45;
}

.path-activity-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.path-activity-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3478f6;
  animation: path-dot-pulse 1.2s ease-in-out infinite;
}

.path-activity-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.path-activity-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes path-dot-pulse {
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}

.path-stage-skeleton {
  display: flex;
  gap: 7px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
  padding-bottom: 2px;
}

.path-stage-skeleton__item {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.82);
  color: #7a8599;
  font-size: 11px;
  font-weight: 800;
}

.path-stage-skeleton__item--done {
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.1);
  color: #0f8a63;
}

.path-stage-skeleton__item--current {
  border-color: rgba(52, 120, 246, 0.26);
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.path-overview-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.path-overview-card__chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #49617f;
  font-size: 12px;
  font-weight: 700;
}

.path-overview-card__brief {
  display: grid;
  gap: 10px;
}

.path-overview-card__brief-item {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(247, 249, 252, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.path-overview-card__brief-item span {
  font-size: 12px;
  font-weight: 800;
  color: #66758d;
}

.path-overview-card__brief-item strong {
  font-size: 14px;
  line-height: 1.5;
  color: #172033;
}

.path-overview-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  font-size: 13px;
  color: #66758d;
}

.path-overview-card__next-task {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.path-overview-card__next-task span {
  font-size: 12px;
  font-weight: 800;
  color: #52627c;
}

.path-overview-card__next-task strong {
  font-size: 15px;
  line-height: 1.5;
  color: #0f172a;
}

.path-overview-card__progress-block {
  display: grid;
  gap: 8px;
}

.path-overview-card__progress-top strong {
  font-size: 18px;
}

.path-overview-card__progress-top span {
  font-size: 12px;
  color: #66758d;
  font-weight: 800;
}

.path-overview-card__progress-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
}

.path-overview-card__progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3478f6, #1f57cc);
}

.path-overview-card__status-line {
  height: 8px;
  padding: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
}

.path-overview-card__status-line > span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: rgba(52, 120, 246, 0.32);
}

.path-overview-card__status-line-marker--busy {
  animation: path-status-breathe 1.8s ease-in-out infinite;
}

@keyframes path-status-breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.path-overview-card--skeleton {
  pointer-events: none;
}

.path-skeleton {
  display: block;
  border-radius: 10px;
  background: linear-gradient(100deg, rgba(226, 232, 240, 0.72) 20%, rgba(248, 250, 252, 0.96) 45%, rgba(226, 232, 240, 0.72) 70%);
  background-size: 200% 100%;
  animation: path-skeleton-shimmer 1.5s ease-in-out infinite;
}

.path-skeleton--pill { width: 96px; height: 30px; border-radius: 999px; }
.path-skeleton--title { width: 72%; height: 28px; }
.path-skeleton--copy { width: 100%; height: 14px; }
.path-skeleton--copy-short { width: 78%; }
.path-skeleton--stage { width: 28px; height: 28px; }
.path-skeleton--button { width: 100%; height: 46px; margin-top: auto; }

.path-skeleton-stage-row {
  display: flex;
  gap: 8px;
  min-height: 92px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.72);
}

@keyframes path-skeleton-shimmer {
  from { background-position: 180% 0; }
  to { background-position: -20% 0; }
}

.path-state-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.path-state-pill--primary {
  background: rgba(52, 120, 246, 0.12);
  border-color: rgba(52, 120, 246, 0.2);
  color: #1f57cc;
}

.path-state-pill--active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.16);
  color: #0f8a63;
}

.path-state-pill--generating {
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.16);
  color: #1f57cc;
}

.path-state-pill--failed {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.path-state-pill--soft {
  background: rgba(255, 255, 255, 0.92);
  color: #66758d;
}

.paths-empty-state {
  display: grid;
  gap: 14px;
  justify-items: start;
  padding: 32px;
  border-radius: 24px;
}

.paths-empty-state h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
  letter-spacing: -0.04em;
  color: #172033;
}

[data-theme="dark"] .paths-hero,
[data-theme="dark"] .path-overview-card,
[data-theme="dark"] .paths-empty-state,
[data-theme="dark"] .paths-filter-chip,
[data-theme="dark"] .btn-ghost {
  background: rgba(30, 41, 59, 0.88);
  border-color: rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .path-overview-card__chip {
  background: rgba(96, 165, 250, 0.16);
  color: #d6e6ff;
}

[data-theme="dark"] .path-overview-card__brief-item,
[data-theme="dark"] .path-overview-card__next-task,
[data-theme="dark"] .path-overview-card__phase,
[data-theme="dark"] .path-skeleton-stage-row {
  background: rgba(15, 23, 42, 0.46);
  border-color: rgba(255, 255, 255, 0.06);
}

[data-theme="dark"] .paths-hero h1,
[data-theme="dark"] .path-overview-card strong,
[data-theme="dark"] .path-overview-card__next-task strong,
[data-theme="dark"] .paths-empty-state h2,
[data-theme="dark"] .paths-filter-chip strong,
[data-theme="dark"] .btn-ghost {
  color: #e2e8f0;
}

[data-theme="dark"] .paths-hero p,
[data-theme="dark"] .path-overview-card p,
[data-theme="dark"] .path-overview-card__next-task span,
[data-theme="dark"] .paths-empty-state p,
[data-theme="dark"] .paths-filter-chip,
[data-theme="dark"] .path-overview-card__stats,
[data-theme="dark"] .path-overview-card__progress-top span {
  color: #94a3b8;
}

[data-theme="dark"] .path-overview-card__next-task {
  background: rgba(15, 23, 42, 0.32);
  border-color: rgba(255, 255, 255, 0.06);
}

[data-theme="dark"] .paths-filter-chip--active {
  background: rgba(52, 120, 246, 0.14);
  color: rgba(96, 165, 250, 0.95);
  border-color: rgba(96, 165, 250, 0.2);
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .header-container {
    padding: 1rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .header-nav {
    display: none;
  }

  .main-content {
    padding: 1rem;
  }

  .paths-main {
    padding: 1rem 1rem 1.25rem;
  }

  .paths-hero {
    flex-direction: column;
    align-items: flex-start;
    padding: 18px;
  }

  .paths-scene-banner {
    padding: 18px;
  }

  .paths-scene-banner__steps {
    grid-template-columns: 1fr;
  }

  .paths-hero h1,
  .paths-empty-state h2 {
    font-size: 24px;
  }

  .paths-hero__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .paths-filter-row {
    gap: 10px;
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
    margin-inline: -1rem;
    padding: 0 1rem 6px;
  }

  .paths-filter-row::-webkit-scrollbar {
    display: none;
  }

  .paths-filter-chip {
    flex: 0 0 auto;
  }

  .paths-scene-banner__actions,
  .paths-scene-banner__actions--single {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .paths-grid--upgraded {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .path-overview-card {
    padding: 18px;
    min-height: auto;
  }

  .page-header-section {
    padding: 1.5rem;
  }

  .page-header-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-title {
    font-size: 1.5rem;
  }

  .paths-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .header-container {
    padding: 0.9rem 1rem;
    gap: 0.75rem;
  }

  .header-left,
  .header-right,
  .header-nav {
    min-width: 0;
  }

  .paths-main {
    padding-inline: 0.75rem;
    padding-bottom: calc(1rem + var(--safe-area-bottom));
  }

  .paths-hero {
    gap: 14px;
    padding: 16px;
  }

  .header-right {
    justify-content: flex-end;
  }

  .header-cta,
  .user-chip {
    display: none;
  }

  .user-chip {
    min-width: auto;
    padding-inline: 10px;
  }

  .paths-hero,
  .paths-scene-banner,
  .path-overview-card,
  .paths-empty-state {
    border-radius: 20px;
  }

  .paths-hero__actions,
  .path-overview-card__actions-row {
    width: 100%;
  }

  .paths-hero__actions > *,
  .path-overview-card__actions-row > * {
    flex: 1 1 100%;
  }

  .path-overview-card__status-row,
  .path-overview-card__head,
  .path-overview-card__progress-top {
    align-items: flex-start;
    flex-direction: column;
  }

  .paths-hero__actions,
  .paths-scene-banner__actions,
  .paths-scene-banner__actions--single,
  .path-overview-card__actions-row {
    flex-direction: column;
    align-items: stretch;
  }

  .paths-filter-row {
    margin-inline: -0.75rem;
    padding: 0 0.75rem 6px;
  }

  .paths-filter-chip {
    width: auto;
    flex: 0 0 auto;
    justify-content: center;
    min-height: 42px;
    padding: 10px 14px;
  }

  .path-overview-card__brief {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .paths-bg-orb,
  .path-activity-dots i,
  .path-overview-card__status-line-marker--busy,
  .path-skeleton {
    animation: none !important;
  }

  .path-overview-card,
  .btn,
  .paths-filter-chip {
    transition: none !important;
  }

  .path-overview-card:hover,
  .btn-primary:hover {
    transform: none;
  }
}

@media (max-width: 480px) {
  .paths-main {
    padding: 0.75rem 0.5rem calc(0.9rem + var(--safe-area-bottom));
  }

  .paths-hero,
  .paths-scene-banner,
  .path-overview-card,
  .paths-empty-state {
    padding: 14px;
    border-radius: 18px;
  }

  .paths-hero h1,
  .paths-empty-state h2 {
    font-size: 22px;
    line-height: 1.12;
  }

  .paths-hero p,
  .path-overview-card p,
  .paths-empty-state p {
    font-size: 13px;
    line-height: 1.6;
  }

  .path-overview-card {
    gap: 12px;
  }

  .path-overview-card strong,
  .path-overview-card__head strong {
    font-size: 19px;
    line-height: 1.25;
  }

  .path-overview-card__next-task,
  .path-overview-card__brief-item {
    padding: 11px 12px;
    border-radius: 14px;
  }

  .path-overview-card__actions-row .btn {
    min-height: 44px;
  }
}

</style>
