<template>
  <div class="cognitive-state-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h3 class="panel-title">
        <el-icon><Monitor /></el-icon>
        学习状态追踪
      </h3>
      <el-tag :type="statusType" size="small">{{ statusText }}</el-tag>
    </div>

    <!-- 核心指标卡片 -->
    <div class="metrics-grid">
      <!-- LSB -->
      <div class="metric-card lsb" :class="lsbClass">
        <div class="metric-label">学习状态值 (LSB)</div>
        <div class="metric-value" :style="lsbStyle">{{ formatLSB(metrics.lsb) }}</div>
        <div class="metric-desc">{{ lsbDescription }}</div>
        <div class="metric-bar">
          <div class="metric-fill" :style="lsbBarStyle"></div>
        </div>
      </div>

      <!-- LSS -->
      <div class="metric-card lss">
        <div class="metric-label">学习压力 (LSS)</div>
        <div class="metric-value" :class="lssClass">{{ metrics.lss?.toFixed(1) || '0.0' }}</div>
        <div class="metric-bar">
          <div class="metric-fill" :class="lssClass" :style="lssBarStyle"></div>
        </div>
      </div>

      <!-- KTL -->
      <div class="metric-card ktl">
        <div class="metric-label">知识负荷 (KTL)</div>
        <div class="metric-value">{{ metrics.ktl?.toFixed(1) || '0.0' }}</div>
        <div class="metric-bar">
          <div class="metric-fill" :style="ktlBarStyle"></div>
        </div>
      </div>

      <!-- LF -->
      <div class="metric-card lf">
        <div class="metric-label">疲劳度 (LF)</div>
        <div class="metric-value" :class="lfClass">{{ metrics.lf?.toFixed(1) || '0.0' }}</div>
        <div class="metric-bar">
          <div class="metric-fill" :class="lfClass" :style="lfBarStyle"></div>
        </div>
      </div>
    </div>

    <!-- 认知层级 -->
    <div v-if="cognitiveAnalysis" class="cognitive-section">
      <h4 class="section-title">认知分析</h4>
      <div class="cognitive-level">
        <span class="level-label">当前层级:</span>
        <el-tag :type="cognitiveLevelType" size="default">
          {{ cognitiveLevelText }}
        </el-tag>
        <el-rate
          :model-value="cognitiveAnalysis.levelScore"
          :max="6"
          disabled
          show-score
          text-color="#ff9900"
        />
      </div>
      <div class="understanding-bar">
        <span class="bar-label">理解度:</span>
        <el-progress
          :percentage="Math.round((cognitiveAnalysis.understanding || 0) * 100)"
          :color="understandingColor"
        />
      </div>
      <div class="engagement-bar">
        <span class="bar-label">参与度:</span>
        <el-progress
          :percentage="Math.round((cognitiveAnalysis.engagement || 0) * 100)"
          :color="engagementColor"
        />
      </div>
    </div>

    <!-- 困惑点 -->
    <div v-if="cognitiveAnalysis?.confusionPoints?.length" class="confusion-section">
      <h4 class="section-title">关注点</h4>
      <div class="confusion-tags">
        <el-tag
          v-for="point in cognitiveAnalysis.confusionPoints"
          :key="point"
          type="warning"
          effect="dark"
          size="small"
        >
          {{ point }}
        </el-tag>
      </div>
    </div>

    <!-- 干预建议 -->
    <div v-if="intervention" class="intervention-section">
      <h4 class="section-title">
        <el-icon><InfoFilled /></el-icon>
        教学建议
      </h4>
      <div class="intervention-card" :class="intervention.type">
        <div class="intervention-type">{{ interventionTypeText }}</div>
        <div class="intervention-content">{{ intervention.content }}</div>
        <div class="intervention-reason">{{ intervention.reasoning }}</div>
      </div>
    </div>

    <!-- 实时趋势图 -->
    <div v-if="showTrend && trendData.length > 1" class="trend-section">
      <h4 class="section-title">状态趋势</h4>
      <div ref="chartRef" class="trend-chart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { Monitor, InfoFilled } from '@element-plus/icons-vue';

// 学习状态指标
interface LearningStateMetrics {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
}

// 认知分析结果
interface CognitiveAnalysisResult {
  cognitiveLevel: string;
  levelScore: number;
  understanding: number;
  confusionPoints: string[];
  engagement: number;
  emotionalState: string;
}

// 干预决策
interface InterventionStrategy {
  type: string;
  priority: number;
  content: string;
  reasoning: string;
}

// Props
const props = defineProps<{
  metrics: LearningStateMetrics;
  cognitiveAnalysis?: CognitiveAnalysisResult;
  intervention?: InterventionStrategy;
  trendData?: Array<{ timestamp: string; lsb: number; lss: number }>;
  showTrend?: boolean;
}>();

const chartRef = ref<HTMLElement>();

// 状态类型
const statusType = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  if (lsb < 0) return 'danger';
  if (lsb < 20) return 'warning';
  if (lsb > 40) return 'success';
  return 'info';
});

const statusText = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  if (lsb < 0) return '状态不佳';
  if (lsb < 20) return '需要调整';
  if (lsb > 40) return '状态优秀';
  return '状态正常';
});

// LSB 相关计算
const lsbClass = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  if (lsb < 0) return 'negative';
  if (lsb < 20) return 'low';
  if (lsb > 40) return 'high';
  return 'normal';
});

const lsbStyle = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  const hue = lsb < 0 ? 0 : 120 * Math.min(lsb / 40, 1);
  return { color: `hsl(${hue}, 70%, 45%)` };
});

const lsbBarStyle = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  // 将 -100~100 映射到 0~100%
  const percent = ((lsb + 100) / 200) * 100;
  const hue = lsb < 0 ? 0 : 120 * Math.min(lsb / 40, 1);
  return {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    background: `hsl(${hue}, 70%, 50%)`,
  };
});

const lsbDescription = computed(() => {
  const lsb = props.metrics?.lsb || 0;
  if (lsb < -30) return '疲劳超过知识积累，建议休息';
  if (lsb < 0) return '状态不佳，需要调整';
  if (lsb < 20) return '状态一般，可以继续努力';
  if (lsb < 40) return '状态良好';
  return '状态优秀，继续保持！';
});

// LSS 相关
const lssClass = computed(() => {
  const lss = props.metrics?.lss || 0;
  if (lss > 70) return 'high';
  if (lss > 50) return 'medium';
  return 'low';
});

const lssBarStyle = computed(() => {
  const lss = props.metrics?.lss || 0;
  return { width: `${Math.max(0, Math.min(100, lss))}%` };
});

// KTL 相关
const ktlBarStyle = computed(() => {
  const ktl = props.metrics?.ktl || 0;
  return { width: `${Math.max(0, Math.min(100, ktl))}%` };
});

// LF 相关
const lfClass = computed(() => {
  const lf = props.metrics?.lf || 0;
  if (lf > 70) return 'high';
  if (lf > 40) return 'medium';
  return 'low';
});

const lfBarStyle = computed(() => {
  const lf = props.metrics?.lf || 0;
  return { width: `${Math.max(0, Math.min(100, lf))}%` };
});

// 认知层级
const cognitiveLevelText = computed(() => {
  const levels: Record<string, string> = {
    remember: '记忆',
    understand: '理解',
    apply: '应用',
    analyze: '分析',
    evaluate: '评估',
    create: '创造',
  };
  return levels[props.cognitiveAnalysis?.cognitiveLevel] || '未知';
});

const cognitiveLevelType = computed(() => {
  const score = props.cognitiveAnalysis?.levelScore || 1;
  if (score <= 2) return 'info';
  if (score <= 4) return 'success';
  return 'warning';
});

const understandingColor = computed(() => {
  const u = props.cognitiveAnalysis?.understanding || 0;
  if (u < 0.4) return '#f56c6c';
  if (u < 0.7) return '#e6a23c';
  return '#67c23a';
});

const engagementColor = computed(() => {
  const e = props.cognitiveAnalysis?.engagement || 0;
  if (e < 0.3) return '#f56c6c';
  if (e < 0.6) return '#e6a23c';
  return '#67c23a';
});

// 干预类型
const interventionTypeText = computed(() => {
  const types: Record<string, string> = {
    hint: '💡 提示',
    explanation: '📖 解释',
    example: '💼 示例',
    simplification: '📉 简化',
    challenge: '🚀 挑战',
    break: '☕ 休息',
    encouragement: '👍 鼓励',
    redirection: '🔄 转场',
  };
  return types[props.intervention?.type] || '建议';
});

// 方法
const formatLSB = (lsb: number) => {
  if (lsb === undefined || lsb === null) return '0.0';
  const sign = lsb > 0 ? '+' : '';
  return `${sign}${lsb.toFixed(1)}`;
};
</script>

<style scoped>
.cognitive-state-panel {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-md);
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}

[data-theme="dark"] .cognitive-state-panel {
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border-default);
  transition: border-color var(--transition-normal);
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  transition: color var(--transition-normal);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.metric-card {
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 16px;
  position: relative;
  overflow: hidden;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .metric-card {
  background: var(--bg-subtle);
}

.metric-card.lsb {
  grid-column: span 2;
  background: linear-gradient(135deg, var(--bg-muted) 0%, var(--bg-active) 100%);
}

[data-theme="dark"] .metric-card.lsb {
  background: linear-gradient(135deg, var(--bg-subtle) 0%, var(--bg-muted) 100%);
}

.metric-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
  transition: color var(--transition-normal);
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
  transition: color var(--transition-normal);
}

.metric-value.high {
  color: var(--color-danger);
}

.metric-value.medium {
  color: var(--color-efficient);
}

.metric-value.low {
  color: var(--color-success);
}

.metric-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  transition: color var(--transition-normal);
}

.metric-bar {
  height: 6px;
  background: var(--border-light);
  border-radius: 3px;
  overflow: hidden;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .metric-bar {
  background: var(--bg-muted);
}

.metric-fill {
  height: 100%;
  border-radius: 3px;
  transition: all 0.3s ease;
}

.metric-fill.high {
  background: var(--color-danger);
}

.metric-fill.medium {
  background: var(--color-efficient);
}

.metric-fill.low {
  background: var(--color-success);
}

.cognitive-section,
.confusion-section,
.intervention-section,
.trend-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-default);
  transition: border-color var(--transition-normal);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color var(--transition-normal);
}

.cognitive-level {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.level-label {
  font-size: 13px;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.understanding-bar,
.engagement-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.bar-label {
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 60px;
  transition: color var(--transition-normal);
}

.understanding-bar :deep(.el-progress),
.engagement-bar :deep(.el-progress) {
  flex: 1;
}

.confusion-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.intervention-card {
  background: var(--color-progress-bg);
  border-left: 4px solid var(--color-primary);
  border-radius: 4px;
  padding: 16px;
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

[data-theme="dark"] .intervention-card {
  background: rgba(52, 152, 219, 0.15);
  border-left-color: var(--color-primary-light);
}

.intervention-card.hint {
  background: var(--color-efficient-bg);
  border-left-color: var(--color-efficient);
}

[data-theme="dark"] .intervention-card.hint {
  background: rgba(243, 156, 18, 0.15);
  border-left-color: var(--color-efficient-light);
}

.intervention-card.break {
  background: var(--color-success-bg);
  border-left-color: var(--color-success);
}

[data-theme="dark"] .intervention-card.break {
  background: rgba(46, 204, 113, 0.15);
  border-left-color: var(--color-success-light);
}

.intervention-card.challenge {
  background: var(--color-success-bg);
  border-left-color: var(--color-success);
}

[data-theme="dark"] .intervention-card.challenge {
  background: rgba(46, 204, 113, 0.15);
  border-left-color: var(--color-success-light);
}

.intervention-type {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  transition: color var(--transition-normal);
}

.intervention-content {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  line-height: 1.6;
  transition: color var(--transition-normal);
}

.intervention-reason {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  transition: color var(--transition-normal);
}

.trend-chart {
  height: 200px;
  background: var(--bg-muted);
  border-radius: 8px;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .trend-chart {
  background: var(--bg-subtle);
}
</style>
