<template>
  <!-- 虚拟学习者压测参数（2026-10-13 自「虚拟学习者」页迁入「模型与接入 → 虚拟学习者」页签）：
       三块可独立保存的设置同屏——速率上限 / 最高并发 / 日期模拟；分组由分段控件（.mk-seg）切换，
       写控件与只读 KPI（留在原页）分离。搬迁理由：最高并发属「模型与接入」侧的上游容量治理，
       与其余接入/路由设置同处管理；虚拟学习者页只管「启动多少」，上限由本页统一管控。 -->
  <div class="mk-card vl-settings">
    <div class="mk-card__head">
      <h3 class="mk-card__title">压测参数</h3>
      <div class="mk-card__head-right">
        <div class="mk-seg" role="group" aria-label="压测参数视图">
          <button
            type="button"
            class="mk-seg__item"
            :class="{ 'mk-seg__item--active': settingsTab === 'rate' }"
            :aria-pressed="settingsTab === 'rate'"
            @click="settingsTab = 'rate'"
          >速率上限</button>
          <button
            type="button"
            class="mk-seg__item"
            :class="{ 'mk-seg__item--active': settingsTab === 'concurrency' }"
            :aria-pressed="settingsTab === 'concurrency'"
            @click="settingsTab = 'concurrency'"
          >最高并发</button>
          <button
            type="button"
            class="mk-seg__item"
            :class="{ 'mk-seg__item--active': settingsTab === 'date' }"
            :aria-pressed="settingsTab === 'date'"
            @click="settingsTab = 'date'"
          >
            日期模拟<span v-if="dateSimEnabled" class="vl-settings__on">已开启</span>
          </button>
        </div>
      </div>
    </div>

    <div v-show="settingsTab === 'rate'" class="vl-settings__pane">
      <label
        class="mk-field mk-field--row"
        title="虚拟学习者专属出站上限（每分钟调用数）。与平台全局速率相互独立，不挤占真实用户额度"
      >
        <span class="mk-field__label">出站速率上限</span>
        <span class="vl-rpm__ctl">
          <input
            v-model.number="rpmInput"
            type="number"
            min="0"
            max="100000"
            step="10"
            class="mk-filter__input vl-rpm__input"
            aria-label="虚拟学习者专属出站 RPM 上限"
            :disabled="loadFailed"
            :title="loadFailed ? LOAD_FAILED_EDIT_TITLE : undefined"
            @input="rpmDirty = true"
            @keydown.enter.prevent="saveRpm"
          />
          <span class="vl-rpm__unit">/分</span>
        </span>
      </label>
      <button type="button" class="mk-btn mk-btn--sm" :disabled="!rpmDirty || saving === 'rpm' || loadFailed" @click="saveRpm">
        {{ saving === 'rpm' ? '保存中…' : '保存' }}
      </button>
      <span v-if="rpmDirty" class="vl-rpm__dirty">未保存</span>
      <span v-if="loadFailed" class="vl-rpm__failed" role="alert">{{ LOAD_FAILED_SAVE_NOTE }}</span>
      <span v-else class="vl-rpm__hint">虚拟学习者专属 · 0 为不限 · 不占真实用户额度</span>
    </div>

    <div v-show="settingsTab === 'concurrency'" class="vl-settings__pane">
      <label
        class="mk-field mk-field--row"
        title="同时在跑的自动驾驶会话数上限。超出即排队（先到先服务），有空位自动开始运行。与「速率上限」相互独立"
      >
        <span class="mk-field__label">最高并发</span>
        <span class="vl-rpm__ctl">
          <input
            v-model.number="concurrencyInput"
            type="number"
            min="1"
            max="200"
            step="1"
            class="mk-filter__input vl-rpm__input"
            aria-label="自动驾驶最高并发上限"
            :disabled="loadFailed"
            :title="loadFailed ? LOAD_FAILED_EDIT_TITLE : undefined"
            @input="concurrencyDirty = true"
            @keydown.enter.prevent="saveConcurrency"
          />
          <span class="vl-rpm__unit">个会话</span>
        </span>
      </label>
      <button type="button" class="mk-btn mk-btn--sm" :disabled="!concurrencyDirty || saving === 'limit' || loadFailed" @click="saveConcurrency">
        {{ saving === 'limit' ? '保存中…' : '保存' }}
      </button>
      <span v-if="concurrencyDirty" class="vl-rpm__dirty">未保存</span>
      <span v-if="loadFailed" class="vl-rpm__failed" role="alert">{{ LOAD_FAILED_SAVE_NOTE }}</span>
      <span v-else class="vl-rpm__hint">同时在跑会话数上限 · 1–200 · 超出按序排队，仍可继续提交启动</span>
    </div>

    <div v-show="settingsTab === 'date'" class="vl-settings__pane">
      <SimulatedDaySettings @enabled="dateSimEnabled = $event" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { errMsg } from './live'
import SimulatedDaySettings from './SimulatedDaySettings.vue'

/* ---------- 文案单源（R6 同文件复读治理）：同一句用户可见文案只在此定义一次，模板就地引用 ---------- */
const LOAD_FAILED_EDIT_TITLE = '设置未加载：为避免用默认值覆盖已保存的配置，已禁用编辑'
const LOAD_FAILED_SAVE_NOTE = '设置未加载，保存已禁用（请刷新重试）'

/** 压测参数三视图（速率上限 / 最高并发 / 日期模拟）；默认速率上限（日常位） */
const settingsTab = ref<'rate' | 'concurrency' | 'date'>('rate')
/** 日期模拟开启态（徽标）：由 SimulatedDaySettings 回传 */
const dateSimEnabled = ref(false)

/* 速率上限（RPM，0=不限）：与「最高并发」相互独立，各自保存 */
const rpmInput = ref(0)
const rpmDirty = ref(false)

/* 最高并发（自动驾驶全局并发上限，1–200） */
const concurrencyInput = ref(1)
const concurrencyDirty = ref(false)

/** 保存中位：'rpm' | 'limit' | null（两个设置块共用忙碌态文案） */
const saving = ref<'rpm' | 'limit' | null>(null)
/** 设置未加载位：getVirtualLabSettings 失败时置位——两个写控件禁用，禁止拿初始值覆盖服务端配置 */
const loadFailed = ref(false)

async function loadSettings() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const s = res.data?.data?.settings ?? {}
    const rpm = Number(s.virtualLearnerRpmLimit ?? 0)
    if (!rpmDirty.value) rpmInput.value = rpm
    const limit = Math.max(1, Number(s.autopilotConcurrencyLimit ?? 1))
    if (!concurrencyDirty.value) concurrencyInput.value = limit
    loadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置 loadFailed，控件不把「没拉到」当默认值覆盖服务端 */
    loadFailed.value = true
  }
}

async function saveRpm() {
  if (saving.value || !rpmDirty.value || loadFailed.value) return
  const value = Math.max(0, Math.min(100000, Math.round(Number(rpmInput.value) || 0)))
  rpmInput.value = value
  saving.value = 'rpm'
  try {
    await adminVirtualLearnersApi.updateVirtualLabSettings({ virtualLearnerRpmLimit: value })
    rpmDirty.value = false
    toast.success(value > 0 ? `虚拟学习者 RPM 上限已设为 ${value}` : '虚拟学习者 RPM 已设为不限')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    saving.value = null
  }
}

async function saveConcurrency() {
  if (saving.value || !concurrencyDirty.value || loadFailed.value) return
  const value = Math.max(1, Math.min(200, Math.round(Number(concurrencyInput.value) || 1)))
  concurrencyInput.value = value
  saving.value = 'limit'
  try {
    await adminVirtualLearnersApi.updateVirtualLabSettings({ autopilotConcurrencyLimit: value })
    concurrencyDirty.value = false
    toast.success(`自动驾驶最高并发已设为 ${value}`)
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    saving.value = null
  }
}

onMounted(() => {
  void loadSettings()
})
</script>

<style scoped>
/* 压测参数卡：标题与视图切换进 .mk-card__head（分段控件贴右、宽随内容），卡体只放当前设置行。
   类名沿用迁入前的 .vl-settings/.vl-rpm（页内私有前缀，非共享 .mk-*），随组件迁移。 */
.vl-settings { flex: none; }
.vl-settings__pane { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 16px 14px; }
.vl-settings__on {
  margin-left: 6px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-green);
}
.vl-rpm__ctl { display: inline-flex; align-items: center; gap: 8px; }
.vl-rpm__input { width: 84px; }
.vl-rpm__unit {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
}
.vl-rpm__dirty {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  white-space: nowrap;
}
/* 设置未加载提示（#59）：失败态红字，与「未保存」脏态区分 */
.vl-rpm__failed {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-red);
  white-space: nowrap;
}
.vl-rpm__hint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
