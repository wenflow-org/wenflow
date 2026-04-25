<template>
  <div class="learning-path-detail-page">
    <!-- 动态背景 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="dashboard-header" :class="{ 'header-scrolled': headerScrolled }">
      <div class="header-container">
        <div class="header-left">
          <div class="brand" @click="$router.push('/dashboard')">
            <span class="brand-icon">🎓</span>
            <span class="brand-text">问流 WenFlow</span>
          </div>
        </div>

        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-item">
            <el-icon><HomeFilled /></el-icon>
            <span>首页</span>
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
          <el-dropdown class="user-dropdown">
            <div class="user-avatar">
              <img v-if="userStore.user?.avatarUrl" :src="userStore.user.avatarUrl" alt="avatar" />
              <div v-else class="avatar-placeholder">
                {{ userStore.user?.name?.charAt(0) || 'U' }}
              </div>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
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
    </header>

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="content-container">
        <!-- 面包屑导航 -->
        <div class="breadcrumb-section">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item @click="$router.push('/learning-paths')" class="breadcrumb-link">学习路径</el-breadcrumb-item>
            <el-breadcrumb-item>{{ path?.name || '加载中...' }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading && !path" class="loading-state">
          <el-empty description="加载中...">
            <el-icon class="loading-icon"><Loading /></el-icon>
          </el-empty>
        </div>

        <div v-else-if="path" class="path-content">
          <!-- 路径信息卡片 -->
          <section class="path-info-section">
            <div class="path-info-card glass-card">
              <div class="card-header">
                <div class="header-main">
                  <h1 class="path-title">{{ path.name }}</h1>
                  <p class="path-description">{{ path.summary || path.description }}</p>
                </div>
                <div class="progress-ring-wrapper">
                  <div class="progress-ring" :style="{ '--progress': completionRate }">
                    <div class="progress-inner">
                      <span class="progress-value">{{ completionRate }}%</span>
                      <span class="progress-label">完成度</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="path-meta">
                <div class="meta-item">
                  <div class="meta-icon icon-calendar">
                    <el-icon><Calendar /></el-icon>
                  </div>
                  <div class="meta-info">
                    <span class="meta-value">{{ path.totalMilestones || path.totalStages || path.totalWeeks || 0 }}</span>
                    <span class="meta-label">阶段</span>
                  </div>
                </div>
                <div class="meta-item">
                  <div class="meta-icon icon-clock">
                    <el-icon><Clock /></el-icon>
                  </div>
                  <div class="meta-info">
                    <span class="meta-value">{{ formatHours(path.estimatedHours) }}</span>
                    <span class="meta-label">小时</span>
                  </div>
                </div>
                <div class="meta-item">
                  <div class="meta-icon icon-folder">
                    <el-icon><Folder /></el-icon>
                  </div>
                  <div class="meta-info">
                    <span class="meta-value">{{ path.subject }}</span>
                    <span class="meta-label">方向</span>
                  </div>
                </div>
                <div class="meta-item">
                  <div class="meta-icon icon-tasks">
                    <el-icon><CircleCheck /></el-icon>
                  </div>
                  <div class="meta-info">
                    <span class="meta-value">{{ completedTasks }}</span>
                    <span class="meta-label">/ {{ totalTasks }} 任务</span>
                  </div>
                </div>
              </div>

              <div v-if="path.replanLineage?.sourcePathId" class="replan-lineage-banner">
                <strong>重调版本</strong>
                <span>
                  源路径：{{ path.replanLineage.sourcePathId }}
                  <template v-if="path.replanLineage.replanMode"> · 模式：{{ path.replanLineage.replanMode }}</template>
                  <template v-if="path.replanLineage.triggerSource"> · 来源：{{ path.replanLineage.triggerSource }}</template>
                </span>
              </div>

              <div
                v-if="showEnrichmentBanner"
                class="enrichment-banner"
                :class="`enrichment-banner-${enrichmentStatus || 'unknown'}`"
              >
                <div class="enrichment-banner-copy">
                  <strong>{{ enrichmentBannerTitle }}</strong>
                  <span>{{ enrichmentBannerMessage }}</span>
                </div>
                <el-button
                  v-if="enrichmentStatus === 'failed'"
                  type="primary"
                  size="small"
                  :loading="retryingEnrichment"
                  @click="retryEnrichment"
                >
                  继续完善
                </el-button>
              </div>
            </div>
          </section>

          <!-- 阶段任务列表 -->
          <section class="weeks-section">
            <h2 class="section-title">
              <span class="section-icon">📚</span>
              学习内容
            </h2>

            <div class="weeks-container">
              <div
                v-for="(week, index) in (path.milestones || path.weeks || [])"
                :key="week.id"
                class="week-card glass-card"
                :class="{ 'week-expanded': activeWeeks.includes(week.stageNumber || week.weekNumber) }"
              >
                <!-- 阶段标题栏 -->
                <div class="week-header" @click="toggleWeek(week)">
                  <div class="week-title-wrapper">
                    <div class="week-number">阶段 {{ week.stageNumber || week.weekNumber }}</div>
                    <div class="week-title">{{ week.title }}</div>
                  </div>
                  <div class="week-meta">
                    <div class="week-progress">
                      <div class="progress-bar">
                        <div class="progress-fill" :style="{ width: getWeekProgress(week) + '%' }"></div>
                      </div>
                      <span class="progress-text">{{ getWeekCompletedCount(week) }}/{{ (week.subtasks || week.tasks || []).length }}</span>
                    </div>
                    <el-icon class="expand-icon"><ArrowDown /></el-icon>
                  </div>
                </div>

                <!-- 阶段内容 -->
                <div v-show="activeWeeks.includes(week.stageNumber || week.weekNumber)" class="week-content">
                  <p class="week-description">{{ week.description || week.goal }}</p>

                  <!-- 学习目标 -->
                  <div
                    v-if="enrichmentStatus !== 'succeeded'"
                    class="week-pending-note"
                  >
                    {{ enrichmentPendingHint }}
                  </div>
                  <div
                    v-if="week.learningObjectives && week.learningObjectives.length > 0"
                    class="learning-objectives"
                  >
                    <h4 class="objectives-title">
                      <el-icon><Aim /></el-icon>
                      学习目标
                    </h4>
                    <ul class="objectives-list">
                      <li v-for="(obj, index) in week.learningObjectives" :key="index">
                        <span class="objective-check">✓</span>
                        {{ obj }}
                      </li>
                    </ul>
                  </div>

                  <!-- 任务列表 -->
                  <div class="tasks-list">
                    <div
                      v-for="task in (week.subtasks || week.tasks || [])"
                      :key="task.id"
                      class="task-card"
                      :class="{
                        'task-completed': task.status === 'completed',
                        'task-locked': !canStartLearning && task.status !== 'completed'
                      }"
                      @click="openTaskDetail(task)"
                    >
                      <div class="task-status-icon">
                        <el-icon v-if="task.status === 'completed'"><CircleCheck /></el-icon>
                        <el-icon v-else-if="task.status === 'in_progress'"><Loading /></el-icon>
                        <span v-else class="status-dot"></span>
                      </div>

                      <div class="task-info">
<div class="task-header">
                            <h4 class="task-title">{{ task.title }}</h4>
                            <div class="task-tags">
                              <el-tag :type="getStatusType(task.status)" size="small">
                                {{ getStatusText(task.status) }}
                              </el-tag>
                              <el-tag type="info" size="small" effect="light">
                                {{ getTaskTypeText(task.taskType) }}
                              </el-tag>
                              <el-tag 
                                v-if="task.knowledgeType" 
                                :color="getKnowledgeTypeColor(task.knowledgeType)"
                                size="small"
                                effect="light"
                              >
                                {{ getKnowledgeTypeLabel(task.knowledgeType) }}
                              </el-tag>
                              <el-tag 
                                v-if="task.cognitiveLevel" 
                                :color="getCognitiveLevelColor(task.cognitiveLevel)"
                                size="small"
                                effect="light"
                              >
                                {{ getCognitiveLevelLabel(task.cognitiveLevel) }}
                              </el-tag>
                              <span v-if="task.displayLabel" class="display-label">
                                {{ task.displayLabel }}
                              </span>
                            </div>
                          </div>
                        <p class="task-desc">{{ task.description }}</p>
                          <div class="task-footer">
                            <div class="task-time">
                              <el-icon><Clock /></el-icon>
                              <span>预计 {{ task.estimatedMinutes }} 分钟</span>
                              <span v-if="task.actualMinutes !== null && task.actualMinutes !== undefined" class="actual-time">
                                | {{ task.status === 'completed' ? '实际' : '已学习' }} {{ formatActualMinutes(task.actualMinutes) }} 分钟
                              </span>
                            </div>
                          <div v-if="task.status === 'completed'" class="completed-actions">
                            <button class="task-btn btn-completed" disabled>
                              <el-icon><Check /></el-icon>
                              已完成
                            </button>
                            <button v-if="task.hasTeachingWrapup" class="task-btn btn-review" @click.stop="viewTaskEvaluation(task)">
                              <el-icon><DataAnalysis /></el-icon>
                              查看当堂评估
                            </button>
                          </div>
                          <div v-else-if="task.status === 'in_progress'" class="completed-actions">
                            <button
                              class="task-btn btn-start"
                              :disabled="!canStartLearning"
                              @click.stop="startTask(task)"
                            >
                              {{ canStartLearning ? '继续学习' : '等待标注完成' }}
                              <el-icon><ArrowRight /></el-icon>
                            </button>
                            <button v-if="task.hasTeachingWrapup" class="task-btn btn-review" @click.stop="viewTaskEvaluation(task)">
                              <el-icon><DataAnalysis /></el-icon>
                              查看最近一节评估
                            </button>
                          </div>
                          <button v-else
                            class="task-btn btn-start"
                            :disabled="!canStartLearning"
                            @click.stop="startTask(task)"
                          >
                            {{ canStartLearning ? '开始学习' : '等待标注完成' }}
                            <el-icon><ArrowRight /></el-icon>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-else class="empty-state glass-card">
          <el-empty description="未找到学习路径" />
          <button class="btn btn-primary" @click="$router.push('/learning-paths')">
            返回学习路径列表
          </button>
        </div>
      </div>
    </main>

    <el-dialog
      v-model="evaluationDialogVisible"
      title="当堂评估"
      width="640px"
      :close-on-click-modal="false"
    >
      <div v-loading="evaluationLoading" class="evaluation-dialog-content">
        <CompletionCard
          v-if="selectedTaskEvaluation"
          :topic="selectedTaskEvaluation.topic"
          :mastered-count="selectedTaskEvaluation.knowledgePoints.filter(kp => kp.status === 'mastered').length"
          :total-count="selectedTaskEvaluation.knowledgePoints.length"
          :duration="formatSessionDuration(selectedTaskEvaluation.duration)"
          :message-count="selectedTaskEvaluation.messageCount"
          :wrapup="selectedTaskEvaluation.wrapup"
          :advisory="selectedTaskEvaluation.advisory"
          @action="closeEvaluationDialog"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  HomeFilled,
  FolderOpened,
  TrendCharts,
  Trophy,
  User,
  Switch,
  Calendar,
  Clock,
  Folder,
  Aim,
  ArrowDown,
  ArrowRight,
  CircleCheck,
  Loading,
  Check,
  DataAnalysis,
} from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import CompletionCard from '../components/CompletionCard.vue';
import api from '../utils/api';
import { aiTeachingAPI } from '@/api/aiTeaching';
import type { TaskEvaluationDetail } from '@/api/aiTeaching';
import { learningAPI } from '@/api/learning';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const pathId = route.params.id as string;

const headerScrolled = ref(false);
const loading = ref(true);
const path = ref<any>(null);
const activeWeeks = ref<number[]>([1]);
const evaluationDialogVisible = ref(false);
const evaluationLoading = ref(false);
const selectedTaskEvaluation = ref<TaskEvaluationDetail | null>(null);
const retryingEnrichment = ref(false);
let enrichmentPollingTimer: number | null = null;
let enrichmentPollingInFlight = false;

// 计算属性
const totalTasks = computed(() => {
  const milestones = path.value?.milestones || path.value?.weeks || [];
  return milestones.reduce((sum: number, milestone: any) => {
    return sum + (milestone.subtasks?.length || milestone.tasks?.length || 0);
  }, 0);
});

const completedTasks = computed(() => {
  const milestones = path.value?.milestones || path.value?.weeks || [];
  return milestones.reduce((sum: number, milestone: any) => {
    const tasks = milestone.subtasks || milestone.tasks || [];
    return sum + tasks.filter((t: any) => t.status === 'completed').length;
  }, 0);
});

const completionRate = computed(() => {
  if (totalTasks.value === 0) return 0;
  return Math.round((completedTasks.value / totalTasks.value) * 100);
});

const generationStatus = computed(() => path.value?.generationStatus || null);
const enrichmentStatus = computed(() => generationStatus.value?.enrichment || null);
const canStartLearning = computed(() => path.value?.canStartLearning !== false);
const showEnrichmentBanner = computed(() => path.value?.status === 'active' && enrichmentStatus.value && enrichmentStatus.value !== 'succeeded');
const enrichmentBannerTitle = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') {
    return '学习内容准备中';
  }

  if (enrichmentStatus.value === 'failed') {
    return '学习内容继续完善中';
  }

  return '学习内容状态未知';
});
const enrichmentBannerMessage = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') {
    return '路径已经生成，系统正在后台准备学习内容。完成前暂不能开始学习，你可以先离开当前页面，稍后再回来查看。';
  }

  if (enrichmentStatus.value === 'failed') {
    return path.value?.learningBlockedReason || '系统正在继续完善学习内容。你也可以现在手动继续完善，无需停留在当前页面。';
  }

  return path.value?.learningBlockedReason || '学习内容状态暂不可用，请稍后刷新页面。';
});
const enrichmentPendingHint = computed(() => {
  if (enrichmentStatus.value === 'failed') {
    return '这一阶段的学习内容还没准备完整，请稍后再回来开始学习。';
  }

  return '这一阶段的学习内容仍在准备中，完成后就可以开始学习。';
});

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

const handleScroll = () => {
  headerScrolled.value = window.scrollY > 50;
};

const loadPathData = async () => {
  if (!path.value) {
    loading.value = true;
  }
  try {
    const response = await api.get(`/learning/paths/${pathId}`);
    path.value = response.data;

    // 兼容 weeks 和 milestones 两种数据格式
    if (path.value.milestones && !path.value.weeks) {
      path.value.weeks = path.value.milestones.map((m: any) => ({
        ...m,
        weekNumber: m.stageNumber,
        tasks: m.subtasks
      }));
    }

    // 解析学习目标的 JSON
    if (path.value.weeks) {
      path.value.weeks.forEach((week: any) => {
        if (week.learningObjectives) {
          try {
            week.learningObjectives = JSON.parse(week.learningObjectives);
          } catch (e) {
            week.learningObjectives = [];
          }
        }
      });
    }

    if (path.value?.generationStatus?.enrichment === 'processing' || path.value?.generationStatus?.enrichment === 'pending') {
      startEnrichmentPolling();
    } else {
      stopEnrichmentPolling();
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error?.message || '加载路径详情失败');
  } finally {
    loading.value = false;
  }
};

const toggleWeek = (week: any) => {
  const weekNumber = week.stageNumber || week.weekNumber;
  const index = activeWeeks.value.indexOf(weekNumber);
  if (index > -1) {
    activeWeeks.value.splice(index, 1);
  } else {
    activeWeeks.value.push(weekNumber);
  }
};

const openTaskDetail = (task: any) => {
  if (!canStartLearning.value && task.status !== 'completed') {
    ElMessage.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push(`/learn/${task.id}`);
};

// 点击"开始学习"按钮
const startTask = (task: any) => {
  if (!canStartLearning.value) {
    ElMessage.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push(`/learn/${task.id}`);
};

const retryEnrichment = async () => {
  if (!path.value?.id) return;

  retryingEnrichment.value = true;
  try {
    await learningAPI.retryPathEnrichment(path.value.id);
    ElMessage.success('已在后台继续完善学习内容，无需停留当前页面。');
    await loadPathData();
  } catch (error: any) {
    ElMessage.error(error.message || '继续完善学习内容失败');
  } finally {
    retryingEnrichment.value = false;
  }
};

const startEnrichmentPolling = () => {
  if (enrichmentPollingTimer) return;

  enrichmentPollingTimer = window.setInterval(async () => {
    if (enrichmentPollingInFlight) return;

    if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') {
      enrichmentPollingInFlight = true;
      try {
        await loadPathData();
      } finally {
        enrichmentPollingInFlight = false;
      }
      return;
    }

    stopEnrichmentPolling();
  }, 3000);
};

const stopEnrichmentPolling = () => {
  if (enrichmentPollingTimer) {
    clearInterval(enrichmentPollingTimer);
    enrichmentPollingTimer = null;
  }
};

const formatSessionDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
  }
  return `${mins.toString().padStart(2, '0')}:00`;
};

const closeEvaluationDialog = () => {
  evaluationDialogVisible.value = false;
};

const viewTaskEvaluation = async (task: any) => {
  evaluationLoading.value = true;
  evaluationDialogVisible.value = true;
  selectedTaskEvaluation.value = null;

  try {
    const result = await aiTeachingAPI.getLatestTaskEvaluation(task.id);
    if (!result) {
      ElMessage.warning('暂无当堂评估记录');
      evaluationDialogVisible.value = false;
      return;
    }
    selectedTaskEvaluation.value = result;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || error.message || '获取当堂评估失败');
    evaluationDialogVisible.value = false;
  } finally {
    evaluationLoading.value = false;
  }
};

const getWeekProgress = (week: any) => {
  const tasks = week.subtasks || week.tasks || [];
  if (!tasks || tasks.length === 0) return 0;
  const completed = tasks.filter((t: any) => t.status === 'completed').length;
  return Math.round((completed / tasks.length) * 100);
};

const getWeekCompletedCount = (week: any) => {
  const tasks = week.subtasks || week.tasks || [];
  return tasks.filter((t: any) => t.status === 'completed').length;
};

const formatHours = (hours: number) => {
  return Math.round(hours);
};

const formatActualMinutes = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return '--';
  }

  return Math.max(0, Math.round(minutes));
};

const getStatusType = (status: string) => {
  const statusMap: Record<string, any> = {
    todo: 'info',
    in_progress: 'warning',
    completed: 'success',
    skipped: 'danger'
  };
  return statusMap[status] || 'info';
};

const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    todo: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    skipped: '已跳过'
  };
  return statusMap[status] || status;
};

const getTaskTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    reading: '阅读',
    practice: '练习',
    project: '项目',
    quiz: '测验'
  };
  return typeMap[type] || type;
};

const getKnowledgeTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    factual: '知识点',
    conceptual: '原理理解',
    procedural: '动手操作',
    metacognitive: '反思总结'
  };
  return labels[type] || type;
};

const getKnowledgeTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    factual: '#909399',
    conceptual: '#409EFF',
    procedural: '#E6A23C',
    metacognitive: '#F56C6C'
  };
  return colors[type] || '#909399';
};

const getCognitiveLevelLabel = (level: string) => {
  const labels: Record<string, string> = {
    remember: '了解',
    understand: '搞懂',
    apply: '实战',
    analyze: '拆解',
    evaluate: '决策',
    create: '创造'
  };
  return labels[level] || level;
};

const getCognitiveLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    remember: '#C0C4CC',
    understand: '#909399',
    apply: '#67C23A',
    analyze: '#E6A23C',
    evaluate: '#F56C6C',
    create: '#409EFF'
  };
  return colors[level] || '#909399';
};

onMounted(() => {
  loadPathData();
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  stopEnrichmentPolling();
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.learning-path-detail-page {
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

.header-container {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
}

.brand {
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

/* ========== 主内容区 ========== */
.main-content {
  position: relative;
  z-index: 1;
  padding: 2rem;
}

.content-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* ========== 面包屑 ========== */
.breadcrumb-section {
  margin-bottom: 1.5rem;
}

.breadcrumb-link {
  cursor: pointer;
  color: var(--color-primary);
}

.breadcrumb-link:hover {
  text-decoration: underline;
}

/* ========== 加载状态 ========== */
.loading-state {
  padding: 4rem;
  text-align: center;
}

.loading-icon {
  font-size: 2rem;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ========== 路径信息卡片 ========== */
.path-info-section {
  margin-bottom: 2rem;
}

.path-info-card {
  padding: 2rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2rem;
  margin-bottom: 1.5rem;
}

.header-main {
  flex: 1;
}

.path-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
}

.path-description {
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1.6;
  margin: 0;
}

/* 环形进度 */
.progress-ring-wrapper {
  flex-shrink: 0;
}

.progress-ring {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: conic-gradient(
    var(--color-primary) calc(var(--progress) * 3.6deg),
    var(--bg-muted) 0deg
  );
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.progress-inner {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.progress-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1;
}

.progress-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* 元信息 */
.path-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-light);
}

.enrichment-banner {
  margin-top: 1rem;
  border-radius: var(--radius-xl);
  padding: 0.875rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.enrichment-banner-processing,
.enrichment-banner-pending {
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.22);
}

.enrichment-banner-failed {
  background: rgba(245, 108, 108, 0.08);
  border: 1px solid rgba(245, 108, 108, 0.22);
}

.enrichment-banner-copy {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.enrichment-banner-copy strong {
  color: var(--text-primary);
  font-size: 0.95rem;
}

.enrichment-banner-copy span {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .path-meta {
    grid-template-columns: repeat(2, 1fr);
  }
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.meta-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: white;
}

.icon-calendar {
  background: var(--gradient-primary);
}

.icon-clock {
  background: var(--gradient-warning);
}

.icon-folder {
  background: linear-gradient(135deg, #88d6a8 0%, #63c48d 100%);
}

.icon-tasks {
  background: var(--gradient-achievement);
}

.meta-info {
  display: flex;
  flex-direction: column;
}

.meta-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.meta-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ========== 周次区域 ========== */
.weeks-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 1.25rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-icon {
  font-size: 1.5rem;
}

.weeks-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.week-card {
  overflow: hidden;
  transition: all 0.3s ease;
}

.week-card:hover {
  box-shadow: var(--shadow-lg);
}

.week-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.week-header:hover {
  background: var(--bg-muted);
}

.week-title-wrapper {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.week-number {
  padding: 0.375rem 0.875rem;
  background: var(--gradient-primary);
  color: white;
  border-radius: var(--radius-lg);
  font-size: 0.8125rem;
  font-weight: 600;
}

.week-title {
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}

.week-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.week-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-bar {
  width: 80px;
  height: 6px;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #9adfb5 0%, #6fc898 100%);
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 0.8125rem;
  color: var(--text-muted);
  min-width: 40px;
  text-align: right;
}

.expand-icon {
  font-size: 1.25rem;
  color: var(--text-muted);
  transition: transform 0.3s ease;
}

.week-expanded .expand-icon {
  transform: rotate(180deg);
}

/* 周内容 */
.week-content {
  padding: 0 1.5rem 1.5rem;
  border-top: 1px solid var(--border-light);
}

.week-description {
  color: var(--text-secondary);
  margin: 1.25rem 0;
  line-height: 1.6;
  font-size: 0.9375rem;
}

.week-pending-note {
  margin: 1rem 0;
  padding: 0.875rem 1rem;
  border-radius: var(--radius-lg);
  background: rgba(64, 158, 255, 0.06);
  border: 1px dashed rgba(64, 158, 255, 0.26);
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

/* 学习目标 */
.learning-objectives {
  background: var(--color-primary-lighter);
  padding: 1.25rem;
  border-radius: var(--radius-xl);
  margin-bottom: 1.25rem;
}

.objectives-title {
  margin: 0 0 0.875rem 0;
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.objectives-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.objectives-list li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
  color: var(--text-secondary);
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.objective-check {
  color: var(--color-success);
  font-weight: 700;
}

/* 任务列表 */
.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.task-card {
  display: flex;
  gap: 1rem;
  padding: 1.25rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.3s ease;
}

.task-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.task-card.task-completed {
  background: rgba(103, 194, 58, 0.08);
  border-color: rgba(103, 194, 58, 0.3);
}

.task-card.task-locked {
  opacity: 0.82;
}

.task-status-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.task-card.task-completed .task-status-icon {
  background: rgba(103, 194, 58, 0.14);
  color: #2f8f4f;
}

.task-card.task-locked:not(.task-completed):hover {
  border-color: var(--border-light);
  box-shadow: none;
  transform: none;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-muted);
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.task-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.task-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.display-label {
  font-size: 12px;
  color: #606266;
  background: #f4f4f5;
  padding: 2px 8px;
  border-radius: 4px;
}

.task-desc {
  margin: 0 0 0.875rem 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.task-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-time {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.actual-time {
  color: var(--text-secondary);
  font-weight: 500;
}

.task-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.completed-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-start {
  background: var(--gradient-primary);
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.btn-start:hover {
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  transform: translateY(-1px);
}

.btn-start:disabled {
  background: linear-gradient(135deg, #c8ceda 0%, #b2b9c6 100%);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

.btn-completed {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--text-on-success-light);
  cursor: default;
}

.btn-review {
  background: rgba(24, 144, 255, 0.08);
  border: 1px solid rgba(24, 144, 255, 0.25);
  color: #1166bb;
}

.btn-review:hover {
  background: rgba(24, 144, 255, 0.14);
}

.evaluation-dialog-content {
  min-height: 120px;
}

/* ========== 空状态 ========== */
.empty-state {
  padding: 4rem 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.replan-lineage-banner {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-primary-light) 14%, var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, var(--border-default));
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.replan-lineage-banner strong {
  font-size: 13px;
}

.replan-lineage-banner span {
  font-size: 13px;
  color: var(--text-secondary);
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

  .card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .progress-ring-wrapper {
    align-self: center;
  }

  .week-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .week-meta {
    width: 100%;
    justify-content: space-between;
  }

  .task-header {
    flex-direction: column;
    gap: 0.5rem;
  }

  .task-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
