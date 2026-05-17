<template>
  <div class="test-evaluation-page">
    <header class="test-evaluation-header">
      <div class="test-evaluation-header__inner">
        <button type="button" class="test-evaluation-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="test-evaluation-brand__logo" />
          <span>测试课程评估</span>
        </button>

        <nav class="test-evaluation-nav" aria-label="测试站点导航">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths">测试学习路径</router-link>
          <router-link :to="learnLink" class="is-active">测试课程评估</router-link>
        </nav>

        <div class="test-evaluation-header__actions">
          <button class="test-evaluation-btn test-evaluation-btn--ghost" @click="goBackToPath">返回路径详情</button>
        </div>
      </div>
    </header>

    <main class="test-evaluation-shell">
      <section class="test-evaluation-hero test-evaluation-card">
        <div>
          <span class="test-evaluation-eyebrow">Evaluation Workbench</span>
          <h1>本节学习反馈</h1>
          <p>这里展示 wrapup、advisory、评估轮询状态和原始结构化结果，便于测试 `learn -> evaluation -> replan` 链路。</p>
        </div>
        <div class="test-evaluation-hero__actions">
          <button class="test-evaluation-btn test-evaluation-btn--ghost" :disabled="exportingImage" @click="exportImage">导出图片</button>
          <button class="test-evaluation-btn test-evaluation-btn--ghost" @click="exportPdf">导出 PDF</button>
        </div>
      </section>

      <section v-if="loading" class="test-evaluation-card test-evaluation-empty">
        <el-icon class="spin"><Loading /></el-icon>
        <p>正在生成课程评估，请稍候...</p>
      </section>

      <section v-else-if="error" class="test-evaluation-card test-evaluation-empty">
        <p>{{ error }}</p>
        <div class="test-evaluation-hero__actions">
          <button class="test-evaluation-btn test-evaluation-btn--primary" @click="fetchEvaluation">重试</button>
          <button class="test-evaluation-btn test-evaluation-btn--ghost" @click="goBackToPath">返回路径详情</button>
        </div>
      </section>

      <template v-else-if="sessionDetail">
        <section class="test-evaluation-grid">
          <aside class="test-evaluation-sidebar">
            <section class="test-evaluation-card">
              <span class="test-evaluation-eyebrow">会话信息</span>
              <div class="test-evaluation-kv-list">
                <div class="test-evaluation-kv"><span>sessionId</span><strong>{{ sessionId }}</strong></div>
                <div class="test-evaluation-kv"><span>taskId</span><strong>{{ taskId }}</strong></div>
                <div class="test-evaluation-kv"><span>topic</span><strong>{{ sessionDetail.topic }}</strong></div>
                <div class="test-evaluation-kv"><span>duration</span><strong>{{ formatTime(durationSeconds) }}</strong></div>
                <div class="test-evaluation-kv"><span>messageCount</span><strong>{{ sessionDetail.messages?.length || 0 }}</strong></div>
                <div class="test-evaluation-kv"><span>polling</span><strong>{{ shouldContinuePolling(sessionDetail) ? 'running' : 'stopped' }}</strong></div>
              </div>
            </section>

            <section class="test-evaluation-card">
              <span class="test-evaluation-eyebrow">Wrapup 状态</span>
              <div class="test-evaluation-kv-list">
                <div class="test-evaluation-kv"><span>status</span><strong>{{ wrapup.status }}</strong></div>
                <div class="test-evaluation-kv"><span>summary source</span><strong>{{ wrapup.sources.summary }}</strong></div>
                <div class="test-evaluation-kv"><span>evaluation source</span><strong>{{ wrapup.sources.evaluation }}</strong></div>
                <div class="test-evaluation-kv"><span>knowledge points</span><strong>{{ knowledgePoints.length }}</strong></div>
              </div>
            </section>

            <section v-if="sessionDetail.advisory" class="test-evaluation-card">
              <span class="test-evaluation-eyebrow">Advisory</span>
              <div class="test-evaluation-kv-list">
                <div class="test-evaluation-kv"><span>shouldSuggest</span><strong>{{ sessionDetail.advisory.shouldSuggest ? 'true' : 'false' }}</strong></div>
                <div class="test-evaluation-kv"><span>priority</span><strong>{{ sessionDetail.advisory.priority }}</strong></div>
                <div class="test-evaluation-kv"><span>recommendation</span><strong>{{ sessionDetail.advisory.recommendation }}</strong></div>
                <div class="test-evaluation-kv"><span>scope</span><strong>{{ sessionDetail.advisory.scope }}</strong></div>
              </div>
            </section>
          </aside>

          <section class="test-evaluation-main">
            <section class="test-evaluation-card">
              <div class="test-evaluation-section-head">
                <div>
                  <span class="test-evaluation-eyebrow">可见结果</span>
                  <h2>Completion Card</h2>
                </div>
              </div>

              <CompletionCard
                :topic="sessionDetail.topic"
                :mastered-count="knowledgePoints.filter(kp => kp.status === 'mastered').length"
                :total-count="knowledgePoints.length"
                :duration="formatTime(durationSeconds)"
                :message-count="sessionDetail.messages?.length || 0"
                :wrapup="wrapup"
                :advisory="sessionDetail.advisory || null"
                @action="handleAction"
                @advisory-action="handleAdvisoryAction"
              />
            </section>

            <section class="test-evaluation-card">
              <div class="test-evaluation-section-head">
                <div>
                  <span class="test-evaluation-eyebrow">原始结构</span>
                  <h2>Wrapup / Advisory / Session Detail</h2>
                </div>
              </div>

              <details class="test-evaluation-details" open>
                <summary>展开 Wrapup</summary>
                <pre>{{ JSON.stringify(wrapup, null, 2) }}</pre>
              </details>

              <details class="test-evaluation-details">
                <summary>展开 Advisory</summary>
                <pre>{{ JSON.stringify(sessionDetail.advisory || null, null, 2) }}</pre>
              </details>

              <details class="test-evaluation-details">
                <summary>展开 Session Detail</summary>
                <pre>{{ JSON.stringify(sessionDetail, null, 2) }}</pre>
              </details>
            </section>
          </section>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Loading } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import html2canvas from 'html2canvas-pro';
import CompletionCard from '@/components/CompletionCard.vue';
import { aiTeachingAPI, type SessionDetail, type WrapupArtifact } from '@/api/aiTeaching';
import { toast } from '@/utils/toast';
import api from '@/utils/api';

const route = useRoute();
const router = useRouter();

const taskId = computed(() => route.params.taskId as string);
const sessionId = computed(() => route.params.sessionId as string);
const pathId = computed(() => (route.query.pathId as string) || '');
const learnLink = computed(() => `/admin/test/learn/${taskId.value}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`);

const loading = ref(true);
const error = ref('');
const sessionDetail = ref<SessionDetail | null>(null);
const pollTimer = ref<number | null>(null);
const reportRef = ref<HTMLElement | null>(null);
const exportingImage = ref(false);

const wrapup = computed<WrapupArtifact>(() => {
  return sessionDetail.value?.wrapup || {
    status: 'summary-only',
    sources: { summary: 'fallback', evaluation: 'failed' },
    summary: {
      topicSummary: '本次课程已结束，评估尚在生成。',
      knowledgeSummary: '知识点状态稍后更新。',
      practiceAdvice: '请稍后刷新查看完整建议。',
      learningEvaluation: '评估尚未完成。',
      knowledgeItems: [],
      keyTakeaways: [],
      actionPlan: [],
      evaluationHighlights: { strengths: [], improvements: [] },
      metricInterpretation: {
        session: '正在计算本节课堂表现。',
        longTerm: '长期状态将在评估完成后更新。'
      },
      summaryVersion: 'v2'
    },
    evaluation: null,
    progress: {
      newlyMastered: [],
      movedToReview: [],
      stillLearning: [],
      unchangedMastered: []
    },
    evidence: {
      turnCount: 0,
      avgUnderstanding: null,
      avgEngagement: null,
      dominantCognitiveLevel: null,
      lastCognitiveLevel: null,
      topConfusionPoints: [],
      emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
      completionCandidateSeen: false
    }
  };
});

const knowledgePoints = computed(() => sessionDetail.value?.knowledgePoints || []);
const durationSeconds = computed(() => {
  const minutes = sessionDetail.value?.wrapup?.duration ?? sessionDetail.value?.duration ?? 0;
  return typeof minutes === 'number' ? Math.max(0, Math.round(minutes * 60)) : 0;
});

const stopPolling = () => {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
};

const shouldContinuePolling = (detail: SessionDetail | null) => {
  if (!detail) return true;
  if (!detail.wrapup) return true;
  if (!detail.wrapup.summary?.topicSummary) return true;
  return false;
};

const fetchEvaluation = async () => {
  loading.value = true;
  error.value = '';
  try {
    const detail = await aiTeachingAPI.getSessionDetail(sessionId.value);
    sessionDetail.value = detail;
    if (!detail) {
      error.value = '未找到该会话评估结果';
      return;
    }
    if (shouldContinuePolling(detail)) {
      if (!pollTimer.value) {
        pollTimer.value = window.setInterval(async () => {
          const nextDetail = await aiTeachingAPI.getSessionDetail(sessionId.value);
          sessionDetail.value = nextDetail;
          if (!shouldContinuePolling(nextDetail)) stopPolling();
        }, 2000);
      }
    } else {
      stopPolling();
    }
  } catch (err: any) {
    error.value = err?.message || '加载评估失败';
  } finally {
    loading.value = false;
  }
};

const goBackToPath = (forceRefresh?: boolean) => {
  if (pathId.value) {
    const query: Record<string, string> = {};
    if (forceRefresh) query.t = String(Date.now());
    router.push({ path: `/admin/test/learning-path/${pathId.value}`, query });
    return;
  }
  router.push('/admin/test/learning-paths');
};

const handleAction = async (action: 'end' | 'continue-task' | 'complete-task') => {
  if (action === 'continue-task') {
    router.push(`/admin/test/learn/${taskId.value}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`);
    return;
  }
  if (action === 'complete-task') {
    try {
      await api.post(`/learning/tasks/${taskId.value}/complete`, { actualMinutes: Math.ceil(durationSeconds.value / 60) });
      toast.success('已将本任务标记为完成');
      goBackToPath(true);
    } catch (err: any) {
      toast.error(err?.message || '标记任务完成失败');
    }
    return;
  }
  goBackToPath();
};

const handleAdvisoryAction = async (action: string) => {
  if (!sessionDetail.value?.advisory?.shouldSuggest) return;
  if (!pathId.value) {
    toast.warning('当前会话缺少学习路径信息，暂无法调整下一阶段');
    return;
  }
  try {
    await ElMessageBox.confirm('这会基于当前学习证据创建新的路径版本，是否继续？', '调整下一阶段', {
      confirmButtonText: '确认调整',
      cancelButtonText: '取消',
      type: 'warning'
    });
    await api.post(`/learning/paths/${pathId.value}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'new_version',
      reason: '根据课后建议调整下一阶段',
      evidence: {
        advisoryAction: action,
        advisory: sessionDetail.value.advisory,
        wrapup: sessionDetail.value.wrapup,
        taskId: taskId.value,
        taskTitle: sessionDetail.value.topic
      }
    });
    toast.success('已创建新的学习路径版本');
  } catch (err: any) {
    if (err !== 'cancel') toast.error(err?.message || '调整下一阶段失败');
  }
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const getExportFilename = () => {
  const topic = sessionDetail.value?.topic || '学习评估';
  const date = new Date().toISOString().slice(0, 10);
  return `${topic}-${date}`;
};

const exportImage = async () => {
  if (!reportRef.value || exportingImage.value) return;
  exportingImage.value = true;
  try {
    const canvas = await html2canvas(reportRef.value, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f3f6fb',
      logging: false,
    });
    const link = document.createElement('a');
    link.download = `${getExportFilename()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('图片已导出');
  } catch (err: any) {
    toast.error(err?.message || '导出图片失败');
  } finally {
    exportingImage.value = false;
  }
};

const exportPdf = () => {
  window.print();
};

onMounted(fetchEvaluation);
onUnmounted(stopPolling);
</script>

<style scoped>
.test-evaluation-page {
  min-height: 100vh;
  background: #f3f6fb;
}

.test-evaluation-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.test-evaluation-header__inner,
.test-evaluation-shell {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.test-evaluation-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.test-evaluation-brand {
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

.test-evaluation-brand__logo {
  height: 52px;
}

.test-evaluation-nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.test-evaluation-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: #66758d;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.test-evaluation-nav a.is-active,
.test-evaluation-nav a.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.test-evaluation-shell {
  padding: 28px 0 64px;
  display: grid;
  gap: 20px;
}

.test-evaluation-card,
.test-evaluation-hero,
.test-evaluation-empty {
  padding: 22px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
}

.test-evaluation-empty {
  min-height: 220px;
  display: grid;
  place-items: center;
  gap: 10px;
  text-align: center;
}

.test-evaluation-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
}

.test-evaluation-eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
  font-size: 12px;
  font-weight: 900;
}

.test-evaluation-hero h1,
.test-evaluation-section-head h2 {
  margin: 10px 0 8px;
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.12;
}

.test-evaluation-hero p,
.test-evaluation-empty p {
  margin: 0;
  color: #66758d;
  line-height: 1.7;
  font-size: 14px;
}

.test-evaluation-grid {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 20px;
}

.test-evaluation-sidebar,
.test-evaluation-main,
.test-evaluation-kv-list {
  display: grid;
  gap: 16px;
}

.test-evaluation-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.test-evaluation-kv span {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
}

.test-evaluation-kv strong {
  color: #172033;
  font-size: 13px;
}

.test-evaluation-section-head {
  margin-bottom: 12px;
}

.test-evaluation-details {
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.02);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.test-evaluation-details summary {
  cursor: pointer;
  font-weight: 800;
  color: #172033;
}

.test-evaluation-details pre {
  margin: 12px 0 0;
  max-height: 420px;
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.06);
  font-size: 12px;
  line-height: 1.6;
}

.test-evaluation-hero__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.test-evaluation-btn {
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

.test-evaluation-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  color: #fff;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1180px) {
  .test-evaluation-header__inner,
  .test-evaluation-shell {
    width: min(100% - 32px, 1280px);
  }

  .test-evaluation-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .test-evaluation-header__inner,
  .test-evaluation-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .test-evaluation-nav {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  .test-evaluation-header__inner,
  .test-evaluation-shell {
    width: calc(100% - 24px);
  }

  .test-evaluation-nav {
    display: none;
  }

  .test-evaluation-card,
  .test-evaluation-hero,
  .test-evaluation-empty {
    border-radius: 20px;
  }
}
</style>
