<template>
  <!-- 压测参数卡·日期模拟页签体（2026-10-05 重排）：tab 承担了披露职责，原折叠头
       （标题/▸/收起摘要/v-show）退役，表单在页签内常驻；「启用日期模拟」开关升到页签体首行
       （原在折叠头上，摘折叠后必须有新家）。loadFailed 守卫不变：设置未加载时禁保存防覆盖 -->
  <div class="sd-settings">
    <label
      class="sd-switch sd-settings__enable"
      :title="form.enabled ? '已开启：允许按自然日推进虚拟学习' : '默认关闭，现网零变化'"
    >
      <!-- 可访问名（审核 #181）：label 唯一文本是状态词，读屏只听到「已关闭 复选框」不知在开关
           什么；给 input 补 aria-label 而不动 span 文案（该 span 是可见状态字，单测亦锁定其文本） -->
      <input v-model="form.enabled" type="checkbox" aria-label="启用日期模拟" @change="onToggleEnabled" />
      <span>{{ form.enabled ? '已开启' : '已关闭' }}</span>
    </label>
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
      <span v-if="loadFailed" class="sd-settings__hint sd-settings__hint--bad" title="设置加载失败，当前展示的是默认值；为避免用默认值覆盖服务端配置，保存已禁用，请刷新页面重试">设置未加载，保存已禁用（请刷新重试）</span>
      <span v-else class="sd-settings__hint">默认关闭；只对虚拟学习者生效，不影响真实用户。</span>
      <button type="button" class="mk-btn mk-btn--primary" :disabled="!dirty || saving || loadFailed" @click="save">
        {{ saving ? '保存中…' : '保存日期模拟设置' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { errMsg } from './live'

/** enabled 上抛宿主（2026-10-05）：压测参数卡页签标签的「已开启」徽标数据源 */
const emit = defineEmits<{ (e: 'enabled', v: boolean): void }>()

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
/* 加载失败守卫：失败时表单停在默认值，若仍允许保存，管理员一次保存就会把
   服务端已配好的值整体覆盖成默认值 → loadFailed 禁用保存并提示 */
const loadFailed = ref(false)
function onToggleEnabled() {
  dirty.value = true
}

/* enabled 任何来源的变化（手动开关/服务端回填）都同步页签徽标 */
watch(() => form.enabled, (v) => emit('enabled', v), { immediate: true })

function apply(raw: Partial<typeof DEFAULT> | null | undefined) {
  form.enabled = raw?.enabled === true
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
    loadFailed.value = false
  } catch {
    /* 加载失败：不能静默留在默认值（保存会覆盖服务端配置）→ 标记 loadFailed 禁用保存 */
    loadFailed.value = true
  }
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

// 挂载即拉设置：页签体 v-show 常驻挂载（非 v-if），开卡即取服务端配置供页签徽标与表单
onMounted(load)
</script>

<style scoped>
/* 页签体布局（2026-10-05 tab 化）：披露职责归 .tabs 页签，本体纵向栅格一屏排开；
   flex:1 吃满页签行（否则 flex 子项收 max-content，四格设置不并排、卡右侧留白） */
.sd-settings { display: grid; gap: 10px; flex: 1 1 auto; min-width: 0; }
/* 「启用日期模拟」开关行（原折叠头迁位）：开关+状态文字自成一行 */
.sd-settings__enable { font-size: var(--mk-fs-body); }
.sd-settings__enable span { font-weight: 700; }
/* 设置格：auto-fit 四格并排（1106px 卡宽下 4 列），窄档自动降列 */
.sd-settings__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; }
.sd-weekdays { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: var(--mk-fs-micro); }
.sd-weekday { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.sd-settings__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sd-settings__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sd-settings__hint--bad { color: var(--mk-red, #dc2626); }
.sd-switch { display: flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); cursor: pointer; }
</style>
