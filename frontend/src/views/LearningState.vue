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
        <button type="button" class="brand" @click="router.push('/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="应用导航">
          <router-link to="/dashboard" class="nav-item">学习台</router-link>
          <router-link to="/goal-conversation" class="nav-item">AI 规划</router-link>
          <router-link to="/learning-paths" class="nav-item">学习路径</router-link>
          <router-link to="/learning-state" class="nav-item nav-item--active">学习状态</router-link>
          <router-link to="/achievements" class="nav-item">成就</router-link>
        </nav>

        <div class="header-right">
          <router-link to="/goal-conversation" class="header-cta">开始新目标</router-link>
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

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="content-container">
        <section class="state-page-shell">
          <section class="app-page-head glass-card state-hero">
            <div class="app-page-head__top">
              <span class="pill">学习状态</span>
              <div class="app-page-head__actions">
                <router-link to="/learning-paths" class="btn btn-primary">查看学习路径</router-link>
                <router-link to="/dashboard" class="btn btn-ghost">回到学习台</router-link>
              </div>
            </div>

            <div class="app-page-head__intro">
              <h1>看清你的节奏、压力、理解和疲劳，决定下一步怎么学。</h1>
              <p>这里展示完整的状态分析，不只是一个结论。你可以看到当前指标、近期变化以及更适合你的学习建议。</p>
            </div>

            <div v-if="state" class="app-page-head__summary state-hero__summary">
              <article v-for="item in stateMetricCards" :key="item.label" class="app-page-head__summary-card state-hero__summary-card" :class="`state-hero__summary-card--${item.tone}`">
                <span>{{ item.label }}</span>
                <strong :class="item.valueClass">{{ item.value }}</strong>
                <p>{{ item.note }}</p>
              </article>
            </div>
          </section>
        </section>

        <div v-loading="loading" class="state-content">
          <!-- 空状态 -->
          <div v-if="!state" class="empty-state glass-card">
            <div class="empty-icon">📈</div>
            <h3 class="empty-title">暂无学习数据</h3>
            <p class="empty-desc">先完成一个任务，开始追踪你的学习状态吧！</p>
            <router-link to="/learning-paths" class="btn btn-primary">
              <el-icon><FolderOpened /></el-icon>
              查看学习路径
            </router-link>
          </div>

          <div v-else class="state-content-inner">
            <section class="state-layout">
              <article class="glass-card state-trend-panel">
                <div class="state-panel__head">
                  <div>
                    <span class="section-kicker">趋势图</span>
                    <h2>最近状态变化</h2>
                  </div>
                  <div class="trend-controls trend-controls--pill">
                    <button class="trend-btn" :class="{ active: trendDays === 7 }" @click="trendDays = 7">7天</button>
                    <button class="trend-btn" :class="{ active: trendDays === 30 }" @click="trendDays = 30">30天</button>
                  </div>
                </div>

                <div v-if="trends.length > 0" class="trends-card state-trends-card">
                  <div class="chart-container chart-container--state">
                    <canvas ref="trendChart"></canvas>
                  </div>
                </div>
                <div v-else class="trends-card chart-empty">
                  <el-empty description="暂无趋势数据" />
                </div>
              </article>

              <aside class="state-side-panels">
                <article v-if="warnings.length > 0" class="glass-card state-insight-card state-insight-card--warning">
                  <div class="state-panel__head">
                    <span class="section-kicker">学习预警</span>
                    <span class="state-insight-card__badge">{{ warnings.length }} 条</span>
                  </div>
                  <div class="state-warning-list">
                    <div v-for="(warning, index) in warnings.slice(0, 3)" :key="index" class="state-warning-item">
                      <strong>{{ warning.title }}</strong>
                      <p>{{ warning.message }}</p>
                    </div>
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
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import request from '../utils/request';
import { metricsAPI } from '../api/metrics';
import { Chart } from 'chart.js/auto';
import { useUserStore } from '../stores/user';
import {
  User,
  Switch,
} from '@element-plus/icons-vue';

const router = useRouter();
const userStore = useUserStore();

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const scrolled = ref(false);
const loading = ref(true);
const state = ref<StateMetrics | null>(null);
const trends = ref<TrendData[]>([]);
const trendDays = ref(7);
const trendChart = ref<HTMLCanvasElement | null>(null);
const warnings = ref<Array<{
  type: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  suggestion: string;
}>>([]);
let chartInstance: Chart | null = null;
const trendCache = new Map<number, TrendData[]>();

const stateMetricCards = computed(() => {
  if (!state.value) return [];

  return [
    {
      label: 'LSB 学习状态',
      value: state.value.lsb.toFixed(2),
      note: `状态判断：${getLSBText(state.value.lsb)}`,
      tone: 'lsb',
      valueClass: getLSBValueClass(state.value.lsb)
    },
    {
      label: 'LSS 学习压力',
      value: state.value.lss.toFixed(2),
      note: '单次学习的即时压力评分',
      tone: 'lss',
      valueClass: getLSSValueClass(state.value.lss)
    },
    {
      label: 'KTL 知识掌握',
      value: state.value.ktl.toFixed(2),
      note: '42 天加权平均后的长期掌握度',
      tone: 'ktl',
      valueClass: 'value-primary'
    },
    {
      label: 'LF 学习疲劳',
      value: state.value.lf.toFixed(2),
      note: '7 天短期疲劳水平',
      tone: 'lf',
      valueClass: getLFValueClass(state.value.lf)
    }
  ];
});

const stateDefinitionCards = computed(() => {
  return [
    { title: 'LSS 学习压力', desc: '单次学习的压力评分，范围 0-100。高值表示认知负荷更高。' },
    { title: 'KTL 知识掌握', desc: '长期知识积累的量化指标，使用 42 天加权平均计算。' },
    { title: 'LF 学习疲劳', desc: '短期疲劳程度，使用 7 天加权平均计算，随时间衰减。' },
    { title: 'LSB 状态平衡值', desc: '核心指标，计算公式为 LSB = KTL - LF，用来判断当前推进状态。' }
  ];
});

interface StateMetrics {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  suggestion?: {
    level: 'critical' | 'warning' | 'normal' | 'optimal';
    message: string;
    action: string;
    categories?: {
      pressure: { status: string; message: string };
      state: { status: string; message: string };
      growth: { status: string; message: string };
      duration: { status: string; message: string };
    };
  };
}

interface TrendData {
  date: Date;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
}

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
    state.value = await metricsAPI.getCurrentState();
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载学习状态失败');
  } finally {
    loading.value = false;
  }
};

const createTrendChart = (ctx: CanvasRenderingContext2D, data: TrendData[]) => {
  const labels = data.map(item => {
    return new Date(item.date).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric'
    });
  });

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
          label: 'LSS (压力)',
          data: data.map(item => item.lss),
          borderColor: '#ef4444',
          backgroundColor: createGradient('rgba(239, 68, 68, 1)'),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'KTL (知识)',
          data: data.map(item => item.ktl),
          borderColor: '#4f46e5',
          backgroundColor: createGradient('rgba(79, 70, 229, 1)'),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'LF (疲劳)',
          data: data.map(item => item.lf),
          borderColor: '#f59e0b',
          backgroundColor: createGradient('rgba(245, 158, 11, 1)'),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'LSB (状态)',
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
          beginAtZero: true,
          suggestedMax: 100,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
            drawBorder: false,
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
        },
      },
    },
  });
};

const updateTrendChart = (data: TrendData[]) => {
  if (!chartInstance) return;
  const labels = data.map(item => {
    return new Date(item.date).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric'
    });
  });

  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = data.map(item => item.lss);
  chartInstance.data.datasets[1].data = data.map(item => item.ktl);
  chartInstance.data.datasets[2].data = data.map(item => item.lf);
  chartInstance.data.datasets[3].data = data.map(item => item.lsb);
  chartInstance.update('none');
};

// 加载趋势数据
const loadTrends = async (days: number) => {
  const cached = trendCache.get(days);
  if (cached) {
    trends.value = cached;
    await nextTick();
    if (trendChart.value && trends.value.length > 0) {
      if (chartInstance) {
        updateTrendChart(trends.value);
      } else {
        const ctx = trendChart.value.getContext('2d');
        if (ctx) createTrendChart(ctx, trends.value);
      }
    }
    return;
  }

  try {
    const response = await request.get(`/state/trends?days=${days}`);
    trends.value = response.data.data.trends;
    trendCache.set(days, trends.value);
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
    toast.error(error.response?.data?.error?.message || '加载趋势数据失败');
  }
};

// 加载预警信息
const loadWarnings = async () => {
  try {
    const response = await request.get('/state/warnings');
    warnings.value = response.data.data.warnings || [];
  } catch (error: any) {
    console.error('加载预警信息失败:', error);
  }
};

// get level types
const getLSBValueClass = (lsb: number) => {
  if (lsb < 0) return 'value-danger';
  if (lsb < 20) return 'value-warning';
  if (lsb >= 40) return 'value-success';
  return 'value-primary';
};

const getLSBText = (lsb: number) => {
  if (lsb < 0) return '疲劳';
  if (lsb < 20) return '偏低';
  if (lsb >= 40) return '高效';
  return '正常';
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

onMounted(() => {
  const init = async () => {
    loading.value = true;
    await Promise.all([
      loadCurrentState(),
      loadTrends(trendDays.value)
    ]);
    loading.value = false;

    // 预警放到首屏之后，降低图表首屏阻塞
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        loadWarnings();
      }, { timeout: 800 });
    } else {
      setTimeout(() => {
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
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.learning-state-page {
  min-height: 100vh;
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

.state-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

.state-trend-panel,
.state-side-panels,
.state-insight-card {
  display: grid;
  gap: 16px;
}

.state-trend-panel {
  padding: 22px;
  background: rgba(255, 255, 255, 0.8);
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
}

.trend-btn {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.82);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: #172033;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.03);
}

.trend-btn.active {
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.18);
  color: #1f57cc;
}

.state-trends-card {
  padding: 14px;
  border-radius: 20px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.chart-container--state {
  min-height: 360px;
  padding: 10px 8px 2px;
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
.trends-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
  gap: 1.25rem;
  align-items: stretch;
  --panel-height: 520px;
}

.trends-main,
.info-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.info-side {
  position: sticky;
  top: 88px;
}

.info-side .section-header {
  margin-bottom: 0.75rem;
}

.info-panel {
  padding: 0.75rem;
  height: var(--panel-height);
  overflow-y: auto;
}

.trend-controls {
  display: flex;
  gap: 0.5rem;
}

.trend-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
  border-radius: var(--radius-lg);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.trend-btn:hover {
  border-color: var(--color-primary);
  background: var(--bg-muted);
  color: var(--text-primary);
}

.trend-btn.active {
  background: var(--gradient-primary);
  border-color: transparent;
  color: white;
}

.trends-card {
  padding: 1.5rem;
  height: var(--panel-height);
}

.chart-container {
  position: relative;
  height: calc(var(--panel-height) - 3rem);
  width: 100%;
}

.chart-empty {
  padding: 3rem;
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

  .state-side-panels {
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

  .trends-layout {
    grid-template-columns: 1fr;
    --panel-height: auto;
  }

  .info-side {
    position: static;
  }

  .trends-card,
  .info-panel {
    height: auto;
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

  .chart-container {
    height: 300px;
  }
}
</style>
