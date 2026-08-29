<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">平台设置</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">注册 {{ registrationEnabled === null ? '—' : registrationEnabled ? '开放' : '关闭' }}</span>
      <span class="mk-status__meta">探活 {{ probe.enabled ? '开启' : '关闭' }}</span>
      <button type="button" class="mk-status__action" :disabled="saving" @click="saveAll">{{ saving ? '保存中…' : '保存全部' }}</button>
    </div>

    <!-- 注册策略 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">注册策略</h4>
        <span class="mk-card__meta">控制新用户能否自助注册</span>
      </div>
      <div class="st-body">
        <div class="st-row">
          <div class="st-row__text">
            <strong>开放注册</strong>
            <span>开启后任何人可访问 /register 自助创建账号；关闭后仅管理员可在「用户」页创建</span>
          </div>
          <button
            type="button"
            class="mk-btn"
            :class="registrationEnabled ? 'mk-btn--ok' : ''"
            :disabled="regBusy"
            @click="toggleRegistration"
          >
            {{ regBusy ? '切换中…' : registrationEnabled ? '开放中 · 点击关闭' : '已关闭 · 点击开放' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 可靠性设置 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">模型调用可靠性</h4>
        <span class="mk-card__meta">重试与超时参数，影响所有 LLM 调用</span>
      </div>
      <div class="st-body">
        <div v-if="reliabilityLoadFailed" class="st-error">
          <span>可靠性设置读取失败</span>
          <button type="button" class="mk-link" @click="loadReliability">重试</button>
        </div>
        <template v-else-if="reliability">
          <div class="st-grid">
            <label class="mk-field">
              <span class="mk-field__label">上游最大尝试</span>
              <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" max="10" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">传输重试</span>
              <input v-model.number="reliability.maxTransportRetries" type="number" min="0" max="5" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">逻辑重试</span>
              <input v-model.number="reliability.maxLogicalRetries" type="number" min="0" max="5" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">退避基数（ms）</span>
              <input v-model.number="reliability.retryBaseDelayMs" type="number" min="100" step="100" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">Retry-After 上限（ms）</span>
              <input v-model.number="reliability.maxRetryAfterMs" type="number" min="1000" step="1000" class="mk-field__input" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">单次超时（ms）</span>
              <input v-model.number="reliability.defaultRequestTimeoutMs" type="number" min="1000" step="1000" class="mk-field__input" />
            </label>
            <label class="mk-field mk-field--switch">
              <input v-model="reliability.jitterEnabled" type="checkbox" />
              <span class="mk-field__label" style="margin:0">随机抖动（避免重试风暴）</span>
            </label>
          </div>
        </template>
        <div v-else class="st-loading"><span class="mk-spinner"></span> 加载中…</div>
      </div>
    </section>

    <!-- 能力探测 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">AI 能力探测</h4>
        <span class="mk-card__meta">定期探活核心能力，健康中心展示快照</span>
      </div>
      <div class="st-body">
        <div class="st-grid">
          <label class="mk-field mk-field--switch">
            <input v-model="probe.enabled" type="checkbox" />
            <span class="mk-field__label" style="margin:0">开启定期探活</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">探测间隔（秒）</span>
            <input
              v-model.number="probe.intervalSec"
              type="number"
              :min="Math.ceil((probe.minIntervalMs || 60000) / 1000)"
              :max="Math.floor((probe.maxIntervalMs || 3600000) / 1000)"
              step="30"
              class="mk-field__input"
              :disabled="!probe.enabled"
            />
          </label>
        </div>
        <div v-if="capabilities" class="st-caps">
          <div v-for="(cap, name) in capabilities" :key="name" class="st-cap">
            <span class="st-cap__name">{{ name }}</span>
            <span class="mk-badge" :class="capLabel(cap.status).cls">{{ capLabel(cap.status).text }}</span>
            <span class="st-cap__meta mono">{{ cap.latencyMs != null ? cap.latencyMs + 'ms' : '—' }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { errMsg } from './live'
import { adminPlatformSettingsApi, adminCapabilityProbeApi, adminSystemApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

const statusTone = computed(() => 'mk-status--ok')
const saving = ref(false)

/* 注册 */
const registrationEnabled = ref<boolean | null>(null)
const regBusy = ref(false)

async function loadRegistration() {
  try {
    const res = await adminPlatformSettingsApi.getRegistrationSetting()
    const data = res.data?.data ?? res.data
    registrationEnabled.value = data?.registrationEnabled !== false
  } catch {
    registrationEnabled.value = null
  }
}

async function toggleRegistration() {
  if (registrationEnabled.value === null) return
  regBusy.value = true
  const target = !registrationEnabled.value
  try {
    await adminPlatformSettingsApi.updateRegistrationSetting(target)
    registrationEnabled.value = target
    toast.success(target ? '注册已开放' : '注册已关闭')
  } catch (e) {
    toast.error(`切换失败：${errMsg(e)}`)
  } finally {
    regBusy.value = false
  }
}

/* 可靠性 */
const reliability = ref<any>(null)
const reliabilityLoadFailed = ref(false)

async function loadReliability() {
  reliabilityLoadFailed.value = false
  try {
    const res = await adminPlatformSettingsApi.getReliabilitySettings()
    const data = res.data?.data ?? res.data
    const s = data?.settings ?? data
    reliability.value = s ? { ...s } : null
  } catch {
    reliabilityLoadFailed.value = true
  }
}

/* 探测 */
const probe = ref({
  enabled: false,
  intervalSec: 600,
  loaded: false,
  minIntervalMs: 60000,
  maxIntervalMs: 3600000,
})
const capabilities = ref<Record<string, any> | null>(null)

async function loadProbe() {
  try {
    const res = await adminCapabilityProbeApi.getSettings()
    const data = res.data?.data ?? res.data
    probe.value = {
      enabled: !!data?.enabled,
      intervalSec: Math.round((data?.intervalMs || 600000) / 1000),
      loaded: true,
      minIntervalMs: data?.minIntervalMs ?? 60000,
      maxIntervalMs: data?.maxIntervalMs ?? 3600000,
    }
  } catch {
    probe.value.loaded = true
  }
  try {
    const res = await adminSystemApi.getCapabilities()
    const data = res.data?.data ?? res.data
    capabilities.value = data?.capabilities ?? data?.snapshot ?? null
  } catch {
    capabilities.value = null
  }
}

/* 保存全部 */
async function saveAll() {
  saving.value = true
  const failures: string[] = []
  try {
    if (reliability.value) {
      await adminPlatformSettingsApi.updateReliabilitySettings({ ...reliability.value })
    }
  } catch (e) {
    failures.push(`可靠性：${errMsg(e)}`)
  }
  try {
    if (probe.value.loaded) {
      await adminCapabilityProbeApi.updateSettings({
        enabled: probe.value.enabled,
        intervalMs: Math.max(probe.value.minIntervalMs, probe.value.intervalSec * 1000),
      })
    }
  } catch (e) {
    failures.push(`探测：${errMsg(e)}`)
  }
  saving.value = false
  if (failures.length) toast.error(failures.join('；'))
  else toast.success('设置已保存')
}

function capLabel(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'healthy' || s === 'ok') return { text: '健康', cls: 'mk-badge--ok' }
  if (s === 'degraded' || s === 'warn') return { text: '降级', cls: 'mk-badge--warn' }
  if (s === 'down' || s === 'error') return { text: '异常', cls: 'mk-badge--bad' }
  return { text: s || '未知', cls: 'mk-badge--muted' }
}

void loadRegistration()
void loadReliability()
void loadProbe()
</script>

<style scoped>
.st-body { padding: 14px; display: grid; gap: 14px; }
.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.st-row__text { display: grid; gap: 2px; }
.st-row__text strong { font-size: 13px; }
.st-row__text span { font-size: 12px; color: var(--mk-muted); max-width: 560px; }

.st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
.st-loading { display: flex; align-items: center; gap: 10px; color: var(--mk-muted); font-size: 13px; padding: 10px 0; }
.st-error { display: flex; align-items: center; gap: 8px; color: var(--mk-red); font-size: 13px; }

.st-caps { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px dashed var(--mk-line); padding-top: 12px; }
.st-cap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  font-size: 12px;
}
.st-cap__name { font-weight: 700; }
.st-cap__meta { color: var(--mk-faint); font-size: 11px; }

@media (min-width: 2000px) {
  .st-row__text strong { font-size: 14.5px; }
  .st-row__text span { font-size: 13.5px; }
}
</style>
