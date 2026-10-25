<template>
  <!-- 虚拟学习者容量与实验环境（2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」）：
       三项设置从「模型与接入 · 虚拟学习者」页签搬回本页——它们管的是「虚拟学习者能跑多少、
       跑到哪天」，读数和改配置本来就该在同一页。此前 KPI 卡写着「上限在模型与接入 → 虚拟学习者」，
       点过去再点回来，两处都不是家。
       本组件只出字段，卡片外壳与分区标题由宿主（VirtualLearners.vue）承担。 -->
  <div class="vl-settings">
    <div class="vl-settings__block">
      <div class="vl-settings__label" title="虚拟学习者专属的出站速率上限，与平台全局 RPM 分开计量">专属 RPM 上限</div>
      <div class="vl-settings__row">
        <input
          v-model.number="rpmInput"
          type="number"
          min="0"
          max="100000"
          step="10"
          class="mk-field__input vl-rpm__input"
          aria-label="虚拟学习者专属出站 RPM 上限"
          :disabled="rpmLoadFailed"
          :title="rpmLoadFailed ? LOAD_FAILED_EDIT_TITLE : undefined"
          @input="rpmDirty = true"
          @keydown.enter.prevent="saveRpm"
        />
        <span class="vl-rpm__unit">次 / 分 · 0 = 不限</span>
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="!rpmDirty || rpmSaving || rpmLoadFailed"
          @click="saveRpm"
        >{{ rpmSaving ? '保存中…' : '保存' }}</button>
        <span v-if="rpmDirty" class="vl-rpm__dirty">未保存</span>
        <span v-if="rpmLoadFailed" class="vl-rpm__failed" role="alert">{{ LOAD_FAILED_SAVE_NOTE }}</span>
      </div>
    </div>

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

/* 专属 RPM（0 = 不限）：与平台全局 RPM 是两条独立上限，保存链也不同 */
const rpmInput = ref(0)
const rpmDirty = ref(false)
const rpmSaving = ref(false)
const rpmLoadFailed = ref(false)

/* 最高并发（自动驾驶全局并发上限，1–200） */
const concurrencyInput = ref(1)
const concurrencyDirty = ref(false)
const saving = ref(false)
/** 设置未加载位：getVirtualLabSettings 失败时置位——写控件禁用，禁止拿初始值覆盖服务端配置 */
const loadFailed = ref(false)

/** 两项设置同源同接口：一次拉取回填两格，失败同时禁用，不出现「一个能改一个不能改」 */
async function loadSettings() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const s = res.data?.data?.settings ?? {}
    const rpm = Math.max(0, Number(s.virtualLearnerRpmLimit ?? 0) || 0)
    if (!rpmDirty.value) rpmInput.value = rpm
    rpmLoadFailed.value = false
    const limit = Math.max(1, Number(s.autopilotConcurrencyLimit ?? 1))
    if (!concurrencyDirty.value) concurrencyInput.value = limit
    loadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置失败位，控件不把「没拉到」当默认值覆盖服务端 */
    rpmLoadFailed.value = true
    loadFailed.value = true
  }
}

async function saveRpm() {
  if (rpmSaving.value || !rpmDirty.value || rpmLoadFailed.value) return
  const value = Math.max(0, Math.min(100000, Math.round(Number(rpmInput.value) || 0)))
  rpmInput.value = value
  rpmSaving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLabSettings({ virtualLearnerRpmLimit: value })
    rpmDirty.value = false
    toast.success(value > 0 ? `虚拟学习者 RPM 上限已设为 ${value}` : '虚拟学习者 RPM 已设为不限')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    rpmSaving.value = false
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
