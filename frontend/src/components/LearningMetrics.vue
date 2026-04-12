<template>
  <div class="learning-metrics-container">
    <div v-if="loading" class="loading-state">
      <div class="skeleton-card">
        <div class="skeleton-header"></div>
        <div class="skeleton-grid">
          <div class="skeleton-item" v-for="i in 3" :key="i"></div>
        </div>
      </div>
    </div>

    <div v-else-if="!currentState" class="no-data-state">
      <div class="no-data-icon">📊</div>
      <h4>暂无学习数据</h4>
      <p>完成一些学习任务后可以看到状态分析</p>
    </div>

    <div v-else class="metrics-content">
      <div class="metrics-header">
        <div class="header-left">
          <h3 class="metrics-title">{{ panelTitle }}</h3>
          <div class="status-indicator" :class="statusClass">
            <span class="status-dot"></span>
            <span class="status-text">{{ statusText }}</span>
          </div>
        </div>
        <div class="header-right">
          <button v-if="isShowingSelectedDay" type="button" class="mode-toggle" @click="clearSelection">
            返回整体状态
          </button>
          <span class="update-time">更新于 {{ lastUpdateTime }}</span>
        </div>
      </div>

      <div class="status-hero" :class="statusClass">
        <div class="status-hero-top">
          <div>
            <p class="status-kicker">状态平衡</p>
            <div class="hero-score-row">
              <span class="hero-score" :class="getLsbClass(displayState?.lsb)">{{ formatMetric(displayState?.lsb) }}</span>
              <span class="hero-unit">LSB</span>
            </div>
          </div>
          <div class="hero-zone">{{ getLsbLabel(displayState?.lsb) }}</div>
        </div>
        <p class="hero-analysis">{{ analysisText }}</p>
      </div>

      <div class="metrics-grid">
        <div class="metric-hero lss-hero" :class="getLssHeroClass(displayState?.lss)">
          <div class="metric-hero-top">
            <div>
              <p class="metric-kicker">学习压力</p>
              <div class="metric-score-row">
                <span class="metric-hero-value" :class="getScoreClass(displayState?.lss)">{{ formatMetric(displayState?.lss) }}</span>
                <span class="metric-hero-unit">LSS</span>
              </div>
            </div>
            <div class="metric-hero-zone">{{ getLssLabel(displayState?.lss) }}</div>
          </div>
          <p class="metric-hero-analysis">{{ getLssAnalysis(displayState?.lss) }}</p>
        </div>

        <div class="metric-hero ktl-hero" :class="getKtlHeroClass(displayState?.ktl)">
          <div class="metric-hero-top">
            <div>
              <p class="metric-kicker">知识掌握</p>
              <div class="metric-score-row">
                <span class="metric-hero-value" :class="getScoreClass(displayState?.ktl)">{{ formatMetric(displayState?.ktl) }}</span>
                <span class="metric-hero-unit">KTL</span>
              </div>
            </div>
            <div class="metric-hero-zone">{{ getKtlLabel(displayState?.ktl) }}</div>
          </div>
          <p class="metric-hero-analysis">{{ getKtlAnalysis(displayState?.ktl) }}</p>
        </div>

        <div class="metric-hero lf-hero" :class="getLfHeroClass(displayState?.lf)">
          <div class="metric-hero-top">
            <div>
              <p class="metric-kicker">学习疲劳</p>
              <div class="metric-score-row">
                <span class="metric-hero-value" :class="getScoreClass(displayState?.lf)">{{ formatMetric(displayState?.lf) }}</span>
                <span class="metric-hero-unit">LF</span>
              </div>
            </div>
            <div class="metric-hero-zone">{{ getLfLabel(displayState?.lf) }}</div>
          </div>
          <p class="metric-hero-analysis">{{ getLfAnalysis(displayState?.lf) }}</p>
        </div>
      </div>

      <router-link to="/learning-state" class="detail-link">
        查看完整状态分析
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { metricsAPI, type CurrentState } from '../api/metrics';

interface DaySessionState {
  lss?: number;
  ktl?: number;
  lf?: number;
  lsb?: number;
  sessionLss?: number;
  sessionKtl?: number;
  sessionLf?: number;
  evaluationConfidence?: number;
  cognitive?: number;
  stress?: number;
  engagement?: number;
  anomaly?: boolean;
}

interface SelectedDaySession {
  parsedState?: DaySessionState | null;
  durationMinutes?: number;
}

interface SelectedDay {
  date: string;
  sessionCount: number;
  durationMinutes: number;
  primaryTaskTitle?: string;
  sessions: SelectedDaySession[];
}

const props = defineProps<{
  selectedDay?: SelectedDay | null;
}>();

const emit = defineEmits<{
  (e: 'clear-selection'): void;
}>();

const loading = ref(true);
const currentState = ref<CurrentState | null>(null);

const hasUsableState = (state: CurrentState | null): state is CurrentState => {
  if (!state) return false;

  const values = [state.lss, state.ktl, state.lf, state.lsb];
  const hasInvalid = values.some((value) => typeof value !== 'number' || !Number.isFinite(value));
  if (hasInvalid) return false;

  // 历史脏数据可能写入了一条全 0 记录，面板应视为暂无真实状态。
  return !values.every((value) => value === 0);
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const weightedAverage = (
  sessions: Array<{ state: DaySessionState; weight: number }>,
  picker: (state: DaySessionState) => number | null
): number | null => {
  let weightedSum = 0;
  let totalWeight = 0;

  sessions.forEach(({ state, weight }) => {
    const value = picker(state);
    if (value === null) return;
    weightedSum += value * weight;
    totalWeight += weight;
  });

  if (totalWeight <= 0) return null;
  return weightedSum / totalWeight;
};

const selectedDayState = computed(() => {
  if (!props.selectedDay || props.selectedDay.sessionCount === 0) return null;

  const sessions = props.selectedDay.sessions
    .map((session) => ({
      state: session.parsedState,
      weight: Math.max(1, session.durationMinutes || 0) * Math.max(0.2, Math.min(1, session.parsedState?.evaluationConfidence ?? 1))
    }))
    .filter((entry): entry is { state: DaySessionState; weight: number } => Boolean(entry.state));

  if (sessions.length === 0) return null;

  const modernLss = weightedAverage(sessions, (state) => toNumberOrNull(state.sessionLss ?? state.lss));
  const modernKtl = weightedAverage(sessions, (state) => toNumberOrNull(state.sessionKtl ?? state.ktl));
  const modernLf = weightedAverage(sessions, (state) => toNumberOrNull(state.sessionLf ?? state.lf));
  const modernLsb = weightedAverage(sessions, (state) => toNumberOrNull(state.lsb));

  const hasModern = modernLss !== null || modernKtl !== null || modernLf !== null || modernLsb !== null;

  if (hasModern) {
    const lss = modernLss !== null ? clamp(modernLss, 0, 100) : null;
    const ktl = modernKtl !== null ? clamp(modernKtl, 0, 100) : null;
    const lf = modernLf !== null ? clamp(modernLf, 0, 100) : null;
    const lsb = modernLsb !== null
      ? clamp(modernLsb, -100, 100)
      : (ktl !== null && lf !== null ? clamp(ktl - lf, -100, 100) : null);

    if (lss === null && ktl === null && lf === null && lsb === null) {
      return null;
    }

    return {
      lss,
      ktl,
      lf,
      lsb,
      updatedAt: `${props.selectedDay.date}T00:00:00.000Z`
    };
  }

  // 兼容历史会话：旧字段 stress/cognitive/engagement
  const avgStress = weightedAverage(sessions, (state) => toNumberOrNull(state.stress));
  const avgCognitive = weightedAverage(sessions, (state) => toNumberOrNull(state.cognitive));
  const avgEngagement = weightedAverage(sessions, (state) => toNumberOrNull(state.engagement));
  const anomalyBonus = sessions.some(({ state }) => state.anomaly) ? 0.8 : 0;

  if (avgStress === null && avgCognitive === null && avgEngagement === null) {
    return null;
  }

  const fallbackStress = avgStress ?? 0;
  const fallbackCognitive = avgCognitive ?? 0;
  const fallbackEngagement = avgEngagement ?? 0;

  return {
    lss: clamp(fallbackStress * 100, 0, 100),
    ktl: clamp(fallbackCognitive * 100, 0, 100),
    lf: clamp(fallbackStress * 65 + Math.max(0, 0.55 - fallbackEngagement) * 60 + anomalyBonus * 10, 0, 100),
    lsb: clamp(((fallbackCognitive + fallbackEngagement) / 2 - fallbackStress) * 10 - anomalyBonus, -100, 100),
    updatedAt: `${props.selectedDay.date}T00:00:00.000Z`
  };
});

const isShowingSelectedDay = computed(() => Boolean(props.selectedDay));
const selectedDayHasStateData = computed(() => Boolean(selectedDayState.value));
const displayState = computed(() => {
  if (isShowingSelectedDay.value) return selectedDayState.value;
  return currentState.value;
});

const statusClass = computed(() => {
  if (isShowingSelectedDay.value && props.selectedDay?.sessionCount && !selectedDayHasStateData.value) return 'normal';
  if (!displayState.value) return 'normal';
  const lsb = displayState.value.lsb ?? 0;
  if (lsb > 4) return 'excellent';
  if (lsb > 0) return 'good';
  if (lsb > -3) return 'warning';
  return 'danger';
});

const statusText = computed(() => {
  const cls = statusClass.value;
  if (isShowingSelectedDay.value && props.selectedDay?.sessionCount === 0) return '当天未学习';
  if (isShowingSelectedDay.value && props.selectedDay?.sessionCount && !selectedDayHasStateData.value) return '状态待生成';
  if (cls === 'excellent') return '高效状态';
  if (cls === 'good') return '良好状态';
  if (cls === 'warning') return '疲劳预警';
  return '过度疲劳';
});

const lastUpdateTime = computed(() => {
  if (isShowingSelectedDay.value && props.selectedDay?.date) {
    return `${props.selectedDay.date} 当天`;
  }
  if (!displayState.value?.updatedAt) return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return new Date(displayState.value.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
});

const analysisText = computed(() => {
  if (isShowingSelectedDay.value && props.selectedDay) {
    if (props.selectedDay.sessionCount === 0) {
      return '这一天没有学习记录，可以把它视为休息日，或者补一次短时学习来保持节奏。';
    }

    if (props.selectedDay.durationMinutes >= 120) {
      if (!selectedDayHasStateData.value) {
        return `这一天累计学习 ${props.selectedDay.durationMinutes} 分钟，投入已经比较高。${props.selectedDay.primaryTaskTitle ? `主要围绕“${props.selectedDay.primaryTaskTitle}”展开。` : ''}状态指标尚未生成（可能存在未结束会话或历史记录缺少状态字段）。`;
      }
      return `这一天累计学习 ${props.selectedDay.durationMinutes} 分钟，投入已经比较高。${props.selectedDay.primaryTaskTitle ? `主要围绕“${props.selectedDay.primaryTaskTitle}”展开。` : ''}`;
    }

    if (props.selectedDay.durationMinutes >= 60) {
      if (!selectedDayHasStateData.value) {
        return `这一天的学习节奏比较扎实。${props.selectedDay.primaryTaskTitle ? `主要内容是“${props.selectedDay.primaryTaskTitle}”。` : '完成了较完整的一次学习投入。'}状态指标尚未生成（可能存在未结束会话或历史记录缺少状态字段）。`;
      }
      return `这一天的学习节奏比较扎实。${props.selectedDay.primaryTaskTitle ? `主要内容是“${props.selectedDay.primaryTaskTitle}”。` : '完成了较完整的一次学习投入。'}`;
    }

    if (!selectedDayHasStateData.value) {
      return `这一天是轻量学习日，更像热身、复习或保持手感。${props.selectedDay.primaryTaskTitle ? `主要接触了“${props.selectedDay.primaryTaskTitle}”。` : ''}状态指标尚未生成（可能存在未结束会话或历史记录缺少状态字段）。`;
    }

    return `这一天是轻量学习日，更像热身、复习或保持手感。${props.selectedDay.primaryTaskTitle ? `主要接触了“${props.selectedDay.primaryTaskTitle}”。` : ''}`;
  }

  if (!displayState.value) return '';
  const { lsb } = displayState.value;
  
  if (lsb > 4) {
    return '当前学习状态极佳！知识掌握度良好，疲劳度低，建议继续保持这种高效的学习节奏。';
  } else if (lsb > 0) {
    return '学习状态良好。知识积累正在进行中，疲劳度在可控范围内，适合继续学习。';
  } else if (lsb > -3) {
    return '疲劳度开始累积，建议适当休息。知识掌握度仍在提升，但效率可能有所下降。';
  } else {
    return '警告！疲劳度已经过高，建议立即休息。过度疲劳会影响学习效果和记忆巩固。';
  }
});

const getScoreClass = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '';
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-medium';
  return 'score-low';
};

const getLsbClass = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '';
  if (score >= 4) return 'score-excellent';
  if (score >= 0) return 'score-good';
  if (score >= -3) return 'score-warning';
  return 'score-danger';
};

const getProgressWidth = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '0%';
  return `${Math.min(100, Math.max(0, score))}%`;
};

const getLsbProgressWidth = (score: number | null | undefined) => {
  if (!score) return '50%';
  const normalized = ((score + 10) / 20) * 100;
  return `${Math.min(100, Math.max(0, normalized))}%`;
};

const getLssLabel = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '无数据';
  if (score >= 80) return '极高压力';
  if (score >= 60) return '高压力';
  if (score >= 40) return '中等压力';
  return '低压力';
};

const getKtlLabel = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '无数据';
  if (score >= 80) return '精通';
  if (score >= 60) return '熟练';
  if (score >= 40) return '入门';
  return '初学';
};

const getLfLabel = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '无数据';
  if (score >= 80) return '极度疲劳';
  if (score >= 60) return '很疲劳';
  if (score >= 40) return '有些疲劳';
  return '精力充沛';
};

const getLssHeroClass = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '';
  if (score >= 60) return 'high';
  if (score <= 20) return 'low';
  return '';
};

const getKtlHeroClass = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '';
  if (score >= 80) return 'expert';
  if (score <= 20) return 'beginner';
  return '';
};

const getLfHeroClass = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '';
  if (score >= 80) return 'overload';
  if (score <= 30) return 'light';
  return '';
};

const getLssAnalysis = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '暂无数据';
  if (score >= 80) return '压力过高，建议立即休息调整，避免过度焦虑。';
  if (score >= 60) return '压力较大，建议适当放松，保持专注即可。';
  if (score >= 40) return '压力适中，适合深度学习，保持当前节奏。';
  return '压力较低，可以尝试挑战更高难度内容。';
};

const getKtlAnalysis = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '暂无数据';
  if (score >= 80) return '知识掌握优秀，可以尝试拓展更高级内容。';
  if (score >= 60) return '知识掌握良好，继续巩固可以更上一层楼。';
  if (score >= 40) return '处于入门阶段，建议多做练习巩固基础。';
  return '刚开始学习，建议专注基础概念的理解。';
};

const getLfAnalysis = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '暂无数据';
  if (score >= 80) return '疲劳度过高，建议立即休息，避免效率下降。';
  if (score >= 60) return '疲劳感较明显，建议适当休息后再继续。';
  if (score >= 40) return '有轻度疲劳感，可以适当调整学习节奏。';
  return '精力充沛，适合进行高强度学习任务。';
};

const getLsbLabel = (score: number | null | undefined) => {
  if (score === undefined || score === null) return '无数据';
  if (score >= 4) return '高效学习区';
  if (score >= 0) return '舒适学习区';
  if (score >= -3) return '疲劳预警区';
  return '过度疲劳区';
};

const formatMetric = (score: number | null | undefined): string => {
  if (score === undefined || score === null) return '--';
  return score.toFixed(1);
};

const panelTitle = computed(() => (isShowingSelectedDay.value ? '所选日期状态' : '当前学习状态'));

const clearSelection = () => {
  emit('clear-selection');
};

const fetchMetrics = async () => {
  try {
    const data = await metricsAPI.getCurrentState();
    currentState.value = hasUsableState(data) ? data : null;
  } catch (error) {
    console.error('获取学习指标失败:', error);
    currentState.value = null;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchMetrics();
});
</script>

<style scoped>
.learning-metrics-container {
  background: transparent;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

/* 加载状态 */
.loading-state {
  padding: 1rem;
}

.skeleton-card {
  background: white;
  border-radius: 8px;
  padding: 1rem;
}

.skeleton-header {
  height: 24px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

.skeleton-item {
  height: 120px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 无数据状态 */
.no-data-state {
  text-align: center;
  padding: 3rem 1rem;
}

.no-data-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.no-data-state h4 {
  font-size: 1.125rem;
  color: #4a5568;
  margin-bottom: 0.5rem;
}

.no-data-state p {
  color: #a0aec0;
  font-size: 0.875rem;
}

/* 指标内容 */
.metrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.metrics-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a202c;
  margin: 0;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-indicator.excellent {
  background: #c6f6d5;
  color: #22543d;
}

.status-indicator.good {
  background: #bee3f8;
  color: #2c5282;
}

.status-indicator.warning {
  background: #feebc8;
  color: #7c2d12;
}

.status-indicator.danger {
  background: #fed7d7;
  color: #742a2a;
}

.status-indicator.normal {
  background: #e2e8f0;
  color: #475569;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.update-time {
  font-size: 0.75rem;
  color: #a0aec0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.mode-toggle {
  border: 1px solid #dbeafe;
  background: rgba(255, 255, 255, 0.72);
  color: #4f46e5;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.mode-toggle:hover {
  background: rgba(79, 70, 229, 0.08);
}

.status-hero {
  padding: 1rem;
  border-radius: 14px;
  margin-bottom: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.status-hero.excellent {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(255, 255, 255, 0.58));
}

.status-hero.good {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(255, 255, 255, 0.58));
}

.status-hero.warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(255, 255, 255, 0.58));
}

.status-hero.danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(255, 255, 255, 0.58));
}

.status-hero.normal {
  background: linear-gradient(135deg, rgba(148, 163, 184, 0.2), rgba(255, 255, 255, 0.62));
}

.status-hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.status-kicker {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  color: #64748b;
}

.hero-score-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.hero-score {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.hero-unit {
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 700;
}

.hero-zone {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  color: #334155;
  font-weight: 700;
  white-space: nowrap;
}

.hero-analysis {
  margin: 0.875rem 0 0;
  color: #334155;
  line-height: 1.65;
  font-size: 0.9rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.metric-hero {
  padding: 1rem;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.3s;
}

.metric-hero:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.metric-hero.lss-hero {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.lss-hero.low {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.lss-hero.high {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.ktl-hero {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.ktl-hero.expert {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.ktl-hero.beginner {
  background: linear-gradient(135deg, rgba(148, 163, 184, 0.2), rgba(255, 255, 255, 0.62));
}

.metric-hero.lf-hero {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.lf-hero.light {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero.lf-hero.overload {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(255, 255, 255, 0.58));
}

.metric-hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.metric-kicker {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  color: #64748b;
}

.metric-score-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.metric-hero-value {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.metric-hero-unit {
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 700;
}

.metric-hero-zone {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  color: #334155;
  font-weight: 700;
  white-space: nowrap;
}

.metric-hero-analysis {
  margin: 0.875rem 0 0;
  color: #334155;
  line-height: 1.65;
  font-size: 0.9rem;
}

/* 分析部分 */
.detail-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.8rem 1rem;
  border-radius: 12px;
  background: rgba(102, 126, 234, 0.1);
  color: #4f46e5;
  text-decoration: none;
  font-weight: 700;
  transition: all 0.2s ease;
}

.detail-link:hover {
  background: rgba(102, 126, 234, 0.16);
}

/* 响应式 */
@media (max-width: 640px) {
  .metrics-header {
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .status-hero-top {
    flex-direction: column;
  }

  .metric-hero-top {
    flex-direction: column;
  }
}
</style>
