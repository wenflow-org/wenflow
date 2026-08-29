<template>
  <div class="completion-card">
    <div class="completion-header">
      <el-icon :size="24" color="var(--green, #2e7d32)"><CircleCheckFilled /></el-icon>
      <h3 class="completion-title">本次学习已结束</h3>
    </div>

    <div class="completion-body">
      <div v-if="advisory?.shouldSuggest" class="completion-section advisory-section" :class="`advisory-section--${advisory.priority}`">
        <h4 class="section-title"><el-icon><MagicStick /></el-icon>{{ advisory.ui.title }}</h4>
        <p class="section-content">{{ advisory.ui.body }}</p>
        <p class="section-hint">确认后会调整后续学习安排，已完成的内容不会改变。</p>
        <div class="advisory-options">
          <el-button
            v-for="option in advisory.ui.options"
            :key="option.key"
            size="small"
            :type="isAdjustmentAction(option.key) ? 'primary' : 'default'"
            plain
            :disabled="busy"
            @click="emit('advisory-action', option.key)"
          >
            {{ option.label }}
          </el-button>
        </div>
      </div>

      <div class="completion-summary">
        <div class="summary-item"><span class="summary-label">主题</span><span class="summary-value">{{ topic }}</span></div>
        <div class="summary-item"><span class="summary-label">知识点</span><span class="summary-value">{{ summaryCounters.display.mastered ?? masteredCount }}/{{ totalCount }} 已学会</span></div>
        <div class="summary-item"><span class="summary-label">用时</span><span class="summary-value">{{ duration }}</span></div>
        <div class="summary-item"><span class="summary-label">学习消息</span><span class="summary-value">{{ summaryCounters.display.messages ?? messageCount }} 条</span></div>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><Document /></el-icon>主题总结</h4>
        <p class="section-content">{{ summary.topicSummary }}</p>
      </div>

      <div v-if="progressHighlights.length" class="completion-section">
        <h4 class="section-title"><el-icon><Opportunity /></el-icon>本节进展</h4>
        <ul class="knowledge-list">
          <li v-for="item in progressHighlights" :key="item.title" class="knowledge-item">
            <div class="knowledge-head">
              <span class="knowledge-name">{{ item.title }}</span>
              <el-tag size="small" :type="item.type">{{ item.label }}</el-tag>
              <router-link
                v-if="item.type === 'danger' && taskId"
                :to="`/learn/${taskId}?mode=review`"
                class="review-link"
              >去复习 →</router-link>
            </div>
            <p class="knowledge-evidence">{{ item.text }}</p>
          </li>
        </ul>
      </div>

      <div v-if="evaluation" class="completion-section">
        <h4 class="section-title"><el-icon><DataAnalysis /></el-icon>本节表现</h4>
        <p class="section-hint">{{ sessionInterpretation }}</p>
        <div class="metrics-grid metrics-grid--three">
          <div v-for="item in sessionMetricCards" :key="item.key" class="metric-card" :class="`metric-card--${item.tone}`">
            <div class="metric-head"><span class="metric-label">{{ item.label }}</span><span class="metric-badge">{{ item.level }}</span></div>
            <div class="metric-value">{{ sessionCounters.display[item.key] ?? item.value }}</div>
            <p class="metric-desc">{{ item.desc }}</p>
          </div>
        </div>
      </div>

      <div v-if="evaluation" class="completion-section">
        <h4 class="section-title"><el-icon><TrendCharts /></el-icon>长期状态四维</h4>
        <p class="section-hint">{{ longTermInterpretation }}</p>
        <div class="metrics-grid">
          <div v-for="item in longTermMetricCards" :key="item.key" class="metric-card" :class="`metric-card--${item.tone}`">
            <div class="metric-head"><span class="metric-label">{{ item.label }}</span><span class="metric-badge">{{ item.level }}</span></div>
            <div class="metric-value">{{ longTermCounters.display[item.key] ?? item.value }}</div>
            <p class="metric-desc">{{ item.desc }}</p>
          </div>
        </div>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><Collection /></el-icon>知识点掌握</h4>
        <ul v-if="knowledgeItems.length" class="knowledge-list">
          <li v-for="item in knowledgeItems" :key="item.name" class="knowledge-item">
            <div class="knowledge-head">
              <span class="knowledge-name">{{ item.name }}</span>
              <el-tag size="small" :type="getKnowledgeTagType(item.status)">{{ getKnowledgeStatusLabel(item.status) }}</el-tag>
            </div>
            <p class="knowledge-evidence">{{ item.evidence }}</p>
          </li>
        </ul>
        <p v-else class="section-content">{{ summary.knowledgeSummary }}</p>
      </div>

      <div v-if="keyTakeaways.length" class="completion-section">
        <h4 class="section-title"><el-icon><Collection /></el-icon>关键收获</h4>
        <ol class="ordered-list"><li v-for="(item, idx) in keyTakeaways" :key="`${idx}-${item}`">{{ item }}</li></ol>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><Compass /></el-icon>下一步建议</h4>
        <ol v-if="actionPlan.length" class="ordered-list"><li v-for="(item, idx) in actionPlan" :key="`${idx}-${item}`">{{ item }}</li></ol>
        <div v-else class="section-content"><MarkdownRenderer :content="summary.practiceAdvice" /></div>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><TrendCharts /></el-icon>学习评价</h4>
        <div v-if="hasHighlights" class="evaluation-block">
          <p v-if="formattedStrengths" class="evaluation-line"><strong>亮点：</strong>{{ formattedStrengths }}</p>
          <p v-if="formattedImprovements" class="evaluation-line"><strong>改进：</strong>{{ formattedImprovements }}</p>
        </div>
        <p v-else class="section-content">{{ summary.learningEvaluation }}</p>
      </div>
    </div>

    <div class="completion-actions">
      <el-button :disabled="busy" @click="emit('action', 'continue-task')">继续练习</el-button>
      <el-button :disabled="busy" @click="emit('action', 'end')"><el-icon><VideoPause /></el-icon>返回学习路径</el-button>
      <el-button type="primary" :loading="busy" @click="emit('action', 'complete-task')">完成任务</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import { CircleCheckFilled, VideoPause, Compass, Document, Collection, TrendCharts, DataAnalysis, MagicStick, Opportunity } from '@element-plus/icons-vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import type { ReplanAdvisory, WrapupArtifact } from '@/api/aiTeaching';

const props = defineProps<{
  topic: string;
  masteredCount: number;
  totalCount: number;
  duration: string;
  messageCount: number;
  wrapup: WrapupArtifact;
  advisory?: ReplanAdvisory | null;
  busy?: boolean;
  taskId?: string;
}>();

const emit = defineEmits<{ action: [action: 'end' | 'continue-task' | 'complete-task']; 'advisory-action': [action: string] }>();

const summary = computed(() => props.wrapup.summary);
const evaluation = computed(() => props.wrapup.evaluation);
const stateUpdate = computed(() => props.wrapup.stateUpdate || null);
const advisory = computed(() => props.advisory || null);
const busy = computed(() => props.busy === true);
const isAdjustmentAction = (action: string) => ['confirm', 'reinforce', 'slow_down', 'resequence', 'accelerate'].includes(action);

const toFixed = (v: number | undefined) => Number(v || 0).toFixed(1);
const getSimpleLevel = (v: number, h: number, m: number) => (v >= h ? { level: '高', tone: 'good' } : v >= m ? { level: '中', tone: 'normal' } : { level: '低', tone: 'warn' });
const getStress = (v: number) => (v >= 70 ? { level: '高', tone: 'warn' } : v >= 40 ? { level: '中', tone: 'normal' } : { level: '低', tone: 'good' });
const getBalance = (v: number) => (v >= 1 ? { level: '平衡', tone: 'good' } : v >= -2 ? { level: '轻微失衡', tone: 'normal' } : { level: '失衡', tone: 'warn' });

/* 数字计数动画：0 → 终值（rAF，reduced-motion 直接终值） */
const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUpMap(source: () => Record<string, number>, durationMs = 800): { display: Record<string, string> } {
  const display = reactive<Record<string, string>>({});
  let raf = 0;
  const render = () => {
    const targets = source();
    if (prefersReducedMotion) {
      Object.assign(display, Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, String(v)])));
      return;
    }
    const start = performance.now();
    const fromMap = { ...display };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(targets)) {
        const from = Number(fromMap[k]) || 0;
        next[k] = String(Math.round(from + (v - from) * eased));
      }
      Object.assign(display, next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  };
  onMounted(() => {
    render();
    if (!prefersReducedMotion) {
      watch(source, () => {
        if (document.visibilityState === 'visible') render();
      });
    }
  });
  onUnmounted(() => cancelAnimationFrame(raf));
  return { display };
}

const summaryCounters = useCountUpMap(() => ({
  mastered: props.masteredCount,
  messages: props.messageCount,
}));
const sessionCounters = useCountUpMap(() => {
  const out: Record<string, number> = {};
  for (const card of sessionMetricCards.value) out[card.key] = Number(card.raw);
  return out;
});
const longTermCounters = useCountUpMap(() => {
  const out: Record<string, number> = {};
  for (const card of longTermMetricCards.value) out[card.key] = Number(card.raw);
  return out;
});

const sessionMetricCards = computed(() => {
  if (!evaluation.value) return [];
  const k = Number(evaluation.value.sessionKtl ?? evaluation.value.ktl);
  const s = Number(evaluation.value.sessionLss ?? evaluation.value.lss);
  const f = Number(evaluation.value.sessionLf ?? evaluation.value.lf);
  const kl = getSimpleLevel(k, 7, 4);
  const sl = getStress(s * 10);
  const fl = getStress(f * 10);
  return [
    { key: 'k', label: '本节掌握增量', value: toFixed(k), raw: k, level: kl.level, tone: kl.tone, desc: '即时学习产出，越高说明本节吸收越充分。' },
    { key: 's', label: '本节学习压力', value: toFixed(s), raw: s, level: sl.level, tone: sl.tone, desc: '当前课程负荷强度，偏高时建议先复盘。' },
    { key: 'f', label: '本节疲劳累积', value: toFixed(f), raw: f, level: fl.level, tone: fl.tone, desc: '即时疲劳变化，偏高时适合切换轻任务。' },
  ];
});

const longTermMetricCards = computed(() => {
  if (!stateUpdate.value) return [];
  const { ktl, lsb, lf, lss } = stateUpdate.value;
  const kl = getSimpleLevel(Number(ktl || 0), 7, 4);
  const bl = getBalance(Number(lsb || 0));
  const fl = getStress(Number(lf || 0) * 10);
  const sl = getStress(Number(lss || 0) * 10);
  return [
    { key: 'ktl', label: 'KTL 知识掌握', value: toFixed(ktl), raw: Number(ktl || 0), level: kl.level, tone: kl.tone, desc: '长期累计学习收益，反映稳定掌握趋势。' },
    { key: 'lsb', label: 'LSB 状态平衡', value: toFixed(lsb), raw: Number(lsb || 0), level: bl.level, tone: bl.tone, desc: '掌握与疲劳差值，越接近正值越理想。' },
    { key: 'lf', label: 'LF 学习疲劳', value: toFixed(lf), raw: Number(lf || 0), level: fl.level, tone: fl.tone, desc: '短期疲劳累计，偏高时建议降强度。' },
    { key: 'lss', label: 'LSS 学习压力', value: toFixed(lss), raw: Number(lss || 0), level: sl.level, tone: sl.tone, desc: '整体学习压力水平，持续偏高需节奏调整。' },
  ];
});

const sanitizeKnowledgeEvidence = (text: string) => text
  .replace(/newlyMastered/gi, '本节新收获')
  .replace(/unchangedMastered/gi, '已学会')
  .replace(/mastered/gi, '已学会')
  .replace(/avgUnderstanding/gi, '课堂理解度')
  .replace(/\bstatus\b/gi, '当前表现');

const knowledgeItems = computed(() => (summary.value?.knowledgeItems || []).map((item) => ({
  ...item,
  evidence: sanitizeKnowledgeEvidence(item.evidence),
})));
const keyTakeaways = computed(() => summary.value?.keyTakeaways || []);
const actionPlan = computed(() => summary.value?.actionPlan || []);
const evaluationHighlights = computed(() => summary.value?.evaluationHighlights || null);
const hasHighlights = computed(() => {
  const h = evaluationHighlights.value;
  return !!(h && ((h.strengths?.length || 0) > 0 || (h.improvements?.length || 0) > 0));
});
const sessionInterpretation = computed(() => summary.value?.metricInterpretation?.session || '本节表现反映本次课堂的即时投入和产出。');
const longTermInterpretation = computed(() => summary.value?.metricInterpretation?.longTerm || '长期状态来自历史累计，不等于单节课程成绩。');

const progressHighlights = computed(() => {
  const result: Array<{ title: string; label: string; text: string; type: string }> = [];
  if (props.wrapup.progress.newlyMastered.length > 0) {
    result.push({
      title: '本节新收获',
      label: '进步',
      text: props.wrapup.progress.newlyMastered.join('、'),
      type: 'success',
    });
  }
  if (props.wrapup.progress.movedToReview.length > 0) {
    result.push({
      title: '需要回看',
      label: '提醒',
      text: props.wrapup.progress.movedToReview.join('、'),
      type: 'danger',
    });
  }
  if (props.wrapup.progress.stillLearning.length > 0) {
    result.push({
      title: '仍在推进中',
      label: '继续巩固',
      text: props.wrapup.progress.stillLearning.join('、'),
      type: 'warning',
    });
  }
  return result;
});

const formatSentenceList = (items: string[] = []) => items.map((i) => i.replace(/[；;。]+$/g, '').trim()).filter(Boolean).join('；');
const formattedStrengths = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.strengths) : ''));
const formattedImprovements = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.improvements) : ''));

const getKnowledgeTagType = (s: string) => (s === 'mastered' ? 'success' : s === 'learning' ? 'warning' : s === 'review' ? 'danger' : 'info');
const getKnowledgeStatusLabel = (s: string) => (s === 'mastered' ? '已学会' : s === 'learning' ? '继续练习' : s === 'review' ? '建议回看' : '尚未展开');
</script>

<style scoped>
.completion-card { margin-top: 16px; padding: 20px; background: linear-gradient(135deg, color-mix(in srgb, var(--green, #1e9e58) 10%, var(--surface)) 0%, color-mix(in srgb, var(--green, #1e9e58) 6%, var(--surface)) 100%); border: 1px solid color-mix(in srgb, var(--green, #1e9e58) 30%, var(--line)); border-radius: 12px; }
.completion-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.completion-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--green, #2e7d32); }
.completion-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; padding: 12px; background-color: color-mix(in srgb, var(--surface) 82%, transparent); border-radius: 8px; }
.summary-item { display: flex; flex-direction: column; gap: 2px; }
.summary-label { font-size: 11px; color: var(--muted, #78909c); }
.summary-value { font-size: 13px; font-weight: 600; color: var(--green, #2e7d32); }
.completion-section { margin-bottom: 16px; padding: 12px; background-color: color-mix(in srgb, var(--surface) 82%, transparent); border-radius: 8px; }
.advisory-section { border: 1px solid var(--line, #dfe7d6); }
.advisory-section--high { border-color: #efc9b2; background: color-mix(in srgb, var(--red, #ef7578) 8%, var(--surface)); }
.advisory-section--medium { border-color: #ecd9a6; background: color-mix(in srgb, var(--amber, #f4aa46) 10%, var(--surface)); }
.advisory-section--low { border-color: #b7ddb6; background: color-mix(in srgb, var(--green, #1e9e58) 8%, var(--surface)); }
.section-title { margin: 0 0 10px; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--green, #1b5e20); }
.section-hint { margin: 0 0 10px; font-size: 12px; color: var(--muted, #607d8b); }
.review-link { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--red, #b3261e); text-decoration: none; }
.review-link:hover { text-decoration: underline; }
.section-content { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink, #37474f); }
.advisory-options { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
.metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.metrics-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.metric-card { padding: 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--green, #1e9e58) 20%, var(--line)); background: var(--surface); }
.metric-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.metric-label { font-size: 12px; color: var(--muted, #546e7a); }
.metric-badge { font-size: 11px; padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--green, #1e9e58) 10%, var(--surface)); color: var(--green, #33691e); }
.metric-value { margin-top: 6px; font-size: 22px; font-weight: 700; color: var(--green, #2e7d32); }
.metric-desc { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted, #607d8b); }
.metric-card--good { border-color: color-mix(in srgb, var(--green, #1e9e58) 30%, var(--line)); }
.metric-card--normal { border-color: #d3dcb0; }
.metric-card--warn { border-color: #efc9b2; }
.knowledge-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.knowledge-item { padding: 10px; border: 1px solid color-mix(in srgb, var(--green, #1e9e58) 18%, var(--line)); border-radius: 8px; background: var(--surface); }
.knowledge-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.knowledge-name { font-size: 13px; font-weight: 600; color: var(--ink, #2f4f4f); }
.knowledge-evidence { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted, #546e7a); }
.ordered-list { margin: 0; padding-left: 0; list-style-position: inside; list-style-type: decimal; font-size: 13px; line-height: 1.6; color: var(--ink, #37474f); }
.ordered-list li { margin: 0 0 6px; overflow-wrap: anywhere; }
.ordered-list li:last-child { margin-bottom: 0; }
.evaluation-block { display: grid; gap: 8px; }
.evaluation-line { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink, #37474f); }
.completion-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
@media (max-width: 900px) { .metrics-grid--three { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .completion-summary,
  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .completion-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .completion-actions :deep(.el-button),
  .advisory-options :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
