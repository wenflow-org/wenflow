<template>
  <div class="achievements-page">
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
          <router-link :to="learningStatePath" class="nav-item">学习状态</router-link>
          <router-link :to="achievementsPath" class="nav-item nav-item--active">成就</router-link>
        </nav>

        <div class="header-right">
          <router-link :to="goalConversationPath" class="header-cta">创建新目标</router-link>
          <ThemeSwitcher />
          <MobileSiteMenu
            :user-name="userStore.user?.name || '同学'"
            :user-initial="userInitial"
            :nav-items="headerNavItems"
            :primary-action="{ label: '创建新目标', to: goalConversationPath }"
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

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="content-container">
        <section class="achievements-page-shell">
          <section class="app-page-head glass-card achievements-hero">
            <div class="app-page-head__top">
              <span class="pill">成就</span>
            </div>

            <div class="app-page-head__intro">
              <h1>把学习过程变成看得见的里程碑。</h1>
              <p>这里记录你已经完成的任务、路径、复盘和持续学习，不用只靠感觉判断自己有没有前进。</p>
            </div>

            <div class="app-page-head__summary achievements-hero__summary">
              <article v-for="item in achievementOverviewCards" :key="item.label" class="app-page-head__summary-card achievements-hero__summary-card" :class="`achievements-hero__summary-card--${item.tone}`">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
                <p>{{ item.note }}</p>
              </article>
            </div>
          </section>
        </section>

        <div v-loading="loading" class="achievements-content">

          <section class="achievement-filter-row">
            <div class="achievement-filter-tabs">
              <button class="achievement-filter-chip" :class="{ 'achievement-filter-chip--active': filterType === 'all' }" @click="filterType = 'all'">全部</button>
              <button class="achievement-filter-chip" :class="{ 'achievement-filter-chip--active': filterType === 'unlocked' }" @click="filterType = 'unlocked'">已解锁</button>
              <button class="achievement-filter-chip" :class="{ 'achievement-filter-chip--active': filterType === 'locked' }" @click="filterType = 'locked'">未解锁</button>
            </div>
            <div class="achievement-filter-tags">
              <button
                v-for="type in achievementTypes"
                :key="type.value"
                class="achievement-filter-chip achievement-filter-chip--tag"
                :class="{ 'achievement-filter-chip--active': filterCategory === type.value }"
                @click="filterCategory = filterCategory === type.value ? 'all' : type.value"
              >
                {{ type.label }}
              </button>
            </div>
          </section>

          <section v-if="filteredAchievements.length > 0" class="achievement-card-grid">
            <article v-for="item in filteredAchievements" :key="item.id" class="achievement-card-item glass-card" :class="item.unlocked ? 'achievement-card-item--unlocked' : 'achievement-card-item--locked'">
              <div class="achievement-card-item__status">
                <span v-if="item.unlocked" class="achievement-card-item__badge achievement-card-item__badge--unlocked">已解锁</span>
                <span v-else class="achievement-card-item__badge achievement-card-item__badge--locked">未解锁</span>
              </div>
              <div class="achievement-card-item__icon">{{ item.icon }}</div>
              <strong class="achievement-card-item__name">{{ item.name }}</strong>
              <p class="achievement-card-item__desc">{{ item.description }}</p>

              <div v-if="item.unlocked" class="achievement-card-item__foot">
                <span class="achievement-card-item__xp">+{{ item.xpReward }} XP</span>
                <small>{{ item.earnedAt ? formatDate(item.earnedAt) : '' }}</small>
              </div>
              <div v-else class="achievement-card-item__progress">
                <div class="achievement-card-item__progress-head">
                  <span>进度</span>
                  <strong v-if="item.progress">{{ item.progress.percentage }}%</strong>
                </div>
                <div v-if="item.progress" class="achievement-card-item__progress-bar">
                  <div class="achievement-card-item__progress-fill" :style="{ width: `${item.progress.percentage}%` }"></div>
                </div>
                <small v-if="item.progress">{{ item.progress.current }} / {{ item.progress.total }}</small>
              </div>
            </article>
          </section>

          <div v-if="filteredAchievements.length === 0" class="empty-state glass-card">
            <div class="empty-icon">🎯</div>
            <h3 class="empty-title">暂无成就</h3>
            <p class="empty-desc">继续学习，解锁更多成就！</p>
          </div>
        </div>
      </div>
      <AppMiniFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import request from '../utils/request';
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

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const headerNavItems = computed(() => [
  { label: '学习台', to: dashboardPath.value, matchPrefixes: ['/dashboard', '/admin/test/dashboard'] },
  { label: '目标规划', to: goalConversationPath.value, matchPrefixes: ['/goal-conversation', '/test/goal-full', '/admin/test/goal-full'] },
  { label: '学习路径', to: learningPathsPath.value, matchPrefixes: ['/learning-paths', '/learning-path/', '/test/learning-paths', '/test/learning-path/', '/admin/test/learning-paths', '/admin/test/learning-path/'] },
  { label: '学习状态', to: learningStatePath.value, matchPrefixes: ['/learning-state', '/admin/test/learning-state'] },
  { label: '成就', to: achievementsPath.value, matchPrefixes: ['/achievements', '/admin/test/achievements'] }
]);
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

const achievementOverviewCards = computed(() => [
  { label: '已解锁成就', value: String(unlockedCount.value), note: '已完成的里程碑', tone: 'success' },
  { label: '待解锁成就', value: String(totalCount.value - unlockedCount.value), note: '值得继续追的目标', tone: 'primary' },
  { label: '总 XP 奖励', value: String(totalXP.value), note: '持续投入的回报', tone: 'warning' },
  { label: '完成率', value: `${completionRate.value}%`, note: '成就完成占比', tone: 'accent' }
]);

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
    toast.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
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
    toast.error(error.response?.data?.error?.message || '加载成就失败');
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (isProjectionMode()) {
    try {
      await userStore.fetchProfile();
    } catch (error) {
      console.error('获取投影视角用户信息失败:', error);
    }
  }

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
.achievements-page-shell {
  margin-bottom: 18px;
}

.app-page-head {
  padding: 24px 28px;
  display: grid;
  gap: 18px;
}

.app-page-head__top,
.app-page-head__actions,
.achievement-card-new__head,
.achievement-card-new__foot {
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
.achievement-spotlight-card p,
.achievement-card-new p,
.achievement-card-new__foot {
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
  margin: 0;
  color: color-mix(in srgb, #172033 72%, #fff);
  line-height: 1.7;
}

.achievements-hero__summary-card--success {
  border-color: rgba(49, 177, 111, 0.15);
}

.achievements-hero__summary-card--primary {
  border-color: rgba(52, 120, 246, 0.15);
}

.achievements-hero__summary-card--warning {
  border-color: rgba(245, 158, 11, 0.15);
}

.achievements-hero__summary-card--accent {
  border-color: rgba(141, 107, 255, 0.15);
}

.pill,
.section-kicker {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
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

/* ========== 统计卡片 ========== */
.achievement-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.achievement-overview-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
}

.achievement-overview-card span,
.achievement-card-new__foot small,
.achievement-card-new__head span {
  font-size: 12px;
  color: var(--text-muted);
}

.achievement-overview-card strong,
.achievement-spotlight-card strong {
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.04em;
  color: #172033;
}

.achievement-overview-card--success {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.06), rgba(255, 255, 255, 0.88));
}

.achievement-overview-card--primary {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.88));
}

.achievement-overview-card--warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.88));
}

.achievement-overview-card--accent {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.08), rgba(255, 255, 255, 0.88));
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
.achievement-filter-row {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}

.achievement-filter-tabs,
.achievement-filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.achievement-filter-chip {
  min-height: 38px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.8);
  color: #172033;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.achievement-filter-chip--active {
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.18);
  color: #1f57cc;
}

.achievement-filter-chip--tag {
  color: var(--text-muted);
}

/* ========== 成就网格 ========== */
.achievement-card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.achievement-card-item {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 22px 20px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(52, 120, 246, 0.08);
  text-align: center;
}

.achievement-card-item--unlocked {
  border-color: rgba(49, 177, 111, 0.18);
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.04), rgba(255, 255, 255, 0.86));
}

.achievement-card-item--locked {
  border-color: rgba(23, 32, 51, 0.08);
}

.achievement-card-item__status {
  position: absolute;
  top: 14px;
  right: 14px;
}

.achievement-card-item__badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.achievement-card-item__badge--unlocked {
  background: rgba(49, 177, 111, 0.1);
  color: #1a8a5a;
}

.achievement-card-item__badge--locked {
  background: rgba(23, 32, 51, 0.06);
  color: #66758d;
}

.achievement-card-item__icon {
  width: 52px;
  height: 52px;
  margin: 0 auto;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(243, 246, 251, 0.92);
  font-size: 24px;
}

.achievement-card-item__name {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: #172033;
  line-height: 1.3;
}

.achievement-card-item__desc {
  margin: 0;
  font-size: 13px;
  color: color-mix(in srgb, #172033 60%, #fff);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.achievement-card-item__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

.achievement-card-item__xp {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(236, 72, 153, 0.1);
  color: #d63f8a;
  font-size: 12px;
  font-weight: 800;
}

.achievement-card-item__foot small {
  font-size: 12px;
  color: #66758d;
}

.achievement-card-item__progress {
  display: grid;
  gap: 6px;
  margin-top: 4px;
  text-align: left;
}

.achievement-card-item__progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.achievement-card-item__progress-head span {
  font-size: 12px;
  color: #66758d;
}

.achievement-card-item__progress-head strong {
  font-size: 13px;
  color: #172033;
}

.achievement-card-item__progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  overflow: hidden;
}

.achievement-card-item__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3478f6, #1f57cc);
  transition: width 0.6s ease;
}

.achievement-card-item__progress small {
  font-size: 12px;
  color: #66758d;
}

.achievement-spotlight-card {
  display: grid;
  gap: 12px;
  padding: 22px;
}

.achievement-spotlight-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.achievement-spotlight-card__foot span {
  font-size: 13px;
  font-weight: 700;
  color: #1f57cc;
}

.achievement-spotlight-card--recent {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.06), rgba(255, 255, 255, 0.84));
}

.achievement-spotlight-card--next {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.84));
}



.achievement-card-new__progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.achievement-card-new__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3478f6, #1f57cc);
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

  .app-page-head__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .achievement-filter-tabs {
    justify-content: center;
  }

  .achievement-filter-tags {
    justify-content: center;
  }

  .achievement-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .app-page-head__summary {
    grid-template-columns: 1fr;
  }

  .achievement-card-grid {
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

  .app-page-head,
  .achievement-card-item,
  .achievement-filter-row {
    padding: 16px;
    border-radius: 20px;
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

  .achievement-filter-tabs,
  .achievement-filter-tags {
    justify-content: flex-start;
  }

  .achievement-filter-row {
    gap: 12px;
  }

  .achievement-filter-chip {
    width: 100%;
    justify-content: center;
  }

  .achievement-card-item__desc {
    white-space: normal;
  }

  .achievement-card-item__foot {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
