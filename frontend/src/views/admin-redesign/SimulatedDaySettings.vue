<template>
  <div class="sd-settings">
    <div
      class="sd-settings__head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded ? 'true' : 'false'"
      title="展开/收起日期模拟设置"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
    >
      <span class="sd-settings__title">日期模拟</span>
      <span class="sd-settings__arrow" :data-open="expanded ? 'true' : 'false'" aria-hidden="true">▸</span>
      <label class="sd-switch" :title="form.enabled ? '已开启：允许按自然日推进虚拟学习' : '默认关闭，现网零变化'" @click.stop @keydown.stop>
        <input v-model="form.enabled" type="checkbox" @change="onToggleEnabled" />
        <span>{{ form.enabled ? '已开启' : '已关闭' }}</span>
      </label>
    </div>
    <div v-show="expanded" class="sd-settings__grid">
      <label class="mk-field">
        <span class="mk-field__label">每日时长上限（分钟）</span>
        <input v-model.number="form.defaultDailyMinutesCap" type="number" min="5" max="480" class="mk-field__input" @input="dirty = true" />
      </label>
      <label class="mk-field">
        <span class="mk-field__label">每周学习天数（0=不限）</span>
        <input v-model.number="form.defaultDaysPerWeek" type="number" min="0" max="7" class="mk-field__input" @input="dirty = true" />
      </label>
      <label class="mk-field">
        <span class="mk-field__label">每次推进天数</span>
        <input v-model.number="form.defaultPaceDaysPerAdvance" type="number" min="1" max="30" class="mk-field__input" @input="dirty = true" />
      </label>
      <label class="mk-field">
        <span class="mk-field__label">单会话最多模拟天数</span>
        <input v-model.number="form.maxSimulatedDays" type="number" min="1" max="365" class="mk-field__input" @input="dirty = true" />
      </label>
    </div>
    <div class="sd-weekdays">
      <span class="mk-field__label">上课星期</span>
      <label v-for="d in WEEKDAYS" :key="d.value" class="sd-weekday">
        <input v-model="form.courseWeekdays" type="checkbox" :value="d.value" @change="dirty = true" />
        {{ d.label }}
      </label>
    </div>
    <div class="sd-settings__grid">
      <label class="mk-field">
        <span class="mk-field__label">每天安排几节</span>
        <input v-model.number="form.lessonsPerDay" type="number" min="1" max="10" class="mk-field__input" @input="dirty = true" />
      </label>
      <label class="sd-switch" title="开启后由后台调度按课表自动推进（仅时钟簿记；当天任务重放归系统层）">
        <input v-model="form.autoAdvanceEnabled" type="checkbox" @change="dirty = true" />
        <span>允许自动推进</span>
      </label>
    </div>
    <div class="sd-settings__foot">
      <span class="sd-settings__hint">默认关闭；只对虚拟学习者生效，不影响真实用户。</span>
      <button type="button" class="mk-btn mk-btn--primary" :disabled="!dirty || saving" @click="save">
        {{ saving ? '保存中…' : '保存日期模拟设置' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { errMsg } from './live'

const DEFAULT = {
  enabled: false,
  defaultDailyMinutesCap: 45,
  defaultDaysPerWeek: 5,
  defaultPaceDaysPerAdvance: 1,
  maxSimulatedDays: 90,
  courseWeekdays: [1, 2, 3, 4, 5],
  lessonsPerDay: 1,
  autoAdvanceEnabled: false,
}

const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
]

const form = reactive({ ...DEFAULT })
const dirty = ref(false)
const saving = ref(false)
/** 设置体默认收起（虚拟学习者页首屏让位给列表；用户反馈：常开占 400px 高）。
    开启「日期模拟」开关或已有开启配置时自动展开，避免开关与表单分离找不到 */
const expanded = ref(false)
function onToggleEnabled() {
  dirty.value = true
  if (form.enabled) expanded.value = true
}

function apply(raw: Partial<typeof DEFAULT> | null | undefined) {
  form.enabled = raw?.enabled === true
  if (form.enabled) expanded.value = true
  form.defaultDailyMinutesCap = Number(raw?.defaultDailyMinutesCap ?? DEFAULT.defaultDailyMinutesCap)
  form.defaultDaysPerWeek = Number(raw?.defaultDaysPerWeek ?? DEFAULT.defaultDaysPerWeek)
  form.defaultPaceDaysPerAdvance = Number(raw?.defaultPaceDaysPerAdvance ?? DEFAULT.defaultPaceDaysPerAdvance)
  form.maxSimulatedDays = Number(raw?.maxSimulatedDays ?? DEFAULT.maxSimulatedDays)
  form.courseWeekdays = Array.isArray(raw?.courseWeekdays) && raw!.courseWeekdays.length
    ? [...raw!.courseWeekdays]
    : [...DEFAULT.courseWeekdays]
  form.lessonsPerDay = Number(raw?.lessonsPerDay ?? DEFAULT.lessonsPerDay)
  form.autoAdvanceEnabled = raw?.autoAdvanceEnabled === true
}

async function load() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const settings = (res.data?.data ?? res.data)?.settings ?? {}
    apply(settings.dateSimulation)
    dirty.value = false
  } catch { /* 保留默认 */ }
}

async function save() {
  saving.value = true
  try {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || min)))
    const payload = {
      enabled: form.enabled,
      defaultDailyMinutesCap: clamp(form.defaultDailyMinutesCap, 5, 480),
      defaultDaysPerWeek: clamp(form.defaultDaysPerWeek, 0, 7),
      defaultPaceDaysPerAdvance: clamp(form.defaultPaceDaysPerAdvance, 1, 30),
      maxSimulatedDays: clamp(form.maxSimulatedDays, 1, 365),
      courseWeekdays: [...form.courseWeekdays].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b),
      lessonsPerDay: clamp(form.lessonsPerDay, 1, 10),
      autoAdvanceEnabled: form.autoAdvanceEnabled,
    }
    const res = await adminVirtualLearnersApi.updateVirtualLabSettings({ dateSimulation: payload })
    apply((res.data?.data ?? res.data)?.settings?.dateSimulation)
    dirty.value = false
    toast.success(payload.enabled ? '日期模拟已开启' : '日期模拟已关闭')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.sd-settings { border: 1px solid var(--mk-line); border-radius: 8px; padding: 10px 12px; margin-top: 8px; }
/* 折叠头是 role=button 的整行开关，高度原来等于 13px 文字行高（~19px），低于 24px 可点下限 */
.sd-settings__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; cursor: pointer; }
.sd-settings__arrow { color: var(--mk-faint, #6b7c96); font-size: var(--mk-fs-micro); transition: transform 0.15s ease; }
.sd-settings__arrow[data-open='true'] { transform: rotate(90deg); }
.sd-settings__title { font-weight: 600; font-size: var(--mk-fs-body); }
.sd-switch { display: flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); cursor: pointer; }
.sd-settings__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; margin-top: 8px; }
.sd-settings__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.sd-settings__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sd-weekdays { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; font-size: var(--mk-fs-micro); }
.sd-weekday { display: flex; align-items: center; gap: 4px; cursor: pointer; }
</style>
