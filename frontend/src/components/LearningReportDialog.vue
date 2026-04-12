<template>
  <el-dialog
    v-model="dialogVisible"
    title="学习报告"
    width="500px"
    :close-on-click-modal="false"
    class="learning-report-dialog"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>生成报告中...</span>
    </div>

    <div v-else class="report-content">
      <div class="lsb-summary" :class="lsbClass">
        <div class="lsb-icon">{{ lsbIcon }}</div>
        <div class="lsb-value">{{ formatLSB(report.lsb) }}</div>
        <div class="lsb-label">学习状态值 (LSB)</div>
      </div>

      <div class="reasoning-section">
        <h4><el-icon><InfoFilled /></el-icon> AI 分析</h4>
        <p>{{ report.reasoning || '学习状态正常，继续保持！' }}</p>
      </div>

      <div class="suggestion-section">
        <h4><el-icon><Opportunity /></el-icon> 下次建议</h4>
        <p>{{ report.suggestion || '建议按计划继续学习。' }}</p>
      </div>

      <el-collapse class="metrics-collapse">
        <el-collapse-item title="详细指标" name="metrics">
          <div class="metrics-grid">
            <div class="metric-item">
              <span class="metric-label">学习压力 (LSS)</span>
              <span class="metric-value" :class="getLSSClass(report.lss)">
                {{ report.lss?.toFixed(1) || '0.0' }}
              </span>
              <el-progress
                :percentage="Math.min(100, report.lss || 0)"
                :color="getLSSColor(report.lss)"
                :show-text="false"
              />
            </div>
            <div class="metric-item">
              <span class="metric-label">知识负荷 (KTL)</span>
              <span class="metric-value">{{ report.ktl?.toFixed(1) || '0.0' }}</span>
              <el-progress
                :percentage="Math.min(100, report.ktl || 0)"
                color="#67c23a"
                :show-text="false"
              />
            </div>
            <div class="metric-item">
              <span class="metric-label">疲劳度 (LF)</span>
              <span class="metric-value" :class="getLFClass(report.lf)">
                {{ report.lf?.toFixed(1) || '0.0' }}
              </span>
              <el-progress
                :percentage="Math.min(100, report.lf || 0)"
                :color="getLFColor(report.lf)"
                :show-text="false"
              />
            </div>
          </div>
          <div class="formula-note">
            <el-icon><Warning /></el-icon>
            LSB = KTL - LF（知识积累减去疲劳度）
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <template #footer>
      <el-button type="primary" @click="handleContinue">
        继续学习
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Loading, InfoFilled, Opportunity, Warning } from '@element-plus/icons-vue';

interface LearningReport {
  lsb: number;
  reasoning?: string;
  suggestion?: string;
  lss?: number;
  ktl?: number;
  lf?: number;
}

interface Props {
  modelValue: boolean;
  report: LearningReport;
  loading?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['update:modelValue', 'continue']);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const lsbClass = computed(() => {
  const lsb = props.report?.lsb ?? 0;
  if (lsb < 0) return 'negative';
  if (lsb < 20) return 'low';
  if (lsb > 40) return 'high';
  return 'normal';
});

const lsbIcon = computed(() => {
  const lsb = props.report?.lsb ?? 0;
  if (lsb < 0) return '😔';
  if (lsb < 20) return '😐';
  if (lsb > 40) return '🌟';
  return '😊';
});

const formatLSB = (lsb: number) => {
  if (lsb === undefined || lsb === null) return '0.0';
  const sign = lsb > 0 ? '+' : '';
  return `${sign}${lsb.toFixed(1)}`;
};

const getLSSClass = (lss: number) => {
  if (lss > 70) return 'high';
  if (lss > 50) return 'medium';
  return 'low';
};

const getLSSColor = (lss: number) => {
  if (lss > 70) return '#f56c6c';
  if (lss > 50) return '#e6a23c';
  return '#67c23a';
};

const getLFClass = (lf: number) => {
  if (lf > 70) return 'high';
  if (lf > 40) return 'medium';
  return 'low';
};

const getLFColor = (lf: number) => {
  if (lf > 70) return '#f56c6c';
  if (lf > 40) return '#e6a23c';
  return '#67c23a';
};

const handleClose = () => {
  emit('update:modelValue', false);
};

const handleContinue = () => {
  emit('continue');
  emit('update:modelValue', false);
};
</script>

<style scoped>
.learning-report-dialog .el-dialog__body {
  padding: 20px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: #606266;
}

.report-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.lsb-summary {
  text-align: center;
  padding: 24px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%);
}

.lsb-summary.negative {
  background: linear-gradient(135deg, #fef0f0 0%, #fde2e2 100%);
}

.lsb-summary.low {
  background: linear-gradient(135deg, #fdf6ec 0%, #faecd8 100%);
}

.lsb-summary.high {
  background: linear-gradient(135deg, #f0f9eb 0%, #e1f3d8 100%);
}

.lsb-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.lsb-value {
  font-size: 48px;
  font-weight: 700;
  color: #303133;
}

.lsb-summary.negative .lsb-value {
  color: #f56c6c;
}

.lsb-summary.low .lsb-value {
  color: #e6a23c;
}

.lsb-summary.high .lsb-value {
  color: #67c23a;
}

.lsb-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}

.reasoning-section,
.suggestion-section {
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.reasoning-section h4,
.suggestion-section h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.reasoning-section p,
.suggestion-section p {
  margin: 0;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.metrics-collapse {
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.metrics-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 13px;
  color: #909399;
}

.metric-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.metric-value.high {
  color: #f56c6c;
}

.metric-value.medium {
  color: #e6a23c;
}

.metric-value.low {
  color: #67c23a;
}

.formula-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  margin-top: 12px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
}
</style>
