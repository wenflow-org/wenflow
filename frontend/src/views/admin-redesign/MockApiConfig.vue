<template>
  <div class="mk-page">
    <!-- 单行健康条 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">密钥 {{ keySet ? '已配置' : '未配置' }}</span>
      <span class="mk-status__meta">模型 {{ models.length || '待拉取' }}</span>
      <span class="mk-status__meta">路由 {{ routeCount }}/3</span>
      <span v-if="isLive && cfg?.lastCheckedAt" class="mk-status__meta">上次检查 {{ timeAgo(cfg.lastCheckedAt) }}</span>
      <button type="button" class="mk-status__action" :disabled="fetching || !form.apiUrl" @click="fetchModels">
        <span v-if="fetching"><span class="mk-spinner"></span> 拉取中…</span>
        <span v-else>{{ models.length ? '重新拉取' : '连接并拉取' }}</span>
      </button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="ac-grid">
      <!-- 接入与模型 -->
      <section class="mk-card ac-main">
        <div class="mk-card__head">
          <h3 class="mk-card__title">接入与模型</h3>
          <span class="mk-badge" :class="connBadge.cls">{{ connBadge.text }}</span>
        </div>
        <div class="ac-form">
          <div class="ac-row ac-row--2-1">
            <label class="ac-field">
              <span>服务地址</span>
              <input class="mk-filter__input" v-model="form.apiUrl" placeholder="https://api.example.com/v1" @input="markDirty('conn')" />
            </label>
            <label class="ac-field">
              <span>API Key</span>
              <input
                class="mk-filter__input"
                type="password"
                v-model="form.apiKey"
                :placeholder="keySet ? '已配置 · 留空则沿用' : '输入 API Key'"
                @input="markDirty('conn')"
              />
            </label>
          </div>
          <label class="ac-field">
            <span>可用模型</span>
            <div class="ac-models">
              <span v-for="m in models" :key="m" class="ac-model">{{ m }}</span>
              <span v-if="!models.length" class="mk-na">先在上方连接并拉取模型</span>
            </div>
          </label>
          <div class="ac-row ac-row--3">
            <label class="ac-field">
              <span>对话默认</span>
              <select class="mk-filter__select" v-model="form.defaultModel" :disabled="!models.length" @change="markDirty('route')">
                <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
                <option v-if="!models.length" value="">未设置</option>
              </select>
            </label>
            <label class="ac-field">
              <span>推理默认</span>
              <select class="mk-filter__select" v-model="form.defaultReasoningModel" :disabled="!models.length" @change="markDirty('route')">
                <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
                <option v-if="!models.length" value="">未设置</option>
              </select>
            </label>
            <label class="ac-field">
              <span>评估默认</span>
              <select class="mk-filter__select" v-model="form.defaultEvaluationModel" :disabled="!models.length" @change="markDirty('route')">
                <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
                <option v-if="!models.length" value="">未设置</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <!-- 验证工具 -->
      <section class="mk-card ac-side">
        <div class="mk-card__head">
          <h3 class="mk-card__title">连通性验证</h3>
          <span class="mk-badge" :class="testResult ? (testResult.ok ? 'mk-badge--ok' : 'mk-badge--bad') : 'mk-badge--muted'">
            {{ testResult ? (testResult.ok ? '测试通过' : '测试失败') : '未执行' }}
          </span>
        </div>
        <div class="ac-form">
          <label class="ac-field">
            <span>测试模型</span>
            <select class="mk-filter__select" v-model="testModel" :disabled="!models.length">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="!models.length" value="">无可用模型</option>
            </select>
          </label>
          <div v-if="testResult" class="ac-result" :class="{ 'ac-result--bad': !testResult.ok }">
            <div class="ac-result__meta">
              <span>{{ testResult.latency || '—' }}</span>
              <span class="mono">{{ testResult.usage || '' }}</span>
            </div>
            <p>「{{ testResult.text }}」</p>
          </div>
          <button type="button" class="ac-run" :disabled="!models.length || testing" @click="runTest">
            <span v-if="testing"><span class="mk-spinner"></span> 测试中…</span>
            <span v-else>运行测试</span>
          </button>
        </div>
      </section>
    </div>

    <!-- 网络边界（全宽） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">网络边界</h3>
        <span class="mk-badge mk-badge--info">平台策略 · 热生效</span>
      </div>
      <div class="ac-policy">
        <div class="ac-policy__item">
          <span class="ac-policy__label">Admin 访问范围</span>
          <div class="ac-seg">
            <button
              v-for="opt in accessOptions"
              :key="opt.id"
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': policy.adminAccessMode === opt.id }"
              @click="policy.adminAccessMode = opt.id; markDirty('policy')"
            >
              {{ opt.label }}
            </button>
          </div>
          <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">⚠ 公网开放：任何能访问该服务的人都能看到管理入口</span>
          <label v-if="policy.adminAccessMode === 'private'" class="ac-field" style="margin-top:8px">
            <span>额外允许的客户端 IP（每行一个，可留空）</span>
            <textarea
              class="mk-filter__input ac-textarea"
              rows="2"
              :value="policy.adminAllowedIps.join('\n')"
              @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="203.0.113.10"
            ></textarea>
          </label>
        </div>
        <div class="ac-policy__item">
          <span class="ac-policy__label">私有网络服务</span>
          <div class="ac-seg">
            <button
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': policy.allowPrivateNetwork }"
              @click="policy.allowPrivateNetwork = true; markDirty('policy')"
            >
              允许
            </button>
            <button
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': !policy.allowPrivateNetwork }"
              @click="policy.allowPrivateNetwork = false; markDirty('policy')"
            >
              仅白名单
            </button>
          </div>
          <label v-if="!policy.allowPrivateNetwork" class="ac-field" style="margin-top:8px">
            <span>允许的 Host / IP（每行一个）</span>
            <textarea
              class="mk-filter__input ac-textarea"
              rows="2"
              :value="policy.privateNetworkHosts.join('\n')"
              @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="192.168.1.20"
            ></textarea>
          </label>
        </div>
      </div>
    </section>

    <!-- 平台访问：新用户注册开关（live） -->
    <section v-if="isLive && registrationEnabled !== null" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">平台访问</h3>
        <span class="mk-badge" :class="registrationEnabled ? 'mk-badge--ok' : 'mk-badge--warn'">
          注册{{ registrationEnabled ? '开放' : '关闭' }}
        </span>
      </div>
      <div class="ac-registration">
        <div class="ac-registration__text">
          <strong>新用户注册</strong>
          <span>{{ registrationEnabled ? '当前允许任何人通过注册页创建账号。' : '当前已关闭自助注册，新账号只能由管理员在「用户」页创建。' }}</span>
        </div>
        <button
          type="button"
          class="ac-seg__item ac-registration__toggle"
          :class="{ 'ac-seg__item--active': true }"
          :disabled="registrationBusy"
          @click="toggleRegistration"
        >
          {{ registrationBusy ? '切换中…' : registrationEnabled ? '关闭注册' : '开放注册' }}
        </button>
      </div>
    </section>

    <!-- AI 调用可靠性（live） -->
    <section v-if="isLive && reliability" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">AI 调用可靠性</h3>
        <span class="mk-badge mk-badge--muted">超时与重试 · 平台级</span>
      </div>
      <div class="ac-rel">
        <label class="ac-field">
          <span>上游最大尝试</span>
          <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" max="10" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field">
          <span>传输重试</span>
          <input v-model.number="reliability.maxTransportRetries" type="number" min="0" max="5" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field">
          <span>逻辑重试</span>
          <input v-model.number="reliability.maxLogicalRetries" type="number" min="0" max="5" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field">
          <span>单次超时 ms</span>
          <input v-model.number="reliability.defaultRequestTimeoutMs" type="number" min="1000" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field">
          <span>退避基数 ms</span>
          <input v-model.number="reliability.retryBaseDelayMs" type="number" min="100" step="100" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field">
          <span>Retry-After 上限 ms</span>
          <input v-model.number="reliability.maxRetryAfterMs" type="number" min="1000" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
        </label>
        <label class="ac-field ac-field--check">
          <span>随机抖动</span>
          <input v-model="reliability.jitterEnabled" type="checkbox" @change="markDirty('reliability')" />
        </label>
      </div>
      <p class="ac-rel__note">不变量：认证失败不重试 · 额度耗尽不重试 · 调用方取消不重试 · 不静默切换 Provider</p>
    </section>

    <!-- AI 能力探测（live） -->
    <section v-if="isLive && probe.loaded" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">AI 能力探测</h3>
        <span class="mk-badge" :class="probe.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">
          {{ probe.enabled ? '已开启' : '已关闭' }}
        </span>
      </div>
      <div class="ac-probe">
        <label class="ac-field ac-field--check">
          <span>定期探活</span>
          <input type="checkbox" v-model="probe.enabled" @change="markDirty('probe')" />
        </label>
        <label class="ac-field">
          <span>探测间隔（秒）</span>
          <input
            v-model.number="probe.intervalSec"
            type="number"
            :min="Math.ceil(probe.minIntervalMs / 1000)"
            :max="Math.floor(probe.maxIntervalMs / 1000)"
            step="30"
            class="mk-filter__input"
            :disabled="!probe.enabled"
            @input="markDirty('probe')"
          />
        </label>
      </div>
      <p class="ac-rel__note">
        默认关闭。开启后按间隔向模型服务发极简探活（约 15 token），用于 5 条核心学习链路健康判断。间隔 10 秒～24 小时。
      </p>
    </section>

    <!-- AI 能力健康快照（live） -->
    <section v-if="isLive" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">能力健康</h3>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
      </div>
      <div v-if="health" class="ac-health">
        <div v-for="c in health.capabilities" :key="c.id" class="ac-health__row">
          <span class="ac-health__dot" :class="`is-${c.status}`"></span>
          <span class="ac-health__id mono">{{ c.id }}</span>
          <span class="ac-health__msg">{{ c.message }}</span>
          <span class="ac-health__lat mono">{{ c.latencyMs != null ? `${c.latencyMs}ms` : '—' }}</span>
          <span class="ac-health__time">{{ c.checkedAt ? timeAgo(c.checkedAt) : '未探测' }}</span>
        </div>
      </div>
      <p v-else class="ac-rel__note">健康快照加载中…</p>
      <div class="ac-health__foot">
        <span v-if="health?.stale" class="ac-health__stale">快照已过期（超过 5 分钟未探测）</span>
        <span v-else-if="health?.checkedAt" class="ac-health__stale">最近探测 {{ timeAgo(health.checkedAt) }}</span>
        <button type="button" class="mk-status__action" :disabled="healthProbing" @click="probeHealth">
          {{ healthProbing ? '探测中…' : '立即探测' }}
        </button>
      </div>
    </section>

    <!-- 保存条 -->
    <div v-if="dirty.size > 0" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirty.size }} 组未保存变更</span>
      <button type="button" class="mk-link" :disabled="saving" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" :disabled="saving" @click="saveAll">
        {{ saving ? '保存中…' : '保存变更' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { dataSource } from './mockStore'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveRunModelTest,
  liveSaveNetworkPolicy,
  timeAgo,
  errMsg
} from './mockLive'
import { adminPlatformSettingsApi, adminCapabilityProbeApi, adminSystemApi } from '@/api/adminApi'
import { registrationEnabled, updateRegistrationSetting } from './mockLive'

const props = defineProps<{ state: 'ready' | 'incomplete' }>()

const isLive = computed(() => dataSource.value === 'live')

/* ---------- AI 能力健康快照 ---------- */
interface CapHealth {
  id: string
  status: 'operational' | 'degraded' | 'unavailable' | 'unknown'
  checkedAt: string | null
  latencyMs: number | null
  message: string
}
interface CapSnapshot {
  overall: CapHealth['status']
  checkedAt: string | null
  stale: boolean
  capabilities: CapHealth[]
}
const health = ref<CapSnapshot | null>(null)
const healthProbing = ref(false)

const healthLabel = computed(
  () =>
    ({ operational: '全部正常', degraded: '部分降级', unavailable: '存在不可用', unknown: '状态确认中' })[
      health.value?.overall || 'unknown'
    ]
)
const healthBadgeCls = computed(
  () =>
    ({
      operational: 'mk-badge--ok',
      degraded: 'mk-badge--warn',
      unavailable: 'mk-badge--bad',
      unknown: 'mk-badge--muted',
      '': 'mk-badge--muted',
    } as Record<string, string>)[health.value?.overall || '']
)

async function loadHealth() {
  try {
    const res = await adminSystemApi.getCapabilities()
    health.value = res.data?.data ?? res.data ?? null
  } catch {
    health.value = null
  }
}

async function probeHealth() {
  if (healthProbing.value) return
  healthProbing.value = true
  try {
    const res = await adminSystemApi.probeCapabilities()
    health.value = res.data?.data ?? res.data ?? null
  } finally {
    healthProbing.value = false
  }
}

/* ---------- 表单状态（demo / live 共用一套交互） ---------- */
const form = reactive({
  apiUrl: '',
  apiKey: '',
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: ''
})
const policy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[]
})
const fetchedModels = ref<string[]>([])
const keySet = ref(false)
const connectionStatus = ref('unknown')

const dirty = ref<Set<string>>(new Set())
function markDirty(group: string) {
  dirty.value = new Set([...dirty.value, group])
}

function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}

/* AI 可靠性（live 加载） */
interface Reliability {
  maxUpstreamAttempts: number
  maxTransportRetries: number
  maxLogicalRetries: number
  defaultRequestTimeoutMs: number
  retryBaseDelayMs: number
  maxRetryAfterMs: number
  jitterEnabled: boolean
}
const reliability = ref<Reliability | null>(null)

const probe = reactive({
  enabled: false,
  intervalSec: 120,
  minIntervalMs: 10_000,
  maxIntervalMs: 86_400_000,
  loaded: false,
  lastEnabled: false,
  lastIntervalSec: 120
})

async function loadReliability() {
  try {
    const res = await adminPlatformSettingsApi.getReliabilitySettings()
    const s = res.data?.data?.settings ?? res.data?.data ?? {}
    reliability.value = {
      maxUpstreamAttempts: Number(s.maxUpstreamAttempts ?? 3),
      maxTransportRetries: Number(s.maxTransportRetries ?? 1),
      maxLogicalRetries: Number(s.maxLogicalRetries ?? 1),
      defaultRequestTimeoutMs: Number(s.defaultRequestTimeoutMs ?? 600000),
      retryBaseDelayMs: Number(s.retryBaseDelayMs ?? 2000),
      maxRetryAfterMs: Number(s.maxRetryAfterMs ?? 30000),
      jitterEnabled: s.jitterEnabled !== false
    }
  } catch {
    reliability.value = null
  }
}

async function loadProbe() {
  try {
    const res = await adminCapabilityProbeApi.getSettings()
    const d = res.data?.data ?? {}
    probe.enabled = d.enabled === true
    probe.lastEnabled = probe.enabled
    const ms = Number(d.intervalMs)
    probe.intervalSec = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 120
    probe.lastIntervalSec = probe.intervalSec
    if (typeof d.minIntervalMs === 'number') probe.minIntervalMs = d.minIntervalMs
    if (typeof d.maxIntervalMs === 'number') probe.maxIntervalMs = d.maxIntervalMs
    probe.loaded = true
  } catch {
    probe.loaded = false
  }
}

/* demo 数据 */
const DEMO_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-lite', 'deepseek-v4-vision', 'qwen3-32b', 'qwen3-14b']

function applyLiveConfig() {
  if (!cfg.value) return
  form.apiUrl = cfg.value.apiUrl
  form.apiKey = ''
  form.defaultModel = cfg.value.defaultModel
  form.defaultReasoningModel = cfg.value.defaultReasoningModel
  form.defaultEvaluationModel = cfg.value.defaultEvaluationModel
  fetchedModels.value = [...cfg.value.availableModels]
  keySet.value = cfg.value.apiKeyConfigured
  connectionStatus.value = cfg.value.connectionStatus
  Object.assign(policy, cfg.value.networkPolicy)
  dirty.value = new Set()
}

function applyDemoState(s: 'ready' | 'incomplete') {
  if (s === 'ready') {
    form.apiUrl = 'https://api.deepseek.com/v1'
    form.apiKey = ''
    form.defaultModel = 'deepseek-v4-flash'
    form.defaultReasoningModel = 'deepseek-v4-pro'
    form.defaultEvaluationModel = 'deepseek-v4-pro'
    fetchedModels.value = [...DEMO_MODELS]
    keySet.value = true
    connectionStatus.value = 'connected'
    dirty.value = new Set(['conn', 'route'])
  } else {
    form.apiUrl = ''
    form.apiKey = ''
    form.defaultModel = ''
    form.defaultReasoningModel = ''
    form.defaultEvaluationModel = ''
    fetchedModels.value = []
    keySet.value = false
    connectionStatus.value = 'unknown'
    dirty.value = new Set()
  }
}

watch(
  () => [dataSource.value, cfg.value, props.state] as const,
  () => {
    if (dataSource.value === 'live') {
      applyLiveConfig()
      if (!reliability.value) void loadReliability()
      if (!probe.loaded) void loadProbe()
      void loadHealth()
    } else applyDemoState(props.state)
  },
  { immediate: true, deep: true }
)

const models = computed(() => fetchedModels.value)
const ready = computed(() => keySet.value && models.value.length > 0 && !!form.defaultModel)
const routeCount = computed(() => [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length)
const statusTitle = computed(() => {
  if (ready.value) return '模型服务已就绪'
  if (keySet.value && !models.value.length) return '密钥已配置 · 待拉取模型列表'
  if (keySet.value) return '密钥已配置 · 待补齐默认模型'
  return '待配置模型接入'
})
const statusTone = computed(() => {
  if (ready.value) return 'mk-status--ok'
  if (keySet.value) return 'mk-status--muted'
  return 'mk-status--warn'
})
const connBadge = computed(() => {
  if (connectionStatus.value === 'connected') return { cls: 'mk-badge--ok', text: '连接正常' }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次连接失败' }
  return { cls: 'mk-badge--muted', text: ready.value ? '已配置' : '待配置' }
})

const accessOptions = [
  { id: 'loopback' as const, label: '仅本机' },
  { id: 'private' as const, label: '本机 + 局域网' },
  { id: 'any' as const, label: '不限制' }
]

/* ---------- 操作 ---------- */
const fetching = ref(false)
const testing = ref(false)
const saving = ref(false)
const testModel = ref('')
const testResult = ref<{ ok: boolean; text: string; latency?: string; usage?: string } | null>(null)
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

watch(models, (ms) => {
  if (ms.length && !ms.includes(testModel.value)) testModel.value = ms[0]
}, { immediate: true })

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

async function fetchModels() {
  if (fetching.value || !form.apiUrl) return
  fetching.value = true
  try {
    if (isLive.value) {
      const list = await liveFetchModels(form.apiUrl, form.apiKey)
      fetchedModels.value = list
      connectionStatus.value = 'connected'
      markDirty('conn')
      showToast(list.length ? `已获取 ${list.length} 个模型，记得保存` : '连接成功，但服务未返回模型列表')
    } else {
      await new Promise((r) => setTimeout(r, 900))
      fetchedModels.value = [...DEMO_MODELS]
      keySet.value = true
      connectionStatus.value = 'connected'
      markDirty('conn')
      showToast(`已获取 ${DEMO_MODELS.length} 个模型，记得保存`)
    }
  } catch (e) {
    connectionStatus.value = 'failed'
    showToast(`连接失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    fetching.value = false
  }
}

async function runTest() {
  if (testing.value || !testModel.value) return
  testing.value = true
  testResult.value = null
  const started = Date.now()
  try {
    if (isLive.value) {
      const r = await liveRunModelTest({
        apiUrl: form.apiUrl,
        apiKey: form.apiKey,
        model: testModel.value,
        prompt: '用一句话介绍你自己。'
      })
      testResult.value = {
        ok: true,
        text: r.text.slice(0, 80),
        latency: r.latencyMs ? `${r.latencyMs}ms` : `${Date.now() - started}ms`,
        usage: r.usage
      }
      showToast('测试通过')
    } else {
      await new Promise((r) => setTimeout(r, 800))
      testResult.value = { ok: true, text: '模型测试成功。', latency: '238ms', usage: 'P 12 / C 9 / T 21' }
      showToast('测试通过 · 238ms')
    }
  } catch (e) {
    testResult.value = { ok: false, text: errMsg(e).slice(0, 80) }
    showToast(`测试失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    testing.value = false
  }
}

async function saveAll() {
  if (saving.value) return
  // 高风险确认：开放公网访问需二次确认
  if (isLive.value && dirty.value.has('policy') && policy.adminAccessMode === 'any') {
    const ok = window.confirm('你正在将 Admin 后台开放到公网/任意来源访问。任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。')
    if (!ok) return
  }
  saving.value = true
  try {
    if (isLive.value) {
      if (dirty.value.has('conn') || dirty.value.has('route')) {
        await liveSaveApiConfig({
          apiUrl: form.apiUrl,
          apiKey: form.apiKey,
          availableModels: fetchedModels.value,
          defaultModel: form.defaultModel,
          defaultReasoningModel: form.defaultReasoningModel,
          defaultEvaluationModel: form.defaultEvaluationModel
        })
      }
      if (dirty.value.has('policy')) {
        await liveSaveNetworkPolicy({ ...policy })
      }
      if (dirty.value.has('reliability') && reliability.value) {
        await adminPlatformSettingsApi.updateReliabilitySettings({ ...reliability.value })
      }
      if (dirty.value.has('probe') && probe.loaded) {
        const payload: { enabled?: boolean; intervalMs?: number } = {}
        if (probe.enabled !== probe.lastEnabled) payload.enabled = probe.enabled
        if (probe.intervalSec !== probe.lastIntervalSec) {
          payload.intervalMs = Math.round(probe.intervalSec * 1000)
        }
        if (Object.keys(payload).length) {
          const res = await adminCapabilityProbeApi.updateSettings(payload)
          const d = res.data?.data ?? {}
          if (typeof d.enabled === 'boolean') {
            probe.enabled = d.enabled
            probe.lastEnabled = d.enabled
          }
          if (typeof d.intervalMs === 'number') {
            probe.intervalSec = Math.round(d.intervalMs / 1000)
            probe.lastIntervalSec = probe.intervalSec
          }
        }
      }
      dirty.value = new Set()
      showToast('配置已保存并生效')
    } else {
      await new Promise((r) => setTimeout(r, 400))
      dirty.value = new Set()
      showToast('连接与安全配置已保存')
    }
  } catch (e) {
    showToast(`保存失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    saving.value = false
  }
}

function discardAll() {
  if (isLive.value) {
    applyLiveConfig()
    void loadReliability()
    void loadProbe()
  } else applyDemoState(props.state)
  showToast('已放弃未保存的变更', 'mk-toast--info')
}

/* 注册开关：高风险操作，二次确认 */
const registrationBusy = ref(false)
async function toggleRegistration() {
  if (registrationBusy.value || registrationEnabled.value === null) return
  const target = !registrationEnabled.value
  const ok = window.confirm(
    target
      ? '确认开放新用户自助注册？任何人都能通过注册页创建账号。'
      : '确认关闭新用户自助注册？关闭后新账号只能由管理员手动创建。'
  )
  if (!ok) return
  registrationBusy.value = true
  try {
    await updateRegistrationSetting(target)
    showToast(target ? '注册已开放' : '注册已关闭，新账号只能由管理员创建')
  } catch (e) {
    showToast(`切换失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    registrationBusy.value = false
  }
}
</script>

<style scoped>
.ac-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 14px;
  align-items: start;
}
.ac-form { display: grid; gap: 14px; padding: 16px; }
.ac-row { display: grid; gap: 12px; }
.ac-row--2-1 { grid-template-columns: 1.6fr 1fr; }
.ac-row--3 { grid-template-columns: repeat(3, 1fr); }
.ac-field { display: grid; gap: 6px; }
.ac-field > span { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.ac-field .mk-filter__input,
.ac-field .mk-filter__select { width: 100%; }

.ac-models { display: flex; gap: 6px; flex-wrap: wrap; }
.ac-model {
  padding: 4px 10px;
  border-radius: 7px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-family: var(--mk-mono);
  font-size: 11.5px;
  font-weight: 600;
}

.ac-result {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 6px;
  background: #fafbfc;
}
.ac-result--bad { border-color: rgba(220, 38, 38, 0.35); background: #fff7f7; }
.ac-result__meta { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--mk-faint); }
.ac-result p { margin: 0; font-size: 12.5px; word-break: break-all; }
.ac-run {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-blue);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-run:disabled { opacity: 0.5; cursor: not-allowed; }

.ac-policy {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 16px;
}
.ac-policy__item { display: grid; gap: 8px; align-content: start; }
.ac-policy__label { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.ac-policy__warn { font-size: 11.5px; color: var(--mk-red); font-weight: 600; }
.ac-seg { display: inline-flex; gap: 4px; padding: 3px; background: #eef2fa; border-radius: 10px; width: fit-content; }
.ac-seg__item {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.ac-seg__item--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }

.ac-textarea { resize: vertical; font-size: 12px; }
.ac-rel {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  padding: 0 16px 8px;
}
.ac-probe {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px 16px;
  padding: 0 16px 8px;
  align-items: end;
}

/* 能力健康 */
.ac-health { display: grid; padding: 2px 16px 8px; }
.ac-health__row {
  display: grid;
  grid-template-columns: 10px 168px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12px;
}
.ac-health__row:last-child { border-bottom: none; }
.ac-health__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-health__dot.is-operational { background: var(--mk-green); }
.ac-health__dot.is-degraded { background: var(--mk-amber); }
.ac-health__dot.is-unavailable { background: var(--mk-red); }
.ac-health__dot.is-unknown { background: var(--mk-faint); }
.ac-health__id { font-size: 11px; color: var(--mk-ink); }
.ac-health__msg { color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-health__lat { font-size: 11px; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.ac-health__time { font-size: 11px; color: var(--mk-faint); white-space: nowrap; }
.ac-health__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 16px 14px;
}
.ac-health__stale { font-size: 11px; color: var(--mk-faint); }
.ac-field--check { align-content: end; }
.ac-field--check input { width: 16px; height: 16px; }
.ac-rel__note {
  margin: 0;
  padding: 0 16px 14px;
  font-size: 11.5px;
  color: var(--mk-faint);
}

.ac-registration {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}
.ac-registration__text { display: grid; gap: 3px; flex: 1; }
.ac-registration__text strong { font-size: 13px; }
.ac-registration__text span { font-size: 12px; color: var(--mk-muted); }
.ac-registration__toggle {
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  padding: 7px 14px;
  font-weight: 700;
  white-space: nowrap;
}
.ac-registration__toggle:disabled { opacity: 0.6; }

.ac-save {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 4px auto 0;
  padding: 9px 12px 9px 16px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.24);
  background: var(--mk-surface);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  font-weight: 600;
}
.ac-save__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-amber); }
.ac-save__primary {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-save__primary:disabled { opacity: 0.6; cursor: not-allowed; }

.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }

@media (max-width: 900px) {
  .ac-grid { grid-template-columns: 1fr; }
  .ac-policy { grid-template-columns: 1fr; }
}
</style>
