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
              <span v-if="path.subject" class="test-path-detail-chip">主题：{{ path.subject }}</span>
              <span class="test-path-detail-chip">阶段：{{ pathOverviewMetrics[0]?.value || 0 }}</span>
              <span class="test-path-detail-chip">预计投入：{{ pathOverviewMetrics[1]?.value || '--' }}</span>
            </div>
          </div>

          <div class="test-path-detail-hero__actions">
            <button class="test-path-detail-btn test-path-detail-btn--primary" :disabled="!primaryActionTask || !canStartLearning" @click="startPrimaryActionTask">
              {{ primaryActionLabel }}
            </button>
            <button v-if="enrichmentStatus === 'failed'" class="test-path-detail-btn test-path-detail-btn--ghost" :disabled="retryingEnrichment" @click="retryEnrichment">
              继续完善
            </button>
          </div>
        </section>

        <section class="test-path-detail-grid">
          <aside class="test-path-detail-sidebar">
            <section class="test-path-detail-card">
              <span class="test-path-detail-eyebrow">生成状态</span>
              <div class="test-path-detail-kv-list">
                <div class="test-path-detail-kv"><span>core</span><strong>{{ generationStatus?.core || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>coreStep</span><strong>{{ generationStatus?.coreStep || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>enrichment</span><strong>{{ enrichmentStatus || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>sourceConversationId</span><strong>{{ generationStatus?.sourceConversationId || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>canStartLearning</span><strong>{{ canStartLearning ? 'true' : 'false' }}</strong></div>
              </div>
            </section>

            <section v-if="path.sceneSummary" class="test-path-detail-card">
              <span class="test-path-detail-eyebrow">Scene Summary</span>
              <div class="test-path-detail-kv-list">
                <div class="test-path-detail-kv"><span>firstDeliverable</span><strong>{{ path.sceneSummary.firstDeliverable || '--' }}</strong></div>
                <div class="test-path-detail-kv"><span>targetState</span><strong>{{ path.sceneSummary.targetState || '--' }}</strong></div>
              </div>
              <div v-if="Array.isArray(path.sceneSummary.planningFocus) && path.sceneSummary.planningFocus.length > 0" class="test-path-detail-chip-row">
                <span v-for="item in path.sceneSummary.planningFocus" :key="item" class="test-path-detail-chip">{{ item }}</span>
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
                  <span class="test-path-detail-eyebrow">阶段结构</span>
                  <h2>完整任务级路径</h2>
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
                          </div>
                          <div class="test-path-detail-chip-row">
                            <span class="test-path-detail-chip">{{ getStatusText(task.status) }}</span>
                            <span class="test-path-detail-chip">{{ getTaskTypeText(task.taskType) }}</span>
                            <span class="test-path-detail-chip">{{ task.estimatedMinutes || 0 }} 分钟</span>
                          </div>
                        </div>

                        <div class="test-path-task__actions">
                          <button v-if="task.status !== 'completed'" class="test-path-detail-btn test-path-detail-btn--primary" :disabled="!canStartLearning" @click="startTask(task)">
                            {{ canStartLearning ? (task.status === 'in_progress' ? '继续学习' : '开始学习') : '等待内容准备' }}
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
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { toast } from '@/utils/toast';
import api from '@/utils/api';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI, type TaskEvaluationDetail } from '@/api/aiTeaching';
import { useUserStore } from '@/stores/user';

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

const totalTasks = computed(() => pathStages.value.reduce((sum: number, stage: any) => sum + normalizeTaskList(stage).length, 0));
const completedTasks = computed(() => pathStages.value.reduce((sum: number, stage: any) => sum + normalizeTaskList(stage).filter((task: any) => task.status === 'completed').length, 0));
const completionRate = computed(() => totalTasks.value === 0 ? 0 : Math.round((completedTasks.value / totalTasks.value) * 100));
const pathStatusLabel = computed(() => {
  const status = path.value?.status;
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'draft' || status === 'generating') return '生成中';
  return '规划中';
});
const pathOverviewMetrics = computed(() => [
  { label: '阶段数', value: String(path.value?.totalMilestones || path.value?.totalStages || 0) },
  { label: '预计投入', value: `${Math.round(path.value?.estimatedHours || 0)} 小时` },
  { label: '当前阶段', value: (() => {
    const idx = pathStages.value.findIndex((s: any) => s === activeStage.value);
    return idx >= 0 ? `第 ${idx + 1} 阶段` : '待开始';
  })() },
  { label: '任务进度', value: `${completedTasks.value}/${totalTasks.value}` }
]);
const generationStatus = computed(() => path.value?.generationStatus || null);
const enrichmentStatus = computed(() => generationStatus.value?.enrichment || null);
const canStartLearning = computed(() => path.value?.canStartLearning !== false);
const showEnrichmentBanner = computed(() => path.value?.status === 'active' && enrichmentStatus.value && enrichmentStatus.value !== 'succeeded');
const enrichmentBannerTitle = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') return '学习内容准备中';
  if (enrichmentStatus.value === 'failed') return '学习内容继续完善中';
  return '学习内容状态未知';
});
const enrichmentBannerMessage = computed(() => {
  if (enrichmentStatus.value === 'processing' || enrichmentStatus.value === 'pending') return '路径主结构已经生成，系统正在后台准备学习内容。';
  if (enrichmentStatus.value === 'failed') return path.value?.learningBlockedReason || '系统正在继续完善学习内容，你也可以手动触发继续完善。';
  return path.value?.learningBlockedReason || '学习内容状态暂不可用，请稍后刷新页面。';
});
const pathStages = computed(() => path.value?.milestones || path.value?.weeks || []);
const normalizeTaskList = (stage: any) => stage?.subtasks || stage?.tasks || [];
const activeStage = computed(() => pathStages.value.find((stage: any) => normalizeTaskList(stage).some((task: any) => task.status !== 'completed')) || pathStages.value[0] || null);
const activeStageTasks = computed(() => normalizeTaskList(activeStage.value));
const primaryActionTask = computed(() => activeStageTasks.value.find((task: any) => task.status === 'todo') || activeStageTasks.value.find((task: any) => task.status === 'in_progress') || null);
const primaryActionLabel = computed(() => !canStartLearning.value ? '等待内容准备' : (primaryActionTask.value?.status === 'in_progress' ? '继续学习' : '开始学习'));
const nextActionTasks = computed(() => {
  const upcoming = activeStageTasks.value.filter((task: any) => task.status !== 'completed');
  return (upcoming.length > 0 ? upcoming : activeStageTasks.value).slice(0, 3);
});
const pathDetailPlan = computed(() => {
  const items = nextActionTasks.value.map((task: any, index: number) => ({
    title: `任务 ${index + 1}`,
    desc: `${task.title}${task.estimatedMinutes ? ` · 预计 ${task.estimatedMinutes} 分钟` : ''}`
  }));
  return items.length > 0 ? items : [{ title: '当前暂无待推进任务', desc: '等学习内容准备完成后，这里会出现最值得先开始的任务。' }];
});

const handleScroll = () => { headerScrolled.value = window.scrollY > 50; };
const loadPathData = async () => {
  if (!path.value) loading.value = true;
  try {
    const response = await api.get(`/learning/paths/${pathId}`);
    path.value = response.data;
    if (path.value.milestones && !path.value.weeks) {
      path.value.weeks = path.value.milestones.map((m: any) => ({ ...m, weekNumber: m.stageNumber, tasks: m.subtasks }));
    }
    if (path.value.weeks) {
      path.value.weeks.forEach((week: any) => {
        if (week.learningObjectives) {
          try { week.learningObjectives = JSON.parse(week.learningObjectives); } catch { week.learningObjectives = []; }
        }
      });
    }
    if (path.value?.generationStatus?.enrichment === 'processing' || path.value?.generationStatus?.enrichment === 'pending') startEnrichmentPolling();
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
  router.push(`/admin/test/learn/${task.id}`);
};
const startTask = (task: any) => openTaskDetail(task);
const startPrimaryActionTask = () => { if (primaryActionTask.value) startTask(primaryActionTask.value); };
const retryEnrichment = async () => {
  if (!path.value?.id) return;
  retryingEnrichment.value = true;
  try {
    await learningAPI.retryPathEnrichment(path.value.id);
    toast.success('已在后台继续完善学习内容。');
    await loadPathData();
  } catch (error: any) {
    toast.error(error.message || '继续完善学习内容失败');
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
const getTaskTypeText = (type: string) => ({ reading: '阅读', practice: '练习', project: '项目', quiz: '测验' }[type] || type || '任务');

onMounted(() => {
  void loadPathData();
  window.addEventListener('scroll', handleScroll);
});

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
.test-path-detail-banner p {
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

.test-path-detail-sidebar,
.test-path-detail-main,
.test-path-detail-kv-list,
.test-path-detail-plan-list,
.test-path-stage-list,
.test-path-task-list {
  display: grid;
  gap: 16px;
}

.test-path-detail-card {
  padding: 20px;
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
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #172033;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.test-path-detail-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  color: #fff;
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

  .test-path-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .test-path-detail-header__inner,
  .test-path-detail-hero {
    flex-direction: column;
    align-items: flex-start;
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
