<template>
  <div class="evaluation-page v2-page">
    <div class="evaluation-shell" ref="reportRef">
      <header class="evaluation-head">
        <div>
          <p class="evaluation-kicker">学习反馈</p>
          <h1>当前任务学习反馈</h1>
          <AiContentNote class="evaluation-head__ai-note" />
        </div>
        <div class="evaluation-head__actions">
          <el-button :loading="exportingImage" @click="exportImage">导出图片</el-button>
          <el-button @click="exportPdf">打印或另存为 PDF</el-button>
          <el-button type="primary" @click="goBackToPath">返回学习路径</el-button>
        </div>
      </header>

      <section v-if="loading" class="evaluation-loading">
        <el-icon class="spin"><Loading /></el-icon>
          <p>正在整理本次学习反馈，请稍候…</p>
      </section>

      <section v-else-if="error" class="evaluation-error">
        <p>{{ error }}</p>
        <div class="evaluation-error__actions">
          <el-button type="primary" @click="fetchEvaluation">重试</el-button>
          <el-button @click="goBackToPath">返回学习路径</el-button>
        </div>
      </section>

      <template v-else-if="sessionDetail">
        <section v-if="evaluationDegraded" class="evaluation-degraded" role="status">
          <strong>课堂总结已生成，详细表现分析暂不可用</strong>
          <p>这不会影响你保存进度、完成任务或查看本次对话。</p>
        </section>

        <CompletionCard
          :topic="sessionDetail.topic"
          :mastered-count="knowledgePoints.filter(kp => kp.status === 'mastered').length"
          :total-count="knowledgePoints.length"
          :duration="formatTime(durationSeconds)"
          :message-count="mainDialogueMessages.length"
          :wrapup="wrapup"
          :advisory="sessionDetail.advisory || null"
          :busy="completeTaskBusy"
          @action="handleAction"
          @advisory-action="handleAdvisoryAction"
        />

        <SessionFeedbackPanel
          v-if="canSubmitSessionFeedback"
          :session-id="sessionId"
          :task-id="taskId"
          @difficulty-change="subjectiveDifficulty = $event"
        />

        <section class="evaluation-transcript-card">
          <div class="evaluation-transcript-card__head">
            <div>
              <p class="evaluation-transcript-card__kicker">本次学习</p>
              <h2>当堂对话</h2>
            </div>
            <span class="evaluation-transcript-card__meta">{{ mainDialogueMessages.length }} 条消息</span>
          </div>

          <p class="evaluation-transcript-card__hint">回看本次学习中的对话内容。</p>

          <div v-if="mainDialogueMessages.length" class="evaluation-transcript-list">
            <article
              v-for="(message, index) in mainDialogueMessages"
              :key="`${message.timestamp || 'message'}-${index}`"
              class="evaluation-transcript-item"
              :class="`evaluation-transcript-item--${message.role}`"
            >
              <div class="evaluation-transcript-item__meta">
                <strong>{{ getMessageRoleLabel(message.role) }}</strong>
                <span v-if="message.timestamp">{{ formatMessageTime(message.timestamp) }}</span>
              </div>
              <div class="evaluation-transcript-item__body">
                <MarkdownRenderer :content="message.content" />
              </div>
            </article>
          </div>

          <div v-else class="evaluation-transcript-empty">
            暂无可回看的课堂对话。
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Loading } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
// html2canvas 体积大，仅导出图片时动态加载
import CompletionCard from '@/components/CompletionCard.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import SessionFeedbackPanel from '@/components/learning/SessionFeedbackPanel.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import '@/views/v2/v2.css';
import { aiTeachingAPI, type SessionDetail, type WrapupArtifact } from '@/api/aiTeaching';
import { toast } from '@/utils/toast';
import api from '@/utils/api';
import { isProjectionMode } from '@/utils/projection';

const route = useRoute();
const router = useRouter();

const taskId = computed(() => route.params.taskId as string);
const sessionId = computed(() => route.params.sessionId as string);

const learningPathDetailBasePath = computed(() => '/learning-path');
const learningPathsPath = computed(() => '/learning-paths');
const learnBasePath = computed(() => '/learn');

const loading = ref(true);
const error = ref('');
const sessionDetail = ref<SessionDetail | null>(null);
const pollTimer = ref<number | null>(null);
const reportRef = ref<HTMLElement | null>(null);
const exportingImage = ref(false);
const completeTaskBusy = ref(false);
const subjectiveDifficulty = ref<number | undefined>(undefined);
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;
let pollStartedAt = 0;
let pollHiddenAt = 0;
let pollingActive = false;
let componentUnmounted = false;

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
const evaluationDegraded = computed(() => {
  const currentWrapup = sessionDetail.value?.wrapup;
  return currentWrapup?.evaluationSource === 'failed'
    || currentWrapup?.sources?.evaluation === 'failed';
});
const canSubmitSessionFeedback = computed(() => !isProjectionMode());
const mainDialogueMessages = computed(() => (sessionDetail.value?.messages || []).filter((message) => message.role === 'user' || message.role === 'assistant'));
const durationSeconds = computed(() => {
  const minutes = sessionDetail.value?.wrapup?.duration ?? sessionDetail.value?.duration ?? 0;
  return typeof minutes === 'number' ? Math.max(0, Math.round(minutes * 60)) : 0;
});

const getMessageRoleLabel = (role: string) => (role === 'assistant' ? 'AI 导师' : '你');

const formatMessageTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const stopPolling = () => {
  if (pollTimer.value) {
    clearTimeout(pollTimer.value);
    pollTimer.value = null;
  }
  pollingActive = false;
};

const shouldContinuePolling = (detail: SessionDetail | null) => {
  if (!detail) return true;
  if (!detail.wrapup) return true;
  if (!detail.wrapup.summary?.topicSummary) return true;
  return false;
};

const schedulePoll = (delay = POLL_INTERVAL_MS) => {
  if (!pollingActive || componentUnmounted || document.hidden || pollTimer.value) return;
  pollTimer.value = window.setTimeout(() => {
    pollTimer.value = null;
    void pollEvaluation();
  }, delay);
};

const pollEvaluation = async () => {
  if (!pollingActive || componentUnmounted || document.hidden) return;
  if (Date.now() - pollStartedAt >= POLL_TIMEOUT_MS) {
    stopPolling();
    error.value = '评估生成超时，请稍后重试。';
    return;
  }

  try {
    const detail = await aiTeachingAPI.getSessionDetail(sessionId.value);
    if (componentUnmounted || !pollingActive) return;
    if (!detail) throw new Error('未找到该会话评估结果');
    sessionDetail.value = detail;
    if (shouldContinuePolling(detail)) {
      schedulePoll();
    } else {
      stopPolling();
    }
  } catch (err: any) {
    if (componentUnmounted) return;
    stopPolling();
    error.value = err?.message || '加载评估失败';
  }
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    if (pollingActive) {
      pollHiddenAt = Date.now();
      if (pollTimer.value) {
        clearTimeout(pollTimer.value);
        pollTimer.value = null;
      }
    }
    return;
  }

  if (pollingActive) {
    if (pollHiddenAt) pollStartedAt += Date.now() - pollHiddenAt;
    pollHiddenAt = 0;
    schedulePoll(0);
  }
};

const fetchEvaluation = async () => {
  stopPolling();
  loading.value = true;
  error.value = '';
  pollStartedAt = Date.now();
  pollHiddenAt = 0;
  try {
    const detail = await aiTeachingAPI.getSessionDetail(sessionId.value);
    if (componentUnmounted) return;
    sessionDetail.value = detail;
    if (!detail) {
      error.value = '未找到该会话评估结果';
      return;
    }

    if (shouldContinuePolling(detail)) {
      pollingActive = true;
      if (document.hidden) pollHiddenAt = Date.now();
      schedulePoll();
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
    if (completeTaskBusy.value) return;
    completeTaskBusy.value = true;
    try {
      const result = await aiTeachingAPI.finalizeSessionReliably(sessionId.value, {
        action: 'complete_task',
        revision: sessionDetail.value?.revision || 0,
        actualMinutes: Math.ceil(durationSeconds.value / 60),
        subjectiveDifficulty: subjectiveDifficulty.value
      });
      if (sessionDetail.value) sessionDetail.value.revision = result.revision;
      toast.success('已将本任务标记为完成');
      goBackToPath(true);
    } catch (err: any) {
      const recoveredRevision = err?.finalization?.revision;
      if (sessionDetail.value && Number.isInteger(recoveredRevision)) {
        sessionDetail.value.revision = recoveredRevision;
      }
      toast.error(err?.message || '标记任务完成失败');
    } finally {
      completeTaskBusy.value = false;
    }
    return;
  }

  goBackToPath();
};

const handleAdvisoryAction = async (action: string) => {
  const detail = sessionDetail.value;
  const advisory = detail?.advisory;
  if (!detail || !advisory?.shouldSuggest) return;

  if (action === 'keep') {
    toast.success('已保留当前学习计划');
    return;
  }
  if (action === 'later') {
    toast.info('已保留建议，你可以稍后再决定');
    return;
  }
  if (action === 'preview') {
    await ElMessageBox.alert(advisory.ui.body || advisory.rationale, advisory.ui.title || '调整建议', {
      confirmButtonText: '知道了'
    });
    return;
  }

  const resolvedAction = action === 'confirm' ? advisory.recommendation : action;
  if (!['reinforce', 'slow_down', 'resequence', 'accelerate'].includes(resolvedAction)) {
    toast.warning('当前建议不需要调整学习路径');
    return;
  }

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

    const reasonMap: Record<string, string> = {
      reinforce: '根据课后建议，为下一阶段补强关键薄弱点',
      resequence: '根据课后建议，调整下一阶段顺序以降低理解风险',
      accelerate: '根据课后建议，压缩下一阶段以加快推进',
      slow_down: '根据课后建议，放慢下一阶段节奏'
    };
    await api.post(`/learning/paths/${learningPathId}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'overwrite',
      reason: reasonMap[resolvedAction],
      evidence: {
        advisoryAction: resolvedAction,
        advisory,
        wrapup: detail.wrapup,
        taskId: taskId.value,
        taskTitle: detail.topic
      }
    });
    toast.success('已调整当前路径的后续阶段');
  } catch (err: any) {
    if (err !== 'cancel') toast.error(err?.message || '调整下一阶段失败');
  }
};

const formatTime = (seconds: number) => {
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 1) return '不足 1 分钟';
  if (totalMins < 60) return `${totalMins} 分钟`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
};

const getExportFilename = () => {
  const topic = sessionDetail.value?.topic || '学习评估';
  const date = new Date().toISOString().slice(0, 10);
  // 过滤文件名非法字符，避免下载失败
  const safeTopic = topic.replace(/[\\/:*?"<>|]/g, '_');
  return `${safeTopic}-${date}`;
};

const exportImage = async () => {
  if (!reportRef.value || exportingImage.value) return;
  exportingImage.value = true;
  try {
    const { default: html2canvas } = await import('html2canvas-pro');
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

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  void fetchEvaluation();
});
onUnmounted(() => {
  componentUnmounted = true;
  stopPolling();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped>
.evaluation-page {
  min-height: 100vh;
  background: #f3f6fb;
  padding: 28px 0 64px;
}

.evaluation-shell {
  width: calc(100% - 64px);
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  gap: 20px;
}

/* 入场编排：数据就绪后各块依次上浮出现 */
@media (prefers-reduced-motion: no-preference) {
  .evaluation-head,
  .evaluation-degraded,
  .evaluation-shell .completion-card,
  .evaluation-shell .session-feedback,
  .evaluation-transcript-card {
    animation: eval-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .evaluation-degraded { animation-delay: 0.06s; }
  .evaluation-shell .completion-card { animation-delay: 0.1s; }
  .evaluation-shell .session-feedback { animation-delay: 0.2s; }
  .evaluation-transcript-card { animation-delay: 0.28s; }
}
@keyframes eval-rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.evaluation-degraded {
  padding: 14px 18px;
  border: 1px solid var(--color-warning-border, rgba(244, 170, 70, 0.24));
  border-left: 4px solid var(--color-warning, #f4aa46);
  border-radius: 12px;
  background: var(--color-warning-bg, rgba(244, 170, 70, 0.08));
  color: var(--text-primary, #172033);
}

.evaluation-degraded strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.evaluation-degraded p {
  margin: 0;
  color: var(--text-secondary, #607086);
  font-size: 13px;
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
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--blue-deep, #1f57cc);
}

.evaluation-head__ai-note {
  margin-top: 6px;
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

.evaluation-transcript-card {
  padding: 24px 28px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  display: grid;
  gap: 18px;
}

.evaluation-transcript-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.evaluation-transcript-card__kicker {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep, #1f57cc);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.evaluation-transcript-card__head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #172033;
}

.evaluation-transcript-card__meta {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: #f3f6fb;
  color: #57657a;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.evaluation-transcript-card__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #7a8599;
}

.evaluation-transcript-list {
  display: grid;
  gap: 14px;
}

.evaluation-transcript-item {
  max-width: min(100%, 860px);
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 10px;
}

.evaluation-transcript-item--assistant {
  justify-self: start;
  background: #f8fafc;
}

.evaluation-transcript-item--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent, #3478f6) 8%, white);
  border-color: rgba(52, 120, 246, 0.12);
}

.evaluation-transcript-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.evaluation-transcript-item__meta strong {
  font-size: 13px;
  font-weight: 700;
  color: #172033;
}

.evaluation-transcript-item__meta span {
  font-size: 12px;
  color: #7a8599;
}

.evaluation-transcript-item__body {
  font-size: 14px;
  line-height: 1.8;
  color: #3d4a5c;
}

.evaluation-transcript-empty {
  padding: 20px;
  border-radius: 12px;
  background: #f8fafc;
  color: #7a8599;
  font-size: 14px;
  text-align: center;
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

  .evaluation-transcript-card {
    padding: 22px 20px;
  }

  .evaluation-transcript-card__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .evaluation-head__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    width: 100%;
  }

  .evaluation-head__actions :deep(.el-button) {
    flex: 1 1 calc(50% - 10px);
    margin-left: 0;
  }

  .evaluation-shell :deep(.completion-summary) {
    grid-template-columns: repeat(2, 1fr);
  }

  .evaluation-shell :deep(.metrics-grid--three) {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .evaluation-head__actions :deep(.el-button) {
    flex-basis: 100%;
    width: 100%;
  }

  .evaluation-transcript-item {
    max-width: 100%;
    padding: 14px 14px;
  }

  .evaluation-transcript-item__meta {
    flex-direction: column;
    align-items: flex-start;
  }

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
