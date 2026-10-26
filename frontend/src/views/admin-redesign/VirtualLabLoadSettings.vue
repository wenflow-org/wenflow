<template>
  <!-- 虚拟学习者容量与实验环境：三项设置（专属 RPM / 最高并发 / 日期模拟）。
       卡片外壳与「保存」由宿主承担——三项是同一份设置接口，分开保存会让「改了两项只按一个」
       的另一项悄悄没生效，脏态也只跟着改过的那一项走。 -->
  <div class="vl-settings">
    <div class="vl-settings__block">
      <div class="vl-settings__label">专属 RPM 上限</div>
      <div class="vl-settings__row">
        <input
          v-model.number="rpmInput"
          type="number"
          min="0"
          max="100000"
          step="10"
          class="mk-field__input vl-rpm__input"
          aria-label="虚拟学习者专属出站 RPM 上限"
          :disabled="loadFailed"
          @input="rpmDirty = true"
        />
        <span class="vl-rpm__unit">次 / 分 · 0 = 不限</span>
        <span class="vl-settings__read">{{ rpmReadout }}</span>
      </div>
    </div>

    <div class="vl-settings__block">
      <div class="vl-settings__label">最高并发</div>
      <div class="vl-settings__row">
        <input
          v-model.number="concurrencyInput"
          type="number"
          min="1"
          max="200"
          step="1"
          class="mk-field__input vl-rpm__input"
          aria-label="自动驾驶最高并发上限"
          :disabled="loadFailed"
          @input="concurrencyDirty = true"
        />
        <span class="vl-rpm__unit">个会话 · 1–200</span>
        <span class="vl-settings__read">{{ concurrencyReadout }}</span>
      </div>
    </div>

    <!-- 日期模拟默认收起：它是一整套模拟日历（每天几节、每周几天、上课星期…），
         展开后比整张卡其余内容加起来还高。 -->
    <details class="vl-settings__block vl-settings__date">
      <summary class="vl-settings__summary">
        <span class="vl-settings__label">日期模拟</span>
      </summary>
      <SimulatedDaySettings ref="dayRef" managed @dirty="dayDirty = $event" @failed="dayLoadFailed = $event" />
    </details>

    <p v-if="failed" class="vl-rpm__failed" role="alert">设置未加载，保存已禁用（请刷新重试）</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { errMsg } from './live'
import SimulatedDaySettings from './SimulatedDaySettings.vue'

const props = withDefaults(defineProps<{
  /** 自动驾驶并发读数（used/limit/queued）：与最高并发输入行同源 */
  concurrency?: { used: number; limit: number; queued: number }
  concurrencyUnavailable?: boolean
  /** 专属出站速率读数（在途 / 排队） */
  rpm?: { inFlight: number; queued: number; rpm: number }
  rpmSavedLimit?: number
  rpmUnavailable?: boolean
}>(), {
  concurrency: () => ({ used: 0, limit: 0, queued: 0 }),
  concurrencyUnavailable: false,
  rpm: () => ({ inFlight: 0, queued: 0, rpm: 0 }),
  rpmSavedLimit: 0,
  rpmUnavailable: false
})

const emit = defineEmits<{
  (e: 'dirty', v: boolean): void
  (e: 'saving', v: boolean): void
  (e: 'failed', v: boolean): void
}>()

/* 专属 RPM（0 = 不限）：与平台全局 RPM 是两条独立上限 */
const rpmInput = ref(0)
const rpmDirty = ref(false)
/* 最高并发（自动驾驶全局并发上限，1–200） */
const concurrencyInput = ref(1)
const concurrencyDirty = ref(false)
/** 设置未加载位：getVirtualLabSettings 失败时置位——写控件禁用，禁止拿初始值覆盖服务端配置 */
const loadFailed = ref(false)
const saving = ref(false)

const dayRef = ref<InstanceType<typeof SimulatedDaySettings> | null>(null)
const dayDirty = ref(false)
const dayLoadFailed = ref(false)

const dirty = computed(() => rpmDirty.value || concurrencyDirty.value || dayDirty.value)
const failed = computed(() => loadFailed.value || dayLoadFailed.value)

/* 读数与上限输入行同源：输入框里的值就是上限，在途 / 排队挂在右侧 */
const rpmReadout = computed(() => {
  if (props.rpmUnavailable) return '读数不可用'
  const cap = props.rpmSavedLimit > 0 ? `${props.rpmSavedLimit}/分` : '不限'
  const queued = props.rpm.queued > 0 ? ` · 排队 ${props.rpm.queued}` : ''
  return `在途 ${props.rpm.inFlight} / 上限 ${cap}${queued}`
})
const concurrencyReadout = computed(() => {
  if (props.concurrencyUnavailable) return '读数不可用'
  const c = props.concurrency
  const full = c.used >= c.limit ? ' · 已满' : ''
  const queued = c.queued > 0 ? ` · 排队 ${c.queued}` : ''
  return `在跑 ${c.used} / 上限 ${c.limit}${full}${queued}`
})

watch(dirty, (v) => emit('dirty', v), { immediate: true })
watch(failed, (v) => emit('failed', v), { immediate: true })

async function loadSettings() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const s = res.data?.data?.settings ?? {}
    const rpm = Math.max(0, Number(s.virtualLearnerRpmLimit ?? 0) || 0)
    if (!rpmDirty.value) rpmInput.value = rpm
    const limit = Math.max(1, Number(s.autopilotConcurrencyLimit ?? 1))
    if (!concurrencyDirty.value) concurrencyInput.value = limit
    loadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置失败位，控件不把「没拉到」当默认值覆盖服务端 */
    loadFailed.value = true
  }
}

/** 三项一次提交：改了两项却只按一个保存的另一项，不会留在未生效状态 */
async function save() {
  if (saving.value || !dirty.value || failed.value) return
  const rpmValue = Math.max(0, Math.min(100000, Math.round(Number(rpmInput.value) || 0)))
  const limitValue = Math.max(1, Math.min(200, Math.round(Number(concurrencyInput.value) || 1)))
  rpmInput.value = rpmValue
  concurrencyInput.value = limitValue
  saving.value = true
  emit('saving', true)
  try {
    const res = await adminVirtualLearnersApi.updateVirtualLabSettings({
      virtualLearnerRpmLimit: rpmValue,
      autopilotConcurrencyLimit: limitValue,
      dateSimulation: dayRef.value?.payload()
    })
    rpmDirty.value = false
    concurrencyDirty.value = false
    const saved = res.data?.data?.settings?.dateSimulation
    dayRef.value?.markSaved(saved)
    toast.success('容量与实验环境已保存')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    saving.value = false
    emit('saving', false)
  }
}

defineExpose({ save })

onMounted(() => {
  void loadSettings()
})
</script>

<style scoped>
/* 两项设置内联进宿主的「调用参数」栅格：自身不再有卡片边框，节奏交由宿主的 ac-group 承担 */
.vl-settings { display: grid; gap: 12px; }
.vl-settings__block { display: grid; gap: 8px; min-width: 0; }
.vl-settings__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
/* 可折叠的日期模拟：summary 承担段标题，右侧给一个展开提示 */
.vl-settings__date { gap: 10px; }
.vl-settings__summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
.vl-settings__summary::-webkit-details-marker { display: none; }
.vl-settings__summary::before { content: '▸'; color: var(--mk-faint); }
.vl-settings__date[open] .vl-settings__summary::before { content: '▾'; }
.vl-settings__row { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
.vl-rpm__input { width: 84px; }
.vl-rpm__unit {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
}
/* 读数：数字等宽，与输入框同一行 */
.vl-settings__read {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 设置未加载提示（#59）：失败态红字，与「未保存」脏态区分 */
.vl-rpm__failed {
  margin: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-red);
}
</style>
