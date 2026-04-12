<template>
  <div class="completion-card">
    <div class="completion-header">
      <el-icon :size="24" color="#2e7d32"><CircleCheckFilled /></el-icon>
      <h3 class="completion-title">课程完成</h3>
    </div>

    <div class="completion-body">
      <div class="completion-summary">
        <div class="summary-item"><span class="summary-label">主题</span><span class="summary-value">{{ topic }}</span></div>
        <div class="summary-item"><span class="summary-label">知识点</span><span class="summary-value">{{ masteredCount }}/{{ totalCount }} 已掌握</span></div>
        <div class="summary-item"><span class="summary-label">用时</span><span class="summary-value">{{ duration }}</span></div>
        <div class="summary-item"><span class="summary-label">消息数</span><span class="summary-value">{{ messageCount }} 条</span></div>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><Document /></el-icon>主题总结</h4>
        <p class="section-content">{{ summary.topicSummary }}</p>
      </div>

      <div v-if="evaluation" class="completion-section">
        <h4 class="section-title"><el-icon><DataAnalysis /></el-icon>本节表现</h4>
        <p class="section-hint">{{ sessionInterpretation }}</p>
        <div class="metrics-grid metrics-grid--three">
          <div v-for="item in sessionMetricCards" :key="item.key" class="metric-card" :class="`metric-card--${item.tone}`">
            <div class="metric-head"><span class="metric-label">{{ item.label }}</span><span class="metric-badge">{{ item.level }}</span></div>
            <div class="metric-value">{{ item.value }}</div>
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
            <div class="metric-value">{{ item.value }}</div>
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
        <h4 class="section-title"><el-icon><Compass /></el-icon>本周行动</h4>
        <ol v-if="actionPlan.length" class="ordered-list"><li v-for="(item, idx) in actionPlan" :key="`${idx}-${item}`">{{ item }}</li></ol>
        <div v-else class="section-content"><MarkdownRenderer :content="summary.practiceAdvice" /></div>
      </div>

      <div class="completion-section">
        <h4 class="section-title"><el-icon><TrendCharts /></el-icon>学习评价</h4>
        <div v-if="evaluationHighlights" class="evaluation-block">
          <p class="evaluation-line"><strong>亮点：</strong>{{ formattedStrengths }}</p>
          <p class="evaluation-line"><strong>改进：</strong>{{ formattedImprovements }}</p>
        </div>
        <p v-else class="section-content">{{ summary.learningEvaluation }}</p>
      </div>
    </div>

    <div class="completion-actions">
      <el-button type="primary" @click="emit('action', 'end')"><el-icon><VideoPause /></el-icon>返回学习路径</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheckFilled, VideoPause, Compass, Document, Collection, TrendCharts, DataAnalysis } from '@element-plus/icons-vue';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = defineProps<{
  topic: string;
  masteredCount: number;
  totalCount: number;
  duration: string;
  messageCount: number;
  summary: any;
  evaluation?: any;
}>();

const emit = defineEmits<{ action: [action: 'end'] }>();

const toFixed = (v: number | undefined) => Number(v || 0).toFixed(1);
const getSimpleLevel = (v: number, h: number, m: number) => (v >= h ? { level: '高', tone: 'good' } : v >= m ? { level: '中', tone: 'normal' } : { level: '低', tone: 'warn' });
const getStress = (v: number) => (v >= 70 ? { level: '高', tone: 'warn' } : v >= 40 ? { level: '中', tone: 'normal' } : { level: '低', tone: 'good' });
const getBalance = (v: number) => (v >= 0 ? { level: '平衡', tone: 'good' } : v >= -10 ? { level: '轻微失衡', tone: 'normal' } : { level: '失衡', tone: 'warn' });

const sessionMetricCards = computed(() => {
  if (!props.evaluation) return [];
  const k = Number(props.evaluation.sessionKtl ?? props.evaluation.ktl);
  const s = Number(props.evaluation.sessionLss ?? props.evaluation.lss);
  const f = Number(props.evaluation.sessionLf ?? props.evaluation.lf);
  const kl = getSimpleLevel(k, 7, 4);
  const sl = getStress(s * 10);
  const fl = getStress(f * 10);
  return [
    { key: 'k', label: '本节掌握增量', value: toFixed(k), level: kl.level, tone: kl.tone, desc: '即时学习产出，越高说明本节吸收越充分。' },
    { key: 's', label: '本节学习压力', value: toFixed(s), level: sl.level, tone: sl.tone, desc: '当前课程负荷强度，偏高时建议先复盘。' },
    { key: 'f', label: '本节疲劳累积', value: toFixed(f), level: fl.level, tone: fl.tone, desc: '即时疲劳变化，偏高时适合切换轻任务。' },
  ];
});

const longTermMetricCards = computed(() => {
  if (!props.evaluation) return [];
  const { ktl, lsb, lf, lss } = props.evaluation;
  const kl = getSimpleLevel(Number(ktl || 0), 60, 30);
  const bl = getBalance(Number(lsb || 0));
  const fl = getStress(Number(lf || 0));
  const sl = getStress(Number(lss || 0));
  return [
    { key: 'ktl', label: 'KTL 知识掌握', value: toFixed(ktl), level: kl.level, tone: kl.tone, desc: '长期累计学习收益，反映稳定掌握趋势。' },
    { key: 'lsb', label: 'LSB 状态平衡', value: toFixed(lsb), level: bl.level, tone: bl.tone, desc: '掌握与疲劳差值，越接近正值越理想。' },
    { key: 'lf', label: 'LF 学习疲劳', value: toFixed(lf), level: fl.level, tone: fl.tone, desc: '短期疲劳累计，偏高时建议降强度。' },
    { key: 'lss', label: 'LSS 学习压力', value: toFixed(lss), level: sl.level, tone: sl.tone, desc: '整体学习压力水平，持续偏高需节奏调整。' },
  ];
});

const knowledgeItems = computed(() => props.summary?.knowledgeItems || []);
const keyTakeaways = computed(() => props.summary?.keyTakeaways || []);
const actionPlan = computed(() => props.summary?.actionPlan || []);
const evaluationHighlights = computed(() => props.summary?.evaluationHighlights || null);
const sessionInterpretation = computed(() => props.summary?.metricInterpretation?.session || '本节表现反映本次课堂的即时投入和产出。');
const longTermInterpretation = computed(() => props.summary?.metricInterpretation?.longTerm || '长期状态来自历史累计，不等于单节课程成绩。');

const formatSentenceList = (items: string[] = []) => items.map((i) => i.replace(/[；;。]+$/g, '').trim()).filter(Boolean).join('；');
const formattedStrengths = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.strengths) : ''));
const formattedImprovements = computed(() => (evaluationHighlights.value ? formatSentenceList(evaluationHighlights.value.improvements) : ''));

const getKnowledgeTagType = (s: string) => (s === 'mastered' ? 'success' : s === 'learning' ? 'warning' : s === 'review' ? 'danger' : 'info');
const getKnowledgeStatusLabel = (s: string) => (s === 'mastered' ? '已掌握' : s === 'learning' ? '学习中' : s === 'review' ? '需复习' : '待学习');
</script>

<style scoped>
.completion-card { margin-top: 16px; padding: 20px; background: linear-gradient(135deg, #f0f9eb 0%, #e8f5e9 100%); border: 1px solid #c5e1a5; border-radius: 12px; }
.completion-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.completion-title { margin: 0; font-size: 16px; font-weight: 600; color: #2e7d32; }
.completion-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; padding: 12px; background-color: rgba(255, 255, 255, 0.75); border-radius: 8px; }
.summary-item { display: flex; flex-direction: column; gap: 2px; }
.summary-label { font-size: 11px; color: #78909c; }
.summary-value { font-size: 13px; font-weight: 600; color: #2e7d32; }
.completion-section { margin-bottom: 16px; padding: 12px; background-color: rgba(255, 255, 255, 0.75); border-radius: 8px; }
.section-title { margin: 0 0 10px; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #1b5e20; }
.section-hint { margin: 0 0 10px; font-size: 12px; color: #607d8b; }
.section-content { margin: 0; font-size: 13px; line-height: 1.7; color: #37474f; }
.metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.metrics-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.metric-card { padding: 10px; border-radius: 8px; border: 1px solid #d8e6d4; background: #fff; }
.metric-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.metric-label { font-size: 12px; color: #546e7a; }
.metric-badge { font-size: 11px; padding: 2px 6px; border-radius: 999px; background: #eef5ea; color: #33691e; }
.metric-value { margin-top: 6px; font-size: 22px; font-weight: 700; color: #2e7d32; }
.metric-desc { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: #607d8b; }
.metric-card--good { border-color: #b7ddb6; }
.metric-card--normal { border-color: #d3dcb0; }
.metric-card--warn { border-color: #efc9b2; }
.knowledge-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.knowledge-item { padding: 10px; border: 1px solid #dfe8dc; border-radius: 8px; background: #fff; }
.knowledge-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.knowledge-name { font-size: 13px; font-weight: 600; color: #2f4f4f; }
.knowledge-evidence { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: #546e7a; }
.ordered-list { margin: 0; padding-left: 0; list-style-position: inside; list-style-type: decimal; font-size: 13px; line-height: 1.6; color: #37474f; }
.ordered-list li { margin: 0 0 6px; overflow-wrap: anywhere; }
.ordered-list li:last-child { margin-bottom: 0; }
.evaluation-block { display: grid; gap: 8px; }
.evaluation-line { margin: 0; font-size: 13px; line-height: 1.7; color: #37474f; }
.completion-actions { display: flex; justify-content: flex-end; }
@media (max-width: 900px) { .metrics-grid--three { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .completion-summary, .metrics-grid { grid-template-columns: 1fr; } }
</style>
