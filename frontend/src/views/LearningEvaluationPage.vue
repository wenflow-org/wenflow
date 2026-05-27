<template>
  <div class="evaluation-page">
    <div class="evaluation-shell" ref="reportRef">
      <header class="evaluation-head">
        <div>
          <p class="evaluation-kicker">课程评估</p>
          <h1>本节学习反馈</h1>
        </div>
        <div class="evaluation-head__actions">
          <el-button :loading="exportingImage" @click="exportImage">导出图片</el-button>
          <el-button @click="exportPdf">导出 PDF</el-button>
          <el-button @click="goBackToPath">返回学习路径</el-button>
        </div>
      </header>

      <section v-if="loading" class="evaluation-loading">
        <el-icon class="spin"><Loading /></el-icon>
        <p>正在生成课程评估，请稍候...</p>
      </section>

      <section v-else-if="error" class="evaluation-error">
        <p>{{ error }}</p>
        <div class="evaluation-error__actions">
          <el-button type="primary" @click="fetchEvaluation">重试</el-button>
          <el-button @click="goBackToPath">返回学习路径</el-button>
        </div>
      </section>

      <CompletionCard
        v-else-if="sessionDetail"
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
    </div>
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

const isTestMode = computed(() => route.meta.isTestMode === true);
const isAdminRoute = computed(() => route.path.startsWith('/admin/'));
const learningPathDetailBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-path' : '/learning-path';
  }
  return '/learning-path';
});
const learningPathsPath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learning-paths' : '/learning-paths';
  }
  return '/learning-paths';
});
const learnBasePath = computed(() => {
  if (isTestMode.value) {
    return isAdminRoute.value ? '/admin/test/learn' : '/learn';
  }
  return '/learn';
});

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
          if (!shouldContinuePolling(nextDetail)) {
            stopPolling();
          }
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
  const pathId = (route.query.pathId as string) || '';
  if (pathId) {
    const query: Record<string, string> = {};
    if (forceRefresh) query.t = String(Date.now());
    router.push({ path: `${learningPathDetailBasePath.value}/${pathId}`, query });
    return;
  }
  router.push(learningPathsPath.value);
};

const handleAction = async (action: 'end' | 'continue-task' | 'complete-task') => {
  if (action === 'continue-task') {
    router.push(`${learnBasePath.value}/${taskId.value}`);
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
  const learningPathId = route.query.pathId as string;
  if (!learningPathId) {
    toast.warning('当前会话缺少学习路径信息，暂无法调整下一阶段');
    return;
  }

  try {
    await ElMessageBox.confirm('这会基于当前学习证据调整当前路径的后续阶段，已完成任务会保留不变。是否继续？', '调整当前路径', {
      confirmButtonText: '确认调整当前路径',
      cancelButtonText: '取消',
      type: 'warning'
    });

    await api.post(`/learning/paths/${learningPathId}/replan`, {
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
    toast.success('已调整当前路径的后续阶段');
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
.evaluation-page {
  min-height: 100vh;
  background: #f3f6fb;
  padding: 28px 0 64px;
}

.evaluation-shell {
  width: min(1200px, calc(100% - 64px));
  margin: 0 auto;
  display: grid;
  gap: 20px;
}

.evaluation-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 28px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
}

.evaluation-head__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.evaluation-head__actions :deep(.el-button) {
  border-radius: 10px;
  font-weight: 600;
  font-size: 13px;
  height: 36px;
  padding: 0 16px;
}

.evaluation-kicker {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep, #1f57cc);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.evaluation-head h1 {
  margin: 0;
  font-size: clamp(22px, 2.8vw, 32px);
  font-weight: 700;
  color: #172033;
  letter-spacing: -0.02em;
}

.evaluation-loading,
.evaluation-error {
  padding: 60px 24px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 16px;
  background: #fff;
  display: grid;
  justify-items: center;
  gap: 12px;
  font-size: 15px;
  color: #7a8599;
}

.evaluation-error__actions {
  display: flex;
  gap: 10px;
}

.spin {
  animation: spin 1s linear infinite;
  font-size: 36px;
  color: var(--accent, #3478f6);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ---- report-mode overrides for CompletionCard ---- */
.evaluation-shell :deep(.completion-card) {
  margin-top: 0;
  padding: 28px 32px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  background-image: none;
}

.evaluation-shell :deep(.completion-header) {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.evaluation-shell :deep(.completion-title) {
  font-size: 20px;
  font-weight: 700;
  color: #172033;
}

.evaluation-shell :deep(.completion-header .el-icon) {
  font-size: 28px;
  color: #31b16f;
}

.evaluation-shell :deep(.completion-summary) {
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 16px 20px;
  background: #f3f6fb;
  border-radius: 12px;
  margin-bottom: 20px;
}

.evaluation-shell :deep(.summary-label) {
  font-size: 12px;
  font-weight: 600;
  color: #7a8599;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.evaluation-shell :deep(.summary-value) {
  font-size: 15px;
  font-weight: 700;
  color: #172033;
}

.evaluation-shell :deep(.completion-section) {
  padding: 18px 20px;
  background: #fff;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 12px;
  margin-bottom: 14px;
}

.evaluation-shell :deep(.section-title) {
  font-size: 15px;
  font-weight: 700;
  color: #172033;
  margin-bottom: 12px;
}

.evaluation-shell :deep(.section-title .el-icon) {
  color: var(--accent, #3478f6);
}

.evaluation-shell :deep(.section-content) {
  font-size: 14px;
  line-height: 1.8;
  color: #3d4a5c;
}

.evaluation-shell :deep(.section-hint) {
  font-size: 13px;
  color: #7a8599;
}

.evaluation-shell :deep(.metrics-grid) {
  gap: 12px;
}

.evaluation-shell :deep(.metrics-grid--three) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.evaluation-shell :deep(.metric-card) {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: #f8fafc;
}

.evaluation-shell :deep(.metric-label) {
  font-size: 12px;
  font-weight: 600;
  color: #7a8599;
}

.evaluation-shell :deep(.metric-badge) {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
}

.evaluation-shell :deep(.metric-card--good .metric-badge) {
  background: rgba(49, 177, 111, 0.1);
  color: #1a7a42;
}

.evaluation-shell :deep(.metric-card--normal .metric-badge) {
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
}

.evaluation-shell :deep(.metric-card--warn .metric-badge) {
  background: rgba(232, 100, 80, 0.08);
  color: #b44020;
}

.evaluation-shell :deep(.metric-value) {
  font-size: 26px;
  font-weight: 800;
  color: #172033;
  margin-top: 8px;
}

.evaluation-shell :deep(.metric-desc) {
  font-size: 12px;
  color: #7a8599;
  line-height: 1.5;
  margin-top: 6px;
}

.evaluation-shell :deep(.knowledge-list) {
  gap: 10px;
}

.evaluation-shell :deep(.knowledge-item) {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: #f8fafc;
}

.evaluation-shell :deep(.knowledge-name) {
  font-size: 14px;
  font-weight: 700;
  color: #172033;
}

.evaluation-shell :deep(.knowledge-evidence) {
  font-size: 13px;
  color: #7a8599;
  line-height: 1.6;
}

.evaluation-shell :deep(.ordered-list) {
  font-size: 14px;
  line-height: 1.75;
  color: #3d4a5c;
}

.evaluation-shell :deep(.evaluation-line) {
  font-size: 14px;
  line-height: 1.75;
  color: #3d4a5c;
}

.evaluation-shell :deep(.advisory-section) {
  border-radius: 12px;
}

.evaluation-shell :deep(.completion-actions) {
  padding-top: 16px;
  border-top: 1px solid rgba(23, 32, 51, 0.06);
  margin-top: 8px;
  gap: 10px;
}

.evaluation-shell :deep(.completion-actions .el-button) {
  border-radius: 10px;
  font-weight: 600;
  font-size: 13px;
  height: 38px;
  padding: 0 18px;
}

/* ---- responsive ---- */
@media (max-width: 1100px) {
  .evaluation-shell {
    width: calc(100% - 48px);
  }
}

@media (max-width: 900px) {
  .evaluation-shell {
    width: calc(100% - 28px);
  }

  .evaluation-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .evaluation-head__actions {
    width: 100%;
  }

  .evaluation-shell :deep(.completion-summary) {
    grid-template-columns: repeat(2, 1fr);
  }

  .evaluation-shell :deep(.metrics-grid--three) {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .evaluation-shell :deep(.completion-summary) {
    grid-template-columns: 1fr;
  }
}

@media print {
  .evaluation-page {
    background: #fff;
    padding: 0;
    min-height: auto;
  }

  .evaluation-shell {
    width: 100%;
    max-width: 100%;
  }

  .evaluation-head__actions {
    display: none;
  }

  .evaluation-head {
    border: none;
    box-shadow: none;
    padding: 0 0 16px;
  }

  .evaluation-loading,
  .evaluation-error {
    display: none;
  }
}
</style>
