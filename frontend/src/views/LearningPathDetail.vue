<template>
  <div class="learning-path-detail-page">
    <!-- 动态背景 -->
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="dashboard-header" :class="{ 'dashboard-header--scrolled': headerScrolled }">
      <div class="header-container">
<button type="button" class="brand" @click="router.push(dashboardPath)">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="应用导航">
          <router-link :to="dashboardPath" class="nav-item">{{ isTestMode ? '测试学习台' : '学习台' }}</router-link>
          <router-link :to="goalConversationPath" class="nav-item">{{ isTestMode ? '测试目标规划' : '目标规划' }}</router-link>
          <router-link :to="learningPathsBasePath" class="nav-item nav-item--active">{{ isTestMode ? '测试学习路径' : '学习路径' }}</router-link>
          <router-link :to="learningStatePath" class="nav-item">{{ isTestMode ? '测试学习状态' : '学习状态' }}</router-link>
          <router-link :to="achievementsPath" class="nav-item">{{ isTestMode ? '测试成就' : '成就' }}</router-link>
        </nav>

        <div class="header-right">
          <router-link :to="goalConversationPath" class="header-cta">{{ isTestMode ? '创建新测试目标' : '创建新目标' }}</router-link>
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
        <!-- 面包屑导航 -->
        <div class="breadcrumb-section">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item @click="$router.push(learningPathsBasePath)" class="breadcrumb-link">学习路径</el-breadcrumb-item>
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
            <div class="path-info-card path-detail-hero glass-card">
              <div class="card-header path-detail-hero__layout">
                <div class="header-main path-detail-hero__copy">
                  <div class="path-detail-hero__tags">
                    <span class="pill">学习路径</span>
                    <span class="path-detail-hero__tag">{{ pathStatusLabel }}</span>
                    <span v-if="path.subject" class="path-detail-hero__tag">{{ path.subject }}</span>
                  </div>
                  <h1 class="path-title">{{ path.name }}</h1>
                  <p class="path-description">{{ path.summary || path.description }}</p>
                  <div class="path-detail-overview-grid">
                    <article v-for="item in pathOverviewMetrics" :key="item.label" class="path-detail-overview-card">
                      <span>{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                    </article>
                  </div>
                </div>
                <div class="progress-ring-wrapper path-detail-hero__progress">
                  <div class="progress-ring path-detail-progress__ring" :style="{ '--progress': completionRate }">
                    <div class="progress-inner path-detail-progress__ring-label">
                      <span class="progress-value">{{ completionRate }}%</span>
                      <span class="progress-label">总进度</span>
                    </div>
                  </div>
                  <button class="btn btn-primary btn--full" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
                    {{ primaryActionLabel }}
                  </button>
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
                  继续生成阶段任务
                </el-button>
              </div>
            </div>
          </section>

          <section class="path-detail-main-grid">
            <section class="weeks-section">
              <div class="weeks-container">
                <div
                  v-for="week in (path.milestones || path.weeks || [])"
                  :key="week.id"
                  class="week-card glass-card"
                  :class="{ 'week-expanded': activeWeeks.includes(week.stageNumber || week.weekNumber) }"
                >
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

                  <div v-show="activeWeeks.includes(week.stageNumber || week.weekNumber)" class="week-content">
                    <p class="week-description">{{ week.description || week.goal }}</p>

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
                              <span v-if="getTaskConceptLabel(task)" class="display-label display-label--concept">
                                {{ getTaskConceptLabel(task) }}
                              </span>
                            </div>
                          </div>
                          <p class="task-desc">{{ task.description }}</p>
                          <p v-if="task.acceptanceCriteria" class="task-acceptance">
                            完成标准：{{ task.acceptanceCriteria }}
                          </p>
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
                                {{ canStartLearning ? '继续学习' : '等待阶段任务生成完成' }}
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
                              {{ canStartLearning ? '开始学习' : '等待阶段任务生成完成' }}
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

            <aside class="path-detail-sidebar">
              <article class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">本周学习建议</span>
                  <h2>本周学习建议</h2>
                </div>
                <div class="path-detail-side-card__time">预计总投入：{{ currentStageEffortText }}</div>
                <ul class="path-detail-note-list">
                  <li v-for="item in pathDetailNotes" :key="item">{{ item }}</li>
                </ul>
              </article>

              <article class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">下一步</span>
                  <h2>当前最值得先完成的任务</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="item in pathDetailPlan" :key="item.title" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>
                <button class="btn btn-primary btn--full" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
                  {{ primaryActionLabel }}
                </button>
              </article>

              <article class="glass-card path-detail-side-card path-detail-side-card--light">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">节奏提示</span>
                  <h2>当前建议学习节奏</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="item in paceSuggestionCards" :key="item.title" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>
              </article>

              <article v-if="pathSceneCards.length > 0" class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">路径设计意图</span>
                  <h2>这条路径先解决什么</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="item in pathSceneCards" :key="item.title" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>
                <div v-if="pathSceneMetaChips.length > 0" class="path-detail-chip-row path-detail-chip-row--wrap">
                  <span v-for="item in pathSceneMetaChips" :key="item" class="path-detail-chip">{{ item }}</span>
                </div>
              </article>

              <article v-if="cognitiveConceptCards.length > 0 || path?.cognitiveDesign?.cognitiveDomain" class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">认知骨架</span>
                  <h2>这条路径在训练什么</h2>
                </div>
                <div v-if="path?.cognitiveDesign?.cognitiveDomain" class="path-detail-domain-block">
                  <span>认知域</span>
                  <strong>{{ path.cognitiveDesign.cognitiveDomain }}</strong>
                </div>
                <div v-if="cognitiveConceptCards.length > 0" class="path-detail-plan-list">
                  <article v-for="item in cognitiveConceptCards" :key="item.title" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>
              </article>
            </aside>
          </section>
        </div>

        <div v-else class="empty-state glass-card">
          <el-empty description="未找到学习路径" />
          <button class="btn btn-primary" @click="$router.push(learningPathsBasePath)">
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
import { ref, computed, onMounted, onUnmounted, onActivated } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '../utils/toast';
import {
  User,
  Switch,
  Clock,
  Aim,
  ArrowDown,
  ArrowRight,
  CircleCheck,
  Loading,
  Check,
  DataAnalysis,
} from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user';
import CompletionCard from '../components/CompletionCard.vue';
import api from '../utils/api';
import { aiTeachingAPI } from '@/api/aiTeaching';
import type { TaskEvaluationDetail } from '@/api/aiTeaching';
import { learningAPI } from '@/api/learning';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const pathId = route.params.id as string;
const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const goalConversationPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/goal-full' : '/test/goal-full';
  }
  return '/goal-conversation';
});
const learningPathsBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-paths' : '/test/learning-paths';
  }
  return '/learning-paths';
});
const dashboardPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/dashboard' : '/dashboard';
  }
  return '/dashboard';
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

const pathStatusLabel = computed(() => {
  const status = path.value?.status;
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'draft' || status === 'generating') return '生成中';
  return '规划中';
});

const pathOverviewMetrics = computed(() => {
  return [
    { label: '阶段数', value: String(path.value?.totalMilestones || path.value?.totalStages || path.value?.totalWeeks || 0) },
    { label: '预计投入', value: `${formatHours(path.value?.estimatedHours || 0)} 小时` },
    { label: '当前阶段', value: (() => {
      const stages = pathStages.value;
      const idx = stages.findIndex((s: any) => s === activeStage.value);
      return idx >= 0 ? `第 ${idx + 1} 阶段` : '待开始';
    })() },
    { label: '任务进度', value: `${completedTasks.value}/${totalTasks.value}` }
  ];
});

const generationStatus = computed(() => path.value?.generationStatus || null);
const enrichmentStatus = computed(() => generationStatus.value?.stageDesign || null);
const canStartLearning = computed(() => path.value?.canStartLearning !== false);
const showEnrichmentBanner = computed(() => path.value?.status === 'active' && enrichmentStatus.value && enrichmentStatus.value !== 'succeeded');
const enrichmentBannerTitle = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') {
    return '阶段任务生成中';
  }

  if (enrichmentStatus.value === 'failed') {
    return '阶段任务继续生成中';
  }

  return '阶段任务状态未知';
});
const enrichmentBannerMessage = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') {
    return '路径骨架已经生成，系统正在后台展开当前阶段任务。完成前暂不能开始学习，你可以先离开当前页面，稍后再回来查看。';
  }

  if (enrichmentStatus.value === 'failed') {
    return path.value?.learningBlockedReason || '系统正在继续生成阶段任务。你也可以现在手动继续生成，无需停留在当前页面。';
  }

  return path.value?.learningBlockedReason || '阶段任务状态暂不可用，请稍后刷新页面。';
});
const enrichmentPendingHint = computed(() => {
  if (enrichmentStatus.value === 'failed') {
    return '这一阶段的任务还没生成完整，请稍后再回来开始学习。';
  }

  return '这一阶段的任务仍在生成中，完成后就可以开始学习。';
});

const pathStages = computed(() => path.value?.milestones || path.value?.weeks || []);

const normalizeTaskList = (stage: any) => stage?.subtasks || stage?.tasks || [];

const activeStage = computed(() => {
  const stages = pathStages.value;
  if (!stages.length) return null;

  return stages.find((stage: any) => {
    const tasks = normalizeTaskList(stage);
    return tasks.some((task: any) => task.status !== 'completed');
  }) || stages[0];
});

const activeStageTasks = computed(() => normalizeTaskList(activeStage.value));

const primaryActionTask = computed(() => {
  return activeStageTasks.value.find((task: any) => task.status === 'todo')
    || activeStageTasks.value.find((task: any) => task.status === 'in_progress')
    || null;
});

const primaryActionLabel = computed(() => {
  if (!canStartLearning.value) return '等待阶段任务生成完成';
  return primaryActionTask.value?.status === 'in_progress' ? '继续学习' : '开始学习';
});

const nextActionTasks = computed(() => {
  const upcoming = activeStageTasks.value.filter((task: any) => task.status !== 'completed');
  return (upcoming.length > 0 ? upcoming : activeStageTasks.value).slice(0, 3);
});

const currentStageEffortMinutes = computed(() => {
  return nextActionTasks.value.reduce((sum: number, task: any) => sum + Math.max(0, Number(task.estimatedMinutes) || 0), 0);
});

const currentStageEffortText = computed(() => {
  const minutes = currentStageEffortMinutes.value;
  if (minutes <= 0) return '按当前任务推进';
  return `${minutes} 分钟`;
});

const paceRangeText = computed(() => {
  const taskMinutes = nextActionTasks.value
    .map((task: any) => Math.max(0, Number(task.estimatedMinutes) || 0))
    .filter((value: number) => value > 0);

  if (taskMinutes.length === 0) return '单次 20-25 分钟';

  const min = Math.max(15, Math.min(...taskMinutes));
  const max = Math.max(min, Math.max(...taskMinutes));
  if (max - min <= 5) return `单次 ${min}-${Math.max(min + 5, max)} 分钟`;
  return `单次 ${min}-${max} 分钟`;
});

const pathDetailNotes = computed(() => {
  const notes: string[] = [];
  const stage = activeStage.value;
  const stageSummary = stage?.description || stage?.goal;
  if (stageSummary) {
    notes.push(`这一阶段先围绕「${stageSummary}」推进，不用同时展开太多分支。`);
  }

  const objectives = Array.isArray(stage?.learningObjectives) ? stage.learningObjectives.filter(Boolean) : [];
  if (objectives.length > 0) {
    notes.push(`优先把「${objectives[0]}」落成一个可验证结果，再继续扩展。`);
  }

  if (nextActionTasks.value.length > 0) {
    notes.push(`每完成一个任务，就顺手记录这一步遇到的真实问题，方便下一轮补强。`);
  }

  if (!canStartLearning.value) {
    notes.push('当前阶段任务还在生成中，先浏览阶段目标与任务结构，稍后再回来开始。');
  }

  if (notes.length === 0) {
    notes.push('先从当前阶段最小任务开始推进，完成后再继续扩展后续内容。');
  }

  return notes.slice(0, 3);
});

const pathSceneCards = computed(() => {
  const scene = path.value?.sceneSummary;
  if (!scene) return [];

  return [
    scene.firstDeliverable
      ? { title: '首个最小交付物', desc: scene.firstDeliverable }
      : null,
    scene.targetState
      ? { title: '目标状态', desc: scene.targetState }
      : null,
    Array.isArray(scene.planningFocus) && scene.planningFocus.length > 0
      ? { title: '当前规划重点', desc: scene.planningFocus.join('、') }
      : null,
  ].filter(Boolean) as Array<{ title: string; desc: string }>;
});

const pathSceneMetaChips = computed(() => {
  const scene = path.value?.sceneSummary;
  if (!scene) return [];

  return [
    ...(Array.isArray(scene.excludedScope) ? scene.excludedScope.map((item: string) => `暂不展开：${item}`) : []),
    ...(Array.isArray(scene.riskFlags) ? scene.riskFlags.map((item: string) => `风险：${item}`) : []),
  ].slice(0, 6);
});

const cognitiveConceptCards = computed(() => {
  const concepts = Array.isArray(path.value?.cognitiveDesign?.coreConcepts)
    ? path.value.cognitiveDesign.coreConcepts
    : [];

  return concepts.map((concept: any, index: number) => ({
    title: `${concept.role === 'hub' || index === 0 ? '枢纽概念' : '支撑概念'} · ${concept.name}`,
    desc: concept.description || '作为后续教学和任务推进时的隐性认知锚点。'
  }));
});

const conceptLabelMap = computed(() => {
  const concepts = Array.isArray(path.value?.cognitiveDesign?.coreConcepts)
    ? path.value.cognitiveDesign.coreConcepts
    : [];
  return new Map(concepts.map((concept: any) => [concept.id, concept.name]));
});

const getTaskConceptLabel = (task: any) => {
  const conceptId = typeof task?.coreConcept === 'string' ? task.coreConcept : '';
  if (!conceptId) return '';
  const conceptName = conceptLabelMap.value.get(conceptId);
  return conceptName ? `关联概念：${conceptName}` : '';
};

const pathDetailPlan = computed(() => {
  const items = nextActionTasks.value.map((task: any, index: number) => ({
    title: `任务 ${index + 1}`,
    desc: `${task.title}${task.estimatedMinutes ? ` · 预计 ${task.estimatedMinutes} 分钟` : ''}`
  }));

  if (items.length === 0) {
    return [{ title: '当前暂无待推进任务', desc: '等阶段任务生成完成后，这里会出现最值得先开始的任务。' }];
  }

  return items;
});

const paceSuggestionCards = computed(() => {
  const stage = activeStage.value;
  return [
    {
      title: paceRangeText.value,
      desc: '优先把一个任务完整收口，再继续下一个步骤。'
    },
    {
      title: `当前阶段先聚焦「${stage?.title || '这一阶段'}」`,
      desc: '先把当前阶段的关键任务做稳，再决定是否扩展更多内容。'
    }
  ];
});

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
    toast.error(error.response?.data?.error?.message || '加载路径详情失败');
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
  if (task.status === 'completed') {
    toast.info('本任务已完成，请查看当堂评估');
    return;
  }

  if (!canStartLearning.value) {
    toast.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push(`/learn/${task.id}`);
};

// 点击"开始学习"按钮
const startTask = (task: any) => {
  if (task.status === 'completed') {
    toast.info('本任务已完成，请查看当堂评估');
    return;
  }

  if (!canStartLearning.value) {
    toast.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push(`/learn/${task.id}`);
};

const startPrimaryActionTask = () => {
  if (!primaryActionTask.value) return;
  startTask(primaryActionTask.value);
};

const retryEnrichment = async () => {
  if (!path.value?.id) return;

  retryingEnrichment.value = true;
  try {
    await learningAPI.retryPathEnrichment(path.value.id);
    toast.success('已在后台继续生成阶段任务，无需停留当前页面。');
    await loadPathData();
  } catch (error: any) {
    toast.error(error.message || '继续生成阶段任务失败');
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
      toast.warning('暂无当堂评估记录');
      evaluationDialogVisible.value = false;
      return;
    }
    selectedTaskEvaluation.value = result;
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || '获取当堂评估失败');
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
    quiz: '测验',
    acquire: '获取',
    deconstruct: '拆解',
    model: '建模',
    execute: '执行',
    diagnose: '诊断',
    refine: '优化',
    consolidate: '巩固'
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

onActivated(() => {
  loadPathData();
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
  min-height: 100dvh;
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.12), transparent 28%),
    radial-gradient(circle at left 20%, rgba(141, 107, 255, 0.08), transparent 24%),
    #f4f7fc;
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

.section-kicker {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
  font-size: 11px;
  font-weight: 700;
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
  padding: 28px;
}

.path-detail-hero {
  background: rgba(255, 255, 255, 0.78);
}

.path-detail-hero__layout {
  align-items: stretch;
  margin-bottom: 0;
}

.path-detail-hero__copy {
  display: grid;
  gap: 16px;
}

.path-detail-hero__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill,
.path-detail-hero__tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.pill {
  background: rgba(52, 120, 246, 0.12);
  color: #1f57cc;
}

.path-detail-hero__tag {
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.06);
  color: var(--text-muted);
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
  font-size: clamp(30px, 3.8vw, 44px);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.08;
  letter-spacing: -0.04em;
  margin: 0;
}

.path-description {
  color: var(--text-secondary);
  font-size: 0.98rem;
  line-height: 1.7;
  margin: 0;
}

.path-detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.path-detail-overview-card {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(52, 120, 246, 0.08);
  display: grid;
  gap: 6px;
}

.path-detail-overview-card span {
  font-size: 12px;
  color: var(--text-muted);
}

.path-detail-overview-card strong {
  font-size: 24px;
  line-height: 1.05;
  color: var(--text-primary);
}

/* 环形进度 */
.progress-ring-wrapper {
  flex-shrink: 0;
}

.progress-ring {
  width: 148px;
  height: 148px;
  border-radius: 50%;
  background: conic-gradient(
    #3478f6 calc(var(--progress) * 3.6deg),
    #8d6bff calc(var(--progress) * 3.6deg),
    rgba(52, 120, 246, 0.08) 0deg
  );
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(52, 120, 246, 0.06);
}

.progress-inner {
  width: 116px;
  height: 116px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.progress-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: #172033;
  line-height: 1;
}

.progress-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.path-detail-hero__progress {
  display: grid;
  gap: 16px;
  justify-items: center;
  align-content: center;
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

.path-detail-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
  padding-bottom: 40px;
}

.path-detail-sidebar {
  display: grid;
  gap: 16px;
  position: sticky;
  top: 104px;
}

.path-detail-side-card {
  padding: 20px;
  display: grid;
  gap: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 20px 52px rgba(15, 23, 42, 0.05);
}

.path-detail-side-card--light {
  background: rgba(255, 255, 255, 0.66);
}

.path-detail-side-card__head {
  display: grid;
  gap: 8px;
}

.path-detail-side-card__head h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.14;
  color: var(--text-primary);
}

.path-detail-side-card__time {
  font-size: 13px;
  font-weight: 700;
  color: #1f57cc;
}

.path-detail-note-list,
.path-detail-plan-list {
  display: grid;
  gap: 12px;
}

.path-detail-note-list {
  margin: 0;
  padding-left: 18px;
}

.path-detail-note-list li {
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.9rem;
}

.path-detail-plan-item {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.82);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.path-detail-plan-item strong {
  font-size: 15px;
  color: var(--text-primary);
}

.path-detail-plan-item p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.6;
}

.btn--full {
  width: 100%;
  justify-content: center;
}

.btn-primary:disabled {
  background: linear-gradient(135deg, #c8ceda 0%, #b2b9c6 100%);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
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
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.04);
}

.week-card:hover {
  box-shadow: 0 24px 54px rgba(15, 23, 42, 0.08);
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
  background: rgba(243, 246, 251, 0.72);
}

.week-title-wrapper {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.week-number {
  padding: 0.375rem 0.875rem;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
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
  background: rgba(52, 120, 246, 0.1);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3478f6 0%, #8d6bff 100%);
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
  background: rgba(244, 247, 252, 0.92);
  border: 1px solid rgba(52, 120, 246, 0.08);
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
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.3s ease;
}

.task-card:hover {
  border-color: rgba(52, 120, 246, 0.18);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  transform: translateY(-2px);
}

.task-card.task-completed {
  background: rgba(240, 249, 244, 0.92);
  border-color: rgba(49, 177, 111, 0.18);
}

.task-card.task-locked {
  opacity: 0.82;
}

.task-status-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(243, 246, 251, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.task-card.task-completed .task-status-icon {
  background: rgba(49, 177, 111, 0.12);
  color: #238a58;
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

.display-label--concept {
  background: rgba(141, 107, 255, 0.1);
  color: #6d4fd6;
}

.path-detail-chip-row {
  display: flex;
  gap: 0.5rem;
}

.path-detail-chip-row--wrap {
  flex-wrap: wrap;
  margin-top: 0.9rem;
}

.path-detail-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.42rem 0.72rem;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
}

.path-detail-domain-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.95rem 1rem;
  border-radius: var(--radius-lg);
  background: rgba(141, 107, 255, 0.08);
  border: 1px solid rgba(141, 107, 255, 0.14);
  margin-bottom: 0.9rem;
}

.path-detail-domain-block span {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.path-detail-domain-block strong {
  font-size: 0.98rem;
  color: var(--text-primary);
}

.task-desc {
  margin: 0 0 0.875rem 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.task-acceptance {
  margin: -0.2rem 0 0.875rem 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
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
  background: linear-gradient(135deg, #3478f6 0%, #1f57cc 100%);
  color: white;
  box-shadow: 0 10px 24px rgba(52, 120, 246, 0.2);
}

.btn-start:hover {
  box-shadow: 0 14px 30px rgba(52, 120, 246, 0.28);
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
  background: linear-gradient(135deg, #3478f6 0%, #1f57cc 100%);
  color: white;
  box-shadow: 0 10px 28px rgba(52, 120, 246, 0.22);
}

.btn-primary:hover {
  box-shadow: 0 14px 34px rgba(52, 120, 246, 0.28);
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

  .path-detail-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .path-detail-main-grid {
    grid-template-columns: 1fr;
  }

  .path-detail-sidebar {
    position: static;
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

@media (max-width: 640px) {
  .header-container {
    padding: 0.9rem 1rem;
    gap: 0.75rem;
  }

  .header-right,
  .header-nav,
  .brand {
    min-width: 0;
  }

  .path-detail-overview-grid {
    grid-template-columns: 1fr;
  }

  .path-detail-main-grid {
    gap: 16px;
  }

  .path-detail-side-card,
  .week-card,
  .learning-objectives,
  .task-card,
  .week-content {
    padding: 16px;
    border-radius: 18px;
  }

  .week-header {
    padding: 16px;
  }

  .progress-ring-wrapper {
    transform: scale(0.88);
    transform-origin: top center;
  }

  .week-title-wrapper,
  .task-card,
  .task-header,
  .task-footer,
  .completed-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .week-meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .task-btn,
  .completed-actions .task-btn,
  .btn--full {
    width: 100%;
    justify-content: center;
  }
}
</style>
