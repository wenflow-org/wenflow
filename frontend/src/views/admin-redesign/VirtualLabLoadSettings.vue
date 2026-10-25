<template>
  <!-- 虚拟学习者通道的两项容量设置（2026-10-15 用户重组）：自「模型与接入」的独立卡片，
       收进「调用与健康 → AI 调用与健康」卡的「调用参数」栅格——自动驾驶并发上限与
       日期模拟都属「调用怎么走、上游容量多少」，与同卡的出站速率同族。
       不再自带卡片外壳与分段控件（原三段视图切换：速率上限 / 最高并发 / 日期模拟）：
       速率上限已并入同卡的「出站速率」组（与平台全局上限同行，见 ApiConfig），
       本组件只剩两项，各自独立保存，分组标题由宿主的 ac-group 承担。 -->
  <div class="vl-settings">
    <div class="vl-settings__block">
      <div
        class="vl-settings__label"
        title="同时在跑的自动驾驶会话数上限，与平台全局出站速率独立"
      >最高并发</div>
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
          :title="loadFailed ? LOAD_FAILED_EDIT_TITLE : undefined"
          @input="concurrencyDirty = true"
          @keydown.enter.prevent="saveConcurrency"
        />
        <span class="vl-rpm__unit">个会话</span>
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="!concurrencyDirty || saving || loadFailed"
          @click="saveConcurrency"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <span v-if="concurrencyDirty" class="vl-rpm__dirty">未保存</span>
        <span v-if="loadFailed" class="vl-rpm__failed" role="alert">{{ LOAD_FAILED_SAVE_NOTE }}</span>
        <span v-else class="vl-rpm__hint">1–200 · 超出按序排队，仍可继续提交启动</span>
      </div>
    </div>

    <!-- 日期模拟默认收起（2026-10-20）：它是一整套模拟日历（每天几节、每周几天、上课星期…），
         展开后比整张卡其余内容加起来还高；容量页默认只需看到「有这一项」。 -->
    <details class="vl-settings__block vl-settings__date">
      <summary class="vl-settings__summary" title="把平台「当前日期」按偏移量前移/后移，用于验证跨日衰减、到期与复习节奏">
        <span class="vl-settings__label">日期模拟</span>
        <span class="vl-settings__fold vl-settings__fold--closed">展开设置</span>
        <span class="vl-settings__fold vl-settings__fold--open">收起</span>
      </summary>
      <!-- 日期模拟挪出分段视图后不再需要「已开启」角标（原角标挂在被选中的分段项上）；
           开关状态由 SimulatedDaySettings 自己的控件呈现 -->
      <SimulatedDaySettings />
    </details>
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

/* 最高并发（自动驾驶全局并发上限，1–200） */
const concurrencyInput = ref(1)
const concurrencyDirty = ref(false)
const saving = ref(false)
/** 设置未加载位：getVirtualLabSettings 失败时置位——写控件禁用，禁止拿初始值覆盖服务端配置 */
const loadFailed = ref(false)

async function loadSettings() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const s = res.data?.data?.settings ?? {}
    const limit = Math.max(1, Number(s.autopilotConcurrencyLimit ?? 1))
    if (!concurrencyDirty.value) concurrencyInput.value = limit
    loadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置 loadFailed，控件不把「没拉到」当默认值覆盖服务端 */
    loadFailed.value = true
  }
}

async function saveConcurrency() {
  if (saving.value || !concurrencyDirty.value || loadFailed.value) return
  const value = Math.max(1, Math.min(200, Math.round(Number(concurrencyInput.value) || 1)))
  concurrencyInput.value = value
  saving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLabSettings({ autopilotConcurrencyLimit: value })
    concurrencyDirty.value = false
    toast.success(`自动驾驶最高并发已设为 ${value}`)
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    saving.value = false
  }
}

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
.vl-settings__fold { margin-left: auto; font-weight: 500; color: var(--mk-faint); }
/* 折叠文案跟着开合状态走：开着还写「展开设置」会让人以为没生效 */
.vl-settings__date:not([open]) .vl-settings__fold--open,
.vl-settings__date[open] .vl-settings__fold--closed { display: none; }
.vl-settings__row { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
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
