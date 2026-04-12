<template>
  <div class="dashboard-page">
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
        <!-- 欢迎区域 -->
        <section class="welcome-section glass-card">
          <div class="welcome-content">
            <h1 class="welcome-title">
              <span v-if="isNewUser">你好，{{ userStore.user?.name || '同学' }}！</span>
              <span v-else>欢迎回来，{{ userStore.user?.name || '同学' }}！</span>
            </h1>
            <p class="welcome-subtitle">
              {{ welcomeSubtitle }}
            </p>
            <div class="welcome-actions">
              <router-link to="/goal-conversation" class="btn btn-primary btn-glow">
                <el-icon><EditPen /></el-icon>
                {{ isNewUser ? '我想学点什么' : '开始 AI 规划' }}
              </router-link>
              <router-link to="/learning-paths" class="btn btn-outline" v-if="hasLearningPath">
                <el-icon><FolderOpened /></el-icon>
                继续我的学习
              </router-link>
            </div>
            
            <!-- 新手任务条（仅新用户显示） -->
            <div v-if="isNewUser" class="newbie-tasks">
              <div class="task-header">
                <span class="task-title">🎯 新手任务</span>
                <span class="task-progress">{{ newbieProgress }}/3</span>
              </div>
              <div class="task-list">
                <div class="task-item" :class="{ completed: newbieProgress >= 1 }">
                  <el-icon class="task-icon">
                    <CircleCheck v-if="newbieProgress >= 1" />
                    <Check v-else />
                  </el-icon>
                  <span class="task-text">告诉 AI 你想探索什么</span>
                </div>
                <div class="task-item" :class="{ completed: newbieProgress >= 2 }">
                  <el-icon class="task-icon">
                    <CircleCheck v-if="newbieProgress >= 2" />
                    <Check v-else />
                  </el-icon>
                  <span class="task-text">生成第一张学习地图</span>
                </div>
                <div class="task-item" :class="{ completed: newbieProgress >= 3 }">
                  <el-icon class="task-icon">
                    <CircleCheck v-if="newbieProgress >= 3" />
                    <Check v-else />
                  </el-icon>
                  <span class="task-text">完成第一个小任务</span>
                </div>
              </div>
              <el-progress :percentage="(newbieProgress / 3) * 100" :stroke-width="6" :show-text="false" />
            </div>
          </div>
          <div class="welcome-visual">
            <div class="visual-emoji">{{ isNewUser ? '🚀' : '✨' }}</div>
          </div>
        </section>

        <!-- 统计卡片 -->
        <section class="stats-section">
          <div class="section-header">
            <h2 class="section-title">学习概览</h2>
            <p class="section-subtitle">你的学习数据统计</p>
          </div>

          <div class="stats-grid">
            <!-- 学习路径卡片 -->
            <div class="stat-card stat-card--level">
              <div class="stat-card-header">
                <div class="stat-icon icon-gradient-1">
                  <el-icon><FolderOpened /></el-icon>
                </div>
                <el-tag type="info" size="small" effect="plain">路径</el-tag>
              </div>
              <div class="stat-card-body">
                <div class="stat-value">{{ pathCount }}</div>
                <div class="stat-label">
                  {{ pathCount > 0 ? '当前学习路径' : '还没有学习路径' }}
                </div>
                <div class="stat-hint" v-if="pathCount > 0">
                  <el-icon><Lightning /></el-icon>
                  <span>{{ currentPathHint }}</span>
                </div>
                <div class="stat-hint" v-else>
                  <el-icon><Flag /></el-icon>
                  <span>先做一次 AI 规划，生成第一条路径</span>
                </div>
              </div>
              <div class="stat-card-footer">
                <span class="stat-trend stat-trend--up">{{ pathCount > 0 ? '学习方向已建立' : '等待开始' }}</span>
              </div>
            </div>

            <!-- 任务进度卡片 -->
            <div class="stat-card stat-card--completed">
              <div class="stat-card-header">
                <div class="stat-icon icon-gradient-2">
                  <el-icon><CircleCheck /></el-icon>
                </div>
                <el-tag type="success" size="small" effect="plain">进度</el-tag>
              </div>
              <div class="stat-card-body">
                <div class="stat-value success">{{ completedTaskCount }}</div>
                <div class="stat-label">
                  {{ completedTaskCount > 0 ? '已完成任务' : '尚未完成任务' }}
                </div>
                <div class="stat-delta stat-delta--up" v-if="inProgressTaskCount > 0">
                  <el-icon><Top /></el-icon>
                  <span>还有 {{ inProgressTaskCount }} 个任务正在推进</span>
                </div>
                <div class="stat-hint" v-else>
                  <el-icon><Flag /></el-icon>
                  <span>{{ completedTaskCount > 0 ? '可以继续解锁下一步任务' : '从一条路径里的第一个任务开始' }}</span>
                </div>
              </div>
              <div class="stat-card-footer">
                <span class="stat-trend stat-trend--success">完成率 {{ completionRate }}%</span>
              </div>
            </div>

            <!-- 学习投入卡片 -->
            <div class="stat-card stat-card--time">
              <div class="stat-card-header">
                <div class="stat-icon icon-gradient-3">
                  <el-icon><Clock /></el-icon>
                </div>
                <el-tag type="warning" size="small" effect="plain">投入</el-tag>
              </div>
              <div class="stat-card-body">
                <div class="stat-value warning">{{ totalLearningHours }}</div>
                <div class="stat-label">
                  {{ totalLearningMinutes > 0 ? '累计学习小时' : '还没有学习投入' }}
                </div>
                <div class="stat-delta stat-delta--neutral" v-if="totalLearningMinutes > 0">
                  <el-icon><Timer /></el-icon>
                  <span>累计 {{ totalLearningMinutes }} 分钟真实学习记录</span>
                </div>
                <div class="stat-hint" v-else>
                  <el-icon><Coffee /></el-icon>
                  <span>开始一次学习，会自动记录到日历里</span>
                </div>
              </div>
              <div class="stat-card-footer">
                <span class="stat-trend stat-trend--warning">{{ totalLearningMinutes > 0 ? '日均 ' + avgDailyHours + ' 小时' : '轻量起步也可以' }}</span>
              </div>
            </div>

            <!-- 当前状态卡片 -->
            <div class="stat-card stat-card--xp">
              <div class="stat-card-header">
                <div class="stat-icon icon-gradient-4">
                  <el-icon><TrendCharts /></el-icon>
                </div>
                <el-tag type="warning" size="small" effect="plain">状态</el-tag>
              </div>
              <div class="stat-card-body">
                <div class="stat-value accent">{{ currentStateScore }}</div>
                <div class="stat-label">
                  {{ currentStateLabel }}
                </div>
                <div class="stat-delta stat-delta--up" v-if="stats?.state">
                  <el-icon><Top /></el-icon>
                  <span>{{ currentStateHint }}</span>
                </div>
                <div class="stat-hint" v-else>
                  <el-icon><Star /></el-icon>
                  <span>完成学习后，这里会展示你的节奏和疲劳状态</span>
                </div>
              </div>
              <div class="stat-card-footer">
                <span class="stat-trend stat-trend--accent">{{ currentStateAction }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 学习状态和日历 -->
        <section class="bottom-section">
          <div class="calendar-wrapper glass-card">
            <LoadCalendar @day-select="handleCalendarDaySelect" />
          </div>
          <div class="metrics-wrapper glass-card">
            <LearningMetrics :selected-day="selectedCalendarDay" @clear-selection="clearCalendarSelection" />
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, onUnmounted } from 'vue';
  import { useRouter } from 'vue-router';
  import { ElMessageBox, ElMessage } from 'element-plus';
  import { useUserStore } from '../stores/user';
import { learningAPI, type LearningStats } from '../api/learning';
import LearningMetrics from '../components/LearningMetrics.vue';
import LoadCalendar from '../components/LoadCalendar.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import {
  FolderOpened,
  TrendCharts,
  User,
  Switch,
  CircleCheck,
  Clock,
  Trophy,
  EditPen,
  Top,
  Timer,
  Lightning,
  Flag,
  Coffee,
  Star,
  Check,
  Plus
} from '@element-plus/icons-vue';

const router = useRouter();
const userStore = useUserStore();

const scrolled = ref(false);
const stats = ref<LearningStats | null>(null);
const loading = ref(false);
const selectedCalendarDay = ref<any | null>(null);

const completionRate = computed(() => {
  if (!stats.value) return 0;
  const total = stats.value.tasks.completed + stats.value.tasks.inProgress;
  if (total === 0) return 0;
  return Math.round((stats.value.tasks.completed / total) * 100);
});

const avgDailyHours = computed(() => {
  if (!stats.value) return 0;
  const hours = Math.floor((stats.value.time.totalCompleted || stats.value.time.totalMinutes || 0) / 60);
  return (hours / 30).toFixed(1);
});

const totalLearningMinutes = computed(() => stats.value?.time.totalCompleted || stats.value?.time.totalMinutes || 0);
const totalLearningHours = computed(() => Math.floor(totalLearningMinutes.value / 60));
const pathCount = computed(() => stats.value?.paths?.total || 0);
const completedTaskCount = computed(() => stats.value?.tasks.completed || stats.value?.subtasks?.completed || 0);
const inProgressTaskCount = computed(() => stats.value?.tasks.inProgress || stats.value?.subtasks?.inProgress || 0);
const currentPathHint = computed(() => {
  if (inProgressTaskCount.value > 0) return `${inProgressTaskCount.value} 个任务正在进行中`;
  if (completedTaskCount.value > 0) return '已经有学习进展，继续保持';
  return '路径已经生成，可以开始第一步';
});
const currentStateScore = computed(() => {
  const lsb = stats.value?.state?.lsb;
  return typeof lsb === 'number' ? lsb.toFixed(1) : '--';
});
const currentStateLabel = computed(() => {
  const lsb = stats.value?.state?.lsb;
  if (typeof lsb !== 'number') return '暂无状态数据';
  if (lsb >= 4) return '高效学习区';
  if (lsb >= 0) return '状态平稳';
  if (lsb >= -3) return '疲劳预警';
  return '需要休息';
});
const currentStateHint = computed(() => {
  if (stats.value?.suggestion?.message) return stats.value.suggestion.message;
  const lsb = stats.value?.state?.lsb;
  if (typeof lsb !== 'number') return '完成学习后会自动生成状态判断';
  if (lsb >= 4) return '可以继续保持当前节奏';
  if (lsb >= 0) return '学习节奏比较稳';
  if (lsb >= -3) return '疲劳在累积，建议适当放缓';
  return '建议先休息，再继续学习';
});
const currentStateAction = computed(() => {
  if (stats.value?.suggestion?.action) return stats.value.suggestion.action;
  return stats.value?.state ? '查看学习状态页获取更多解释' : '开始学习后这里会给出建议';
});

// 新用户判断（0 任务或 LV.1 且 XP 为 0）
const isNewUser = computed(() => {
  if (!stats.value) return true;
  return ((stats.value.tasks?.completed || 0) === 0 && (stats.value.user?.xp || 0) === 0);
});

// 是否有学习路径
const hasLearningPath = computed(() => {
  return (stats.value?.paths?.total || 0) > 0;
});

// 新手任务进度
const newbieProgress = computed(() => {
  if (!stats.value) return 0;
  let progress = 0;
  // 任务 1: 告诉 AI 你想探索什么（只要有学习路径就算完成）
  if (hasLearningPath.value) progress++;
  // 任务 2: 生成第一张学习地图（有 1 个以上路径）
  if ((stats.value.paths?.total || 0) >= 1) progress++;
  // 任务 3: 完成第一个小任务
  if ((stats.value.tasks.completed || 0) >= 1) progress++;
  return progress;
});

// 欢迎副标题（动态）
const welcomeSubtitle = computed(() => {
  if (!stats.value) return '开始你的学习之旅吧';
  if (isNewUser.value) {
    return '开始你的第一次学习探索吧';
  } else if ((stats.value.tasks.completed || 0) > 0) {
    return '今天也是充满收获的一天';
  } else {
    return '今天想探索什么？';
  }
});

onMounted(async () => {
  await fetchStats();
});

async function fetchStats() {
  loading.value = true;
  try {
    stats.value = await learningAPI.getStats();
  } catch (error) {
    console.error('获取统计失败:', error);
  } finally {
    loading.value = false;
  }
}

const handleCalendarDaySelect = (day: any) => {
  selectedCalendarDay.value = day;
};

const clearCalendarSelection = () => {
  selectedCalendarDay.value = null;
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
    ElMessage.success('已退出登录');
    router.push('/login');
  } catch {
    // 用户取消
  }
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.dashboard-page {
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

/* ========== 欢迎区域 ========== */
.welcome-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3rem;
  margin-bottom: 2rem;
  overflow: hidden;
  position: relative;
}

.welcome-content {
  flex: 1;
}

.welcome-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 1rem;
  line-height: 1.2;
}

.gradient-text {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.welcome-subtitle {
  font-size: 1.25rem;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

.welcome-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

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

.btn-outline {
  background: transparent;
  border: 2px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-outline:hover {
  background: var(--color-primary);
  color: white;
}

.welcome-visual {
  flex-shrink: 0;
  margin-left: 2rem;
}

.visual-emoji {
  font-size: 8rem;
  animation: float 3s ease-in-out infinite;
}

/* ========== 新手任务条 ========== */
.newbie-tasks {
  margin-top: 2rem;
  padding: 1.5rem;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  border: 2px solid var(--color-primary);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.task-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.task-progress {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-primary);
  background: rgba(102, 126, 234, 0.1);
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-md);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  transition: all 0.3s;
}

.task-item.completed {
  color: var(--color-primary);
}

.task-icon {
  font-size: 1.25rem;
}

.task-text {
  flex: 1;
  font-size: 0.95rem;
  font-weight: 500;
}

.task-item.completed .task-text {
  text-decoration: line-through;
  opacity: 0.7;
}

/* ========== 统计卡片新样式 ========== */
.stat-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(102, 126, 234, 0.05);
  border-radius: var(--radius-md);
}

.stat-hint .el-icon {
  font-size: 1rem;
  color: var(--color-primary);
}

/* ========== 媒体查询 ========== */
.stats-section {
  margin-bottom: 2rem;
}

.section-header {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.section-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
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

/* ========== 统计卡片 ========== */
.stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 1.5rem;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.stat-card:hover {
  border-color: var(--color-primary-light);
  box-shadow: var(--shadow-lg);
  transform: translateY(-4px);
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

.icon-gradient-1 {
  background: var(--gradient-primary);
}

.icon-gradient-2 {
  background: var(--gradient-success);
}

.icon-gradient-3 {
  background: var(--gradient-warning);
}

.icon-gradient-4 {
  background: var(--gradient-achievement);
}

.stat-card-body {
  flex: 1;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: 0.5rem;
}

.stat-value.success {
  color: var(--color-success);
}

.stat-value.warning {
  color: var(--color-warning);
}

.stat-value.accent {
  color: var(--color-accent);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
  margin-bottom: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-delta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
}

.stat-delta--up {
  background: var(--color-success-bg);
  color: var(--color-success-dark);
}

.stat-delta--neutral {
  background: var(--bg-muted);
  color: var(--text-muted);
}

.stat-progress {
  margin-top: 1rem;
}

.progress-bar {
  height: 8px;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width 0.8s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.stat-card-footer {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-light);
}

.stat-trend {
  font-size: 0.75rem;
  font-weight: 600;
}

.stat-trend--up {
  color: var(--color-success);
}

.stat-trend--success {
  color: var(--color-success);
}

.stat-trend--warning {
  color: var(--color-warning);
}

.stat-trend--accent {
  color: var(--color-accent);
}

/* ========== 底部区域 ========== */
.bottom-section {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(320px, 0.9fr);
  gap: 1.5rem;
  align-items: stretch;
}

@media (max-width: 1024px) {
  .bottom-section {
    grid-template-columns: 1fr;
  }
}

.calendar-wrapper,
.metrics-wrapper {
  padding: 1.5rem;
  min-height: 450px;
  height: 100%;
}

.calendar-wrapper {
  padding: 1.5rem 1.5rem 1.25rem;
}

.metrics-wrapper {
  padding: 1.25rem;
  position: sticky;
  top: 88px;
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

  .welcome-section {
    flex-direction: column;
    padding: 2rem 1.5rem;
    text-align: center;
  }

  .welcome-visual {
    margin-left: 0;
    margin-top: 2rem;
  }

  .welcome-actions {
    justify-content: center;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .metrics-wrapper {
    position: static;
  }
}

/* ========== onUnmounted 导入 ========== */
</style>
