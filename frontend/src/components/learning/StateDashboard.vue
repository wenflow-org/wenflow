<template>
  <div class="state-dashboard">
    <!-- 当前状态卡片 -->
    <div class="state-cards">
      <!-- 认知深度 -->
      <el-card class="state-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span class="icon">🧠</span>
            <span class="title">认知深度</span>
          </div>
        </template>
        <div class="state-content">
          <el-progress
            :percentage="state.cognitive * 100"
            :format="formatDepth"
            :color="getColor(state.cognitive)"
            :stroke-width="20"
            :show-text="false"
          />
          <p class="insight">{{ stateReasoning.cognitive }}</p>
        </div>
      </el-card>

      <!-- 压力程度 -->
      <el-card class="state-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span class="icon">😌</span>
            <span class="title">压力程度</span>
          </div>
        </template>
        <div class="state-content">
          <el-progress
            :percentage="state.stress * 100"
            :format="formatStress"
            :color="getColor(state.stress, true)"
            :stroke-width="20"
            :show-text="false"
          />
          <p class="insight">{{ stateReasoning.stress }}</p>
        </div>
      </el-card>

      <!-- 投入程度 -->
      <el-card class="state-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span class="icon">🔥</span>
            <span class="title">投入程度</span>
          </div>
        </template>
        <div class="state-content">
          <el-progress
            :percentage="state.engagement * 100"
            :format="formatEngagement"
            :color="getColor(state.engagement)"
            :stroke-width="20"
            :show-text="false"
          />
          <p class="insight">{{ stateReasoning.engagement }}</p>
        </div>
      </el-card>
    </div>

    <!-- 个人基线对比 -->
    <div class="baseline-comparison">
      <h3 class="section-title">📊 个人基线 vs 当前</h3>
      <el-table :data="baselineData" style="width: 100%" size="small">
        <el-table-column prop="metric" label="指标" width="100" />
        <el-table-column prop="current" label="当前" width="80">
          <template #default="{ row }">
            <span class="current-value">{{ row.current }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="baseline" label="基线" width="80">
          <template #default="{ row }">
            <span class="baseline-value">{{ row.baseline }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="zScore" label="状态">
          <template #default="{ row }">
            <el-tag :type="getZScoreType(row.zScore)" size="small" round>
              {{ getZScoreText(row.zScore) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- AI 洞察 -->
    <div class="ai-insight">
      <el-alert
        :title="aiInsight.title"
        :type="aiInsight.type"
        :description="aiInsight.description"
        show-icon
        closable
        :closable="!state.anomaly"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StudentState, BaselineData } from '@/types/learning'

const props = defineProps<{
  state: StudentState
  baseline: BaselineData
}>()

// 格式化函数
const formatDepth = (value: number) => {
  if (value >= 0.7) return '深入思考'
  if (value >= 0.4) return '中等'
  return '浅层'
}

const formatStress = (value: number) => {
  if (value >= 0.7) return '高压力'
  if (value >= 0.4) return '适中'
  return '放松'
}

const formatEngagement = (value: number) => {
  if (value >= 0.7) return '高度投入'
  if (value >= 0.4) return '正常'
  return '较低'
}

// 获取进度条颜色
const getColor = (value: number, inverse = false) => {
  if (inverse) {
    // 压力程度：越低越好
    return value < 0.4 ? '#67c23a' : value < 0.7 ? '#e6a23c' : '#f56c6c'
  }
  // 其他指标：越高越好
  return value < 0.4 ? '#f56c6c' : value < 0.7 ? '#e6a23c' : '#67c23a'
}

// 基线数据表格
const baselineData = computed(() => [
  {
    metric: '响应时间',
    current: `${props.baseline.responseTime.current.toFixed(1)}秒`,
    baseline: `${props.baseline.responseTime.ema.toFixed(1)}秒`,
    zScore: props.baseline.responseTime.zScore
  },
  {
    metric: '消息长度',
    current: `${props.baseline.messageLength.current.toFixed(0)}字`,
    baseline: `${props.baseline.messageLength.ema.toFixed(0)}字`,
    zScore: props.baseline.messageLength.zScore
  },
  {
    metric: '互动间隔',
    current: `${props.baseline.interactionInterval.current.toFixed(1)}分`,
    baseline: `${props.baseline.interactionInterval.ema.toFixed(1)}分`,
    zScore: props.baseline.interactionInterval.zScore
  }
])

// 获取 Z-Score 标签类型
const getZScoreType = (zScore: number) => {
  if (Math.abs(zScore) > 2) return 'danger'
  if (Math.abs(zScore) > 1.5) return 'warning'
  return 'success'
}

// 获取 Z-Score 文本
const getZScoreText = (zScore: number) => {
  if (Math.abs(zScore) > 2) return '异常'
  if (Math.abs(zScore) > 1.5) return '偏离'
  return '正常'
}

// 状态推理文本
const stateReasoning = computed(() => ({
  cognitive: props.state.cognitive >= 0.7 
    ? '你正在进行深度思考，继续保持！' 
    : props.state.cognitive >= 0.4 
    ? '思考深度适中，可以尝试更深入的问题' 
    : '思考较为浅层，试着提出更有挑战性的问题',
  stress: props.state.stress >= 0.7 
    ? '压力较高，适当休息一下' 
    : props.state.stress >= 0.4 
    ? '压力适中，良好的学习状态' 
    : '状态放松，很适合学习',
  engagement: props.state.engagement >= 0.7 
    ? '高度投入，学习效率很棒！' 
    : props.state.engagement >= 0.4 
    ? '参与度正常，继续保持' 
    : '参与度较低，尝试调整学习方式'
}))

// AI 洞察
const aiInsight = computed(() => {
  if (props.state.anomaly) {
    return {
      title: '⚠️ 检测到状态异常',
      type: 'warning',
      description: `${props.state.anomalyReason || '状态异常'}。${props.state.intervention || '建议适当休息或调整学习节奏。'}`
    }
  }
  
  const cognitiveText = formatDepth(props.state.cognitive)
  const stressText = formatStress(props.state.stress)
  const engagementText = formatEngagement(props.state.engagement)
  
  return {
    title: '💡 AI 洞察',
    type: 'info',
    description: `你当前状态：${cognitiveText}思考，${stressText}压力，${engagementText}参与。${props.state.engagement >= 0.7 ? '继续保持！' : '尝试调整以达到更好的学习状态。'}`
  }
})
</script>

<style scoped>
.state-dashboard {
  padding: 10px;
}

/* 状态卡片区域 */
.state-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-bottom: 20px;
}

.state-card {
  transition: all 0.3s ease;
}

.state-card:hover {
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon {
  font-size: 20px;
}

.title {
  font-weight: 600;
  font-size: 14px;
}

.state-content {
  padding: 10px 0;
}

.insight {
  font-size: 12px;
  color: #666;
  margin-top: 12px;
  line-height: 1.5;
}

/* 基线对比区域 */
.baseline-comparison {
  margin-bottom: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #303133;
}

.current-value {
  font-weight: 600;
  color: #409eff;
}

.baseline-value {
  color: #909399;
}

/* AI 洞察区域 */
.ai-insight {
  max-width: 100%;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .state-cards {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  
  .baseline-comparison {
    overflow-x: auto;
  }
}
</style>
