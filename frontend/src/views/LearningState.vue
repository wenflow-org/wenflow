<template>
  <div class="learning-state-page">
    <!-- 动态背景 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
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
          <router-link :to="learningPathsPath" class="nav-item">学习路径</router-link>
          <router-link :to="learningStatePath" class="nav-item nav-item--active">学习状态</router-link>
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

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="content-container">
        <section class="state-page-shell">
          <section class="app-page-head glass-card state-hero">
            <div class="app-page-head__top">
              <span class="pill">学习状态</span>
              <div class="app-page-head__actions">
                <router-link :to="learningPathsPath" class="btn btn-primary">查看学习路径</router-link>
                <router-link :to="dashboardPath" class="btn btn-ghost">回到学习台</router-link>
              </div>
            </div>

            <div class="app-page-head__intro">
              <h1>{{ statePageTitle }}</h1>
              <p>{{ statePageSubtitle }}</p>
            </div>

            <div v-if="state" class="app-page-head__summary state-hero__summary">
              <article v-for="item in stateMetricCards" :key="item.label" class="app-page-head__summary-card state-hero__summary-card" :class="`state-hero__summary-card--${item.tone}`">
                <span>{{ item.label }}</span>
                <strong :class="item.valueClass">{{ item.value }}</strong>
                <p>{{ item.note }}</p>
              </article>
            </div>

            <div v-if="stateGuidanceActions.length" class="state-hero__actions-strip">
              <router-link
                v-for="item in stateGuidanceActions"
                :key="item.title"
                :to="item.to"
                class="state-hero__action-card"
              >
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
                <span>{{ item.action }}</span>
              </router-link>
            </div>
          </section>
        </section>

        <div v-loading="loading" class="state-content">
          <div v-if="stateLoadError" class="empty-state glass-card">
            <div class="empty-icon">!</div>
            <h3 class="empty-title">学习状态加载失败</h3>
            <p class="empty-desc">你的学习记录没有丢失，可以重新加载。</p>
            <div class="empty-state__actions">
              <button type="button" class="btn btn-primary" @click="refreshStatePage({ forceTrends: true })">重新加载</button>
            </div>
          </div>

          <div v-else-if="!state" class="empty-state glass-card">
            <div class="empty-icon">📈</div>
            <h3 class="empty-title">还没有可展示的学习状态</h3>
            <p class="empty-desc">完成第一轮真实学习后，这里会汇总你的节奏、掌握情况和疲劳变化。</p>
            <div class="empty-state__actions">
              <router-link :to="learningPathsPath" class="btn btn-primary">查看学习路径</router-link>
              <router-link :to="goalConversationPath" class="btn btn-ghost">先规划学习目标</router-link>
            </div>
          </div>

          <div v-else class="state-content-inner">
            <section class="state-layout">
              <article class="glass-card state-trend-panel">
                <div class="state-panel__head state-panel__head--trend">
                  <div class="state-trend-panel__intro">
                    <span class="section-kicker">趋势图</span>
                    <h2>学习状态轨迹</h2>
                    <p>{{ trendRangeDescription }}</p>
                  </div>
                  <div class="trend-controls trend-controls--pill">
                    <button
                      v-for="option in trendRangeOptions"
                      :key="option.key"
                      class="trend-btn"
                      :class="{ active: trendDays === option.key }"
                      @click="trendDays = option.key"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>

                <div class="state-trend-summary">
                  <article
                    v-for="item in trendSummaryCards"
                    :key="item.label"
                    class="state-trend-summary-card"
                    :class="`state-trend-summary-card--${item.tone}`"
                  >
                    <span>{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                    <p>{{ item.note }}</p>
                  </article>
                </div>

                <div v-if="trends.length > 0" class="state-trend-chart-shell">
                  <div class="state-trend-chart-head">
                    <div class="state-trend-chart-head__block">
                      <span>覆盖范围</span>
                      <strong>{{ trendCoverageLabel }}</strong>
                      <p>{{ trendCoverageNote }}</p>
                    </div>
                    <div class="state-trend-chart-head__block state-trend-chart-head__block--compact">
                      <span>记录起点</span>
                      <strong>{{ trendRegisteredAtLabel }}</strong>
                      <p>趋势序列会从注册当天开始建立，不展示注册前的空白历史。</p>
                    </div>
                  </div>

                  <div class="trends-card state-trends-card">
                    <div class="chart-container chart-container--state">
                      <canvas ref="trendChart"></canvas>
                    </div>
                  </div>
                </div>
                <div v-else class="trends-card chart-empty">
                  <el-result v-if="trendsLoadError" icon="error" title="趋势加载失败" :sub-title="trendsLoadError">
                    <template #extra>
                      <el-button type="primary" @click="loadTrends(trendDays)">重新加载</el-button>
                    </template>
                  </el-result>
                  <el-empty v-else description="完成一次学习后即可看到趋势" />
                </div>
              </article>

              <section class="state-main-followups">
                <article v-if="learnerReplanSignal?.shouldSuggest" class="glass-card state-insight-card state-insight-card--warning">
                  <div class="state-panel__head">
                    <span class="section-kicker">路径调整建议</span>
                    <span class="state-insight-card__badge">{{ replanPriorityText }}</span>
                  </div>
                  <p class="state-insight-card__summary">{{ learnerReplanSignal.rationale }}</p>
                  <div class="state-warning-list">
                    <div class="state-warning-item">
                      <strong>建议动作</strong>
                      <p>{{ replanActionText }}</p>
                    </div>
                  </div>
                  <div class="state-hero__actions-strip state-hero__actions-strip--stacked">
                    <router-link :to="currentPathDetailPath" class="state-hero__action-card">
                      <strong>查看当前路径</strong>
                      <p>先查看当前路径中的调整建议，再决定是否调整后续阶段。</p>
                      <span>前往查看</span>
                    </router-link>
                  </div>
                </article>

                <article v-if="warnings.length > 0" class="glass-card state-insight-card state-insight-card--warning">
                  <div class="state-panel__head">
                    <span class="section-kicker">学习预警</span>
                    <span class="state-insight-card__badge">{{ warnings.length }} 条</span>
                  </div>
                  <p v-if="stateWarningSummary" class="state-insight-card__summary">{{ stateWarningSummary }}</p>
                  <div class="state-warning-list">
                    <div v-for="(warning, index) in warnings.slice(0, 3)" :key="index" class="state-warning-item">
                      <strong>{{ warning.title }}</strong>
                      <p>{{ warning.message }}</p>
                    </div>
                  </div>
                </article>
              </section>

              <aside class="state-side-panels">
                <article v-if="learnerCenter" class="glass-card state-insight-card state-insight-card--primary">
                  <div class="state-panel__head">
                     <span class="section-kicker">学习偏好</span>
                  </div>
                  <div class="state-definition-list">
                    <div class="state-definition-item">
                       <strong>适合你的学习方式</strong>
                      <p>{{ learnerNarrativeSummary }}</p>
                    </div>
                    <div class="state-definition-item">
                       <strong>已有基础</strong>
                      <p>{{ reusableFoundationsText }}</p>
                    </div>
                    <div class="state-definition-item">
                       <strong>建议先补的基础</strong>
                      <p>{{ blockedFoundationsText }}</p>
                    </div>
                  </div>
                  <div class="state-hero__actions-strip state-hero__actions-strip--stacked">
                    <router-link :to="'/user/account'" class="state-hero__action-card">
                       <strong>查看个人中心</strong>
                       <p>查看账户信息和当前学习入口。</p>
                       <span>前往个人中心</span>
                    </router-link>
                  </div>
                </article>

                <article class="glass-card state-insight-card">
                  <div class="state-panel__head">
                    <span class="section-kicker">指标说明</span>
                  </div>
                  <div class="state-definition-list">
                    <div v-for="item in stateDefinitionCards" :key="item.title" class="state-definition-item">
                      <strong>{{ item.title }}</strong>
                      <p>{{ item.desc }}</p>
                    </div>
                  </div>
                </article>

              </aside>
            </section>
          </div>
        </div>
      </div>
      <AppMiniFooter />
    </main>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import request from '../utils/api';
import { metricsAPI } from '../api/metrics';
import { userAPI, type LearnerCenterSnapshot } from '../api/user';
import { getReplanActionText, getReplanPriorityText } from '../utils/replanSignal';
import { Chart } from 'chart.js/auto';
import { useUserStore } from '../stores/user';
import { isProjectionMode } from '../utils/projection';
import MobileSiteMenu from '../components/MobileSiteMenu.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import AppMiniFooter from '../components/AppMiniFooter.vue';
import {
  User,
  Switch,
} from '@element-plus/icons-vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
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
const learningPathBasePath = computed(() => {
  if (isTestMode.value && isAdminRoute.value) {
    return '/admin/test/learning-path';
  }
  return '/learning-path';
});

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const headerNavItems = computed(() => [
  { label: '学习台', to: dashboardPath.value, matchPrefixes: ['/dashboard', '/admin/test/dashboard'] },
  { label: '目标规划', to: goalConversationPath.value, matchPrefixes: ['/goal-conversation', '/test/goal-full', '/admin/test/goal-full'] },
  { label: '学习路径', to: learningPathsPath.value, matchPrefixes: ['/learning-paths', '/learning-path/', '/test/learning-paths', '/test/learning-path/', '/admin/test/learning-paths', '/admin/test/learning-path/'] },
  { label: '学习状态', to: learningStatePath.value, matchPrefixes: ['/learning-state', '/admin/test/learning-state'] },
  { label: '成就', to: achievementsPath.value, matchPrefixes: ['/achievements', '/admin/test/achievements'] }
]);

type TrendRangeKey = 0 | 7 | 30;

interface TrendRangeMeta {
  mode: 'recent' | 'all';
  requestedDays: number | 'all';
  actualDays: number;
  registeredAt: string;
  startDate: string;
  endDate: string;
}

interface TrendSummaryCard {
  label: string;
  value: string;
  note: string;
  tone: 'primary' | 'neutral' | 'success' | 'warning';
}

const scrolled = ref(false);
const loading = ref(true);
const state = ref<StateMetrics | null>(null);
const stateLoadError = ref('');
const trends = ref<TrendData[]>([]);
const trendDays = ref<TrendRangeKey>(0);
const trendRangeMeta = ref<TrendRangeMeta | null>(null);
const trendsLoadError = ref('');
const trendChart = ref<HTMLCanvasElement | null>(null);
const warnings = ref<Array<{
  type: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  suggestion: string;
}>>([]);
const learnerCenter = ref<LearnerCenterSnapshot | null>(null);
let chartInstance: Chart | null = null;
const trendCache = new Map<TrendRangeKey, { trends: TrendData[]; range: TrendRangeMeta }>();
const trendRangeOptions: Array<{ key: TrendRangeKey; label: string }> = [
  { key: 0, label: '注册至今' },
  { key: 7, label: '7天' },
  { key: 30, label: '30天' },
];

const statePageTitle = computed(() => '看见最近的学习状态，再决定下一步怎么学。');
const statePageSubtitle = computed(() => '这里会汇总你的学习节奏、掌握情况和疲劳变化，帮助你判断要继续推进，还是先放慢一点。');

const stateWarningSummary = computed(() => {
  if (warnings.value.length > 0) return '当前状态存在需关注项，建议先看预警再决定是否继续推进。';
  return '';
});

const stateGuidanceActions = computed(() => {
  const pathId = learnerCenter.value?.knowledgeMemory?.currentPath?.learningPathId;
  return [
    {
      title: '查看当前路径',
      desc: '回到当前任务，确认状态影响的是哪一步。',
      action: '查看路径',
      to: pathId ? `${learningPathBasePath.value}/${pathId}` : learningPathsPath.value,
    },
    {
      title: '回到学习台',
      desc: '查看当前任务和下一步安排。',
      action: '回到学习台',
      to: dashboardPath.value,
    },
    {
      title: '规划新目标',
      desc: '如果当前路径不再适合，可以重新开始一个目标。',
      action: '规划目标',
      to: goalConversationPath.value,
    },
  ];
});

const learnerReplanSignal = computed(() => learnerCenter.value?.replanSignal || null);
const replanPriorityText = computed(() => getReplanPriorityText(learnerReplanSignal.value?.priority));
const replanActionText = computed(() => getReplanActionText(learnerReplanSignal.value));
const currentPathDetailPath = computed(() => {
  const pathId = learnerCenter.value?.knowledgeMemory?.currentPath?.learningPathId;
  return pathId ? `${learningPathBasePath.value}/${pathId}` : learningPathsPath.value;
});
const learnerNarrativeSummary = computed(() => {
  const narrative = learnerCenter.value?.profile?.narrativeInsights;
  if (!narrative) return '完成更多学习后，这里会给出更准确的建议。';
  return [narrative.contentReceptionPattern, narrative.practicePreferenceNote, narrative.supportStyleNote].filter(Boolean).join('；') || '完成更多学习后，这里会给出更准确的建议。';
});
const reusableFoundationsText = computed(() => {
  const values = learnerCenter.value?.knowledgeMemory?.globalBackground?.reusableFoundations || [];
  return values.length > 0 ? values.slice(0, 6).join('、') : '暂无明确可复用基础。';
});
const blockedFoundationsText = computed(() => {
  const values = learnerCenter.value?.knowledgeMemory?.globalBackground?.blockedFoundations || [];
  return values.length > 0 ? values.slice(0, 6).join('、') : '暂无高风险前置。';
});


const stateMetricCards = computed(() => {
  if (!state.value) return [];

  return [
    {
      label: '整体状态',
      value: state.value.lsb.toFixed(2),
      note: `状态判断：${getLSBText(state.value.lsb)}`,
      tone: 'lsb',
      valueClass: getLSBValueClass(state.value.lsb)
    },
    {
      label: '学习压力',
      value: state.value.lss.toFixed(2),
      note: '最近一次学习中的压力水平',
      tone: 'lss',
      valueClass: getLSSValueClass(state.value.lss)
    },
    {
      label: '掌握趋势',
      value: state.value.ktl.toFixed(2),
      note: '近期学习内容的掌握变化',
      tone: 'ktl',
      valueClass: 'value-primary'
    },
    {
      label: '疲劳程度',
      value: state.value.lf.toFixed(2),
      note: '近期学习后的疲劳变化',
      tone: 'lf',
      valueClass: getLFValueClass(state.value.lf)
    }
  ];
});

const stateDefinitionCards = computed(() => {
  return [
    { title: '学习压力', desc: '反映最近一次学习中感受到的难度和压力。' },
    { title: '掌握趋势', desc: '反映近期学习内容的掌握变化。' },
    { title: '疲劳程度', desc: '反映近期学习后的疲劳积累。' },
    { title: '整体状态', desc: '综合掌握趋势和疲劳程度，帮助判断下一步节奏。' }
  ];
});

interface StateMetrics {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  updatedAt?: string;
  suggestion?: {
    level?: 'critical' | 'warning' | 'normal' | 'optimal' | string;
    message?: string;
    action?: string;
    categories?: {
      pressure: { status: string; message: string };
      state: { status: string; message: string };
      growth: { status: string; message: string };
      duration: { status: string; message: string };
    };
  };
}

interface TrendData {
  date: string | Date;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
}

interface TrendResponsePayload {
  trends: TrendData[];
  range: TrendRangeMeta;
  days: number;
}

const hasTrendValue = (item: TrendData) => {
  return [item.lss, item.ktl, item.lf, item.lsb].some((value) => typeof value === 'number');
};

const formatTrendDate = (value?: string | Date, withYear = false) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('zh-CN', withYear
    ? { year: 'numeric', month: 'numeric', day: 'numeric' }
    : { month: 'numeric', day: 'numeric' });
};

const getTrendMaxTicks = (count: number) => {
  if (count > 180) return 6;
  if (count > 120) return 8;
  if (count > 60) return 10;
  return 14;
};

const buildTrendLabels = (data: TrendData[]) => {
  return data.map((item) => formatTrendDate(item.date));
};

const trendLatestPoint = computed(() => {
  const points = [...trends.value].reverse();
  return points.find((item) => hasTrendValue(item)) || null;
});

const trendActiveDays = computed(() => trends.value.filter((item) => hasTrendValue(item)).length);

const trendCoverageLabel = computed(() => {
  if (!trendRangeMeta.value) return '暂无范围';
  return `${formatTrendDate(trendRangeMeta.value.startDate, true)} - ${formatTrendDate(trendRangeMeta.value.endDate, true)}`;
});

const trendRangeDescription = computed(() => {
  if (trendDays.value === 0) {
    return '从注册当天开始回看，每个自然日都会留下一条真实或自然衰减后的状态轨迹。';
  }

  return `聚焦最近 ${trendDays.value} 天的状态波动；如果账号注册更晚，会自动从注册当天开始显示。`;
});

const trendCoverageNote = computed(() => {
  if (!trendRangeMeta.value) return '系统会按自然日整理你的状态记录。';
  if (trendRangeMeta.value.mode === 'all') {
    return `已覆盖注册以来 ${trendRangeMeta.value.actualDays} 个自然日。`;
  }

  return `当前窗口共 ${trendRangeMeta.value.actualDays} 个自然日，注册前不会补出空白历史。`;
});

const trendRegisteredAtLabel = computed(() => {
  return trendRangeMeta.value ? formatTrendDate(trendRangeMeta.value.registeredAt, true) : '--';
});

const trendSummaryCards = computed<TrendSummaryCard[]>(() => {
  const latestPoint = trendLatestPoint.value;
  const currentLsb = state.value?.lsb ?? latestPoint?.lsb ?? null;

  return [
    {
      label: '观察区间',
      value: trendDays.value === 0 ? '注册至今' : `最近 ${trendDays.value} 天`,
      note: trendCoverageLabel.value,
      tone: 'primary',
    },
    {
      label: '有效记录',
      value: `${trendActiveDays.value} 天`,
      note: trendRangeMeta.value ? `共 ${trendRangeMeta.value.actualDays} 个自然日` : '等待趋势数据',
      tone: 'neutral',
    },
    {
      label: '当前节奏',
      value: typeof currentLsb === 'number' ? getLSBText(currentLsb) : '--',
      note: typeof currentLsb === 'number' ? `LSB ${currentLsb.toFixed(2)}` : '暂无状态判断',
      tone: typeof currentLsb === 'number' && currentLsb >= 40
        ? 'success'
        : typeof currentLsb === 'number' && currentLsb < 20
          ? 'warning'
          : 'primary',
    },
    {
      label: '最新记录',
      value: latestPoint ? formatTrendDate(latestPoint.date, true) : '--',
      note: state.value?.updatedAt ? `更新时间 ${formatStateDateTime(state.value.updatedAt)}` : '按自然日持续更新',
      tone: 'neutral',
    },
  ];
});

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

// 加载当前状态
const loadCurrentState = async () => {
  try {
    stateLoadError.value = '';
    state.value = await metricsAPI.getCurrentState();
  } catch {
    stateLoadError.value = '学习状态加载失败';
    toast.error('学习状态加载失败，请重试');
  }
};

const createTrendChart = (ctx: CanvasRenderingContext2D, data: TrendData[]) => {
  const labels = buildTrendLabels(data);

  const createGradient = (color: string) => {
    const gradient = ctx.createLinearGradient(0, 300, 0, 0);
    gradient.addColorStop(0, color.replace('1)', '0)'));
    gradient.addColorStop(1, color.replace('1)', '0.15)'));
    return gradient;
  };

  chartInstance = new Chart(trendChart.value!, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
           label: '学习压力',
          data: data.map(item => item.lss),
          borderColor: 'rgba(239, 68, 68, 0.88)',
          backgroundColor: createGradient('rgba(239, 68, 68, 1)'),
          fill: false,
          tension: 0.35,
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          pointHoverRadius: 5,
        },
        {
           label: '掌握趋势',
          data: data.map(item => item.ktl),
          borderColor: 'rgba(79, 70, 229, 0.96)',
          backgroundColor: createGradient('rgba(79, 70, 229, 1)'),
          fill: false,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
        },
        {
           label: '疲劳程度',
          data: data.map(item => item.lf),
          borderColor: 'rgba(245, 158, 11, 0.9)',
          backgroundColor: createGradient('rgba(245, 158, 11, 1)'),
          fill: false,
          tension: 0.35,
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 5,
        },
        {
           label: '整体状态',
          data: data.map(item => item.lsb),
          borderColor: '#10b981',
          backgroundColor: createGradient('rgba(16, 185, 129, 1)'),
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 240,
      },
      interaction: {
        intersect: false,
        mode: 'index',
      },
      scales: {
        y: {
          beginAtZero: false,
          suggestedMin: -100,
          suggestedMax: 100,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
          },
          ticks: {
            color: '#6b7280',
            font: { size: 11 },
          },
        },
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#6b7280',
            font: { size: 11 },
            autoSkip: true,
            maxRotation: 0,
            maxTicksLimit: getTrendMaxTicks(data.length),
          },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 20,
            color: '#374151',
            font: { size: 12, weight: 500 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleFont: { size: 13, weight: 600 },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            label: (context) => {
              const raw = context.raw;
              if (raw === null || raw === undefined) {
                return `${context.dataset.label}: 暂无记录`;
              }
              return `${context.dataset.label}: ${Number(raw).toFixed(2)}`;
            },
          },
        },
      },
    },
  });
};

const updateTrendChart = (data: TrendData[]) => {
  if (!chartInstance) return;
  const labels = buildTrendLabels(data);

  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = data.map(item => item.lss);
  chartInstance.data.datasets[1].data = data.map(item => item.ktl);
  chartInstance.data.datasets[2].data = data.map(item => item.lf);
  chartInstance.data.datasets[3].data = data.map(item => item.lsb);
  const scales = chartInstance.options.scales as {
    x?: { ticks?: { maxTicksLimit?: number } };
  } | undefined;
  if (scales?.x?.ticks) {
    scales.x.ticks.maxTicksLimit = getTrendMaxTicks(data.length);
  }
  chartInstance.update('none');
};

// 加载趋势数据；请求序号防护：快速切换范围时，过期响应不得覆盖新数据
let trendRequestSeq = 0;

const loadTrends = async (days: TrendRangeKey) => {
  const requestSeq = ++trendRequestSeq;
  trendsLoadError.value = '';
  const cached = trendCache.get(days);
  if (cached) {
    trends.value = cached.trends;
    trendRangeMeta.value = cached.range;
    await nextTick();
    if (trendChart.value && trends.value.length > 0) {
      if (chartInstance) {
        updateTrendChart(trends.value);
      } else {
        const ctx = trendChart.value.getContext('2d');
        if (ctx) createTrendChart(ctx, trends.value);
      }
    } else if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }

  try {
    const query = days === 0 ? 'range=all' : `days=${days}`;
    const response = await request.get(`/state/trends?${query}`);
    if (requestSeq !== trendRequestSeq) return; // 已有更新的请求，丢弃过期响应
    const payload = response.data as TrendResponsePayload;
    trends.value = payload.trends || [];
    trendRangeMeta.value = payload.range || null;
    if (trendRangeMeta.value) {
      trendCache.set(days, {
        trends: trends.value,
        range: trendRangeMeta.value,
      });
    }
    await nextTick();

    // 更新图表（仅首次创建，后续只更新数据）
    if (trendChart.value && trends.value.length > 0) {
      if (chartInstance) {
        updateTrendChart(trends.value);
      } else {
        const ctx = trendChart.value.getContext('2d');
        if (ctx) createTrendChart(ctx, trends.value);
      }
    } else if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  } catch (error: any) {
    if (requestSeq !== trendRequestSeq) return; // 过期请求的错误也不写回
    trends.value = [];
    trendRangeMeta.value = null;
    trendsLoadError.value = error.response?.data?.error?.message || '无法读取趋势数据，请稍后重试。';
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    toast.error(error.response?.data?.error?.message || '加载趋势数据失败');
  }
};

const refreshStatePage = async (options?: { forceTrends?: boolean }) => {
  loading.value = true;
  if (options?.forceTrends) {
    trendCache.clear();
  }

  await Promise.all([
    loadCurrentState(),
    loadTrends(trendDays.value),
    loadLearnerCenter()
  ]);
  loading.value = false;
};

// 加载预警信息
const loadWarnings = async () => {
  try {
    const response = await request.get('/state/warnings');
    warnings.value = response.data?.warnings || [];
  } catch (error: unknown) {
    console.error('加载预警信息失败:', error);
  }
};

const loadLearnerCenter = async () => {
  try {
    learnerCenter.value = await userAPI.getLearnerCenter({ scope: 'global' });
  } catch (error) {
    console.error('加载学习档案失败:', error);
  }
};

const formatStateDateTime = (value?: string) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

// get level types
const getLSBValueClass = (lsb: number) => {
  if (lsb < 0) return 'value-danger';
  if (lsb < 20) return 'value-warning';
  if (lsb >= 40) return 'value-success';
  return 'value-primary';
};

const getLSBText = (lsb: number) => {
  if (lsb < 0) return '建议先休息';
  if (lsb < 20) return '适合轻量学习';
  if (lsb >= 40) return '适合继续推进';
  return '保持当前节奏';
};

const getLSSValueClass = (lss: number) => {
  if (lss > 70) return 'value-danger';
  if (lss > 50) return 'value-warning';
  if (lss < 30) return 'value-success';
  return 'value-primary';
};

const getLFValueClass = (lf: number) => {
  if (lf > 70) return 'value-danger';
  if (lf > 40) return 'value-warning';
  return 'value-success';
};

// 监听trendDays变化
watch(trendDays, (newDays) => {
  loadTrends(newDays);
});

// 延迟任务句柄：卸载时需取消，避免销毁后仍执行 loadWarnings
let warningsIdleHandle: number | null = null;
let warningsTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  const init = async () => {
    if (isProjectionMode()) {
      try {
        await userStore.fetchProfile();
      } catch (error) {
        console.error('获取投影视角用户信息失败:', error);
      }
    }

    await refreshStatePage();

    // 预警放到首屏之后，降低图表首屏阻塞
    if ('requestIdleCallback' in window) {
      warningsIdleHandle = window.requestIdleCallback(() => {
        loadWarnings();
      }, { timeout: 800 });
    } else {
      warningsTimeoutHandle = setTimeout(() => {
        loadWarnings();
      }, 120);
    }
  };

  init();

  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  if (warningsIdleHandle !== null && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(warningsIdleHandle);
  }
  if (warningsTimeoutHandle !== null) {
    clearTimeout(warningsTimeoutHandle);
  }
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.learning-state-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: #f3f6fb;
  position: relative;
  overflow-x: hidden;
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
  filter: blur(110px);
  opacity: 0.24;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 720px;
  height: 720px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.28), transparent 70%);
  top: -220px;
  right: -120px;
}

.gradient-orb-2 {
  width: 540px;
  height: 540px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
  bottom: -180px;
  left: -80px;
  animation-delay: -10s;
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
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.05);
  transition: all 0.3s ease;
}

.header-scrolled,
.dashboard-header--scrolled {
  background: rgba(255, 255, 255, 0.88);
  border-bottom-color: rgba(23, 32, 51, 0.06);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
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
  padding: 28px 0 72px;
}

.content-container {
  width: 100%;
}

/* ========== 玻璃卡片 ========== */
.glass-card {
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: var(--radius-2xl);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.05);
}

[data-theme="dark"] .glass-card {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ========== 页面标题区 ========== */
.page-header-section {
  padding: 2rem 2.5rem;
  margin-bottom: 2rem;
}

.page-header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
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

.state-page-shell {
  margin-bottom: 18px;
}

.app-page-head {
  padding: 24px 28px;
  display: grid;
  gap: 18px;
}

.app-page-head__top,
.app-page-head__actions,
.state-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.app-page-head__intro {
  display: grid;
  gap: 10px;
}

.app-page-head__intro h1 {
  margin: 0;
  font-size: clamp(30px, 3.8vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.04em;
  color: #172033;
}

.app-page-head__intro p,
.state-metric-card p,
.state-insight-card p,
.state-warning-item p,
.state-definition-item p,
.state-category-item p {
  margin: 0;
  color: color-mix(in srgb, #172033 72%, #fff);
  line-height: 1.7;
}

.app-page-head__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.app-page-head__summary-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.84);
}

.app-page-head__summary-card span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.app-page-head__summary-card strong {
  font-size: 28px;
  line-height: 1.05;
  color: #172033;
}

.app-page-head__summary-card p {
  font-size: 13px;
}

.pill,
.section-kicker,
.state-insight-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.pill,
.section-kicker {
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.state-insight-card__badge {
  background: rgba(243, 246, 251, 0.92);
  color: var(--text-muted);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.82);
  color: #172033;
  border: 1px solid rgba(52, 120, 246, 0.08);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
}

.btn-ghost:hover {
  background: rgba(243, 246, 251, 0.92);
}

.state-content-inner {
  display: grid;
  gap: 18px;
}

.state-metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.state-metric-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 18px;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.04);
  transition: transform 0.28s ease, box-shadow 0.28s ease, border-color 0.28s ease;
}

.state-metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 24px 52px rgba(15, 23, 42, 0.08);
}

.state-metric-card span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.state-metric-card strong {
  font-size: 32px;
  line-height: 1;
  color: #172033;
}

.state-metric-card--lsb {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.86));
  border-color: rgba(52, 120, 246, 0.12);
}

.state-metric-card--lss {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.86));
  border-color: rgba(245, 158, 11, 0.12);
}

.state-metric-card--ktl {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.08), rgba(255, 255, 255, 0.86));
  border-color: rgba(49, 177, 111, 0.12);
}

.state-metric-card--lf {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.08), rgba(255, 255, 255, 0.86));
  border-color: rgba(141, 107, 255, 0.12);
}

.state-hero__summary-card--lsb {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.9));
}

.state-hero__summary-card--lss {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.9));
}

.state-hero__summary-card--ktl {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.08), rgba(255, 255, 255, 0.9));
}

.state-hero__summary-card--lf {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.08), rgba(255, 255, 255, 0.9));
}

.state-hero__actions-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.state-hero__actions-strip--stacked {
  grid-template-columns: 1fr;
}

.state-hero__action-card {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(52, 120, 246, 0.08);
  text-decoration: none;
  color: #172033;
  transition: transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease;
}

.state-hero__action-card:hover {
  transform: translateY(-2px);
  border-color: rgba(52, 120, 246, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.06);
}

.state-hero__action-card strong {
  font-size: 14px;
}

.state-hero__action-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.state-hero__action-card span {
  color: #1f57cc;
  font-size: 12px;
  font-weight: 700;
}

.state-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

.state-main-followups {
  display: grid;
  gap: 18px;
  grid-column: 1 / 2;
}

.state-trend-panel,
.state-side-panels,
.state-insight-card {
  display: grid;
  gap: 16px;
}

.state-trend-panel {
  grid-column: 1 / -1;
  padding: 22px;
  background:
    radial-gradient(circle at top left, rgba(52, 120, 246, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.9));
  border: 1px solid rgba(52, 120, 246, 0.1);
  border-radius: 24px;
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.06);
}

.state-panel__head--trend {
  align-items: flex-start;
  flex-wrap: wrap;
}

.state-trend-panel__intro {
  display: grid;
  gap: 8px;
  max-width: 760px;
}

.state-trend-panel__intro p {
  margin: 0;
  color: #5b6880;
  font-size: 14px;
  line-height: 1.75;
}

.state-trend-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.state-trend-summary-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.state-trend-summary-card span {
  font-size: 12px;
  font-weight: 700;
  color: #6d7a90;
}

.state-trend-summary-card strong {
  font-size: 24px;
  line-height: 1.1;
  color: #172033;
}

.state-trend-summary-card p {
  margin: 0;
  color: #5b6880;
  font-size: 13px;
  line-height: 1.6;
}

.state-trend-summary-card--primary {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.88));
}

.state-trend-summary-card--success {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.1), rgba(255, 255, 255, 0.88));
}

.state-trend-summary-card--warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.1), rgba(255, 255, 255, 0.88));
}

.state-trend-chart-shell {
  display: grid;
  gap: 12px;
}

.state-trend-chart-head {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
  gap: 12px;
}

.state-trend-chart-head__block {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.state-trend-chart-head__block--compact {
  background: rgba(52, 120, 246, 0.07);
}

.state-trend-chart-head__block span {
  font-size: 12px;
  font-weight: 700;
  color: #6d7a90;
}

.state-trend-chart-head__block strong {
  font-size: 16px;
  color: #172033;
}

.state-trend-chart-head__block p {
  margin: 0;
  color: #5b6880;
  font-size: 13px;
  line-height: 1.6;
}

.state-trend-panel h2,
.state-insight-card__title {
  margin: 0;
  color: #172033;
}

.state-panel__head h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.14;
}

.state-side-panels {
  grid-column: 2 / 3;
  position: sticky;
  top: 104px;
}

.state-insight-card {
  padding: 20px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 18px;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.04);
}

.state-insight-card--primary {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.9));
  border-color: rgba(52, 120, 246, 0.12);
}

.state-insight-card--warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.9));
  border-color: rgba(245, 158, 11, 0.12);
}

.state-insight-card__summary {
  margin: -4px 0 0;
  color: #8a5300;
  font-size: 13px;
  line-height: 1.7;
}

.state-warning-list,
.state-definition-list,
.state-category-list {
  display: grid;
  gap: 12px;
}

.state-warning-item,
.state-definition-item,
.state-category-item {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.state-warning-item strong,
.state-definition-item strong,
.state-category-item strong {
  font-size: 15px;
  color: #172033;
}

.state-category-item.category-danger {
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.05), rgba(255, 255, 255, 0.9));
  border-color: rgba(239, 68, 68, 0.14);
}

.state-category-item.category-warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.05), rgba(255, 255, 255, 0.9));
  border-color: rgba(245, 158, 11, 0.16);
}

.state-category-item.category-success {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.05), rgba(255, 255, 255, 0.9));
  border-color: rgba(49, 177, 111, 0.16);
}

.trend-controls--pill {
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
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
  background: linear-gradient(135deg, #3478f6 0%, #1f57cc 100%);
  color: white;
  box-shadow: 0 10px 28px rgba(52, 120, 246, 0.22);
}

.btn-primary:hover {
  box-shadow: 0 14px 34px rgba(52, 120, 246, 0.28);
  transform: translateY(-2px);
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

.empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

@media (max-width: 720px) {
  .empty-state__actions {
    width: 100%;
  }

  .empty-state__actions .btn {
    width: 100%;
    justify-content: center;
  }
}

/* ========== Section 通用样式 ========== */
section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-icon {
  font-size: 1.5rem;
}

/* ========== 指标卡片网格 ========== */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

@media (max-width: 1200px) {
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .metrics-grid {
    grid-template-columns: 1fr;
  }
}

.metric-card {
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.metric-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.metric-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: white;
}

.icon-lsb {
  background: var(--gradient-primary);
}

.icon-lss {
  background: var(--gradient-danger);
}

.icon-ktl {
  background: var(--gradient-success);
}

.icon-lf {
  background: var(--gradient-warning);
}

.metric-card-body {
  text-align: center;
}

.metric-value {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 0.5rem;
}

.value-primary {
  color: var(--color-primary);
}

.value-success {
  color: var(--color-success);
}

.value-warning {
  color: var(--color-warning);
}

.value-danger {
  color: var(--color-danger);
}

.value-ktl {
  color: var(--color-success);
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.metric-desc {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
  margin-top: 0.75rem;
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.metric-formula {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-muted);
  border-radius: var(--radius-lg);
  margin-top: 0.75rem;
  font-weight: 600;
  font-size: 0.9375rem;
}

.formula-part {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
}

.formula-part.ktl {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--text-on-success-light);
}

.formula-part.lf {
  background: var(--color-efficient-bg);
  border: 1px solid var(--color-efficient-border);
  color: var(--text-on-warning-light);
}

.formula-op {
  color: var(--text-muted);
}

/* ========== 预警卡片 ========== */
.warnings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

@media (max-width: 768px) {
  .warnings-grid {
    grid-template-columns: 1fr;
  }
}

.warning-card {
  padding: 1.25rem;
  transition: all 0.3s ease;
}

.warning-card:hover {
  transform: translateX(4px);
}

.warning-critical {
  border-left: 4px solid var(--color-danger);
}

.warning-warning {
  border-left: 4px solid var(--color-warning);
}

.warning-info {
  border-left: 4px solid var(--color-info);
}

.warning-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.warning-title {
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}

.warning-message {
  margin: 0 0 0.5rem 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.warning-suggestion {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border-light);
}

/* ========== 建议区域 ========== */
.suggestion-main {
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.suggestion-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-primary);
  margin: 0 0 0.75rem 0;
}

.suggestion-action {
  margin: 0;
  padding: 0.875rem 1rem;
  background: var(--bg-muted);
  border: 1px solid var(--border-default);
  border-left: 4px solid var(--color-accent);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-size: 0.9375rem;
}

.suggestion-categories {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

@media (max-width: 1200px) {
  .suggestion-categories {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .suggestion-categories {
    grid-template-columns: 1fr;
  }
}

.category-card {
  padding: 1.25rem;
  transition: all 0.3s ease;
}

.category-card:hover {
  transform: translateY(-2px);
}

.category-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.category-icon {
  font-size: 1.25rem;
}

.category-name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.category-message {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.category-danger {
  border-left: 4px solid var(--color-danger);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
}

.category-warning {
  border-left: 4px solid var(--color-warning);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
}

.category-normal {
  border-left: 4px solid var(--color-info);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
}

.category-success {
  border-left: 4px solid var(--color-success);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
}

/* ========== 趋势图表 ========== */
.trend-controls {
  display: flex;
  gap: 0.5rem;
}

.trend-btn {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: #172033;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;
  white-space: nowrap;
}

.trend-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(52, 120, 246, 0.24);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
}

.trend-btn.active {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.16), rgba(31, 87, 204, 0.12));
  border-color: rgba(52, 120, 246, 0.22);
  color: #1f57cc;
}

.trends-card {
  padding: 1.5rem;
}

.state-trends-card {
  padding: 16px 18px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(52, 120, 246, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.chart-container--state {
  position: relative;
  min-height: 380px;
  height: 380px;
  width: 100%;
  padding: 6px 4px 0;
}

.chart-empty {
  min-height: 240px;
  display: grid;
  place-items: center;
  padding: 2.5rem;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px dashed rgba(52, 120, 246, 0.18);
}

/* ========== 指标说明 ========== */
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}

.info-grid--compact {
  grid-template-columns: 1fr;
  gap: 0.625rem;
}

@media (max-width: 768px) {
  .info-grid {
    grid-template-columns: 1fr;
  }
}

.info-card {
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: all 0.3s ease;
}

.info-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.info-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.info-icon {
  font-size: 1.125rem;
}

.info-title {
  font-size: 0.94rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.info-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin: 0 0 0.5rem 0;
}

.info-badges {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.info-badge {
  padding: 0.22rem 0.5rem;
  border-radius: var(--radius-full);
  font-size: 0.69rem;
  font-weight: 600;
  border: 1px solid transparent;
  line-height: 1.1;
}

.info-badges--lss .info-badge.high {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-dark);
}

.info-badges--lss .info-badge.medium {
  background: var(--color-efficient-bg);
  border-color: var(--color-efficient-border);
  color: var(--color-efficient-dark);
}

.info-badges--lss .info-badge.low {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--neutral-900);
}

.info-badges--ktl .info-badge.high {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--color-success-dark);
}

.info-badges--ktl .info-badge.medium {
  background: var(--color-efficient-bg);
  border-color: var(--color-efficient-border);
  color: var(--color-efficient-dark);
}

.info-badges--ktl .info-badge.low {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-dark);
}

.info-badges--lf .info-badge.high {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-dark);
}

.info-badges--lf .info-badge.medium {
  background: var(--color-efficient-bg);
  border-color: var(--color-efficient-border);
  color: var(--color-efficient-dark);
}

.info-badges--lf .info-badge.low {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--neutral-900);
}

.info-card--lsb {
  grid-column: 1 / -1;
}

.info-grid--compact .info-card--lsb {
  grid-column: auto;
}

.lsb-visual {
  margin-top: 0.5rem;
}

.lsb-bar {
  display: flex;
  height: 24px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 0.45rem;
}

.lsb-negative {
  flex: 1;
  background: var(--color-danger);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 600;
}

.lsb-zero {
  width: 32px;
  background: var(--text-muted);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
}

.lsb-positive {
  flex: 1;
  background: var(--color-success);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 600;
}

.lsb-legend {
  display: flex;
  justify-content: center;
  gap: 0.9rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
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

  .app-page-head {
    padding: 18px;
  }

  .app-page-head__top,
  .app-page-head__actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .state-metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .app-page-head__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-layout {
    grid-template-columns: 1fr;
  }

  .state-trend-panel,
  .state-main-followups,
  .state-side-panels {
    grid-column: auto;
  }

  .state-panel__head--trend {
    flex-direction: column;
    align-items: flex-start;
  }

  .trend-controls--pill {
    width: 100%;
    justify-content: flex-start;
  }

  .state-trend-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-trend-chart-head {
    grid-template-columns: 1fr;
  }

  .state-main-followups {
    order: 2;
  }

  .state-side-panels {
    order: 3;
    position: static;
  }

  .path-detail-overview-grid,
  .state-definition-list,
  .state-warning-list,
  .state-category-list {
    grid-template-columns: 1fr;
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

  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .suggestion-categories {
    grid-template-columns: 1fr;
  }

  .info-grid {
    grid-template-columns: 1fr;
  }

  .warnings-grid {
    grid-template-columns: 1fr;
  }

  .chart-container--state {
    min-height: 300px;
    height: 300px;
  }

}

@media (max-width: 640px) {
  .header-container {
    padding: 0.9rem 1rem;
    gap: 0.75rem;
  }

  .header-left,
  .header-right {
    min-width: 0;
  }

  .app-page-head,
  .state-trend-panel,
  .state-overview-card,
  .state-metrics-card,
  .state-side-card,
  .trends-card,
  .info-panel,
  .state-warning-card,
  .state-category-card,
  .state-definition-card {
    padding: 16px;
    border-radius: 20px;
  }

  .state-metrics-grid,
  .app-page-head__summary,
  .state-trend-summary {
    grid-template-columns: 1fr;
  }

  .state-trend-chart-head__block {
    padding: 14px 16px;
  }

  .app-page-head__actions {
    width: 100%;
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

  .app-page-head__actions > * {
    flex: 1 1 100%;
  }

  .chart-container--state {
    min-height: 260px;
    height: 260px;
  }
}
</style>
