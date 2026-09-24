<template>
  <div class="evaluation-page v2-page">
    <div class="evaluation-shell" ref="reportRef" :class="{ 'is-exporting': exportingImage }">
      <header class="evaluation-head">
        <div>
          <h1>当前任务学习反馈</h1>
          <AiContentNote class="evaluation-head__ai-note" />
        </div>
        <div class="evaluation-head__actions">
          <button type="button" class="btn-ghost" :disabled="exportingImage" @click="exportImage">{{ exportingImage ? '导出中…' : '导出图片' }}</button>
          <button type="button" class="btn-ghost" @click="exportPdf">打印或另存为 PDF</button>
          <button type="button" class="btn-primary" @click="() => goBackToPath()">返回学习路径</button>
        </div>
      </header>

      <section v-if="loading" class="evaluation-loading">
        <div class="evaluation-loading__inner">
          <div class="evaluation-loading__head">
            <span class="sk-bar" style="width: 32%"></span>
            <span class="sk-bar sk-bar--btn"></span>
            <span class="sk-bar sk-bar--btn"></span>
          </div>
          <div class="evaluation-loading__summary">
            <i v-for="n in 4" :key="n"></i>
          </div>
          <div class="evaluation-loading__card">
            <span class="sk-bar" style="width: 26%"></span>
            <i v-for="n in 3" :key="'a' + n"></i>
          </div>
          <div class="evaluation-loading__card">
            <span class="sk-bar" style="width: 18%"></span>
            <i v-for="n in 3" :key="'b' + n"></i>
          </div>
          <p class="evaluation-loading__text">
            <span class="evaluation-spinner" aria-hidden="true"></span>
            正在整理本次学习反馈，请稍候…
          </p>
        </div>
      </section>

      <section v-else-if="error" class="evaluation-error">
        <p>{{ error }}</p>
        <div class="evaluation-error__actions">
          <button type="button" class="btn-primary" @click="fetchEvaluation">重试</button>
          <button type="button" class="btn-ghost" @click="() => goBackToPath()">返回学习路径</button>
        </div>
      </section>

      <template v-else-if="sessionDetail">
        <section v-if="evaluationDegraded" class="evaluation-degraded" role="status">
          <strong v-if="!sessionDetail?.wrapup">本次会话未正常结束，未生成课堂总结</strong>
          <strong v-else-if="isTimeoutFallback">本次会话未正常结束，已为你保留基础学习记录</strong>
          <strong v-else>课堂总结已生成，详细表现分析暂不可用</strong>
          <p>不影响你保存进度、完成任务或查看本次对话。</p>
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
            <button
              v-if="hiddenTranscriptCount > 0"
              type="button"
              class="evaluation-transcript-toggle"
              :aria-expanded="transcriptExpanded"
              @click="transcriptExpanded = !transcriptExpanded"
            >
              <span>{{ transcriptToggleLabel }}</span>
              <span
                class="evaluation-transcript-toggle__caret"
                :class="{ 'is-open': transcriptExpanded }"
                aria-hidden="true"
              ></span>
            </button>
            <article
              v-for="(message, index) in visibleTranscriptMessages"
              :key="`${message.timestamp || 'message'}-${index}`"
              class="evaluation-transcript-item"
              :class="`evaluation-transcript-item--${message.role}`"
              :style="{ animationDelay: Math.min(index * 40, 500) + 'ms' }"
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
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
// html2canvas 体积大，仅导出图片时动态加载
import CompletionCard from '@/components/CompletionCard.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import SessionFeedbackPanel from '@/components/learning/SessionFeedbackPanel.vue';
import AiContentNote from '@/components/AiContentNote.vue';
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
      topicSummary: '本次会话未正常结束，没有生成学习总结。',
      knowledgeSummary: '未生成知识点评估。',
      practiceAdvice: '完成一次完整的课堂学习后，这里会给出下一步建议。',
      learningEvaluation: '未生成学习评价。',
      knowledgeItems: [],
      keyTakeaways: [],
      actionPlan: [],
      evaluationHighlights: null,
      metricInterpretation: {
        session: '未生成本节课堂表现。',
        longTerm: '未生成长期状态评估。'
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
  if (!currentWrapup) return true;
  return currentWrapup?.evaluationSource === 'failed'
    || currentWrapup?.evaluationSource === 'unavailable'
    || currentWrapup?.sources?.evaluation === 'failed'
    || currentWrapup?.sources?.evaluation === 'unavailable';
});
const isTimeoutFallback = computed(() => sessionDetail.value?.wrapup?.sources?.summary === 'timeout-fallback');
const canSubmitSessionFeedback = computed(() => !isProjectionMode());
const mainDialogueMessages = computed(() => (sessionDetail.value?.messages || []).filter((message) => message.role === 'user' || message.role === 'assistant'));

/* 当堂对话默认只回看最近两条：长会话（5 条消息里两三条是几百字讲解）在手机上能占好几屏，
   而这一块是"回看"而非必读。导出图片/打印前会临时全展开，避免导出的报告缺内容。 */
const TRANSCRIPT_PREVIEW_COUNT = 2;
const transcriptExpanded = ref(false);
const hiddenTranscriptCount = computed(() => Math.max(mainDialogueMessages.value.length - TRANSCRIPT_PREVIEW_COUNT, 0));
const visibleTranscriptMessages = computed(() => (
  transcriptExpanded.value
    ? mainDialogueMessages.value
    : mainDialogueMessages.value.slice(-TRANSCRIPT_PREVIEW_COUNT)
));
const transcriptToggleLabel = computed(() => (
  transcriptExpanded.value ? '收起对话' : `展开更早的 ${hiddenTranscriptCount.value} 条消息`
));
/** 导出前展开全部对话（返回是否临时展开，便于导出后恢复用户原本的折叠状态） */
const expandTranscriptForExport = async () => {
  if (!hiddenTranscriptCount.value || transcriptExpanded.value) return false;
  transcriptExpanded.value = true;
  await nextTick();
  return true;
};

/* 会话活跃时长（分钟）：wrapup 缺省时用消息时间戳估算，间隔 > 30 分钟视为暂停 */
const activeDurationMinutes = computed(() => {
  const minutes = sessionDetail.value?.wrapup?.duration ?? sessionDetail.value?.duration;
  if (typeof minutes === 'number' && minutes > 0) return minutes;
  const times = mainDialogueMessages.value
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return 0;
  let active = 0;
  for (let i = 1; i < times.length; i++) {
    active += Math.min((times[i] - times[i - 1]) / 60000, 30);
  }
  return Math.max(0, Math.round(active));
});

const durationSeconds = computed(() => Math.max(0, Math.round(activeDurationMinutes.value * 60)));

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
  // 终态/不可恢复状态：停止轮询，展示明确状态（不再空等 60s）
  if (['failed', 'discarded', 'superseded'].includes(detail.status)) {
    stopPolling();
    error.value = '课堂未能正常完成，暂无可展示的学习反馈。';
    return false;
  }
  if (detail.status === 'finalization_failed') {
    stopPolling();
    error.value = '课堂结算未完成，可稍后重新进入查看。';
    return false;
  }
  if (['active', 'paused', 'initializing'].includes(detail.status)) {
    stopPolling();
    error.value = '课堂还在进行中，结束后才会生成学习反馈。';
    return false;
  }
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
    // 网络类错误跳过本轮继续轮询（会话可能仍在后台结算），仅超时才终止
    const status = (err as any)?.status;
    if (status === 404 || status === 500 || status === 401) {
      stopPolling();
      error.value = err?.message || '加载评估失败';
      return;
    }
    schedulePoll();
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
    await askConfirm({
      title: advisory.ui.title || '调整建议',
      message: advisory.ui.body || advisory.rationale,
      confirmText: '知道了',
      danger: false,
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

  const ok = await askConfirm({
    title: '调整当前路径',
    message: '这会基于当前学习证据调整当前路径的后续阶段，已完成任务会保留不变。是否继续？',
    confirmText: '确认调整当前路径',
    danger: false,
  });
  if (!ok) return;

  try {
    const reasonMap: Record<string, string> = {
      reinforce: '根据课后建议，为下一阶段补强关键薄弱点',
      resequence: '根据课后建议，调整下一阶段顺序以降低理解风险',
      accelerate: '根据课后建议，压缩下一阶段以加快推进',
      slow_down: '根据课后建议，放慢下一阶段节奏'
    };
    const res = await api.post(`/learning/paths/${learningPathId}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'overwrite',
      reason: reasonMap[resolvedAction],
      // 用户已在本弹窗二次确认：跳过 awaiting-confirmation，直接执行重设计
      requireConfirmation: false,
      evidence: {
        advisoryAction: resolvedAction,
        advisory,
        wrapup: detail.wrapup,
        taskId: taskId.value,
        taskTitle: detail.topic
      }
    });
    const replanRes = (res as any)?.data || res;
    if (replanRes?.status === 'awaiting-confirmation' || replanRes?.enabled === false) {
      toast.warning('调整方案已生成，需在路径页确认后生效');
    } else {
      toast.success('已调整当前路径的后续阶段');
    }
  } catch (err: any) {
    toast.error(err?.message || '调整下一阶段失败');
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
  const collapsedForExport = await expandTranscriptForExport();
  try {
    const { default: html2canvas } = await import('html2canvas-pro');
    const canvas = await html2canvas(reportRef.value, {
      scale: 2,
      useCORS: true,
      // 取当前主题画布色（暗色下导出也跟随暗色）
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#f3f6fb',
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
    if (collapsedForExport) transcriptExpanded.value = false;
  }
};

const exportPdf = async () => {
  const collapsedForExport = await expandTranscriptForExport();
  window.print();
  if (collapsedForExport) transcriptExpanded.value = false;
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
  background: var(--canvas);
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
  /* 对话转录：逐条上浮（动画延迟由行内 style 提供，最多 500ms） */
  .evaluation-transcript-item {
    animation: eval-rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
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
  border: 1px solid var(--line, rgba(23, 32, 51, 0.06));
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
}

.evaluation-head__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.evaluation-head__ai-note {
  margin-top: 6px;
}

.evaluation-head h1 {
  margin: 0;
  font-size: clamp(22px, 2.8vw, 32px);
  font-weight: 700;
  color: var(--ink, #172033);
  letter-spacing: -0.02em;
}

.evaluation-loading,
.evaluation-error {
  padding: 60px 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  display: grid;
  justify-items: center;
  gap: 12px;
  font-size: 15px;
  color: var(--muted, #7a8599);
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

/* 加载骨架：仿报告版式（头部 + 指标卡 + 内容卡），避免加载期白板 */
.evaluation-loading__inner { width: 100%; display: grid; gap: 14px; justify-items: stretch; }
.evaluation-loading__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.evaluation-loading__summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.evaluation-loading__card { display: grid; gap: 8px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: color-mix(in srgb, var(--surface) 70%, var(--canvas)); }
.evaluation-loading__text { display: inline-flex; align-items: center; gap: 8px; justify-content: center; margin: 4px 0 0; }
/* 加载 spinner（替代 el-icon Loading，统一 v2 风格） */
.evaluation-spinner {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(52, 120, 246, 0.2);
  border-top-color: var(--blue, #3478f6);
  animation: evaluation-spin 0.8s linear infinite;
  flex: none;
}
@keyframes evaluation-spin {
  to { transform: rotate(360deg); }
}
.evaluation-loading .sk-bar,
.evaluation-loading__summary i,
.evaluation-loading__card i {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--surface) 60%, var(--canvas)) 25%, var(--surface) 50%, color-mix(in srgb, var(--surface) 60%, var(--canvas)) 75%);
  background-size: 200% 100%;
  animation: eval-shimmer 1.4s ease infinite;
}
.evaluation-loading .sk-bar { display: block; height: 14px; }
.evaluation-loading__head .sk-bar--btn { width: 84px; height: 34px; border-radius: 10px; }
.evaluation-loading__summary i { height: 64px; border-radius: 12px; }
@keyframes eval-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 640px) {
  .evaluation-loading__summary { grid-template-columns: repeat(2, 1fr); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ---- report-mode overrides for CompletionCard ---- */
.evaluation-shell :deep(.completion-card) {
  margin-top: 0;
  padding: 28px 32px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.04);
  background-image: none;
}

.evaluation-shell :deep(.completion-header) {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.evaluation-shell :deep(.completion-title) {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink, #172033);
}

.evaluation-shell :deep(.completion-summary) {
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 16px 20px;
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
  border-radius: 12px;
  margin-bottom: 20px;
}

.evaluation-shell :deep(.summary-label) {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #7a8599);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.evaluation-shell :deep(.summary-value) {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink, #172033);
}

.evaluation-shell :deep(.completion-section) {
  padding: 18px 20px;
  background: var(--surface);
  border: 1px solid var(--line, rgba(23, 32, 51, 0.06));
  border-radius: 12px;
  margin-bottom: 14px;
}

.evaluation-shell :deep(.section-title) {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink, #172033);
  margin-bottom: 12px;
}

.evaluation-shell :deep(.section-content) {
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted, #3d4a5c);
}

.evaluation-shell :deep(.section-hint) {
  font-size: 13px;
  color: var(--muted, #7a8599);
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
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
}

.evaluation-shell :deep(.metric-label) {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #7a8599);
}

.evaluation-shell :deep(.metric-badge) {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
}

.evaluation-shell :deep(.metric-card--good .metric-badge) {
  background: rgba(49, 177, 111, 0.1);
  color: var(--green, #1a7a42);
}

.evaluation-shell :deep(.metric-card--normal .metric-badge) {
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep, #1f57cc);
}

.evaluation-shell :deep(.metric-card--warn .metric-badge) {
  background: rgba(232, 100, 80, 0.08);
  color: var(--red, #b44020);
}

.evaluation-shell :deep(.metric-value) {
  font-size: 26px;
  font-weight: 800;
  color: var(--ink, #172033);
  margin-top: 8px;
}

.evaluation-shell :deep(.metric-desc) {
  font-size: 12px;
  color: var(--muted, #7a8599);
  line-height: 1.5;
  margin-top: 6px;
}

.evaluation-shell :deep(.knowledge-list) {
  gap: 10px;
}

.evaluation-shell :deep(.knowledge-item) {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
}

.evaluation-shell :deep(.knowledge-name) {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink, #172033);
}

.evaluation-shell :deep(.knowledge-evidence) {
  font-size: 13px;
  color: var(--muted, #7a8599);
  line-height: 1.6;
}

.evaluation-shell :deep(.ordered-list) {
  font-size: 14px;
  line-height: 1.75;
  color: var(--muted, #3d4a5c);
}

.evaluation-shell :deep(.evaluation-line) {
  font-size: 14px;
  line-height: 1.75;
  color: var(--muted, #3d4a5c);
}

.evaluation-shell :deep(.advisory-section) {
  border-radius: 12px;
}

.evaluation-shell :deep(.completion-actions) {
  padding-top: 16px;
  border-top: 1px solid var(--line);
  margin-top: 8px;
  gap: 10px;
}

.evaluation-transcript-card {
  padding: 24px 28px;
  border: 1px solid var(--line, rgba(23, 32, 51, 0.06));
  border-radius: 16px;
  background: var(--surface);
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
  color: var(--blue-deep, #1f57cc);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.evaluation-transcript-card__head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ink, #172033);
}

.evaluation-transcript-card__meta {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
  color: var(--muted, #57657a);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.evaluation-transcript-card__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted, #7a8599);
}

.evaluation-transcript-list {
  display: grid;
  gap: 14px;
}

/* 折叠开关：默认只回看最近两条消息（长讲解在手机上占好几屏）。选择器带上卡片类是因为
   v2 的按钮 reset（.v2-page button:where(...)，权重 0-1-1）比单类选择器更高 */
.evaluation-transcript-card .evaluation-transcript-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
  color: var(--blue-deep, #1f57cc);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.evaluation-transcript-card .evaluation-transcript-toggle:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
}

.evaluation-transcript-toggle__caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform 180ms ease;
}

.evaluation-transcript-toggle__caret.is-open {
  transform: rotate(180deg);
}

/* 导出图片时隐藏开关：报告成品里不该出现交互控件（打印同理，见 @media print） */
.evaluation-shell.is-exporting .evaluation-transcript-toggle {
  display: none;
}

.evaluation-transcript-item {
  max-width: min(100%, 860px);
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--line);
  display: grid;
  gap: 10px;
}

.evaluation-transcript-item--assistant {
  justify-self: start;
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
}

.evaluation-transcript-item--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent, #3478f6) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--blue, #3478f6) 22%, transparent);
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
  color: var(--ink, #172033);
}

.evaluation-transcript-item__meta span {
  font-size: 12px;
  color: var(--muted, #7a8599);
}

.evaluation-transcript-item__body {
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted, #3d4a5c);
}

.evaluation-transcript-empty {
  padding: 20px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
  color: var(--muted, #7a8599);
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

  /* 移动端头部瘦身：390 下原本 213px（标题 59 + 动作 96 + 内边距 40），压到约 150px。
     动作按钮是一方 .btn-ghost/.btn-primary（旧 :deep(.el-button) 覆写已随 EP 移除一并删掉，
     它本来就不匹配任何元素——按钮此前一直是 41px 高、字号 14px 的自适应换行版）。 */
  .evaluation-page {
    padding: 14px 0 40px;
  }

  .evaluation-head {
    padding: 12px 16px;
    gap: 10px;
    border-radius: 14px;
  }

  .evaluation-head h1 {
    font-size: 19px;
    line-height: 1.25;
  }

  .evaluation-head__ai-note {
    margin-top: 3px;
  }

  .evaluation-head__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
  }

  /* 两枚次级按钮同行并分（窄到放不下才整体换行），主按钮整行；nowrap 让放不下的按钮
     整体换行，而不是把「打印或另存为 PDF」压进 32px 高度里折行溢出。
     flex-basis 用 auto 而非 50%：百分比基值在 320 下取整后正好卡满一行，反而把它们挤成两行 */
  .evaluation-head__actions :deep(.btn-ghost),
  .evaluation-head__actions :deep(.btn-primary) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    height: 32px;
    padding: 0 12px;
    font-size: 12.5px;
    white-space: nowrap;
  }

  .evaluation-head__actions :deep(.btn-primary) {
    flex-basis: 100%;
  }

  .evaluation-shell :deep(.completion-summary) {
    grid-template-columns: repeat(2, 1fr);
  }

  .evaluation-shell :deep(.metrics-grid--three) {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
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
    background: var(--surface);
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

  .evaluation-transcript-card .evaluation-transcript-toggle {
    display: none;
  }
}

/* ---- 暗色模式：浅色投影在深底上不可见，改用深色投影（对齐 v2.css .card） ---- */
[data-theme='dark'] .evaluation-head,
[data-theme='dark'] .evaluation-transcript-card,
[data-theme='dark'] .evaluation-shell :deep(.completion-card) {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 10px 28px rgba(0, 0, 0, 0.25);
}
</style>

<style scoped>
/* 移动端信息密度：390 下整页 7293px（≈8.6 屏）。报告页在手机上主要是"扫"而不是"读"，
   所以压的是留白、行高和"一行一个字段"的排布，正文不再低于 12.5px、可点区域不再低于 32px。

   放在文件末尾是必需的：≤900 / ≤640 两个媒体块在文件中间，同权重下后出现者胜，
   密度规则写在那两个块里会被它们自己的 padding/字号覆写吃掉（学习页/详情页已踩过两次）。 */
@media (max-width: 900px) {
  .evaluation-shell {
    gap: 14px;
  }

  /* ---- 报告卡 ---- */
  .evaluation-shell :deep(.completion-card) {
    padding: 14px 12px;
  }

  .evaluation-shell :deep(.completion-header) {
    margin-bottom: 12px;
    padding-bottom: 10px;
  }

  .evaluation-shell :deep(.completion-title) {
    font-size: 17px;
  }

  .evaluation-shell :deep(.completion-header .completion-icon--header) {
    width: 20px;
    height: 20px;
    font-size: 20px;
  }

  /* 概要：桌面是 4 列卡片，窄屏堆成 4 行时每行只有"标签一行 + 值一行"（266px）。
     改成标签/值同行的清单，标签定宽 58px 对齐成两栏 → 4 行 ≈128px */
  .evaluation-shell :deep(.completion-summary) {
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
    padding: 11px 12px;
    margin-bottom: 12px;
  }

  .evaluation-shell :deep(.summary-item) {
    flex-direction: row;
    align-items: baseline;
    gap: 10px;
  }

  .evaluation-shell :deep(.summary-label) {
    flex: 0 0 58px;
    margin-bottom: 0;
  }

  .evaluation-shell :deep(.summary-value) {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
  }

  .evaluation-shell :deep(.completion-section) {
    padding: 12px 14px;
    margin-bottom: 10px;
  }

  .evaluation-shell :deep(.section-title) {
    margin-bottom: 8px;
    font-size: 14px;
  }

  .evaluation-shell :deep(.section-content) {
    font-size: 13px;
    line-height: 1.65;
  }

  .evaluation-shell :deep(.section-hint),
  .evaluation-shell :deep(.section-attribution) {
    font-size: 12.5px;
    line-height: 1.55;
  }

  /* 指标卡：堆成 1 列后每张 ~150px（标签、值、说明各占一行）。改成"标签+值同行、
     说明独占一行"的紧凑行（~62px），数值靠右对齐，扫的时候一眼落在数字上 */
  .evaluation-shell :deep(.metrics-grid),
  .evaluation-shell :deep(.metrics-grid--three) {
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
  }

  .evaluation-shell :deep(.metric-card) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 10px;
    row-gap: 2px;
    padding: 8px 12px;
  }

  .evaluation-shell :deep(.metric-head) {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: flex-start;
    gap: 8px;
  }

  .evaluation-shell :deep(.metric-value) {
    flex: 0 0 auto;
    margin-top: 0;
    font-size: 20px;
    line-height: 1.15;
  }

  .evaluation-shell :deep(.metric-desc) {
    flex: 1 1 100%;
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .evaluation-shell :deep(.metric-badge) {
    padding: 2px 8px;
  }

  .evaluation-shell :deep(.knowledge-list) {
    gap: 8px;
  }

  .evaluation-shell :deep(.knowledge-item) {
    padding: 8px 10px;
  }

  .evaluation-shell :deep(.knowledge-evidence) {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.45;
  }

  .evaluation-shell :deep(.ordered-list),
  .evaluation-shell :deep(.evaluation-line) {
    font-size: 12.5px;
    line-height: 1.55;
  }

  .evaluation-shell :deep(.ordered-list li) {
    margin-bottom: 4px;
  }

  /* 建议确认：三个决策按钮由"竖排三行"改两列网格 + 主按钮整行（省一行 ≈42px），
     高度仍是 34px 的触达尺寸 */
  .evaluation-shell :deep(.advisory-options) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 8px;
  }

  .evaluation-shell :deep(.advisory-options .completion-btn) {
    width: 100%;
    margin-left: 0;
  }

  .evaluation-shell :deep(.advisory-options .completion-btn--primary) {
    grid-column: 1 / -1;
  }

  .evaluation-shell :deep(.completion-actions) {
    gap: 8px;
  }

  /* ---- 当堂对话：长文正文 14px/1.8 是这一块的主要开销，行高压到 1.65 ---- */
  .evaluation-transcript-card {
    padding: 14px 12px;
    gap: 12px;
  }

  .evaluation-transcript-card__kicker {
    margin-bottom: 2px;
  }

  .evaluation-transcript-card__head h2 {
    font-size: 18px;
  }

  .evaluation-transcript-card__meta {
    min-height: 26px;
    padding: 0 10px;
  }

  .evaluation-transcript-card__hint {
    font-size: 12.5px;
    line-height: 1.5;
  }

  .evaluation-transcript-list {
    gap: 10px;
  }

  .evaluation-transcript-item {
    max-width: 100%;
    padding: 10px 12px;
    gap: 6px;
    border-radius: 12px;
  }

  /* 说话人 + 时间在 390/320 下都放得下一行（≤640 的竖排是白占一行 × 每条消息） */
  .evaluation-transcript-item__meta {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .evaluation-transcript-item__meta strong {
    font-size: 12.5px;
  }

  .evaluation-transcript-item__body {
    font-size: 13.5px;
    line-height: 1.65;
  }

  /* 正文实际字号由 MarkdownRenderer 自带样式决定（16px/1.8，外层 13.5px 被它盖住），
     长讲解按 12.5px/1.6 排：一屏多读 4–5 行，且不触碰 12.5px 的下限 */
  .evaluation-transcript-card .evaluation-transcript-item__body :deep(.markdown-renderer) {
    font-size: 12.5px;
    line-height: 1.6;
  }

  .evaluation-transcript-item__meta strong {
    font-size: 12px;
  }

  .evaluation-transcript-item__meta span {
    font-size: 12px;
  }

  .evaluation-transcript-card .evaluation-transcript-toggle {
    min-height: 32px;
    font-size: 12px;
  }

  /* 卡片头改回一行（标题左、条数右）：≤900 的竖排白占 26px，390/320 都放得下 */
  .evaluation-transcript-card__head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  /* 加载/错误/空态：桌面 60px 上下留白（本层此前没覆盖到），移动端收到 32（基线 ≤32）；
     .spin 36→28 与 .evaluation-transcript-empty 20→14 同理。 */
  .evaluation-loading,
  .evaluation-error {
    padding: 32px 16px;
  }
  .spin { font-size: 28px; }
  .evaluation-transcript-empty { padding: 14px; }
}
</style>
