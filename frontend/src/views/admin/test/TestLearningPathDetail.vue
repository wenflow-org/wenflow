<template>
  <div class="test-path-detail-page">
    <header class="test-path-detail-header" :class="{ 'test-path-detail-header--scrolled': headerScrolled }">
      <div class="test-path-detail-header__inner">
        <button type="button" class="test-path-detail-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="test-path-detail-brand__logo" />
          <span>测试路径详情</span>
        </button>

        <nav class="test-path-detail-nav" aria-label="测试站点导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths" class="is-active">测试学习路径</router-link>
          <router-link to="/admin/test/learning-state">测试学习状态</router-link>
        </nav>

        <div class="test-path-detail-header__actions">
          <button class="test-path-detail-btn test-path-detail-btn--ghost" @click="router.push('/admin/test/learning-paths')">返回路径列表</button>
        </div>
      </div>
    </header>

    <main class="test-path-detail-shell">
      <div v-if="loading && !path" class="test-path-detail-empty test-path-detail-card">
        <el-icon class="spin"><Loading /></el-icon>
        <p>正在加载测试路径详情...</p>
      </div>

      <template v-else-if="path">
        <section class="test-path-detail-hero test-path-detail-card">
          <div class="test-path-detail-hero__copy">
            <span class="test-path-detail-eyebrow">Path Workbench</span>
            <h1>{{ path.name }}</h1>
            <p>{{ path.summary || path.description }}</p>

            <div class="test-path-detail-chip-row">
              <span class="test-path-detail-chip">状态：{{ pathStatusLabel }}</span>
              <span v-if="subjectTagLabel" class="test-path-detail-chip">主题：{{ subjectTagLabel }}</span>
              <span class="test-path-detail-chip">阶段：{{ pathOverviewMetrics[0]?.value || 0 }}</span>
              <span class="test-path-detail-chip">预计投入：{{ pathOverviewMetrics[1]?.value || '--' }}</span>
              <span v-if="virtualDebugSummary" class="test-path-detail-chip test-path-detail-chip--accent">{{ virtualDebugSummary }}</span>
            </div>
          </div>

          <div class="test-path-detail-hero__actions">
            <button class="test-path-detail-btn test-path-detail-btn--primary" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
              {{ primaryActionLabel }}
            </button>
            <button v-if="enrichmentStatus === 'failed'" class="test-path-detail-btn test-path-detail-btn--ghost" :disabled="retryingEnrichment" @click="retryEnrichment">
              继续生成阶段任务
            </button>
          </div>
        </section>

        <section v-if="processDetail" class="test-path-detail-card test-path-detail-card--process test-path-detail-process-section">
          <div class="test-path-detail-section-head">
            <div>
              <span class="test-path-detail-eyebrow">Path 调试</span>
              <h2>Pipeline</h2>
            </div>
          </div>

          <div class="test-path-process-overview-grid test-path-process-overview-grid--compact">
            <article class="test-path-process-overview-card">
              <span>Goal 输入</span>
              <strong>{{ processDetail.source || '--' }}</strong>
              <p>{{ processDetail.goalFinalPayload?.conversationHistory?.length || 0 }} 条对话 · {{ getProcessSourceSummary(processDetail.goalFinalPayload?.provenance) }}</p>
            </article>
            <article class="test-path-process-overview-card">
              <span>Orchestrator</span>
              <strong>{{ processDetail.mode || '--' }}</strong>
              <p>{{ processDetail.normalizedInput?.skillLevel || '--' }} · {{ processDetail.normalizedInput?.timePerDay || '--' }}</p>
            </article>
            <article class="test-path-process-overview-card">
              <span>Path 隐藏层</span>
              <strong>{{ cognitiveConcepts.length }} 个概念</strong>
              <p>{{ milestoneConceptBoundCount }}/{{ pathStages.length }} 里程碑绑定 · {{ generationStatus?.coreStep || generationStatus?.core || '--' }}</p>
            </article>
            <article class="test-path-process-overview-card">
              <span>阶段任务层</span>
              <strong>{{ profiledTaskCount }}/{{ totalTasks }}</strong>
              <p>{{ taskProfileCoverageLabel }} · {{ taskProfiles.length }} 条标记结果</p>
            </article>
          </div>

          <div class="test-path-process-flow">
            <section class="test-path-process-section-card">
              <div class="test-path-process-section-card__head">
                <div>
                  <span class="test-path-detail-eyebrow">Goal</span>
                  <strong>Goal</strong>
                </div>
              </div>

              <div class="test-path-process-split-grid">
                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输入内容</span>
                  <pre>{{ JSON.stringify(goalConversationRaw, null, 2) }}</pre>
                </article>

                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输出内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.goalFinalPayload, null, 2) }}</pre>
                </article>
              </div>

              <details class="test-path-detail-raw-panel test-path-detail-raw-panel--compact">
                <summary>展开 Goal 派生结果</summary>
                <div v-if="goalConversationRaw" class="test-path-detail-process-grid test-path-detail-process-grid--two">
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">Goal 摘要 `goalSummary`</span>
                    <pre>{{ JSON.stringify(goalConversationSummary, null, 2) }}</pre>
                  </article>
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">Goal 快照元信息</span>
                    <pre>{{ JSON.stringify(processDetail.goalFinalPayload, null, 2) }}</pre>
                  </article>
                </div>
                <div v-else class="test-path-detail-empty-state test-path-detail-empty-state--inline">
                  {{ goalConversationRawHint }}
                </div>
              </details>
            </section>

            <section class="test-path-process-section-card">
              <div class="test-path-process-section-card__head">
                <div>
                  <span class="test-path-detail-eyebrow">Orchestrator</span>
                  <strong>Orchestrator</strong>
                </div>
              </div>

              <div class="test-path-process-split-grid">
                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输入内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.goalFinalPayload, null, 2) }}</pre>
                </article>

                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输出内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.normalizedInput, null, 2) }}</pre>
                </article>
              </div>
            </section>

            <section class="test-path-process-section-card">
              <div class="test-path-process-section-card__head">
                <div>
                  <span class="test-path-detail-eyebrow">Framing</span>
                  <strong>Framing · skill:path-scene-framing</strong>
                </div>
              </div>

              <div class="test-path-process-split-grid">
                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输入内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.sceneFramingInput, null, 2) }}</pre>
                </article>

                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输出内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.sceneFraming, null, 2) }}</pre>
                </article>
              </div>
            </section>

            <section class="test-path-process-section-card">
              <div class="test-path-process-section-card__head">
                <div>
                  <span class="test-path-detail-eyebrow">Cognitive Core</span>
                  <strong>Cognitive Core · path-agent</strong>
                </div>
              </div>

              <div class="test-path-process-split-grid">
                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输入内容</span>
                  <pre>{{ JSON.stringify(processDetail.raw?.pathAgentInput, null, 2) }}</pre>
                </article>

                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输出内容</span>
                  <pre>{{ processDetail.raw?.pathAgentRaw || '当前没有保存 path-agent 原始输出。' }}</pre>
                </article>
              </div>

              <div v-if="processDetail.cognitiveDiagnostics?.suspiciousDomain || processDetail.cognitiveDiagnostics?.suspiciousConcepts?.length" class="test-path-process-callout test-path-process-callout--warning">
                <strong>认知层疑似失真</strong>
                <p v-if="processDetail.cognitiveDiagnostics?.suspiciousDomain">当前 cognitiveDomain 更像用户问题描述，而不是底层能力。</p>
                <p v-if="processDetail.cognitiveDiagnostics?.suspiciousConcepts?.length">疑似任务句概念：{{ processDetail.cognitiveDiagnostics.suspiciousConcepts.map((item: any) => item.name).join(' / ') }}</p>
              </div>

              <div v-if="stageConceptTree.length" class="test-path-concept-stage-grid">
                <article v-for="stage in stageConceptTree" :key="stage.milestoneId || stage.stageNumber" class="test-path-concept-stage-card">
                  <div class="test-path-concept-stage-card__head">
                    <div>
                      <span class="test-path-detail-copy-block__label">Milestone {{ stage.stageNumber }}</span>
                      <strong>{{ stage.title || `第 ${stage.stageNumber} 阶段` }}</strong>
                      <p>{{ stage.goal || stage.description || '暂无阶段目标' }}</p>
                    </div>
                    <span class="test-path-process-pill test-path-process-pill--focus">概念绑定</span>
                  </div>

                  <div class="test-path-concept-binding-card">
                    <span class="test-path-detail-copy-block__label">核心概念</span>
                    <div class="test-path-detail-kv-list">
                      <div class="test-path-detail-kv"><span>coreConceptId</span><strong>{{ stage.coreConceptId || '--' }}</strong></div>
                      <div class="test-path-detail-kv"><span>coreConceptName</span><strong>{{ stage.coreConceptName || '--' }}</strong></div>
                      <div class="test-path-detail-kv"><span>来源</span><strong>{{ stage.conceptSource || '--' }}</strong></div>
                    </div>
                    <p>{{ stage.coreConceptDescription || '当前阶段还没有稳定的概念说明。' }}</p>
                  </div>
                </article>
              </div>

              <details class="test-path-detail-raw-panel test-path-detail-raw-panel--compact">
                <summary>展开派生结果</summary>
                <div class="test-path-detail-process-grid test-path-detail-process-grid--two">
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">认知结构 `cognitiveDesign`</span>
                    <pre>{{ JSON.stringify(processDetail.cognitiveDesign, null, 2) }}</pre>
                  </article>
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">里程碑概念绑定 `milestoneConcepts`</span>
                    <pre>{{ JSON.stringify(processDetail.milestoneConcepts, null, 2) }}</pre>
                  </article>
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">认知诊断 `cognitiveDiagnostics`</span>
                    <pre>{{ JSON.stringify(processDetail.cognitiveDiagnostics, null, 2) }}</pre>
                  </article>
                  <article class="test-path-detail-process-card">
                    <span class="test-path-detail-copy-block__label">生成状态 `generationStatus`</span>
                    <pre>{{ JSON.stringify(processDetail.raw?.generationStatus, null, 2) }}</pre>
                  </article>
                </div>
              </details>
            </section>

            <section class="test-path-process-section-card">
              <div class="test-path-process-section-card__head">
                <div>
                  <span class="test-path-detail-eyebrow">Stage Designer</span>
                  <strong>Stage Designer · skill:stage-designer</strong>
                </div>
              </div>

              <div class="test-path-process-split-grid">
                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输入内容</span>
                  <template v-if="stageDesignEntries.length">
                    <div v-for="entry in stageDesignEntries" :key="entry.stageKey" class="test-path-detail-copy-block">
                      <span class="test-path-detail-copy-block__label">{{ entry.stageKey }}</span>
                      <pre>{{ JSON.stringify(entry.inputPayload, null, 2) }}</pre>
                    </div>
                  </template>
                  <pre v-else>{{ JSON.stringify(null, null, 2) }}</pre>
                </article>

                <article class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">输出内容</span>
                  <template v-if="stageDesignEntries.length">
                    <div v-for="entry in stageDesignEntries" :key="`${entry.stageKey}-raw`" class="test-path-detail-copy-block">
                      <span class="test-path-detail-copy-block__label">{{ entry.stageKey }}</span>
                      <pre>{{ entry.rawModelOutput || '当前没有保存 stage-designer 原始输出。' }}</pre>
                    </div>
                  </template>
                  <pre v-else>{{ JSON.stringify(null, null, 2) }}</pre>
                </article>
              </div>

              <div v-if="taskProfiles.length" class="test-path-detail-process-grid test-path-detail-process-grid--two">
                <article v-for="item in taskProfiles.slice(0, 8)" :key="item.taskId" class="test-path-detail-process-card">
                  <span class="test-path-detail-copy-block__label">{{ item.title || item.taskId }}</span>
                  <div class="test-path-detail-kv-list">
                    <div class="test-path-detail-kv"><span>displayLabel</span><strong>{{ item.displayLabel || '--' }}</strong></div>
                    <div class="test-path-detail-kv"><span>knowledgeType</span><strong>{{ item.knowledgeType || '--' }}</strong></div>
                    <div class="test-path-detail-kv"><span>cognitiveLevel</span><strong>{{ item.cognitiveLevel || '--' }}</strong></div>
                    <div class="test-path-detail-kv"><span>linkedConcept</span><strong>{{ item.coreConcept || item.name || '--' }}</strong></div>
                    <div class="test-path-detail-kv"><span>annotationConfidence</span><strong>{{ formatTaskAnnotationConfidence(item.annotationConfidence) }}</strong></div>
                  </div>
                  <p v-if="item.milestoneTitle">所属阶段：{{ item.milestoneTitle }}</p>
                </article>
              </div>
            </section>
          </div>
        </section>

        <section class="test-path-detail-grid test-path-detail-grid--content">
          <section class="test-path-detail-main">
            <section v-if="showEnrichmentBanner" class="test-path-detail-banner" :class="`test-path-detail-banner--${enrichmentStatus || 'unknown'}`">
              <div>
                <strong>{{ enrichmentBannerTitle }}</strong>
                <p>{{ enrichmentBannerMessage }}</p>
              </div>
            </section>

            <section class="test-path-detail-card">
              <div class="test-path-detail-section-head">
                <div>
                  <span class="test-path-detail-eyebrow">显性任务路径</span>
                  <h2>最终渲染的任务链</h2>
                </div>
              </div>

              <div class="test-path-stage-list">
                <article
                  v-for="stage in pathStages"
                  :key="stage.id"
                  class="test-path-stage"
                >
                  <button type="button" class="test-path-stage__head" @click="toggleWeek(stage)">
                    <div>
                      <span class="test-path-stage__index">阶段 {{ stage.stageNumber || stage.weekNumber }}</span>
                      <strong>{{ stage.title }}</strong>
                      <p>{{ stage.description || stage.goal }}</p>
                      <div v-if="stage.coreConceptName || stage.coreConceptId" class="test-path-task__profile-copy">
                        <span class="test-path-task__profile-line">Milestone 核心概念：{{ stage.coreConceptName || '--' }}</span>
                        <span class="test-path-task__profile-line">概念 ID：{{ stage.coreConceptId || '--' }}</span>
                      </div>
                    </div>
                    <span class="test-path-stage__meta">{{ getWeekCompletedCount(stage) }}/{{ normalizeTaskList(stage).length }}</span>
                  </button>

                  <div v-if="activeWeeks.includes(stage.stageNumber || stage.weekNumber)" class="test-path-stage__body">
                    <div class="test-path-task-list">
                      <article
                        v-for="task in normalizeTaskList(stage)"
                        :key="task.id"
                        class="test-path-task"
                        :class="{ 'test-path-task--locked': !canStartLearning && task.status !== 'completed' }"
                      >
                        <div class="test-path-task__head">
                          <div>
                            <strong>{{ task.title }}</strong>
                            <p>{{ task.description }}</p>
                            <div v-if="task.displayLabel || task.coreConcept || task.linkedConceptId || normalizedTaskObjectives(task).length" class="test-path-task__profile-copy">
                              <span v-if="task.displayLabel" class="test-path-task__profile-line">任务标签：{{ task.displayLabel }}</span>
                              <span v-if="task.coreConcept" class="test-path-task__profile-line">Task 命中概念：{{ task.coreConcept }}</span>
                              <span v-if="task.linkedConceptId" class="test-path-task__profile-line">Task linkedConcept：{{ task.linkedConceptId }}</span>
                              <span v-if="normalizedTaskObjectives(task).length">学习目标：{{ normalizedTaskObjectives(task).join(' / ') }}</span>
                            </div>
                          </div>
                          <div class="test-path-detail-chip-row">
                            <span class="test-path-detail-chip">{{ getStatusText(task.status) }}</span>
                            <span class="test-path-detail-chip">{{ getTaskTypeText(task.taskType) }}</span>
                            <span class="test-path-detail-chip">{{ task.estimatedMinutes || 0 }} 分钟</span>
                            <span v-if="task.knowledgeType" class="test-path-detail-chip test-path-detail-chip--accent">{{ task.knowledgeType }}</span>
                            <span v-if="task.cognitiveLevel" class="test-path-detail-chip test-path-detail-chip--accent">{{ task.cognitiveLevel }}</span>
                          </div>
                        </div>

                        <div class="test-path-task__actions">
                          <button v-if="task.status !== 'completed'" class="test-path-detail-btn test-path-detail-btn--primary" :disabled="!canStartLearning" @click="startTask(task)">
                            {{ canStartLearning ? (task.status === 'in_progress' ? '继续学习' : '开始学习') : '等待阶段任务生成' }}
                          </button>
                          <button v-else-if="task.hasTeachingWrapup" class="test-path-detail-btn test-path-detail-btn--ghost" @click="viewTaskEvaluation(task)">查看当堂评估</button>
                        </div>
                      </article>
                    </div>
                  </div>
                </article>
              </div>
            </section>

          </section>

          <aside class="test-path-detail-sidebar">
            <section class="test-path-detail-card">
              <span class="test-path-detail-eyebrow">生成状态</span>
              <div class="test-path-detail-kv-list">
                <div class="test-path-detail-kv"><span>core</span><strong>{{ generationStatus?.core || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>coreStep</span><strong>{{ generationStatus?.coreStep || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>stageDesign</span><strong>{{ enrichmentStatus || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>sourceConversationId</span><strong>{{ generationStatus?.sourceConversationId || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>canStartLearning</span><strong>{{ canStartLearning ? 'true' : 'false' }}</strong></div>
              </div>
            </section>

            <section class="test-path-detail-card">
              <span class="test-path-detail-eyebrow">当前建议</span>
              <div class="test-path-detail-plan-list">
                <article v-for="item in pathDetailPlan" :key="item.title" class="test-path-detail-plan-item">
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </article>
              </div>
            </section>
          </aside>
        </section>
      </template>
    </main>

    <el-dialog v-model="evaluationDialogVisible" title="当堂评估" width="760px">
      <div v-loading="evaluationLoading" class="test-path-detail-evaluation-dialog">
        <template v-if="selectedTaskEvaluation">
          <div class="test-path-detail-kv-list">
            <div class="test-path-detail-kv"><span>任务</span><strong>{{ selectedTaskEvaluation.taskTitle }}</strong></div>
            <div class="test-path-detail-kv"><span>授课时长</span><strong>{{ formatSessionDuration(selectedTaskEvaluation.durationMinutes || 0) }}</strong></div>
          </div>
          <pre>{{ JSON.stringify(selectedTaskEvaluation, null, 2) }}</pre>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { toast } from '@/utils/toast';
import api from '@/utils/api';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI, type TaskEvaluationDetail } from '@/api/aiTeaching';
import { adminApi } from '@/api/adminApi';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const pathId = computed(() => typeof route.params.id === 'string' ? route.params.id.trim() : '');
const virtualSessionId = computed(() => typeof route.query.virtualSessionId === 'string' ? route.query.virtualSessionId.trim() : '');
const viewMode = computed(() => typeof route.query.viewMode === 'string' ? route.query.viewMode.trim() : '');
const headerScrolled = ref(false);
const loading = ref(true);
const path = ref<any>(null);
const virtualContext = ref<any>(null);
const activeWeeks = ref<number[]>([1]);
const evaluationDialogVisible = ref(false);
const evaluationLoading = ref(false);
const selectedTaskEvaluation = ref<TaskEvaluationDetail | null>(null);
const retryingEnrichment = ref(false);
let enrichmentPollingTimer: number | null = null;
let enrichmentPollingInFlight = false;

const totalTasks = computed(() => pathStages.value.reduce((sum: number, stage: any) => sum + normalizeTaskList(stage).length, 0));
const completedTasks = computed(() => pathStages.value.reduce((sum: number, stage: any) => sum + normalizeTaskList(stage).filter((task: any) => task.status === 'completed').length, 0));
const completionRate = computed(() => totalTasks.value === 0 ? 0 : Math.round((completedTasks.value / totalTasks.value) * 100));
const pathStatusLabel = computed(() => {
  const status = path.value?.status;
  const generation = path.value?.generationStatus;
  if (status === 'active' && (generation?.stageDesign === 'pending' || generation?.stageDesign === 'processing')) return '阶段任务生成中';
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'draft' || status === 'generating') return '生成中';
  return '规划中';
});
const subjectTagLabel = computed(() => {
  const raw = typeof path.value?.subject === 'string' ? path.value.subject.trim() : '';
  if (!raw) return '';
  if (raw.length > 24) return '';
  if (/[，。；！？,.!?]/.test(raw)) return '';
  return raw;
});
const pathOverviewMetrics = computed(() => [
  { label: '阶段数', value: String(path.value?.totalMilestones || path.value?.totalStages || pathStages.value.length || 0) },
  { label: '预计投入', value: `${Math.round(path.value?.estimatedHours || 0)} 小时` },
  { label: '当前阶段', value: (() => {
    const stageNumber = activeStage.value?.stageNumber || activeStage.value?.weekNumber || null;
    return stageNumber ? `第 ${stageNumber} 阶段` : (pathStages.value.length > 0 ? '第 1 阶段' : '待开始');
  })() },
  { label: '任务进度', value: `${completedTasks.value}/${totalTasks.value}` }
]);
const generationStatus = computed(() => path.value?.generationStatus || null);
const enrichmentStatus = computed(() => generationStatus.value?.stageDesign || null);
const canStartLearning = computed(() => path.value?.canStartLearning !== false);
const showEnrichmentBanner = computed(() => path.value?.status === 'active' && enrichmentStatus.value && enrichmentStatus.value !== 'succeeded');
const enrichmentBannerTitle = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') return '阶段任务生成中';
  if (enrichmentStatus.value === 'failed') return '阶段任务继续生成中';
  return '阶段任务状态未知';
});
const enrichmentBannerMessage = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') return '路径骨架已经生成，系统正在后台展开阶段任务。';
  if (enrichmentStatus.value === 'failed') return path.value?.learningBlockedReason || '系统正在继续生成阶段任务，你也可以手动触发继续生成。';
  return path.value?.learningBlockedReason || '阶段任务状态暂不可用，请稍后刷新页面。';
});
const pathStages = computed(() => path.value?.milestones || path.value?.weeks || []);
const processDetail = computed(() => path.value?.processDetail || null);
const cognitiveConcepts = computed(() => processDetail.value?.cognitiveDesign?.coreConcepts || []);
const milestoneConcepts = computed(() => processDetail.value?.milestoneConcepts || []);
const taskProfiles = computed(() => processDetail.value?.taskProfiles || []);
const hubConceptName = computed(() => cognitiveConcepts.value.find((concept: any) => concept.role === 'hub')?.name || null);
const milestoneConceptBoundCount = computed(() => milestoneConcepts.value.filter((item: any) => item.coreConceptId).length);
const linkedConceptHitCount = computed(() => pathStages.value.reduce((sum: number, stage: any) => {
  return sum + normalizeTaskList(stage).filter((task: any) => task.linkedConceptId).length;
}, 0));
const linkedConceptHitRate = computed(() => totalTasks.value === 0 ? '0%' : `${Math.round((linkedConceptHitCount.value / totalTasks.value) * 100)}%`);
const getConceptTaskHitCount = (conceptId: string) => pathStages.value.reduce((sum: number, stage: any) => {
  return sum + normalizeTaskList(stage).filter((task: any) => task.linkedConceptId === conceptId).length;
}, 0);
const stageConceptTree = computed(() => {
  const milestoneMap = new Map<string, any>();
  milestoneConcepts.value.forEach((item: any) => {
    if (item?.milestoneId) {
      milestoneMap.set(item.milestoneId, item);
    }
  });

  return pathStages.value.map((stage: any, index: number) => {
    const milestoneConcept = milestoneMap.get(stage.id) || {};
    return {
      milestoneId: stage.id,
      stageNumber: stage.stageNumber || stage.weekNumber || index + 1,
      title: stage.title || null,
      description: stage.description || null,
      goal: stage.goal || null,
      coreConceptId: stage.coreConceptId || milestoneConcept.coreConceptId || null,
      coreConceptName: stage.coreConceptName || milestoneConcept.coreConceptName || null,
      coreConceptDescription: stage.coreConceptDescription || milestoneConcept.coreConceptDescription || null,
      conceptSource: stage.coreConceptSource || milestoneConcept.conceptSource || null,
      tasks: normalizeTaskList(stage),
    };
  });
});
const goalConversationRaw = ref<any | null>(null);
const goalConversationSummary = computed(() => {
  if (!goalConversationRaw.value) return null;
  return {
    id: goalConversationRaw.value.id || null,
    stage: goalConversationRaw.value.stage || null,
    status: goalConversationRaw.value.status || null,
    description: goalConversationRaw.value.description || null,
    understanding: goalConversationRaw.value.understanding || goalConversationRaw.value.collected?.understanding || null,
    confirmedProposal: goalConversationRaw.value.confirmedProposal || goalConversationRaw.value.collected?.confirmedProposal || null,
    collected: goalConversationRaw.value.collected || null,
  };
});
const goalConversationRawHint = computed(() => {
  const conversationId = processDetail.value?.sourceConversationId || generationStatus.value?.sourceConversationId;
  if (!conversationId) {
    return '当前这次路径运行没有带回 Goal 对话关联，所以这里暂时无法还原 Goal 阶段原始数据。';
  }
  return '当前未加载到 Goal 对话原始数据。';
});
const taskProfileCoverageLabel = computed(() => totalTasks.value === 0 ? '0%' : `${Math.round((profiledTaskCount.value / totalTasks.value) * 100)}%`);
const taskProfileKnowledgeTypeCount = computed(() => new Set(taskProfiles.value.map((item: any) => item.knowledgeType).filter(Boolean)).size);
const taskProfileCognitiveLevelCount = computed(() => new Set(taskProfiles.value.map((item: any) => item.cognitiveLevel).filter(Boolean)).size);
const taskDisplayLabelCount = computed(() => taskProfiles.value.filter((item: any) => typeof item.displayLabel === 'string' && item.displayLabel.trim()).length);
const stageDesignEntries = computed(() => {
  const stageDesigns = processDetail.value?.raw?.stageDesigns;
  if (!stageDesigns || typeof stageDesigns !== 'object') return [];

  return Object.keys(stageDesigns)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map((stageKey) => ({
      stageKey,
      inputPayload: stageDesigns[stageKey]?.inputPayload || null,
      rawModelOutput: stageDesigns[stageKey]?.rawModelOutput || null,
    }));
});
const normalizeTaskList = (stage: any) => stage?.subtasks || stage?.tasks || [];
const activeStage = computed(() => pathStages.value.find((stage: any) => normalizeTaskList(stage).some((task: any) => task.status !== 'completed')) || pathStages.value[0] || null);
const activeStageTasks = computed(() => normalizeTaskList(activeStage.value));
const primaryActionTask = computed(() => activeStageTasks.value.find((task: any) => task.status === 'todo') || activeStageTasks.value.find((task: any) => task.status === 'in_progress') || null);
const primaryActionLabel = computed(() => !canStartLearning.value ? '等待阶段任务生成' : (primaryActionTask.value?.status === 'in_progress' ? '继续学习' : '开始学习'));
const nextActionTasks = computed(() => {
  const upcoming = activeStageTasks.value.filter((task: any) => task.status !== 'completed');
  return (upcoming.length > 0 ? upcoming : activeStageTasks.value).slice(0, 3);
});
const pathDetailPlan = computed(() => {
  const items = nextActionTasks.value.map((task: any, index: number) => ({
    title: `任务 ${index + 1}`,
    desc: `${task.title}${task.estimatedMinutes ? ` · 预计 ${task.estimatedMinutes} 分钟` : ''}`
  }));
  return items.length > 0 ? items : [{ title: '当前暂无待推进任务', desc: '等阶段任务生成完成后，这里会出现最值得先开始的任务。' }];
});
const profiledTaskCount = computed(() => pathStages.value.reduce(
  (sum: number, stage: any) => sum + normalizeTaskList(stage).filter((task: any) => task.knowledgeType || task.cognitiveLevel || task.displayLabel).length,
  0,
));

const getProcessSourceSummary = (provenance: any) => {
  if (!provenance) return '无来源说明';
  return provenance.source === 'missing' ? '缺少新结构数据' : '正式落库';
};

const summarizeValue = (value: any) => {
  if (value === null || value === undefined) return '--';
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return `${Object.keys(value).length} 个字段`;
  if (typeof value === 'string') return value.trim() || '--';
  return String(value);
};

const effectivePathId = computed(() => {
  const boundPathId = virtualContext.value?.bindings?.learningPathId;
  return String(boundPathId || pathId.value || '');
});

const virtualDebugSummary = computed(() => {
  if (!virtualContext.value) return '';
  const profile = virtualContext.value.profile || {};
  const story = virtualContext.value.storyContext || {};
  return [
    profile.userName ? `画像：${profile.userName}` : '',
    story.title ? `故事：${story.title}` : '',
    viewMode.value ? `模式：${viewMode.value}` : ''
  ].filter(Boolean).join(' · ');
});

const formatTaskAnnotationConfidence = (value: any) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${Math.round(value * 100)}%`;
};

const handleScroll = () => { headerScrolled.value = window.scrollY > 50; };
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

const loadGoalConversationRaw = async () => {
  const conversationId = processDetail.value?.sourceConversationId || generationStatus.value?.sourceConversationId || virtualContext.value?.bindings?.goalConversationId;
  if (!conversationId) {
    goalConversationRaw.value = null;
    return;
  }

  try {
    const response = await api.get(`/goal-conversation/${conversationId}`);
    goalConversationRaw.value = response.data;
  } catch (error: any) {
    goalConversationRaw.value = null;
    console.error('加载 Goal 阶段原始数据失败:', error);
  }
};

const loadPathData = async () => {
  if (!path.value) loading.value = true;
  try {
    await loadVirtualContext();
    if (!effectivePathId.value) {
      throw new Error('当前虚拟 session 还没有绑定学习路径');
    }

    if (virtualSessionId.value) {
      const response = await adminApi.getVirtualSessionLearningPath(virtualSessionId.value);
      if (!response.data?.success) {
        throw new Error(response.data?.error || '加载虚拟会话学习路径失败');
      }
      path.value = response.data.data?.path || null;
    } else {
      const response = await api.get(`/learning/paths/${effectivePathId.value}`);
      path.value = response.data;
    }

    if (path.value.milestones && !path.value.weeks) {
      path.value.weeks = path.value.milestones.map((m: any) => ({ ...m, weekNumber: m.stageNumber, tasks: m.subtasks }));
    }
    if (path.value.weeks) {
      path.value.weeks.forEach((week: any) => {
        if (week.learningObjectives) {
          try { week.learningObjectives = JSON.parse(week.learningObjectives); } catch { week.learningObjectives = []; }
        }
        normalizeTaskList(week).forEach((task: any) => {
          if (typeof task.learningObjectives === 'string' && task.learningObjectives.trim()) {
            try { task.learningObjectives = JSON.parse(task.learningObjectives); } catch {}
          }
        });
      });
    }
    await loadGoalConversationRaw();
    if (path.value?.generationStatus?.stageDesign === 'processing' || path.value?.generationStatus?.stageDesign === 'pending') startEnrichmentPolling();
    else stopEnrichmentPolling();
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载测试路径详情失败');
  } finally {
    loading.value = false;
  }
};
const toggleWeek = (week: any) => {
  const weekNumber = week.stageNumber || week.weekNumber;
  const index = activeWeeks.value.indexOf(weekNumber);
  if (index > -1) activeWeeks.value.splice(index, 1);
  else activeWeeks.value.push(weekNumber);
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
  const query = new URLSearchParams();
  if (virtualSessionId.value) query.set('virtualSessionId', virtualSessionId.value);
  if (viewMode.value) query.set('viewMode', viewMode.value);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  router.push(`/admin/test/learn/${task.id}${suffix}`);
};
const startTask = (task: any) => openTaskDetail(task);
const startPrimaryActionTask = () => { if (primaryActionTask.value) startTask(primaryActionTask.value); };
const retryEnrichment = async () => {
  if (!path.value?.id) return;
  retryingEnrichment.value = true;
  try {
    await learningAPI.retryPathEnrichment(path.value.id);
    toast.success('已在后台继续生成阶段任务。');
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
      try { await loadPathData(); } finally { enrichmentPollingInFlight = false; }
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
  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00` : `${mins.toString().padStart(2, '0')}:00`;
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
const getWeekCompletedCount = (week: any) => normalizeTaskList(week).filter((t: any) => t.status === 'completed').length;
const getStatusText = (status: string) => ({ todo: '待开始', in_progress: '进行中', completed: '已完成', skipped: '已跳过' }[status] || status);
const getTaskTypeText = (type: string) => ({
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
}[type] || type || '任务');
const normalizedTaskObjectives = (task: any) => {
  if (Array.isArray(task?.learningObjectives)) return task.learningObjectives.filter((item: any) => typeof item === 'string' && item.trim());
  if (typeof task?.learningObjectives === 'string' && task.learningObjectives.trim()) {
    try {
      const parsed = JSON.parse(task.learningObjectives);
      return Array.isArray(parsed) ? parsed.filter((item: any) => typeof item === 'string' && item.trim()) : [task.learningObjectives.trim()];
    } catch {
      return [task.learningObjectives.trim()];
    }
  }
  return [];
};

onMounted(() => {
  void loadPathData();
  window.addEventListener('scroll', handleScroll);
});

watch(
  [() => route.params.id, () => route.query.virtualSessionId],
  () => {
    path.value = null;
    goalConversationRaw.value = null;
    void loadPathData();
  }
);

onUnmounted(() => {
  stopEnrichmentPolling();
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
.test-path-detail-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
  color: #172033;
}

.test-path-detail-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.test-path-detail-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
}

.test-path-detail-header__inner,
.test-path-detail-shell {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.test-path-detail-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.test-path-detail-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 900;
  color: #172033;
  cursor: pointer;
}

.test-path-detail-brand__logo {
  height: 52px;
}

.test-path-detail-nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.test-path-detail-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: #66758d;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.test-path-detail-nav a.is-active,
.test-path-detail-nav a.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.test-path-detail-shell {
  padding: 28px 0 80px;
}

.test-path-detail-card,
.test-path-detail-empty,
.test-path-detail-hero,
.test-path-detail-banner {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
  border-radius: 24px;
}

.test-path-detail-empty {
  min-height: 240px;
  display: grid;
  place-items: center;
  gap: 10px;
}

.test-path-detail-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  padding: 24px 26px;
  margin-bottom: 18px;
}

.test-path-detail-eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-path-detail-hero h1,
.test-path-detail-section-head h2 {
  margin: 10px 0 8px;
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.12;
}

.test-path-detail-hero p,
.test-path-stage__head p,
.test-path-task__head p,
.test-path-detail-plan-item p,
.test-path-detail-banner p,
.test-path-detail-section-desc {
  margin: 0;
  color: #66758d;
  line-height: 1.7;
  font-size: 14px;
}

.test-path-detail-grid {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 20px;
}

.test-path-detail-grid--content {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  align-items: start;
}

.test-path-detail-sidebar,
.test-path-detail-main,
.test-path-detail-kv-list,
.test-path-detail-plan-list,
.test-path-stage-list,
.test-path-task-list {
  display: grid;
  gap: 16px;
}

.test-path-detail-kv-list--dense {
  gap: 10px;
}

.test-path-process-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.test-path-detail-card {
  padding: 20px;
}

.test-path-detail-card--process {
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 28%),
    rgba(255, 255, 255, 0.92);
}

.test-path-detail-process-section {
  margin-bottom: 20px;
}

.test-path-detail-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.test-path-detail-kv span {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-path-detail-kv strong {
  color: #172033;
  font-size: 13px;
}

.test-path-detail-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.test-path-detail-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
  font-size: 12px;
  font-weight: 700;
}

.test-path-detail-chip--accent {
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.test-path-detail-chip--muted {
  background: rgba(102, 117, 141, 0.12);
  color: #66758d;
}

.test-path-detail-chip--warning {
  background: rgba(255, 170, 100, 0.16);
  color: #a35b06;
}

.test-path-detail-copy-block,
.test-path-detail-copy-group {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.test-path-process-lead-block {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 16px 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(255, 255, 255, 0.7));
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.test-path-process-lead-block--framing {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.06), rgba(255, 255, 255, 0.7));
  border-color: rgba(141, 107, 255, 0.12);
}

.test-path-process-lead-block p {
  margin: 0;
  color: #22304a;
  font-size: 14px;
  line-height: 1.75;
}

.test-path-detail-copy-block__label {
  color: #66758d;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.test-path-detail-copy-block pre,
.test-path-detail-copy-group pre,
.test-path-detail-process-card pre {
  margin: 0;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.05);
  color: #22304a;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.test-path-task__profile-copy {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  color: #4d5b72;
  font-size: 12px;
  line-height: 1.6;
}

.test-path-task__profile-line {
  display: block;
}

.test-path-process-pill-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.test-path-process-pill {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 8px 12px;
  border-radius: 14px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 700;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.88);
  color: #334155;
}

.test-path-process-pill--focus {
  background: rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.12);
  color: #1f57cc;
}

.test-path-process-pill--muted {
  background: rgba(102, 117, 141, 0.08);
  color: #66758d;
}

.test-path-process-pill--warning {
  background: rgba(255, 170, 100, 0.14);
  border-color: rgba(255, 170, 100, 0.18);
  color: #a35b06;
}

.test-path-process-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.test-path-process-overview-grid--compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.test-path-process-overview-card,
.test-path-process-section-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 255, 0.92));
}

.test-path-process-overview-card span {
  color: #66758d;
  font-size: 12px;
  font-weight: 800;
}

.test-path-process-overview-card strong {
  font-size: 24px;
  line-height: 1.1;
}

.test-path-process-overview-card p {
  margin: 0;
  color: #66758d;
  font-size: 12px;
}

.test-path-process-section-grid,
.test-path-process-inline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.test-path-process-flow {
  display: grid;
  gap: 16px;
}

.test-path-process-split-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.test-path-process-section-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.test-path-process-section-card__head strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
}

.test-path-process-section-card__head p {
  margin: 6px 0 0;
  color: #66758d;
  font-size: 13px;
  line-height: 1.6;
}

.test-path-process-section-card__head--stacked {
  align-items: flex-start;
}

.test-path-detail-chip-row--compact {
  margin-top: 0;
}

.test-path-detail-process-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  align-items: start;
}

.test-path-detail-process-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.test-path-detail-process-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
}

.test-path-detail-process-card {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(15, 23, 42, 0.02);
  align-self: start;
}

.test-path-detail-process-card--source-goal {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.92));
}

.test-path-concept-hierarchy {
  gap: 18px;
}

.test-path-concept-domain-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.08), rgba(84, 199, 137, 0.08));
}

.test-path-concept-domain-card strong {
  color: #172033;
  font-size: 20px;
  line-height: 1.4;
}

.test-path-concept-domain-card p {
  margin: 0;
  color: #526079;
  line-height: 1.7;
}

.test-path-concept-stage-grid {
  display: grid;
  gap: 16px;
}

.test-path-concept-stage-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.88);
}

.test-path-concept-stage-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.test-path-concept-stage-card__head strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
}

.test-path-concept-stage-card__head p,
.test-path-concept-binding-card p,
.test-path-concept-task-card p {
  margin: 6px 0 0;
  color: #66758d;
  line-height: 1.6;
}

.test-path-concept-binding-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(52, 120, 246, 0.05);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.test-path-concept-task-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.test-path-concept-task-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(15, 23, 42, 0.02);
}

.test-path-concept-task-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.test-path-process-mapping-list {
  display: grid;
  gap: 12px;
}

.test-path-process-mapping-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(15, 23, 42, 0.02);
}

.test-path-process-mapping-item strong {
  display: block;
  margin: 6px 0 4px;
  color: #172033;
}

.test-path-process-mapping-item p {
  margin: 0;
  color: #66758d;
  font-size: 12px;
  line-height: 1.6;
}

.test-path-process-state-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  white-space: nowrap;
}

.test-path-process-state-pill--kept {
  background: rgba(82, 196, 26, 0.14);
  color: #2f7d17;
}

.test-path-process-state-pill--derived {
  background: rgba(52, 120, 246, 0.12);
  color: #1f57cc;
}

.test-path-process-state-pill--truncated {
  background: rgba(255, 170, 100, 0.14);
  color: #a35b06;
}

.test-path-process-state-pill--missing {
  background: rgba(102, 117, 141, 0.12);
  color: #66758d;
}

.test-path-process-callout {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.16);
}

.test-path-process-callout strong {
  color: #1f57cc;
  font-size: 13px;
  font-weight: 900;
}

.test-path-process-callout p {
  margin: 0;
  color: #445065;
  font-size: 13px;
  line-height: 1.6;
}

.test-path-process-callout--warning {
  background: rgba(255, 170, 100, 0.12);
  border-color: rgba(255, 170, 100, 0.24);
}

.test-path-process-callout--warning strong {
  color: #b15b00;
}

.test-path-process-bullet-group {
  display: grid;
  gap: 10px;
}

.test-path-process-bullet-item {
  display: grid;
  gap: 4px;
  padding-left: 14px;
  position: relative;
}

.test-path-process-bullet-item::before {
  content: '';
  position: absolute;
  top: 7px;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #3478f6;
}

.test-path-process-bullet-item span {
  color: #66758d;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.test-path-process-bullet-item strong {
  color: #22304a;
  font-size: 13px;
  line-height: 1.6;
  font-weight: 600;
}

.test-path-detail-stage-trace-panel {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.test-path-detail-section-head--compact h2 {
  font-size: 22px;
}

.test-path-detail-timeline {
  display: grid;
  gap: 12px;
}

.test-path-detail-timeline-item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(15, 23, 42, 0.02);
}

.test-path-detail-timeline-item__rail {
  position: relative;
}

.test-path-detail-timeline-item__rail::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 6px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #3478f6;
  box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.12);
}

.test-path-detail-timeline-item__rail::after {
  content: '';
  position: absolute;
  top: 14px;
  bottom: -18px;
  left: 8px;
  width: 2px;
  background: rgba(52, 120, 246, 0.12);
}

.test-path-detail-timeline-item:last-child .test-path-detail-timeline-item__rail::after {
  display: none;
}

.test-path-detail-timeline-item__body {
  display: grid;
  gap: 10px;
}

.test-path-detail-timeline-item--failed {
  background: rgba(255, 110, 110, 0.05);
  border-color: rgba(255, 110, 110, 0.18);
}

.test-path-detail-timeline-item--succeeded {
  background: rgba(82, 196, 26, 0.05);
  border-color: rgba(82, 196, 26, 0.18);
}

.test-path-detail-timeline-item--started {
  background: rgba(52, 120, 246, 0.05);
  border-color: rgba(52, 120, 246, 0.18);
}

.test-path-detail-timeline-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.test-path-detail-timeline-item__head p {
  margin: 4px 0 0;
  color: #66758d;
  font-size: 12px;
}

.test-path-detail-timeline-item__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.test-path-detail-status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.test-path-detail-status-badge--started {
  background: rgba(52, 120, 246, 0.12);
  color: #1f57cc;
}

.test-path-detail-status-badge--succeeded {
  background: rgba(82, 196, 26, 0.14);
  color: #2f7d17;
}

.test-path-detail-status-badge--failed {
  background: rgba(255, 110, 110, 0.14);
  color: #bb3434;
}

.test-path-detail-trace-summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.test-path-detail-raw-panel {
  margin-top: 16px;
}

.test-path-detail-raw-panel--compact {
  margin-top: 10px;
}

.test-path-detail-raw-panel summary {
  cursor: pointer;
  font-weight: 800;
  color: #172033;
}

.test-path-detail-empty-state {
  padding: 18px;
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.04);
  color: #66758d;
  text-align: center;
}

.test-path-detail-empty-state--inline {
  margin-top: 12px;
  text-align: left;
}

.test-path-detail-banner {
  padding: 16px 18px;
}

.test-path-detail-banner--processing,
.test-path-detail-banner--pending {
  background: linear-gradient(135deg, rgba(113, 128, 255, 0.12), rgba(86, 178, 255, 0.08));
}

.test-path-detail-banner--failed {
  background: linear-gradient(135deg, rgba(255, 170, 100, 0.16), rgba(255, 110, 110, 0.08));
}

.test-path-stage {
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.02);
}

.test-path-stage__head {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.test-path-stage__index {
  display: inline-flex;
  margin-bottom: 6px;
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-path-stage__head strong,
.test-path-task__head strong,
.test-path-detail-plan-item strong {
  display: block;
  margin-bottom: 6px;
}

.test-path-stage__meta {
  font-size: 12px;
  font-weight: 800;
  color: #4d5b72;
}

.test-path-stage__body {
  padding: 0 18px 18px;
}

.test-path-task {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.76);
}

.test-path-task--locked {
  opacity: 0.72;
}

.test-path-task__head,
.test-path-task__actions,
.test-path-detail-hero__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.test-path-detail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid rgba(52, 120, 246, 0.15);
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-primary, #172033);
  text-decoration: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: 180ms ease;
}

.test-path-detail-btn:hover {
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  color: var(--color-primary, #3478f6);
}

.test-path-detail-btn--primary {
  border: none;
  background: linear-gradient(135deg, #3478f6, color-mix(in srgb, #3478f6 68%, #8d6bff));
  color: #fff;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.24);
}

.test-path-detail-btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
}

.test-path-detail-evaluation-dialog pre {
  max-height: 420px;
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.06);
  font-size: 12px;
  line-height: 1.6;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1180px) {
  .test-path-detail-header__inner,
  .test-path-detail-shell {
    width: min(100% - 32px, 1280px);
  }

  .test-path-detail-grid,
  .test-path-detail-grid--content {
    grid-template-columns: 1fr;
  }

  .test-path-detail-process-grid {
    grid-template-columns: 1fr;
  }

  .test-path-process-overview-grid,
  .test-path-process-section-grid,
  .test-path-process-split-grid,
  .test-path-process-inline-grid,
  .test-path-process-kv-grid,
  .test-path-detail-process-grid--two,
  .test-path-detail-process-grid--three {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .test-path-detail-header__inner,
  .test-path-detail-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .test-path-detail-hero__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .test-path-detail-nav {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  .test-path-detail-header__inner,
  .test-path-detail-shell {
    width: calc(100% - 24px);
  }

  .test-path-detail-nav {
    display: none;
  }

  .test-path-detail-card,
  .test-path-detail-empty,
  .test-path-detail-hero,
  .test-path-detail-banner {
    padding: 18px;
    border-radius: 20px;
  }
}
</style>
