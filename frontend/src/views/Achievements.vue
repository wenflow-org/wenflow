<template>
  <div class="achievements-page">
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
            <span>首页</span>
          </router-link>
          <router-link to="/goal-conversation" class="nav-item">
            <el-icon><EditPen /></el-icon>
            <span>AI 规划</span>
          </router-link>
          <router-link to="/learning-paths" class="nav-item">
            <el-icon><FolderOpened /></el-icon>
            <span>学习路径</span>
          </router-link>
          <router-link to="/learning-state" class="nav-item">
            <el-icon><TrendCharts /></el-icon>
            <span>学习状态</span>
          </router-link>
          <router-link to="/achievements" class="nav-item nav-item-active">
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
                <span class="title-icon">🏆</span>
                成就系统
              </h1>
              <p class="page-subtitle">解锁成就，获得 XP 奖励，记录你的学习里程碑</p>
            </div>
          </div>
        </section>

        <div v-loading="loading" class="achievements-content">
          <!-- 统计卡片 -->
          <section class="stats-section">
            <div class="stats-grid">
              <div class="stat-card glass-card stat-card--unlocked">
                <div class="stat-card-header">
                  <div class="stat-icon icon-unlocked">
                    <el-icon><Trophy /></el-icon>
                  </div>
                  <el-tag type="success" size="small" effect="light">已解锁</el-tag>
                </div>
                <div class="stat-card-body">
                  <div class="stat-value value-success">{{ unlockedCount }}</div>
                  <div class="stat-label">已解锁成就</div>
                </div>
              </div>

              <div class="stat-card glass-card stat-card--locked">
                <div class="stat-card-header">
                  <div class="stat-icon icon-locked">
                    <el-icon><Lock /></el-icon>
                  </div>
                  <el-tag type="info" size="small" effect="light">待解锁</el-tag>
                </div>
                <div class="stat-card-body">
                  <div class="stat-value">{{ totalCount - unlockedCount }}</div>
                  <div class="stat-label">待解锁成就</div>
                </div>
              </div>

              <div class="stat-card glass-card stat-card--xp">
                <div class="stat-card-header">
                  <div class="stat-icon icon-xp">
                    <el-icon><Star /></el-icon>
                  </div>
                  <el-tag type="warning" size="small" effect="light">奖励</el-tag>
                </div>
                <div class="stat-card-body">
                  <div class="stat-value value-warning">{{ totalXP }}</div>
                  <div class="stat-label">总 XP 奖励</div>
                </div>
              </div>

              <div class="stat-card glass-card stat-card--rate">
                <div class="stat-card-header">
                  <div class="stat-icon icon-rate">
                    <el-icon><TrendCharts /></el-icon>
                  </div>
                  <el-tag type="primary" size="small" effect="light">进度</el-tag>
                </div>
                <div class="stat-card-body">
                  <div class="stat-value value-primary">{{ completionRate }}%</div>
                  <div class="stat-label">完成率</div>
                  <div class="stat-progress">
                    <div class="progress-bar">
                      <div class="progress-fill" :style="{ width: completionRate + '%' }"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 筛选器 -->
          <section class="filter-section">
            <div class="filter-card glass-card">
              <div class="filter-tabs">
                <button
                  class="filter-tab"
                  :class="{ active: filterType === 'all' }"
                  @click="filterType = 'all'"
                >
                  <span class="tab-icon">🎯</span>
                  <span class="tab-text">全部</span>
                  <span class="tab-count">{{ totalCount }}</span>
                </button>
                <button
                  class="filter-tab"
                  :class="{ active: filterType === 'unlocked' }"
                  @click="filterType = 'unlocked'"
                >
                  <span class="tab-icon">🔓</span>
                  <span class="tab-text">已解锁</span>
                  <span class="tab-count">{{ unlockedCount }}</span>
                </button>
                <button
                  class="filter-tab"
                  :class="{ active: filterType === 'locked' }"
                  @click="filterType = 'locked'"
                >
                  <span class="tab-icon">🔒</span>
                  <span class="tab-text">未解锁</span>
                  <span class="tab-count">{{ totalCount - unlockedCount }}</span>
                </button>
              </div>

              <div class="filter-divider"></div>

              <div class="category-filters">
                <button
                  v-for="type in achievementTypes"
                  :key="type.value"
                  class="category-tag"
                  :class="{ active: filterCategory === type.value }"
                  @click="filterCategory = filterCategory === type.value ? 'all' : type.value"
                >
                  <span class="category-icon">{{ type.icon }}</span>
                  <span class="category-label">{{ type.label }}</span>
                  <span class="category-count">{{ getCategoryCount(type.value) }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- 成就网格 -->
          <section class="achievements-grid-section">
            <div v-if="filteredAchievements.length > 0" class="achievements-grid">
              <div
                v-for="achievement in filteredAchievements"
                :key="achievement.id"
                class="achievement-card-wrapper"
              >
                <div
                  class="achievement-card glass-card"
                  :class="{ unlocked: achievement.unlocked, locked: !achievement.unlocked }"
                >
                  <div class="achievement-icon-wrapper">
                    <div class="achievement-icon">{{ achievement.icon }}</div>
                    <div v-if="achievement.unlocked" class="achievement-badge">✓</div>
                  </div>

                  <div class="achievement-content">
                    <div class="achievement-header">
                      <h3 class="achievement-name">{{ achievement.name }}</h3>
                      <el-tag
                        v-if="achievement.unlocked"
                        type="success"
                        size="small"
                        effect="light"
                      >
                        已解锁
                      </el-tag>
                      <el-tag
                        v-else
                        type="info"
                        size="small"
                        effect="light"
                      >
                        未解锁
                      </el-tag>
                    </div>

                    <p class="achievement-desc">{{ achievement.description }}</p>

                    <!-- 进度条 -->
                    <div v-if="!achievement.unlocked && achievement.progress" class="achievement-progress">
                      <div class="progress-header">
                        <span class="progress-label">进度</span>
                        <span class="progress-value">{{ achievement.progress.percentage }}%</span>
                      </div>
                      <div class="progress-track">
                        <div
                          class="progress-bar-achievement"
                          :style="{ width: achievement.progress.percentage + '%', background: getProgressColor(achievement.progress.percentage) }"
                        ></div>
                      </div>
                      <div class="progress-numbers">
                        {{ achievement.progress.current }} / {{ achievement.progress.total }}
                      </div>
                    </div>

                    <div class="achievement-footer">
                      <div class="xp-badge">
                        <el-icon><Star /></el-icon>
                        <span>+{{ achievement.xpReward }} XP</span>
                      </div>
                      <span v-if="achievement.earnedAt" class="unlock-date">
                        {{ formatDate(achievement.earnedAt) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-state glass-card">
              <div class="empty-icon">🎯</div>
              <h3 class="empty-title">暂无成就</h3>
              <p class="empty-desc">继续学习，解锁更多成就！</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../utils/request';
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
  Lock,
  Star
} from '@element-plus/icons-vue';

const router = useRouter();
const userStore = useUserStore();

const scrolled = ref(false);
const loading = ref(true);
const achievements = ref<Achievement[]>([]);
const filterType = ref<'all' | 'unlocked' | 'locked'>('all');
const filterCategory = ref<string>('all');

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  type: string;
  unlocked: boolean;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
  earnedAt?: Date;
}

const achievementTypes = [
  { label: '里程碑', value: 'milestone', icon: '🎯' },
  { label: '连续学习', value: 'streak', icon: '🔥' },
  { label: '完成度', value: 'completion', icon: '🚀' },
  { label: '知识掌握', value: 'mastery', icon: '📚' }
];

const totalCount = computed(() => achievements.value.length);
const unlockedCount = computed(() => achievements.value.filter(a => a.unlocked).length);
const totalXP = computed(() => achievements.value.filter(a => a.unlocked).reduce((sum, a) => sum + a.xpReward, 0));
const completionRate = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((unlockedCount.value / totalCount.value) * 100);
});

const filteredAchievements = computed(() => {
  let result = [...achievements.value];

  if (filterType.value === 'unlocked') result = result.filter(a => a.unlocked);
  else if (filterType.value === 'locked') result = result.filter(a => !a.unlocked);

  if (filterCategory.value !== 'all') {
    result = result.filter(a => a.type === filterCategory.value);
  }

  return result.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    const progressA = a.progress?.percentage || 0;
    const progressB = b.progress?.percentage || 0;
    return progressB - progressA;
  });
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
    ElMessage.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

const getCategoryCount = (category: string) => {
  return achievements.value.filter(a => a.type === category).length;
};

const getProgressColor = (percentage: number) => {
  if (percentage >= 100) return 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  if (percentage >= 50) return 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
  if (percentage >= 25) return 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
  return 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
};

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const loadAchievements = async () => {
  loading.value = true;
  try {
    const response = await request.get('/achievements/all');
    achievements.value = response.data.data;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error?.message || '加载成就失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadAchievements();
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.achievements-page {
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

/* ========== 统计卡片 ========== */
.stats-section {
  margin-bottom: 2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}

.stat-card {
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.stat-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: white;
}

.icon-unlocked {
  background: var(--gradient-success);
}

.icon-locked {
  background: var(--gradient-primary);
}

.icon-xp {
  background: var(--gradient-warning);
}

.icon-rate {
  background: var(--gradient-achievement);
}

.stat-card-body {
  text-align: center;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.value-success {
  color: var(--color-success);
}

.value-warning {
  color: var(--color-warning);
}

.value-primary {
  color: var(--color-primary);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.stat-progress {
  margin-top: 0.75rem;
}

.progress-bar {
  height: 8px;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width 0.8s ease;
}

/* ========== 筛选器 ========== */
.filter-section {
  margin-bottom: 2rem;
}

.filter-card {
  padding: 1.5rem;
}

.filter-tabs {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}

.filter-tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
  color: var(--text-secondary);
}

.filter-tab:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.filter-tab.active {
  background: var(--gradient-primary);
  border-color: transparent;
  color: white;
}

.tab-icon {
  font-size: 1.125rem;
}

.tab-count {
  padding: 0.125rem 0.5rem;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
}

.filter-tab.active .tab-count {
  background: rgba(255, 255, 255, 0.2);
}

.filter-divider {
  height: 1px;
  background: var(--border-light);
  margin-bottom: 1.25rem;
}

.category-filters {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.category-tag {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.category-tag:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.category-tag.active {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.category-icon {
  font-size: 1rem;
}

.category-count {
  padding: 0.125rem 0.375rem;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
}

.category-tag.active .category-count {
  background: var(--color-primary-lighter);
}

/* ========== 成就网格 ========== */
.achievements-grid-section {
  margin-bottom: 2rem;
}

.achievements-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

@media (max-width: 1200px) {
  .achievements-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .achievements-grid {
    grid-template-columns: 1fr;
  }
}

.achievement-card-wrapper {
  height: 100%;
}

.achievement-card {
  padding: 1.5rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.achievement-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.achievement-card.unlocked {
  border: 2px solid var(--color-success);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
}

.achievement-card.locked {
  opacity: 0.85;
}

.achievement-card.locked .achievement-icon {
  filter: grayscale(0.5);
}

.achievement-icon-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.achievement-icon {
  font-size: 4rem;
  line-height: 1;
}

.achievement-badge {
  position: absolute;
  bottom: 0;
  right: calc(50% - 2.5rem);
  width: 28px;
  height: 28px;
  background: var(--gradient-success);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  border: 3px solid white;
  box-shadow: var(--shadow-sm);
}

.achievement-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.achievement-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.achievement-name {
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  flex: 1;
}

.achievement-desc {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 1rem 0;
  flex: 1;
}

/* 进度条 */
.achievement-progress {
  margin-bottom: 1rem;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 500;
}

.progress-value {
  font-size: 0.8125rem;
  color: var(--color-primary);
  font-weight: 600;
}

.progress-track {
  height: 8px;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-bar-achievement {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.progress-numbers {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-align: center;
}

.achievement-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
  border-top: 1px solid var(--border-light);
  margin-top: auto;
}

.xp-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: var(--gradient-warning);
  color: white;
  border-radius: var(--radius-full);
  font-size: 0.8125rem;
  font-weight: 600;
}

.unlock-date {
  font-size: 0.8125rem;
  color: var(--text-muted);
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
  margin: 0;
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

  .page-title {
    font-size: 1.5rem;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .filter-tabs {
    justify-content: center;
  }

  .category-filters {
    justify-content: center;
  }

  .achievements-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
