<template>
  <div class="learning-state-page">
    <!-- 动态背景 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="dashboard-header" :class="{ 'header-scrolled': scrolled }">
      <div class="header-container">
        <div class="header-left">
          <div class="brand" @click="$router.push('/dashboard')">
            <span class="brand-icon">🎓</span>
            <span class="brand-text">AI 学习平台</span>
          </div>
        </div>

        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-item">
            <el-icon><HomeFilled /></el-icon>
            <span>学习台</span>
          </router-link>
          <router-link to="/goal-conversation" class="nav-item">
            <el-icon><EditPen /></el-icon>
            <span>AI 规划</span>
          </router-link>
          <router-link to="/learning-paths" class="nav-item">
            <el-icon><FolderOpened /></el-icon>
            <span>学习路径</span>
          </router-link>
          <router-link to="/learning-state" class="nav-item nav-item-active">
            <el-icon><TrendCharts /></el-icon>
            <span>学习状态</span>
          </router-link>
          <router-link to="/achievements" class="nav-item">
            <el-icon><Trophy /></el-icon>
            <span>成就</span>
          </router-link>
        </nav>

        <div class="header-right">
          <ThemeSwitcher />

          <div class="user-menu">
            <el-dropdown>
              <div class="user-avatar">
                <img v-if="userStore.user?.avatarUrl" :src="userStore.user.avatarUrl" alt="avatar" />
                <div v-else class="avatar-placeholder">
                  {{ userStore.user?.name?.charAt(0) || 'U' }}
                </div>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item>
                    <span class="user-name">{{ userStore.user?.name || '用户' }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item @click="$router.push('/user')">
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
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="content-container">
        <!-- 页面标题区 -->
        <section class="page-header-section glass-card">
          <div class="page-header-content">
            <div class="page-title-wrapper">
              <h1 class="page-title">
                <span class="title-icon">📊</span>
                学习状态追踪
              </h1>
              <p class="page-subtitle">科学量化你的学习状态和效率</p>
            </div>
          </div>
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
            <!-- 主要指标卡片 -->
            <section class="metrics-section">
              <div class="metrics-grid">
                <!-- LSB 状态值卡片 -->
                <div class="metric-card glass-card metric-card--lsb">
                  <div class="metric-card-header">
                    <div class="metric-icon icon-lsb">
                      <el-icon><ScaleToOriginal /></el-icon>
                    </div>
                    <el-tag :type="getLSBLevel(state.lsb)" size="small" effect="light">
                      {{ getLSBText(state.lsb) }}
                    </el-tag>
                  </div>
                  <div class="metric-card-body">
                    <div class="metric-value" :class="getLSBValueClass(state.lsb)">
                      {{ state.lsb.toFixed(2) }}
                    </div>
                    <div class="metric-label">LSB 状态值</div>
                    <div class="metric-formula">
                      <span class="formula-part ktl">{{ state.ktl.toFixed(2) }}</span>
                      <span class="formula-op">−</span>
                      <span class="formula-part lf">{{ state.lf.toFixed(2) }}</span>
                    </div>
                  </div>
                </div>

                <!-- LSS 学习压力卡片 -->
                <div class="metric-card glass-card metric-card--lss">
                  <div class="metric-card-header">
                    <div class="metric-icon icon-lss">
                      <el-icon><Warning /></el-icon>
                    </div>
                    <el-tag :type="getLSSLevel(state.lss)" size="small" effect="light">
                      {{ state.lss.toFixed(1) }}/100
                    </el-tag>
                  </div>
                  <div class="metric-card-body">
                    <div class="metric-value" :class="getLSSValueClass(state.lss)">
                      {{ state.lss.toFixed(2) }}
                    </div>
                    <div class="metric-label">LSS 学习压力</div>
                    <div class="metric-desc">本次学习压力评分（0-100）</div>
                  </div>
                </div>

                <!-- KTL 知识掌握卡片 -->
                <div class="metric-card glass-card metric-card--ktl">
                  <div class="metric-card-header">
                    <div class="metric-icon icon-ktl">
                      <el-icon><Reading /></el-icon>
                    </div>
                    <el-tag type="info" size="small" effect="light">EWMA</el-tag>
                  </div>
                  <div class="metric-card-body">
                    <div class="metric-value value-ktl">{{ state.ktl.toFixed(2) }}</div>
                    <div class="metric-label">KTL 知识掌握</div>
                    <div class="metric-desc">42天加权平均</div>
                  </div>
                </div>

                <!-- LF 学习疲劳卡片 -->
                <div class="metric-card glass-card metric-card--lf">
                  <div class="metric-card-header">
                    <div class="metric-icon icon-lf">
                      <el-icon><Timer /></el-icon>
                    </div>
                    <el-tag :type="getLFLevel(state.lf)" size="small" effect="light">
                      {{ state.lf.toFixed(1) }}
                    </el-tag>
                  </div>
                  <div class="metric-card-body">
                    <div class="metric-value" :class="getLFValueClass(state.lf)">
                      {{ state.lf.toFixed(2) }}
                    </div>
                    <div class="metric-label">LF 学习疲劳</div>
                    <div class="metric-desc">7天短期平均</div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 学习预警 -->
            <section v-if="warnings.length > 0" class="warnings-section">
              <div class="section-header">
                <h2 class="section-title">
                  <span class="section-icon">⚠️</span>
                  学习预警
                </h2>
                <el-tag type="danger" size="small">{{ warnings.length }} 条预警</el-tag>
              </div>
              <div class="warnings-grid">
                <div
                  v-for="(warning, index) in warnings"
                  :key="index"
                  class="warning-card glass-card"
                  :class="'warning-' + warning.level"
                >
                  <div class="warning-header">
                    <span class="warning-title">{{ warning.title }}</span>
                    <el-tag
                      :type="warning.level === 'critical' ? 'danger' : warning.level === 'warning' ? 'warning' : 'info'"
                      size="small"
                      effect="light"
                    >
                      {{ warning.level === 'critical' ? '紧急' : warning.level === 'warning' ? '警告' : '提示' }}
                    </el-tag>
                  </div>
                  <p class="warning-message">{{ warning.message }}</p>
                  <p class="warning-suggestion">💡 {{ warning.suggestion }}</p>
                </div>
              </div>
            </section>

            <!-- 学习建议 -->
            <section v-if="state.suggestion" class="suggestion-section">
              <div class="section-header">
                <h2 class="section-title">
                  <span class="section-icon">💡</span>
                  智能学习建议
                </h2>
                <el-tag :type="getSuggestionTagType(state.suggestion.level)" effect="light">
                  {{ getSuggestionLevelText(state.suggestion.level) }}
                </el-tag>
              </div>

              <div class="suggestion-main glass-card">
                <h3 class="suggestion-title">{{ state.suggestion.message }}</h3>
                <p class="suggestion-action">建议操作：{{ state.suggestion.action }}</p>
              </div>

              <!-- 四类详细建议 -->
              <div v-if="state.suggestion.categories" class="suggestion-categories">
                <div
                  v-for="(category, key) in state.suggestion.categories"
                  :key="key"
                  class="category-card glass-card"
                  :class="getCategoryClass(category.status)"
                >
                  <div class="category-header">
                    <span class="category-icon">{{ getCategoryIcon(key) }}</span>
                    <span class="category-name">{{ getCategoryName(key) }}</span>
                  </div>
                  <p class="category-message">{{ category.message }}</p>
                </div>
              </div>
            </section>

            <!-- 学习趋势 + 指标说明（并排） -->
            <section class="trends-section">
              <div class="trends-layout">
                <div class="trends-main">
                  <div class="section-header">
                    <h2 class="section-title">
                      <span class="section-icon">📈</span>
                      学习趋势
                    </h2>
                    <div class="trend-controls">
                      <button
                        class="trend-btn"
                        :class="{ active: trendDays === 7 }"
                        @click="trendDays = 7"
                      >
                        7天
                      </button>
                      <button
                        class="trend-btn"
                        :class="{ active: trendDays === 30 }"
                        @click="trendDays = 30"
                      >
                        30天
                      </button>
                    </div>
                  </div>

                  <div class="trends-card glass-card">
                    <div v-if="trends.length > 0" class="chart-container">
                      <canvas ref="trendChart"></canvas>
                    </div>
                    <div v-else class="chart-empty">
                      <el-empty description="暂无趋势数据" />
                    </div>
                  </div>
                </div>

                <aside class="info-side">
                  <div class="section-header">
                    <h2 class="section-title">
                      <span class="section-icon">📚</span>
                      指标说明
                    </h2>
                  </div>

                  <div class="info-panel glass-card">
                    <div class="info-grid info-grid--compact">
                      <div class="info-card">
                        <div class="info-card-header">
                          <div class="info-icon icon-lss-info">📉</div>
                          <h3 class="info-title">LSS 学习压力</h3>
                        </div>
                        <p class="info-desc">单次学习的压力评分，范围 0-100。高值表示学习难度大、认知负荷高。</p>
                        <div class="info-badges info-badges--lss">
                          <span class="info-badge high">高 (70-100)</span>
                          <span class="info-badge medium">中 (40-69)</span>
                          <span class="info-badge low">低 (0-39)</span>
                        </div>
                      </div>

                      <div class="info-card">
                        <div class="info-card-header">
                          <div class="info-icon icon-ktl-info">📚</div>
                          <h3 class="info-title">KTL 知识掌握度</h3>
                        </div>
                        <p class="info-desc">长期知识积累的量化指标，使用 42 天加权平均（EWMA）计算。</p>
                        <div class="info-badges info-badges--ktl">
                          <span class="info-badge high">高 (70-100)</span>
                          <span class="info-badge medium">中 (40-69)</span>
                          <span class="info-badge low">低 (0-39)</span>
                        </div>
                      </div>

                      <div class="info-card">
                        <div class="info-card-header">
                          <div class="info-icon icon-lf-info">😴</div>
                          <h3 class="info-title">LF 学习疲劳度</h3>
                        </div>
                        <p class="info-desc">短期疲劳程度，使用 7 天加权平均计算。随时间衰减。</p>
                        <div class="info-badges info-badges--lf">
                          <span class="info-badge high">高 (70-100)</span>
                          <span class="info-badge medium">中 (40-69)</span>
                          <span class="info-badge low">低 (0-39)</span>
                        </div>
                      </div>

                      <div class="info-card info-card--lsb">
                        <div class="info-card-header">
                          <div class="info-icon icon-lsb-info">⚖️</div>
                          <h3 class="info-title">LSB 学习状态平衡值</h3>
                        </div>
                        <p class="info-desc">核心指标，计算公式：<strong>LSB = KTL - LF</strong></p>
                        <div class="lsb-visual">
                          <div class="lsb-bar">
                            <div class="lsb-negative">负值</div>
                            <div class="lsb-zero">0</div>
                            <div class="lsb-positive">正值</div>
                          </div>
                          <div class="lsb-legend">
                            <span>🔴 疲劳</span>
                            <span>🟡 正常</span>
                            <span>🟢 高效</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../utils/request';
import { metricsAPI } from '../api/metrics';
import { Chart } from 'chart.js/auto';
import { useUserStore } from '../stores/user';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import {
  HomeFilled,
  FolderOpened,
  TrendCharts,
  ChatDotSquare,
  User,
  Switch,
  EditPen,
  Trophy,
  ScaleToOriginal,
  Warning,
  Reading,
  Timer
} from '@element-plus/icons-vue';

const router = useRouter();
const userStore = useUserStore();

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
    ElMessage.success('已退出登录');
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
    ElMessage.error(error.response?.data?.error?.message || '加载学习状态失败');
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
    ElMessage.error(error.response?.data?.error?.message || '加载趋势数据失败');
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
const getLSBLevel = (lsb: number) => {
  if (lsb < 0) return 'danger';
  if (lsb < 20) return 'warning';
  if (lsb >= 40) return 'success';
  return 'info';
};

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

const getLSSLevel = (lss: number) => {
  if (lss > 70) return 'danger';
  if (lss > 50) return 'warning';
  if (lss < 30) return 'success';
  return 'info';
};

const getLSSValueClass = (lss: number) => {
  if (lss > 70) return 'value-danger';
  if (lss > 50) return 'value-warning';
  if (lss < 30) return 'value-success';
  return 'value-primary';
};

const getLFLevel = (lf: number) => {
  if (lf > 70) return 'danger';
  if (lf > 40) return 'warning';
  return 'success';
};

const getLFValueClass = (lf: number) => {
  if (lf > 70) return 'value-danger';
  if (lf > 40) return 'value-warning';
  return 'value-success';
};

const getSuggestionTagType = (level: string) => {
  const map: Record<string, any> = {
    critical: 'danger',
    warning: 'warning',
    normal: 'info',
    optimal: 'success'
  };
  return map[level] || 'info';
};

const getSuggestionLevelText = (level: string) => {
  const map: Record<string, string> = {
    critical: '紧急',
    warning: '警告',
    normal: '正常',
    optimal: '最佳'
  };
  return map[level] || level;
};

const getCategoryClass = (status: string) => {
  const map: Record<string, string> = {
    danger: 'category-danger',
    warning: 'category-warning',
    normal: 'category-normal',
    info: 'category-info',
    success: 'category-success'
  };
  return map[status] || 'category-normal';
};

const getCategoryIcon = (key: string) => {
  const map: Record<string, string> = {
    pressure: '📊',
    state: '⚖️',
    growth: '📚',
    duration: '⏱️'
  };
  return map[key] || '💡';
};

const getCategoryName = (key: string) => {
  const map: Record<string, string> = {
    pressure: '压力建议',
    state: '状态建议',
    growth: '知识增长',
    duration: '时长建议'
  };
  return map[key] || key;
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
  background: var(--bg-body);
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

.header-scrolled {
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

.nav-item-active {
  background: var(--color-primary);
  color: white;
}

.nav-item-active:hover {
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

/* ========== 主内容区 ========== */
.main-content {
  position: relative;
  z-index: 1;
  padding: 2rem;
}

.content-container {
  max-width: 1600px;
  margin: 0 auto;
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
  background: var(--gradient-primary);
  color: white;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
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
