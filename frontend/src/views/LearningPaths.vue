<template>
  <div class="learning-paths-page">
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
          <router-link to="/learning-paths" class="nav-item nav-item-active">
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
        <!-- 生成中提示 -->
        <transition name="slide-down">
          <el-alert
            v-if="showGeneratingAlert"
            title="学习路径正在生成中，通常 10-60 秒完成，请稍候"
            type="info"
            :closable="true"
            show-icon
            class="generating-alert"
            @close="showGeneratingAlert = false"
          />
        </transition>

        <!-- 页面标题区 -->
        <section class="page-header-section glass-card">
          <div class="page-header-content">
            <div class="page-title-wrapper">
              <h1 class="page-title">
                <span class="title-icon">📚</span>
                学习路径
              </h1>
              <p class="page-subtitle">管理和追踪你的所有学习计划</p>
            </div>
            <div class="page-actions">
              <router-link to="/goal-conversation" class="btn btn-primary btn-glow">
                <el-icon><Plus /></el-icon>
                创建路径
              </router-link>
            </div>
          </div>
        </section>

        <!-- 路径卡片列表 -->
        <section class="paths-section">
          <div v-loading="loading" class="paths-content">
            <div v-if="paths.length > 0" class="paths-grid">
              <div
                v-for="path in paths"
                :key="path.id"
                class="path-card-wrapper"
              >
                <!-- 生成中卡片 -->
                <div v-if="path.status === 'generating' && !isPathTimeout(path)" class="path-card glass-card generating-card">
                  <div class="generating-content">
                    <div class="generating-icon">
                      <el-icon class="is-loading"><Loading /></el-icon>
                    </div>
                    <h3 class="generating-title">正在生成学习路径...</h3>
                    <p class="generating-desc">{{ path.description || 'AI 正在规划详细的学习内容' }}</p>
                    <div class="generating-progress">
                      <div class="progress-bar">
                        <div class="progress-fill"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 超时卡片（前端判定） -->
                <div v-if="path.status === 'generating' && isPathTimeout(path)" class="path-card glass-card timeout-card">
                  <div class="timeout-content">
                    <div class="timeout-icon">⏱️</div>
                    <h3 class="timeout-title">生成超时</h3>
                    <p class="timeout-desc">{{ path.description || '学习路径生成时间过长，请重试' }}</p>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="retryingPathId === path.id"
                      @click="retryPathGeneration(path)"
                    >
                      重试生成
                    </el-button>
                  </div>
                </div>

                <!-- 生成失败卡片 -->
                <div v-else-if="path.status === 'failed'" class="path-card glass-card failed-card">
                  <div class="failed-content">
                    <div class="failed-icon">⚠️</div>
                    <h3 class="failed-title">学习路径生成失败</h3>
                    <p class="failed-desc">{{ path.description || '模型输出异常或服务不可用' }}</p>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="retryingPathId === path.id"
                      @click="retryPathGeneration(path)"
                    >
                      重试生成
                    </el-button>
                  </div>
                </div>
                
                <!-- 正常卡片 -->
                <div v-else class="path-card glass-card" @click="goToPathDetail(path.id)">
                  <div class="path-card-header">
                    <div class="path-info-main">
                      <h3 class="path-name">{{ path.name || path.title }}</h3>
                      <el-tag size="small" effect="light" class="path-tag">
                        {{ path.totalMilestones || path.milestones?.length || path.weeks?.length || 0 }} 阶段
                      </el-tag>
                    </div>
                    <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, path)" @click.stop>
                      <button class="more-btn" @click.stop>
                        <el-icon><More /></el-icon>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="delete" class="delete-item">
                            <el-icon><Delete /></el-icon>
                            <span>删除路径</span>
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>

                  <div class="path-card-body">
                    <p class="path-description">{{ path.description || '暂无描述' }}</p>

                    <div class="path-stats">
                      <div class="stat-item">
                        <div class="stat-icon-bg icon-time">
                          <el-icon><Clock /></el-icon>
                        </div>
                        <div class="stat-info">
                          <span class="stat-value">{{ path.estimatedHours || 0 }}</span>
                          <span class="stat-label">小时</span>
                        </div>
                      </div>
                      <div class="stat-item">
                        <div class="stat-icon-bg icon-weeks">
                          <el-icon><Document /></el-icon>
                        </div>
                        <div class="stat-info">
                          <span class="stat-value">{{ path.totalMilestones || path.milestones?.length || path.weeks?.length || 0 }}</span>
                          <span class="stat-label">阶段</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="path-card-footer">
                    <button class="start-btn">
                      <span>开始学习</span>
                      <el-icon><ArrowRight /></el-icon>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else-if="!loading" class="empty-state glass-card">
              <div class="empty-icon">🎯</div>
              <h3 class="empty-title">还没有学习路径</h3>
              <p class="empty-desc">点击上方按钮创建你的第一个学习路径</p>
              <router-link to="/goal-conversation" class="btn btn-primary">
                <el-icon><Plus /></el-icon>
                创建路径
              </router-link>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="showDeleteDialog"
      title="确认删除"
      width="400px"
      :close-on-click-modal="false"
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
        您确定要删除学习路径 <strong class="delete-path-name">{{ pathToDelete?.name }}</strong> 吗？
      </p>

      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" @click="deletePath" :loading="deleting">
          确认删除
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Plus,
  Clock,
  Document,
  Delete,
  More,
  HomeFilled,
  FolderOpened,
  TrendCharts,
  User,
  Switch,
  Trophy,
  ArrowRight,
  Loading
} from '@element-plus/icons-vue';
import request from '../utils/request';
import { useUserStore } from '../stores/user';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const scrolled = ref(false);
const loading = ref(true);
const paths = ref<any[]>([]);
const deleting = ref(false);
const showDeleteDialog = ref(false);
const pathToDelete = ref<any>(null);
const retryingPathId = ref<string | null>(null);
const showGeneratingAlert = ref(false);

// 超时时间：2分钟（120秒）
const GENERATION_TIMEOUT_SECONDS = 180; // 3 分钟

// 已提示超时的路径 ID（避免重复提示）
const notifiedTimeoutIds = new Set<string>();

// 检查路径是否超时
const isPathTimeout = (path: any) => {
  if (!path.createdAt) return false;
  const createdTime = new Date(path.createdAt).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - createdTime) / 1000;
  return elapsedSeconds > GENERATION_TIMEOUT_SECONDS;
};

// 正在生成的路径（从后端获取）
const generatingPaths = computed(() => 
  paths.value.filter((p: any) => p.status === 'generating')
);

// 超时的路径（前端判定，不影响数据库）
const timeoutPaths = computed(() =>
  generatingPaths.value.filter((p: any) => isPathTimeout(p))
);

// 检查是否有正在生成的路径
const checkGeneratingPath = () => {
  return generatingPaths.value.length > 0;
};

// 清除生成中状态（已不需要，保留兼容）
const clearGeneratingState = () => {
  // 不再使用 localStorage
};

// 轮询更新生成中的路径
let pollingTimer: number | null = null;
const startPolling = () => {
  if (pollingTimer) return;
  pollingTimer = window.setInterval(async () => {
    if (generatingPaths.value.length > 0) {
      // 检查超时（只提示一次）
      timeoutPaths.value.forEach((timeoutPath: any) => {
        if (!notifiedTimeoutIds.has(timeoutPath.id)) {
          ElMessage.warning('学习路径生成超时，请重试');
          notifiedTimeoutIds.add(timeoutPath.id);
        }
      });
      
      try {
        const response = await request.get('/learning/paths');
        const newPaths = response.data.data;
        
        // 检查是否有路径从 generating 变成 active
        generatingPaths.value.forEach((genPath: any) => {
          const updatedPath = newPaths.find((p: any) => p.id === genPath.id);
          if (updatedPath && updatedPath.status !== 'generating') {
            if (updatedPath.status === 'active') {
              ElMessage.success('学习路径生成完成！');
              notifiedTimeoutIds.delete(genPath.id);
            } else if (updatedPath.status === 'failed') {
              ElMessage.error('学习路径生成失败，请返回目标对话重试。');
              notifiedTimeoutIds.delete(genPath.id);
            }
          }
        });
        
        paths.value = newPaths;
        
        // 如果没有生成中的路径了，停止轮询
        if (!newPaths.some((p: any) => p.status === 'generating')) {
          stopPolling();
        }
      } catch (error) {
        console.error('轮询更新失败:', error);
      }
    }
  }, 3000); // 每3秒轮询一次
};

const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
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

const loadPaths = async () => {
  loading.value = true;
  try {
    const response = await request.get('/learning/paths');
    paths.value = response.data.data;
  } catch (error: any) {
    console.error('加载学习路径失败:', error);
    ElMessage.error(error.response?.data?.error?.message || '加载学习路径失败');
  } finally {
    loading.value = false;
  }
};

const handleCommand = (command: string, path: any) => {
  if (command === 'delete') {
    confirmDelete(path);
  }
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
    ElMessage.success('学习路径已删除');
    showDeleteDialog.value = false;
    pathToDelete.value = null;
    await loadPaths();
  } catch (error: any) {
    console.error('删除学习路径失败:', error);
    ElMessage.error(error.response?.data?.error?.message || '删除学习路径失败');
  } finally {
    deleting.value = false;
  }
};

const goToPathDetail = (id: string) => {
  router.push(`/learning-path/${id}`);
};

// 重试生成失败的路径
const retryPathGeneration = async (path: any) => {
  if (!path.description) {
    ElMessage.error('路径描述缺失，请通过目标对话重新创建');
    return;
  }

  retryingPathId.value = path.id;
  try {
    // 更新状态为 generating
    await request.patch(`/learning/paths/${path.id}/retry`);
    
    ElMessage.success('正在重新生成学习路径...');
    
    // 启动轮询
    if (!pollingTimer) {
      startPolling();
    }
  } catch (error: any) {
    console.error('重试生成失败:', error);
    ElMessage.error(error.response?.data?.error?.message || '重试生成失败，请稍后重试');
  } finally {
    retryingPathId.value = null;
  }
};

onMounted(() => {
  // 检查是否有正在生成的路径
  checkGeneratingPath();

  // 检查是否从 goal-conversation 跳转过来
  if (route.query.from === 'goal' && route.query.auto === '1') {
    showGeneratingAlert.value = true;
    // 5秒后自动关闭提示
    setTimeout(() => {
      showGeneratingAlert.value = false;
    }, 5000);
  }

  loadPaths().then(() => {
    // 如果有正在生成的路径，启动轮询
    if (generatingPaths.value.length > 0) {
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
/* ========== 基础布局 ========== */
.learning-paths-page {
  min-height: 100vh;
  background: var(--bg-body);
  position: relative;
  overflow-x: hidden;
  width: 100%;
  max-width: 100vw;
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
  width: 100%;
  overflow-x: hidden;
}

.content-container {
  max-width: 1600px;
  margin: 0 auto;
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
  animation: progress-loading 2s ease-in-out infinite;
}

.failed-card {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(249, 115, 22, 0.06) 100%);
}

.timeout-card {
  display: flex;
  align-items: center;
  justify-content: center;
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

@keyframes progress-loading {
  0% { width: 0%; transform: translateX(-100%); }
  50% { width: 100%; transform: translateX(0); }
  100% { width: 100%; transform: translateX(100%); }
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

  .paths-grid {
    grid-template-columns: 1fr;
  }
}
</style>
