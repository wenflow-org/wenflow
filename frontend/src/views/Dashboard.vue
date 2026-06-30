<template>
  <div class="dashboard-page">
    <div class="dashboard-bg-layer">
      <div class="dashboard-bg-orb dashboard-bg-orb--1"></div>
      <div class="dashboard-bg-orb dashboard-bg-orb--2"></div>
      <div class="dashboard-bg-grid"></div>
    </div>

    <header class="dashboard-header" :class="{ 'dashboard-header--scrolled': scrolled }">
      <div class="header-container">
        <button type="button" class="brand" @click="router.push(dashboardPath)">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="应用导航">
          <router-link :to="dashboardPath" class="nav-item nav-item--active">{{ isTestMode ? '测试学习台' : '学习台' }}</router-link>
          <router-link :to="goalConversationPath" class="nav-item">{{ isTestMode ? '测试目标规划' : '目标规划' }}</router-link>
          <router-link :to="learningPathsPath" class="nav-item">{{ isTestMode ? '测试学习路径' : '学习路径' }}</router-link>
          <router-link :to="learningStatePath" class="nav-item">{{ isTestMode ? '测试学习状态' : '学习状态' }}</router-link>
          <router-link :to="achievementsPath" class="nav-item">{{ isTestMode ? '测试成就' : '成就' }}</router-link>
        </nav>

        <div class="header-right">
          <router-link :to="goalConversationPath" class="header-cta">{{ isTestMode ? '创建新测试目标' : '创建新目标' }}</router-link>
          <ThemeSwitcher />
          <MobileSiteMenu
            :user-name="userStore.user?.name || '同学'"
            :user-initial="userInitial"
            :nav-items="headerNavItems"
            :primary-action="{ label: isTestMode ? '创建新测试目标' : '创建新目标', to: goalConversationPath }"
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
                  能力中心
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

    <main class="dashboard-main">
      <section class="dashboard-hero surface-card">
        <div class="dashboard-hero__copy">
          <div class="dashboard-hero__eyebrow">
            <span class="pill">学习台</span>
            <span
              v-if="isAdminTestDashboard"
              class="dashboard-source-badge"
              :class="`dashboard-source-badge--${dashboardDataModeTone}`"
            >
              {{ dashboardDataModeLabel }}
            </span>
          </div>
          <div v-if="isAdminTestDashboard" class="dashboard-source-note">
            {{ dashboardDataModeMeta }}
          </div>
          <h1>{{ dashboardTitle }}</h1>
          <p>{{ dashboardSubtitle }}</p>

          <div class="dashboard-list-section">
            <div class="dashboard-list-section__head">
              <span class="section-kicker">今天建议</span>
              <strong>先完成一件最重要的小事</strong>
            </div>

            <div class="dashboard-list">
              <router-link v-for="item in todayActionItems" :key="item.id" :to="item.to" class="dashboard-list__item" :class="`dashboard-list__item--${item.tone}`">
                <span class="dashboard-list__dot" :class="`dashboard-list__dot--${item.dot}`"></span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </div>
                <span class="dashboard-list__action">{{ item.action }}</span>
              </router-link>
            </div>
          </div>
        </div>

        <aside class="focus-card">
          <div class="focus-card__head">
            <span class="section-kicker">当前路径</span>
            <span class="focus-card__badge">{{ hasLearningPath ? '进行中' : '待开始' }}</span>
          </div>

          <div class="focus-card__summary">
            <h2>{{ primaryPathTitle }}</h2>
            <p>{{ primaryPathDesc }}</p>
          </div>


          <div class="focus-card__stats">
            <article>
              <span>路径数量</span>
              <strong>{{ pathCount }}</strong>
              <p>{{ hasLearningPath ? '当前学习路径数量' : '还没有创建学习路径' }}</p>
            </article>
            <article>
              <span>{{ hasLearningPath ? '当前进度' : '准备状态' }}</span>
              <strong>{{ hasLearningPath ? `${completedTaskCount}/${totalTaskCount}` : '未开始' }}</strong>
              <p>{{ currentPathHint }}</p>
            </article>
            <article>
              <span>{{ hasLearningPath ? (primaryActionTask ? '当前任务' : '下一步') : '下一步' }}</span>
              <strong>{{ nextStepLabel }}</strong>
              <p v-if="nextStepHint">{{ nextStepHint }}</p>
            </article>
          </div>

          <router-link :to="hasLearningPath ? continueLearningTarget : goalConversationPath" class="btn btn--primary btn--full">
            {{ hasLearningPath ? '继续上次学习' : '创建第一个目标' }}
          </router-link>
        </aside>
      </section>

      <section class="dashboard-calendar-section">
        <div class="dashboard-calendar-layout">
          <article class="surface-card dashboard-calendar-panel">
            <LoadCalendar @day-select="handleCalendarDaySelect" />
          </article>

          <aside class="surface-card dashboard-calendar-status">
            <div v-if="!selectedCalendarDay" class="dashboard-calendar-status__empty">
              <div class="dashboard-calendar-status__empty-icon">📅</div>
              <p>点击日历中的某一天，查看当天状态</p>
            </div>

            <div v-else class="dashboard-calendar-status__content">
              <div class="dashboard-calendar-status__head">
                <span class="section-kicker">所选日期状态</span>
                <strong>{{ calendarDayFormatDate(selectedCalendarDay.date) }}</strong>
              </div>

              <div class="dashboard-calendar-status__cards">
                <article class="dashboard-calendar-status__card">
                  <span>学习总时长</span>
                  <strong>{{ calendarDayFormatDuration(selectedCalendarDay.durationMinutes) }}</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>学习会话</span>
                  <strong>{{ selectedCalendarDay.sessionCount }}次</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>主要内容</span>
                  <strong class="dashboard-calendar-status__text">{{ selectedCalendarDay.primaryTaskTitle || '暂无任务' }}</strong>
                </article>
                <article class="dashboard-calendar-status__card">
                  <span>学习强度</span>
                  <strong class="dashboard-calendar-status__zone" :class="calendarDayZone(selectedCalendarDay.durationMinutes).cls">
                    {{ calendarDayZone(selectedCalendarDay.durationMinutes).label }}
                  </strong>
                </article>
              </div>

              <div class="dashboard-calendar-status__analysis">
                <strong>当天观察</strong>
                <p>{{ calendarDayAnalysis }}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section v-if="isTestMode" class="dashboard-debug-overview surface-card">
        <div class="section-head dashboard-debug-overview__head">
          <div>
            <span class="section-kicker">调试总览</span>
            <strong>{{ debugOverviewTitle }}</strong>
          </div>
          <div class="dashboard-debug-overview__actions">
            <button class="btn btn--ghost" :disabled="loading || stateWorkbenchLoading" @click="refreshDashboardDebug">刷新总览</button>
            <router-link :to="learningPathsPath" class="btn btn--ghost">查看测试路径</router-link>
          </div>
        </div>

        <p class="dashboard-debug-overview__lead">{{ debugOverviewLead }}</p>

        <div v-if="debugWorkbenchCards.length" class="dashboard-debug-overview__grid">
          <article v-for="item in debugWorkbenchCards" :key="item.label" class="dashboard-debug-overview__card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.meta }}</p>
          </article>
        </div>

        <div class="dashboard-debug-overview__step-row">
          <article
            v-for="step in debugWorkbenchSteps"
            :key="step.label"
            class="dashboard-debug-step"
            :class="[`dashboard-debug-step--${step.tone}`]"
          >
            <span>{{ step.label }}</span>
            <strong>{{ step.value }}</strong>
            <p>{{ step.desc }}</p>
          </article>
        </div>

        <div class="dashboard-debug-overview__links">
          <router-link :to="debugGoalTarget" class="dashboard-debug-link">测试目标规划</router-link>
          <router-link :to="debugPathTarget" class="dashboard-debug-link">测试学习路径详情</router-link>
          <router-link :to="learningStatePath" class="dashboard-debug-link">测试学习状态</router-link>
          <router-link :to="debugPromptLogsTarget" class="dashboard-debug-link">Path Prompt 调用日志</router-link>
          <router-link :to="debugExecutionLogsTarget" class="dashboard-debug-link">Path 执行日志</router-link>
        </div>
      </section>

      <AppMiniFooter />
    </main>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import { Switch, User } from '@element-plus/icons-vue';
import LoadCalendar from '../components/LoadCalendar.vue';
import MobileSiteMenu from '../components/MobileSiteMenu.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import AppMiniFooter from '../components/AppMiniFooter.vue';
import { learningAPI, type AdaptiveGuidancePayload, type LearningPath, type LearningStats, type Stage, type Task, type Week } from '../api/learning';
import { metricsAPI, type CurrentState } from '../api/metrics';
import { userAPI, type LearnerCenterSnapshot } from '../api/user';
import { useUserStore } from '../stores/user';
import { isProjectionMode } from '../utils/projection';
import { getReplanPriorityText, getReplanRecommendationText, getReplanScopeText } from '../utils/replanSignal';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const isAdminTestDashboard = computed(() => route.name === 'AdminTestDashboard');
const dashboardPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/dashboard' : '/dashboard';
  }
  return '/dashboard';
});
const goalConversationPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/goal-full' : '/test/goal-full';
  }
  return '/goal-conversation';
});
const learningPathsPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-paths' : '/test/learning-paths';
  }
  return '/learning-paths';
});
const learningPathDetailBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-path' : '/test/learning-path';
  }
  return '/learning-path';
});
const learningPageBasePath = computed(() => {
  if (isTestMode.value && isAdminRoute.value) {
    return '/admin/test/learn';
  }
  return '/learn';
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
const stats = ref<LearningStats | null>(null);
type DashboardPath = LearningPath & { status?: string };

const paths = ref<DashboardPath[]>([]);
const loading = ref(false);
const scrolled = ref(false);
const selectedCalendarDay = ref<any>(null);
const adaptiveGuidance = ref<AdaptiveGuidancePayload | null>(null);
const adaptiveSummary = computed(() => adaptiveGuidance.value?.summary || null);
const adaptiveCopy = computed(() => adaptiveGuidance.value?.copy || null);
const adaptiveGuidanceDebug = computed(() => adaptiveGuidance.value?.debug || null);
const learnerCenter = ref<LearnerCenterSnapshot | null>(null);
const currentState = ref<CurrentState | null>(null);
const stateWorkbenchLoading = ref(false);
const dashboardDebugDrawerVisible = ref(false);

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const headerNavItems = computed(() => [
  { label: isTestMode.value ? '测试学习台' : '学习台', to: dashboardPath.value, matchPrefixes: ['/dashboard'] },
  { label: isTestMode.value ? '测试目标规划' : '目标规划', to: goalConversationPath.value, matchPrefixes: ['/goal-conversation', '/test/goal-full'] },
  { label: isTestMode.value ? '测试学习路径' : '学习路径', to: learningPathsPath.value, matchPrefixes: ['/learning-paths', '/learning-path/', '/test/learning-paths', '/test/learning-path/'] },
  { label: isTestMode.value ? '测试学习状态' : '学习状态', to: learningStatePath.value, matchPrefixes: ['/learning-state'] },
  { label: isTestMode.value ? '测试成就' : '成就', to: achievementsPath.value, matchPrefixes: ['/achievements'] }
]);
const pathCount = computed(() => stats.value?.paths?.total || 0);
const hasLearningPath = computed(() => pathCount.value > 0);
const completedTaskCount = computed(() => stats.value?.tasks.completed || stats.value?.subtasks?.completed || 0);
const inProgressTaskCount = computed(() => stats.value?.tasks.inProgress || stats.value?.subtasks?.inProgress || 0);
const totalTaskCount = computed(() => completedTaskCount.value + inProgressTaskCount.value || 1);

const getPathTitle = (path: DashboardPath | null | undefined) => path?.name || path?.title || '未命名路径';

const getEnrichmentStatus = (path: DashboardPath | null | undefined) => path?.generationStatus?.stageDesign || null;

const getPathDisplayState = (path: DashboardPath | null | undefined) => {
  if (!path) return 'attention';
  if (path.status === 'failed') return 'attention';
  if (path.status === 'generating') return 'generating';
  if (getEnrichmentStatus(path) === 'failed') return 'attention';
  if (getEnrichmentStatus(path) === 'processing' || getEnrichmentStatus(path) === 'pending') return 'generating';
  return 'active';
};

const getPathStages = (path: DashboardPath | null | undefined) => path?.milestones || path?.weeks || [];

const normalizeTaskList = (stage: Stage | Week | null | undefined): Task[] => {
  if (!stage) return [];
  return 'subtasks' in stage ? stage.subtasks || [] : stage.tasks || [];
};

const getActiveStage = (path: DashboardPath | null | undefined) => {
  const stages = getPathStages(path);
  if (!stages.length) return null;

  return stages.find((stage) => normalizeTaskList(stage).some((task) => task.status !== 'completed')) || stages[0] || null;
};

const getPrimaryActionTask = (path: DashboardPath | null | undefined) => {
  const tasks = normalizeTaskList(getActiveStage(path));
  return tasks.find((task) => task.status === 'todo')
    || tasks.find((task) => task.status === 'in_progress')
    || null;
};

const primaryPath = computed(() => {
  const activePaths = paths.value.filter((path) => getPathDisplayState(path) === 'active');
  return activePaths.find((path) => Boolean(getPrimaryActionTask(path))) || activePaths[0] || null;
});

const latestPath = computed(() => {
  if (!paths.value.length) return null;
  return [...paths.value].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
});

const debugFocusPath = computed(() => primaryPath.value || latestPath.value || null);

const primaryActionTask = computed(() => getPrimaryActionTask(primaryPath.value));

const debugActionTask = computed(() => getPrimaryActionTask(debugFocusPath.value));

const continueLearningTarget = computed(() => {
  const nextTask = getPrimaryActionTask(primaryPath.value);
  if (nextTask?.id) {
    return `${learningPageBasePath.value}/${nextTask.id}`;
  }

  if (primaryPath.value?.id) {
    return `${learningPathDetailBasePath.value}/${primaryPath.value.id}`;
  }

  return learningPathsPath.value;
});

const debugGoalConversationId = computed(() => {
  const sourceId = debugFocusPath.value?.generationStatus?.sourceConversationId;
  return typeof sourceId === 'string' && sourceId.trim() ? sourceId.trim() : '';
});

const debugGoalTarget = computed(() => {
  return debugGoalConversationId.value ? `${goalConversationPath.value}/${debugGoalConversationId.value}` : goalConversationPath.value;
});

const debugPathTarget = computed(() => {
  return debugFocusPath.value?.id ? `${learningPathDetailBasePath.value}/${debugFocusPath.value.id}` : learningPathsPath.value;
});

const debugPromptLogsTarget = computed(() => {
  const pathId = debugFocusPath.value?.id;
  if (!pathId) return '/admin/prompt-call-logs';
  return {
    path: '/admin/prompt-call-logs',
    query: {
      pathId,
      limit: '100'
    }
  };
});

const debugExecutionLogsTarget = computed(() => {
  const pathId = debugFocusPath.value?.id;
  if (!pathId) return '/admin/execution-logs';
  return {
    path: '/admin/execution-logs',
    query: {
      pathId,
      sourceEntry: 'platform',
      timeRange: 'all'
    }
  };
});

const dashboardTitle = computed(() => {
  if (adaptiveCopy.value?.headline) return adaptiveCopy.value.headline;
  if (!hasLearningPath.value) return `你好，${userStore.user?.name || '同学'}，先从一个具体目标开始。`;
  return `欢迎回来，${userStore.user?.name || '同学'}。`;
});

const dashboardSubtitle = computed(() => {
  if (adaptiveCopy.value?.subtitle) return adaptiveCopy.value.subtitle;
  if (!hasLearningPath.value) return '描述一件你最近想解决的事，把它缩小到可以开始的一步。';
  return '从上次停下的位置继续，把学习接上。';
});

const debugPathStageLabel = computed(() => {
  const path = debugFocusPath.value;
  if (!path) return '还没有测试路径';

  const state = getPathDisplayState(path);
  const coreStep = path.generationStatus?.coreStep;
  const stageDesign = path.generationStatus?.stageDesign;
  const stageCount = getPathStages(path).length;

  if (state === 'attention') return '需要处理';
  if (path.canStartLearning && stageCount > 0) return '可开始 Learn';
  if (coreStep === 'framing') return '主路径生成中';
  if (coreStep === 'planning') return '主路径拆解中';
  if (coreStep === 'persist') return '主路径落成中';
  if (coreStep === 'completed' && (stageDesign === 'processing' || stageDesign === 'pending')) return '阶段任务补充中';
  if (state === 'generating') return '生成中';
  return '已就绪';
});

const debugPathStageDescription = computed(() => {
  const path = debugFocusPath.value;
  if (!path) return '先去创建一个测试目标，首页才会出现最近链路的可观察状态。';
  if (path.canStartLearning && getPathStages(path).length > 0) return '里程碑和 task 已准备完成，可以直接进入 Learn。';
  if (path.generationStatus?.coreStep === 'framing') return '正在从 Goal 结果收敛真实问题、约束与首个交付物。';
  if (path.generationStatus?.coreStep === 'planning') return '正在把 Goal 结果拆成学习路径主结构。';
  if (path.generationStatus?.coreStep === 'persist') return '正在写入路径主结构，准备切换到阶段任务生成。';
  if (path.generationStatus?.coreStep === 'completed' && (path.generationStatus?.stageDesign === 'processing' || path.generationStatus?.stageDesign === 'pending')) {
    return path.learningBlockedReason || '主路径已完成，系统正在补充每个阶段的具体 task。';
  }
  return path.learningBlockedReason || '当前没有额外调试说明。';
});

const debugOverviewTitle = computed(() => {
  return debugFocusPath.value ? '最近一条测试链路' : '还没有测试链路';
});

const debugOverviewLead = computed(() => {
  const path = debugFocusPath.value;
  if (!path) {
    return '这里会汇总最近一条测试 Goal -> Path -> Learn 的关键状态，方便先判断问题卡在哪一层。';
  }

  return debugPathStageDescription.value;
});

const debugWorkbenchCards = computed(() => {
  const path = debugFocusPath.value;
  return [
    {
      label: '最近路径',
      value: path ? getPathTitle(path) : '暂无',
      meta: path?.id || '先创建一个测试目标'
    },
    {
      label: 'Goal 来源',
      value: debugGoalConversationId.value ? `会话 ${debugGoalConversationId.value.slice(0, 16)}...` : '暂无',
      meta: debugGoalConversationId.value ? '可直接跳回测试目标规划' : '当前路径没有回溯到测试 Goal 会话'
    },
    {
      label: 'Path 状态',
      value: debugPathStageLabel.value,
      meta: debugPathStageDescription.value
    },
    {
      label: 'Learn 入口',
      value: debugActionTask.value?.title || '暂无可继续任务',
      meta: debugActionTask.value ? '路径已给出当前最值得先推进的 task。' : '若仍在生成中，请先观察 Path 阶段。'
    }
  ];
});

const debugWorkbenchSteps = computed(() => {
  const path = debugFocusPath.value;
  const state = getPathDisplayState(path);
  const goalTone = path ? 'done' : 'idle';
  const pathTone = !path ? 'idle' : state === 'attention' ? 'attention' : state === 'generating' ? 'active' : 'done';
  const learnTone = path?.canStartLearning && getPathStages(path).length > 0 ? 'done' : path ? 'idle' : 'idle';

  return [
    {
      label: 'Goal',
      value: debugGoalConversationId.value ? '已收口' : '待创建',
      desc: debugGoalConversationId.value ? '已拿到可追踪的测试 Goal 会话。' : '先从测试目标规划页开始。',
      tone: goalTone
    },
    {
      label: 'Path',
      value: debugPathStageLabel.value,
      desc: debugPathStageDescription.value,
      tone: pathTone
    },
    {
      label: 'Learn',
      value: path?.canStartLearning && getPathStages(path).length > 0 ? '可进入' : '未就绪',
      desc: path?.canStartLearning && getPathStages(path).length > 0 ? '可以直接点击继续，进入当前 task。' : '等 Path 真正 ready 后再开始 Learn。',
      tone: learnTone
    }
  ];
});

const primaryPathTitle = computed(() => (hasLearningPath.value ? '当前学习路径' : '还没有学习路径'));
const primaryPathDesc = computed(() => (
  adaptiveCopy.value?.pathHint
    ? adaptiveCopy.value.pathHint
    : (
  hasLearningPath.value
    ? '从上次停下的位置继续。'
    : '从一个具体目标开始，系统会根据你的情况生成第一版学习路径。'
    )
));

const currentPathHint = computed(() => {
  if (adaptiveCopy.value?.warningCopy && adaptiveCopy.value.warningCopy !== '当前没有明显风险。') {
    return adaptiveCopy.value.warningCopy;
  }
  if (inProgressTaskCount.value > 0) return `${inProgressTaskCount.value} 个任务进行中`;
  if (completedTaskCount.value > 0) return '已完成部分任务';
  return hasLearningPath.value ? '路径已生成' : '先创建一个目标';
});

const nextStepLabel = computed(() => {
  if (!hasLearningPath.value) return '创建第一个目标';
  return primaryActionTask.value?.title || '查看学习路径';
});

const nextStepHint = computed(() => {
  if (adaptiveCopy.value?.nextStep) return adaptiveCopy.value.nextStep;
  if (!hasLearningPath.value) return '从一个真实问题开始';
  return primaryActionTask.value ? '' : '进入学习路径查看安排';
});

const learnerCenterDisplayMetrics = computed(() => {
  const metrics = learnerCenter.value?.dynamicState?.metrics;
  if (!metrics) return null;
  return {
    lss: Number((Number(metrics.lss || 0) * 10).toFixed(2)),
    ktl: Number((Number(metrics.ktl || 0) * 10).toFixed(2)),
    lf: Number((Number(metrics.lf || 0) * 10).toFixed(2)),
    lsb: Number((Number(metrics.lsb || 0) * 10).toFixed(2)),
  };
});

const stateWorkbenchMetricCards = computed(() => {
  const metrics = learnerCenterDisplayMetrics.value || currentState.value;
  if (!metrics) return [];
  return [
    { label: 'LSS 学习压力', value: Number(metrics.lss || 0).toFixed(2), note: '当前即时压力' },
    { label: 'KTL 知识掌握', value: Number(metrics.ktl || 0).toFixed(2), note: '长期掌握负荷' },
    { label: 'LF 学习疲劳', value: Number(metrics.lf || 0).toFixed(2), note: '当前疲劳程度' },
    { label: 'LSB 状态平衡', value: Number(metrics.lsb || 0).toFixed(2), note: '掌握与疲劳平衡值' },
  ];
});

const stateWorkbenchControlItems = computed(() => {
  const control = learnerCenter.value?.learningControlState;
  if (!control) return [];
  return [
    { label: 'paceMode', value: control.paceMode },
    { label: 'conceptLoad', value: control.conceptLoad },
    { label: 'reviewPriority', value: control.reviewPriority },
    { label: 'challengeLevelCap', value: control.challengeLevelCap },
    { label: 'checkpointNeed', value: control.checkpointNeed },
    { label: 'avoidNewConcepts', value: control.shouldAvoidNewConcepts ? 'true' : 'false' },
    { label: 'preferConsolidation', value: control.shouldPreferConsolidation ? 'true' : 'false' },
    { label: 'offerBreak', value: control.shouldOfferBreak ? 'true' : 'false' },
  ];
});

const stateWorkbenchSignalItems = computed(() => {
  const signal = learnerCenter.value?.replanSignal;
  if (!signal) return [];
  return [
    { label: 'shouldSuggest', value: signal.shouldSuggest ? 'true' : 'false' },
    { label: 'priority', value: getReplanPriorityText(signal.priority) },
    { label: 'recommendation', value: getReplanRecommendationText(signal.recommendation) },
    { label: 'scope', value: getReplanScopeText(signal.scope) },
    { label: 'reasonCodes', value: Array.isArray(signal.reasonCodes) && signal.reasonCodes.length ? signal.reasonCodes.join('、') : '无' },
    { label: 'rationale', value: signal.rationale || '无' },
  ];
});

const stateWorkbenchQuickChips = computed(() => {
  const metrics = learnerCenterDisplayMetrics.value || currentState.value;
  const control = learnerCenter.value?.learningControlState;
  const signal = learnerCenter.value?.replanSignal;
  return [
    metrics ? { label: 'LSB', value: Number(metrics.lsb || 0).toFixed(2) } : null,
    control ? { label: '节奏', value: control.paceMode } : null,
    signal ? { label: '重调建议', value: signal.recommendation || 'keep' } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
});

const formatDashboardDebugDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const dashboardDataModeTone = computed(() => (adaptiveGuidance.value ? 'hot' : 'cold'));

const dashboardDataModeLabel = computed(() => {
  if (!adaptiveGuidance.value) return '冷数据 fallback';
  return adaptiveGuidanceDebug.value?.cached ? '热数据快照 · fallback 生成' : '热数据快照 · model 生成';
});

const dashboardDataModeMeta = computed(() => {
  if (!adaptiveGuidance.value) {
    return '当前 /api/adaptive-guidance/copy 返回 null，页面正在使用默认冷数据。';
  }

  const generatedAt = formatDashboardDebugDateTime(adaptiveGuidanceDebug.value?.generatedAt);
  if (generatedAt) {
    return `当前页面命中后台首页快照，生成时间：${generatedAt}`;
  }

  return '当前页面命中后台首页快照。';
});

const dashboardDebugQuickChips = computed(() => {
  return [
    { label: 'Skill', value: adaptiveGuidanceDebug.value?.skillId || 'adaptive-guidance-copy' },
    adaptiveGuidanceDebug.value?.systemPromptVersion !== null && adaptiveGuidanceDebug.value?.systemPromptVersion !== undefined
      ? { label: 'Prompt', value: `v${adaptiveGuidanceDebug.value.systemPromptVersion}` }
      : null,
    adaptiveGuidanceDebug.value?.model
      ? { label: 'Model', value: adaptiveGuidanceDebug.value.model }
      : null,
    ...stateWorkbenchQuickChips.value,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
});

const dashboardDebugQuickChipText = computed(() => {
  const parts = dashboardDebugQuickChips.value.slice(0, 3).map((item) => `${item.label} ${item.value}`);
  return parts.length > 0 ? parts.join(' · ') : '查看 skill 输出与原始数据';
});

const dashboardDebugSkillMetaItems = computed(() => [
  { label: 'skillId', value: adaptiveGuidanceDebug.value?.skillId || 'adaptive-guidance-copy' },
  {
    label: 'systemPromptVersion',
    value: adaptiveGuidanceDebug.value?.systemPromptVersion !== null && adaptiveGuidanceDebug.value?.systemPromptVersion !== undefined
      ? `v${adaptiveGuidanceDebug.value.systemPromptVersion}`
      : '当前未返回'
  },
  { label: 'model', value: adaptiveGuidanceDebug.value?.model || '当前未返回' },
  {
    label: 'duration',
    value: adaptiveGuidanceDebug.value?.durationMs !== undefined ? `${adaptiveGuidanceDebug.value.durationMs} ms` : '当前未返回'
  },
  {
    label: 'source',
    value: adaptiveGuidanceDebug.value ? (adaptiveGuidanceDebug.value.cached ? 'snapshot-fallback' : 'snapshot-model') : '当前没有后台快照'
  },
  {
    label: 'generatedAt',
    value: adaptiveGuidanceDebug.value?.generatedAt || '当前没有后台快照'
  },
]);

const dashboardDebugOutputItems = computed(() => {
  return [
    adaptiveCopy.value?.nextStep ? { label: 'nextStep', value: adaptiveCopy.value.nextStep } : null,
    adaptiveCopy.value?.pathHint ? { label: 'pathHint', value: adaptiveCopy.value.pathHint } : null,
    adaptiveCopy.value?.paceHint ? { label: 'paceHint', value: adaptiveCopy.value.paceHint } : null,
    adaptiveCopy.value?.warningCopy ? { label: 'warningCopy', value: adaptiveCopy.value.warningCopy } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
});

const formatDebugJson = (value: any, emptyText: string = '当前没有可用数据。') => {
  if (value === null || value === undefined || value === '') return emptyText;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const dashboardDebugAdaptiveCopyJson = computed(() => formatDebugJson(adaptiveCopy.value));
const dashboardDebugSummaryJson = computed(() => formatDebugJson(adaptiveSummary.value));
const dashboardDebugUserPayload = computed(() => formatDebugJson(
  adaptiveGuidanceDebug.value?.userPayload,
  adaptiveGuidance.value ? '首页快照模式未保存 userPayload。' : '当前没有后台首页快照。'
));
const dashboardDebugRawModelOutput = computed(() => formatDebugJson(
  adaptiveGuidanceDebug.value?.rawModelOutput,
  adaptiveGuidance.value ? '首页快照模式未保存 rawModelOutput。' : '当前没有后台首页快照。'
));
const dashboardDebugNormalizedOutputJson = computed(() => formatDebugJson(
  adaptiveGuidanceDebug.value?.normalizedOutput,
  adaptiveGuidance.value ? '首页快照模式未保存 normalizedOutput。' : '当前没有后台首页快照。'
));
const dashboardDebugLearnerCenterJson = computed(() => formatDebugJson(learnerCenter.value, '当前还没有 learner-center 快照。'));
const dashboardDebugCurrentStateJson = computed(() => formatDebugJson(currentState.value, '当前还没有 metrics state 快照。'));

const dashboardDebugSkillJsonCards = computed(() => [
  { key: 'copy', title: 'Adaptive Copy JSON', badge: 'dashboard output', content: dashboardDebugAdaptiveCopyJson.value },
  { key: 'summary', title: 'Learner Summary JSON', badge: 'rule summary', content: dashboardDebugSummaryJson.value },
]);

const dashboardDebugRawJsonCards = computed(() => [
  { key: 'payload', title: 'User Payload', badge: 'skill input', content: dashboardDebugUserPayload.value },
  { key: 'raw', title: 'rawModelOutput', badge: 'llm raw', content: dashboardDebugRawModelOutput.value },
  { key: 'normalized', title: 'normalizedOutput', badge: 'skill output', content: dashboardDebugNormalizedOutputJson.value },
  { key: 'learner-center', title: 'Learner Center JSON', badge: 'current snapshot', content: dashboardDebugLearnerCenterJson.value },
  { key: 'state', title: 'Current State JSON', badge: 'metrics snapshot', content: dashboardDebugCurrentStateJson.value },
]);

const dashboardDebugRawHint = computed(() => {
  if (!adaptiveGuidance.value) {
    return '当前没有后台首页快照，页面正在使用冷数据 fallback。完成一次学习行为后，后台会自动回填。';
  }
  if (adaptiveGuidanceDebug.value?.userPayload || adaptiveGuidanceDebug.value?.rawModelOutput || adaptiveGuidanceDebug.value?.normalizedOutput) {
    return '';
  }
  return '当前首页使用的是后台快照。快照只保留摘要调试元信息，不保留 userPayload 和 rawModelOutput。';
});

const todayActionItems = computed(() => {
  const resolveAdaptiveTarget = (value?: string) => {
    switch (value) {
      case 'continue-learning':
        return continueLearningTarget.value;
      case 'learning-state':
        return learningStatePath.value;
      case 'achievements':
        return achievementsPath.value;
      case 'create-goal':
        return goalConversationPath.value;
      case 'path-detail':
        return primaryPath.value?.id ? `${learningPathDetailBasePath.value}/${primaryPath.value.id}` : learningPathsPath.value;
      default:
        return continueLearningTarget.value;
    }
  };

  if (!hasLearningPath.value) {
    if (adaptiveCopy.value?.todayActions?.length) {
      return adaptiveCopy.value.todayActions.map((item: any, index: number) => ({
        id: `adaptive-empty-${index}`,
        tone: index === 0 ? 'primary' : 'muted',
        dot: index === 0 ? 'active' : 'dim',
        title: item.title,
        desc: item.desc,
        action: item.action,
        to: resolveAdaptiveTarget(item.to) || goalConversationPath.value
      }));
    }
    return [
      { id: 'goal', tone: 'primary', dot: 'active', title: '先规划一个目标', desc: '描述你想解决的事，系统会生成学习路径。', action: '规划目标', to: goalConversationPath.value },
      { id: 'state', tone: 'muted', dot: 'dim', title: '查看学习状态', desc: '完成一次学习后，系统会根据你的节奏给出建议。', action: '前往查看', to: learningStatePath.value },
      { id: 'record', tone: 'muted', dot: 'dim', title: '查看学习记录', desc: '开始学习后会自动记录学习时间。', action: '前往查看', to: achievementsPath.value }
    ];
  }

  if (adaptiveCopy.value?.todayActions?.length) {
    return adaptiveCopy.value.todayActions.map((item: any, index: number) => ({
      id: `adaptive-${index}`,
      tone: index === 0 ? 'primary' : index === 1 ? 'accent' : 'muted',
      dot: index === 0 ? 'active' : index === 1 ? 'active' : 'dim',
      title: item.title,
      desc: item.desc,
      action: item.action,
      to: resolveAdaptiveTarget(item.to),
    }));
  }

  const lsb = stats.value?.state?.lsb;
  const suggestion = stats.value?.suggestion?.message;

  const task = inProgressTaskCount.value > 0
    ? { id: 'task', tone: 'primary', dot: 'active', title: '继续上次学习', desc: '从上次停下的位置继续推进。', action: '继续学习', to: continueLearningTarget.value }
    : { id: 'task', tone: 'primary', dot: 'active', title: '继续上次学习', desc: '从上次停下的位置继续推进。', action: '继续学习', to: continueLearningTarget.value };

  const record = { id: 'record', tone: 'muted', dot: 'dim', title: '查看学习记录', desc: '回顾最近的学习内容和复盘。', action: '前往查看', to: achievementsPath.value };

  let suggest;
  if (typeof lsb === 'number' && suggestion) {
    const tone = lsb >= 0 ? 'accent' : 'warn';
    suggest = { id: 'state', tone, dot: lsb >= 0 ? 'active' : 'warn', title: '查看学习状态', desc: '看看当前节奏、负荷和建议。', action: '前往查看', to: learningStatePath.value };
  } else if (typeof lsb === 'number') {
    const tone = lsb >= 0 ? 'accent' : 'warn';
    suggest = { id: 'state', tone, dot: lsb >= 0 ? 'active' : 'warn', title: '查看学习状态', desc: '看看当前节奏、负荷和建议。', action: '前往查看', to: learningStatePath.value };
  } else {
    suggest = { id: 'state', tone: 'muted', dot: 'dim', title: '查看学习状态', desc: '看看当前节奏、负荷和建议。', action: '前往查看', to: learningStatePath.value };
  }

  return [task, suggest, record];
});

const handleCalendarDaySelect = (day: any) => {
  selectedCalendarDay.value = day;
};

const calendarDayFormatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const calendarDayZone = (minutes: number) => {
  if (minutes >= 120) return { label: '高强度', cls: 'dashboard-calendar-status__zone--z3' };
  if (minutes >= 60) return { label: '中度', cls: 'dashboard-calendar-status__zone--z2' };
  if (minutes > 0) return { label: '轻度', cls: 'dashboard-calendar-status__zone--z1' };
  return { label: '休息日', cls: 'dashboard-calendar-status__zone--rest' };
};

const calendarDayFormatDuration = (minutes: number) => {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
};

const calendarDayAnalysis = computed(() => {
  const day = selectedCalendarDay.value;
  if (!day) return '';
  if (day.durationMinutes === 0) return '今天还没有学习记录。可以休息，也可以补一次短时学习。';
  if (day.durationMinutes >= 120) return `高强度学习日，累计 ${calendarDayFormatDuration(day.durationMinutes)}。建议之后适当安排恢复。`;
  if (day.durationMinutes >= 60) return `学习投入比较扎实，累计 ${calendarDayFormatDuration(day.durationMinutes)}。保持这个节奏就好。`;
  return `轻量学习日，累计 ${calendarDayFormatDuration(day.durationMinutes)}，适合保持节奏或复习。`;
});

async function fetchDashboardData() {
  loading.value = true;
  try {
    const [statsResult, pathsResult] = await Promise.allSettled([
      learningAPI.getStats(),
      learningAPI.getPaths(),
    ]);

    if (statsResult.status === 'fulfilled') {
      stats.value = statsResult.value;
    } else {
      console.error('获取统计失败:', statsResult.reason);
    }

    if (pathsResult.status === 'fulfilled') {
      paths.value = (pathsResult.value as DashboardPath[]) || [];
    } else {
      console.error('获取学习路径失败:', pathsResult.reason);
    }

    try {
      adaptiveGuidance.value = await learningAPI.getAdaptiveGuidance();
    } catch (error) {
      adaptiveGuidance.value = null;
      console.error('获取动态引导文案失败:', error);
    }
  } catch (error) {
    adaptiveGuidance.value = null;
    console.error('获取学习台数据失败:', error);
  } finally {
    loading.value = false;
  }
}

const handleScroll = () => {
  scrolled.value = window.scrollY > 24;
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

async function refreshStateWorkbench() {
  if (!isTestMode.value) return;
  stateWorkbenchLoading.value = true;
  try {
    const [stateResult, learnerCenterResult] = await Promise.all([
      metricsAPI.getCurrentState(),
      userAPI.getLearnerCenter({ scope: 'global' }),
    ]);
    currentState.value = stateResult;
    learnerCenter.value = learnerCenterResult;
  } catch (error) {
    console.error('刷新学习状态测试工作台失败:', error);
  } finally {
    stateWorkbenchLoading.value = false;
  }
}

async function refreshDashboardDebug() {
  await Promise.all([
    fetchDashboardData(),
    refreshStateWorkbench(),
  ]);
}

onMounted(async () => {
  if (isProjectionMode()) {
    try {
      await userStore.fetchProfile();
    } catch (error) {
      console.error('获取投影视角用户信息失败:', error);
    }
  }
  await fetchDashboardData();
  await refreshStateWorkbench();
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
.dashboard-page {
  --dash-ink: #172033;
  --dash-muted: #66758d;
  --dash-blue: #3478f6;
  --dash-blue-deep: #1f57cc;
  min-height: 100vh;
  min-height: 100dvh;
  background: #f3f6fb;
  color: var(--dash-ink);
  position: relative;
  overflow-x: hidden;
}

.dashboard-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.dashboard-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.2;
}

.dashboard-bg-orb--1 {
  width: 520px;
  height: 520px;
  top: 80px;
  right: -150px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.38), transparent 70%);
}

.dashboard-bg-orb--2 {
  width: 460px;
  height: 460px;
  left: -170px;
  bottom: 30px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
}

.dashboard-bg-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent 72%);
}

.dashboard-header {
  position: sticky;
  top: 0;
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
}

.brand,
.header-nav,
.header-right,
.dashboard-hero__actions,
.today-item,
.section-head,
.panel-head,
.focus-card__head {
  display: flex;
  align-items: center;
}

.brand {
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dash-ink);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
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
  color: color-mix(in srgb, var(--dash-ink) 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.nav-item:hover,
.nav-item--active {
  background: rgba(52, 120, 246, 0.09);
  color: var(--dash-blue-deep);
}

.header-right {
  gap: 10px;
}

.header-cta,
.btn,
.inline-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  font-weight: 800;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, var(--dash-blue), var(--dash-blue-deep));
  font-size: 13px;
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
  color: var(--dash-ink);
}

.user-chip span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(52, 120, 246, 0.1);
  color: var(--dash-blue-deep);
  font-weight: 900;
}

.dashboard-main {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 calc(80px + var(--safe-area-bottom));
  display: grid;
  gap: 24px;
}

.surface-card,
.overview-card,
.today-card {
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(16px);
}

.dashboard-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 28px;
  padding: 30px;
  border-radius: 34px;
}

.dashboard-hero__copy,
.focus-card,
.dashboard-panel,
.today-card,
.friction-list,
.achievement-note {
  display: grid;
  gap: 16px;
}

.dashboard-hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pill,
.section-kicker {
  width: fit-content;
  font-size: 12px;
  font-weight: 900;
  color: var(--dash-blue-deep);
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: start;
  justify-self: start;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  line-height: 1;
}

.dashboard-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
}

.dashboard-source-badge--hot {
  background: rgba(49, 177, 111, 0.12);
  color: #178a56;
}

.dashboard-source-badge--cold {
  background: rgba(230, 162, 60, 0.12);
  color: #b57709;
}

.dashboard-source-note {
  margin-top: -10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-muted);
}

.section-kicker {
  letter-spacing: 0.05em;
}

.dashboard-hero h1,
.focus-card h2,
.section-head h2,
.panel-head h2 {
  margin: 0;
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.dashboard-hero h1 {
  max-width: 760px;
  font-size: clamp(38px, 5vw, 64px);
}

.dashboard-hero p,
.focus-card p,
.today-item p,
.overview-card p,
.friction-card p,
.achievement-note p {
  margin: 0;
  color: var(--dash-muted);
  line-height: 1.65;
}

.dashboard-hero__copy > p {
  max-width: 680px;
  font-size: 16px;
}

.dashboard-hero__actions {
  gap: 12px;
  flex-wrap: wrap;
}

/* .btn / .btn--primary / .btn--ghost / .btn--lg / .btn--full 已统一到全局 design-system.css */

.today-card {
  margin-top: 8px;
  padding: 18px;
  border-radius: 24px;
}

.dashboard-list-section + .dashboard-list-section {
  margin-top: 24px;
}

.dashboard-list-section__head {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.dashboard-list {
  display: grid;
  gap: 10px;
}

.dashboard-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.8);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  border: 1px solid transparent;
}

a.dashboard-list__item:hover,
button.dashboard-list__item:hover,
.dashboard-list__item:hover {
  background: rgba(243, 246, 251, 1);
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06);
  transform: translateY(-1px);
}

/* 主操作：实色背景 + 强阴影，吸引眼球 */
.dashboard-list__item--primary {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.08), rgba(31, 87, 204, 0.04));
  border-color: rgba(52, 120, 246, 0.15);
}

a.dashboard-list__item.dashboard-list__item--primary:hover {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.12), rgba(31, 87, 204, 0.06));
  border-color: rgba(52, 120, 246, 0.28);
  box-shadow: 0 8px 24px rgba(52, 120, 246, 0.12);
}

/* 次操作：略带蓝意但更克制 */
.dashboard-list__item--accent {
  background: rgba(243, 246, 251, 0.6);
  border-color: rgba(52, 120, 246, 0.06);
}

/* 弱化操作：纯灰背景 */
.dashboard-list__item--muted {
  background: rgba(243, 246, 251, 0.5);
}

.dashboard-list__item--muted strong {
  color: var(--dash-ink);
  opacity: 0.85;
}

.dashboard-list__item--muted p {
  opacity: 0.7;
}

.dashboard-list__item div {
  flex: 1;
  min-width: 0;
}

.dashboard-list__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 2px;
}

.dashboard-list__dot--active {
  background: var(--dash-blue);
  box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.1);
}

.dashboard-list__dot--done {
  background: #31b16f;
  box-shadow: 0 0 0 6px rgba(49, 177, 111, 0.1);
}

.dashboard-list__dot--warn {
  background: #e6a23c;
  box-shadow: 0 0 0 6px rgba(230, 162, 60, 0.1);
}

.dashboard-list__dot--dim {
  background: #c0c4cc;
  box-shadow: 0 0 0 6px rgba(192, 196, 204, 0.1);
}

.dashboard-list__action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--dash-blue-deep);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(52, 120, 246, 0.08);
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.dashboard-list__action--muted {
  color: var(--dash-ink);
  background: rgba(23, 32, 51, 0.06);
}

/* 主操作的 action 标签：实色填充按钮感 */
.dashboard-list__item--primary .dashboard-list__action {
  color: #fff;
  background: linear-gradient(135deg, var(--dash-blue), var(--dash-blue-deep));
  box-shadow: 0 6px 14px rgba(52, 120, 246, 0.22);
  padding: 6px 14px;
}

a.dashboard-list__item.dashboard-list__item--primary:hover .dashboard-list__action {
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
}

/* 次/弱操作 action 保持半透明灰 */
.dashboard-list__item--muted .dashboard-list__action {
  color: var(--dash-ink);
  background: rgba(23, 32, 51, 0.06);
  opacity: 0.85;
}

a.dashboard-list__item:hover .dashboard-list__action {
  background: rgba(52, 120, 246, 0.14);
}

.dashboard-list__item--warn .dashboard-list__action {
  color: #b8860b;
  background: rgba(230, 162, 60, 0.1);
}

.dashboard-list__item--warn:hover .dashboard-list__action {
  background: rgba(230, 162, 60, 0.18);
}

.today-card__head {
  display: grid;
  gap: 4px;
}

.today-card__head span,
.overview-card span,
.focus-card__stats span,
.achievement-summary span {
  font-size: 12px;
  color: var(--dash-muted);
  font-weight: 800;
}

.today-list {
  display: grid;
  gap: 10px;
}

.overview-grid--today {
  margin-top: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.today-item {
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.8);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.today-item:hover {
  background: rgba(243, 246, 251, 1);
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06);
}

.today-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}

.today-item__dot--active {
  background: var(--dash-blue);
  box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.1);
}

.today-item__dot--done {
  background: #31b16f;
  box-shadow: 0 0 0 6px rgba(49, 177, 111, 0.1);
}

.today-item__dot--warn {
  background: #e6a23c;
  box-shadow: 0 0 0 6px rgba(230, 162, 60, 0.1);
}

.today-item__dot--dim {
  background: #c0c4cc;
  box-shadow: 0 0 0 6px rgba(192, 196, 204, 0.1);
}

.today-item div {
  flex: 1;
  min-width: 0;
}

.today-item__action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--dash-blue-deep);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(52, 120, 246, 0.08);
  white-space: nowrap;
  transition: background 0.15s ease;
}

.today-item:hover .today-item__action {
  background: rgba(52, 120, 246, 0.14);
}

.today-item--warn .today-item__action {
  color: #b8860b;
  background: rgba(230, 162, 60, 0.1);
}

.today-item--warn:hover .today-item__action {
  background: rgba(230, 162, 60, 0.18);
}

.focus-card {
  padding: 24px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.07), rgba(255, 255, 255, 0.76));
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.focus-card__head,
.section-head,
.panel-head {
  justify-content: space-between;
  gap: 16px;
}

.focus-card__badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--dash-blue-deep);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.focus-card__summary {
  margin-top: -4px;
}

.focus-card__stats,
.achievement-summary {
  display: grid;
  gap: 10px;
}

.focus-card__stats article,
.achievement-summary article,
.friction-card {
  padding: 15px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.focus-card__stats strong,
.overview-card strong,
.achievement-summary strong {
  display: block;
  margin: 4px 0;
  font-size: 24px;
  line-height: 1;
}

.dashboard-section,
.dashboard-bottom-grid {
  display: grid;
  gap: 18px;
}

.section-head h2,
.panel-head h2 {
  margin-top: 6px;
  font-size: clamp(24px, 3vw, 36px);
}

.inline-link {
  color: var(--dash-blue-deep);
  font-size: 13px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.overview-card {
  display: grid;
  gap: 8px;
  padding: 22px;
  border-radius: 24px;
}

.overview-card--primary {
  border-color: rgba(52, 120, 246, 0.14);
}

.overview-card--success {
  border-color: rgba(49, 177, 111, 0.14);
}

.overview-card--warning {
  border-color: rgba(244, 170, 70, 0.18);
}

.overview-card--accent {
  border-color: rgba(141, 107, 255, 0.16);
}

.overview-card small {
  color: color-mix(in srgb, var(--dash-ink) 74%, white);
  font-weight: 900;
}

.dashboard-bottom-grid {
  grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
}

.dashboard-panel {
  padding: 24px;
  border-radius: 28px;
}

.friction-card strong {
  display: block;
  margin-bottom: 6px;
}

.achievement-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.achievement-note {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  padding: 16px;
  border-radius: 18px;
  background: rgba(52, 120, 246, 0.07);
  color: var(--dash-blue-deep);
}

/* ========== 学习负荷日历 ========== */
.dashboard-calendar-section {
  display: grid;
  gap: 24px;
  margin-bottom: 24px;
}

.dashboard-debug-overview {
  display: grid;
  gap: 18px;
  padding: 24px 26px;
  border-radius: 28px;
}

.dashboard-debug-overview__head {
  justify-content: space-between;
  gap: 16px;
}

.dashboard-debug-overview__actions,
.dashboard-debug-overview__links,
.dashboard-debug-overview__step-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.dashboard-debug-overview__lead {
  margin: 0;
  color: var(--dash-muted);
  line-height: 1.7;
}

.dashboard-debug-overview__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-debug-overview__card,
.dashboard-debug-step {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid rgba(23, 32, 51, 0.05);
  background: rgba(255, 255, 255, 0.84);
}

.dashboard-debug-overview__card span,
.dashboard-debug-step span {
  font-size: 12px;
  color: var(--dash-muted);
}

.dashboard-debug-overview__card strong,
.dashboard-debug-step strong {
  color: var(--dash-ink);
  font-size: 16px;
  line-height: 1.45;
}

.dashboard-debug-overview__card p,
.dashboard-debug-step p {
  margin: 0;
  color: var(--dash-muted);
  line-height: 1.65;
}

.dashboard-debug-step {
  flex: 1 1 220px;
}

.dashboard-debug-step--done {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(255, 255, 255, 0.9));
  border-color: rgba(16, 185, 129, 0.18);
}

.dashboard-debug-step--active {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.9));
  border-color: rgba(52, 120, 246, 0.16);
}

.dashboard-debug-step--attention {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.1), rgba(255, 255, 255, 0.92));
  border-color: rgba(245, 158, 11, 0.22);
}

.dashboard-debug-step--idle {
  background: rgba(243, 246, 251, 0.9);
}

.dashboard-debug-link {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  background: rgba(255, 255, 255, 0.84);
  color: var(--dash-blue-deep);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
}

.dashboard-debug-link:hover {
  background: rgba(52, 120, 246, 0.08);
}

.dashboard-debug-float-btn {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 1100;
  display: grid;
  gap: 4px;
  min-width: 156px;
  padding: 12px 14px;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--dash-blue), var(--dash-blue-deep));
  box-shadow: 0 18px 38px rgba(31, 87, 204, 0.28);
  color: #fff;
  text-align: left;
}

.dashboard-debug-float-btn strong {
  font-size: 14px;
}

.dashboard-debug-float-btn span {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.82);
}

.dashboard-debug-drawer :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding-bottom: 12px;
}

.dashboard-debug-drawer :deep(.el-drawer__body) {
  padding-top: 0;
}

.dashboard-debug-drawer__body,
.dashboard-debug-skill-grid,
.dashboard-debug-json-grid,
.dashboard-debug-section,
.dashboard-debug-action-list {
  display: grid;
  gap: 14px;
}

.dashboard-debug-drawer__body {
  padding-bottom: 24px;
}

.dashboard-debug-panel__actions,
.dashboard-debug-toolbar,
.dashboard-debug-collapse__head {
  display: flex;
  gap: 12px;
}

.dashboard-debug-panel__actions,
.dashboard-debug-toolbar {
  flex-wrap: wrap;
}

.dashboard-debug-panel__actions--top {
  margin-top: 0;
}

.dashboard-debug-quick-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.dashboard-debug-quick-chip strong {
  font-size: 12px;
  color: var(--dash-ink);
}

.dashboard-debug-quick-chip em {
  font-style: normal;
  font-size: 12px;
  color: var(--dash-muted);
  font-weight: 700;
}

.dashboard-debug-collapse {
  border-radius: 20px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(52, 120, 246, 0.08);
  padding: 14px 16px;
}

.dashboard-debug-collapse + .dashboard-debug-collapse {
  margin-top: 14px;
}

.dashboard-debug-collapse summary {
  cursor: pointer;
  list-style: none;
}

.dashboard-debug-collapse summary::-webkit-details-marker {
  display: none;
}

.dashboard-debug-collapse__head {
  align-items: center;
  justify-content: space-between;
}

.dashboard-debug-collapse__head strong {
  display: block;
  color: var(--dash-ink);
  line-height: 1.4;
}

.dashboard-debug-collapse__badge {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--dash-blue-deep);
  font-size: 12px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.dashboard-debug-skill-grid {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  margin-top: 16px;
}

.dashboard-debug-json-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.dashboard-debug-json-grid--raw {
  margin-top: 14px;
}

.dashboard-debug-section {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.dashboard-debug-section--accent {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.92));
  border-color: rgba(52, 120, 246, 0.12);
}

.dashboard-debug-section strong {
  color: var(--dash-ink);
}

.dashboard-debug-section p,
.dashboard-debug-empty-state {
  margin: 0;
  color: var(--dash-muted);
  line-height: 1.6;
}

.dashboard-debug-kv-grid {
  flex-wrap: wrap;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard-debug-kv-item {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.92);
}

.dashboard-debug-kv-item span,
.dashboard-debug-action-item span {
  font-size: 12px;
  color: var(--dash-muted);
}

.dashboard-debug-kv-item p,
.dashboard-debug-action-item p {
  margin: 0;
  color: var(--dash-ink);
  line-height: 1.6;
}

.dashboard-debug-action-item {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.dashboard-debug-action-item strong {
  font-size: 14px;
}

.dashboard-debug-json-card {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.dashboard-debug-json-card summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 800;
  color: var(--dash-ink);
}

.dashboard-debug-json-card summary em {
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-muted);
}

.dashboard-debug-json-card pre {
  margin: 12px 0 0;
  max-height: 320px;
  overflow: auto;
  padding: 14px;
  border-radius: 14px;
  background: rgba(243, 246, 251, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.05);
  color: #334155;
  font-size: 12px;
  line-height: 1.6;
}

.dashboard-debug-empty-state {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(244, 247, 252, 0.9);
  border: 1px dashed rgba(52, 120, 246, 0.14);
}

.dashboard-calendar-layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}

.dashboard-calendar-panel {
  padding: 24px;
  border-radius: 24px;
  overflow: hidden;
}

.dashboard-calendar-status {
  padding: 22px;
  border-radius: 24px;
  display: grid;
  gap: 16px;
  position: sticky;
  top: 88px;
}

.dashboard-calendar-status__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  color: var(--dash-muted);
  gap: 12px;
}

.dashboard-calendar-status__empty-icon {
  font-size: 2rem;
}

.dashboard-calendar-status__empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.dashboard-calendar-status__head {
  display: grid;
  gap: 6px;
}

.dashboard-calendar-status__head strong {
  font-size: 18px;
  color: var(--dash-ink);
  line-height: 1.2;
}

.dashboard-calendar-status__cards {
  display: grid;
  gap: 10px;
}

.dashboard-calendar-status__card {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.04);
}

.dashboard-calendar-status__card span {
  font-size: 12px;
  color: var(--dash-muted);
  white-space: nowrap;
}

.dashboard-calendar-status__card strong {
  font-size: 14px;
  color: var(--dash-ink);
  text-align: right;
}

.dashboard-calendar-status__text {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-calendar-status__zone {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.dashboard-calendar-status__zone--z1 {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}

.dashboard-calendar-status__zone--z2 {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

.dashboard-calendar-status__zone--z3 {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.dashboard-calendar-status__zone--rest {
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
}

.dashboard-calendar-status__analysis {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(52, 120, 246, 0.06);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.dashboard-calendar-status__analysis strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--dash-blue-deep);
}

.dashboard-calendar-status__analysis p {
  margin: 0;
  font-size: 13px;
  color: color-mix(in srgb, var(--dash-ink) 72%, #fff);
  line-height: 1.6;
}

@media (max-width: 1120px) {
  .dashboard-hero,
  .dashboard-bottom-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-calendar-layout {
    grid-template-columns: 1fr;
  }

  .dashboard-calendar-status {
    position: static;
  }

  .dashboard-debug-skill-grid,
  .dashboard-debug-json-grid,
  .dashboard-debug-kv-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .header-container,
  .dashboard-main {
    width: min(100% - 28px, 1240px);
  }

  .header-container {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .header-nav {
    display: none;
  }

  .header-cta,
  .user-chip {
    display: none;
  }

  .header-right {
    justify-content: flex-end;
  }

  .user-chip {
    min-width: auto;
    padding-inline: 10px;
  }

  .dashboard-hero,
  .dashboard-panel,
  .dashboard-calendar-panel {
    padding: 20px;
    border-radius: 24px;
  }

  .overview-grid,
  .achievement-summary,
  .dashboard-debug-overview__grid {
    grid-template-columns: 1fr;
  }

  .section-head,
  .panel-head,
  .dashboard-hero__actions,
  .dashboard-debug-overview__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .header-container,
  .dashboard-main {
    width: min(100% - 20px, 1240px);
  }

  .header-container {
    gap: 10px;
  }

  .dashboard-main {
    gap: 16px;
    padding-top: 18px;
  }

  .dashboard-hero {
    gap: 18px;
  }

  .dashboard-hero,
  .today-card,
  .focus-card,
  .overview-card,
  .dashboard-panel,
  .dashboard-calendar-panel,
  .dashboard-debug-overview,
  .dashboard-calendar-status {
    padding: 16px;
    border-radius: 20px;
  }

  .dashboard-hero h1 {
    max-width: 10ch;
    font-size: clamp(2rem, 11.5vw, 3rem);
    line-height: 0.98;
  }

  .dashboard-hero__copy > p {
    font-size: 0.95rem;
  }

  .dashboard-list-section {
    gap: 10px;
  }

  .dashboard-list-section__head {
    margin-bottom: 6px;
  }

  .dashboard-list__item {
    gap: 10px;
    padding: 13px;
    border-radius: 16px;
  }

  .dashboard-list__item div strong {
    display: block;
    font-size: 1rem;
    line-height: 1.35;
  }

  .dashboard-list__item div p {
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .dashboard-list__item,
  .today-item,
  .dashboard-calendar-status__card,
  .achievement-note {
    align-items: flex-start;
    flex-direction: column;
  }

  .dashboard-list__action,
  .today-item__action,
  .dashboard-calendar-status__card span,
  .dashboard-calendar-status__text {
    white-space: normal;
  }

  .dashboard-calendar-status__card strong,
  .dashboard-calendar-status__text {
    text-align: left;
    max-width: none;
  }

  .dashboard-calendar-status__zone {
    align-self: flex-start;
  }

  .achievement-note {
    grid-template-columns: 1fr;
  }

  .focus-card__stats,
  .dashboard-calendar-status__cards {
    grid-template-columns: 1fr;
  }

  .dashboard-debug-panel__actions,
  .dashboard-debug-collapse__head,
  .dashboard-calendar-status__head,
  .focus-card__head,
  .dashboard-debug-overview__actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .dashboard-debug-float-btn {
    right: 16px;
    left: 16px;
    bottom: 16px;
    min-width: 0;
  }

  .dashboard-debug-panel__actions {
    width: 100%;
  }

  .dashboard-debug-panel__actions .btn {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .dashboard-main {
    width: min(100% - 16px, 1240px);
    gap: 14px;
    padding-top: 14px;
    padding-bottom: calc(14px + var(--safe-area-bottom));
  }

  .dashboard-hero,
  .today-card,
  .focus-card,
  .overview-card,
  .dashboard-panel,
  .dashboard-calendar-panel,
  .dashboard-debug-overview,
  .dashboard-calendar-status {
    padding: 14px;
    border-radius: 18px;
  }

  .dashboard-hero h1 {
    font-size: clamp(1.85rem, 11vw, 2.65rem);
  }

  .focus-card__stats article {
    padding: 13px;
    border-radius: 16px;
  }

  .focus-card__stats strong {
    font-size: 20px;
  }

  .dashboard-list__action {
    padding: 5px 9px;
    font-size: 11px;
  }
}
</style>
