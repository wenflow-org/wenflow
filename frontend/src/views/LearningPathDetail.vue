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
          <router-link :to="dashboardPath" class="nav-item">学习台</router-link>
          <router-link :to="goalConversationPath" class="nav-item">目标规划</router-link>
          <router-link :to="learningPathsBasePath" class="nav-item nav-item--active">学习路径</router-link>
          <router-link :to="learningStatePath" class="nav-item">学习状态</router-link>
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
        <!-- 面包屑导航 -->
        <div class="breadcrumb-section">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item @click="$router.push(learningPathsBasePath)" class="breadcrumb-link">学习路径</el-breadcrumb-item>
            <el-breadcrumb-item>{{ path?.name || '加载中...' }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading && !path" class="path-detail-skeleton" aria-label="正在加载学习路径" aria-busy="true">
          <section class="path-detail-skeleton__hero glass-card" aria-hidden="true">
            <span class="detail-skeleton detail-skeleton--pill"></span>
            <span class="detail-skeleton detail-skeleton--title"></span>
            <span class="detail-skeleton detail-skeleton--copy"></span>
            <div class="path-detail-skeleton__metrics">
              <span v-for="index in 4" :key="index" class="detail-skeleton detail-skeleton--metric"></span>
            </div>
          </section>
          <section class="path-detail-skeleton__body">
            <div class="path-detail-skeleton__stages">
              <span v-for="index in 3" :key="index" class="detail-skeleton detail-skeleton--stage"></span>
            </div>
            <span class="detail-skeleton detail-skeleton--side"></span>
          </section>
        </div>

        <div v-else-if="path" class="path-content" :aria-busy="generationPollingInFlight || loading">
          <p class="sr-only" aria-live="polite">{{ lifecycleLiveMessage }}</p>
          <!-- 路径信息卡片 -->
          <section class="path-info-section">
            <div class="path-info-card path-detail-hero glass-card">
              <div class="card-header path-detail-hero__layout">
                <div class="header-main path-detail-hero__copy">
                  <div class="path-detail-hero__tags">
                    <span class="pill">学习路径</span>
                    <span class="path-detail-hero__tag">{{ lifecycleLabel }}</span>
                    <span v-if="subjectTagLabel" class="path-detail-hero__tag">{{ subjectTagLabel }}</span>
                  </div>
                  <h1 class="path-title">{{ sanitizeDisplayText(path.name || path.title || '学习路径生成中') }}</h1>
                  <p class="path-description">{{ sanitizeDisplayText(path.summary || path.description || lifecycleDescription) }}</p>
                  <button class="btn btn-primary btn--full path-detail-hero__mobile-cta" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
                    {{ primaryActionLabel }}
                  </button>
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
                <strong>已根据近期学习情况调整</strong>
                <span>已完成的内容保持不变，后续安排会按当前状态更新。</span>
              </div>

              <div v-if="pathReplanSignal?.shouldSuggest" class="replan-advisory-banner">
                <div class="replan-advisory-banner__copy">
                  <strong>建议先确认后续路径安排</strong>
                  <p>{{ pathReplanSignal.rationale }}</p>
                  <div class="replan-advisory-banner__meta">
                    <span>优先级：{{ pathReplanMeta.priority }}</span>
                    <span>建议：{{ pathReplanMeta.recommendation }}</span>
                    <span>范围：{{ pathReplanMeta.scope }}</span>
                  </div>
                  <p class="replan-advisory-banner__action-copy">{{ pathReplanMeta.action }}</p>
                  <div class="replan-advisory-banner__chips" v-if="pathReplanSignal.reasonCodes?.length">
                    <span v-for="(code, index) in pathReplanMeta.reasonCodes" :key="`replan-reason-${index}-${code}`" class="path-detail-chip path-detail-chip--warn">{{ code }}</span>
                  </div>
                </div>
                <div class="replan-advisory-banner__actions">
                  <el-button type="primary" :loading="replanLoading" @click="previewReplan">查看调整建议</el-button>
                  <span v-if="latestReplanPreview" class="replan-advisory-banner__hint">已生成预览，请在弹窗中确认是否执行。</span>
                </div>
              </div>

              <div v-if="replanExecutionResult" class="replan-result-banner">
                <div class="replan-result-banner__copy">
                  <strong>已完成后续阶段调整</strong>
                  <p>{{ replanResultSummary }}</p>
                  <div class="replan-result-banner__meta">
                    <span v-if="replanExecutionResult.result?.redesignedStageNumber">调整阶段：第 {{ replanExecutionResult.result.redesignedStageNumber }} 阶段</span>
                    <span v-if="replanExecutionResult.result?.redesignedTaskCount">已调整任务数：{{ replanExecutionResult.result.redesignedTaskCount }}</span>
                  </div>
                </div>
                <div class="replan-result-banner__actions">
                  <el-button @click="dismissReplanResult">收起结果</el-button>
                  <el-button type="primary" @click="refreshPathAfterReplan">刷新当前路径</el-button>
                </div>
              </div>

              <div
                v-if="generationLifecycle.lifecycle !== 'ready'"
                class="generation-lifecycle-banner"
                :class="`generation-lifecycle-banner--${generationLifecycle.status}`"
                role="status"
              >
                <div class="generation-lifecycle-banner__copy">
                  <span>{{ generationLifecycle.phase === 'core' ? '路径主结构' : '阶段任务准备' }}</span>
                  <strong>{{ lifecycleTitle }}</strong>
                  <p>{{ lifecycleDescription }}</p>
                </div>
                <div v-if="generationLifecycle.phase === 'stage_design'" class="generation-stage-progress">
                  <div class="generation-stage-progress__copy">
                    <span>阶段进度</span>
                    <strong>{{ stageDesignProgressText }}</strong>
                  </div>
                  <div class="generation-stage-progress__track" aria-hidden="true">
                    <span
                      v-for="stage in lifecycleStageSkeleton"
                      :key="stage.key"
                      :class="{
                        'is-done': stage.done,
                        'is-current': stage.current
                      }"
                    >{{ stage.number }}</span>
                  </div>
                </div>
                <el-button
                  v-if="canRetryGeneration"
                  type="primary"
                  :loading="retryingGeneration"
                  @click="retryGeneration"
                >{{ retryGenerationLabel }}</el-button>
              </div>
            </div>
          </section>

          <section v-if="generationLifecycle.phase === 'core'" class="core-generation-panel glass-card">
            <div class="core-generation-panel__copy">
              <span class="pill">路径主结构</span>
              <h2>{{ lifecycleTitle }}</h2>
              <p>{{ lifecycleDescription }}</p>
            </div>
            <div class="core-generation-panel__placeholder" aria-hidden="true">
              <span v-for="index in 4" :key="index"></span>
            </div>
          </section>

          <section v-else class="path-detail-main-grid">
            <section class="weeks-section">
              <div class="weeks-container">
                <div
                  v-for="week in pathStages"
                  :key="week.id"
                  class="week-card glass-card"
                  :class="{ 'week-expanded': activeWeeks.includes(week.stageNumber || week.weekNumber) }"
                >
                  <div class="week-header" @click="toggleWeek(week)">
                    <div class="week-title-wrapper">
                      <div class="week-number">阶段 {{ week.stageNumber || week.weekNumber }}</div>
                      <div class="week-title">{{ sanitizeDisplayText(week.title) }}</div>
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
                    <p class="week-description">{{ sanitizeDisplayText(week.description || week.goal) }}</p>

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
                          <h4 class="task-title">{{ sanitizeDisplayText(task.title) }}</h4>
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
                          <p class="task-desc">{{ sanitizeDisplayText(task.description) }}</p>
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
                                查看本次学习反馈
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
                                查看最近学习反馈
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
                  <span class="section-kicker">当前阶段</span>
                  <h2>接下来怎么学</h2>
                </div>
                <div class="path-detail-side-card__time">接下来 3 个任务预计用时：{{ currentStageEffortText }}</div>
                <ul class="path-detail-note-list">
                  <li v-for="(item, index) in pathDetailNotes" :key="`note-${index}`">{{ item }}</li>
                </ul>
              </article>

              <article class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">下一步</span>
                  <h2>当前最值得先完成的任务</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="(item, index) in pathDetailPlan" :key="`plan-${index}-${item.title}`" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ sanitizeDisplayText(item.desc) }}</p>
                  </article>
                </div>
                <button class="btn btn-primary btn--full" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
                  {{ primaryActionLabel }}
                </button>
              </article>

              <article class="glass-card path-detail-side-card path-detail-side-card--light">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">建议节奏</span>
                  <h2>如何安排当前阶段</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="(item, index) in paceSuggestionCards" :key="`pace-${index}-${item.title}`" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ sanitizeDisplayText(item.desc) }}</p>
                  </article>
                </div>
              </article>

              <article v-if="pathSceneCards.length > 0" class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">路径设计意图</span>
                  <h2>这条路径先解决什么</h2>
                </div>
                <div class="path-detail-plan-list">
                  <article v-for="(item, index) in pathSceneCards" :key="`scene-${index}-${item.title}`" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ sanitizeDisplayText(item.desc) }}</p>
                  </article>
                </div>
                <div v-if="pathSceneMetaChips.length > 0" class="path-detail-chip-row path-detail-chip-row--wrap">
                  <span v-for="(item, index) in pathSceneMetaChips" :key="`scene-chip-${index}-${item}`" class="path-detail-chip">{{ item }}</span>
                </div>
              </article>

              <article v-if="cognitiveConceptCards.length > 0 || path?.cognitiveDesign?.cognitiveDomain" class="glass-card path-detail-side-card">
                <div class="path-detail-side-card__head">
                  <span class="section-kicker">重点能力</span>
                  <h2>这条路径在训练什么</h2>
                </div>
                <div v-if="path?.cognitiveDesign?.cognitiveDomain" class="path-detail-domain-block">
                  <span>能力方向</span>
                  <strong>{{ path.cognitiveDesign.cognitiveDomain }}</strong>
                </div>
                <div v-if="cognitiveConceptCards.length > 0" class="path-detail-plan-list">
                  <article v-for="(item, index) in cognitiveConceptCards" :key="`concept-${index}-${item.title}`" class="path-detail-plan-item">
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>
              </article>
            </aside>
          </section>
        </div>

        <div v-else class="empty-state glass-card">
          <el-empty :description="pathLoadError || '路径不存在或已删除'" />
          <button v-if="pathLoadError" class="btn btn-primary" @click="loadPathData()">重新加载</button>
          <button class="btn btn-primary" @click="$router.push(learningPathsBasePath)">
            返回学习路径列表
          </button>
        </div>
      </div>
      <AppMiniFooter />
    </main>


    <el-dialog
      v-model="replanPreviewDialogVisible"
      title="确认调整当前路径"
      width="620px"
      :close-on-click-modal="false"
    >
      <div class="replan-preview-dialog">
        <div class="replan-preview-dialog__hero">
          <strong>{{ pathReplanMeta.recommendation }}</strong>
          <p>{{ previewRationaleText }}</p>
        </div>

        <div class="replan-preview-dialog__meta">
          <article class="replan-preview-dialog__meta-item">
            <span>优先级</span>
            <strong>{{ previewMeta.priority }}</strong>
          </article>
          <article class="replan-preview-dialog__meta-item">
            <span>调整范围</span>
            <strong>{{ previewMeta.scope }}</strong>
          </article>
          <article class="replan-preview-dialog__meta-item">
            <span>建议动作</span>
            <strong>{{ previewMeta.action }}</strong>
          </article>
        </div>

        <div class="replan-preview-dialog__section">
          <span class="section-kicker">本次会做什么</span>
          <ul class="replan-preview-dialog__list">
            <li>基于当前学习证据，重新安排当前路径的后续阶段任务。</li>
            <li>{{ previewTargetText }}</li>
            <li>已完成任务会被冻结，不会被改写。</li>
          </ul>
        </div>

        <div v-if="previewMeta.reasonCodes.length" class="replan-preview-dialog__section">
          <span class="section-kicker">触发原因</span>
          <div class="path-detail-chip-row path-detail-chip-row--wrap">
            <span v-for="(code, index) in previewMeta.reasonCodes" :key="`preview-reason-${index}-${code}`" class="path-detail-chip path-detail-chip--warn">{{ code }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="replan-preview-dialog__footer">
          <el-button @click="replanPreviewDialogVisible = false">稍后再说</el-button>
          <el-button type="primary" :loading="replanConfirmLoading" @click="confirmReplan">确认调整当前路径</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
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
import MobileSiteMenu from '../components/MobileSiteMenu.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import AppMiniFooter from '../components/AppMiniFooter.vue';
import api from '../utils/api';
import { aiTeachingAPI } from '@/api/aiTeaching';
import {
  learningAPI,
  mergeGenerationLifecycle,
  normalizeGenerationLifecycle,
  type GenerationLifecycleDTO,
  type LearningPath,
  type PathReplanResponse,
  type Task,
  type Week
} from '@/api/learning';
import { userAPI, type LearnerCenterSnapshot } from '@/api/user';
import { adminApi } from '@/api/adminApi';
import {
  getReplanActionText,
  getReplanPriorityText,
  getReplanReasonCodeLabels,
  getReplanRecommendationText,
  getReplanScopeText,
} from '@/utils/replanSignal';

// 后端详情接口可能额外返回、但 LearningPath 未声明的字段
type PathDetailRecord = LearningPath & {
  totalMilestones?: number;
  totalWeeks?: number;
};

// 路径阶段可能以 milestones/stages/weeks 任一形式返回，且可能携带解析后的学习目标
type PathDetailStage = {
  id: string;
  stageNumber?: number;
  weekNumber?: number;
  title?: string;
  description?: string;
  goal?: string;
  learningObjectives?: string[];
  subtasks?: Task[];
  tasks?: Task[];
};

// normalizePathData 解析前的学习目标可能是 JSON 字符串
type WeekWithObjectives = Week & { learningObjectives?: unknown };

type VirtualContextRecord = {
  bindings?: Record<string, unknown>;
};

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
// 路由参数需保持响应式：同组件实例在不同路径间导航时必须拿到最新 id
const pathId = computed(() => String(route.params.id || ''));
const virtualSessionId = computed(() => typeof route.query.virtualSessionId === 'string' ? route.query.virtualSessionId.trim() : '');
const viewMode = computed(() => typeof route.query.viewMode === 'string' ? route.query.viewMode.trim() : '');
const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const isVirtualSessionView = computed(() => !!virtualSessionId.value);
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
const learnBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learn' : '/learn';
  }
  return '/learn';
});

const userInitial = computed(() => userStore.user?.name?.charAt(0) || 'U');
const headerNavItems = computed(() => [
  { label: '学习台', to: dashboardPath.value, matchPrefixes: ['/dashboard', '/admin/test/dashboard'] },
  { label: '目标规划', to: goalConversationPath.value, matchPrefixes: ['/goal-conversation', '/test/goal-full', '/admin/test/goal-full'] },
  { label: '学习路径', to: learningPathsBasePath.value, matchPrefixes: ['/learning-paths', '/learning-path/', '/test/learning-paths', '/test/learning-path/', '/admin/test/learning-paths', '/admin/test/learning-path/'] },
  { label: '学习状态', to: learningStatePath.value, matchPrefixes: ['/learning-state', '/admin/test/learning-state'] },
  { label: '成就', to: achievementsPath.value, matchPrefixes: ['/achievements', '/admin/test/achievements'] }
]);
const headerScrolled = ref(false);
const loading = ref(true);
const path = ref<PathDetailRecord | null>(null);
const pathLoadError = ref('');
const backgroundRefreshMessage = ref('');
const pendingDetailRefresh = ref(false);
const virtualContext = ref<VirtualContextRecord | null>(null);
const activeWeeks = ref<Array<number | undefined>>([1]);
const retryingGeneration = ref(false);
const learnerCenter = ref<LearnerCenterSnapshot | null>(null);
const replanLoading = ref(false);
const replanConfirmLoading = ref(false);
const replanPreviewDialogVisible = ref(false);
const latestReplanPreview = ref<PathReplanResponse | null>(null);
const replanExecutionResult = ref<PathReplanResponse | null>(null);
let generationPollingTimer: number | null = null;
const generationPollingInFlight = ref(false);
let generationPollingFailureCount = 0;

// 计算属性
const totalTasks = computed(() => {
  const milestones: PathDetailStage[] = path.value?.milestones || path.value?.weeks || [];
  return milestones.reduce((sum: number, milestone) => {
    return sum + (milestone.subtasks?.length || milestone.tasks?.length || 0);
  }, 0);
});

const completedTasks = computed(() => {
  const milestones: PathDetailStage[] = path.value?.milestones || path.value?.weeks || [];
  return milestones.reduce((sum: number, milestone) => {
    const tasks = milestone.subtasks || milestone.tasks || [];
    return sum + tasks.filter((t) => t.status === 'completed').length;
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

const subjectTagLabel = computed(() => {
  const raw = typeof path.value?.subject === 'string' ? path.value.subject.trim() : '';
  if (!raw) return '';

  // 只把短主题词当作 pill 展示，避免把整段目标描述塞进标签。
  if (raw.length > 24) return '';
  if (/[，。；！？,.!?]/.test(raw)) return '';

  return raw;
});

const pathOverviewMetrics = computed(() => {
  const stages = pathStages.value;
  const activeStageNumber = generationLifecycle.value.currentStageNumber
    || activeStage.value?.stageNumber
    || activeStage.value?.weekNumber
    || null;

  return [
    {
      label: '阶段数',
      value: String(generationLifecycle.value.totalStages || path.value?.totalMilestones || path.value?.totalStages || path.value?.totalWeeks || stages.length || 0)
    },
    { label: '预计投入', value: `${formatHours(path.value?.estimatedHours || 0)} 小时` },
    { label: '当前阶段', value: activeStageNumber ? `第 ${activeStageNumber} 阶段` : (stages.length > 0 ? '第 1 阶段' : '待开始') },
    { label: '任务进度', value: `${completedTasks.value}/${totalTasks.value}` }
  ];
});

const effectivePathId = computed(() => String(virtualContext.value?.bindings?.learningPathId || pathId.value || ''));

const sanitizeDisplayText = (value: unknown) => {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

const generationStatus = computed(() => path.value?.generationStatus || null);
const generationLifecycle = computed<GenerationLifecycleDTO>(() => normalizeGenerationLifecycle(path.value));
const enrichmentStatus = computed(() => {
  const lifecycle = generationLifecycle.value.lifecycle;
  if (lifecycle === 'stage_design_queued') return 'pending';
  if (lifecycle === 'stage_design_processing') return 'processing';
  if (lifecycle === 'stage_design_failed' || lifecycle === 'stage_design_stale') return 'failed';
  if (lifecycle === 'ready') return 'succeeded';
  return generationStatus.value?.stageDesign || null;
});
const canStartLearning = computed(() => generationLifecycle.value.canStartLearning);
const lifecycleLabel = computed(() => {
  const labels: Record<string, string> = {
    core_queued: '主结构排队中',
    core_processing: '主结构生成中',
    core_stale: '主结构停滞',
    core_failed: '主结构失败',
    stage_design_queued: '阶段任务排队中',
    stage_design_processing: '阶段任务准备中',
    stage_design_stale: '阶段任务停滞',
    stage_design_failed: '阶段任务失败',
    ready: pathStatusLabel.value
  };
  return labels[generationLifecycle.value.lifecycle] || '状态更新中';
});
const lifecycleTitle = computed(() => {
  const lifecycle = generationLifecycle.value.lifecycle;
  if (lifecycle === 'core_queued') return '路径主结构正在排队';
  if (lifecycle === 'core_processing') return getCoreLifecycleStepLabel();
  if (lifecycle === 'core_stale') return '路径主结构生成已停滞';
  if (lifecycle === 'core_failed') return '路径主结构生成失败';
  if (lifecycle === 'stage_design_queued') return '阶段任务正在排队准备';
  if (lifecycle === 'stage_design_processing') return '正在逐阶段准备学习任务';
  if (lifecycle === 'stage_design_stale') return '阶段任务准备已停滞';
  if (lifecycle === 'stage_design_failed') return '阶段任务准备失败';
  return '学习路径已准备完成';
});
const lifecycleDescription = computed(() => {
  const lifecycle = generationLifecycle.value;
  if (lifecycle.errorMessage) return lifecycle.errorMessage;
  if (lifecycle.lifecycle === 'core_queued') return '已收到生成请求，开始后会先产出路径标题和阶段结构。';
  if (lifecycle.lifecycle === 'core_processing') return '正在生成路径标题、阶段目标和整体学习顺序。';
  if (lifecycle.lifecycle === 'core_stale') return '后台长时间没有更新主结构状态，可以重新生成主结构。';
  if (lifecycle.lifecycle === 'core_failed') return '主结构没有生成成功，可以重新生成；阶段任务尚未开始。';
  if (lifecycle.lifecycle === 'stage_design_queued') return '路径主结构已经完成，阶段任务将在后台依次准备。';
  if (lifecycle.lifecycle === 'stage_design_processing') return '你可以先查看真实路径标题和阶段骨架，全部任务准备好后即可开始学习。';
  if (lifecycle.lifecycle === 'stage_design_stale') return '路径主结构已保留，可以只重新准备阶段任务。';
  if (lifecycle.lifecycle === 'stage_design_failed') return '路径主结构已保留，可以只重新准备阶段任务，不会重新生成整条路径。';
  return '可以按当前阶段开始学习。';
});
const canRetryGeneration = computed(() => generationLifecycle.value.retryAllowed && Boolean(generationLifecycle.value.retryType));
const retryGenerationLabel = computed(() => generationLifecycle.value.retryType === 'stage_design'
  ? '重新准备阶段任务'
  : '重新生成主结构');
const stageDesignProgressText = computed(() => generationLifecycle.value.totalStages > 0
  ? `${generationLifecycle.value.completedStages} / ${generationLifecycle.value.totalStages}`
  : '阶段数确认中');
const lifecycleLiveMessage = computed(() => backgroundRefreshMessage.value || `${lifecycleLabel.value}。${lifecycleTitle.value}`);
const enrichmentPendingHint = computed(() => {
  if (enrichmentStatus.value === 'failed') {
    return '这一阶段的任务还没生成完整，请稍后再回来开始学习。';
  }

  return '这一阶段的任务仍在生成中，完成后就可以开始学习。';
});

const pathStages = computed((): PathDetailStage[] => path.value?.milestones || path.value?.weeks || []);

const lifecycleStageSkeleton = computed(() => {
  const lifecycle = generationLifecycle.value;
  const stages = pathStages.value;
  const count = Math.max(lifecycle.totalStages, stages.length, 1);
  return Array.from({ length: count }, (_, index) => {
    const stage = stages[index];
    const number = Number(stage?.stageNumber || stage?.weekNumber || index + 1);
    return {
      key: stage?.id || `stage-${index + 1}`,
      number,
      done: index < lifecycle.completedStages,
      current: lifecycle.currentStageNumber === number
        || (!lifecycle.currentStageNumber && index === lifecycle.completedStages && lifecycle.completedStages < count)
    };
  });
});

const normalizeTaskList = (stage?: PathDetailStage | null): Task[] => stage?.subtasks || stage?.tasks || [];

const activeStage = computed(() => {
  const stages = pathStages.value;
  if (!stages.length) return null;

  return stages.find((stage) => {
    const tasks = normalizeTaskList(stage);
    return tasks.some((task) => task.status !== 'completed');
  }) || stages[0];
});

const activeStageTasks = computed(() => normalizeTaskList(activeStage.value));

const primaryActionTask = computed(() => {
  return activeStageTasks.value.find((task) => task.status === 'in_progress')
    || activeStageTasks.value.find((task) => task.status === 'todo')
    || null;
});

const primaryActionLabel = computed(() => {
  if (!canStartLearning.value) return '等待阶段任务生成完成';
  return primaryActionTask.value?.status === 'in_progress' ? '继续学习' : '开始学习';
});

const nextActionTasks = computed(() => {
  const upcoming = activeStageTasks.value.filter((task) => task.status !== 'completed');
  return (upcoming.length > 0 ? upcoming : activeStageTasks.value).slice(0, 3);
});

const currentStageEffortMinutes = computed(() => {
  return nextActionTasks.value.reduce((sum: number, task) => sum + Math.max(0, Number(task.estimatedMinutes) || 0), 0);
});

const currentStageEffortText = computed(() => {
  const minutes = currentStageEffortMinutes.value;
  if (minutes <= 0) return '按当前任务推进';
  return `${minutes} 分钟`;
});

const paceRangeText = computed(() => {
  const taskMinutes = nextActionTasks.value
    .map((task) => Math.max(0, Number(task.estimatedMinutes) || 0))
    .filter((value: number) => value > 0);

  if (taskMinutes.length === 0) return '单次 20-25 分钟';

  const min = Math.max(15, Math.min(...taskMinutes));
  const max = Math.max(min, Math.max(...taskMinutes));
  if (max - min <= 5) return `单次 ${min}-${Math.max(min + 5, max)} 分钟`;
  return `单次 ${min}-${max} 分钟`;
});

const pathReplanSignal = computed(() => learnerCenter.value?.replanSignal || null);
const pathReplanMeta = computed(() => ({
  priority: getReplanPriorityText(pathReplanSignal.value?.priority),
  recommendation: getReplanRecommendationText(pathReplanSignal.value?.recommendation),
  scope: getReplanScopeText(pathReplanSignal.value?.scope),
  action: getReplanActionText(pathReplanSignal.value),
  reasonCodes: getReplanReasonCodeLabels(pathReplanSignal.value?.reasonCodes || []),
}));
const previewSignal = computed(() => latestReplanPreview.value?.signal || pathReplanSignal.value || null);
const previewMeta = computed(() => ({
  priority: getReplanPriorityText(previewSignal.value?.priority),
  recommendation: getReplanRecommendationText(previewSignal.value?.recommendation),
  scope: getReplanScopeText(previewSignal.value?.scope),
  action: getReplanActionText(previewSignal.value),
  reasonCodes: getReplanReasonCodeLabels(previewSignal.value?.reasonCodes || []),
}));
const previewRationaleText = computed(() => {
  return latestReplanPreview.value?.request?.reason
    || previewSignal.value?.rationale
    || '系统判断当前学习状态更适合先确认后续阶段安排。';
});
const previewTargetText = computed(() => {
  const stageNumber = latestReplanPreview.value?.request?.stageNumber;
  if (stageNumber) {
    return `本次会优先重设计第 ${stageNumber} 阶段的后续安排。`;
  }

  if (previewSignal.value?.scope === 'downstream_path') {
    return '本次会影响当前阶段之后的后续路径安排。';
  }

  return '本次会优先调整紧接着的下一阶段安排。';
});
const replanResultSummary = computed(() => {
  const result = replanExecutionResult.value?.result;
  if (!result) return '当前路径的后续阶段已根据学习证据完成调整。';

  const parts = ['当前路径的后续阶段已根据学习证据完成调整'];
  if (result.redesignedStageNumber) {
    parts.push(`第 ${result.redesignedStageNumber} 阶段已重新设计`);
  }
  if (typeof result.preservedCompletedTaskCount === 'number') {
    parts.push(`保留已完成任务 ${result.preservedCompletedTaskCount} 个`);
  }
  return `${parts.join('，')}。`;
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

  return concepts.map((concept, index) => ({
    title: `${concept.role === 'hub' || index === 0 ? '核心概念' : '辅助概念'} · ${concept.name}`,
    desc: concept.description || '后续任务会继续围绕这个概念展开。'
  }));
});

const conceptLabelMap = computed(() => {
  const concepts = Array.isArray(path.value?.cognitiveDesign?.coreConcepts)
    ? path.value.cognitiveDesign.coreConcepts
    : [];
  return new Map(concepts.map((concept) => [concept.id, concept.name]));
});

const getTaskConceptLabel = (task: Task) => {
  const conceptId = typeof task?.coreConcept === 'string' ? task.coreConcept : '';
  if (!conceptId) return '';
  const conceptName = conceptLabelMap.value.get(conceptId);
  return conceptName ? `关联概念：${conceptName}` : '';
};

const pathDetailPlan = computed(() => {
  const items = nextActionTasks.value.map((task, index) => ({
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

const getCoreLifecycleStepLabel = () => {
  const step = path.value?.generationStatus?.coreStep;
  if (step === 'framing') return '正在确认路径重点';
  if (step === 'planning') return '正在拆解路径阶段';
  if (step === 'persist') return '正在保存路径主结构';
  return '正在生成路径主结构';
};

const loadLearnerCenter = async () => {
  try {
    learnerCenter.value = await userAPI.getLearnerCenter({
      pathId: pathId.value,
      scope: 'path'
    });
  } catch (error) {
    console.error('获取路径学习者中心失败:', error);
  }
};

const normalizePathData = (nextPath: LearningPath): PathDetailRecord => {
  const normalizedPath: PathDetailRecord = {
    ...nextPath,
    generationLifecycle: normalizeGenerationLifecycle(nextPath)
  };

  if (normalizedPath.milestones && !normalizedPath.weeks) {
    normalizedPath.weeks = normalizedPath.milestones.map((milestone) => ({
      ...milestone,
      weekNumber: milestone.stageNumber,
      tasks: milestone.subtasks
    }));
  }

  if (normalizedPath.weeks) {
    (normalizedPath.weeks as WeekWithObjectives[]).forEach((week) => {
      if (typeof week.learningObjectives === 'string') {
        try {
          week.learningObjectives = JSON.parse(week.learningObjectives);
        } catch {
          week.learningObjectives = [];
        }
      }
    });
  }

  return normalizedPath;
};

const loadPathData = async (options: { background?: boolean; skipLearnerCenter?: boolean } = {}): Promise<boolean> => {
  const hadPath = Boolean(path.value);
  if (!path.value) {
    loading.value = true;
  }
  try {
    pathLoadError.value = '';
    if (isVirtualSessionView.value) {
      await loadVirtualContext();
    }

    if (isVirtualSessionView.value && virtualSessionId.value) {
      const response = await adminApi.getVirtualSessionLearningPath(virtualSessionId.value);
      if (!response.data?.success) {
        throw new Error(response.data?.error || '加载虚拟正式 Path 失败');
      }
      path.value = normalizePathData(response.data.data);
    } else {
      const response = await api.get(`/learning/paths/${effectivePathId.value}`);
      path.value = normalizePathData(response.data);
    }
    backgroundRefreshMessage.value = '';
    pathLoadError.value = '';
    if (isGenerationBusy.value) startGenerationPolling();
    else stopGenerationPolling();

    if (!options.skipLearnerCenter) await loadLearnerCenter();
    return true;
  } catch (error: any) {
    if (hadPath || options.background) {
      backgroundRefreshMessage.value = '后台刷新失败，当前仍显示上次成功加载的内容。';
      if (!options.background) toast.warning(backgroundRefreshMessage.value);
    } else {
      path.value = null;
      pathLoadError.value = error.message || '暂时无法加载路径';
      toast.error('暂时无法加载路径，请重试');
    }
    return false;
  } finally {
    loading.value = false;
  }
};

const toggleWeek = (week: PathDetailStage) => {
  const weekNumber = week.stageNumber || week.weekNumber;
  const index = activeWeeks.value.indexOf(weekNumber);
  if (index > -1) {
    activeWeeks.value.splice(index, 1);
  } else {
    activeWeeks.value.push(weekNumber);
  }
};

const openTaskDetail = (task: Task) => {
  if (task.status === 'completed') {
    toast.info('本任务已完成，请查看当堂评估');
    return;
  }

  if (!canStartLearning.value) {
    toast.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push({ path: `${learnBasePath.value}/${task.id}`, query: buildRouteQuery() });
};

// 点击"开始学习"按钮
const startTask = (task: Task) => {
  if (task.status === 'completed') {
    toast.info('本任务已完成，请查看当堂评估');
    return;
  }

  if (!canStartLearning.value) {
    toast.warning(path.value?.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    return;
  }

  router.push({ path: `${learnBasePath.value}/${task.id}`, query: buildRouteQuery() });
};

const startPrimaryActionTask = () => {
  if (!primaryActionTask.value) return;
  startTask(primaryActionTask.value);
};

const retryGeneration = async () => {
  if (!path.value?.id) return;

  retryingGeneration.value = true;
  try {
    const retryType = generationLifecycle.value.retryType;
    if (retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(path.value.id);
    } else {
      await learningAPI.retryPathGeneration(path.value.id);
    }
    path.value = mergeGenerationLifecycle(path.value, {
      lifecycle: retryType === 'stage_design' ? 'stage_design_queued' : 'core_queued',
      retryAllowed: false,
      canStartLearning: false,
      completedStages: retryType === 'stage_design' ? generationLifecycle.value.completedStages : 0,
      totalStages: generationLifecycle.value.totalStages
    });
    backgroundRefreshMessage.value = '';
    generationPollingFailureCount = 0;
    toast.success(retryType === 'stage_design' ? '已重新排队准备阶段任务' : '已重新排队生成路径主结构');
    scheduleGenerationPolling(1200);
  } catch (error: any) {
    toast.error(error.message || '重试生成失败');
  } finally {
    retryingGeneration.value = false;
  }
};

const previewReplan = async () => {
  replanLoading.value = true;
  try {
    const response = await learningAPI.requestPathReplan(pathId.value, {
      triggerSource: 'learner-model-agent',
      mode: 'new_version',
      reason: pathReplanSignal.value?.rationale || '根据学习者状态建议确认当前路径的后续阶段安排',
      requireConfirmation: true,
    });

    if (response.status !== 'awaiting-confirmation') {
      throw new Error('当前未返回可确认的调整预览');
    }

    latestReplanPreview.value = response;
    replanPreviewDialogVisible.value = true;
  } catch (error: any) {
    toast.error(error?.message || '获取调整建议失败');
  } finally {
    replanLoading.value = false;
  }
};

const confirmReplan = async () => {
  if (!latestReplanPreview.value?.request) {
    await previewReplan();
    if (!latestReplanPreview.value?.request) return;
  }

  replanConfirmLoading.value = true;
  try {
    const request = latestReplanPreview.value.request;
    const response = await learningAPI.requestPathReplan(pathId.value, {
      triggerSource: request.triggerSource || 'learner-model-agent',
      mode: request.mode || 'new_version',
      stageNumber: request.stageNumber,
      reason: request.reason,
      evidence: request.evidence,
      requireConfirmation: false,
    });

    replanExecutionResult.value = response;
    replanPreviewDialogVisible.value = false;
    latestReplanPreview.value = null;
    toast.success('已调整当前路径的后续阶段，请查看最新结果');
    await loadPathData();
  } catch (error: any) {
    toast.error(error?.message || '确认路径调整失败');
  } finally {
    replanConfirmLoading.value = false;
  }
};

const dismissReplanResult = () => {
  replanExecutionResult.value = null;
};

const refreshPathAfterReplan = async () => {
  await loadPathData();
  toast.success('已刷新当前路径');
};

const isGenerationBusy = computed(() => {
  const lifecycle = generationLifecycle.value.lifecycle;
  return lifecycle === 'core_queued'
    || lifecycle === 'core_processing'
    || lifecycle === 'stage_design_queued'
    || lifecycle === 'stage_design_processing';
});
const shouldPollGeneration = computed(() => isGenerationBusy.value || pendingDetailRefresh.value);

const GENERATION_POLL_INTERVAL_MS = 4000;
const GENERATION_POLL_MAX_BACKOFF_MS = 60000;

const scheduleGenerationPolling = (delay = GENERATION_POLL_INTERVAL_MS) => {
  if (document.hidden || isVirtualSessionView.value || !shouldPollGeneration.value) return;
  if (generationPollingTimer) window.clearTimeout(generationPollingTimer);
  generationPollingTimer = window.setTimeout(() => {
    generationPollingTimer = null;
    void pollGenerationStatus();
  }, delay);
};

const pollGenerationStatus = async () => {
  if (generationPollingInFlight.value || document.hidden || !shouldPollGeneration.value || !path.value?.id) return;
  generationPollingInFlight.value = true;
  const previous = generationLifecycle.value;
  try {
    if (pendingDetailRefresh.value && !isGenerationBusy.value) {
      const refreshed = await loadPathData({ background: true });
      if (!refreshed) throw new Error('path detail refresh failed');
      pendingDetailRefresh.value = false;
      generationPollingFailureCount = 0;
      stopGenerationPolling();
      return;
    }

    const lifecycle = await learningAPI.getPathGenerationStatus(path.value.id);
    path.value = mergeGenerationLifecycle(path.value, lifecycle);
    backgroundRefreshMessage.value = '';
    generationPollingFailureCount = 0;

    const coreJustCompleted = previous.phase === 'core' && lifecycle.phase === 'stage_design';
    const becameReady = previous.lifecycle !== 'ready' && lifecycle.lifecycle === 'ready';
    if (coreJustCompleted || becameReady) {
      pendingDetailRefresh.value = becameReady;
      const refreshed = await loadPathData({ background: true, skipLearnerCenter: !becameReady });
      if (!refreshed) throw new Error('path detail refresh failed');
      pendingDetailRefresh.value = false;
    }

    if (shouldPollGeneration.value) scheduleGenerationPolling();
    else stopGenerationPolling();
  } catch {
    generationPollingFailureCount += 1;
    backgroundRefreshMessage.value = '后台状态刷新失败，当前内容已保留，稍后会自动重试。';
    const delay = Math.min(
      GENERATION_POLL_INTERVAL_MS * (2 ** generationPollingFailureCount),
      GENERATION_POLL_MAX_BACKOFF_MS
    );
    scheduleGenerationPolling(delay);
  } finally {
    generationPollingInFlight.value = false;
  }
};

const startGenerationPolling = () => {
  if (generationPollingTimer || generationPollingInFlight.value) return;
  scheduleGenerationPolling();
};

const stopGenerationPolling = () => {
  if (generationPollingTimer) {
    window.clearTimeout(generationPollingTimer);
    generationPollingTimer = null;
  }
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    stopGenerationPolling();
    return;
  }
  if (shouldPollGeneration.value) scheduleGenerationPolling(0);
};

const viewTaskEvaluation = async (task: Task) => {
  try {
    const result = await aiTeachingAPI.getLatestTaskEvaluation(task.id);
    if (!result) {
      toast.warning('暂无当堂评估记录');
      return;
    }
    const pathQuery = effectivePathId.value ? { pathId: effectivePathId.value } : undefined;
    router.push({
      path: `${learnBasePath.value}/${task.id}/evaluation/${result.sessionId}`,
      query: buildRouteQuery(pathQuery),
    });
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || '获取当堂评估失败');
  }
};

const getWeekProgress = (week: PathDetailStage) => {
  const tasks = week.subtasks || week.tasks || [];
  if (!tasks || tasks.length === 0) return 0;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  return Math.round((completed / tasks.length) * 100);
};

const getWeekCompletedCount = (week: PathDetailStage) => {
  const tasks = week.subtasks || week.tasks || [];
  return tasks.filter((t) => t.status === 'completed').length;
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

const getStatusType = (status?: string) => {
  const statusMap: Record<string, string> = {
    todo: 'info',
    in_progress: 'warning',
    completed: 'success',
    skipped: 'danger'
  };
  return (status && statusMap[status]) || 'info';
};

const getStatusText = (status?: string) => {
  const statusMap: Record<string, string> = {
    todo: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    skipped: '已跳过'
  };
  return (status && statusMap[status]) || status;
};

const getTaskTypeText = (type?: string) => {
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
  return (type && typeMap[type]) || type;
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

const buildRouteQuery = (extra: Record<string, string> = {}) => {
  const query: Record<string, string> = {};
  if (virtualSessionId.value) query.virtualSessionId = virtualSessionId.value;
  if (viewMode.value) query.viewMode = viewMode.value;
  return { ...query, ...extra };
};

const loadVirtualContext = async () => {
  if (!virtualSessionId.value) {
    virtualContext.value = null;
    return;
  }

  const response = await adminApi.getVirtualSessionContext(virtualSessionId.value);
  if (!response.data?.success) {
    throw new Error(response.data?.error || '加载虚拟会话上下文失败');
  }

  virtualContext.value = response.data.data;
};

onMounted(() => {
  loadPathData();
  window.addEventListener('scroll', handleScroll);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

// 同组件实例切换到另一条路径时重新加载（路由复用组件，不会重新挂载）
watch(pathId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    loadPathData();
  }
});

onUnmounted(() => {
  stopGenerationPolling();
  window.removeEventListener('scroll', handleScroll);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
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
  min-width: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

.path-detail-skeleton {
  display: grid;
  gap: 24px;
}

.path-detail-skeleton__hero {
  min-height: 330px;
  padding: 28px;
  display: grid;
  align-content: start;
  gap: 18px;
}

.path-detail-skeleton__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.path-detail-skeleton__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
}

.path-detail-skeleton__stages {
  display: grid;
  gap: 16px;
}

.detail-skeleton {
  display: block;
  border-radius: 12px;
  background: linear-gradient(100deg, rgba(226, 232, 240, 0.72) 20%, rgba(248, 250, 252, 0.96) 45%, rgba(226, 232, 240, 0.72) 70%);
  background-size: 200% 100%;
  animation: detail-skeleton-shimmer 1.5s ease-in-out infinite;
}

.detail-skeleton--pill { width: 96px; height: 28px; border-radius: 999px; }
.detail-skeleton--title { width: min(560px, 72%); height: 48px; }
.detail-skeleton--copy { width: min(720px, 88%); height: 18px; }
.detail-skeleton--metric { height: 82px; border-radius: 18px; }
.detail-skeleton--stage { height: 96px; border-radius: 22px; }
.detail-skeleton--side { height: 360px; border-radius: 22px; }

@keyframes detail-skeleton-shimmer {
  from { background-position: 180% 0; }
  to { background-position: -20% 0; }
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

.path-detail-hero__mobile-cta {
  display: none;
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

.generation-lifecycle-banner {
  min-height: 128px;
  margin-top: 16px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(52, 120, 246, 0.06);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.7fr) auto;
  align-items: center;
  gap: 18px;
}

.generation-lifecycle-banner--failed,
.generation-lifecycle-banner--stale {
  border-color: rgba(245, 108, 108, 0.2);
  background: rgba(245, 108, 108, 0.07);
}

.generation-lifecycle-banner__copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.generation-lifecycle-banner__copy > span,
.generation-stage-progress__copy span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.generation-lifecycle-banner__copy strong {
  color: var(--text-primary);
  font-size: 16px;
}

.generation-lifecycle-banner__copy p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.generation-stage-progress {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.generation-stage-progress__copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.generation-stage-progress__copy strong {
  color: var(--text-primary);
  font-size: 14px;
}

.generation-stage-progress__track {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  max-width: 100%;
  padding-bottom: 2px;
  scrollbar-width: thin;
}

.generation-stage-progress__track span {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.generation-stage-progress__track span.is-done {
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.1);
  color: #0f8a63;
}

.generation-stage-progress__track span.is-current {
  border-color: rgba(52, 120, 246, 0.24);
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.core-generation-panel {
  min-height: 360px;
  padding: 28px;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);
  align-items: center;
  gap: 32px;
  margin-bottom: 40px;
}

.core-generation-panel__copy {
  display: grid;
  gap: 14px;
}

.core-generation-panel__copy h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.15;
}

.core-generation-panel__copy p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.core-generation-panel__placeholder {
  display: grid;
  gap: 14px;
  padding: 22px;
  border-radius: 22px;
  background: rgba(243, 246, 251, 0.82);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.core-generation-panel__placeholder span {
  height: 52px;
  border-radius: 14px;
  background: rgba(52, 120, 246, 0.08);
}

.core-generation-panel__placeholder span:nth-child(2) { width: 88%; }
.core-generation-panel__placeholder span:nth-child(3) { width: 76%; }
.core-generation-panel__placeholder span:nth-child(4) { width: 64%; }

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

.replan-advisory-banner {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(245, 108, 108, 0.18);
  background: rgba(255, 247, 245, 0.86);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.replan-advisory-banner__copy strong {
  color: #8a3b2a;
}

.replan-advisory-banner__copy p {
  margin: 8px 0 0;
  color: #7a5d56;
  line-height: 1.7;
}

.replan-advisory-banner__meta {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #8d6b63;
}

.replan-advisory-banner__action-copy {
  font-weight: 600;
}

.replan-advisory-banner__chips {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.replan-advisory-banner__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.replan-advisory-banner__hint {
  font-size: 12px;
  color: #7a8599;
}

.replan-result-banner {
  margin-top: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.08), rgba(31, 87, 204, 0.04));
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.replan-result-banner__copy {
  display: grid;
  gap: 8px;
}

.replan-result-banner__copy strong {
  font-size: 15px;
  color: #1f57cc;
}

.replan-result-banner__copy p {
  margin: 0;
  color: #435066;
  line-height: 1.6;
}

.replan-result-banner__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: #5d6b82;
}

.replan-result-banner__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.replan-preview-dialog {
  display: grid;
  gap: 18px;
}

.replan-preview-dialog__hero {
  display: grid;
  gap: 8px;
}

.replan-preview-dialog__hero strong {
  font-size: 18px;
  color: #172033;
}

.replan-preview-dialog__hero p {
  margin: 0;
  color: #5d6b82;
  line-height: 1.7;
}

.replan-preview-dialog__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.replan-preview-dialog__meta-item {
  padding: 14px;
  border-radius: 14px;
  background: rgba(244, 247, 252, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.05);
  display: grid;
  gap: 6px;
}

.replan-preview-dialog__meta-item span {
  font-size: 12px;
  color: #7a8599;
}

.replan-preview-dialog__meta-item strong {
  color: #172033;
  line-height: 1.5;
}

.replan-preview-dialog__section {
  display: grid;
  gap: 10px;
}

.replan-preview-dialog__list {
  margin: 0;
  padding-left: 18px;
  color: #435066;
  line-height: 1.7;
}

.replan-preview-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.path-detail-chip--warn {
  background: rgba(245, 108, 108, 0.12);
  color: #c45656;
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

  .path-detail-skeleton__body,
  .core-generation-panel {
    grid-template-columns: 1fr;
  }

  .generation-lifecycle-banner {
    grid-template-columns: 1fr;
    align-items: stretch;
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

  .replan-result-banner {
    flex-direction: column;
  }

  .replan-result-banner__actions {
    width: 100%;
  }

  .replan-preview-dialog__meta {
    grid-template-columns: 1fr;
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

  .path-detail-skeleton__hero,
  .core-generation-panel {
    padding: 18px;
  }

  .path-detail-skeleton__metrics {
    grid-template-columns: 1fr;
  }

  .detail-skeleton--title,
  .detail-skeleton--copy {
    width: 100%;
  }

  .generation-lifecycle-banner {
    padding: 16px;
  }

  .path-detail-hero__mobile-cta {
    display: inline-flex;
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
    width: 100%;
  }

  .path-detail-hero__progress > .btn--full {
    display: none;
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

  .path-detail-hero__tags,
  .replan-advisory-banner__meta,
  .replan-result-banner__actions {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gradient-orb,
  .loading-icon,
  .detail-skeleton {
    animation: none !important;
  }

  .week-card,
  .task-card,
  .progress-fill,
  .expand-icon,
  .btn,
  .task-btn {
    transition: none !important;
  }

  .task-card:hover,
  .btn-primary:hover,
  .btn-start:hover {
    transform: none;
  }
}

</style>
