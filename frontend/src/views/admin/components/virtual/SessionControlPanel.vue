<template>
  <div class="session-control-panel">
    <div class="control-panel__head">
      <span class="control-panel__title">运行控制</span>
      <el-tag :type="statusTagType" size="small">{{ statusLabel }}</el-tag>
    </div>

    <!-- 失败/完成提示 -->
    <div v-if="status === 'failed'" class="control-panel__notice control-panel__notice--error">
      <el-icon><WarningFilled /></el-icon>
      <span>会话已失败</span>
    </div>
    <div v-else-if="status === 'completed'" class="control-panel__notice control-panel__notice--success">
      <el-icon><CircleCheckFilled /></el-icon>
      <span>会话已完成</span>
    </div>

    <!-- 主动作: 单步 / 全自动 / 停止 -->
    <div class="control-panel__main-actions">
      <button
        type="button"
        class="action-btn action-btn--primary"
        :disabled="!canStep || anyLoading"
        @click="$emit('step')"
      >
        <el-icon v-if="loadingStep" class="is-loading"><Loading /></el-icon>
        <el-icon v-else><CaretRight /></el-icon>
        <span>单步</span>
        <em>{{ stepHint }}</em>
      </button>

      <button
        type="button"
        class="action-btn action-btn--auto"
        :disabled="!canAuto || anyLoading"
        @click="$emit('auto')"
      >
        <el-icon v-if="loadingAuto" class="is-loading"><Loading /></el-icon>
        <el-icon v-else><VideoPlay /></el-icon>
        <span>全自动</span>
        <em>{{ autoHint }}</em>
      </button>

      <button
        type="button"
        class="action-btn action-btn--danger"
        :disabled="!canStop"
        @click="$emit('stop')"
      >
        <el-icon><VideoPause /></el-icon>
        <span>停止</span>
        <em>当前轮跑完后</em>
      </button>
    </div>

    <!-- 阶段控制: 桥接动作 -->
    <div v-if="bridgeActions.length" class="control-panel__bridge">
      <span class="bridge__label">阶段桥接</span>
      <div class="bridge__buttons">
        <el-button
          v-for="b in bridgeActions"
          :key="b.action"
          size="small"
          :type="b.type"
          plain
          :disabled="!b.enabled || anyLoading"
          @click="$emit(b.action as any)"
        >
          {{ b.label }}
        </el-button>
      </div>
    </div>

    <!-- 配置 -->
    <details class="control-panel__config">
      <summary>
        <el-icon><Setting /></el-icon>
        <span>配置</span>
      </summary>
      <div class="config-form">
        <div class="config-row">
          <label>对抗预算</label>
          <el-select
            v-model="localConfig.frictionBudget"
            size="small"
            style="width: 130px"
            @change="emitConfig"
          >
            <el-option label="完全合作" value="none" />
            <el-option label="低 (微顾虑)" value="low" />
            <el-option label="正常 (默认)" value="normal" />
            <el-option label="高 (压力大)" value="high" />
            <el-option label="压测模式" value="stress_test" />
          </el-select>
        </div>
        <div class="config-row">
          <label>Goal 最大轮数</label>
          <el-input-number v-model="localConfig.maxRounds" :min="1" :max="50" size="small" controls-position="right" @change="emitConfig" />
        </div>
        <div class="config-row">
          <label>Learn 最大里程碑</label>
          <el-input-number v-model="localConfig.maxMilestones" :min="1" :max="30" size="small" controls-position="right" @change="emitConfig" />
        </div>
        <div class="config-row config-row--switch">
          <label>跑完 Goal 自动进 Path</label>
          <el-switch v-model="localConfig.autoAdvanceToPath" @change="emitConfig" />
        </div>
        <div class="config-row config-row--switch">
          <label>Path 生成后自动进 Learn</label>
          <el-switch v-model="localConfig.autoAdvanceToLearning" @change="emitConfig" />
        </div>
        <div class="config-row config-row--switch">
          <label>Task 完成后继续下一个</label>
          <el-switch v-model="localConfig.continueOnTaskComplete" @change="emitConfig" />
        </div>
      </div>
    </details>

    <!-- 危险操作 -->
    <details class="control-panel__danger">
      <summary>
        <el-icon><Warning /></el-icon>
        <span>重置操作</span>
      </summary>
      <div class="danger-form">
        <el-button size="small" :disabled="!canResetPath || anyLoading" @click="$emit('resetPath')">重建 Path</el-button>
        <el-button size="small" :disabled="!canResetLearn || anyLoading" @click="$emit('resetLearn')">重启 Learn</el-button>
        <el-button size="small" type="danger" plain :disabled="anyLoading" @click="$emit('deleteSession')">删除会话</el-button>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { CaretRight, VideoPlay, VideoPause, Setting, Warning, Loading, WarningFilled, CircleCheckFilled } from '@element-plus/icons-vue'

interface CockpitConfig {
  maxRounds: number
  maxMilestones: number
  autoAdvanceToPath: boolean
  autoAdvanceToLearning: boolean
  continueOnTaskComplete: boolean
  frictionBudget: 'none' | 'low' | 'normal' | 'high' | 'stress_test'
}

const props = defineProps<{
  currentStage: 'goal' | 'path' | 'learning' | 'wrapup' | string
  status: string
  goalReady: boolean
  pathReady: boolean
  learningStarted: boolean
  config: CockpitConfig
  loadingStep?: boolean
  loadingAuto?: boolean
  loadingBridge?: boolean
}>()

const emit = defineEmits<{
  (e: 'step'): void
  (e: 'auto'): void
  (e: 'stop'): void
  (e: 'advancePath'): void
  (e: 'startLearning'): void
  (e: 'resetPath'): void
  (e: 'resetLearn'): void
  (e: 'deleteSession'): void
  (e: 'update:config', value: CockpitConfig): void
}>()

const localConfig = reactive<CockpitConfig>({ ...props.config })

watch(() => props.config, (next) => {
  Object.assign(localConfig, next)
}, { deep: true })

const emitConfig = () => emit('update:config', { ...localConfig })

const anyLoading = computed(() => !!(props.loadingStep || props.loadingAuto || props.loadingBridge))

const statusTagType = computed(() => {
  switch (props.status) {
    case 'running': return 'primary'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    default: return 'info'
  }
})

const statusLabel = computed(() => {
  switch (props.status) {
    case 'created': return '已创建'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return props.status || '未知'
  }
})

const canStep = computed(() => {
  if (props.status === 'completed' || props.status === 'failed') return false
  if (props.currentStage === 'goal') return !props.goalReady
  if (props.currentStage === 'learning') return true
  return false
})

const canAuto = computed(() => {
  if (props.status === 'completed' || props.status === 'failed') return false
  if (props.currentStage === 'goal') return !props.goalReady
  if (props.currentStage === 'learning') return true
  return false
})

const canStop = computed(() => props.currentStage === 'learning' && props.status === 'running')

const stepHint = computed(() => {
  if (props.currentStage === 'goal') return '一轮 Goal 对话'
  if (props.currentStage === 'learning') return '一轮教学'
  return '当前阶段不可单步'
})

const autoHint = computed(() => {
  if (props.currentStage === 'goal') return `跑到 Goal 收敛 (≤${localConfig.maxRounds}轮)`
  if (props.currentStage === 'learning') return `跑到 task 完成 (≤${localConfig.maxMilestones} milestones)`
  return '当前阶段不可自动'
})

const canResetPath = computed(() => props.pathReady || props.status === 'failed')
const canResetLearn = computed(() => props.learningStarted || props.status === 'failed')

const bridgeActions = computed(() => {
  const list: Array<{ action: string; label: string; enabled: boolean; type: string }> = []
  if (props.currentStage === 'goal' || (props.currentStage === 'path' && !props.pathReady)) {
    list.push({
      action: 'advancePath',
      label: '生成 Path',
      enabled: props.goalReady && !props.pathReady,
      type: 'primary'
    })
  }
  if (props.currentStage === 'path' && props.pathReady) {
    list.push({
      action: 'startLearning',
      label: '开始 Learn',
      enabled: !props.learningStarted,
      type: 'primary'
    })
  }
  return list
})
</script>

<style scoped>
.session-control-panel {
  display: grid;
  gap: 14px;
  padding: 14px;
  background: var(--admin-bg-surface);
  border: 1px solid #e1e8f2;
  border-radius: 12px;
}

.control-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.control-panel__title {
  font-size: 13px;
  font-weight: 800;
  color: #1a2a44;
  letter-spacing: 0.5px;
}

.control-panel__main-actions {
  display: grid;
  gap: 8px;
}

.control-panel__notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.control-panel__notice--error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.control-panel__notice--success {
  background: #ecfdf5;
  color: #15803d;
  border: 1px solid #bbf7d0;
}

.action-btn {
  display: grid;
  grid-template-columns: 18px 1fr;
  grid-template-rows: auto auto;
  grid-template-areas:
    'icon label'
    'icon hint';
  align-items: center;
  gap: 2px 10px;
  padding: 10px 14px;
  background: #f6f9ff;
  border: 1px solid #d6e3fc;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  color: #1a2a44;
  text-align: left;
  transition: all 0.18s;
}

.action-btn > .el-icon {
  grid-area: icon;
  font-size: 18px;
}

.action-btn > span {
  grid-area: label;
  font-size: 13px;
  font-weight: 700;
}

.action-btn > em {
  grid-area: hint;
  font-style: normal;
  font-size: 11px;
  color: #5b6577;
}

.action-btn:not(:disabled):hover {
  border-color: #3478f6;
  background: #e8f0ff;
  transform: translateY(-1px);
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.action-btn--primary > .el-icon { color: #3478f6; }
.action-btn--auto {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border-color: #a7f3d0;
}
.action-btn--auto > .el-icon { color: #059669; }
.action-btn--auto:not(:disabled):hover {
  border-color: #059669;
  background: #d1fae5;
}

.action-btn--danger {
  background: #fef2f2;
  border-color: #fecaca;
}
.action-btn--danger > .el-icon { color: #dc2626; }
.action-btn--danger:not(:disabled):hover {
  border-color: #dc2626;
  background: #fee2e2;
}

.is-loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.control-panel__bridge {
  display: grid;
  gap: 6px;
  padding: 10px;
  background: var(--admin-color-warning-bg);
  border: 1px solid #fbe2b6;
  border-radius: 8px;
}

.bridge__label {
  font-size: 11px;
  font-weight: 700;
  color: #92400e;
  letter-spacing: 0.5px;
}

.bridge__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.control-panel__config,
.control-panel__danger {
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fafbfc;
  padding: 8px 12px;
}

.control-panel__config summary,
.control-panel__danger summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: #5b6577;
  list-style: none;
  user-select: none;
}

.control-panel__config summary::-webkit-details-marker,
.control-panel__danger summary::-webkit-details-marker {
  display: none;
}

.control-panel__danger summary {
  color: #92400e;
}

.config-form,
.danger-form {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.danger-form {
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
}

.config-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.config-row label {
  font-size: 12px;
  color: #5b6577;
}

.config-row--switch {
  justify-content: space-between;
}
</style>
