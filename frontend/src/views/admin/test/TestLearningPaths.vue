<template>
  <div class="test-paths-page paths-upgrade">
    <div class="paths-bg-layer">
      <div class="paths-bg-orb paths-bg-orb--1"></div>
      <div class="paths-bg-orb paths-bg-orb--2"></div>
    </div>

    <header class="dashboard-header" :class="{ 'dashboard-header--scrolled': scrolled }">
      <div class="header-container">
        <button type="button" class="brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="brand-logo" />
        </button>

        <nav class="header-nav" aria-label="测试站点导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths" class="nav-item--active">测试学习路径</router-link>
          <router-link to="/admin/test/learning-state">测试学习状态</router-link>
          <router-link to="/admin/test/achievements">测试成就</router-link>
        </nav>

        <div class="header-right">
          <router-link to="/admin/test/goal-full" class="header-cta">新建测试目标</router-link>
        </div>
      </div>
    </header>

    <main class="main-content paths-main">
      <div class="content-container paths-shell">
        <transition name="slide-down">
          <el-alert
            v-if="showGeneratingAlert"
            title="测试路径正在生成，通常 1-3 分钟完成。"
            type="info"
            :closable="true"
            show-icon
            class="generating-alert"
            @close="showGeneratingAlert = false"
          />
        </transition>

        <section v-if="goalScenePath" class="paths-scene-banner glass-card" :class="`paths-scene-banner--${goalSceneState}`">
          <div class="paths-scene-banner__copy">
            <span class="pill">Goal -> Path Scene</span>
            <h2>{{ goalSceneTitle }}</h2>
            <p>{{ goalSceneDescription }}</p>
          </div>

          <div class="paths-scene-banner__meta">
            <div class="paths-scene-banner__steps">
              <span
                v-for="step in goalSceneSteps"
                :key="step.key"
                class="paths-scene-step"
                :class="{
                  'paths-scene-step--active': step.active,
                  'paths-scene-step--done': step.done
                }"
              >
                {{ step.label }}
              </span>
            </div>

            <div v-if="goalSceneHighlights.length > 0" class="paths-scene-banner__chips">
              <span v-for="item in goalSceneHighlights" :key="item" class="paths-scene-chip">{{ item }}</span>
            </div>

            <div class="paths-scene-banner__actions">
              <button
                v-if="goalScenePath.id && goalSceneState === 'ready'"
                type="button"
                class="btn btn-primary"
                @click="goToPathDetail(goalScenePath.id)"
              >查看这版路径</button>
              <button
                v-else
                type="button"
                class="btn btn-ghost"
                @click="loadPaths"
              >刷新状态</button>
            </div>
          </div>
        </section>

        <section class="paths-hero glass-card">
          <div class="paths-hero__copy">
            <span class="pill">测试工作台</span>
            <h1>查看测试路径、scene 状态和阶段任务生成情况。</h1>
            <p>这里承接 goal -> path 的测试链路，重点观察路径主结构、阶段任务生成和失败重试状态。</p>
          </div>
          <div class="paths-hero__actions">
            <button v-if="primaryPath" type="button" class="btn btn-primary" @click="continuePath(primaryPath)">继续学习</button>
            <router-link to="/admin/test/goal-full" class="btn btn-ghost">创建测试目标</router-link>
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

        <section v-if="visiblePaths.length > 0" class="paths-bulk-toolbar glass-card">
          <div class="paths-bulk-toolbar__meta">
            <span class="pill">批量操作</span>
            <strong>已选择 {{ selectedPathIds.length }} 条路径</strong>
          </div>
          <div class="paths-bulk-toolbar__actions">
            <button type="button" class="btn btn-ghost" :disabled="selectedPathIds.length === 0" @click="clearSelection">清空选择</button>
            <button type="button" class="btn btn-primary" :disabled="selectedReadyPathIds.length === 0 || batchRegenerating" @click="confirmBatchRegenerate">
              {{ batchRegenerating ? '批量重新生成中...' : `批量重新生成（${selectedReadyPathIds.length}）` }}
            </button>
          </div>
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
                  { 'path-overview-card--scene': goalScenePath?.id === path.id }
                ]"
              >
                <label class="path-overview-card__select" @click.stop>
                  <input v-model="selectedPathIds" type="checkbox" :value="path.id" />
                  <span>选择</span>
                </label>
                <template v-if="getPathDisplayState(path) === 'generating'">
                  <div class="path-overview-card__status-row">
                    <span class="path-state-pill path-state-pill--generating">生成中</span>
                    <span v-if="path.generationStatus?.coreStep" class="path-state-pill path-state-pill--soft">{{ getCoreStepLabel(path) }}</span>
                  </div>
                  <strong>{{ getPathTitle(path) }}</strong>
                  <p>{{ getPathSummary(path) || '这条测试学习路径正在生成。' }}</p>
                  <div class="path-overview-card__progress-bar">
                    <div
                      class="path-overview-card__progress-fill path-overview-card__progress-fill--loading"
                      :class="`path-overview-card__progress-fill--${getGeneratingProgressStage(path)}`"
                      :style="{ width: `${getGeneratingProgressWidth(path)}%` }"
                    ></div>
                  </div>
                  <div class="path-overview-card__progress-copy">
                    <span>{{ getGeneratingProgressText(path) }}</span>
                    <strong>{{ getGeneratingProgressWidth(path) }}%</strong>
                  </div>
                  <div class="path-overview-card__actions-row">
                    <button type="button" class="btn btn-ghost" @click="loadPaths">刷新状态</button>
                  </div>
                </template>

                <template v-else-if="getPathDisplayState(path) === 'attention'">
                  <div class="path-overview-card__status-row">
                    <span class="path-state-pill path-state-pill--failed">待重试</span>
                  </div>
                  <strong>{{ getPathTitle(path) }}</strong>
                  <p>{{ getFailureCopy(path) }}</p>
                  <div class="path-overview-card__actions-row">
                    <button type="button" class="btn btn-ghost" :disabled="retryingPathId === path.id || batchRegenerating" @click="retryPathGeneration(path)">{{ getRetryButtonLabel(path) }}</button>
                    <button type="button" class="btn btn-ghost" :disabled="batchRegenerating" @click="confirmDelete(path)">删除</button>
                  </div>
                </template>

                <template v-else>
                  <div class="path-overview-card__status-row">
                    <span class="path-state-pill path-state-pill--active">进行中</span>
                    <span v-if="path.generationStatus?.coreStep" class="path-state-pill path-state-pill--soft">{{ getCoreStepLabel(path) }}</span>
                  </div>
                  <div class="path-overview-card__head">
                    <strong>{{ getPathTitle(path) }}</strong>
                    <el-dropdown trigger="click" :disabled="batchRegenerating" @command="(cmd) => handleCommand(cmd, path)">
                      <button type="button" class="more-btn" :disabled="batchRegenerating" @click.stop>
                        <el-icon><More /></el-icon>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="regenerate" :disabled="batchRegenerating">
                            <el-icon><Refresh /></el-icon>
                            <span>重新生成路径</span>
                          </el-dropdown-item>
                          <el-dropdown-item command="delete" class="delete-item" :disabled="batchRegenerating">
                            <el-icon><Delete /></el-icon>
                            <span>删除路径</span>
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                  <p>{{ getPathSummary(path) }}</p>
                  <div v-if="getPathInsightChips(path).length > 0" class="path-overview-card__chips">
                    <span v-for="item in getPathInsightChips(path)" :key="item" class="path-overview-card__chip">{{ item }}</span>
                  </div>
                  <div v-if="getPathDesignBrief(path).length > 0" class="path-overview-card__brief">
                    <article v-for="item in getPathDesignBrief(path)" :key="item.label" class="path-overview-card__brief-item">
                      <span>{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                    </article>
                  </div>
                  <div class="path-overview-card__next-task">
                    <span>当前任务</span>
                    <strong>{{ getPathNextTaskLabel(path) }}</strong>
                  </div>
                  <div class="path-overview-card__stats">
                    <span>当前阶段：{{ getPathCurrentStage(path) }} / {{ getPathStageCount(path) }}</span>
                    <span>预计投入：{{ getPathEstimatedHours(path) }} 小时</span>
                  </div>
                  <div class="path-overview-card__meta-row">
                    <span>创建于：{{ formatCreatedAt(path.createdAt) }}</span>
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

                  <details v-if="path.sceneSummary" class="path-overview-card__pretransmit">
                    <summary class="path-overview-card__pretransmit-toggle">
                      <span>预传递信息</span>
                      <el-icon><ArrowDown /></el-icon>
                    </summary>
                    <div class="path-overview-card__pretransmit-content">
                      <div v-if="path.sceneSummary.intent" class="pretransmit-row pretransmit-row--intent">
                        <span class="pretransmit-label">路径意图</span>
                        <p>{{ path.sceneSummary.intent }}</p>
                      </div>
                      <div v-if="path.sceneSummary.timeBudget || path.sceneSummary.timeHorizon" class="pretransmit-row">
                        <span class="pretransmit-label">资源画像</span>
                        <span class="pretransmit-value">
                          <span v-if="path.sceneSummary.timeBudget">时间：{{ path.sceneSummary.timeBudget }}</span>
                          <span v-if="path.sceneSummary.timeHorizon"> · 周期：{{ path.sceneSummary.timeHorizon }}</span>
                          <span v-if="path.sceneSummary.pace"> · 节奏：{{ path.sceneSummary.pace }}</span>
                        </span>
                      </div>
                      <div v-if="path.sceneSummary.excludedScope?.length" class="pretransmit-row">
                        <span class="pretransmit-label">排除范围</span>
                        <span class="pretransmit-value">{{ path.sceneSummary.excludedScope.join('、') }}</span>
                      </div>
                      <div v-if="path.sceneSummary.riskFlags?.length" class="pretransmit-row">
                        <span class="pretransmit-label">风险标记</span>
                        <span class="pretransmit-value">{{ path.sceneSummary.riskFlags.join('、') }}</span>
                      </div>
                    </div>
                  </details>

                  <details v-if="path.generationStatus?.sourceConversationId" class="path-overview-card__goal-input">
                    <summary class="path-overview-card__goal-toggle">
                      <span>Goal输入数据</span>
                      <el-icon><ArrowDown /></el-icon>
                    </summary>
                    <div class="path-overview-card__goal-content">
                      <div class="goal-row">
                        <span class="goal-label">来源对话</span>
                        <span class="goal-value goal-value--id">{{ path.generationStatus.sourceConversationId }}</span>
                      </div>
                      <button 
                        v-if="!goalDataCache[path.generationStatus.sourceConversationId]" 
                        class="goal-load-btn" 
                        @click="loadGoalData(path.generationStatus.sourceConversationId)"
                        :disabled="loadingGoalId === path.generationStatus.sourceConversationId"
                      >
                        <el-icon v-if="loadingGoalId === path.generationStatus.sourceConversationId"><Loading /></el-icon>
                        <span>{{ loadingGoalId === path.generationStatus.sourceConversationId ? '加载中...' : '加载目标数据' }}</span>
                      </button>
                      <template v-else>
                        <div v-if="goalDataCache[path.generationStatus.sourceConversationId]?.understanding?.real_problem" class="goal-row goal-row--block">
                          <span class="goal-label">真实问题</span>
                          <p class="goal-text">{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.real_problem }}</p>
                        </div>
                        <div v-if="goalDataCache[path.generationStatus.sourceConversationId]?.understanding?.pain_points" class="goal-row goal-row--block">
                          <span class="goal-label">核心痛点</span>
                          <p class="goal-text">{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.pain_points }}</p>
                        </div>
                        <div v-if="goalDataCache[path.generationStatus.sourceConversationId]?.understanding?.motivation" class="goal-row goal-row--block">
                          <span class="goal-label">学习动机</span>
                          <p class="goal-text">{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.motivation }}</p>
                        </div>
                        <div v-if="goalDataCache[path.generationStatus.sourceConversationId]?.confirmedProposal" class="goal-row goal-row--block">
                          <span class="goal-label">确认方案</span>
                          <div class="goal-proposal">
                            <p v-if="goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.problemText">
                              <strong>方向：</strong>{{ goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.problemText }}
                            </p>
                            <p v-if="goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.deliverableText">
                              <strong>首个交付：</strong>{{ goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.deliverableText }}
                            </p>
                            <p v-if="goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.keyStages?.length">
                              <strong>阶段：</strong>{{ goalDataCache[path.generationStatus.sourceConversationId].confirmedProposal.keyStages.join(' → ') }}
                            </p>
                          </div>
                        </div>
                        <div v-if="goalDataCache[path.generationStatus.sourceConversationId]?.understanding?.background" class="goal-row">
                          <span class="goal-label">资源画像</span>
                          <span class="goal-value">
                            <span v-if="goalDataCache[path.generationStatus.sourceConversationId].understanding.background.expected_time">
                              周期：{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.background.expected_time }}
                            </span>
                            <span v-if="goalDataCache[path.generationStatus.sourceConversationId].understanding.background.available_time">
                              · 时间：{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.background.available_time }}
                            </span>
                            <span v-if="goalDataCache[path.generationStatus.sourceConversationId].understanding.background.urgency">
                              · 紧迫度：{{ goalDataCache[path.generationStatus.sourceConversationId].understanding.background.urgency }}
                            </span>
                          </span>
                        </div>
                      </template>
                    </div>
                  </details>

                  <div class="path-overview-card__actions-row">
                    <button type="button" class="btn btn-primary" @click="continuePath(path)">继续学习</button>
                    <button type="button" class="btn btn-ghost" @click="goToPathDetail(path.id)">查看详情</button>
                  </div>
                </template>
              </article>
            </div>

            <section v-else-if="!loading" class="paths-empty-state glass-card">
              <span class="pill">还没有测试路径</span>
              <h2>还没有测试路径。</h2>
              <p>先创建一个测试目标，生成第一条测试学习路径。</p>
              <router-link to="/admin/test/goal-full" class="btn btn-primary">创建测试目标</router-link>
            </section>
          </div>
        </section>
      </div>
    </main>

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
        删除测试学习路径将永久删除此路径及其所有数据。此操作不可恢复。
      </el-alert>

      <p class="delete-confirm-text">
        您确定要删除测试学习路径 <strong class="delete-path-name">{{ pathToDelete?.name || pathToDelete?.title }}</strong> 吗？
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
      title="重新生成测试学习路径"
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
        将基于当前测试目标重新生成该学习路径。已完成任务和学习记录不会被删除，但路径结构可能变化。
      </el-alert>

      <p class="delete-confirm-text">
        您确定要重新生成测试学习路径 <strong class="delete-path-name">{{ pathToRegenerate?.name || pathToRegenerate?.title }}</strong> 吗？
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import {
  Delete,
  More,
  Refresh,
  ArrowDown,
  Loading
} from '@element-plus/icons-vue';
import request from '@/utils/request';
import { learningAPI } from '@/api/learning';
import { toast } from '@/utils/toast';

const router = useRouter();
const route = useRoute();

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
const batchRegenerating = ref(false);
const selectedPathIds = ref<string[]>([]);
const activePathFilter = ref<'all' | 'active' | 'generating' | 'attention'>('all');
const goalDataCache = ref<Record<string, any>>({});
const loadingGoalId = ref<string | null>(null);
let generatingAlertTimer: number | null = null;

const formatCreatedAt = (value: string | null | undefined) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const GENERATION_TIMEOUT_SECONDS = 240;
const notifiedTimeoutIds = new Set<string>();

const isPathTimeout = (path: any) => {
  if (!path.createdAt) return false;
  return (Date.now() - new Date(path.createdAt).getTime()) / 1000 > GENERATION_TIMEOUT_SECONDS;
};

const generatingPaths = computed(() => paths.value.filter((p: any) => p.status === 'generating'));
const enrichingPaths = computed(() => paths.value.filter((p: any) => {
  const enrichmentStatus = p?.generationStatus?.stageDesign;
  return p.status === 'active' && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing');
}));
const timeoutPaths = computed(() => generatingPaths.value.filter((p: any) => isPathTimeout(p)));
const isEnrichmentStale = (path: any) => {
  const enrichmentStatus = path?.generationStatus?.stageDesign;
  if (!(enrichmentStatus === 'pending' || enrichmentStatus === 'processing')) return false;

  const rawTime = path?.generationStatus?.updatedAt
    || path?.generationStatus?.lastStageDesignRetryAt
    || path?.updatedAt
    || path?.createdAt;
  if (!rawTime) return false;

  const timestamp = new Date(rawTime).getTime();
  if (!Number.isFinite(timestamp)) return false;

  return (Date.now() - timestamp) / 1000 > GENERATION_TIMEOUT_SECONDS;
};

const canRetryEnrichment = (path: any) => {
  if (path?.status !== 'active') return false;

  const enrichmentStatus = path?.generationStatus?.stageDesign;
  if (enrichmentStatus === 'failed') return true;
  if ((enrichmentStatus === 'pending' || enrichmentStatus === 'processing') && isEnrichmentStale(path)) {
    return true;
  }
  return false;
};

const getPathTitle = (path: any) => path.name || path.title || '未命名路径';
const getPathSummary = (path: any) => path.summary || path.description || '这里会显示路径摘要。';
const getPathStages = (path: any) => path?.milestones || path?.weeks || [];
const normalizeTaskList = (stage: any) => stage?.subtasks || stage?.tasks || [];
const getActiveStage = (path: any) => getPathStages(path).find((stage: any) => normalizeTaskList(stage).some((task: any) => task.status !== 'completed')) || getPathStages(path)[0] || null;
const getPrimaryActionTask = (path: any) => {
  const tasks = normalizeTaskList(getActiveStage(path));
  return tasks.find((task: any) => task.status === 'todo') || tasks.find((task: any) => task.status === 'in_progress') || null;
};
const getPathContinueTarget = (path: any) => {
  const nextTask = getPrimaryActionTask(path);
  if (nextTask?.id) return `/admin/test/learn/${nextTask.id}`;
  return `/admin/test/learning-path/${path.id}`;
};
const getPathDisplayState = (path: any) => {
  if (path.status === 'failed') return 'attention';
  if (path.status === 'generating') return isPathTimeout(path) ? 'attention' : 'generating';
  if (path?.generationStatus?.stageDesign === 'failed') return 'attention';
  if (isEnrichmentStale(path)) return 'attention';
  if (path?.generationStatus?.stageDesign === 'processing' || path?.generationStatus?.stageDesign === 'pending') return 'generating';
  return 'active';
};
const getPathStateLabel = (path: any) => {
  const state = getPathDisplayState(path);
  if (state === 'generating') return '生成中';
  if (state === 'attention') return '待处理';
  return '进行中';
};
const getCoreStepLabel = (path: any) => {
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return '方向收敛';
  if (step === 'planning') return '任务拆解';
  if (step === 'persist') return '路径落成';
  if (step === 'completed') return '主结构完成';
  return '路径生成';
};
const getGeneratingProgressStage = (path: any) => {
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return 'framing';
  if (step === 'planning') return 'planning';
  if (step === 'persist') return 'persist';
  if (step === 'completed') return 'completed';
  return 'default';
};
const getGeneratingProgressWidth = (path: any) => {
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return 26;
  if (step === 'planning') return 58;
  if (step === 'persist') return 82;
  if (step === 'completed') return 96;
  return 38;
};
const getGeneratingProgressText = (path: any) => {
  const step = path?.generationStatus?.coreStep;
  if (step === 'framing') return '正在收敛目标、约束和首个交付物';
  if (step === 'planning') return '正在生成认知骨架与任务链';
  if (step === 'persist') return '正在写入路径结构并准备内容';
  if (step === 'completed') return '主结构已完成，正在切换到阶段任务生成';
  return '正在生成测试学习路径';
};

const getPathInsightChips = (path: any) => {
  const chips: string[] = [];
  const domain = typeof path?.cognitiveDesign?.cognitiveDomain === 'string'
    ? path.cognitiveDesign.cognitiveDomain.trim()
    : '';
  const planningFocus = Array.isArray(path?.sceneSummary?.planningFocus)
    ? path.sceneSummary.planningFocus.filter(Boolean)
    : [];

  if (domain) {
    chips.push(`认知域：${domain}`);
  }

  planningFocus.slice(0, 2).forEach((item: string) => {
    chips.push(`重点：${item}`);
  });

  return chips.slice(0, 3);
};

const getPathDesignBrief = (path: any) => {
  const brief: Array<{ label: string; value: string }> = [];
  const firstDeliverable = typeof path?.sceneSummary?.firstDeliverable === 'string'
    ? path.sceneSummary.firstDeliverable.trim()
    : '';
  const targetState = typeof path?.sceneSummary?.targetState === 'string'
    ? path.sceneSummary.targetState.trim()
    : '';

  if (firstDeliverable) {
    brief.push({ label: '首个交付物', value: firstDeliverable });
  }

  if (targetState) {
    brief.push({ label: '目标状态', value: targetState });
  }

  return brief.slice(0, 2);
};

const getPathNextTaskLabel = (path: any) => {
  return getPrimaryActionTask(path)?.title || '进入路径查看安排';
};

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

const getFailureCopy = (path: any) => {
  if (path.status === 'generating' && isPathTimeout(path)) {
    return path.description || '这条路径生成时间较长，可以稍后刷新，或直接重试。';
  }
  if (isEnrichmentStale(path)) {
    return path.learningBlockedReason || path.description || '阶段任务生成时间过长，建议手动重试或查看详情。';
  }
  return path.description || path.summary || '这条路径暂时没有生成成功，可以直接重试。';
};

const getRetryActionLabel = (path: any) => {
  if (canRetryEnrichment(path)) {
    return '继续生成阶段任务';
  }
  return '重试';
};
const getRetryButtonLabel = (path: any) => {
  if (retryingPathId.value !== path.id) {
    return getRetryActionLabel(path);
  }
  return canRetryEnrichment(path) ? '继续生成中...' : '重试中...';
};

const handleCommand = (command: string, path: any) => {
  if (command === 'regenerate') {
    confirmRegenerate(path);
  } else if (command === 'delete') {
    confirmDelete(path);
  }
};

const sortedPaths = computed(() => {
  const priority = { active: 0, generating: 1, attention: 2 } as const;
  return [...paths.value].sort((a, b) => {
    const stateDiff = priority[getPathDisplayState(a)] - priority[getPathDisplayState(b)];
    if (stateDiff !== 0) return stateDiff;
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  });
});

const primaryPath = computed(() => sortedPaths.value.find((path: any) => getPathDisplayState(path) === 'active') || null);
const pathFilterChips = computed(() => {
  const list = sortedPaths.value;
  return [
    { key: 'all', label: '全部', count: list.length },
    { key: 'active', label: '进行中', count: list.filter((path: any) => getPathDisplayState(path) === 'active').length },
    { key: 'generating', label: '生成中', count: list.filter((path: any) => getPathDisplayState(path) === 'generating').length },
    { key: 'attention', label: '待处理', count: list.filter((path: any) => getPathDisplayState(path) === 'attention').length }
  ];
});
const visiblePaths = computed(() => activePathFilter.value === 'all' ? sortedPaths.value : sortedPaths.value.filter((path: any) => getPathDisplayState(path) === activePathFilter.value));
const selectedPaths = computed(() => visiblePaths.value.filter((path: any) => selectedPathIds.value.includes(path.id)));
const selectedReadyPathIds = computed(() => selectedPaths.value.filter((path: any) => getPathDisplayState(path) === 'active').map((path: any) => path.id));
watch(visiblePaths, (list) => {
  const visibleIds = new Set(list.map((path: any) => path.id));
  selectedPathIds.value = selectedPathIds.value.filter((id) => visibleIds.has(id));
});

const goalSourceConversationId = computed(() => {
  const raw = route.query.conversationId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
});
const goalSceneCandidates = computed(() => {
  if (!(route.query.from === 'goal' && route.query.auto === '1')) return [];
  const exactConversationId = goalSourceConversationId.value;
  const list = sortedPaths.value;
  if (exactConversationId) {
    const matched = list.filter((path: any) => path?.generationStatus?.sourceConversationId === exactConversationId);
    if (matched.length > 0) return matched;
  }
  return list.filter((path: any) => Boolean(path?.generationStatus?.sourceConversationId || path.status === 'generating'));
});
const goalScenePath = computed(() => goalSceneCandidates.value[0] || null);
const goalSceneState = computed<'processing' | 'ready' | 'attention'>(() => {
  const path = goalScenePath.value;
  if (!path) return 'processing';
  const displayState = getPathDisplayState(path);
  if (displayState === 'attention') return 'attention';
  if (displayState === 'active' && path?.generationStatus?.stageDesign === 'succeeded') return 'ready';
  if (displayState === 'active') return 'processing';
  return 'processing';
});
const goalSceneTitle = computed(() => {
  const path = goalScenePath.value;
  if (!path) return '正在生成你的第一版完整测试路径';
  if (goalSceneState.value === 'attention') return '这版测试路径需要你重试或继续观察';
  if (goalSceneState.value === 'ready') return '这版完整测试路径已经准备好了';
  return `当前步骤：${getCoreStepLabel(path)}`;
});
const goalSceneDescription = computed(() => {
  const path = goalScenePath.value;
  if (!path) return '这里会显示 goal -> path 场景状态、阶段和任务生成情况。';
  if (goalSceneState.value === 'attention') return path.learningBlockedReason || path.summary || '当前生成遇到问题，可以刷新状态或直接重试。';
  if (goalSceneState.value === 'ready') return path.summary || '你现在可以直接查看完整阶段任务路径。';
  const scene = path.sceneSummary || path.generationStatus?.scene || {};
  const firstDeliverable = scene.firstDeliverable ? `先拿到「${scene.firstDeliverable}」` : '先收敛第一版可交付结果';
  return `${firstDeliverable}，期间会按时间投入拆成完整任务级路径。`;
});
const goalSceneHighlights = computed(() => {
  const path = goalScenePath.value;
  if (!path) return [];
  const scene = path.sceneSummary || path.generationStatus?.scene || {};
  return [
    scene.timeBudget ? `时间投入：${scene.timeBudget}` : '',
    scene.timeHorizon ? `周期：${scene.timeHorizon}` : '',
    typeof scene.milestoneCount === 'number' && scene.milestoneCount > 0 ? `${scene.milestoneCount} 个阶段` : '',
    typeof scene.taskCount === 'number' && scene.taskCount > 0 ? `${scene.taskCount} 个任务` : '',
  ].filter(Boolean);
});
const goalSceneSteps = computed(() => {
  const path = goalScenePath.value;
  const coreStep = path?.generationStatus?.coreStep;
  const coreStatus = path?.generationStatus?.core;
  const enrichmentStatus = path?.generationStatus?.enrichment;
  return [
    { key: 'framing', label: '方向收敛', active: coreStep === 'framing', done: coreStep !== 'framing' && !!coreStep },
    { key: 'planning', label: '任务拆解', active: coreStep === 'planning', done: coreStep === 'persist' || coreStep === 'completed' || coreStatus === 'succeeded' },
    { key: 'persist', label: '路径落成', active: coreStep === 'persist', done: coreStatus === 'succeeded' },
    { key: 'enrichment', label: '阶段任务生成', active: enrichmentStatus === 'pending' || enrichmentStatus === 'processing', done: enrichmentStatus === 'succeeded' }
  ];
});

const POLLING_INTERVAL_MS = 5000;
const POLLING_BACKOFF_INTERVAL_MS = 30000;

let pollingTimer: number | null = null;
let pollingInFlight = false;
let hasShownRateLimitWarning = false;

const hasPollingTargets = (pathList: any[]) => pathList.some((p: any) => {
  const enrichmentStatus = p?.generationStatus?.enrichment;
  return (p.status === 'generating' && !isPathTimeout(p))
    || (p.status === 'active'
      && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing')
      && !isEnrichmentStale(p));
});

const schedulePolling = (delayMs = POLLING_INTERVAL_MS) => {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
  }
  pollingTimer = window.setTimeout(() => {
    pollingTimer = null;
    void pollPaths(delayMs);
  }, delayMs);
};

const pollPaths = async (previousDelayMs = POLLING_INTERVAL_MS) => {
  if (pollingInFlight) {
    schedulePolling(previousDelayMs);
    return;
  }

  if (!hasPollingTargets(paths.value)) {
    stopPolling();
    return;
  }

  timeoutPaths.value.forEach((timeoutPath: any) => {
    if (!notifiedTimeoutIds.has(timeoutPath.id)) {
      toast.warning('测试路径生成时间较长，可以稍后刷新或直接重试');
      notifiedTimeoutIds.add(timeoutPath.id);
    }
  });

  pollingInFlight = true;
  try {
    const response = await request.get('/learning/paths');
    const newPaths = response.data.data;
    paths.value = newPaths;
    hasShownRateLimitWarning = false;

    if (!hasPollingTargets(newPaths)) {
      stopPolling();
      return;
    }

    schedulePolling(POLLING_INTERVAL_MS);
  } catch (error: any) {
    console.error('轮询更新失败:', error);
    const status = error?.response?.status;
    if (status === 429) {
      if (!hasShownRateLimitWarning) {
        toast.warning('路径状态请求过于频繁，已自动放慢刷新频率');
        hasShownRateLimitWarning = true;
      }
      schedulePolling(POLLING_BACKOFF_INTERVAL_MS);
      return;
    }
    schedulePolling(POLLING_INTERVAL_MS);
  } finally {
    pollingInFlight = false;
  }
};

const startPolling = () => {
  if (pollingTimer || pollingInFlight || !hasPollingTargets(paths.value)) return;
  schedulePolling();
};

const stopPolling = () => {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
};

const handleScroll = () => { scrolled.value = window.scrollY > 20; };
const loadPaths = async () => {
  loading.value = true;
  try {
    const response = await request.get('/learning/paths');
    paths.value = response.data.data;
    hasShownRateLimitWarning = false;
  } catch (error: any) {
    console.error('加载测试学习路径失败:', error);
    if (error?.response?.status === 429) {
      stopPolling();
      if (!hasShownRateLimitWarning) {
        toast.warning('请求过于频繁，已暂停自动刷新，请稍后手动刷新。');
        hasShownRateLimitWarning = true;
      }
      return;
    }
    toast.error(error.response?.data?.error?.message || '加载测试学习路径失败');
  } finally {
    loading.value = false;
  }
};
const confirmRegenerate = (path: any) => {
  pathToRegenerate.value = path;
  showRegenerateDialog.value = true;
};
const confirmDelete = (path: any) => {
  pathToDelete.value = path;
  showDeleteDialog.value = true;
};
const clearSelection = () => {
  selectedPathIds.value = [];
};
const confirmBatchRegenerate = async () => {
  if (selectedReadyPathIds.value.length === 0) return;
  try {
    await ElMessageBox.confirm(
      `将批量重新生成 ${selectedReadyPathIds.value.length} 条测试学习路径。已完成任务和学习记录不会被删除，但路径结构可能变化。`,
      '批量重新生成测试学习路径',
      {
        type: 'warning',
        confirmButtonText: '确认重新生成',
        cancelButtonText: '取消',
      }
    );
  } catch {
    return;
  }

  batchRegenerating.value = true;
  try {
    for (const pathId of selectedReadyPathIds.value) {
      await learningAPI.regeneratePath(pathId);
    }
    toast.success(`已开始重新生成 ${selectedReadyPathIds.value.length} 条测试学习路径`);
    clearSelection();
    if (!pollingTimer) startPolling();
    schedulePolling(1500);
  } catch (error: any) {
    console.error('批量重新生成测试学习路径失败:', error);
    if (error?.response?.status === 429) {
      stopPolling();
    }
    toast.error(error.response?.data?.error?.message || '批量重新生成测试学习路径失败');
  } finally {
    batchRegenerating.value = false;
  }
};
const deletePath = async () => {
  if (!pathToDelete.value) return;
  deleting.value = true;
  try {
    await request.delete(`/learning/paths/${pathToDelete.value.id}`);
    toast.success('测试学习路径已删除');
    showDeleteDialog.value = false;
    pathToDelete.value = null;
    await loadPaths();
  } catch (error: any) {
    console.error('删除测试学习路径失败:', error);
    if (error?.response?.status === 429) {
      stopPolling();
    }
    toast.error(error.response?.data?.error?.message || '删除测试学习路径失败');
  } finally {
    deleting.value = false;
  }
};
const regeneratePath = async () => {
  if (!pathToRegenerate.value) return;
  regenerating.value = true;
  try {
    await learningAPI.regeneratePath(pathToRegenerate.value.id);
    toast.success('已开始重新生成测试学习路径');
    showRegenerateDialog.value = false;
    if (!pollingTimer) startPolling();
    schedulePolling(1500);
  } catch (error: any) {
    console.error('重新生成测试学习路径失败:', error);
    if (error?.response?.status === 429) {
      stopPolling();
    }
    toast.error(error.response?.data?.error?.message || '重新生成测试学习路径失败');
  } finally {
    regenerating.value = false;
    pathToRegenerate.value = null;
  }
};
const goToPathDetail = (id: string) => { router.push(`/admin/test/learning-path/${id}`); };
const continuePath = (path: any) => {
  if (!path?.id) return;
  router.push(getPathContinueTarget(path));
};
const retryPathGeneration = async (path: any) => {
  if (!path.description) {
    toast.error('路径描述缺失，请通过测试目标页重新创建');
    return;
  }
  retryingPathId.value = path.id;
  try {
    const shouldRetryEnrichment = canRetryEnrichment(path);
    if (shouldRetryEnrichment) {
      await request.post(`/learning/paths/${path.id}/retry-stage-design`);
      toast.success('已在后台继续生成阶段任务');
    } else {
      await request.patch(`/learning/paths/${path.id}/retry`);
      toast.success('已开始重新生成测试学习路径');
    }
    if (!pollingTimer) startPolling();
    schedulePolling(1500);
  } catch (error: any) {
    console.error('重试生成失败:', error);
    if (error?.response?.status === 429) {
      stopPolling();
    }
    toast.error(error.response?.data?.error?.message || '重试生成失败，请稍后重试');
  } finally {
    retryingPathId.value = null;
  }
};

const loadGoalData = async (conversationId: string) => {
  if (goalDataCache.value[conversationId]) return;
  loadingGoalId.value = conversationId;
  try {
    const response = await request.get(`/goal-conversation/${conversationId}`);
    const data = response.data.data;
    goalDataCache.value[conversationId] = {
      understanding: data.understanding || data.collected?.understanding || {},
      confirmedProposal: data.confirmedProposal || data.collected?.confirmedProposal || null,
      collected: data.collected || {}
    };
  } catch (error: any) {
    console.error('加载目标对话数据失败:', error);
    toast.error(error.response?.data?.error?.message || '加载目标数据失败');
  } finally {
    loadingGoalId.value = null;
  }
};

onMounted(() => {
  if (route.query.from === 'goal' && route.query.auto === '1') {
    showGeneratingAlert.value = true;
    generatingAlertTimer = window.setTimeout(() => {
      showGeneratingAlert.value = false;
      generatingAlertTimer = null;
    }, 5000);
  }
  loadPaths().then(() => {
    if (hasPollingTargets(paths.value)) {
      startPolling();
    }
  });
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  stopPolling();
  if (generatingAlertTimer) {
    clearTimeout(generatingAlertTimer);
    generatingAlertTimer = null;
  }
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础布局 ========== */
.test-paths-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-body);
  position: relative;
  overflow-x: hidden;
  width: 100%;
  max-width: 100vw;
}

.paths-bg-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.paths-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.35;
}

.paths-bg-orb--1 {
  width: 900px;
  height: 900px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.28), transparent 70%);
  top: -280px;
  right: -180px;
  animation: paths-orb-float 24s ease-in-out infinite;
}

.paths-bg-orb--2 {
  width: 700px;
  height: 700px;
  background: radial-gradient(circle, rgba(84, 199, 137, 0.22), transparent 70%);
  bottom: -200px;
  left: -120px;
  animation: paths-orb-float 28s ease-in-out infinite reverse;
}

@keyframes paths-orb-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(40px, 30px) scale(1.06); }
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

.dashboard-header--scrolled {
  background: rgba(255, 255, 255, 0.95);
  border-bottom-color: var(--border-default);
  box-shadow: var(--shadow-sm);
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

.brand-logo {
  height: 56px;
  object-fit: contain;
  display: block;
}

.header-nav {
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: flex;
  align-items: center;
}

.header-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: color-mix(in srgb, #172033 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.header-nav a:hover,
.header-nav a.nav-item--active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.paths-bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.paths-bulk-toolbar__meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.paths-bulk-toolbar__meta strong {
  color: #172033;
  font-size: 14px;
  font-weight: 800;
}

.paths-bulk-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path-overview-card__select {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: color-mix(in srgb, #172033 68%, white);
  font-size: 12px;
  font-weight: 700;
}

.path-overview-card__select input {
  accent-color: #3478f6;
}

.header-right {
  gap: 10px;
  display: flex;
  align-items: center;
}

.header-cta {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
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

/* ========== 场景横幅 ========== */
.paths-scene-banner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 1.5rem;
  margin-bottom: 1.25rem;
  padding: 1.5rem;
  border: 1px solid rgba(120, 129, 255, 0.14);
}

.paths-scene-banner--processing {
  background: linear-gradient(135deg, rgba(113, 128, 255, 0.08), rgba(86, 178, 255, 0.06));
}

.paths-scene-banner--ready {
  background: linear-gradient(135deg, rgba(84, 199, 137, 0.12), rgba(113, 128, 255, 0.06));
}

.paths-scene-banner--attention {
  background: linear-gradient(135deg, rgba(255, 170, 100, 0.14), rgba(255, 110, 110, 0.08));
}

.paths-scene-banner__copy h2 {
  margin: 0.6rem 0 0.5rem;
  font-size: 1.55rem;
  line-height: 1.2;
}

.paths-scene-banner__copy p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.paths-scene-banner__meta {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  justify-content: space-between;
}

.paths-scene-banner__steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.paths-scene-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0.7rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.55);
  color: var(--text-secondary);
  font-size: 0.93rem;
  font-weight: 600;
}

.paths-scene-step--active {
  border-color: rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.12);
  color: var(--text-primary);
}

.paths-scene-step--done {
  border-color: rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.12);
  color: var(--text-primary);
}

.paths-scene-banner__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
}

.paths-scene-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.paths-scene-banner__actions {
  display: flex;
  justify-content: flex-start;
}

.path-overview-card--scene {
  border-color: rgba(99, 102, 241, 0.24);
  box-shadow: 0 18px 50px rgba(99, 102, 241, 0.08);
}

/* ========== Hero 区域 ========== */
.paths-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  padding: 1.75rem 2rem;
  margin-bottom: 1.25rem;
}

.paths-hero__copy {
  flex: 1;
  min-width: 0;
}

.paths-hero__copy h1 {
  margin: 0.5rem 0 0.4rem;
  font-size: 1.65rem;
  line-height: 1.2;
}

.paths-hero__copy p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
}

.paths-hero__actions {
  display: flex;
  gap: 0.75rem;
  flex-shrink: 0;
}

/* ========== 按钮样式 ========== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid transparent;
  font-weight: 700;
  font-size: 14px;
  text-decoration: none;
  transition: 180ms ease;
  cursor: pointer;
}

.btn-primary {
  background: linear-gradient(135deg, #3478f6, color-mix(in srgb, #3478f6 68%, #8d6bff));
  color: white;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.24);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-primary);
  border: 1px solid rgba(52, 120, 246, 0.15);
}

.btn-ghost:hover {
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  color: var(--color-primary, #3478f6);
}

/* ========== 筛选芯片 ========== */
.paths-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.paths-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-secondary);
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.paths-filter-chip:hover {
  border-color: var(--color-primary-light);
  background: rgba(255, 255, 255, 0.9);
}

.paths-filter-chip--active {
  border-color: rgba(52, 120, 246, 0.25);
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
}

.paths-filter-chip strong {
  font-size: 0.82rem;
  opacity: 0.7;
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
  .paths-scene-banner {
    grid-template-columns: 1fr;
  }

  .paths-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .paths-grid {
    grid-template-columns: 1fr;
  }

  .paths-hero {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* ========== 路径卡片 ========== */
.path-overview-card {
  display: grid;
  gap: 0.85rem;
  min-height: 280px;
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.path-overview-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.path-overview-card__status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.path-state-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
}

.path-state-pill--active {
  background: rgba(34, 197, 94, 0.12);
  color: #166534;
}

.path-state-pill--generating {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.path-state-pill--failed {
  background: rgba(249, 115, 22, 0.12);
  color: #c2410c;
}

.path-state-pill--soft {
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
}

.path-overview-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.path-overview-card__head strong {
  font-size: 1.15rem;
  line-height: 1.35;
}

.path-overview-card p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.9rem;
}

.path-overview-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.path-overview-card__chip {
  display: inline-flex;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
}

.path-overview-card__brief {
  display: grid;
  gap: 0.5rem;
}

.path-overview-card__brief-item {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 0.85rem;
}

.path-overview-card__brief-item span {
  color: var(--text-secondary);
}

.path-overview-card__brief-item strong {
  color: var(--text-primary);
  font-weight: 600;
}

.path-overview-card__next-task {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  border-radius: 14px;
  background: rgba(52, 120, 246, 0.06);
  font-size: 0.85rem;
}

.path-overview-card__next-task span {
  color: var(--text-secondary);
}

.path-overview-card__next-task strong {
  color: var(--text-primary);
  font-weight: 600;
}

.path-overview-card__stats {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.path-overview-card__meta-row {
  display: flex;
  justify-content: flex-end;
  font-size: 0.76rem;
  color: #94a3b8;
}

.path-overview-card__progress-block {
  display: grid;
  gap: 0.5rem;
}

.path-overview-card__progress-top {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}

.path-overview-card__progress-top strong {
  color: var(--text-primary);
}

.path-overview-card__progress-top span {
  color: var(--text-secondary);
}

.path-overview-card__progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.path-overview-card__progress-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #66758d;
  font-size: 12px;
  line-height: 1.6;
}

.path-overview-card__progress-copy strong {
  color: #172033;
  font-size: 12px;
  font-weight: 800;
}

.path-overview-card__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3478f6, #54c789);
  transition: width 0.4s ease;
}

.path-overview-card__progress-fill--loading {
  background: linear-gradient(90deg, rgba(52, 120, 246, 0.1) 0%, #3478f6 18%, #8d6bff 52%, #54c789 82%, rgba(84, 199, 137, 0.12) 100%);
  box-shadow: 0 0 16px rgba(82, 143, 255, 0.22);
  will-change: transform;
  animation: progress-loading 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.path-overview-card__progress-fill--framing {
  background: linear-gradient(90deg, rgba(52, 120, 246, 0.12) 0%, #3478f6 48%, #6ea8ff 100%);
}

.path-overview-card__progress-fill--planning {
  background: linear-gradient(90deg, rgba(91, 111, 246, 0.12) 0%, #6a5cff 34%, #8d6bff 70%, #53a4ff 100%);
}

.path-overview-card__progress-fill--persist {
  background: linear-gradient(90deg, rgba(84, 199, 137, 0.12) 0%, #1fbf75 28%, #54c789 64%, #8bdcae 100%);
}

.path-overview-card__progress-fill--completed {
  background: linear-gradient(90deg, rgba(34, 197, 94, 0.12) 0%, #22c55e 32%, #54c789 72%, #9ae6b4 100%);
}

@keyframes progress-loading {
  0% {
    transform: translateX(-110%);
    opacity: 0.65;
  }
  18% {
    opacity: 1;
  }
  100% {
    transform: translateX(260%);
    opacity: 0.9;
  }
}

/* ========== 预传递信息 ========== */
.path-overview-card__pretransmit {
  border: 1px dashed rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.6);
  overflow: hidden;
}

.path-overview-card__pretransmit-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: #66758d;
  list-style: none;
  user-select: none;
}

.path-overview-card__pretransmit-toggle::-webkit-details-marker {
  display: none;
}

.path-overview-card__pretransmit-toggle::marker {
  display: none;
  content: '';
}

.path-overview-card__pretransmit-toggle .el-icon {
  transition: transform 0.2s ease;
  font-size: 14px;
}

.path-overview-card__pretransmit[open] .path-overview-card__pretransmit-toggle .el-icon {
  transform: rotate(180deg);
}

.path-overview-card__pretransmit-content {
  padding: 0 14px 14px;
  display: grid;
  gap: 10px;
}

.pretransmit-row {
  display: grid;
  gap: 3px;
  font-size: 12px;
}

.pretransmit-row--intent p {
  margin: 0;
  color: #172033;
  line-height: 1.55;
  font-size: 13px;
}

.pretransmit-label {
  color: #94a3b8;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.02em;
}

.pretransmit-value {
  color: #475569;
  line-height: 1.55;
}

/* ========== Goal输入数据 ========== */
.path-overview-card__goal-input {
  border: 1px dashed rgba(99, 102, 241, 0.18);
  border-radius: 14px;
  background: rgba(99, 102, 241, 0.04);
  overflow: hidden;
}

.path-overview-card__goal-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: #6366f1;
  list-style: none;
  user-select: none;
}

.path-overview-card__goal-toggle::-webkit-details-marker {
  display: none;
}

.path-overview-card__goal-toggle::marker {
  display: none;
  content: '';
}

.path-overview-card__goal-toggle .el-icon {
  transition: transform 0.2s ease;
  font-size: 14px;
}

.path-overview-card__goal-input[open] .path-overview-card__goal-toggle .el-icon {
  transform: rotate(180deg);
}

.path-overview-card__goal-content {
  padding: 0 14px 14px;
  display: grid;
  gap: 12px;
}

.goal-row {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.goal-row--block {
  gap: 6px;
}

.goal-label {
  color: #6366f1;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.02em;
}

.goal-value {
  color: #475569;
  line-height: 1.55;
}

.goal-value--id {
  font-family: monospace;
  font-size: 11px;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.04);
  padding: 4px 8px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.goal-text {
  margin: 0;
  color: #172033;
  line-height: 1.6;
  font-size: 13px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 10px;
}

.goal-proposal {
  display: grid;
  gap: 6px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 10px;
}

.goal-proposal p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: #475569;
}

.goal-proposal strong {
  color: #172033;
  font-weight: 600;
}

.goal-load-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.goal-load-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgba(99, 102, 241, 0.35);
}

.goal-load-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.goal-load-btn .el-icon {
  font-size: 14px;
}

.path-overview-card__actions-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-top: 0.5rem;
}

/* ========== 空状态 ========== */
.paths-empty-state {
  padding: 3.5rem 2rem;
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 0.75rem;
}

.paths-empty-state h2 {
  margin: 0.5rem 0 0.4rem;
  font-size: 1.4rem;
}

.paths-empty-state p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ========== Pill 标签 ========== */
.pill {
  display: inline-flex;
  width: fit-content;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 0.75rem;
  font-weight: 800;
}

/* ========== 更多按钮 ========== */
.more-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-lg);
  border: none;
  background: var(--bg-muted);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.more-btn:hover {
  background: var(--color-primary-light);
  color: var(--color-primary);
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

/* ========== 响应式 ========== */
@media (max-width: 1180px) {
  .header-container,
  .main-content {
    width: min(100% - 32px, 1280px);
  }
}

@media (max-width: 900px) {
  .header-container {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0;
  }

  .header-nav {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  .header-container,
  .main-content {
    width: calc(100% - 24px);
  }

  .paths-scene-banner,
  .paths-hero,
  .path-overview-card,
  .paths-empty-state {
    padding: 1.25rem;
    border-radius: 20px;
  }

  .header-nav {
    display: none;
  }
}
</style>
