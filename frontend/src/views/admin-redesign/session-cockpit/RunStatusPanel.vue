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

    <!-- 驱动器行（2026-10-19 运营走查）：排队位置与心跳年龄。运行中此前只有下面四行阶段点阵，
         没有任何「还在动」的证据 —— 运营分不出「在跑」与「在跑但卡住」，也不知道队列排第几位。
         复用状态行的外观（同一张卡里的同类信息不该长两样），warn 档是新增的语义色。 -->
    <div v-if="driver" class="cp-run__autopilot-result" :class="`cp-run__autopilot-result--${driver.tone}`" :title="driver.title">{{ driver.text }}</div>

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
          <option value="">默认（系统分配）</option>
          <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <span class="cp-run__budget-hint" title="模型在会话启动时已确定，中途修改不生效，需重跑或新建会话">重跑生效</span>
      </label>
      <!-- 实验/采样开关（2026-10-21）：此前只存在于驱动脚本的 API 调用里，管理端无处可设。
           三项都不改默认行为：臂标签只做对照，延伸探针每会话一次，建议处置只留痕。 -->
      <label v-if="!isBlackbox" class="cp-run__budget">
        实验臂
        <select v-model="armValue" class="mk-filter__select" :disabled="flagsSaving" title="冻结考卷双臂协议（#85）：A=护栏前统计方式 / B=现行统计方式 / 默认=不加标签">
          <option value="">默认</option>
          <option value="A">A 臂</option>
          <option value="B">B 臂</option>
        </select>
      </label>
      <label v-if="!isBlackbox" class="cp-run__budget">
        延伸探针
        <input v-model="probeValue" type="checkbox" :disabled="flagsSaving" title="下一次正课完成时强制开一节延伸课（每会话一次），用于验证延伸学链路。默认关">
      </label>
      <label v-if="!isBlackbox" class="cp-run__budget">
        建议处置
        <select v-model="advValue" class="mk-filter__select" :disabled="flagsSaving" title="完成时带回重排建议时，按学员视角记录的处置动作（只留痕，不执行重排）">
          <option value="">不记录</option>
          <option value="keep">保留</option>
          <option value="later">稍后再看</option>
          <option value="preview">预览</option>
        </select>
      </label>
      <button v-if="!isBlackbox" type="button" class="mk-btn mk-btn--sm" :disabled="flagsSaving" @click="emit('saveFlags')">
        {{ flagsSaving ? '保存中…' : '保存实验设置' }}
      </button>
      <span v-if="showPathReadiness" class="cp-run__readiness" :class="`cp-run__readiness--${pathReadinessTone}`">{{ pathReadinessText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { stageFlow, type StageKey } from '../cockpitStages'
import type { AutopilotDriverLine } from '../cockpitAutopilot'

const props = defineProps<{
  autopilotResultText: string
  autopilotRunning: boolean
  /** 可为 undefined（会话尚未拉到自动驾驶状态）；undefined 时三个 tone 类全不命中，与原内联写法一致 */
  autopilotStatus?: string
  /** 驱动器行：排队位置 / 心跳年龄；null = 当前无可说的（idle 或终态已在结果行说过） */
  driver?: AutopilotDriverLine | null
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
  /** 实验臂（#85）：''=不加标签 */
  experimentArm: '' | 'A' | 'B'
  /** 延伸学探针（#124）：每会话一次强制开延伸课 */
  extensionProbe: boolean
  /** 建议处置采样：''=不记录 */
  advisoryResponse: '' | 'keep' | 'later' | 'preview'
  flagsSaving: boolean
}>()

const emit = defineEmits<{
  (e: 'saveFriction'): void
  (e: 'saveModel'): void
  (e: 'saveFlags'): void
  (e: 'update:frictionBudget', v: 'none' | 'low' | 'normal' | 'high' | 'stress_test'): void
  (e: 'update:simModel', v: string): void
  (e: 'update:experimentArm', v: '' | 'A' | 'B'): void
  (e: 'update:extensionProbe', v: boolean): void
  (e: 'update:advisoryResponse', v: '' | 'keep' | 'later' | 'preview'): void
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
const armValue = computed({
  get: () => props.experimentArm,
  set: (v: '' | 'A' | 'B') => emit('update:experimentArm', v),
})
const probeValue = computed({
  get: () => props.extensionProbe,
  set: (v: boolean) => emit('update:extensionProbe', v),
})
const advValue = computed({
  get: () => props.advisoryResponse,
  set: (v: '' | 'keep' | 'later' | 'preview') => emit('update:advisoryResponse', v),
})
</script>

<style scoped>
/* ----- Run in sidebar（自 SessionCockpit.vue 随 #73 抽取随迁，两宿主共用） ----- */
.cp-run { display: grid; gap: 10px; }
.cp-run__autopilot-result { font-size: var(--mk-fs-micro); font-weight: 700; padding: 6px 10px; border-radius: 6px; background: var(--mk-surface-2); }
.cp-run__autopilot-result--ok { color: var(--mk-green, var(--mk-green-fill)); }
.cp-run__autopilot-result--warn { color: var(--mk-amber, var(--mk-amber-fill)); }
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
