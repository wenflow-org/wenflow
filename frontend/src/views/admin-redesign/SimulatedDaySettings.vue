<template>
  <div class="sd-settings">
    <div class="sd-settings__head">
      <span class="sd-settings__title">日期模拟</span>
      <label class="sd-switch" :title="form.enabled ? '已开启：允许按自然日推进虚拟学习' : '默认关闭，现网零变化'">
        <input v-model="form.enabled" type="checkbox" @change="dirty = true" />
        <span>{{ form.enabled ? '已开启' : '已关闭' }}</span>
      </label>
    </div>
    <div class="sd-settings__grid">
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
}

const form = reactive({ ...DEFAULT })
const dirty = ref(false)
const saving = ref(false)

function apply(raw: any) {
  form.enabled = raw?.enabled === true
  form.defaultDailyMinutesCap = Number(raw?.defaultDailyMinutesCap ?? DEFAULT.defaultDailyMinutesCap)
  form.defaultDaysPerWeek = Number(raw?.defaultDaysPerWeek ?? DEFAULT.defaultDaysPerWeek)
  form.defaultPaceDaysPerAdvance = Number(raw?.defaultPaceDaysPerAdvance ?? DEFAULT.defaultPaceDaysPerAdvance)
  form.maxSimulatedDays = Number(raw?.maxSimulatedDays ?? DEFAULT.maxSimulatedDays)
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
.sd-settings { border: 1px solid var(--mk-border, #e5e5e5); border-radius: 8px; padding: 10px 12px; margin-top: 8px; }
.sd-settings__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sd-settings__title { font-weight: 600; font-size: 13px; }
.sd-switch { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.sd-settings__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; margin-top: 8px; }
.sd-settings__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.sd-settings__hint { font-size: 12px; color: var(--mk-text-muted, #888); }
</style>
