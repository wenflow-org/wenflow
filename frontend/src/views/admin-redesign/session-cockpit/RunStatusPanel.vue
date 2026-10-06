<template>
  <!-- 运行状态内芯（审核 #73 去重）：自动驾驶结果 + 阶段进度 + 难度/模型/就绪 foot。
       此前同一份 ~40 行标记在「Learn 阶段卡」与「折叠运维面板」各写一遍，仅外层壳不同。
       行为契约：阶段行恒渲染（两个宿主的外层条件都已排除 real 模式，原第二处的
       v-if="!isRealMode" 是恒真冗余）；难度/模型两个 select 仅非黑盒模式渲染
       （宿主传入 isBlackbox 即可，real 模式在两个宿主外层都已被排除）。 -->
  <div class="cp-run">
    <!-- 自动驾驶结果 -->
    <div v-if="autopilotResultText && !autopilotRunning" class="cp-run__autopilot-result" :class="{
      'cp-run__autopilot-result--ok': autopilotStatus === 'completed',
      'cp-run__autopilot-result--bad': autopilotStatus === 'failed' || autopilotStatus === 'incomplete',
      'cp-run__autopilot-result--muted': autopilotStatus === 'stopped'
    }">{{ autopilotResultText }}</div>

    <!-- 阶段进度指示 -->
    <div class="cp-run__stages">
      <div class="cp-run__stage-row" v-for="st in stageFlow" :key="st">
        <span class="cp-run__stage-dot" :class="`cp-run__stage-dot--${stageDone(st) ? 'done' : stageActive(st) ? 'active' : 'pending'}`"></span>
        <span class="cp-run__stage-label">{{ stageLabel(st) }}</span>
        <span class="cp-run__stage-status">{{ stageMiniStatus(st) }}</span>
      </div>
    </div>

    <!-- 难度 -->
    <div class="cp-run__foot">
      <label v-if="!isBlackbox" class="cp-run__budget">
        难度
        <select v-model="frictionValue" class="mk-filter__select" :disabled="frictionSaving" @change="emit('saveFriction')">
          <option value="none">无</option>
          <option value="low">低</option>
          <option value="normal">正常</option>
          <option value="high">高</option>
          <option value="stress_test">压力测试</option>
        </select>
      </label>
      <label v-if="!isBlackbox" class="cp-run__budget">
        模型
        <select v-model="simModelValue" class="mk-filter__select" :disabled="simModelSaving" @change="emit('saveModel')">
          <option value="">默认（路由）</option>
          <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <span class="cp-run__budget-hint" title="实验快照在会话启动时捕获，模型变更需重跑（rerun）或新会话才生效">重跑生效</span>
      </label>
      <span v-if="showPathReadiness" class="cp-run__readiness" :class="`cp-run__readiness--${pathReadinessTone}`">{{ pathReadinessText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { stageFlow, type StageKey } from '../cockpitStages'

const props = defineProps<{
  autopilotResultText: string
  autopilotRunning: boolean
  /** 可为 undefined（会话尚未拉到自动驾驶状态）；undefined 时三个 tone 类全不命中，与原内联写法一致 */
  autopilotStatus?: string
  stageDone: (st: StageKey) => boolean
  stageActive: (st: StageKey) => boolean
  stageMiniStatus: (st: StageKey) => string
  stageLabel: (st: StageKey) => string
  isBlackbox: boolean
  showPathReadiness: boolean
  pathReadinessTone: string
  pathReadinessText: string
  availableModels: string[]
  frictionBudget: 'none' | 'low' | 'normal' | 'high' | 'stress_test'
  frictionSaving: boolean
  simModel: string
  simModelSaving: boolean
}>()

const emit = defineEmits<{
  (e: 'saveFriction'): void
  (e: 'saveModel'): void
  (e: 'update:frictionBudget', v: 'none' | 'low' | 'normal' | 'high' | 'stress_test'): void
  (e: 'update:simModel', v: string): void
}>()

/* v-model 双向（显式 computed 而非 defineModel：emit 类型收窄成非 undefined，宿主 ref<string> 直接可接） */
const frictionValue = computed({
  get: () => props.frictionBudget,
  set: (v: 'none' | 'low' | 'normal' | 'high' | 'stress_test') => emit('update:frictionBudget', v),
})
const simModelValue = computed({
  get: () => props.simModel,
  set: (v: string) => emit('update:simModel', v),
})
</script>

<style scoped>
/* ----- Run in sidebar（自 SessionCockpit.vue 随 #73 抽取随迁，两宿主共用） ----- */
.cp-run { display: grid; gap: 10px; }
.cp-run__autopilot-result { font-size: var(--mk-fs-micro); font-weight: 700; padding: 6px 10px; border-radius: 6px; background: var(--mk-surface-2); }
.cp-run__autopilot-result--ok { color: var(--mk-green, var(--mk-green-fill)); }
.cp-run__autopilot-result--bad { color: var(--mk-red, var(--mk-red-strong)); }
.cp-run__autopilot-result--muted { color: var(--mk-muted); }

/* 阶段进度指示 */
.cp-run__stages {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  background: var(--mk-surface-2);
  border-radius: var(--mk-radius-sm);
}
.cp-run__stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-micro);
}
.cp-run__stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cp-run__stage-dot--done { background: var(--mk-green); }
.cp-run__stage-dot--active { background: var(--mk-blue); }
.cp-run__stage-dot--pending { background: var(--mk-line); }
.cp-run__stage-label {
  font-weight: 700;
  color: var(--mk-ink);
  width: 40px;
  flex-shrink: 0;
}
.cp-run__stage-status {
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
}

.cp-run__foot {
  display: grid;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--mk-line);
}
.cp-run__budget { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-run__budget-hint { font-weight: 400; font-size: var(--mk-fs-micro); color: var(--mk-faint); cursor: help; }
.cp-run__budget select { min-width: 90px; font-size: var(--mk-fs-micro); }
.cp-run__readiness { font-size: var(--mk-fs-micro); font-weight: 700; }
.cp-run__readiness--ok { color: var(--mk-green, var(--mk-green-fill)); }
.cp-run__readiness--pending { color: var(--mk-amber, var(--mk-amber-fill)); }
.cp-run__readiness--bad { color: var(--mk-red, var(--mk-red-strong)); }

/* 暗色档（自 SessionCockpit.vue 随迁）：内芯两块底色比卡面（#202124）再暗一档 */
html[data-theme='dark'] .cp-run__autopilot-result { background: #19191a; }
html[data-theme='dark'] .cp-run__stages { background: #19191a; }
</style>
