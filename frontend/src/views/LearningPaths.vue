<template>
  <div class="learning-paths-page paths-upgrade">
    <div class="paths-bg-layer">
      <div class="paths-bg-orb paths-bg-orb--1"></div>
      <div class="paths-bg-orb paths-bg-orb--2"></div>
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
          <router-link to="/learning-paths" class="nav-item nav-item--active">学习路径</router-link>
          <router-link to="/learning-state" class="nav-item">学习状态</router-link>
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

    <main class="main-content paths-main">
      <div class="content-container paths-shell">
        <transition name="slide-down">
          <el-alert
            v-if="showGeneratingAlert"
            title="学习路径正在生成中，通常 1-3 分钟完成，请稍候"
            type="info"
            :closable="true"
            show-icon
            class="generating-alert"
            @close="showGeneratingAlert = false"
          />
        </transition>

        <section class="paths-hero glass-card">
          <div class="paths-hero__copy">
            <span class="pill">路径总览</span>
            <h1>看见每一条路径的状态，<br />学习才不会中断。</h1>
            <p>推进中的继续走，生成中的等待完成，失败的及时重试，始终保留一条最值得推进的主路径。</p>
          </div>
          <div class="paths-hero__actions">
            <router-link v-if="primaryPath" :to="`/learning-path/${primaryPath.id}`" class="btn btn-primary">继续主路径</router-link>
            <router-link to="/goal-conversation" class="btn btn-ghost">开始新规划</router-link>
          </div>
        </section>

        <section class="paths-filter-row">
          <button
            v-for="item in pathFilterChips"
            :key="item.key"
            type="button"
            class="paths-filter-chip"
            :class="{ 'paths-filter-chip--active': activePathFilter === item.key }"
            @click="activePathFilter = item.key"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.count }}</strong>
          </button>
        </section>

        <section class="paths-section">
          <div v-loading="loading" class="paths-content">
            <div v-if="visiblePaths.length > 0" class="paths-grid paths-grid--upgraded">
              <article
                v-for="path in visiblePaths"
                :key="path.id"
                class="path-overview-card glass-card"
                :class="[
                  `path-overview-card--${getPathDisplayState(path)}`,
                  { 'path-overview-card--primary': primaryPath?.id === path.id }
                ]"
              >
                <template v-if="getPathDisplayState(path) === 'generating'">
                  <div class="path-overview-card__status-row">
                    <span class="path-state-pill path-state-pill--generating">生成中</span>
                    <span v-if="primaryPath?.id === path.id" class="path-state-pill path-state-pill--primary">主路径</span>
                  </div>
                  <strong>{{ getPathTitle(path) }}</strong>
                  <p>{{ getPathSummary(path) || 'AI 正在生成学习路径' }}</p>
                  <div class="path-overview-card__progress-bar">
                    <div class="path-overview-card__progress-fill path-overview-card__progress-fill--loading"></div>
                  </div>
                  <div class="path-overview-card__actions-row">
                    <button class="btn btn-ghost" @click="loadPaths">查看进度</button>
                  </div>
                </template>

                <template v-else-if="getPathDisplayState(path) === 'attention'">
                  <div class="path-overview-card__status-row">
                    <span class="path-state-pill path-state-pill--failed">待重试</span>
                  </div>
                  <strong>{{ getPathTitle(path) }}</strong>
                  <p>{{ getFailureCopy(path) }}</p>
                  <div class="path-overview-card__actions-row">
                    <button class="btn btn-ghost" :disabled="retryingPathId === path.id" @click="retryPathGeneration(path)">重试</button>
                    <button class="btn btn-ghost" @click="confirmDelete(path)">删除</button>
                  </div>
                </template>

                <template v-else>
                  <div class="path-overview-card__status-row">
                    <span v-if="primaryPath?.id === path.id" class="path-state-pill path-state-pill--primary">主路径</span>
                    <span class="path-state-pill path-state-pill--active">进行中</span>
                    <span v-if="getEnrichmentStatus(path) === 'processing' || getEnrichmentStatus(path) === 'pending'" class="path-state-pill path-state-pill--soft">准备中</span>
                  </div>
                  <div class="path-overview-card__head">
                    <strong>{{ getPathTitle(path) }}</strong>
                    <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, path)">
                      <button class="more-btn" @click.stop>
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
                  <p>{{ getPathSummary(path) }}</p>
                  <div class="path-overview-card__stats">
                    <span>当前阶段：{{ getPathCurrentStage(path) }} / {{ getPathStageCount(path) }}</span>
                    <span>预计投入：{{ getPathEstimatedHours(path) }} 小时</span>
                  </div>
                  <div class="path-overview-card__progress-block">
                    <div class="path-overview-card__progress-top">
                      <strong>{{ getPathProgress(path) }}%</strong>
                      <span>进度</span>
                    </div>
                    <div class="path-overview-card__progress-bar">
                      <div class="path-overview-card__progress-fill" :style="{ width: `${getPathProgress(path)}%` }"></div>
                    </div>
                  </div>
                  <div class="path-overview-card__actions-row">
                    <button class="btn btn-primary" @click="goToPathDetail(path.id)">继续推进</button>
                    <button class="btn btn-ghost" @click="goToPathDetail(path.id)">查看详情</button>
                  </div>
                </template>
              </article>
            </div>

            <section v-else-if="!loading" class="paths-empty-state glass-card">
              <span class="pill">还没有路径</span>
              <h2>先把问题收敛清楚，再生成真正能开始的学习路径。</h2>
              <p>从一个真实任务开始，系统会帮你收敛目标、约束和时间窗口，再生成能立刻推进的路径。</p>
              <router-link to="/goal-conversation" class="btn btn-primary">开始新规划</router-link>
            </section>
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

    <el-dialog
      v-model="showRegenerateDialog"
      title="重新生成学习路径"
      width="460px"
      :close-on-click-modal="false"
      class="delete-dialog"
    >
      <el-alert
        title="将覆盖当前路径"
        type="info"
        :closable="false"
        show-icon
        class="delete-alert"
      >
        将基于当前目标重新生成该学习路径。已完成任务和学习记录不会被删除，但路径结构可能变化。
      </el-alert>

      <p class="delete-confirm-text">
        您确定要重新生成学习路径 <strong class="delete-path-name">{{ pathToRegenerate?.name || pathToRegenerate?.title }}</strong> 吗？
      </p>

      <template #footer>
        <el-button @click="showRegenerateDialog = false">取消</el-button>
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
import request from '../utils/request';
import { useUserStore } from '../stores/user';
import { learningAPI } from '../api/learning';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
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

// 前端提示超时阈值：4 分钟
const GENERATION_TIMEOUT_SECONDS = 240;

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

const enrichingPaths = computed(() =>
  paths.value.filter((p: any) => {
    const enrichmentStatus = p?.generationStatus?.enrichment;
    return p.status === 'active' && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing');
  })
);

// 超时的路径（前端判定，不影响数据库）
const timeoutPaths = computed(() =>
  generatingPaths.value.filter((p: any) => isPathTimeout(p))
);

const getPathTitle = (path: any) => path.name || path.title || '未命名路径';

const getPathSummary = (path: any) => path.summary || path.description || '这条路径还在整理中，建议先从最接近真实场景的一步开始推进。';

const getPathStageCount = (path: any) => path.totalMilestones || path.milestones?.length || path.weeks?.length || 0;

const getPathCurrentStage = (path: any) => {
  if (typeof path.currentStage === 'number') return path.currentStage;
  if (typeof path.currentMilestoneIndex === 'number') return path.currentMilestoneIndex + 1;
  if (typeof path.currentMilestoneOrder === 'number') return path.currentMilestoneOrder;
  return getPathStageCount(path) > 0 ? 1 : 0;
};

const getPathEstimatedHours = (path: any) => {
  const value = path.estimatedHours || path.totalEstimatedHours || path.hours || 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
};

const getPathProgress = (path: any) => {
  if (typeof path.progress === 'number') return Math.max(0, Math.min(100, Math.round(path.progress)));
  if (typeof path.progressPercentage === 'number') return Math.max(0, Math.min(100, Math.round(path.progressPercentage)));
  if (typeof path.completionRate === 'number') return Math.max(0, Math.min(100, Math.round(path.completionRate * 100)));
  const total = getPathStageCount(path);
  const current = getPathCurrentStage(path);
  if (total > 0 && current > 0) {
    return Math.max(0, Math.min(100, Math.round(((current - 1) / total) * 100)));
  }
  return 0;
};

const getPathDisplayState = (path: any) => {
  if (path.status === 'failed') return 'attention';
  if (path.status === 'generating') return isPathTimeout(path) ? 'attention' : 'generating';
  if (getEnrichmentStatus(path) === 'failed') return 'attention';
  if (getEnrichmentStatus(path) === 'processing' || getEnrichmentStatus(path) === 'pending') return 'generating';
  return 'active';
};

const getFailureCopy = (path: any) => {
  if (path.status === 'generating' && isPathTimeout(path)) {
    return path.description || '这条路径生成时间过长，建议重试或回到规划补充条件。';
  }
  return path.description || path.summary || '这条路径上次没有顺利生成，建议补充条件后再来一次。';
};

const sortedPaths = computed(() => {
  const priority = { active: 0, generating: 1, attention: 2 } as const;
  return [...paths.value].sort((a, b) => {
    const stateDiff = priority[getPathDisplayState(a)] - priority[getPathDisplayState(b)];
    if (stateDiff !== 0) return stateDiff;
    const updatedA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const updatedB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return updatedB - updatedA;
  });
});

const primaryPath = computed(() => sortedPaths.value.find((path: any) => getPathDisplayState(path) === 'active') || null);

const pathFilterChips = computed(() => {
  const list = sortedPaths.value;
  return [
    { key: 'all', label: '全部', count: list.length },
    { key: 'active', label: '进行中', count: list.filter((path: any) => getPathDisplayState(path) === 'active').length },
    { key: 'generating', label: '生成中', count: list.filter((path: any) => getPathDisplayState(path) === 'generating').length },
    { key: 'attention', label: '待重试', count: list.filter((path: any) => getPathDisplayState(path) === 'attention').length }
  ];
});

const visiblePaths = computed(() => {
  const list = sortedPaths.value;
  if (activePathFilter.value === 'all') return list;
  return list.filter((path: any) => getPathDisplayState(path) === activePathFilter.value);
});

// 检查是否有正在生成的路径
const checkGeneratingPath = () => {
  return generatingPaths.value.length > 0 || enrichingPaths.value.length > 0;
};

// 轮询更新生成中的路径
let pollingTimer: number | null = null;
const startPolling = () => {
  if (pollingTimer) return;
  pollingTimer = window.setInterval(async () => {
    if (generatingPaths.value.length > 0 || enrichingPaths.value.length > 0) {
      // 检查超时（只提示一次）
        timeoutPaths.value.forEach((timeoutPath: any) => {
          if (!notifiedTimeoutIds.has(timeoutPath.id)) {
          toast.warning('学习路径生成时间较长，请稍候或重试');
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
              toast.success('学习路径生成完成！');
              notifiedTimeoutIds.delete(genPath.id);
            } else if (updatedPath.status === 'failed') {
              toast.error('学习路径生成失败，请返回目标对话重试。');
              notifiedTimeoutIds.delete(genPath.id);
            }
          }
        });
        
        paths.value = newPaths;
        
        // 如果没有生成中的路径或准备中的路径了，停止轮询
        if (!newPaths.some((p: any) => {
          const enrichmentStatus = p?.generationStatus?.enrichment;
          return p.status === 'generating'
            || (p.status === 'active' && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing'));
        })) {
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
    toast.success('已退出登录');
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
    toast.error(error.response?.data?.error?.message || '加载学习路径失败');
  } finally {
    loading.value = false;
  }
};

const handleCommand = (command: string, path: any) => {
  if (command === 'regenerate') {
    confirmRegenerate(path);
  } else if (command === 'delete') {
    confirmDelete(path);
  }
};

const getEnrichmentStatus = (path: any) => path?.generationStatus?.enrichment || null;

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
  if (!pathToRegenerate.value) return;

  regenerating.value = true;
  try {
    await learningAPI.regeneratePath(pathToRegenerate.value.id);

    const index = paths.value.findIndex(p => p.id === pathToRegenerate.value.id);
    if (index !== -1) {
      paths.value[index] = {
        ...paths.value[index],
        status: 'generating',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    notifiedTimeoutIds.delete(pathToRegenerate.value.id);
    showRegenerateDialog.value = false;
    toast.success('正在重新生成学习路径...');

    if (!pollingTimer) {
      startPolling();
    }
  } catch (error: any) {
    console.error('重新生成学习路径失败:', error);
    toast.error(error.response?.data?.error?.message || '重新生成学习路径失败');
  } finally {
    regenerating.value = false;
    pathToRegenerate.value = null;
  }
};

const goToPathDetail = (id: string) => {
  router.push(`/learning-path/${id}`);
};

// 重试生成失败的路径
const retryPathGeneration = async (path: any) => {
  if (!path.description) {
    toast.error('路径描述缺失，请通过目标对话重新创建');
    return;
  }

  retryingPathId.value = path.id;
  try {
    await request.patch(`/learning/paths/${path.id}/retry`);
    
    const index = paths.value.findIndex(p => p.id === path.id);
    if (index !== -1) {
      paths.value[index] = {
        ...paths.value[index],
        status: 'generating',
        createdAt: new Date().toISOString()
      };
    }
    notifiedTimeoutIds.delete(path.id);
    
    toast.success('正在重新生成学习路径...');
    
    if (!pollingTimer) {
      startPolling();
    }
  } catch (error: any) {
    console.error('重试生成失败:', error);
    toast.error(error.response?.data?.error?.message || '重试生成失败，请稍后重试');
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
    // 如果有正在生成或准备中的路径，启动轮询
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
  animation: progress-loading 2s ease-in-out infinite;
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

@keyframes progress-loading {
  0% { width: 0%; transform: translateX(-100%); }
  50% { width: 100%; transform: translateX(0); }
  100% { width: 100%; transform: translateX(100%); }
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
  gap: 14px;
  min-height: 280px;
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

.path-overview-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  font-size: 13px;
  color: #66758d;
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

.path-overview-card__progress-fill--loading {
  width: 42%;
  animation: progress-pulse 2s ease-in-out infinite;
}

@keyframes progress-pulse {
  0%, 100% { width: 24%; opacity: 0.72; }
  50% { width: 68%; opacity: 1; }
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

[data-theme="dark"] .paths-hero h1,
[data-theme="dark"] .path-overview-card strong,
[data-theme="dark"] .paths-empty-state h2,
[data-theme="dark"] .paths-filter-chip strong,
[data-theme="dark"] .btn-ghost {
  color: #e2e8f0;
}

[data-theme="dark"] .paths-hero p,
[data-theme="dark"] .path-overview-card p,
[data-theme="dark"] .paths-empty-state p,
[data-theme="dark"] .paths-filter-chip,
[data-theme="dark"] .path-overview-card__stats,
[data-theme="dark"] .path-overview-card__progress-top span {
  color: #94a3b8;
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
</style>
